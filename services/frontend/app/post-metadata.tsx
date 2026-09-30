import Link from "next/link";
import { TimeStamp } from "../lib/time";

export interface ExifInfo {
  camera_make?: string | null;
  camera_model?: string | null;
  lens_model?: string | null;
  software?: string | null;
  width?: number | null;
  height?: number | null;
  iso?: number | null;
  f_number?: number | null;
  exposure_seconds?: number | null;
  focal_length_mm?: number | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  gps_altitude_m?: number | null;
  producer_version: string;
}

export interface OCRInfo {
  text: string;
  language?: string | null;
  producer_version: string;
}

export interface Tag {
  name: string;
  confidence: number;
}

export function MapLink({ exif }: { exif?: ExifInfo | null }) {
  if (exif?.gps_latitude == null || exif?.gps_longitude == null) return null;
  const coordinates = `${exif.gps_latitude},${exif.gps_longitude}`;

  const latitude = exif.gps_latitude;
  const longitude = exif.gps_longitude;
  const delta = 0.004;
  const bbox = `${longitude - delta},${latitude - delta},${longitude + delta},${latitude + delta}`;
  const marker = `${latitude},${longitude}`;
  return <div className="location-map">
    <iframe
      title={`OpenStreetMap location ${coordinates}`}
      loading="lazy"
      src={`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(marker)}`}
    />
    <a className="map-badge" href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`}
       target="_blank" rel="noreferrer" title={`Open location (${coordinates}) in OpenStreetMap`}>
      📍 Open in OpenStreetMap
    </a>
  </div>;
}

function exposureLabel(seconds: number) {
  if (seconds > 0 && seconds < 1) return `1/${Math.round(1 / seconds)}s`;
  return `${seconds}s`;
}

interface DetailsProps {
  tags?: Tag[];
  exif?: ExifInfo | null;
  ocr?: OCRInfo | null;
  capturedAt?: string | null;
  compact?: boolean;
  showMap?: boolean;
}

// Cards show all tags; full photo metadata belongs on the thread.
export function PostDetails({ tags, exif, ocr, capturedAt, compact = false, showMap = false }: DetailsProps) {
  const camera = [exif?.camera_make, exif?.camera_model]
    .filter(Boolean)
    .filter((value, index, values) => index === 0 || value !== values[0])
    .join(" ");

  const exposure = [
    exif?.exposure_seconds ? exposureLabel(exif.exposure_seconds) : "",
    exif?.f_number ? `ƒ/${exif.f_number}` : "",
    exif?.iso ? `ISO ${exif.iso}` : "",
    exif?.focal_length_mm ? `${exif.focal_length_mm} mm` : "",
  ].filter(Boolean).join(" · ");

  const rows: [string, string][] = ([
    ["Camera", camera],
    ["Lens", exif?.lens_model ?? ""],
    ["Exposure", exposure],
    ["Dimensions", exif?.width && exif?.height ? `${exif.width} × ${exif.height}` : ""],
    ["Software", exif?.software ?? ""],
    ["Altitude", exif?.gps_altitude_m != null ? `${Math.round(exif.gps_altitude_m)} m` : ""],
  ] as [string, string][]).filter(row => Boolean(row[1]));

  const hasTags = Boolean(tags?.length);
  const hasOCR = Boolean(ocr?.text);
  const hasExif = rows.length > 0 || Boolean(capturedAt) || exif?.gps_latitude != null;

  const displayedTags = tags ?? [];
  const tagSection = (
    <div className="disclosure-section tags-section">
      {!hasTags && <span className="tag-status">no tags</span>}
      <div className="tags">
        {displayedTags.map(tag => (
          <Link className="tag-badge" key={tag.name} href={`/search?tag=${encodeURIComponent(tag.name)}`}
             style={{ "--tag-confidence": String(Math.max(0, Math.min(1, tag.confidence))) } as React.CSSProperties}
             title={`${Math.round(tag.confidence * 100)}% confidence`}>
            {tag.name}
          </Link>
        ))}
      </div>
    </div>
  );

  if (compact || (!hasExif && !hasOCR)) return tagSection;

  return (
    <>
      {tagSection}
      <section className="post-details">
        <div className="disclosure-body">

        {hasExif && (
          <div className="disclosure-section">
            <span className="disclosure-label">Photo details</span>
            <dl className="exif-grid">
              {capturedAt && (
                <>
                  <dt>Taken</dt>
                  <dd><TimeStamp value={capturedAt} naive /></dd>
                </>
              )}
              {rows.map(([label, value]) => (
                <div key={label} style={{ display: "contents" }}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {showMap && <MapLink exif={exif} />}
          </div>
        )}

        {hasOCR && (
          <div className="disclosure-section">
            <span className="disclosure-label">
              Caption{ocr?.language ? ` (${ocr.language})` : ""}
            </span>
            <p className="ocr-text">{ocr!.text}</p>
          </div>
        )}
        </div>
      </section>
    </>
  );
}
