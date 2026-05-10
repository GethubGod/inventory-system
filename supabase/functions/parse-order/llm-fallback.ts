import type { CatalogItem, ParsedItem, ParseFlag } from './types.ts';
import { validateLlmItem } from './validator.ts';

export type LlmFallbackInput = {
  rawText: string;
  catalog: CatalogItem[];
  prompt: string;
  callLlm?: (prompt: string) => Promise<string>;
};

export type LlmFallbackResult = {
  items: ParsedItem[];
  flags: ParseFlag[];
  repairNeeded: boolean;
  llmFailed: boolean;
  rawText: string;
};

export async function parseWithLlmFallback(input: LlmFallbackInput): Promise<LlmFallbackResult> {
  if (!input.callLlm) {
    return { items: [], flags: [], repairNeeded: false, llmFailed: true, rawText: '' };
  }

  try {
    const rawText = await input.callLlm(input.prompt);
    const parsed = parseJsonPayload(rawText);
    if (parsed.value) {
      return validateLlmPayload(parsed.value, input.catalog, parsed.repairNeeded, false, rawText);
    }

    const repairPrompt = `Convert the following into valid JSON matching this schema. Return JSON only.\nSchema: {"reply_text":"string","parsed_items":[{"item_id":"uuid or null","item_name":"string","raw_token":"string","quantity":1,"unit":"lb","confidence":0.8}]}\nContent:\n${rawText}`;
    const repairedRaw = await input.callLlm(repairPrompt);
    const repaired = parseJsonPayload(repairedRaw);
    if (repaired.value) {
      return validateLlmPayload(repaired.value, input.catalog, true, false, repairedRaw);
    }

    return invalidJsonFallback(true, false, repairedRaw);
  } catch {
    return invalidJsonFallback(false, true, '');
  }
}

export function parseJsonPayload(text: string): { value: unknown | null; repairNeeded: boolean } {
  try {
    return { value: JSON.parse(text), repairNeeded: false };
  } catch {
    // Continue through extraction and repair.
  }

  const extracted = extractFirstJson(text);
  if (extracted) {
    try {
      return { value: JSON.parse(extracted), repairNeeded: true };
    } catch {
      const repaired = repairJsonText(extracted);
      try {
        return { value: JSON.parse(repaired), repairNeeded: true };
      } catch {
        return { value: null, repairNeeded: true };
      }
    }
  }

  const repaired = repairJsonText(text);
  try {
    return { value: JSON.parse(repaired), repairNeeded: true };
  } catch {
    return { value: null, repairNeeded: true };
  }
}

function extractFirstJson(text: string): string | null {
  const start = text.search(/[\[{]/);
  if (start < 0) return null;
  const opener = text[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString) continue;
    if (char === opener) depth += 1;
    if (char === closer) depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

function repairJsonText(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\bundefined\b/g, 'null')
    .replace(/\bNaN\b/g, 'null')
    .trim();
}

function validateLlmPayload(
  payload: unknown,
  catalog: CatalogItem[],
  repairNeeded: boolean,
  llmFailed: boolean,
  rawText: string,
): LlmFallbackResult {
  const objectPayload = Array.isArray(payload)
    ? { parsed_items: payload }
    : payload && typeof payload === 'object'
      ? payload as Record<string, unknown>
      : {};

  const rawItems = Array.isArray(objectPayload.parsed_items) ? objectPayload.parsed_items : [];
  const items: ParsedItem[] = [];
  const flags: ParseFlag[] = [];

  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const validated = validateLlmItem({ raw: rawItem as Record<string, unknown>, catalog });
    items.push(validated.item);
    flags.push(...validated.flags);
  }

  return { items, flags, repairNeeded, llmFailed, rawText };
}

function invalidJsonFallback(repairNeeded: boolean, llmFailed: boolean, rawText: string): LlmFallbackResult {
  return {
    items: [],
    flags: [{
      type: 'invalid_json',
      message: 'I had trouble reading part of that order. Please review the highlighted items.',
      reason: 'invalid_llm_json',
    }],
    repairNeeded,
    llmFailed,
    rawText,
  };
}

