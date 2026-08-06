"use client";

// A/B test tab: compares the two voice-entry variants across all time.

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { VoiceVariant } from "@/types/database";

interface VariantStats {
  variant: VoiceVariant;
  label: string;
  count: number;
  avgCorrections: number;
  zeroCorrectionsPct: number;
}

interface AbResult {
  stats?: VariantStats[];
  error?: string;
}

const VARIANT_LABELS: Record<VoiceVariant, string> = {
  waveform: "Waveform",
  live_transcript: "Live transcript",
};

async function fetchAbStats(): Promise<AbResult> {
  try {
    const { data, error } = await getSupabase()
      .from("tip_entries")
      .select("voice_variant, corrections_count")
      .eq("entry_method", "voice");
    if (error) throw new Error(error.message);

    const buckets = new Map<
      VoiceVariant,
      { count: number; corrections: number; zero: number }
    >();
    for (const row of data ?? []) {
      const variant = row.voice_variant;
      if (variant !== "waveform" && variant !== "live_transcript") continue;
      const bucket = buckets.get(variant) ?? {
        count: 0,
        corrections: 0,
        zero: 0,
      };
      bucket.count += 1;
      bucket.corrections += row.corrections_count;
      if (row.corrections_count === 0) bucket.zero += 1;
      buckets.set(variant, bucket);
    }

    const stats: VariantStats[] = (
      ["waveform", "live_transcript"] as const
    ).flatMap((variant) => {
      const bucket = buckets.get(variant);
      if (!bucket || bucket.count === 0) return [];
      return [
        {
          variant,
          label: VARIANT_LABELS[variant],
          count: bucket.count,
          avgCorrections: bucket.corrections / bucket.count,
          zeroCorrectionsPct: (bucket.zero / bucket.count) * 100,
        },
      ];
    });
    return { stats };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to load A/B stats.",
    };
  }
}

export default function AbTab() {
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<({ key: number } & AbResult) | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void fetchAbStats().then((r) => {
      if (!cancelled) setResult({ key: reload, ...r });
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const loading = result === null || result.key !== reload;

  if (loading) {
    return <p className="text-ink3 text-sm">Loading…</p>;
  }
  if (result.error) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-alert text-sm">{result.error}</p>
        <button
          type="button"
          onClick={() => setReload((n) => n + 1)}
          className="bg-card rounded-full px-4 py-2 text-sm font-semibold text-ink2"
        >
          Retry
        </button>
      </div>
    );
  }

  const stats = result.stats ?? [];
  if (stats.length === 0) {
    return (
      <div className="bg-card rounded-card p-5">
        <p className="text-ink2 text-sm">No voice entries yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {stats.map((s) => (
          <div key={s.variant} className="bg-card rounded-card p-5">
            <p className="section-label mb-1">Voice variant</p>
            <h2 className="text-lg font-bold text-ink mb-4">{s.label}</h2>
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <div>
                <p className="text-ink3 text-xs">Entries</p>
                <p className="text-ink font-semibold">{s.count}</p>
              </div>
              <div>
                <p className="text-ink3 text-xs">Avg corrections</p>
                <p className="text-ink font-semibold">
                  {s.avgCorrections.toFixed(1)}
                </p>
              </div>
              <div>
                <p className="text-ink3 text-xs">Zero corrections</p>
                <p className="text-ink font-semibold">
                  {Math.round(s.zeroCorrectionsPct)}%
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-ink3 text-sm">
        Lower average corrections = clearer feedback while speaking.
      </p>
    </div>
  );
}
