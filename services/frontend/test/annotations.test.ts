import assert from "node:assert/strict";
import { test } from "node:test";
import { annotationBox, imageFrame } from "../lib/annotations";

test("overlays follow centered cover crops for portrait and landscape images", () => {
  assert.deepEqual(imageFrame(400, 300, 200, 400, "cover"), { left: 0, top: -250, width: 400, height: 800 });
  assert.deepEqual(imageFrame(400, 300, 800, 400, "cover"), { left: -100, top: 0, width: 600, height: 300 });
});

test("contain overlays exclude letterboxing and scale with the image", () => {
  assert.deepEqual(imageFrame(400, 300, 200, 400, "contain"), { left: 125, top: 0, width: 150, height: 300 });
  assert.deepEqual(imageFrame(200, 150, 200, 400, "contain"), { left: 62.5, top: 0, width: 75, height: 150 });
  assert.equal(imageFrame(400, 300, 0, 0, "cover"), null);
});

test("boxes clamp out-of-image coordinates and reject empty or invalid bounds", () => {
  assert.deepEqual(annotationBox([-0.1, 0.25, 1.2, 0.75]), { left: "0%", top: "25%", width: "100%", height: "50%" });
  assert.equal(annotationBox([0.9, 0, 0.2, 1]), null);
  assert.equal(annotationBox([0, 0, 0, 1]), null);
  assert.equal(annotationBox([NaN, 0, 1, 1]), null);
});
