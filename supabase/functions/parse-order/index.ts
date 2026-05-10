// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders } from '../_shared/cors.ts';
import { runMockParser } from './mock-parser.ts';

type Provider = 'gemini' | 'claude';

type ParseRequest = {
  raw_text?: unknown;
  location_id?: unknown;
  session_id?: unknown;
  user_id?: unknown;
};

type CatalogItem = {
  id: string;
  name: string;
  aliases: string[];
  default_unit: string | null;
};

type ParserExample = {
  id: string;
  raw_text: string;
  structured_output: unknown;
};

type ParserCorrection = {
  raw_token: string;
  parser_suggested_item_id: string | null;
  user_corrected_item_id: string | null;
  user_corrected_qty: number | null;
  user_corrected_unit: string | null;
};

type QuickOrderMessage = {
  role?: string;
  content?: string;
  text?: string;
  raw_text?: string;
  reply_text?: string;
};

type LlmParsedItem = {
  item_id?: unknown;
  item_name?: unknown;
  raw_token?: unknown;
  quantity?: unknown;
  unit?: unknown;
  confidence?: unknown;
  notes?: unknown;
};

type ParsedItem = {
  item_id: string | null;
  item_name: string;
  raw_token: string;
  quantity: number | null;
  unit: string | null;
  confidence: number;
  needs_clarification: boolean;
  unresolved: boolean;
  notes: string | null;
};

type ParseFlag = {
  type:
    | 'llm_timeout'
    | 'llm_error'
    | 'invalid_item_id'
    | 'missing_quantity'
    | 'missing_unit'
    | 'unresolved_item'
    | 'invalid_json';
  message: string;
  raw_token?: string;
  item_id?: string;
};

type ParseSuggestion = {
  item_id: string;
  item_name: string;
  suggested_qty: number;
  unit: string | null;
  unit_type: string | null;
  reason: string | null;
  confidence: number;
};

type ParseResponse = {
  reply_text: string;
  parsed_items: ParsedItem[];
  flags: ParseFlag[];
  suggestions: ParseSuggestion[];
  session_state: {
    total_items: number;
    ready_to_submit: boolean;
  };
};

type CachedCatalog = {
  expiresAt: number;
  items: CatalogItem[];
};

const CATALOG_CACHE_MS = 5 * 60 * 1000;
const LLM_TIMEOUT_MS = 8000;
const MAX_EXAMPLES = 25;
const MAX_PREVIOUS_MESSAGES = 20;
const MAX_CORRECTIONS = 10;

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY');
const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
const configuredProvider = (Deno.env.get('PARSE_ORDER_LLM_PROVIDER') ?? '').toLowerCase();

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const catalogCache = new Map<string, CachedCatalog>();

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function emptyParseResponse(replyText: string, flags: ParseFlag[] = []): ParseResponse {
  return {
    reply_text: replyText,
    parsed_items: [],
    flags,
    suggestions: [],
    session_state: {
      total_items: 0,
      ready_to_submit: false,
    },
  };
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function clampConfidence(value: unknown): number {
  const parsed = asNumber(value);
  if (parsed === null) return 0.5;
  return Math.max(0, Math.min(1, parsed));
}

function chooseProvider(): Provider | null {
  if (configuredProvider === 'gemini') return geminiApiKey ? 'gemini' : null;
  if (configuredProvider === 'claude') return anthropicApiKey ? 'claude' : null;
  if (geminiApiKey) return 'gemini';
  if (anthropicApiKey) return 'claude';
  return null;
}

function getDefaultUnit(row: any): string | null {
  const orderUnit = asNullableString(row?.order_unit);
  const inventory = row?.inventory_items ?? {};
  return (
    orderUnit ??
    asNullableString(inventory?.base_unit) ??
    asNullableString(inventory?.pack_unit) ??
    asNullableString(row?.unit_type)
  );
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Unauthorized', status: 401, user: null };
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return { error: 'Unauthorized', status: 401, user: null };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_suspended')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.is_suspended) {
    return {
      error: 'Suspended accounts cannot use Quick Order',
      status: 403,
      user: null,
    };
  }

  return { error: null, status: 200, user };
}

async function fetchCatalog(locationId: string): Promise<CatalogItem[]> {
  const cached = catalogCache.get(locationId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }

  const { data, error } = await supabaseAdmin
    .from('area_items')
    .select(`
      inventory_item_id,
      unit_type,
      order_unit,
      active,
      inventory_items!inner(id, name, aliases, base_unit, pack_unit, active),
      storage_areas!inner(id, location_id, active)
    `)
    .eq('storage_areas.location_id', locationId)
    .eq('active', true)
    .eq('storage_areas.active', true)
    .eq('inventory_items.active', true)
    .limit(2000);

  if (error) {
    throw new Error(`Unable to load item catalog: ${error.message}`);
  }

  const byId = new Map<string, CatalogItem>();

  for (const row of data ?? []) {
    const inventory = row?.inventory_items ?? {};
    const id = asTrimmedString(inventory?.id ?? row?.inventory_item_id);
    const name = asTrimmedString(inventory?.name);
    if (!id || !name || byId.has(id)) continue;

    byId.set(id, {
      id,
      name,
      aliases: Array.isArray(inventory?.aliases)
        ? inventory.aliases.filter((alias: unknown): alias is string => typeof alias === 'string')
        : [],
      default_unit: getDefaultUnit(row),
    });
  }

  const items = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  catalogCache.set(locationId, {
    expiresAt: Date.now() + CATALOG_CACHE_MS,
    items,
  });

  return items;
}

async function fetchExamples(): Promise<ParserExample[]> {
  const { data, error } = await supabaseAdmin
    .from('parser_examples')
    .select('id, raw_text, structured_output')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(MAX_EXAMPLES);

  if (error) {
    throw new Error(`Unable to load parser examples: ${error.message}`);
  }

  return (data ?? []) as ParserExample[];
}

async function fetchPreviousMessages(sessionId: string | null): Promise<QuickOrderMessage[]> {
  if (!sessionId) return [];

  const { data, error } = await supabaseAdmin
    .from('quick_order_sessions')
    .select('messages')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load quick order session: ${error.message}`);
  }

  const messages = Array.isArray(data?.messages) ? data.messages : [];
  return messages.slice(-MAX_PREVIOUS_MESSAGES) as QuickOrderMessage[];
}

async function fetchDowSuggestions(input: {
  locationId: string;
  userId: string;
  parsedItems: ParsedItem[];
  previousMessages: QuickOrderMessage[];
}): Promise<ParseSuggestion[]> {
  const hasPriorAssistantResponse = input.previousMessages.some((message) => {
    const role = typeof message?.role === 'string' ? message.role.toLowerCase() : '';
    return role === 'assistant' || role === 'model';
  });

  if (hasPriorAssistantResponse) {
    return [];
  }

  const parsedItemIds = new Set(
    input.parsedItems
      .map((item) => item.item_id)
      .filter((itemId): itemId is string => Boolean(itemId)),
  );

  try {
    const { data, error } = await supabaseAdmin.rpc('get_dow_suggestions', {
      p_location_id: input.locationId,
      p_min_frequency: 0.4,
      p_lookback_months: 6,
      p_user_id: input.userId,
    });

    if (error) {
      console.warn('parse-order get_dow_suggestions failed', error);
      return [];
    }

    const rows = Array.isArray(data)
      ? data
      : typeof data === 'string'
        ? JSON.parse(data)
        : [];

    return rows
      .map((row: any): ParseSuggestion | null => {
        const itemId = asNullableString(row?.item_id);
        if (!itemId || parsedItemIds.has(itemId)) {
          return null;
        }

        const quantity = asNumber(row?.suggested_qty) ?? 1;
        return {
          item_id: itemId,
          item_name: asNullableString(row?.item_name) ?? 'Suggested item',
          suggested_qty: Math.max(1, Math.round(quantity)),
          unit: asNullableString(row?.unit),
          unit_type: asNullableString(row?.unit_type),
          reason: asNullableString(row?.reason) ?? 'Usually ordered on this day',
          confidence: clampConfidence(row?.frequency ?? row?.confidence ?? 0.5),
        };
      })
      .filter((row: ParseSuggestion | null): row is ParseSuggestion => Boolean(row))
      .slice(0, 3);
  } catch (error) {
    console.warn('parse-order get_dow_suggestions unexpected failure', error);
    return [];
  }
}

async function fetchCorrections(userId: string): Promise<ParserCorrection[]> {
  const { data, error } = await supabaseAdmin
    .from('parser_corrections')
    .select(`
      raw_token,
      parser_suggested_item_id,
      user_corrected_item_id,
      user_corrected_qty,
      user_corrected_unit
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_CORRECTIONS);

  if (error) {
    throw new Error(`Unable to load parser corrections: ${error.message}`);
  }

  return (data ?? []) as ParserCorrection[];
}

function formatCatalogForPrompt(items: CatalogItem[]): string {
  if (items.length === 0) return 'No valid items are available for this location.';

  return items
    .map((item) => {
      const aliases = item.aliases.length > 0 ? ` aliases: ${item.aliases.join(', ')}` : '';
      const defaultUnit = item.default_unit ? ` default_unit: ${item.default_unit}` : '';
      return `- id: ${item.id}; name: ${item.name};${defaultUnit};${aliases}`;
    })
    .join('\n');
}

function formatExamplesForPrompt(examples: ParserExample[]): string {
  if (examples.length === 0) return 'No manager examples are configured.';

  return examples
    .map(
      (example) =>
        `Input: ${example.raw_text}\nExpected: ${JSON.stringify(example.structured_output)}`,
    )
    .join('\n\n');
}

function formatCorrectionsForPrompt(corrections: ParserCorrection[]): string {
  if (corrections.length === 0) return 'No recent user corrections.';

  return corrections
    .map((correction) =>
      JSON.stringify({
        raw_token: correction.raw_token,
        parser_suggested_item_id: correction.parser_suggested_item_id,
        user_corrected_item_id: correction.user_corrected_item_id,
        user_corrected_qty: correction.user_corrected_qty,
        user_corrected_unit: correction.user_corrected_unit,
      }),
    )
    .join('\n');
}

function formatMessagesForPrompt(messages: QuickOrderMessage[]): string {
  if (messages.length === 0) return 'No previous messages in this session.';

  return messages
    .map((message) => {
      const role = asNullableString(message.role) ?? 'unknown';
      const content =
        asNullableString(message.content) ??
        asNullableString(message.text) ??
        asNullableString(message.raw_text) ??
        asNullableString(message.reply_text) ??
        JSON.stringify(message);
      return `${role}: ${content}`;
    })
    .join('\n');
}

function buildPrompt(input: {
  rawText: string;
  catalog: CatalogItem[];
  examples: ParserExample[];
  corrections: ParserCorrection[];
  previousMessages: QuickOrderMessage[];
}) {
  return `You are an order parser for Babytuna Sushi.

Your job is to convert messy employee order text into strict JSON for the Babytuna Quick Order flow.

VALID ITEM CATALOG:
${formatCatalogForPrompt(input.catalog)}

ACTIVE MANAGER EXAMPLES:
${formatExamplesForPrompt(input.examples)}

RECENT USER CORRECTIONS:
${formatCorrectionsForPrompt(input.corrections)}

CONVERSATION SO FAR:
${formatMessagesForPrompt(input.previousMessages)}

NEW USER TEXT:
${input.rawText}

RULES:
1. Return JSON only. Do not wrap the JSON in markdown.
2. Only use item_id values from the VALID ITEM CATALOG.
3. Match aliases and informal names to catalog item names.
4. If an item is mentioned without a quantity, set quantity to null and needs_clarification to true.
5. If an item is mentioned without a unit, set unit to null. The server will apply default_unit when possible.
6. If the item cannot be confidently matched to the catalog, return item_id null, unresolved true, and preserve raw_token.
7. Keep reply_text short and operational.
8. FOLLOW-UPS: If the NEW USER TEXT is an answer (like "4" or "boxes") to a previous clarification, return the previous item with the new data filled in, include its exact item_id, and set needs_clarification to false.

JSON SHAPE:
{
  "reply_text": "Got these. I need a unit for ginger.",
  "parsed_items": [
    {
      "item_id": "uuid or null",
      "item_name": "Salmon",
      "raw_token": "salmon",
      "quantity": 2,
      "unit": "lb",
      "confidence": 0.95,
      "notes": null
    }
  ]
}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(prompt: string) {
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          // DO NOT make this client-configurable — protects against runaway output costs.
          maxOutputTokens: 1024,
        },
      }),
    },
    LLM_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callClaude(prompt: string) {
  if (!anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const response = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1200,
        temperature: 0.1,
        system: 'Return strict JSON only.',
        messages: [{ role: 'user', content: prompt }],
      }),
    },
    LLM_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Claude request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const firstText = Array.isArray(data?.content)
    ? data.content.find((part: any) => part?.type === 'text')?.text
    : null;
  return firstText ?? '';
}

async function callLlm(prompt: string) {
  const provider = chooseProvider();
  if (!provider) {
    throw new Error(
      'No LLM provider configured. Set PARSE_ORDER_LLM_PROVIDER plus GEMINI_API_KEY or ANTHROPIC_API_KEY.',
    );
  }

  return provider === 'gemini' ? await callGemini(prompt) : await callClaude(prompt);
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};

    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
}

function postProcessItems(
  llmItems: unknown,
  catalog: CatalogItem[],
): { parsedItems: ParsedItem[]; flags: ParseFlag[] } {
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  const flags: ParseFlag[] = [];

  if (!Array.isArray(llmItems)) {
    return { parsedItems: [], flags };
  }

  const parsedItems = llmItems.map((entry) => {
    const item = entry && typeof entry === 'object' ? (entry as LlmParsedItem) : {};
    const rawItemId = asNullableString(item.item_id);
    const rawToken = asNullableString(item.raw_token) ?? asNullableString(item.item_name) ?? '';
    const catalogItem = rawItemId ? catalogById.get(rawItemId) ?? null : null;
    const quantity = asNumber(item.quantity);
    const providedUnit = asNullableString(item.unit);
    const unit = providedUnit ?? catalogItem?.default_unit ?? null;
    const invalidItemId = Boolean(rawItemId && !catalogItem);
    const unresolved = invalidItemId || !catalogItem;
    const missingQuantity = quantity === null || quantity <= 0;
    const missingUnit = !unit;

    if (invalidItemId) {
      flags.push({
        type: 'invalid_item_id',
        message: 'LLM returned an item_id outside the valid catalog.',
        item_id: rawItemId ?? undefined,
        raw_token: rawToken || undefined,
      });
    }

    if (!catalogItem) {
      flags.push({
        type: 'unresolved_item',
        message: 'Item could not be resolved to the valid catalog.',
        raw_token: rawToken || undefined,
      });
    }

    if (missingQuantity) {
      flags.push({
        type: 'missing_quantity',
        message: 'Quantity is missing or invalid.',
        raw_token: rawToken || undefined,
        item_id: catalogItem?.id,
      });
    }

    if (missingUnit) {
      flags.push({
        type: 'missing_unit',
        message: 'Unit is missing and no default unit is configured.',
        raw_token: rawToken || undefined,
        item_id: catalogItem?.id,
      });
    }

    return {
      item_id: catalogItem?.id ?? null,
      item_name:
        catalogItem?.name ??
        asNullableString(item.item_name) ??
        (rawToken.length > 0 ? rawToken : 'Unresolved item'),
      raw_token: rawToken,
      quantity: missingQuantity ? null : quantity,
      unit,
      confidence: clampConfidence(item.confidence),
      needs_clarification: unresolved || missingQuantity || missingUnit,
      unresolved,
      notes: asNullableString(item.notes),
    };
  });

  return { parsedItems, flags };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const authResult = await getAuthenticatedUser(req);
    if (authResult.error || !authResult.user) {
      return jsonResponse({ error: authResult.error || 'Unauthorized' }, authResult.status);
    }

    const payload = (await req.json().catch(() => ({}))) as ParseRequest;
    const rawText = asTrimmedString(payload.raw_text);
    const locationId = asTrimmedString(payload.location_id);
    const sessionId = asNullableString(payload.session_id);
    const requestedUserId = asTrimmedString(payload.user_id);
    const authenticatedUserId = authResult.user.id;

    if (!rawText) {
      return jsonResponse({ error: 'Missing required field: raw_text' }, 400);
    }
    if (!locationId) {
      return jsonResponse({ error: 'Missing required field: location_id' }, 400);
    }
    if (!requestedUserId) {
      return jsonResponse({ error: 'Missing required field: user_id' }, 400);
    }
    if (requestedUserId !== authenticatedUserId) {
      return jsonResponse({ error: 'Authenticated user mismatch' }, 403);
    }

    // --- App config: kill switch + mode selection ---
    const { data: configRows } = await supabaseAdmin
      .from('app_config')
      .select('key, value')
      .in('key', [
        'quick_order_parser_mode',
        'quick_order_enabled',
        'quick_order_daily_limit_per_user',
        'quick_order_monthly_token_budget',
        'quick_order_token_warning_threshold',
      ]);

    const config: Record<string, unknown> = {};
    for (const row of configRows ?? []) {
      config[row.key] = row.value;
    }

    if (config.quick_order_enabled === false) {
      return jsonResponse(
        { error: 'Quick Order is temporarily disabled.', code: 'feature_disabled' },
        503,
      );
    }

    const parserMode = (typeof config.quick_order_parser_mode === 'string'
      ? config.quick_order_parser_mode
      : 'auto') as string;
    const hasApiKey = Boolean(geminiApiKey || anthropicApiKey);
    const useMock = parserMode === 'mock' || (parserMode === 'auto' && !hasApiKey);

    // --- Per-user daily rate limit ---
    const dailyLimit = typeof config.quick_order_daily_limit_per_user === 'number'
      ? config.quick_order_daily_limit_per_user
      : 100;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { count: dailyCount } = await supabaseAdmin
      .from('parser_usage_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', authenticatedUserId)
      .gte('created_at', startOfDay.toISOString());

    if ((dailyCount ?? 0) >= dailyLimit) {
      return jsonResponse(
        { error: 'Daily limit reached. Try tomorrow or contact your manager.', code: 'rate_limit_user_daily' },
        429,
      );
    }

    const callStartTime = Date.now();

    const [catalog, examples, previousMessages, corrections] = await Promise.all([
      fetchCatalog(locationId),
      fetchExamples(),
      fetchPreviousMessages(sessionId),
      fetchCorrections(authenticatedUserId),
    ]);

    if (catalog.length === 0) {
      return jsonResponse(
        emptyParseResponse('I do not see any orderable items for this location.', [
          {
            type: 'unresolved_item',
            message: 'No valid item catalog rows were found for this location.',
          },
        ]),
      );
    }

    // --- Mock mode path ---
    if (useMock) {
      const isFirstMessage = previousMessages.length === 0;
      const mockResult = await runMockParser({
        raw_text: rawText,
        location_id: locationId,
        session_id: sessionId,
        user_id: authenticatedUserId,
        catalog,
        is_first_message: isFirstMessage,
      });

      const durationMs = Date.now() - callStartTime;
      await supabaseAdmin.from('parser_usage_log').insert({
        user_id: authenticatedUserId,
        session_id: sessionId,
        call_type: 'parse-order',
        parser_mode: 'mock',
        ai_provider: null,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        duration_ms: durationMs,
        succeeded: true,
        error_code: null,
      });

      return jsonResponse(mockResult);
    }

    // --- Per-org monthly token budget check (live mode only) ---
    const monthlyBudget = typeof config.quick_order_monthly_token_budget === 'number'
      ? config.quick_order_monthly_token_budget
      : 5_000_000;
    const warningThreshold = typeof config.quick_order_token_warning_threshold === 'number'
      ? config.quick_order_token_warning_threshold
      : 0.8;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: monthlyUsage } = await supabaseAdmin
      .from('parser_usage_log')
      .select('total_tokens')
      .eq('parser_mode', 'live')
      .gte('created_at', startOfMonth.toISOString());

    const tokensThisMonth = (monthlyUsage ?? []).reduce(
      (sum: number, r: { total_tokens: number | null }) => sum + (r.total_tokens ?? 0),
      0,
    );

    if (tokensThisMonth >= monthlyBudget) {
      return jsonResponse(
        { error: 'Monthly AI budget reached. Contact admin.', code: 'rate_limit_org_monthly' },
        429,
      );
    }

    if (tokensThisMonth >= monthlyBudget * warningThreshold) {
      console.warn(
        `[BUDGET WARNING] at ${((tokensThisMonth / monthlyBudget) * 100).toFixed(1)}% of monthly budget`,
      );
    }

    // --- Live mode path ---
    const prompt = buildPrompt({
      rawText,
      catalog,
      examples,
      corrections,
      previousMessages,
    });

    const activeProvider = chooseProvider();
    let rawLlmText = '';
    let usageErrorCode: string | null = null;
    let usageSucceeded = true;

    try {
      rawLlmText = await callLlm(prompt);
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === 'AbortError';
      usageErrorCode = isTimeout ? 'llm_timeout' : 'llm_error';
      usageSucceeded = false;
      const actualErrorMessage = error instanceof Error ? error.message : 'Unknown LLM error';
      console.error('parse-order LLM failure', error);

      const durationMs = Date.now() - callStartTime;
      await supabaseAdmin.from('parser_usage_log').insert({
        user_id: authenticatedUserId,
        session_id: sessionId,
        call_type: 'parse-order',
        parser_mode: 'live',
        ai_provider: activeProvider,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        duration_ms: durationMs,
        succeeded: false,
        error_code: usageErrorCode,
      });

      return jsonResponse(
        {
          error: "AI API error",
          detail: isTimeout ? "Request timed out" : actualErrorMessage,
          code: usageErrorCode,
        },
        200,
      );
    }

    const parsed = parseJsonObject(rawLlmText);
    const responseFlags: ParseFlag[] = [];
    if (Object.keys(parsed).length === 0) {
      responseFlags.push({
        type: 'invalid_json',
        message: 'LLM did not return a valid JSON object.',
      });
    }

    const { parsedItems, flags } = postProcessItems(parsed.parsed_items, catalog);
    const allFlags = [...responseFlags, ...flags];
    const suggestions = await fetchDowSuggestions({
      locationId,
      userId: authenticatedUserId,
      parsedItems,
      previousMessages,
    });
    const readyToSubmit =
      parsedItems.length > 0 &&
      parsedItems.every((item) => !item.needs_clarification && !item.unresolved);

    const replyText =
      asNullableString(parsed.reply_text) ??
      (readyToSubmit
        ? `Got ${parsedItems.length === 1 ? 'this item' : 'these items'}.`
        : "I found part of that, but I need a little more detail.");

    // --- Log successful live call ---
    const durationMs = Date.now() - callStartTime;
    // Rough token estimate: ~4 chars per token for prompt, actual for response
    const estimatedPromptTokens = Math.ceil(prompt.length / 4);
    const estimatedCompletionTokens = Math.ceil(rawLlmText.length / 4);
    const estimatedTotalTokens = estimatedPromptTokens + estimatedCompletionTokens;
    // Gemini Flash pricing: ~$0.075/M input, ~$0.30/M output
    const estimatedCost =
      (estimatedPromptTokens * 0.000000075) + (estimatedCompletionTokens * 0.0000003);

    await supabaseAdmin.from('parser_usage_log').insert({
      user_id: authenticatedUserId,
      session_id: sessionId,
      call_type: 'parse-order',
      parser_mode: 'live',
      ai_provider: activeProvider,
      prompt_tokens: estimatedPromptTokens,
      completion_tokens: estimatedCompletionTokens,
      total_tokens: estimatedTotalTokens,
      estimated_cost_usd: estimatedCost,
      duration_ms: durationMs,
      succeeded: true,
      error_code: null,
    });

    return jsonResponse({
      reply_text: replyText,
      parsed_items: parsedItems,
      flags: allFlags,
      suggestions,
      session_state: {
        total_items: parsedItems.length,
        ready_to_submit: readyToSubmit,
      },
    } satisfies ParseResponse);
  } catch (error) {
    console.error('parse-order unexpected error', error);
    return jsonResponse(
      {
        error: 'Internal server error',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});
