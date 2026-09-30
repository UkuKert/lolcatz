export interface Annotation {
  id: number;
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
}

/** The displayed image rectangle, including portions cropped by object-fit. */
export function imageFrame(width: number, height: number, naturalWidth: number, naturalHeight: number, fit: "cover" | "contain") {
  if (Math.min(width, height, naturalWidth, naturalHeight) <= 0) return null;
  const scale = (fit === "cover" ? Math.max : Math.min)(width / naturalWidth, height / naturalHeight);
  const imageWidth = naturalWidth * scale;
  const imageHeight = naturalHeight * scale;
  return { left: (width - imageWidth) / 2, top: (height - imageHeight) / 2, width: imageWidth, height: imageHeight };
}

export function annotationBox(bbox: Annotation["bbox"]) {
  if (bbox.length !== 4 || !bbox.every(Number.isFinite)) return null;
  const [x1, y1, x2, y2] = bbox.map(value => Math.max(0, Math.min(1, value)));
  if (x2 <= x1 || y2 <= y1) return null;
  return { left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` };
}
