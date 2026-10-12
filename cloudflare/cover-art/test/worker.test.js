import test from "node:test";
import assert from "node:assert/strict";
import worker, { entriesFor, paginate, selectRandom } from "../src/index.js";

const env = { ALLOWED_ORIGIN: "*", ARTWORK_BUCKET: { get: async () => null } };

test("health endpoint reports an empty sample catalogue", async () => {
  const response = await worker.fetch(new Request("https://worker.test/api/health"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, count: 0 });
});

test("random endpoint handles empty categories", async () => {
  const response = await worker.fetch(new Request("https://worker.test/api/random?category=community"), env);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "catalogue_empty");
});

test("invalid category and pagination are rejected", async () => {
  assert.equal((await worker.fetch(new Request("https://worker.test/api/artworks?category=other"), env)).status, 400);
  assert.equal((await worker.fetch(new Request("https://worker.test/api/artworks?page=0"), env)).status, 400);
  assert.equal((await worker.fetch(new Request("https://worker.test/api/artworks?limit=31"), env)).status, 400);
});

test("unknown image IDs and missing R2 objects return 404", async () => {
  assert.equal((await worker.fetch(new Request("https://worker.test/api/images/../secret"), env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://worker.test/api/images/not-listed"), env)).status, 404);
});

test("unsupported methods are rejected", async () => {
  assert.equal((await worker.fetch(new Request("https://worker.test/api/random", { method: "POST" }), env)).status, 405);
});

const fixture = [
  { id: "community-a", title: "Community A", source: "Test fixture", licence: "Test permission", category: "community", format: "png", objectKey: "community/a.png", redistributionAllowed: true },
  { id: "album-a", title: "Album A", source: "Test fixture", licence: "Test permission", category: "album", format: "jpeg", objectKey: "album/a.jpg", redistributionAllowed: true },
  { id: "community-b", title: "Community B", source: "Test fixture", licence: "Test permission", category: "community", format: "webp", objectKey: "community/b.webp", redistributionAllowed: true },
];

test("category filtering only returns permitted entries in the requested category", () => {
  assert.deepEqual(entriesFor("community", fixture).map((entry) => entry.id), ["community-a", "community-b"]);
  assert.deepEqual(entriesFor("album", fixture).map((entry) => entry.id), ["album-a"]);
  assert.equal(entriesFor(null, fixture).length, 3);
});

test("random selection chooses a stable index and handles empty catalogues", () => {
  assert.equal(selectRandom(fixture, 0).id, "community-a");
  assert.equal(selectRandom(fixture, 0.5).id, "album-a");
  assert.equal(selectRandom(fixture, 0.999).id, "community-b");
  assert.equal(selectRandom([], 0.5), null);
});

test("pagination returns bounded slices and correct hasMore metadata", () => {
  assert.deepEqual(paginate(fixture, 1, 2), {
    page: 1, limit: 2, total: 3, items: fixture.slice(0, 2), hasMore: true,
  });
  assert.deepEqual(paginate(fixture, 2, 2), {
    page: 2, limit: 2, total: 3, items: fixture.slice(2), hasMore: false,
  });
});

test("image endpoint rejects oversized R2 objects and invalid image signatures", async () => {
  const listed = fixture[0];
  const oversizedEnv = { ...env, ARTWORK_BUCKET: { get: async () => ({ size: 15 * 1024 * 1024 + 1 }) } };
  const tooLarge = await worker.fetch(new Request("https://worker.test/api/images/" + listed.id), oversizedEnv);
  assert.equal(tooLarge.status, 413);

  const invalidEnv = { ...env, ARTWORK_BUCKET: { get: async () => ({
    size: 4,
    arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
  }) } };
  const invalid = await worker.fetch(new Request("https://worker.test/api/images/" + listed.id), invalidEnv);
  assert.equal(invalid.status, 415);
});
