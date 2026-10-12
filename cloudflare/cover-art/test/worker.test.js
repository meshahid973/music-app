import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const original = await import("../catalog.json", { with: { type: "json" } });
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
