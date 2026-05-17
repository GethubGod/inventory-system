import type { QuickOrderTimings } from './types.ts';

type TimingMark =
  | 'auth'
  | 'context_load'
  | 'deterministic_parse'
  | 'catalog_match'
  | 'safety_validation'
  | 'llm_fallback'
  | 'recommendation_engine'
  | 'db_write'
  | 'response_build';

const TIMING_KEYS: Record<TimingMark, keyof QuickOrderTimings> = {
  auth: 'auth_ms',
  context_load: 'context_load_ms',
  deterministic_parse: 'deterministic_parse_ms',
  catalog_match: 'catalog_match_ms',
  safety_validation: 'safety_validation_ms',
  llm_fallback: 'llm_fallback_ms',
  recommendation_engine: 'recommendation_engine_ms',
  db_write: 'db_write_ms',
  response_build: 'response_build_ms',
};

export class QuickOrderTimer {
  private readonly start = Date.now();
  private readonly timings: QuickOrderTimings = { total_ms: 0 };

  measure<T>(mark: TimingMark, fn: () => T): T {
    const started = Date.now();
    try {
      return fn();
    } finally {
      this.add(mark, Date.now() - started);
    }
  }

  async measureAsync<T>(mark: TimingMark, fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      this.add(mark, Date.now() - started);
    }
  }

  add(mark: TimingMark, ms: number): void {
    const key = TIMING_KEYS[mark];
    this.timings[key] = (this.timings[key] ?? 0) + Math.max(0, ms);
  }

  snapshot(): QuickOrderTimings {
    return {
      ...this.timings,
      total_ms: Date.now() - this.start,
    };
  }
}
