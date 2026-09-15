export interface ImageMetadata {
  width?: number;
  height?: number;
  orientation?: number;
  camera_make?: string;
  camera_model?: string;
  lens_model?: string;
  software?: string;
  taken_at?: string;
  timezone?: string;
  exposure_seconds?: number;
  f_number?: number;
  iso?: number;
  focal_length_mm?: number;
  gps?: {
    latitude: number;
    longitude: number;
    altitude_m?: number;
  };
  ocr_text?: string;
  ocr_language?: string;
  ocr_status?: string;
}

export function MapLink({ metadata }: { metadata?: ImageMetadata }) {
  const gps = metadata?.gps;
  if (!gps) return null;
  const coordinates = `${gps.latitude},${gps.longitude}`;

  return (
    <a
      className="map-badge"
      href={`https://www.google.com/maps?q=${encodeURIComponent(coordinates)}`}
      target="_blank"
      rel="noreferrer"
      title={`Open photo location (${coordinates}) in Google Maps`}
      aria-label="Open photo location in Google Maps"
    >
      📍 Map
    </a>
  );
}

function exposureLabel(seconds: number) {
  if (seconds > 0 && seconds < 1) return `1/${Math.round(1 / seconds)}s`;
  return `${seconds}s`;
}

export function MetadataDetails({ metadata }: { metadata?: ImageMetadata }) {
  if (!metadata || Object.keys(metadata).length === 0) return null;

  const camera = [metadata.camera_make, metadata.camera_model]
    .filter(Boolean)
    .filter((value, index, values) => index === 0 || value !== values[0])
    .join(" ");
  const exposure = [
    metadata.exposure_seconds ? exposureLabel(metadata.exposure_seconds) : "",
    metadata.f_number ? `ƒ/${metadata.f_number}` : "",
    metadata.iso ? `ISO ${metadata.iso}` : "",
    metadata.focal_length_mm ? `${metadata.focal_length_mm} mm` : "",
  ].filter(Boolean).join(" · ");

  const rows = [
    ["Taken", [metadata.taken_at, metadata.timezone].filter(Boolean).join(" ")],
    ["Camera", camera],
    ["Lens", metadata.lens_model],
    ["Exposure", exposure],
    ["Dimensions", metadata.width && metadata.height ? `${metadata.width} × ${metadata.height}` : ""],
    ["Software", metadata.software],
    ["Altitude", metadata.gps?.altitude_m !== undefined ? `${metadata.gps.altitude_m} m` : ""],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  if (!rows.length && !metadata.gps && !metadata.ocr_text && !metadata.ocr_status && !metadata.ocr_language) return null;
  return (
    <details className="exif-details">
      <summary>Photo details</summary>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <MapLink metadata={metadata} />
      {(metadata.ocr_status === "complete" || metadata.ocr_language) && <div className="ocr-text"><strong>OCR caption</strong><pre>{metadata.ocr_text || "No caption detected"}</pre></div>}
    </details>
  );
}
