import catalogue from "../catalog.json" with { type: "json" };

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const PAGE_SIZE_MAX = 30;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);

function responseJson(data, status = 200, origin = "*", extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? "public, max-age=30, stale-while-revalidate=120" : "no-store",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "content-type",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function validImageSignature(bytes, format) {
  if (format === "png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (format === "jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (format === "webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

function publicEntry(entry, apiBase) {
  const { objectKey, ...metadata } = entry;
  return { ...metadata, imageUrl: apiBase + "/api/images/" + entry.id };
}

export function entriesFor(category, source = catalogue.artworks) {
  return source.filter((entry) =>
    (category === null || entry.category === category) &&
    ["community", "album"].includes(entry.category) &&
    entry.redistributionAllowed === true &&
    ID_PATTERN.test(entry.id) &&
    typeof entry.title === "string" && entry.title.trim().length > 0 && entry.title.length <= 160 &&
    typeof entry.source === "string" && entry.source.trim().length > 0 &&
    typeof entry.licence === "string" && entry.licence.trim().length > 0 &&
    ALLOWED_FORMATS.has(entry.format) &&
    typeof entry.objectKey === "string" &&
    /^[a-zA-Z0-9/_-]+\.(png|jpe?g|webp)$/i.test(entry.objectKey) &&
    (entry.fileSize === undefined || (Number.isInteger(entry.fileSize) && entry.fileSize > 0 && entry.fileSize <= MAX_IMAGE_BYTES))
  );
}

export function selectRandom(entries, randomValue) {
  if (!entries.length) return null;
  const value = Number.isFinite(randomValue) ? Math.min(Math.max(randomValue, 0), 0.999999999) : 0;
  return entries[Math.floor(value * entries.length)];
}

export function paginate(entries, page, limit) {
  const start = (page - 1) * limit;
  const items = entries.slice(start, start + limit);
  return { page, limit, total: entries.length, items, hasMore: start + items.length < entries.length };
}

function categoryFrom(url) {
  const value = url.searchParams.get("category");
  if (value === null || value === "all") return null;
  return value === "community" || value === "album" ? value : "invalid";
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
      } });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return responseJson({ error: "method_not_allowed" }, 405, origin, { allow: "GET, HEAD, OPTIONS" });
    }

    // Small per-client burst guard. Cloudflare's edge IP is not trusted unless
    // supplied by the platform; the platform Rate Limiting binding can be added
    // by operators for higher-traffic deployments.
    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    const minute = Math.floor(Date.now() / 60000);
    const key = "cover-art:" + minute + ":" + clientIp;
    const counts = globalThis.__coverArtCounts || (globalThis.__coverArtCounts = new Map());
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    if (counts.size > 5000) counts.clear();
    if (count > 120) return responseJson({ error: "rate_limited", message: "Please wait before trying again." }, 429, origin, { "retry-after": "60" });

    if (url.pathname === "/api/health") return responseJson({ ok: true, count: catalogue.artworks.length }, 200, origin);
    const category = categoryFrom(url);
    if (category === "invalid") return responseJson({ error: "invalid_category" }, 400, origin);
    const entries = entriesFor(category);

    if (url.pathname === "/api/random") {
      if (!entries.length) return responseJson({ error: "catalogue_empty", message: "No artwork is available in this category yet." }, 404, origin);
      const random = crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
      return responseJson({ artwork: publicEntry(selectRandom(entries, random), url.origin) }, 200, origin);
    }

    if (url.pathname === "/api/artworks") {
      const rawPage = url.searchParams.get("page") || "1";
      const rawLimit = url.searchParams.get("limit") || "12";
      if (!/^\d+$/.test(rawPage) || !/^\d+$/.test(rawLimit)) return responseJson({ error: "invalid_pagination" }, 400, origin);
      const page = Number(rawPage);
      const limit = Number(rawLimit);
      if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_SIZE_MAX) {
        return responseJson({ error: "invalid_pagination" }, 400, origin);
      }
      const result = paginate(entries, page, limit);
      result.items = result.items.map((entry) => publicEntry(entry, url.origin));
      return responseJson(result, 200, origin);
    }

    const match = url.pathname.match(/^\/api\/images\/([a-z0-9][a-z0-9_-]{0,79})$/);
    if (match) {
      const entry = entriesFor(null).find((item) => item.id === match[1]);
      if (!entry) return responseJson({ error: "image_not_found" }, 404, origin);
      const object = await env.ARTWORK_BUCKET.get(entry.objectKey);
      if (!object) return responseJson({ error: "image_not_found" }, 404, origin);
      if (object.size > MAX_IMAGE_BYTES) return responseJson({ error: "image_too_large" }, 413, origin);
      const headers = new Headers({
        "content-type": entry.format === "jpeg" ? "image/jpeg" : "image/" + entry.format,
        "content-length": String(object.size),
        "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
        "access-control-allow-origin": origin,
      });
      if (request.method === "HEAD") return new Response(null, { status: 200, headers });
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (bytes.length > MAX_IMAGE_BYTES) return responseJson({ error: "image_too_large" }, 413, origin);
      if (!validImageSignature(bytes, entry.format)) return responseJson({ error: "invalid_image_format" }, 415, origin);
      return new Response(bytes, { status: 200, headers });
    }

    return responseJson({ error: "not_found" }, 404, origin);
  },
};
