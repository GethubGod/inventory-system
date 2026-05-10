// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders } from '../_shared/cors.ts';
import { parseQuickOrder, PARSER_VERSION } from './orchestrator.ts';
import type {
  CatalogItem,
  ParsedItem,
  ParserCorrection,
  ParserExample,
  ParseFlag,
  ParseResponse,
  ParseSuggestion,
  QuickOrderMessage,
} from './types.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

type Provider = 'gemini' | 'claude';

type ParseRequest = {
  raw_text?: unknown;
  location_id?: unknown;
  session_id?: unknown;
  user_id?: unknown;
};

type CachedCatalog = {
  expiresAt: number;
  items: CatalogItem[];
};

type SessionContext = {
  messages: QuickOrderMessage[];
  parsedItems: ParsedItem[];
};

const CATALOG_CACHE_MS = 5 * 60 * 1000;
const LLM_TIMEOUT_MS = 8000;
const MAX_EXAMPLES = 25;
const MAX_PREVIOUS_MESSAGES = 20;
const MAX_CORRECTIONS = 25;

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

/** Development-safe structured logger. Never exposes sensitive data. */
function devLog(stage: string, detail: Record<string, unknown>): void {
  console.log(`[parse-order] ${stage}`, JSON.stringify(detail));
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
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

function getDefaultUnit(row: Record<string, unknown>): string | null {
  const inventory = isRecord(row.inventory_items) ? row.inventory_items : {};
  return (
    asNullableString(row.order_unit) ??
    asNullableString(inventory.base_unit) ??
    asNullableString(inventory.pack_unit) ??
    asNullableString(row.unit_type)
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
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  const { data, error } = await supabaseAdmin
    .from('area_items')
    .select(`
      inventory_item_id,
      unit_type,
      order_unit,
      active,
      inventory_items!inner(id, name, aliases, base_unit, pack_unit, allowed_units, active),
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
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const inventory = isRecord(row.inventory_items) ? row.inventory_items : {};
    const id = asTrimmedString(inventory.id ?? row.inventory_item_id);
    const name = asTrimmedString(inventory.name);
    if (!id || !name || byId.has(id)) continue;

    byId.set(id, {
      id,
      name,
      aliases: Array.isArray(inventory.aliases)
        ? inventory.aliases.filter((alias): alias is string => typeof alias === 'string')
        : [],
      default_unit: getDefaultUnit(row),
      base_unit: asNullableString(inventory.base_unit),
      pack_unit: asNullableString(inventory.pack_unit),
      order_unit: asNullableString(row.order_unit),
      allowed_units: Array.isArray(inventory.allowed_units)
        ? inventory.allowed_units.filter((unit): unit is string => typeof unit === 'string')
        : null,
    });
  }

  const items = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  catalogCache.set(locationId, { expiresAt: Date.now() + CATALOG_CACHE_MS, items });
  return items;
}

async function fetchExamples(): Promise<ParserExample[]> {
  const { data, error } = await supabaseAdmin
    .from('parser_examples')
    .select('id, raw_text, structured_output')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(MAX_EXAMPLES);

  if (error) throw new Error(`Unable to load parser examples: ${error.message}`);
  return (data ?? []) as ParserExample[];
}

async function fetchSessionContext(sessionId: string | null): Promise<SessionContext> {
  if (!sessionId) return { messages: [], parsedItems: [] };

  const { data, error } = await supabaseAdmin
    .from('quick_order_sessions')
    .select('messages, parsed_items')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) throw new Error(`Unable to load quick order session: ${error.message}`);

  return {
    messages: Array.isArray(data?.messages)
      ? (data.messages.slice(-MAX_PREVIOUS_MESSAGES) as QuickOrderMessage[])
      : [],
    parsedItems: Array.isArray(data?.parsed_items) ? data.parsed_items as ParsedItem[] : [],
  };
}

async function fetchCorrections(userId: string, locationId: string): Promise<ParserCorrection[]> {
  const { data, error } = await supabaseAdmin
    .from('parser_corrections')
    .select(`
      raw_token,
      parser_suggested_item_id,
      user_corrected_item_id,
      user_corrected_qty,
      user_corrected_unit,
      location_id,
      correction_type
    `)
    .eq('user_id', userId)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .order('created_at', { ascending: false })
    .limit(MAX_CORRECTIONS);

  if (error) throw new Error(`Unable to load parser corrections: ${error.message}`);
  return (data ?? []) as ParserCorrection[];
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

  if (hasPriorAssistantResponse) return [];

  const parsedItemIds = new Set(input.parsedItems.map((item) => item.item_id).filter(Boolean));

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

    const rows = Array.isArray(data) ? data : typeof data === 'string' ? JSON.parse(data) : [];
    return rows
      .map((row: unknown): ParseSuggestion | null => {
        if (!isRecord(row)) return null;
        const itemId = asNullableString(row.item_id);
        if (!itemId || parsedItemIds.has(itemId)) return null;
        const quantity = asNumber(row.suggested_qty) ?? 1;
        return {
          item_id: itemId,
          item_name: asNullableString(row.item_name) ?? 'Suggested item',
          suggested_qty: Math.max(1, Math.round(quantity)),
          unit: asNullableString(row.unit),
          unit_type: asNullableString(row.unit_type),
          reason: asNullableString(row.reason) ?? 'Usually ordered on this day',
          confidence: clampConfidence(row.frequency ?? row.confidence ?? 0.5),
        };
      })
      .filter((row: ParseSuggestion | null): row is ParseSuggestion => Boolean(row))
      .slice(0, 3);
  } catch (error) {
    console.warn('parse-order get_dow_suggestions unexpected failure', error);
    return [];
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(prompt: string) {
  if (!geminiApiKey) throw new Error('GEMINI_API_KEY is not configured');
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          maxOutputTokens: 1024,
        },
      }),
    },
    LLM_TIMEOUT_MS,
  );

  if (!response.ok) throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callClaude(prompt: string) {
  if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
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
        temperature: 0,
        system: 'Return strict JSON only.',
        messages: [{ role: 'user', content: prompt }],
      }),
    },
    LLM_TIMEOUT_MS,
  );

  if (!response.ok) throw new Error(`Claude request failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const firstText = Array.isArray(data?.content)
    ? data.content.find((part: { type?: string }) => part?.type === 'text')?.text
    : null;
  return firstText ?? '';
}

async function callLlm(prompt: string) {
  const provider = chooseProvider();
  if (!provider) throw new Error('No LLM provider configured.');
  return provider === 'gemini' ? await callGemini(prompt) : await callClaude(prompt);
}

function safeParseFailureResponse(flags: ParseFlag[] = []): ParseResponse {
  const assistantMessage = 'I had trouble reading that. Please try again or add the item manually.';
  return {
    status: 'needs_review',
    assistant_message: assistantMessage,
    reply_text: assistantMessage,
    parsed_items: [],
    flags,
    suggestions: [],
    pending_actions: [],
    pending_clarifications: [],
    session_state: { total_items: 0, ready_to_submit: false },
    diagnostics: {
      parser_version: PARSER_VERSION,
      parse_mode: 'error',
      items_received: 0,
      items_accepted: 0,
      items_rejected: 0,
      rejected_reasons: flags.map((flag) => flag.reason ?? flag.type),
      pending_action_count: 0,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const callStartTime = Date.now();
  let usageUserId: string | null = null;
  let usageSessionId: string | null = null;
  let usageProvider: Provider | null = chooseProvider();

  try {
    devLog('request_received', { method: req.method, url: req.url });

    const authResult = await getAuthenticatedUser(req);
    if (authResult.error || !authResult.user) {
      devLog('auth_failed', { error: authResult.error, status: authResult.status });
      return jsonResponse({ error: authResult.error || 'Unauthorized' }, authResult.status);
    }

    const payload = (await req.json().catch(() => ({}))) as ParseRequest;
    const rawText = asTrimmedString(payload.raw_text);
    const locationId = asTrimmedString(payload.location_id);
    const sessionId = asNullableString(payload.session_id);
    const requestedUserId = asTrimmedString(payload.user_id);
    const authenticatedUserId = authResult.user.id;
    usageUserId = authenticatedUserId;
    usageSessionId = sessionId;

    devLog('request_parsed', {
      user_id_present: Boolean(authenticatedUserId),
      location_id: locationId,
      session_id: sessionId,
      raw_text_length: rawText?.length ?? 0,
    });

    if (!rawText) return jsonResponse({ error: 'Missing required field: raw_text' }, 400);
    if (!locationId) return jsonResponse({ error: 'Missing required field: location_id' }, 400);
    if (!requestedUserId) return jsonResponse({ error: 'Missing required field: user_id' }, 400);
    if (requestedUserId !== authenticatedUserId) return jsonResponse({ error: 'Authenticated user mismatch' }, 403);

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
    for (const row of configRows ?? []) config[row.key] = row.value;
    if (config.quick_order_enabled === false) {
      return jsonResponse({ error: 'Quick Order is temporarily disabled.', code: 'feature_disabled' }, 503);
    }

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
      return jsonResponse({ error: 'Daily limit reached. Try tomorrow or contact your manager.', code: 'rate_limit_user_daily' }, 429);
    }

    const parserMode = typeof config.quick_order_parser_mode === 'string'
      ? config.quick_order_parser_mode
      : 'auto';
    const hasApiKey = Boolean(geminiApiKey || anthropicApiKey);
    const llmEnabled = parserMode === 'live' || (parserMode === 'auto' && hasApiKey);

    if (llmEnabled) {
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
        (sum: number, row: { total_tokens: number | null }) => sum + (row.total_tokens ?? 0),
        0,
      );
      if (tokensThisMonth >= monthlyBudget) {
        return jsonResponse({ error: 'Monthly AI budget reached. Contact admin.', code: 'rate_limit_org_monthly' }, 429);
      }
      if (tokensThisMonth >= monthlyBudget * warningThreshold) {
        console.warn(`[BUDGET WARNING] at ${((tokensThisMonth / monthlyBudget) * 100).toFixed(1)}% of monthly budget`);
      }
    }

    const [catalog, examples, sessionContext, corrections] = await Promise.all([
      fetchCatalog(locationId),
      fetchExamples(),
      fetchSessionContext(sessionId),
      fetchCorrections(authenticatedUserId, locationId),
    ]);

    devLog('catalog_loaded', {
      catalog_count: catalog.length,
      first_5_names: catalog.slice(0, 5).map((item) => item.name),
      examples_count: examples.length,
      corrections_count: corrections.length,
      session_messages_count: sessionContext.messages.length,
      session_parsed_items_count: sessionContext.parsedItems.length,
    });

    if (catalog.length === 0) {
      devLog('catalog_empty', { location_id: locationId });
      const emptyMessage = 'I had trouble loading the item catalog for this location. Please try again.';
      return jsonResponse({
        status: 'error',
        assistant_message: emptyMessage,
        reply_text: emptyMessage,
        parsed_items: [],
        flags: [{ type: 'unresolved_item', message: 'No catalog items found for this location.' }],
        suggestions: [],
        pending_actions: [],
        pending_clarifications: [],
        session_state: { total_items: 0, ready_to_submit: false },
        diagnostics: {
          parser_version: PARSER_VERSION,
          error_code: 'catalog_empty',
          parse_mode: 'none',
          items_received: 0,
          items_accepted: 0,
          items_rejected: 0,
          rejected_reasons: ['catalog_empty'],
          pending_action_count: 0,
        },
      });
    }

    devLog('parser_start', {
      parser_mode: llmEnabled ? 'deterministic_plus_llm' : 'deterministic_only',
      raw_text_preview: rawText.slice(0, 100),
    });

    const result = await parseQuickOrder({
      rawText,
      catalog,
      examples,
      corrections,
      previousMessages: sessionContext.messages,
      existingParsedItems: sessionContext.parsedItems,
      callLlm: llmEnabled ? callLlm : undefined,
    });

    devLog('parser_result', {
      parser_version: PARSER_VERSION,
      status: result.status,
      parsed_items_count: result.parsed_items.length,
      flags_count: result.flags.length,
      pending_clarifications_count: result.pending_clarifications?.length ?? 0,
      metrics_parse_mode: result.metrics?.parse_mode_used,
      items_needing_clarification: result.parsed_items.filter((item) => item.needs_clarification).length,
      items_unresolved: result.parsed_items.filter((item) => item.unresolved).length,
    });

    const suggestions = await fetchDowSuggestions({
      locationId,
      userId: authenticatedUserId,
      parsedItems: [...sessionContext.parsedItems, ...result.parsed_items],
      previousMessages: sessionContext.messages,
    });

    const durationMs = Date.now() - callStartTime;
    const promptTokens = result.metrics?.llm_used ? Math.ceil(rawText.length / 4) : 0;
    const completionTokens = 0;
    await supabaseAdmin.from('parser_usage_log').insert({
      user_id: authenticatedUserId,
      session_id: sessionId,
      call_type: 'parse-order',
      parser_mode: result.metrics?.llm_used ? 'live' : 'deterministic',
      ai_provider: result.metrics?.llm_used ? usageProvider : null,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      estimated_cost_usd: 0,
      duration_ms: durationMs,
      succeeded: !result.metrics?.llm_failed,
      error_code: result.metrics?.llm_failed ? 'llm_error' : null,
      metrics: result.metrics ?? {},
    });

    const finalResponse = { ...result, suggestions };
    devLog('response_sent', {
      status: finalResponse.status,
      parsed_items_count: finalResponse.parsed_items.length,
      suggestions_count: suggestions.length,
      assistant_message_preview: (finalResponse.assistant_message ?? '').slice(0, 80),
    });
    return jsonResponse(finalResponse);
  } catch (error) {
    console.error('parse-order unexpected error', error);
    if (usageUserId) {
      await supabaseAdmin.from('parser_usage_log').insert({
        user_id: usageUserId,
        session_id: usageSessionId,
        call_type: 'parse-order',
        parser_mode: 'error',
        ai_provider: usageProvider,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        duration_ms: Date.now() - callStartTime,
        succeeded: false,
        error_code: 'parser_error',
        metrics: { error_code: 'parser_error' },
      });
    }
    return jsonResponse(safeParseFailureResponse(), 200);
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
