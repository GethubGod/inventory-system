import { useCallback, useState } from 'react';

/**
 * Fixed-length rolling buffer of normalized (0..1) audio amplitudes.
 *
 * Each `pushAmplitude` drops the oldest value (index 0) and appends the newest
 * at the end, so a renderer reading the array left-to-right shows oldest →
 * newest. New sound therefore appears on the right and scrolls leftward.
 */
export function useAmplitudeBuffer(size = 65) {
  const [amplitudes, setAmplitudes] = useState<number[]>(
    () => new Array(size).fill(0),
  );

  const pushAmplitude = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    setAmplitudes((prev) => [...prev.slice(1), clamped]);
  }, []);

  const reset = useCallback(() => {
    setAmplitudes(new Array(size).fill(0));
  }, [size]);

  return { amplitudes, pushAmplitude, reset };
}
