"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { annotationBox, imageFrame, type Annotation } from "../lib/annotations";

/** Overlay children use percentages of the oriented image, even when cropped. */
export function ImageSurface({ src, fallbackSrc, alt, fit = "contain", children, lazy = false }: {
  src: string; fallbackSrc?: string; alt: string; fit?: "cover" | "contain"; children?: ReactNode; lazy?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [frame, setFrame] = useState<ReturnType<typeof imageFrame>>(null);

  useEffect(() => {
    const element = viewport.current!;
    const img = image.current!;
    const measure = () => setFrame(imageFrame(element.clientWidth, element.clientHeight, img.naturalWidth, img.naturalHeight, fit));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    img.addEventListener("load", measure);
    measure();
    return () => { observer.disconnect(); img.removeEventListener("load", measure); };
  }, [src, fit]);

  return <div className="image-surface" ref={viewport}>
    <img ref={image} src={src} alt={alt} loading={lazy ? "lazy" : undefined} style={{ objectFit: fit }}
      onError={fallbackSrc ? event => {
        if (event.currentTarget.getAttribute("src") !== fallbackSrc) event.currentTarget.src = fallbackSrc;
      } : undefined} />
    {frame && <div className="image-overlay-slot" style={frame}>{children}</div>}
  </div>;
}

export function YoloOverlay({ annotations }: { annotations: Annotation[] }) {
  return <>{annotations.map(annotation => {
    const box = annotationBox(annotation.bbox);
    if (!box) return null;
    const label = `${annotation.label} ${Math.round(Math.max(0, Math.min(1, annotation.confidence)) * 100)}%`;
    return <div key={annotation.id} className="annotation-box" style={box}>
      <span className="annotation-label">{label}</span>
    </div>;
  })}</>;
}

export function AnnotatedImage({ src, srcSet, fallbackSrc, alt, annotations = [], href, className = "" }: {
  src: string; srcSet?: string; fallbackSrc?: string; alt: string; annotations?: Annotation[]; href?: string; className?: string;
}) {
  return <div className={`annotated-image ${className}`}>
    {href ? <Link className="card-media" href={href}>
      <img src={src} srcSet={srcSet} alt={alt} loading="lazy" onError={fallbackSrc ? event => {
        const image = event.currentTarget;
        if (image.getAttribute("src") === fallbackSrc) return;
        image.removeAttribute("srcset");
        image.src = fallbackSrc;
      } : undefined} />
    </Link> : <ImageSurface src={src} fallbackSrc={fallbackSrc} alt={alt}>
      <div className="hover-detections"><YoloOverlay annotations={annotations} /></div>
    </ImageSurface>}
  </div>;
}
