"use client";

// Small copy-to-clipboard pill with transient "Copied" feedback.

import { useEffect, useRef, useState } from "react";

export default function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. non-secure context) — leave label as-is.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold ${
        copied ? "bg-tint text-accent" : "bg-accent text-white"
      }`}
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
