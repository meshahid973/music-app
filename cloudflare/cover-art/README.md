# Resonance Community Cover Art Worker

This Worker serves a read-only artwork catalogue and images from a **private** R2 bucket. It does not accept public uploads, scrape sites, or assume that artwork visible online can be redistributed.

## Deploy

1. Create a free Cloudflare account at https://dash.cloudflare.com/ and create an R2 bucket named `resonance-cover-art` (or change `bucket_name` in `wrangler.toml`). Keep the bucket private; do not enable public R2 access.
2. Install Node.js 22+ and run `npm install` in this directory.
3. Validate and update `catalog.json` using the schema in `catalog.schema.json`. The committed catalogue is intentionally empty because this repository has no verified redistributable artwork.
4. Upload each approved image to the exact `objectKey` listed in the catalogue. For example, with Wrangler installed and authenticated: `npx wrangler r2 object put resonance-cover-art/community/my-art.png --file ./approved/my-art.png --content-type image/png`. Use a unique, stable ID and an object key containing only letters, numbers, slash, underscore, and hyphen.
5. From this directory, run `npx wrangler deploy`. Wrangler creates a free `*.workers.dev` URL; no custom domain is required. The bucket remains private and is read through the Worker binding.
6. Set `VITE_COVER_ART_API_URL=https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev` in the app's build environment. For local frontend development, put it in a root `.env.local` file (never add credentials there). Restart Vite after changing it. Leave unset to show a helpful not-configured state.

## Catalogue rules and licensing

Categories are `community` (original community artwork) and `album` (album artwork submitted/sourced with documented redistribution permission). Required metadata: `id`, `title`, `category`, `objectKey`, `format`, `source`, `licence`, and `redistributionAllowed: true`. Optional fields include creator, artist, dimensions, file size, attribution flag, and attribution text. Keep provenance exact: do not use a permissive licence label unless the licence/source explicitly grants redistribution. For album artwork, retain proof of permission and attribution details in your project records before adding an entry. Do not commit those records if they contain private information.

Example (metadata only; no sample image or fake creator/licence claim):

```json
{
  "id": "sample-community-cover",
  "title": "Replace with approved artwork title",
  "creator": "Creator name supplied by the contributor",
  "category": "community",
  "objectKey": "community/sample-community-cover.png",
  "format": "png",
  "width": 1200,
  "height": 1200,
  "fileSize": 240000,
  "source": "Original submission; record the actual submission source",
  "licence": "Exact licence or written permission reference",
  "attributionRequired": true,
  "attribution": "Exact required credit, if any",
  "redistributionAllowed": true
}
```

The Worker catalogue is bundled into the deployment. After editing it, deploy again. Images are stored only in R2; no large binaries belong in Git.

## API

- `GET /api/health` — status and raw catalogue count.
- `GET /api/random?category=community|album` — random permitted entry.
- `GET /api/artworks?page=1&limit=12&category=community|album` — paginated catalogue (maximum 30 entries/page); omit category or use `all` for both.
- `GET /api/images/{id}` — original image bytes, served with image content type and immutable caching.
- `HEAD /api/images/{id}` — image headers only.

Invalid categories/pagination and unknown IDs return JSON errors. Images are limited to 15 MiB. The Worker has a lightweight per-isolate burst guard; configure Cloudflare's platform-level rate limiting rules if you need stronger cross-isolate enforcement. CORS is permissive for this read-only API by default; set `ALLOWED_ORIGIN` to a precise app web origin where practical.

## Local test

`npm test` exercises catalogue filtering, pagination, random selection, invalid requests, and missing objects with a mocked R2 binding. `npm run dev` starts Wrangler's local Worker. Confirm the bucket binding and catalogue before expecting any images.
