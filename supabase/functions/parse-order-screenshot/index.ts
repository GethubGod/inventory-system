// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2?no-dts';
// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { z } from 'https://esm.sh/zod@3.25.76';
import { corsHeadersForRequest } from '../_shared/cors.ts';
import { buildCatalogFromInventoryItemRows } from '../parse-order/catalog-builder.ts';
import {
  buildCatalogSearchIndex,
  matchCatalogIndex,
} from '../parse-order/catalog-search-index.ts';
import { buildUnitAliases, normalizeUnit } from '../parse-order/units.ts';
import type { CatalogItem } from '../parse-order/types.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY');

const DEFAULT_MODEL = 'gemini-2.5-flash';
const PRO_MODEL = 'gemini-3.1-pro';
const GEMINI_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const AUTO_MATCH_MIN_CONFIDENCE = 0.7;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const RequestSchema = z.object({
  importId: z.string().uuid(),
});

const ParsedImageItemSchema = z.object({
  name: z.string().trim().min(1).max(500),
  quantity: z.number().finite().positive().nullable(),
  unit: z.string().trim().max(80).nullable(),
  note: z.string().trim().max(1000).nullable().optional(),
  confidence: z.number().finite().min(0).max(1),
});

const ScreenshotParseSchema = z.object({
  items: z.array(ParsedImageItemSchema).max(250),
});

type ScreenshotImportRow = {
  id: string;
  imported_by: string | null;
  employee_id: string | null;
  location_id: string;
  status: string;
  source: string;
  image_paths: unknown;
};

type ScreenshotImage = {
  path: string;
  mimeType: string | null;
};

type AliasRow = {
  item_id: string | null;
  alias_text: string | null;
};

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' },
  });
}

function errorResponse(req: Request, status: number, code: string, message: string, retryable = false) {
  return jsonResponse(req, { success: false, errorCode: code, message, retryable }, status);
}

function clampConfidence(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMimeType(value: string | null | undefined): string | null {
  const normalized = value?.split(';')[0]?.trim().toLowerCase() ?? '';
  return ALLOWED_IMAGE_MIME_TYPES.has(normalized) ? normalized : null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function safeErrorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 1000) || 'Unknown screenshot parse failure';
}

async function getAuthenticatedManager(req: Request): Promise<{ id: string } | null> {
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;

  const token = authorization.slice('Bearer '.length).trim();
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role,is_suspended')
    .eq('id', user.id)
    .maybeSingle();

  return profile?.role === 'manager' && profile?.is_suspended !== true ? { id: user.id } : null;
}

function imagePathsFromImport(value: unknown): ScreenshotImage[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const images: ScreenshotImage[] = [];

  for (const entry of value) {
    const record = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : null;
    const path = typeof entry === 'string'
      ? asNonEmptyString(entry)
      : asNonEmptyString(record?.path);
    if (!path || path.includes('..') || seen.has(path)) continue;
    seen.add(path);
    images.push({
      path,
      mimeType: normalizeMimeType(asNonEmptyString(record?.mime_type) ?? asNonEmptyString(record?.mimeType)),
    });
  }

  return images;
}

async function fetchImport(importId: string): Promise<ScreenshotImportRow | null> {
  const { data, error } = await supabaseAdmin
    .from('historical_order_imports')
    .select('id,imported_by,employee_id,location_id,status,source,image_paths')
    .eq('id', importId)
    .eq('source', 'screenshot')
    .maybeSingle();

  if (error) throw error;
  return data as ScreenshotImportRow | null;
}

async function fetchCatalog(locationId: string, employeeId: string | null): Promise<CatalogItem[]> {
  const [inventoryResult, globalAliasResult, employeeAliasResult] = await Promise.all([
    supabaseAdmin
      .from('inventory_items')
      .select('id,name,aliases,base_unit,pack_unit,allowed_units,supplier_id,location_id,active,default_order_unit,hard_cap,soft_cap,safety_stock,target_stock')
      .eq('active', true)
      .or(`location_id.is.null,location_id.eq.${locationId}`)
      .limit(1000),
    supabaseAdmin
      .from('quick_order_alias_rules')
      .select('item_id,alias_text')
      .eq('active', true)
      .eq('scope_type', 'global')
      .in('mode_scope', ['order', 'both'])
      .or(`location_id.is.null,location_id.eq.${locationId}`)
      .limit(1000),
    employeeId
      ? supabaseAdmin
        .from('employee_quick_order_aliases')
        .select('inventory_item_id,alias_text')
        .eq('active', true)
        .eq('employee_user_id', employeeId)
        .or(`location_id.is.null,location_id.eq.${locationId}`)
        .limit(1000)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (inventoryResult.error) throw inventoryResult.error;
  if (globalAliasResult.error) throw globalAliasResult.error;
  if (employeeAliasResult.error) throw employeeAliasResult.error;

  const aliases: AliasRow[] = [
    ...((globalAliasResult.data ?? []) as AliasRow[]),
    ...((employeeAliasResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      item_id: asNonEmptyString(row.inventory_item_id),
      alias_text: asNonEmptyString(row.alias_text),
    })),
  ];
  const aliasesByItem = new Map<string, string[]>();
  for (const alias of aliases) {
    const itemId = asNonEmptyString(alias.item_id);
    const aliasText = asNonEmptyString(alias.alias_text);
    if (!itemId || !aliasText) continue;
    const current = aliasesByItem.get(itemId) ?? [];
    current.push(aliasText);
    aliasesByItem.set(itemId, current);
  }

  return buildCatalogFromInventoryItemRows((inventoryResult.data ?? []) as Record<string, unknown>[])
    .map((item) => ({
      ...item,
      aliases: [...new Set([...item.aliases, ...(aliasesByItem.get(item.id) ?? [])])],
    }));
}

function compactCatalogForPrompt(catalog: CatalogItem[], limit = 250): string {
  return catalog.slice(0, limit).map((item) => {
    const aliases = item.aliases.length > 0 ? ` aliases: ${item.aliases.slice(0, 6).join(', ')}` : '';
    const units = [item.default_order_unit, item.default_unit, ...(item.allowed_units ?? [])]
      .filter((unit): unit is string => Boolean(unit))
      .slice(0, 4);
    return `- ${item.name}${aliases}${units.length > 0 ? ` units: ${[...new Set(units)].join(', ')}` : ''}`;
  }).join('\n');
}

function buildPrompt(catalog: CatalogItem[]): string {
  return `You are extracting a restaurant supply order from a screenshot for a sushi restaurant inventory app.

The screenshot may be a notes-app list, a text-message thread, or a photo of handwriting. It may contain shorthand, typos, ALL CAPS, mixed English/Chinese, chat filler, and cancelled lines.

Task:
- Read every order line and output one item per line/entry.
- name: preserve the item text as written (including shorthand and typos). The catalog helps recognize shorthand, but do not replace the raw name with a catalog name or invent items.
- quantity: the number for that item, or null if none is written. Use decimals for fractions ("1 1/2" = 1.5).
- If a quantity is a range ("2-3", "5~6", "1 or 2"), use the LARGER number and put the range in note.
- unit: only when written, normalized to one of: cs, box, bag, pack, bottle, tray, pc, lb, oz, tub. case/cases = cs; pk/pkg = pack; btl/bt = bottle; pcs/ea/each = pc; lbs/pound = lb; 箱 = cs. Otherwise null. Do not infer a unit from the catalog.
- confidence: your confidence from 0 to 1 that this is a real, correctly extracted order line.
- note: extra written context such as a pack size, brand, or range; otherwise null.
- SKIP crossed-out/struck-through or cancelled lines, greetings, dates, timestamps, and non-order chatter.
- Return strict JSON only matching the response schema. No markdown or prose.

Valid inventory candidates (for shorthand context only):
${compactCatalogForPrompt(catalog)}`;
}

const GEMINI_RESPONSE_SCHEMA = {
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
          confidence: { type: 'number' },
        },
        required: ['name', 'quantity', 'unit', 'confidence'],
      },
    },
  },
  required: ['items'],
};

function parseGeminiJson(rawText: string) {
  const candidates = [rawText, rawText.match(/\{[\s\S]*\}/)?.[0]].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  for (const candidate of candidates) {
    try {
      return ScreenshotParseSchema.parse(JSON.parse(candidate));
    } catch {
      // A retry below handles malformed or non-schema-compliant output.
    }
  }
  return null;
}

async function callGemini(input: {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  model: string;
}) {
  if (!geminiApiKey) throw new Error('GEMINI_API_KEY is not configured');
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                {
                  text: attempt === 0
                    ? input.prompt
                    : `${input.prompt}\n\nThe previous response was invalid JSON or did not match the schema. Retry once and return only strict JSON matching the response schema. Do not include markdown or prose.`,
                },
                { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } },
              ],
            }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
              responseSchema: GEMINI_RESPONSE_SCHEMA,
            },
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Gemini screenshot request failed: ${response.status}`);
      }
      const payload = await response.json();
      const parsed = parseGeminiJson(String(payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''));
      if (!parsed) throw new Error('Gemini returned invalid screenshot JSON');
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error('Gemini screenshot parse failed');
}

function configuredModel(rows: { key: string; value: unknown }[]): string {
  const value = rows.find((row) => row.key === 'screenshot_import_model')?.value;
  const candidate = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).model
      : null;
  return candidate === PRO_MODEL || candidate === DEFAULT_MODEL ? candidate : DEFAULT_MODEL;
}

async function markFailed(importId: string, error: unknown): Promise<void> {
  const { error: updateError } = await supabaseAdmin
    .from('historical_order_imports')
    .update({ status: 'failed', parse_error: safeErrorDetail(error) })
    .eq('id', importId)
    .eq('source', 'screenshot');
  if (updateError) console.error('[parse-order-screenshot] failed to record parse error', updateError);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersForRequest(req) });
  }
  if (req.method !== 'POST') {
    return errorResponse(req, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  }

  let importId: string | null = null;
  try {
    const manager = await getAuthenticatedManager(req);
    if (!manager) {
      return errorResponse(req, 403, 'MANAGER_REQUIRED', 'Only managers can parse screenshot imports.');
    }

    const payload = RequestSchema.safeParse(await req.json());
    if (!payload.success) {
      return errorResponse(req, 400, 'INVALID_IMPORT_ID', 'A valid screenshot import ID is required.');
    }
    importId = payload.data.importId;

    const screenshotImport = await fetchImport(importId);
    if (!screenshotImport) {
      return errorResponse(req, 404, 'IMPORT_NOT_FOUND', 'Screenshot import not found.');
    }
    if (screenshotImport.status === 'parsed' || screenshotImport.status === 'reviewed' || screenshotImport.status === 'merged') {
      return jsonResponse(req, {
        success: true,
        importId,
        status: screenshotImport.status,
        idempotent: true,
      });
    }
    if (screenshotImport.status !== 'uploaded' && screenshotImport.status !== 'failed') {
      return errorResponse(req, 409, 'INVALID_IMPORT_STATUS', 'This screenshot import cannot be parsed in its current state.');
    }
    if (!geminiApiKey) {
      await markFailed(importId, new Error('GEMINI_API_KEY is not configured'));
      return errorResponse(req, 503, 'API_KEY_MISSING', 'Screenshot parsing is temporarily unavailable.', true);
    }

    const images = imagePathsFromImport(screenshotImport.image_paths);
    if (images.length === 0) {
      await markFailed(importId, new Error('Screenshot import contains no usable image paths'));
      return errorResponse(req, 422, 'NO_IMAGES', 'This import does not contain any usable images.');
    }

    const [catalog, configResult] = await Promise.all([
      fetchCatalog(screenshotImport.location_id, screenshotImport.employee_id),
      supabaseAdmin.from('app_config').select('key,value').eq('key', 'screenshot_import_model'),
    ]);
    if (configResult.error) throw configResult.error;
    if (catalog.length === 0) {
      throw new Error('No active inventory catalog items are available for this location');
    }

    const model = configuredModel((configResult.data ?? []) as { key: string; value: unknown }[]);
    const prompt = buildPrompt(catalog);
    const catalogIndex = buildCatalogSearchIndex(catalog);
    // Keep screenshot-only additions deterministic and local to this parser;
    // the base aliases themselves come directly from parse-order/units.ts.
    const unitAliases = buildUnitAliases({
      tub: 'tub',
      tubs: 'tub',
      '箱': 'cs',
    });
    const confidences: number[] = [];
    let parsedCount = 0;

    for (const image of images) {
      const { data: blob, error: downloadError } = await supabaseAdmin
        .storage
        .from('order-screenshots')
        .download(image.path, {}, { cache: 'no-store' });
      if (downloadError || !blob) throw downloadError ?? new Error(`Unable to download ${image.path}`);
      if (blob.size <= 0 || blob.size > MAX_IMAGE_BYTES) {
        throw new Error(`Screenshot image is empty or exceeds ${MAX_IMAGE_BYTES} bytes`);
      }

      const mimeType = normalizeMimeType(image.mimeType ?? blob.type);
      if (!mimeType) throw new Error(`Unsupported screenshot image type for ${image.path}`);

      const result = await callGemini({
        imageBase64: arrayBufferToBase64(await blob.arrayBuffer()),
        mimeType,
        prompt,
        model,
      });

      const rows = result.items.map((item, sourceLineIndex) => {
        const extractionConfidence = clampConfidence(item.confidence);
        const match = matchCatalogIndex(item.name, catalogIndex);
        const combinedConfidence = Math.min(extractionConfidence, clampConfidence(match.confidence));
        const unit = normalizeUnit(item.unit, unitAliases);
        const matchedItemId = match.item_id
          && match.confidence_tier === 'high'
          && match.semantic_validation_passed !== false
          && combinedConfidence >= AUTO_MATCH_MIN_CONFIDENCE
          && item.quantity != null
          && unit != null
          ? match.item_id
          : null;
        confidences.push(combinedConfidence);
        parsedCount += 1;

        return {
          import_id: importId,
          item_id: matchedItemId,
          matched_item_id: matchedItemId,
          item_name_snapshot: item.name,
          raw_name: item.name,
          quantity: item.quantity,
          unit,
          original_line: [item.name, item.quantity == null ? null : String(item.quantity), item.unit, item.note ?? null]
            .filter((part): part is string => Boolean(part && part.trim()))
            .join(' '),
          confidence: combinedConfidence,
          review_state: matchedItemId ? 'matched' : 'pending',
          source_image_path: image.path,
          source_line_index: sourceLineIndex,
        };
      });

      if (rows.length > 0) {
        const { error: itemError } = await supabaseAdmin
          .from('historical_order_import_items')
          .upsert(rows, {
            onConflict: 'import_id,source_image_path,source_line_index',
            ignoreDuplicates: true,
          });
        if (itemError) throw itemError;
      }
    }

    const confidence = confidences.length > 0
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : 0;
    const { error: updateError } = await supabaseAdmin
      .from('historical_order_imports')
      .update({
        status: 'parsed',
        confidence,
        parsed_at: new Date().toISOString(),
        parse_error: null,
      })
      .eq('id', importId)
      .eq('source', 'screenshot');
    if (updateError) throw updateError;

    return jsonResponse(req, {
      success: true,
      importId,
      status: 'parsed',
      model,
      parsedCount,
    });
  } catch (error) {
    console.error('[parse-order-screenshot] failed', error);
    if (importId) await markFailed(importId, error);
    return errorResponse(req, 500, 'PARSE_FAILED', 'Screenshot parsing failed. Try again.', true);
  }
});
