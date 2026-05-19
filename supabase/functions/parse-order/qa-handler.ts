// Q&A handler for product-related questions from Quick Order users.
// Calls Gemini 2.5 Flash with a compact prompt and aggressive token cap to keep
// answers short, on-topic, and cheap. Includes an in-memory rate limiter so a
// single user (or runaway client) can't burn the LLM budget with question spam.

declare const Deno: {
  env: { get(key: string): string | undefined };
};

function getEnv(key: string): string | undefined {
  if (typeof Deno !== 'undefined' && Deno?.env?.get) {
    return Deno.env.get(key);
  }
  return undefined;
}

const QA_DEFAULT_MODEL = 'gemini-2.5-flash';
const QA_TIMEOUT_MS = 8000;
const QA_MAX_OUTPUT_TOKENS = 300;
const QA_TEMPERATURE = 0.2;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_USER = 10;
const GLOBAL_RATE_LIMIT_MAX = 200;

type RateBucket = { count: number; windowStart: number };

const userRateBuckets = new Map<string, RateBucket>();
let globalRateBucket: RateBucket = { count: 0, windowStart: Date.now() };

export type QaContextProduct = {
  name: string;
  units: string[];
};

export interface QaContext {
  userInput: string;
  cartItems: QaContextProduct[];
  recentMatches: QaContextProduct[];
  catalogSnippet?: string;
  userId?: string | null;
}

export type QaResult = {
  status: 'qa_answer';
  assistantMessage: string;
  modelUsed: string;
  tokensUsed?: number;
};

function checkRateLimit(userId: string | null | undefined): boolean {
  const now = Date.now();
  if (now - globalRateBucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    globalRateBucket = { count: 0, windowStart: now };
  }
  if (globalRateBucket.count >= GLOBAL_RATE_LIMIT_MAX) return false;

  const key = userId && userId.length > 0 ? userId : '__anon__';
  const bucket = userRateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    userRateBuckets.set(key, { count: 1, windowStart: now });
    globalRateBucket.count += 1;
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX_PER_USER) return false;
  bucket.count += 1;
  globalRateBucket.count += 1;
  return true;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(ctx: QaContext): string {
  const lines: string[] = [];
  lines.push('You answer short questions about seafood products in our catalog. Keep answers under 2 sentences. Use markdown bold (**text**) for product names and units. If the catalog context doesn\'t have the answer, say "I don\'t have that info — try asking your supplier." Do not invent products or units.');
  lines.push('');

  if (ctx.cartItems.length > 0) {
    lines.push('Items currently in cart:');
    for (const item of ctx.cartItems.slice(0, 20)) {
      const units = item.units.length > 0 ? item.units.join(', ') : 'unknown units';
      lines.push(`- ${item.name} (units: ${units})`);
    }
    lines.push('');
  }

  if (ctx.recentMatches.length > 0) {
    lines.push('Recently mentioned catalog items:');
    for (const item of ctx.recentMatches.slice(0, 20)) {
      const units = item.units.length > 0 ? item.units.join(', ') : 'unknown units';
      lines.push(`- ${item.name} (units: ${units})`);
    }
    lines.push('');
  }

  if (ctx.catalogSnippet && ctx.catalogSnippet.trim()) {
    lines.push('Additional catalog context:');
    lines.push(ctx.catalogSnippet.trim());
    lines.push('');
  }

  lines.push(`User question: ${ctx.userInput.trim()}`);
  return lines.join('\n');
}

async function callGeminiForQa(prompt: string, model: string): Promise<string> {
  const apiKey = getEnv('GEMINI_API_KEY') ?? getEnv('GOOGLE_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: QA_TEMPERATURE,
          maxOutputTokens: QA_MAX_OUTPUT_TOKENS,
        },
      }),
    },
    QA_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Gemini Q&A request failed: ${response.status}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' ? text : '';
}

export async function answerProductQuestion(ctx: QaContext): Promise<QaResult> {
  const model = getEnv('QUICK_ORDER_DEFAULT_MODEL') ?? QA_DEFAULT_MODEL;

  if (!checkRateLimit(ctx.userId)) {
    return {
      status: 'qa_answer',
      assistantMessage: 'Too many questions in a short time. Wait a moment and try again.',
      modelUsed: 'none',
    };
  }

  try {
    const prompt = buildPrompt(ctx);
    const raw = await callGeminiForQa(prompt, model);
    const cleaned = raw.replace(/\s+$/g, '').trim();
    if (!cleaned) {
      return {
        status: 'qa_answer',
        assistantMessage: "I couldn't process that question. Try rephrasing.",
        modelUsed: model,
      };
    }
    return {
      status: 'qa_answer',
      assistantMessage: cleaned,
      modelUsed: model,
    };
  } catch (error) {
    console.warn('parse-order qa-handler error', error);
    return {
      status: 'qa_answer',
      assistantMessage: "I couldn't process that question. Try rephrasing.",
      modelUsed: model,
    };
  }
}
