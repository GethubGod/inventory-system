import { classifyQuickOrderInput } from './input-classifier.ts';
import type { QuickOrderModelUsed } from './types.ts';

export type QuickOrderModelConfig = {
  defaultModel: string;
  fallbackModel: string;
  advancedModel: string;
  liveModel: string;
  advancedEnabled: boolean;
};

export type ModelRoute = {
  mode: 'deterministic' | 'fallback' | 'advanced' | 'live';
  model: string | null;
  modelUsed: QuickOrderModelUsed;
  allowLlmFallback: boolean;
  reason: string;
};

const SIMPLE_ORDER_PATTERN =
  /^\s*(?:add\s+|remove\s+|change\s+|update\s+|set\s+|make\s+)?[\p{L}\p{N}'() -]+\s+(?:\d+(?:\.\d+)?|\.\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*[a-zA-Z]+\s*$/iu;

const COMPLEX_PLANNING_PATTERNS = [
  /\bbuild\b.+\border\b/i,
  /\btomorrow(?:'s)? order\b/i,
  /\bcompare\b.+\blast\b/i,
  /\bbased on current stock\b/i,
  /\bbased on current quantities\b/i,
  /\bsupplier rules?\b/i,
  /\bsales\b/i,
  /\bforecast\b/i,
];

export function getModelConfig(env: { get(key: string): string | undefined }): QuickOrderModelConfig {
  return {
    defaultModel: env.get('QUICK_ORDER_DEFAULT_MODEL') ?? 'gemini-2.5-flash',
    fallbackModel: env.get('QUICK_ORDER_FALLBACK_MODEL') ?? 'gemini-2.5-flash',
    advancedModel: env.get('QUICK_ORDER_ADVANCED_MODEL') ?? 'gemini-3.1-pro',
    liveModel: env.get('QUICK_ORDER_LIVE_MODEL') ?? 'gemini-live',
    advancedEnabled: (env.get('ENABLE_QUICK_ORDER_ADVANCED_MODEL_ROUTING') ?? 'true') !== 'false',
  };
}

export function routeQuickOrderModel(input: {
  message: string;
  source: 'typed' | 'voice';
  config: QuickOrderModelConfig;
}): ModelRoute {
  const classification = classifyQuickOrderInput(input.message);
  const normalized = classification.normalizedText;

  if (input.source === 'voice' && /\blive\b/i.test(input.config.liveModel)) {
    // Transcript-first voice still sends text to the backend. The Live model is
    // reserved for a future audio layer and must not own cart mutation.
  }

  if (COMPLEX_PLANNING_PATTERNS.some((pattern) => pattern.test(input.message)) && input.config.advancedEnabled) {
    return {
      mode: 'advanced',
      model: input.config.advancedModel,
      modelUsed: normalizeModelUsed(input.config.advancedModel),
      allowLlmFallback: true,
      reason: 'complex_planning',
    };
  }

  if (
    classification.classification === 'tutorial_request' ||
    classification.classification === 'recommend_order_request' ||
    classification.classification === 'mixed_stock_and_recommendation_request'
  ) {
    return {
      mode: 'deterministic',
      model: null,
      modelUsed: 'none',
      allowLlmFallback: false,
      reason: 'deterministic_recommendation_v1',
    };
  }

  if (SIMPLE_ORDER_PATTERN.test(normalized)) {
    return {
      mode: 'deterministic',
      model: null,
      modelUsed: 'none',
      // The orchestrator still runs deterministic first and only invokes the
      // callback for unresolved lines, so exact simple inputs use no model while
      // typo-like simple inputs can still be repaired.
      allowLlmFallback: true,
      reason: 'simple_exact_order',
    };
  }

  return {
    mode: 'fallback',
    model: input.config.fallbackModel || input.config.defaultModel,
    modelUsed: normalizeModelUsed(input.config.fallbackModel || input.config.defaultModel),
    allowLlmFallback: true,
    reason: 'fallback_allowed_for_messy_language',
  };
}

export function normalizeModelUsed(model: string | null | undefined): QuickOrderModelUsed {
  if (!model) return 'none';
  if (model === 'gemini-2.5-flash') return 'gemini-2.5-flash';
  if (model === 'gemini-3.1-pro' || model === 'gemini-3.1-flash') return 'gemini-3.1-pro';
  return 'other';
}
