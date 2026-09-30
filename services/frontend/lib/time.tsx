"use client";

import { useEffect, useState } from "react";
import { Clock, usePreferences } from "./preferences";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function parseTimestamp(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function relative(then: Date, now: number) {
  const elapsed = now - then.getTime();
  if (elapsed < 0) return "just now";
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (elapsed < WEEK) {
    const days = Math.floor(elapsed / DAY);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }
  return null;
}

export function absolute(then: Date, clock: Clock, naive = false) {
  // EXIF records a wall clock with no zone, which the exif service stores as if
  // it were UTC. Rendering it in local time would shift it by the viewer's
  // offset and invent an accuracy the camera never recorded, so a naive value
  // is always read back in UTC to recover the original reading.
  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: naive || clock === "utc" ? "UTC" : undefined,
  }).format(then);

  if (naive) return `${formatted} (camera clock)`;
  return clock === "utc" ? `${formatted} UTC` : formatted;
}

interface TimeStampProps {
  value?: string | null;
  /** EXIF wall-clock values, which must not be shifted into the local zone. */
  naive?: boolean;
}

/**
 * Shows "3 hours ago" and reveals the full timestamp on hover or tap. Anything
 * older than a week is shown as an absolute date to begin with.
 */
export function TimeStamp({ value, naive = false }: TimeStampProps) {
  const { clock } = usePreferences();
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(timer);
  }, []);

  const parsed = parseTimestamp(value);
  if (!parsed) return null;

  const full = absolute(parsed, clock, naive);
  const short = relative(parsed, now);
  const showFull = expanded || short === null;

  return (
    <time
      className="timestamp"
      dateTime={parsed.toISOString()}
      title={full}
      role="button"
      tabIndex={0}
      aria-label={full}
      onClick={() => setExpanded(current => !current)}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setExpanded(current => !current);
        }
      }}
      suppressHydrationWarning
    >
      {showFull ? full : short}
    </time>
  );
}
