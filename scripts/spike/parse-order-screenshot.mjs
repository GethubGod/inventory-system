#!/usr/bin/env node
// Phase 6a spike — parse order screenshots with Gemini.
//
// Mirrors the repo's existing Gemini plumbing in
// supabase/functions/quick-order-voice-parse/index.ts:
//   - REST endpoint https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//   - `x-goog-api-key` header, key from GEMINI_API_KEY (GOOGLE_API_KEY fallback)
//   - generationConfig { temperature: 0.1, responseMimeType: 'application/json', responseSchema }
//   - inlineData part with base64 payload (audio there, image here)
//   - 30s timeout, 2 attempts with a "return strict JSON" retry nudge
//   - prompt style modeled on that function's buildPrompt()
//
// Model default mirrors QUICK_ORDER_VOICE_MODEL ?? 'gemini-2.5-flash'
// (supabase/functions/parse-order/model-router.ts uses the same default, with
// 'gemini-3.1-pro' as its advanced tier — try --model gemini-3.1-pro if flash
// misreads noisy screenshots).
//
// Usage:
//   node scripts/spike/parse-order-screenshot.mjs [--dry-run] [--model <m>] [--out <dir>] <image.png> [...]
//
// Output: one JSON file per image ({items: [{name, quantity, unit, note?}]}),
// written as <basename>.parsed.json in --out (default: alongside the image).
// --dry-run prints the prompt, the response schema, and the would-be request
// body (base64 elided) without calling the API. Zero npm dependencies.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

const GEMINI_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = process.env.QUICK_ORDER_SCREENSHOT_MODEL ?? 'gemini-2.5-flash';

// Strict output contract for the spike (phase 6a deliverable shape).
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number', nullable: true },
          unit: { type: 'string', nullable: true },
          note: { type: 'string', nullable: true },
        },
        required: ['name', 'quantity', 'unit'],
      },
    },
  },
  required: ['items'],
};

// Prompt patterns lifted from quick-order-voice-parse buildPrompt(): explicit
// normalization rules, unit vocabulary, "do not invent", strict-JSON-only.
// Unlike the voice fn we deliberately do NOT inject the inventory catalog:
// the spike measures raw extraction; matching runs separately in score.mjs
// (in 6b the edge fn should inject the catalog exactly like the voice fn does).
const PROMPT = `You are extracting a restaurant supply order from a screenshot for a sushi restaurant inventory app.

The screenshot may be a notes-app list, a text-message thread, or a photo of handwriting. It may contain shorthand, typos, ALL CAPS, mixed English/Chinese, chat filler, and cancelled lines.

Task:
- Read every order line and output one item per line/entry.
- name: the item text exactly as written (keep typos and shorthand; lowercase is fine). Do not translate item names, do not guess canonical inventory names, do not invent items.
- quantity: the number for that item, or null if none is written. Use decimals for fractions ("1 1/2" = 1.5).
- If a quantity is a range ("2-3", "5~6", "1 or 2"), use the LARGER number and put the range in note (e.g. "range 2-3").
- unit: only when written, normalized to one of: case, box, bag, pack, bottle, tray, piece, lb, oz, tub. cs/case/cases = case; pk/pkg = pack; btl/bt = bottle; pc/pcs/ea/each = piece; lbs/pound = lb; 箱 = case. Otherwise null. Do not invent units.
- note: extra info written for that item (pack size, brand, range), else null.
- SKIP lines that are crossed out / struck through, and anything a nearby note says is cancelled.
- SKIP greetings, chit-chat, dates, timestamps, and anything that is not an ordered item.
- Return strict JSON only matching the response schema. No markdown, no prose.`;

function usage(code) {
  console.log('usage: node scripts/spike/parse-order-screenshot.mjs [--dry-run] [--model <model>] [--out <dir>] <image> [...]');
  process.exit(code);
}

const args = process.argv.slice(2);
let dryRun = false;
let model = DEFAULT_MODEL;
let outDir = null;
const images = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--dry-run') dryRun = true;
  else if (arg === '--model') model = args[++i] ?? usage(1);
  else if (arg === '--out') outDir = args[++i] ?? usage(1);
  else if (arg === '--help' || arg === '-h') usage(0);
  else images.push(arg);
}
if (images.length === 0) usage(1);

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function buildRequestBody(imageBase64, mimeType, attempt) {
  return {
    contents: [{
      role: 'user',
      parts: [
        {
          text: attempt === 0
            ? PROMPT
            : `${PROMPT}\n\nThe previous response was invalid JSON or did not match the schema. Retry once and return only strict JSON matching the response schema. Do not include markdown or prose.`,
        },
        { inlineData: { mimeType, data: imageBase64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };
}

// Mirrors parseGeminiJson() in quick-order-voice-parse/index.ts: try the raw
// text, then the outermost {...} block, and validate the shape.
function parseModelJson(rawText) {
  const candidates = [rawText, rawText.match(/\{[\s\S]*\}/)?.[0]].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || !Array.isArray(parsed.items)) continue;
      const items = parsed.items
        .filter((item) => item && typeof item.name === 'string' && item.name.trim())
        .map((item) => ({
          name: item.name.trim(),
          quantity: typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : null,
          unit: typeof item.unit === 'string' && item.unit.trim() ? item.unit.trim().toLowerCase() : null,
          ...(typeof item.note === 'string' && item.note.trim() ? { note: item.note.trim() } : {}),
        }));
      return { items };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function callGemini(imageBase64, mimeType, apiKey) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          signal: controller.signal,
          body: JSON.stringify(buildRequestBody(imageBase64, mimeType, attempt)),
        },
      );
      if (!response.ok) {
        throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);
      }
      const payload = await response.json();
      const rawText = String(payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
      const parsed = parseModelJson(rawText);
      if (!parsed) throw new Error(`Gemini returned invalid JSON: ${rawText.slice(0, 300)}`);
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('Gemini call failed');
}

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? null;

if (dryRun) {
  console.log('--- DRY RUN (no API call) ---');
  console.log(`model: ${model}`);
  console.log(`endpoint: https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
  console.log(`api key: ${apiKey ? 'present (not shown)' : 'ABSENT — set GEMINI_API_KEY'}`);
  console.log('\n--- PROMPT ---\n');
  console.log(PROMPT);
  console.log('\n--- RESPONSE SCHEMA ---\n');
  console.log(JSON.stringify(RESPONSE_SCHEMA, null, 2));
  console.log('\n--- WOULD-BE REQUEST BODY (per image, base64 elided) ---\n');
  for (const image of images) {
    const bytes = readFileSync(resolve(image));
    const mimeType = MIME_BY_EXT[extname(image).toLowerCase()] ?? 'image/png';
    const body = buildRequestBody(`<base64 ${bytes.length} bytes>`, mimeType, 0);
    body.contents[0].parts[0].text = '<prompt above>';
    console.log(`${image}:`);
    console.log(JSON.stringify(body, null, 2));
  }
  process.exit(0);
}

if (!apiKey) {
  console.error('GEMINI_API_KEY is not set. Use --dry-run to inspect the request without calling.');
  process.exit(1);
}

for (const image of images) {
  const path = resolve(image);
  const mimeType = MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mimeType) {
    console.warn(`skip ${image}: unsupported extension`);
    continue;
  }
  const imageBase64 = readFileSync(path).toString('base64');
  const started = Date.now();
  const result = await callGemini(imageBase64, mimeType, apiKey);
  const latencyMs = Date.now() - started;
  const targetDir = outDir ? resolve(outDir) : dirname(path);
  mkdirSync(targetDir, { recursive: true });
  const outPath = join(targetDir, `${basename(path, extname(path))}.parsed.json`);
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`${basename(path)} -> ${outPath} (${result.items.length} items, ${latencyMs}ms, ${model})`);
}
