"use client";

import { useEffect, useState } from "react";

const taglines = [
  "Enterprise-Grade Shitposting",
  "Highly Available Bad Opinions",
  "Now With 99.99% Opinion Availability",
  "Cloud-Native Catastrophes at Scale",
  "Autoscaling Your Terrible Takes",
  "Zero-Downtime Drama Deployment",
  "Kubernetes: Because One Server Was Too Easy",
  "Your Memes, Now Horizontally Scaled",
  "Eventually Consistent With Reality",
  "Production-Ready Since Last Tuesday",
  "No Thoughts, Just Pods",
  "Deploying Hot Takes to Production",
  "Certified YAML Enjoyers",
  "Please Do Not Feed the Containers",
  "The Control Plane Has Left the Chat",
];

const ROTATION_INTERVAL_MS = 10 * 60 * 1000;

export function Tagline() {
  const [taglineIndex, setTaglineIndex] = useState(0);

  useEffect(() => {
    // Time buckets keep the same headline across navigation, reloads and tabs.
    const update = () => setTaglineIndex(Math.floor(Date.now() / ROTATION_INTERVAL_MS) % taglines.length);
    update();
    const interval = window.setInterval(update, 1000);

    return () => window.clearInterval(interval);
  }, []);

  return <span className="tagline">{taglines[taglineIndex]}</span>;
}
