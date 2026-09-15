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

const ROTATION_INTERVAL_MS = 4000;

export function Tagline() {
  const [taglineIndex, setTaglineIndex] = useState(0);

  useEffect(() => {
    // Randomize after hydration so the server and browser initially agree.
    setTaglineIndex(Math.floor(Math.random() * taglines.length));

    const interval = window.setInterval(() => {
      setTaglineIndex(currentIndex => {
        const offset = 1 + Math.floor(Math.random() * (taglines.length - 1));
        return (currentIndex + offset) % taglines.length;
      });
    }, ROTATION_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, []);

  return <span className="tagline">{taglines[taglineIndex]}</span>;
}
