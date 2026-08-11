"use client";

// In-page QR scanner so a phone that already has the site open can scan the
// register sticker without leaving for the camera app. Uses the native
// BarcodeDetector where it exists (Chrome/Android) and falls back to jsQR
// frame-decoding (iOS Safari). Accepts only Babytuna entry stickers — a QR
// whose URL carries the ?t= entry token — and hands the token back.

import { useCallback, useEffect, useRef, useState } from "react";

/** Extract the entry token from a scanned QR payload, or null. */
export function tokenFromScan(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    const token = url.searchParams.get("t");
    return token && token.length >= 16 ? token : null;
  } catch {
    // Not a URL — tolerate a bare token (e.g. a re-printed sticker).
    return /^[A-Za-z0-9_-]{16,128}$/.test(text) ? text : null;
  }
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: {
      formats?: string[];
    }) => BarcodeDetectorLike;
  }
}

const SCAN_INTERVAL_MS = 180;

export function QrScanner({
  onToken,
  onClose,
}: {
  onToken: (token: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const doneRef = useRef(false);
  const [cameraError, setCameraError] = useState(false);
  const [wrongCode, setWrongCode] = useState(false);

  const handleToken = useCallback(
    (token: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      onToken(token);
    },
    [onToken],
  );

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let jsqr: ((data: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null =
      null;

    const detector = window.BarcodeDetector
      ? new window.BarcodeDetector({ formats: ["qr_code"] })
      : null;

    const handleDecoded = (raw: string) => {
      const token = tokenFromScan(raw);
      if (token) handleToken(token);
      else setWrongCode(true);
    };

    const scanFrame = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || doneRef.current || cancelled) return;
      if (detector) {
        try {
          const codes = await detector.detect(video);
          // Re-check after the await: Cancel may have unmounted us while the
          // detector held a decode in flight.
          if (cancelled || doneRef.current) return;
          const raw = codes[0]?.rawValue;
          if (raw) handleDecoded(raw);
        } catch {
          // Detector hiccup on a single frame; keep scanning.
        }
        return;
      }
      if (!jsqr) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Downscale for decode speed; QR finder patterns survive it fine.
      const scale = Math.min(1, 640 / video.videoWidth || 1);
      canvas.width = Math.floor(video.videoWidth * scale);
      canvas.height = Math.floor(video.videoHeight * scale);
      if (canvas.width === 0 || canvas.height === 0) return;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsqr(image.data, image.width, image.height);
      if (code?.data) handleDecoded(code.data);
    };

    const start = async () => {
      if (!detector) {
        const mod = await import("jsqr");
        jsqr = (data, w, h) => mod.default(data, w, h);
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      // Cleanup may have run while play() was pending — don't start a timer
      // it can no longer clear.
      if (cancelled) return;
      timer = setInterval(() => void scanFrame(), SCAN_INTERVAL_MS);
    };

    start().catch(() => {
      // Release the camera immediately — the error screen keeps the
      // component mounted, so effect cleanup alone would leave it live.
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (!cancelled) setCameraError(true);
    });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [handleToken]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {cameraError ? (
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5">
          <div className="rounded-card bg-card p-5 text-center">
            <p className="font-bold text-ink">Can&rsquo;t use the camera</p>
            <p className="mt-2 text-ink2">
              Allow camera access for this site, or scan the sticker with your
              phone&rsquo;s camera app instead.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 w-full rounded-full bg-card py-4 font-semibold text-ink active:bg-well"
          >
            Close
          </button>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />
          {/* Scan frame */}
          <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-14">
            <p className="text-center text-lg font-semibold text-white">
              Point at the sticker
            </p>
            <div className="flex flex-1 items-center justify-center">
              <div className="h-56 w-56 rounded-3xl border-4 border-white/80" />
            </div>
            {wrongCode && (
              <p className="mb-4 text-center text-sm font-medium text-white/90">
                That code isn&rsquo;t a Babytuna sticker — try the one by the
                register.
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-full bg-white/95 py-4 font-semibold text-ink active:bg-white"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
