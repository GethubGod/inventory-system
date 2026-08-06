"use client";

// Variant A mic feedback: ~24 vertical bars showing a rolling window of
// recent input levels. The parent throttles level updates (~30fps); each new
// level shifts the window left by one bar.

import { useEffect, useRef, useState } from "react";

const BAR_COUNT = 24;
const HEIGHT = 46;
const MIN_BAR = 3;

export function Waveform({ level }: { level: number }) {
  const [bars, setBars] = useState<number[]>(() =>
    new Array<number>(BAR_COUNT).fill(0),
  );
  const lastPushRef = useRef(0);

  useEffect(() => {
    const now = performance.now();
    // Guard against faster-than-30fps parents; drop extra frames.
    if (now - lastPushRef.current < 30) return;
    lastPushRef.current = now;
    setBars((prev) => [...prev.slice(1), Math.max(0, Math.min(1, level))]);
  }, [level]);

  return (
    <div
      aria-hidden
      className="flex items-center gap-[2px] justify-end"
      style={{ height: HEIGHT }}
    >
      {bars.map((value, index) => (
        <span
          key={index}
          className="bg-accent rounded-full w-1"
          style={{ height: Math.max(MIN_BAR, Math.round(value * HEIGHT)) }}
        />
      ))}
    </div>
  );
}
