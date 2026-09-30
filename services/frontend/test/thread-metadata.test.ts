import assert from "node:assert/strict";
import { test } from "node:test";
import { threadMetadata } from "../lib/thread-metadata";

const image = {
  id: "example-id", title: "Baking in an epic thread", filename: "photo.jpg",
  board: "ck", author: "Lauri", tags: [{ name: "pizza" }, { name: "oven" }],
  ocr: { text: "" },
};
const config = { browseURL: "http://browse:8080/", siteURL: "https://board.example.test" };

test("thread preview uses public absolute URLs and image-specific metadata", async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "http://browse:8080/api/browse/images/example-id");
    assert.equal(init?.cache, "no-store");
    return Response.json({ image });
  };
  const metadata = await threadMetadata(image.id, { ...config, fetcher });
  assert.equal(metadata.title, image.title);
  assert.equal(metadata.description, "Posted by Lauri in /ck/ · pizza, oven");
  assert.equal(metadata.openGraph?.url, "https://board.example.test/thread/example-id");
  assert.deepEqual(metadata.openGraph?.images, [{
    url: "https://board.example.test/api/thumbnails/v1/example-id?size=256", alt: image.title,
  }]);
  assert.equal((metadata.twitter as { card: string }).card, "summary_large_image");
});

test("preview prefers OCR, normalizes whitespace and bounds descriptions", async () => {
  const metadata = await threadMetadata(image.id, {
    ...config,
    fetcher: async () => Response.json({ image: { ...image, title: " ", ocr: { text: " hello\n world " + "x".repeat(300) } } }),
  });
  assert.equal(metadata.title, "photo.jpg");
  assert.ok(metadata.description?.startsWith("hello world "));
  assert.equal(metadata.description?.length, 240);
});

test("missing images and unavailable backends retain the generic page metadata", async () => {
  for (const fetcher of [
    async () => new Response(null, { status: 404 }),
    async () => new Response(null, { status: 503 }),
    async () => { throw new DOMException("timeout", "TimeoutError"); },
    async () => Response.json({ image: { ...image, id: "wrong-image" } }),
  ]) {
    const metadata = await threadMetadata(image.id, { ...config, fetcher });
    assert.equal(metadata.title, "Can I Haz Kubernetes");
    assert.equal(metadata.openGraph, undefined);
  }
});

test("preview does not disguise programming or malformed response errors", async () => {
  await assert.rejects(threadMetadata(image.id, { ...config, fetcher: async () => { throw new TypeError("bug"); } }), /bug/);
  await assert.rejects(threadMetadata(image.id, { ...config, fetcher: async () => Response.json({ image: { ...image, tags: {} } }) }), TypeError);
});
