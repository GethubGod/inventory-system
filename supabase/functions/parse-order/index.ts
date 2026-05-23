// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders, corsHeadersForRequest } from '../_shared/cors.ts';
import { userCanAccessLocation } from '../_shared/location-access.ts';
import { PARSER_VERSION } from './orchestrator.ts';
import { getModelConfig } from './model-router.ts';
import { processQuickOrderMessage } from './process-message.ts';
import { classifyQuickOrderInput } from './input-classifier.ts';
import { parseDeterministicOrder } from './deterministic-parser.ts';
import { buildCatalogSearchIndex, matchCatalogIndex } from './catalog-matcher.ts';
import {
  buildMissingItemCartHash,
  buildMissingItemSuggestions,
  extractMissingItemTimeRange,
  isMissingItemCheckRequest,
  type MissingItemHistoryOrder,
  type MissingItemSuggestion,
  type MissingItemTimeRange,
} from './missing-items-engine.ts';
import { buildUnitAliases, normalizeUnitForComparison, type UnitAliasMap } from './units.ts';
import type {
  CatalogItem,
  EmployeeQuickOrderAlias,
  InventoryReorderRule,
  InventoryStatusTerm,
  ItemAllowedUnitRule,
  ItemOrderLimit,
  ParsedItem,
  ParserCorrection,
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
  message?: unknown;
  source?: unknown;
  mode?: unknown;
  mode_conflict_resolution?: unknown;
  modeConflictResolution?: unknown;
  operation?: unknown;
  action?: unknown;
  mutation_id?: unknown;
  mutationId?: unknown;
  before_cart?: unknown;
  beforeCart?: unknown;
  after_cart?: unknown;
  afterCart?: unknown;
  mutation_type?: unknown;
  mutationType?: unknown;
  assistant_message_text?: unknown;
  assistantMessageText?: unknown;
  location_id?: unknown;
  session_id?: unknown;
  user_id?: unknown;
  existing_items?: unknown;
  recent_messages?: unknown;
  voice_metadata?: unknown;
  current_items?: unknown;
  currentItems?: unknown;
  ignored_item_ids?: unknown;
  ignoredItemIds?: unknown;
  supplier_id?: unknown;
  supplierId?: unknown;
  time_range?: unknown;
  timeRange?: unknown;
  placed_at?: unknown;
  placedAt?: unknown;
  placed_at_text?: unknown;
  placedAtText?: unknown;
  employee_id?: unknown;
  employeeId?: unknown;
  employee_name?: unknown;
  employeeName?: unknown;
  employee_name_text?: unknown;
  employeeNameText?: unknown;
  original_text?: unknown;
  originalText?: unknown;
  preview_items?: unknown;
  previewItems?: unknown;
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
const MAX_MESSAGE_CHARS = 8000;
const MAX_ORDER_QUANTITY = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PREVIOUS_MESSAGES = 20;
const MAX_CORRECTIONS = 25;
const HISTORY_ORDER_LIMIT = 10;

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY');
const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
const configuredProvider = (Deno.env.get('PARSE_ORDER_LLM_PROVIDER') ?? '').toLowerCase();
const modelConfig = getModelConfig(Deno.env);
const debugTimings = Deno.env.get('QUICK_ORDER_DEBUG_TIMINGS') === 'true';

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const globalCatalogCache = new Map<string, CachedCatalog>();

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

function normalizeSource(value: unknown): 'typed' | 'voice' {
  return value === 'voice' ? 'voice' : 'typed';
}

function normalizeComposerMode(value: unknown): 'order' | 'inventory' {
  return value === 'inventory' ? 'inventory' : 'order';
}

function normalizeModeConflictResolution(value: unknown): 'keep_inventory' | undefined {
  return value === 'keep_inventory' ? 'keep_inventory' : undefined;
}

function normalizeParsedItemArray(value: unknown): ParsedItem[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is ParsedItem => Boolean(entry && typeof entry === 'object'))
    : [];
}

function normalizeMessageArray(value: unknown): QuickOrderMessage[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is QuickOrderMessage => Boolean(entry && typeof entry === 'object'))
    : [];
}

function chooseProvider(): Provider | null {
  if (configuredProvider === 'gemini') return geminiApiKey ? 'gemini' : null;
  if (configuredProvider === 'claude') return anthropicApiKey ? 'claude' : null;
  if (geminiApiKey) return 'gemini';
  if (anthropicApiKey) return 'claude';
  return null;
}

function getDefaultInventoryUnit(row: Record<string, unknown>): string | null {
  return asNullableString(row.base_unit) ?? asNullableString(row.pack_unit);
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
    .select('is_suspended, role, full_name')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.is_suspended) {
    return {
      error: 'Suspended accounts cannot use Quick Order',
      status: 403,
      user: null,
    };
  }

  const { data: legacyUser } = await supabaseAdmin
    .from('users')
    .select('name')
    .eq('id', user.id)
    .maybeSingle();

  const metadata = isRecord(user.user_metadata) ? user.user_metadata : {};
  const employeeName =
    asNullableString(profile?.full_name) ??
    asNullableString(legacyUser?.name) ??
    asNullableString(metadata.full_name) ??
    asNullableString(metadata.name);

  return {
    error: null,
    status: 200,
    user,
    role: typeof profile?.role === 'string' ? profile.role : null,
    employeeName,
  };
}

async function fetchGlobalCatalog(): Promise<CatalogItem[]> {
  const cacheKey = 'global-active-inventory';
  const cached = globalCatalogCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .select('id, name, aliases, base_unit, pack_unit, allowed_units, supplier_id, active, hard_cap, soft_cap, safety_stock, target_stock, default_order_unit')
    .eq('active', true)
    .limit(5000);

  if (error) {
    console.warn('parse-order active inventory catalog fetch failed', error);
    return [];
  }

  const items = ((data ?? []) as Record<string, unknown>[])
    .map((row): CatalogItem | null => {
      const id = asTrimmedString(row.id);
      const name = asTrimmedString(row.name);
      if (!id || !name) return null;
      return {
        id,
        name,
        aliases: Array.isArray(row.aliases)
          ? row.aliases.filter((alias): alias is string => typeof alias === 'string')
          : [],
        default_unit: getDefaultInventoryUnit(row),
        base_unit: asNullableString(row.base_unit),
        pack_unit: asNullableString(row.pack_unit),
        supplier_id: asNullableString(row.supplier_id),
        allowed_units: Array.isArray(row.allowed_units)
          ? row.allowed_units.filter((unit): unit is string => typeof unit === 'string')
          : null,
        hard_cap: row.hard_cap != null ? Number(row.hard_cap) : null,
        soft_cap: row.soft_cap != null ? Number(row.soft_cap) : null,
        safety_stock: row.safety_stock != null ? Number(row.safety_stock) : null,
        target_stock: row.target_stock != null ? Number(row.target_stock) : null,
        default_order_unit: asNullableString(row.default_order_unit),
      };
    })
    .filter((item): item is CatalogItem => Boolean(item))
    .sort((a, b) => a.name.localeCompare(b.name));

  globalCatalogCache.set(cacheKey, { expiresAt: Date.now() + CATALOG_CACHE_MS, items });
  return items;
}

async function fetchSessionContext(
  sessionId: string | null,
  userId: string,
  locationId: string,
): Promise<SessionContext> {
  if (!sessionId) return { messages: [], parsedItems: [] };

  const { data, error } = await supabaseAdmin
    .from('quick_order_sessions')
    .select('user_id, location_id, messages, parsed_items')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) throw new Error('Unable to load quick order session.');
  if (!data) return { messages: [], parsedItems: [] };
  if (data.user_id !== userId || (data.location_id && data.location_id !== locationId)) {
    throw new Error('Quick Order session does not belong to this request.');
  }

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

async function fetchEmployeeQuickOrderAliases(input: {
  userId: string;
  locationId: string;
  employeeNameKey: string | null;
}): Promise<EmployeeQuickOrderAlias[]> {
  const byId = new Map<string, EmployeeQuickOrderAlias>();

  async function fetchBy(column: 'employee_user_id' | 'employee_name_key', value: string): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from('employee_quick_order_aliases')
      .select(`
        id,
        employee_name,
        employee_name_key,
        employee_user_id,
        alias_text,
        alias_key,
        inventory_item_id,
        location_id,
        active,
        notes,
        source
      `)
      .eq('active', true)
      .eq(column, value)
      .or(`location_id.is.null,location_id.eq.${input.locationId}`);

    if (error) {
      console.warn('parse-order employee_quick_order_aliases unavailable', error);
      return;
    }

    for (const row of (data ?? []) as EmployeeQuickOrderAlias[]) {
      if (row.id) byId.set(row.id, row);
    }
  }

  await fetchBy('employee_user_id', input.userId);
  if (input.employeeNameKey) {
    await fetchBy('employee_name_key', input.employeeNameKey);
  }

  return [...byId.values()];
}

async function fetchItemOrderLimits(locationId: string): Promise<ItemOrderLimit[]> {
  const { data, error } = await supabaseAdmin
    .from('item_order_limits')
    .select(`
      id,
      item_id,
      location_id,
      supplier_id,
      default_order_unit,
      typical_min_quantity,
      typical_max_quantity,
      soft_max_quantity,
      hard_max_quantity,
      manager_approval_quantity,
      allow_employee_override,
      allow_manager_override,
      max_single_order_quantity,
      max_daily_quantity,
      max_weekly_quantity,
      historical_median_quantity,
      historical_p95_quantity,
      historical_max_quantity
    `)
    .or(`location_id.is.null,location_id.eq.${locationId}`);

  if (error) {
    console.warn('parse-order item_order_limits unavailable', error);
    return [];
  }
  return (data ?? []) as ItemOrderLimit[];
}

async function fetchItemReorderRules(locationId: string): Promise<import('./types.ts').ItemReorderRule[]> {
  const { data, error } = await supabaseAdmin
    .from('item_reorder_rules')
    .select(`
      id,
      item_id,
      location_id,
      supplier_id,
      target_stock_quantity,
      target_stock_unit,
      min_stock_quantity,
      max_stock_quantity,
      usual_order_quantity,
      usual_order_unit,
      min_order_quantity,
      order_increment,
      allow_fractional_stock_count,
      allow_fractional_order,
      rounding_policy,
      criticality,
      shelf_life_days,
      lead_time_days
    `)
    .or(`location_id.is.null,location_id.eq.${locationId}`);

  if (error) {
    console.warn('parse-order item_reorder_rules unavailable', error);
    return [];
  }
  return (data ?? []) as import('./types.ts').ItemReorderRule[];
}

async function fetchInventoryReorderRules(locationId: string): Promise<InventoryReorderRule[]> {
  const { data, error } = await supabaseAdmin
    .from('inventory_reorder_rules')
    .select(`
      id,
      active,
      location_id,
      location_key,
      inventory_item_id,
      applies_to_mode,
      trigger_type,
      trigger_qty,
      trigger_qty_max,
      trigger_unit,
      order_strategy,
      order_qty,
      order_unit,
      priority,
      notes,
      source
    `)
    .eq('active', true)
    .or(`location_id.is.null,location_id.eq.${locationId}`);

  if (error) {
    console.warn('parse-order inventory_reorder_rules unavailable', error);
    return [];
  }
  return (data ?? []) as InventoryReorderRule[];
}

async function fetchInventoryStatusTerms(): Promise<InventoryStatusTerm[]> {
  const { data, error } = await supabaseAdmin
    .from('inventory_status_terms')
    .select(`
      id,
      active,
      phrase,
      phrase_key,
      status,
      remaining_qty,
      remaining_unit_behavior,
      recommendation_action,
      priority,
      notes,
      source
    `)
    .eq('active', true)
    .order('priority', { ascending: true });

  if (error) {
    console.warn('parse-order inventory_status_terms unavailable', error);
    return [];
  }
  return (data ?? []) as InventoryStatusTerm[];
}

async function fetchItemOrderProfiles(locationId: string): Promise<import('./types.ts').ItemOrderProfile[]> {
  const { data, error } = await supabaseAdmin
    .from('item_order_profiles')
    .select(`
      id,
      item_id,
      location_id,
      supplier_id,
      usual_quantity,
      usual_unit,
      p50_quantity,
      p75_quantity,
      p95_quantity,
      last_order_quantity,
      last_order_unit,
      last_ordered_at,
      weekday_pattern_json,
      monthly_pattern_json,
      sample_size,
      weekday,
      ordered_count_recent,
      total_similar_orders,
      confidence_score,
      source
    `)
    .or(`location_id.is.null,location_id.eq.${locationId}`);

  if (error) {
    console.warn('parse-order item_order_profiles unavailable', error);
    return [];
  }
  return (data ?? []) as import('./types.ts').ItemOrderProfile[];
}

async function fetchItemAllowedUnitRules(catalogItemIds: string[]): Promise<ItemAllowedUnitRule[]> {
  let query = supabaseAdmin
    .from('item_allowed_units')
    .select('id,item_id,unit,is_default,conversion_to_base_unit,min_quantity,soft_max_quantity,hard_max_quantity');

  if (catalogItemIds.length > 0) {
    query = query.in('item_id', catalogItemIds.slice(0, 500));
  }

  const { data, error } = await query;

  if (error) {
    console.warn('parse-order item_allowed_units unavailable', error);
    return [];
  }
  return (data ?? []) as ItemAllowedUnitRule[];
}

async function persistCurrentStockSnapshots(input: {
  locationId: string;
  userId: string;
  sessionId: string | null;
  updates: {
    item_id: string;
    quantity: number;
    unit: string | null;
    source: 'typed' | 'voice';
    confidence: number;
    original_text: string;
  }[];
}): Promise<{ ok: boolean; error?: string }> {
  if (input.updates.length === 0) return { ok: true };
  const { error } = await supabaseAdmin.from('current_stock_snapshots').insert(
    input.updates.map((update) => ({
      location_id: input.locationId,
      item_id: update.item_id,
      quantity: update.quantity,
      unit: update.unit,
      source_message: update.original_text,
      source: update.source,
      entered_by_user_id: input.userId,
      confidence: update.confidence,
      quick_order_session_id: sessionIdOrNull(input.sessionId),
    })),
  );
  if (error) {
    console.warn('parse-order current_stock_snapshots insert failed', error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

function normalizeMutationType(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return [
    'smart_suggestion_applied',
    'stock_recommendation_applied',
    'history_reorder_applied',
    'manual_update',
    'clarification_applied',
  ].includes(raw)
    ? raw
    : 'smart_suggestion_applied';
}

function collectAffectedItems(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry) => ({
      item_id: asNullableString(entry.item_id),
      item_name: asNullableString(entry.item_name) ?? asNullableString(entry.display_name),
      quantity: asNumber(entry.quantity),
      unit: asNullableString(entry.unit),
    }))
    .filter((entry) => entry.item_id || entry.item_name);
}

async function recordQuickOrderMutation(input: {
  sessionId: string | null;
  userId: string;
  locationId: string;
  mutationType: string;
  sourceMessage: string | null;
  assistantMessage: string | null;
  beforeCart: unknown;
  afterCart: unknown;
}) {
  const beforeCart = Array.isArray(input.beforeCart) ? input.beforeCart : [];
  const afterCart = Array.isArray(input.afterCart) ? input.afterCart : [];
  const { data, error } = await supabaseAdmin
    .from('quick_order_cart_mutations')
    .insert({
      session_id: sessionIdOrNull(input.sessionId),
      user_id: input.userId,
      location_id: input.locationId,
      mutation_type: normalizeMutationType(input.mutationType),
      source_message: input.sourceMessage,
      assistant_message: input.assistantMessage,
      before_cart: beforeCart,
      after_cart: afterCart,
      affected_items: collectAffectedItems(afterCart),
    })
    .select('id')
    .single();

  if (error) throw new Error(`Unable to record Quick Order mutation: ${error.message}`);
  const mutationId = String((data as { id: string }).id);
  const message = input.assistantMessage || 'Updated the Quick Order list.';
  return jsonResponse({
    status: 'success',
    legacy_status: 'ok',
    display_message: message,
    speech_message: message,
    assistant_message: message,
    reply_text: message,
    parsed_items: [],
    operations: [],
    cart_operations: [],
    stock_updates: [],
    recommendations: [],
    clarifications: [],
    pending_actions: [],
    pending_clarifications: [],
    safety_warnings: [],
    blocked_operations: [],
    flags: [],
    suggestions: [],
    session_state: { total_items: afterCart.length, ready_to_submit: false },
    model_used: 'none',
    confidence: 1,
    timings: { total_ms: 0 },
    mutation_id: mutationId,
    mutationId,
    actions: [{ type: 'revert', label: 'Revert', mutationId }],
    contextPatch: { lastMutationId: mutationId, mutationId },
    assistantMessage: {
      type: 'smart_suggestion',
      text: message,
      actions: [{ type: 'revert', label: 'Revert', mutationId }],
      explanation: {
        reason: 'Quick Order draft mutation recorded',
        confidence: 'high',
        dataSources: ['quick_order_cart_mutations', 'current_cart'],
      },
    },
  });
}

async function revertQuickOrderMutation(input: {
  sessionId: string | null;
  userId: string;
  locationId: string;
  mutationId: string;
  existingItems: unknown;
}) {
  const { data, error } = await supabaseAdmin
    .from('quick_order_cart_mutations')
    .select('id,session_id,user_id,location_id,before_cart,after_cart,revert_status,affected_items')
    .eq('id', input.mutationId)
    .maybeSingle();

  if (error) throw new Error(`Unable to load Quick Order mutation: ${error.message}`);
  if (!data || data.user_id !== input.userId || (data.location_id && data.location_id !== input.locationId)) {
    return jsonResponse({
      status: 'blocked',
      error: 'Mutation not found for this Quick Order session.',
      code: 'mutation_not_found',
      display_message: 'I couldn’t safely find that change to revert.',
    }, 404);
  }
  if (data.session_id && input.sessionId && data.session_id !== input.sessionId) {
    return jsonResponse({
      status: 'blocked',
      error: 'Mutation belongs to a different session.',
      code: 'mutation_session_mismatch',
      display_message: 'I couldn’t safely revert this because it belongs to a different Quick Order session.',
    }, 409);
  }
  if (data.revert_status !== 'active') {
    return jsonResponse({
      status: 'success',
      legacy_status: 'ok',
      display_message: 'That suggestion was already reverted.',
      speech_message: 'That suggestion was already reverted.',
      assistant_message: 'That suggestion was already reverted.',
      reply_text: 'That suggestion was already reverted.',
      parsed_items: [],
      operations: [],
      cart_operations: [],
      stock_updates: [],
      recommendations: [],
      clarifications: [],
      pending_actions: [],
      pending_clarifications: [],
      safety_warnings: [],
      blocked_operations: [],
      flags: [],
      suggestions: [],
      session_state: { total_items: Array.isArray(data.before_cart) ? data.before_cart.length : 0, ready_to_submit: false },
      model_used: 'none',
      confidence: 1,
      timings: { total_ms: 0 },
      contextPatch: { parsedItems: Array.isArray(data.before_cart) ? data.before_cart : [] },
    });
  }

  const currentItems = Array.isArray(input.existingItems) ? input.existingItems : [];
  const afterCart = Array.isArray(data.after_cart) ? data.after_cart : [];
  if (!sameDraftSignature(currentItems, afterCart)) {
    return jsonResponse({
      status: 'needs_clarification',
      legacy_status: 'needs_clarification',
      display_message: 'I couldn’t safely revert this because the cart changed after that. Review the affected item instead.',
      speech_message: 'I couldn’t safely revert this because the cart changed after that.',
      assistant_message: 'I couldn’t safely revert this because the cart changed after that. Review the affected item instead.',
      reply_text: 'I couldn’t safely revert this because the cart changed after that. Review the affected item instead.',
      parsed_items: [],
      operations: [],
      cart_operations: [],
      stock_updates: [],
      recommendations: [],
      clarifications: [],
      pending_actions: [],
      pending_clarifications: [],
      safety_warnings: [],
      blocked_operations: [],
      flags: [],
      suggestions: [],
      session_state: { total_items: currentItems.length, ready_to_submit: false },
      model_used: 'none',
      confidence: 0.6,
      timings: { total_ms: 0 },
    }, 409);
  }

  const beforeCart = Array.isArray(data.before_cart) ? data.before_cart : [];
  const update = await supabaseAdmin
    .from('quick_order_cart_mutations')
    .update({ revert_status: 'reverted', reverted_at: new Date().toISOString(), reverted_by: input.userId })
    .eq('id', input.mutationId)
    .eq('revert_status', 'active');
  if (update.error) throw new Error(`Unable to mark mutation reverted: ${update.error.message}`);

  const message = 'Reverted the suggestion. Your Quick Order list is back to the previous state.';
  return jsonResponse({
    status: 'success',
    legacy_status: 'ok',
    display_message: message,
    speech_message: message,
    assistant_message: message,
    reply_text: message,
    parsed_items: [],
    operations: [],
    cart_operations: [],
    stock_updates: [],
    recommendations: [],
    clarifications: [],
    pending_actions: [],
    pending_clarifications: [],
    safety_warnings: [],
    blocked_operations: [],
    flags: [],
    suggestions: [],
    session_state: { total_items: beforeCart.length, ready_to_submit: false },
    model_used: 'none',
    confidence: 1,
    timings: { total_ms: 0 },
    contextPatch: { parsedItems: beforeCart, lastMutationId: input.mutationId },
    context_patch: { parsed_items: beforeCart, last_mutation_id: input.mutationId },
    assistantMessage: { type: 'success', text: message, actions: [] },
  });
}

function sameDraftSignature(left: unknown[], right: unknown[]): boolean {
  return JSON.stringify(draftSignature(left)) === JSON.stringify(draftSignature(right));
}

function draftSignature(items: unknown[]): unknown[] {
  return items
    .filter(isRecord)
    .map((item) => ({
      item_id: asNullableString(item.item_id),
      name: asNullableString(item.item_name) ?? asNullableString(item.display_name) ?? asNullableString(item.raw_token),
      quantity: asNumber(item.quantity),
      unit: asNullableString(item.unit),
      key: asNullableString(item.client_key) ?? asNullableString(item.line_id) ?? asNullableString(item.id),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function sanitizeExistingItems(
  items: ParsedItem[],
  catalog: CatalogItem[],
  unitAliases: UnitAliasMap,
): ParsedItem[] {
  const catalogIds = new Set(catalog.map((item) => item.id));
  return items
    .filter((item) => typeof item.item_id === 'string' && catalogIds.has(item.item_id))
    .map((item) => {
      const quantity = clampOrderQuantity(item.quantity);
      const unit = item.unit
        ? normalizeUnitForComparison(item.unit, unitAliases) ?? item.unit.trim().toLowerCase()
        : null;
      return {
        ...item,
        quantity,
        unit,
        unit_normalized: unit,
      };
    });
}

function clampOrderQuantity(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(value, MAX_ORDER_QUANTITY);
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
        const itemName = asNullableString(row.item_name) ?? 'Suggested item';
        const unit = asNullableString(row.unit);
        const unitType = asNullableString(row.unit_type);
        const confidence = clampConfidence(row.frequency ?? row.confidence ?? 0.5);
        return {
          type: 'usual_item',
          title: itemName,
          message: `${itemName} is usually ordered for this location.`,
          items: [{
            item_id: itemId,
            item_name: itemName,
            quantity: Math.max(1, Math.round(quantity)),
            unit,
            unit_type: unitType,
          }],
          confidence,
          action: 'add',
          item_id: itemId,
          item_name: itemName,
          suggested_qty: Math.max(1, Math.round(quantity)),
          unit,
          unit_type: unitType,
          reason: asNullableString(row.reason) ?? 'Usually ordered on this day',
        };
      })
      .filter((row: ParseSuggestion | null): row is ParseSuggestion => Boolean(row))
      .slice(0, 3);
  } catch (error) {
    console.warn('parse-order get_dow_suggestions unexpected failure', error);
    return [];
  }
}

async function fetchUsualOrderSuggestions(input: {
  locationId: string;
  userId: string;
  parsedItems: ParsedItem[];
}): Promise<ParseSuggestion[]> {
  const parsedItemIds = new Set(input.parsedItems.map((item) => item.item_id).filter(Boolean));

  try {
    const { data, error } = await supabaseAdmin.rpc('get_usual_order', {
      p_location_id: input.locationId,
      p_min_frequency: 0.25,
      p_lookback_months: 6,
      p_user_id: input.userId,
      p_limit: 12,
    });

    if (error) {
      console.warn('parse-order get_usual_order failed', error);
      return [];
    }

    return parseJsonRows(data)
      .map((row: unknown): ParseSuggestion | null => {
        if (!isRecord(row)) return null;
        const itemId = asNullableString(row.item_id);
        if (!itemId || parsedItemIds.has(itemId)) return null;
        const quantity = asNumber(row.suggested_qty) ?? asNumber(row.avg_qty) ?? 1;
        const itemName = asNullableString(row.item_name) ?? 'Suggested item';
        const unit = asNullableString(row.unit);
        const unitType = asNullableString(row.unit_type);
        const confidence = clampConfidence(row.frequency ?? row.confidence ?? 0.5);
        return {
          type: 'usual_item',
          title: itemName,
          message: `${itemName} is part of your usual order for this location.`,
          items: [{
            item_id: itemId,
            item_name: itemName,
            quantity: Math.max(1, Math.round(quantity)),
            unit,
            unit_type: unitType,
          }],
          confidence,
          action: 'add',
          item_id: itemId,
          item_name: itemName,
          suggested_qty: Math.max(1, Math.round(quantity)),
          unit,
          unit_type: unitType,
          reason: asNullableString(row.reason) ?? 'Usually ordered at this location',
        };
      })
      .filter((row: ParseSuggestion | null): row is ParseSuggestion => Boolean(row))
      .slice(0, 6);
  } catch (error) {
    console.warn('parse-order get_usual_order unexpected failure', error);
    return [];
  }
}

type HistoryOrderItem = {
  item_id: string;
  item_name: string;
  quantity: number;
  unit_type: string | null;
  unit: string | null;
};

type HistoryOrder = {
  id: string;
  created_at: string;
  items: HistoryOrderItem[];
};

function parseJsonRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function sessionIdOrNull(value: string | null): string | null {
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

function normalizeHistoryOrder(value: unknown): HistoryOrder | null {
  if (!isRecord(value)) return null;
  const id = asNullableString(value.id);
  const createdAt = asNullableString(value.created_at);
  const items = parseJsonRows(value.items)
    .map((entry): HistoryOrderItem | null => {
      if (!isRecord(entry)) return null;
      const itemId = asNullableString(entry.item_id);
      const itemName = asNullableString(entry.item_name);
      const quantity = asNumber(entry.quantity);
      if (!itemId || !itemName || quantity == null || quantity <= 0) return null;
      return {
        item_id: itemId,
        item_name: itemName,
        quantity,
        unit_type: asNullableString(entry.unit_type),
        unit: asNullableString(entry.unit),
      };
    })
    .filter((entry): entry is HistoryOrderItem => Boolean(entry));
  if (!id || !createdAt || items.length === 0) return null;
  return { id, created_at: createdAt, items };
}

async function fetchRecentOrders(input: { locationId: string; userId: string; limit?: number }): Promise<HistoryOrder[]> {
  const { data, error } = await supabaseAdmin.rpc('get_recent_orders', {
    p_location_id: input.locationId,
    p_limit: input.limit ?? HISTORY_ORDER_LIMIT,
    p_user_id: input.userId,
  });
  if (error) {
    console.warn('parse-order get_recent_orders failed', error);
    return [];
  }
  return parseJsonRows(data).map(normalizeHistoryOrder).filter((row): row is HistoryOrder => Boolean(row));
}

async function fetchMissingItemHistoryOrders(input: {
  locationId: string;
  userId: string;
  limit?: number;
}): Promise<MissingItemHistoryOrder[]> {
  const submittedSource = UUID_PATTERN.test(input.userId)
    ? await fetchRecentOrders({
        locationId: input.locationId,
        userId: input.userId,
        limit: input.limit ?? 40,
      })
    : [];
  const submitted = submittedSource.map((order): MissingItemHistoryOrder => ({
    id: order.id,
    placedAt: order.created_at,
    locationId: input.locationId,
    source: 'submitted_orders',
    items: order.items.map((item) => ({
      itemId: item.item_id,
      itemName: item.item_name,
      quantity: item.quantity,
      unit: item.unit,
    })),
  }));

  const { data: imports, error: importError } = await supabaseAdmin
    .from('historical_order_imports')
    .select('id,employee_id,location_id,supplier_id,placed_at,status')
    .eq('location_id', input.locationId)
    .eq('status', 'imported')
    .order('placed_at', { ascending: false })
    .limit(input.limit ?? 40);

  if (importError) {
    console.warn('parse-order historical_order_imports unavailable', importError);
    return submitted;
  }

  const importRows = ((imports ?? []) as Record<string, unknown>[]);
  const importIds = importRows.map((row) => asNullableString(row.id)).filter((id): id is string => Boolean(id));
  if (importIds.length === 0) return submitted;

  const { data: items, error: itemError } = await supabaseAdmin
    .from('historical_order_import_items')
    .select('import_id,item_id,item_name_snapshot,quantity,unit,supplier_id')
    .in('import_id', importIds);

  if (itemError) {
    console.warn('parse-order historical_order_import_items unavailable', itemError);
    return submitted;
  }

  const itemsByImport = new Map<string, MissingItemHistoryOrder['items']>();
  for (const row of (items ?? []) as Record<string, unknown>[]) {
    const importId = asNullableString(row.import_id);
    const itemId = asNullableString(row.item_id);
    const itemName = asNullableString(row.item_name_snapshot);
    const quantity = asNumber(row.quantity);
    if (!importId || !itemId || !itemName || quantity == null || quantity <= 0) continue;
    const list = itemsByImport.get(importId) ?? [];
    list.push({
      itemId,
      itemName,
      quantity,
      unit: asNullableString(row.unit),
      supplierId: asNullableString(row.supplier_id),
    });
    itemsByImport.set(importId, list);
  }

  const imported = importRows
    .map((row): MissingItemHistoryOrder | null => {
      const id = asNullableString(row.id);
      const placedAt = asNullableString(row.placed_at);
      if (!id || !placedAt) return null;
      const orderItems = itemsByImport.get(id) ?? [];
      if (orderItems.length === 0) return null;
      return {
        id,
        placedAt,
        locationId: asNullableString(row.location_id),
        supplierId: asNullableString(row.supplier_id),
        employeeId: asNullableString(row.employee_id),
        source: 'manager_import',
        items: orderItems,
      };
    })
    .filter((row): row is MissingItemHistoryOrder => Boolean(row));

  return [...submitted, ...imported]
    .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
}

async function runMissingItemCheck(input: {
  locationId: string;
  userId: string;
  catalog: CatalogItem[];
  currentItems: ParsedItem[];
  supplierId?: string | null;
  timeRange?: MissingItemTimeRange | null;
  ignoredItemIds?: string[];
}): Promise<{
  suggestions: MissingItemSuggestion[];
  cartHash: string;
  message: string;
}> {
  const historyOrders = await fetchMissingItemHistoryOrders({
    locationId: input.locationId,
    userId: input.userId,
    limit: 60,
  });
  const suggestions = buildMissingItemSuggestions({
    currentItems: input.currentItems,
    historyOrders,
    catalog: input.catalog,
    locationId: input.locationId,
    supplierId: input.supplierId,
    timeRange: input.timeRange,
    ignoredItemIds: input.ignoredItemIds,
  });
  const cartHash = buildMissingItemCartHash(input.currentItems);
  const message = suggestions.length === 0
    ? 'Your order looks complete based on recent similar orders.'
    : suggestions.length === 1
      ? `You may be missing ${suggestions[0].itemName}. I recommended it because it appears in your recent similar orders.`
      : `You may be missing ${suggestions.length} usual items. I recommended these because they appear in your recent similar orders.`;
  return { suggestions, cartHash, message };
}

function suggestionsToParseSuggestions(suggestions: MissingItemSuggestion[]): ParseSuggestion[] {
  return suggestions.map((suggestion) => ({
    type: 'missing_item',
    title: suggestion.itemName,
    message: suggestion.reason,
    items: [{
      item_id: suggestion.itemId,
      item_name: suggestion.itemName,
      quantity: suggestion.suggestedQuantity,
      unit: suggestion.unit,
      unit_type: null,
    }],
    confidence: suggestion.confidence === 'high' ? 0.92 : suggestion.confidence === 'medium' ? 0.74 : 0.55,
    action: 'add',
    item_id: suggestion.itemId,
    item_name: suggestion.itemName,
    suggested_qty: suggestion.suggestedQuantity,
    unit: suggestion.unit,
    unit_type: null,
    reason: suggestion.reason,
  }));
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function normalizeMissingTimeRange(value: unknown): MissingItemTimeRange | null {
  return value === 'yesterday' || value === 'last_week' || value === 'recent' || value === 'usual' || value === 'last_month'
    ? value
    : null;
}

type HistoryImportPreviewRow = {
  id: string;
  originalLine: string;
  matchedItemId: string | null;
  matchedItemName: string | null;
  quantity: number | null;
  unit: string | null;
  supplierId: string | null;
  status: 'matched' | 'needs_review' | 'invalid' | 'ignored';
  confidence: number;
  reason: string | null;
};

type HistoryImportDatePreview = {
  placedAt: string | null;
  placedAtText: string;
  dateStatus: 'valid' | 'needs_review' | 'invalid';
  dateReason: string | null;
};

function normalizeEmployeeNameKey(value: string | null): string | null {
  if (!value?.trim()) return null;
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildHistoryImportDatePreview(value: unknown, now = new Date()): HistoryImportDatePreview {
  const text = asNullableString(value) ?? '';
  const parsed = parseHistoryImportPlacedAt(text, now);
  return {
    placedAt: parsed.placedAt,
    placedAtText: text,
    dateStatus: parsed.status,
    dateReason: parsed.reason,
  };
}

function parseHistoryImportPlacedAt(text: string, now = new Date()): {
  placedAt: string | null;
  status: 'valid' | 'needs_review' | 'invalid';
  reason: string | null;
} {
  const raw = text.normalize('NFKC').trim();
  if (!raw) return { placedAt: null, status: 'invalid', reason: 'Enter the date for this history.' };

  const direct = new Date(raw);
  if (Number.isFinite(direct.getTime())) {
    return { placedAt: normalizeHistoricalDate(direct, now).toISOString(), status: 'valid', reason: null };
  }

  const numeric = raw.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?:\s+(.+))?$/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const year = numeric[3] ? normalizeYear(Number(numeric[3])) : now.getFullYear();
    const candidate = applyLooseTime(new Date(year, month - 1, day, 12, 0, 0, 0), numeric[4] ?? raw);
    if (isValidDateParts(candidate, year, month, day)) {
      return { placedAt: normalizeHistoricalDate(candidate, now).toISOString(), status: 'valid', reason: null };
    }
  }

  const monthNames = 'jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december';
  const monthPattern = new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:,?\\s+(\\d{2,4}))?\\b`, 'i');
  const monthMatch = raw.match(monthPattern);
  if (monthMatch) {
    const month = monthNameToIndex(monthMatch[1]) + 1;
    const day = Number(monthMatch[2]);
    const year = monthMatch[3] ? normalizeYear(Number(monthMatch[3])) : now.getFullYear();
    const candidate = applyLooseTime(new Date(year, month - 1, day, 12, 0, 0, 0), raw);
    if (isValidDateParts(candidate, year, month, day)) {
      return { placedAt: normalizeHistoricalDate(candidate, now).toISOString(), status: 'valid', reason: null };
    }
  }

  const weekday = weekdayNameToIndex(raw);
  if (weekday != null) {
    const candidate = mostRecentWeekday(weekday, now);
    return { placedAt: applyLooseTime(candidate, raw).toISOString(), status: 'valid', reason: null };
  }

  return { placedAt: null, status: 'invalid', reason: 'Could not understand this date. Try 5/22, May 22, Friday morning, or 2026-05-22.' };
}

function normalizeHistoricalDate(date: Date, now: Date): Date {
  const next = new Date(date);
  if (next.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    next.setFullYear(next.getFullYear() - 1);
  }
  return next;
}

function applyLooseTime(date: Date, text: string): Date {
  const next = new Date(date);
  const lower = text.toLowerCase();
  const clock = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2] ?? 0);
    if (clock[3] === 'pm' && hour < 12) hour += 12;
    if (clock[3] === 'am' && hour === 12) hour = 0;
    next.setHours(hour, minute, 0, 0);
    return next;
  }
  if (/\bmorning\b/.test(lower)) next.setHours(9, 0, 0, 0);
  else if (/\bafternoon\b/.test(lower)) next.setHours(14, 0, 0, 0);
  else if (/\bevening|night\b/.test(lower)) next.setHours(18, 0, 0, 0);
  else next.setHours(12, 0, 0, 0);
  return next;
}

function normalizeYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

function isValidDateParts(date: Date, year: number, month: number, day: number): boolean {
  return Number.isFinite(date.getTime()) &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
}

function monthNameToIndex(value: string): number {
  const key = value.toLowerCase().slice(0, 3);
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(key);
}

function weekdayNameToIndex(value: string): number | null {
  const match = value.toLowerCase().match(/\b(sun|sunday|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b/);
  if (!match) return null;
  const key = match[1].slice(0, 3);
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(key);
}

function mostRecentWeekday(weekday: number, now: Date): Date {
  const next = new Date(now);
  const diff = (next.getDay() - weekday + 7) % 7;
  next.setDate(next.getDate() - diff);
  next.setHours(12, 0, 0, 0);
  return next;
}

function buildHistoryImportPreview(input: {
  originalText: string;
  catalog: CatalogItem[];
  corrections: ParserCorrection[];
  unitAliases: UnitAliasMap;
  allowedUnitRules: ItemAllowedUnitRule[];
}): HistoryImportPreviewRow[] {
  const index = buildCatalogSearchIndex(input.catalog, input.corrections);
  const unitRulesByItem = new Map<string, string[]>();
  for (const rule of input.allowedUnitRules) {
    if (!rule.item_id || !rule.unit) continue;
    const list = unitRulesByItem.get(rule.item_id) ?? [];
    list.push(rule.unit);
    unitRulesByItem.set(rule.item_id, list);
  }
  return parseDeterministicOrder(input.originalText, input.unitAliases)
    .map((line, indexInList): HistoryImportPreviewRow => {
      const match = line.item_text ? matchCatalogIndex(line.item_text, index) : null;
      const itemId = match?.item_id ?? null;
      const itemName = match?.item_name ?? null;
      const unit = line.unit_normalized ?? line.unit ?? null;
      const allowedUnits = itemId ? unitRulesByItem.get(itemId) ?? [] : [];
      const unitValid = !unit || allowedUnits.length === 0 || allowedUnits
        .map((entry) => normalizeUnitForComparison(entry))
        .includes(normalizeUnitForComparison(unit));
      const confidence = match?.confidence ?? 0;
      const status: HistoryImportPreviewRow['status'] = !itemId
        ? 'invalid'
        : confidence < 0.86 || line.quantity == null || !unit || !unitValid
          ? 'needs_review'
          : 'matched';
      return {
        id: line.line_id || `line_${indexInList}`,
        originalLine: line.raw_text,
        matchedItemId: itemId,
        matchedItemName: itemName,
        quantity: line.quantity,
        unit,
        supplierId: itemId ? input.catalog.find((item) => item.id === itemId)?.supplier_id ?? null : null,
        status,
        confidence,
        reason: !itemId
          ? 'No catalog match'
          : line.quantity == null
            ? 'Missing quantity'
            : !unit
              ? 'Missing unit'
              : !unitValid
                ? 'Unit needs review'
                : confidence < 0.86
                  ? 'Low-confidence match'
                  : null,
      };
    });
}

function normalizePreviewRows(value: unknown): HistoryImportPreviewRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((row, index): HistoryImportPreviewRow | null => {
      const status = row.status === 'matched' || row.status === 'needs_review' || row.status === 'invalid' || row.status === 'ignored'
        ? row.status
        : 'invalid';
      const quantity = asNumber(row.quantity);
      return {
        id: asNullableString(row.id) ?? `row_${index}`,
        originalLine: asNullableString(row.originalLine) ?? asNullableString(row.original_line) ?? '',
        matchedItemId: asNullableString(row.matchedItemId) ?? asNullableString(row.matched_item_id),
        matchedItemName: asNullableString(row.matchedItemName) ?? asNullableString(row.matched_item_name),
        quantity,
        unit: asNullableString(row.unit),
        supplierId: asNullableString(row.supplierId) ?? asNullableString(row.supplier_id),
        status,
        confidence: clampConfidence(row.confidence),
        reason: asNullableString(row.reason),
      };
    })
    .filter((row): row is HistoryImportPreviewRow => Boolean(row));
}

async function importHistoricalOrder(input: {
  importedBy: string;
  employeeId: string | null;
  employeeNameText: string | null;
  locationId: string;
  supplierId: string | null;
  placedAt: string;
  placedAtText: string | null;
  originalText: string;
  previewRows: HistoryImportPreviewRow[];
}): Promise<{ importId: string; importedCount: number }> {
  const validRows = input.previewRows.filter((row) =>
    row.status !== 'ignored' &&
    row.matchedItemId &&
    row.matchedItemName &&
    row.quantity != null &&
    row.quantity > 0 &&
    row.unit,
  );
  if (validRows.length === 0) throw new Error('No valid rows to import.');

  const { data: importRow, error: importError } = await supabaseAdmin
    .from('historical_order_imports')
    .insert({
      imported_by: input.importedBy,
      employee_id: input.employeeId,
      employee_name_text: input.employeeNameText,
      employee_name_key: normalizeEmployeeNameKey(input.employeeNameText),
      location_id: input.locationId,
      supplier_id: input.supplierId,
      placed_at: input.placedAt,
      placed_at_text: input.placedAtText,
      original_text: input.originalText,
      status: 'imported',
    })
    .select('id')
    .single();

  if (importError || !importRow?.id) throw new Error(importError?.message ?? 'Unable to create historical import.');

  const importId = String(importRow.id);
  const { error: itemError } = await supabaseAdmin
    .from('historical_order_import_items')
    .insert(validRows.map((row) => ({
      import_id: importId,
      item_id: row.matchedItemId,
      item_name_snapshot: row.matchedItemName,
      quantity: row.quantity,
      unit: row.unit,
      supplier_id: row.supplierId ?? input.supplierId,
      original_line: row.originalLine,
    })));

  if (itemError) throw new Error(itemError.message);
  await refreshImportedProfiles(input.locationId);
  return { importId, importedCount: validRows.length };
}

async function refreshImportedProfiles(locationId: string): Promise<void> {
  const history = await fetchMissingItemHistoryOrders({ locationId, userId: '', limit: 80 });
  const catalog = await fetchGlobalCatalog();
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  const stats = new Map<string, {
    itemId: string;
    locationId: string;
    supplierId: string | null;
    quantities: number[];
    units: (string | null)[];
    lastOrderedAt: string;
    sampleSize: number;
    imported: boolean;
  }>();
  for (const order of history.filter((entry) => entry.locationId === locationId)) {
    for (const item of order.items) {
      if (!catalogById.has(item.itemId)) continue;
      const key = `${item.itemId}:${order.locationId ?? locationId}:${item.supplierId ?? order.supplierId ?? ''}`;
      const current = stats.get(key) ?? {
        itemId: item.itemId,
        locationId: order.locationId ?? locationId,
        supplierId: item.supplierId ?? order.supplierId ?? null,
        quantities: [],
        units: [],
        lastOrderedAt: order.placedAt,
        sampleSize: 0,
        imported: false,
      };
      current.quantities.push(item.quantity);
      current.units.push(item.unit);
      current.sampleSize += 1;
      current.imported = current.imported || order.source === 'manager_import';
      if (new Date(order.placedAt).getTime() > new Date(current.lastOrderedAt).getTime()) {
        current.lastOrderedAt = order.placedAt;
      }
      stats.set(key, current);
    }
  }

  const rows = [...stats.values()].map((stat) => {
    const usual = medianNumber(stat.quantities) ?? 1;
    return {
      item_id: stat.itemId,
      location_id: stat.locationId,
      supplier_id: stat.supplierId,
      usual_quantity: usual,
      usual_unit: mostFrequentString(stat.units),
      p50_quantity: usual,
      p75_quantity: percentile(stat.quantities, 0.75),
      p95_quantity: percentile(stat.quantities, 0.95),
      last_order_quantity: stat.quantities[stat.quantities.length - 1] ?? usual,
      last_order_unit: mostFrequentString(stat.units),
      last_ordered_at: stat.lastOrderedAt,
      sample_size: stat.sampleSize,
      ordered_count_recent: stat.sampleSize,
      total_similar_orders: stat.sampleSize,
      confidence_score: Math.min(1, stat.sampleSize / 8),
      source: stat.imported ? 'manager_import' : 'submitted_orders',
      updated_at: new Date().toISOString(),
    };
  });
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin
    .from('item_order_profiles')
    .upsert(rows, { onConflict: 'item_id,location_id,supplier_id' });
  if (error) console.warn('parse-order imported profile upsert failed', error);
}

function medianNumber(values: number[]): number | null {
  return percentile(values, 0.5);
}

function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

function mostFrequentString(values: (string | null)[]): string | null {
  const counts = new Map<string, { raw: string; count: number }>();
  for (const value of values) {
    if (!value?.trim()) continue;
    const key = normalizeUnitForComparison(value);
    if (!key) continue;
    const current = counts.get(key) ?? { raw: value.trim(), count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.raw ?? null;
}

function orderToSuggestion(order: HistoryOrder, type: 'reorder_recent' | 'reorder_last_week', title: string, message: string): ParseSuggestion {
  return {
    type,
    title,
    message,
    items: order.items.map((item) => ({
      item_id: item.item_id,
      item_name: item.item_name,
      quantity: item.quantity,
      unit: item.unit,
      unit_type: item.unit_type,
    })),
    confidence: 0.95,
    action: 'preview',
    reason: order.id,
  };
}

async function buildIntentSuggestions(input: {
  classification?: string;
  rawText: string;
  locationId: string;
  userId: string;
  parsedItems: ParsedItem[];
}): Promise<{ suggestions: ParseSuggestion[]; message: string | null; historyResult?: string }> {
  const normalized = input.rawText.normalize('NFKC').trim().toLowerCase();
  const wantsLastWeek = /\blast week\b/.test(normalized);
  const wantsLastMonth = /\blast month\b/.test(normalized);
  const wantsCompareLastWeek = /\bcompare\b.+\blast week\b/.test(normalized);
  const wantsRecent = /\breorder recent\b|\blast order\b|\brecent order\b/.test(normalized);
  const wantsUsual = /\busual\b|usually order/.test(normalized);

  if (input.classification === 'history_request' || wantsLastWeek || wantsLastMonth || wantsCompareLastWeek || wantsRecent || wantsUsual) {
    const orders = await fetchRecentOrders({
      locationId: input.locationId,
      userId: input.userId,
      limit: wantsLastMonth || wantsCompareLastWeek ? 100 : HISTORY_ORDER_LIMIT,
    });
    if (wantsLastMonth) {
      const range = previousCalendarMonthRange(new Date());
      const matching = orders.filter((order) => {
        const time = new Date(order.created_at).getTime();
        return Number.isFinite(time) && time >= range.start.getTime() && time < range.end.getTime();
      });
      if (matching.length === 0) {
        return { suggestions: [], message: `No orders were found for ${range.label}.`, historyResult: 'not_found' };
      }
      const itemNameMatch = normalized.match(/how much\s+(.+?)\s+did\s+i\s+order\s+last month/);
      const itemFilter = itemNameMatch?.[1]?.trim();
      const summary = summarizeHistoryOrders(matching, itemFilter);
      return {
        suggestions: [],
        message: `${range.label}: ${summary}`,
        historyResult: 'found',
      };
    }

    if (wantsCompareLastWeek) {
      const currentItems = input.parsedItems.filter((item) => item.item_id && item.quantity != null);
      const target = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const lastWeekOrder = orders
        .map((order) => ({ order, distance: Math.abs(new Date(order.created_at).getTime() - target) }))
        .filter((entry) => Number.isFinite(entry.distance))
        .sort((a, b) => a.distance - b.distance)[0]?.order ?? null;
      if (!lastWeekOrder || currentItems.length === 0) {
        return { suggestions: [], message: 'I need a current order and a matching order from last week to compare.', historyResult: 'not_found' };
      }
      return {
        suggestions: [],
        message: compareCurrentToHistory(currentItems, lastWeekOrder),
        historyResult: 'found',
      };
    }

    if (wantsLastWeek) {
      const target = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const lastWeekOrder = orders
        .map((order) => ({ order, distance: Math.abs(new Date(order.created_at).getTime() - target) }))
        .filter((entry) => Number.isFinite(entry.distance))
        .sort((a, b) => a.distance - b.distance)[0]?.order ?? null;
      if (!lastWeekOrder || Math.abs(new Date(lastWeekOrder.created_at).getTime() - target) > 4 * 24 * 60 * 60 * 1000) {
        return { suggestions: [], message: 'No matching order from last week was found for this location.', historyResult: 'not_found' };
      }
      return {
        suggestions: [orderToSuggestion(lastWeekOrder, 'reorder_last_week', 'Reorder last week', 'Preview the closest order from last week.')],
        message: 'I found an order from last week. Preview it before adding.',
        historyResult: 'found',
      };
    }

    if (wantsUsual) {
      const usual = await fetchUsualOrderSuggestions({
        locationId: input.locationId,
        userId: input.userId,
        parsedItems: input.parsedItems,
      });
      const fallback = usual.length > 0
        ? []
        : await fetchDowSuggestions({
          locationId: input.locationId,
          userId: input.userId,
          parsedItems: input.parsedItems,
          previousMessages: [],
        });
      const suggestions = usual.length > 0 ? usual : fallback;
      return {
        suggestions,
        message: suggestions.length > 0 ? 'Here are items you usually order for this location.' : 'I don’t have enough history to suggest a usual order yet.',
        historyResult: suggestions.length > 0 ? 'found' : 'not_found',
      };
    }

    const recent = orders[0] ?? null;
    if (!recent) {
      return { suggestions: [], message: 'I couldn’t find a recent order for this location yet.', historyResult: 'not_found' };
    }
    return {
      suggestions: [orderToSuggestion(recent, 'reorder_recent', 'Reorder recent', 'Preview your most recent order before adding it.')],
      message: 'I found your most recent order. Preview it before adding.',
      historyResult: 'found',
    };
  }

  if (input.classification === 'suggestion_request') {
    const suggestions = await fetchDowSuggestions({
      locationId: input.locationId,
      userId: input.userId,
      parsedItems: input.parsedItems,
      previousMessages: [],
    });
    return {
      suggestions,
      message: suggestions.length > 0 ? 'Here are suggestions for this location.' : 'I don’t have enough order history to suggest a usual order yet.',
      historyResult: suggestions.length > 0 ? 'found' : 'not_found',
    };
  }

  return { suggestions: [], message: null };
}

function previousCalendarMonthRange(now: Date): { start: Date; end: Date; label: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const label = start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { start, end, label };
}

function summarizeHistoryOrders(orders: HistoryOrder[], itemFilter?: string): string {
  const totals = new Map<string, { name: string; quantity: number; unit: string | null; count: number }>();
  const normalizedFilter = itemFilter?.toLowerCase() ?? null;
  for (const order of orders) {
    for (const item of order.items) {
      if (normalizedFilter && !item.item_name.toLowerCase().includes(normalizedFilter)) continue;
      const key = `${item.item_id}:${item.unit ?? ''}`;
      const current = totals.get(key) ?? { name: item.item_name, quantity: 0, unit: item.unit, count: 0 };
      current.quantity += item.quantity;
      current.count += 1;
      totals.set(key, current);
    }
  }
  const rows = [...totals.values()].sort((a, b) => b.quantity - a.quantity);
  if (rows.length === 0) return 'I found orders, but no matching item lines.';
  return rows.slice(0, 6).map((row) => `${row.name} ${formatHistoryQuantity(row.quantity, row.unit)}`).join(', ');
}

function compareCurrentToHistory(currentItems: ParsedItem[], order: HistoryOrder): string {
  const historyByItem = new Map(order.items.map((item) => [item.item_id, item]));
  const parts = currentItems.slice(0, 6).map((item) => {
    const historical = item.item_id ? historyByItem.get(item.item_id) : null;
    const name = item.item_name ?? item.display_name ?? item.raw_token ?? 'Item';
    if (!historical) return `${name} was not in the closest order from last week`;
    const diff = (item.quantity ?? 0) - historical.quantity;
    if (Math.abs(diff) < 0.0001) return `${name} matches last week at ${formatHistoryQuantity(historical.quantity, historical.unit)}`;
    return `${name} is ${formatHistoryQuantity(Math.abs(diff), item.unit ?? historical.unit)} ${diff > 0 ? 'higher' : 'lower'} than last week`;
  });
  return parts.join('. ') + '.';
}

function formatHistoryQuantity(quantity: number, unit: string | null): string {
  const rounded = Number.isInteger(quantity) ? String(quantity) : String(Math.round(quantity * 100) / 100);
  return `${rounded}${unit ? ` ${unit}` : ''}`;
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

async function callGemini(prompt: string, model: string | null = null) {
  if (!geminiApiKey) throw new Error('GEMINI_API_KEY is not configured');
  const modelName = model || modelConfig.fallbackModel || 'gemini-2.5-flash';
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`,
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

async function callClaude(prompt: string, model: string | null = null) {
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
        model: model || 'claude-3-5-haiku-20241022',
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

async function callLlm(prompt: string, model: string | null = null) {
  const provider = chooseProvider();
  if (!provider) throw new Error('No LLM provider configured.');
  return provider === 'gemini' ? await callGemini(prompt, model) : await callClaude(prompt, model);
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeadersForRequest(req) });
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
    const rawText = asTrimmedString(payload.message) ?? asTrimmedString(payload.raw_text);
    const operation = asNullableString(payload.operation) ?? asNullableString(payload.action) ?? 'parse';
    const source = normalizeSource(payload.source);
    const composerMode = normalizeComposerMode(payload.mode);
    const modeConflictResolution = normalizeModeConflictResolution(
      payload.mode_conflict_resolution ?? payload.modeConflictResolution,
    );
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
      source,
      mode: composerMode,
      raw_text_length: rawText?.length ?? 0,
    });

    if (!rawText) return jsonResponse({ error: 'Missing required field: message' }, 400);
    if (rawText.length > MAX_MESSAGE_CHARS) {
      return jsonResponse({
        error: `Message exceeds maximum length of ${MAX_MESSAGE_CHARS} characters.`,
        code: 'message_too_long',
      }, 400);
    }
    if (!locationId) return jsonResponse({ error: 'Missing required field: location_id' }, 400);
    if (!UUID_PATTERN.test(locationId)) {
      return jsonResponse({ error: 'location_id must be a valid UUID.', code: 'invalid_location_id' }, 400);
    }
    if (!requestedUserId) return jsonResponse({ error: 'Missing required field: user_id' }, 400);
    if (requestedUserId !== authenticatedUserId) return jsonResponse({ error: 'Authenticated user mismatch' }, 403);
    if (sessionId && !UUID_PATTERN.test(sessionId)) {
      return jsonResponse({ error: 'session_id must be a valid UUID.', code: 'invalid_session_id' }, 400);
    }

    const locationAccess = await userCanAccessLocation(
      supabaseAdmin,
      authenticatedUserId,
      locationId,
    );
    if (!locationAccess.allowed) {
      return jsonResponse(
        { error: locationAccess.error || 'Forbidden' },
        locationAccess.status,
      );
    }

    if (operation === 'record_mutation') {
      return await recordQuickOrderMutation({
        sessionId,
        userId: authenticatedUserId,
        locationId,
        mutationType: asNullableString(payload.mutation_type) ?? asNullableString(payload.mutationType) ?? 'smart_suggestion_applied',
        sourceMessage: rawText,
        assistantMessage: asNullableString(payload.assistant_message_text) ?? asNullableString(payload.assistantMessageText),
        beforeCart: payload.before_cart ?? payload.beforeCart ?? [],
        afterCart: payload.after_cart ?? payload.afterCart ?? [],
      });
    }

    if (operation === 'revert_mutation' || operation === 'revert') {
      const mutationId = asNullableString(payload.mutation_id) ?? asNullableString(payload.mutationId);
      if (!mutationId || !UUID_PATTERN.test(mutationId)) {
        return jsonResponse({ error: 'mutation_id must be a valid UUID.', code: 'invalid_mutation_id' }, 400);
      }
      return await revertQuickOrderMutation({
        sessionId,
        userId: authenticatedUserId,
        locationId,
        mutationId,
        existingItems: payload.existing_items,
      });
    }

    const { data: configRows } = await supabaseAdmin
      .from('app_config')
      .select('key, value')
      .in('key', [
        'quick_order_parser_mode',
        'quick_order_enabled',
        'quick_order_daily_limit_per_user',
        'quick_order_monthly_token_budget',
        'quick_order_token_warning_threshold',
        'quick_order_unit_synonyms',
        'quick_order_voice_enabled',
        'quick_order_advanced_model_routing_enabled',
      ]);

    const config: Record<string, unknown> = {};
    for (const row of configRows ?? []) config[row.key] = row.value;
    if (config.quick_order_enabled === false) {
      return jsonResponse({ error: 'Quick Order is temporarily disabled.', code: 'feature_disabled' }, 503);
    }
    const voiceEnabled = Deno.env.get('ENABLE_QUICK_ORDER_VOICE') === 'true'
      || config.quick_order_voice_enabled === true;
    if (source === 'voice' && !voiceEnabled) {
      return jsonResponse({
        status: 'blocked',
        error: 'Quick Order voice is disabled.',
        code: 'quick_order_voice_disabled',
        display_message: 'Voice Quick Order is not enabled for this location yet.',
        speech_message: 'Voice Quick Order is not enabled yet.',
        parsed_items: [],
        cart_operations: [],
        stock_updates: [],
        recommendations: [],
        clarifications: [],
        safety_warnings: [],
        blocked_operations: [{
          type: 'feature_disabled',
          message: 'Quick Order voice is disabled.',
          original_text: rawText,
        }],
        model_used: 'none',
        confidence: 0,
        timings: { total_ms: Date.now() - callStartTime },
      }, 403);
    }

    if (operation !== 'check_missing_items') {
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
    }

    const parserMode = typeof config.quick_order_parser_mode === 'string'
      ? config.quick_order_parser_mode
      : 'auto';
    const unitAliases = buildUnitAliases(isRecord(config.quick_order_unit_synonyms) ? config.quick_order_unit_synonyms : null);
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

    const catalog = await fetchGlobalCatalog();
    const globalCatalog = catalog;
    const catalogItemIds = [...new Set(catalog.map((item) => item.id).filter(Boolean))];
    const employeeNameKey = normalizeEmployeeNameKey(authResult.employeeName ?? null);

    const [
      sessionContext,
      corrections,
      limits,
      allowedUnitRules,
      reorderRules,
      orderProfiles,
      inventoryReorderRules,
      inventoryStatusTerms,
      recentOrders,
      employeeAliases,
    ] = await Promise.all([
      fetchSessionContext(sessionId, authenticatedUserId, locationId),
      fetchCorrections(authenticatedUserId, locationId),
      fetchItemOrderLimits(locationId),
      fetchItemAllowedUnitRules(catalogItemIds),
      fetchItemReorderRules(locationId),
      fetchItemOrderProfiles(locationId),
      fetchInventoryReorderRules(locationId),
      fetchInventoryStatusTerms(),
      fetchRecentOrders({ locationId, userId: authenticatedUserId, limit: HISTORY_ORDER_LIMIT }),
      fetchEmployeeQuickOrderAliases({ userId: authenticatedUserId, locationId, employeeNameKey }),
    ]);

    devLog('catalog_loaded', {
      catalog_count: catalog.length,
      global_catalog_count: globalCatalog.length,
      first_5_names: catalog.slice(0, 5).map((item) => item.name),
      corrections_count: corrections.length,
      limits_count: limits.length,
      allowed_unit_rules_count: allowedUnitRules.length,
      reorder_rules_count: reorderRules.length,
      order_profiles_count: orderProfiles.length,
      inventory_reorder_rules_count: inventoryReorderRules.length,
      inventory_status_terms_count: inventoryStatusTerms.length,
      employee_aliases_count: employeeAliases.length,
      session_messages_count: sessionContext.messages.length,
      session_parsed_items_count: sessionContext.parsedItems.length,
    });

    if (catalog.length === 0) {
      devLog('catalog_empty', { location_id: locationId });
      const emptyMessage = 'I had trouble loading the item catalog. Please try again.';
      return jsonResponse({
        status: 'error',
        assistant_message: emptyMessage,
        reply_text: emptyMessage,
        parsed_items: [],
        flags: [{ type: 'unresolved_item', message: 'No catalog items found.' }],
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

    if (operation === 'check_missing_items') {
      const currentItems = sanitizeExistingItems(
        normalizeParsedItemArray(payload.current_items ?? payload.currentItems ?? payload.existing_items),
        catalog,
        unitAliases,
      );
      const timeRange =
        normalizeMissingTimeRange(payload.time_range ?? payload.timeRange) ??
        extractMissingItemTimeRange(rawText);
      const missing = await runMissingItemCheck({
        locationId,
        userId: authenticatedUserId,
        catalog,
        currentItems,
        supplierId: asNullableString(payload.supplier_id) ?? asNullableString(payload.supplierId),
        timeRange,
        ignoredItemIds: normalizeStringArray(payload.ignored_item_ids ?? payload.ignoredItemIds),
      });
      return jsonResponse({
        status: 'success',
        display_message: missing.message,
        assistant_message: missing.message,
        reply_text: missing.message,
        speech_message: missing.message,
        missing_item_suggestions: missing.suggestions,
        suggestions: suggestionsToParseSuggestions(missing.suggestions),
        cart_hash: missing.cartHash,
        checked_at: new Date().toISOString(),
        location_id: locationId,
        supplier_id: asNullableString(payload.supplier_id) ?? asNullableString(payload.supplierId),
      });
    }

    if (operation === 'history_import_preview') {
      if (authResult.role !== 'manager' && authResult.role !== 'admin') {
        return jsonResponse({ error: 'Manager access required', code: 'manager_required' }, 403);
      }
      const originalText = asNullableString(payload.original_text) ?? asNullableString(payload.originalText) ?? rawText;
      const datePreview = buildHistoryImportDatePreview(payload.placed_at_text ?? payload.placedAtText ?? payload.placed_at ?? payload.placedAt);
      const rows = buildHistoryImportPreview({
        originalText,
        catalog,
        corrections,
        unitAliases,
        allowedUnitRules,
      });
      return jsonResponse({
        status: 'success',
        placed_at: datePreview.placedAt,
        placed_at_text: datePreview.placedAtText,
        date_status: datePreview.dateStatus,
        date_reason: datePreview.dateReason,
        preview_rows: rows,
        needs_review_count: rows.filter((row) => row.status === 'needs_review').length,
        invalid_count: rows.filter((row) => row.status === 'invalid').length,
      });
    }

    if (operation === 'history_import_commit') {
      if (authResult.role !== 'manager' && authResult.role !== 'admin') {
        return jsonResponse({ error: 'Manager access required', code: 'manager_required' }, 403);
      }
      const employeeNameText = asNullableString(payload.employee_name_text) ??
        asNullableString(payload.employeeNameText) ??
        asNullableString(payload.employee_name) ??
        asNullableString(payload.employeeName);
      if (!employeeNameText) {
        return jsonResponse({ error: 'employee_name_text is required.', code: 'missing_employee_name' }, 400);
      }
      const datePreview = buildHistoryImportDatePreview(payload.placed_at_text ?? payload.placedAtText ?? payload.placed_at ?? payload.placedAt);
      const placedAt = datePreview.placedAt;
      if (!placedAt || Number.isNaN(new Date(placedAt).getTime())) {
        return jsonResponse({ error: 'placed_at_text must be a valid date.', code: 'invalid_placed_at', date_reason: datePreview.dateReason }, 400);
      }
      const previewRows = normalizePreviewRows(payload.preview_items ?? payload.previewItems);
      const blocking = previewRows.filter((row) => row.status !== 'ignored' && row.status !== 'matched');
      if (blocking.length > 0) {
        return jsonResponse({ error: 'All rows must be matched or ignored before import.', code: 'preview_rows_invalid' }, 400);
      }
      const imported = await importHistoricalOrder({
        importedBy: authenticatedUserId,
        employeeId: asNullableString(payload.employee_id) ?? asNullableString(payload.employeeId),
        employeeNameText,
        locationId,
        supplierId: null,
        placedAt,
        placedAtText: datePreview.placedAtText,
        originalText: asNullableString(payload.original_text) ?? asNullableString(payload.originalText) ?? rawText,
        previewRows,
      });
      return jsonResponse({
        status: 'success',
        import_id: imported.importId,
        imported_count: imported.importedCount,
        message: `Imported ${imported.importedCount} historical order items. Smart suggestions have been refreshed.`,
      });
    }

    devLog('parser_start', {
      parser_mode: llmEnabled ? 'deterministic_plus_llm' : 'deterministic_only',
      raw_text_length: rawText.length,
    });

    const requestExistingItems = sanitizeExistingItems(
      normalizeParsedItemArray(payload.existing_items),
      catalog,
      unitAliases,
    );
    const sessionExistingItems = sanitizeExistingItems(sessionContext.parsedItems, catalog, unitAliases);
    const requestRecentMessages = normalizeMessageArray(payload.recent_messages);
    const previousMessages = requestRecentMessages.length > 0 ? requestRecentMessages : sessionContext.messages;
    const classification = classifyQuickOrderInput(rawText, {
      hasPendingDuplicateAction: previousMessages.some((message) =>
        (message.pending_clarifications ?? []).some((entry) => entry.type === 'quantity_conflict' || entry.type === 'unit_conflict')
      ),
    });
    if (isMissingItemCheckRequest(rawText)) {
      const timeRange = extractMissingItemTimeRange(rawText);
      const missing = await runMissingItemCheck({
        locationId,
        userId: authenticatedUserId,
        catalog,
        currentItems: requestExistingItems.length > 0 ? requestExistingItems : sessionExistingItems,
        supplierId: asNullableString(payload.supplier_id) ?? asNullableString(payload.supplierId),
        timeRange,
        ignoredItemIds: normalizeStringArray(payload.ignored_item_ids ?? payload.ignoredItemIds),
      });
      return jsonResponse({
        status: 'success',
        legacy_status: 'ok',
        display_message: missing.message,
        assistant_message: missing.message,
        reply_text: missing.message,
        speech_message: missing.message,
        parsed_items: [],
        flags: [],
        suggestions: suggestionsToParseSuggestions(missing.suggestions),
        missing_item_suggestions: missing.suggestions,
        pending_actions: [],
        pending_clarifications: [],
        session_state: {
          total_items: (requestExistingItems.length > 0 ? requestExistingItems : sessionExistingItems).length,
          ready_to_submit: false,
        },
        cart_operations: [],
        operations: [],
        stock_updates: [],
        recommendations: [],
        clarifications: [],
        safety_warnings: [],
        blocked_operations: [],
        model_used: 'none',
        confidence: missing.suggestions.some((entry) => entry.confidence === 'high') ? 0.92 : 0.8,
        timings: { total_ms: Date.now() - callStartTime },
        cart_hash: missing.cartHash,
        checked_at: new Date().toISOString(),
        diagnostics: {
          parser_version: PARSER_VERSION,
          input_classification: 'recommend_order_request',
          input_classification_reason: 'missing_item_check_phrase',
          llm_intent_intent: 'check_missing_items',
        },
      });
    }
    const result = await processQuickOrderMessage({
      request: {
        source,
        mode: composerMode,
        mode_conflict_resolution: modeConflictResolution,
        message: rawText,
        session_id: sessionId,
        location_id: locationId,
        user_id: authenticatedUserId,
        existing_items: requestExistingItems,
        recent_messages: requestRecentMessages.length > 0 ? requestRecentMessages : undefined,
        voice_metadata: isRecord(payload.voice_metadata) ? {
          transcript_confidence: asNumber(payload.voice_metadata.transcript_confidence) ?? undefined,
          raw_transcript: asNullableString(payload.voice_metadata.raw_transcript) ?? undefined,
          language: asNullableString(payload.voice_metadata.language) ?? undefined,
        } : undefined,
      },
      catalog,
      globalCatalog,
      corrections,
      previousMessages,
      existingParsedItems: requestExistingItems.length > 0 ? requestExistingItems : sessionExistingItems,
      limits,
      allowedUnitRules,
      employeeAliases,
      inventoryReorderRules,
      inventoryStatusTerms,
      reorderRules,
      orderProfiles,
      recentOrders,
      userRole: authResult.role,
      unitAliases,
      classification,
      modelConfig: {
        ...modelConfig,
        advancedEnabled: config.quick_order_advanced_model_routing_enabled !== false && modelConfig.advancedEnabled,
      },
      callLlm: llmEnabled ? callLlm : undefined,
      persistStockUpdates: (updates) => persistCurrentStockSnapshots({
        locationId,
        userId: authenticatedUserId,
        sessionId,
        updates,
      }),
      debugTimings,
    });

    devLog('parser_result', {
      parser_version: PARSER_VERSION,
      status: result.status,
      parsed_items_count: result.parsed_items.length,
      flags_count: result.flags.length,
      pending_clarifications_count: result.pending_clarifications?.length ?? 0,
      metrics_parse_mode: result.metrics?.parse_mode_used,
      model_used: result.model_used,
      stock_updates_count: result.stock_updates.length,
      recommendations_count: result.recommendations.length,
      items_needing_clarification: result.parsed_items.filter((item) => item.needs_clarification).length,
      items_unresolved: result.parsed_items.filter((item) => item.unresolved).length,
    });

    if (result.diagnostics?.llm_intent_intent === 'check_missing_items') {
      const missing = await runMissingItemCheck({
        locationId,
        userId: authenticatedUserId,
        catalog,
        currentItems: requestExistingItems.length > 0 ? requestExistingItems : sessionExistingItems,
        supplierId: asNullableString(payload.supplier_id) ?? asNullableString(payload.supplierId),
        timeRange: normalizeMissingTimeRange((result.diagnostics as Record<string, unknown>)?.llm_intent_time_range) ?? extractMissingItemTimeRange(rawText),
        ignoredItemIds: normalizeStringArray(payload.ignored_item_ids ?? payload.ignoredItemIds),
      });
      return jsonResponse({
        ...result,
        display_message: missing.message,
        assistant_message: missing.message,
        reply_text: missing.message,
        speech_message: missing.message,
        parsed_items: [],
        suggestions: suggestionsToParseSuggestions(missing.suggestions),
        missing_item_suggestions: missing.suggestions,
        cart_hash: missing.cartHash,
        checked_at: new Date().toISOString(),
        diagnostics: {
          ...(result.diagnostics ?? {}),
          suggestion_count: missing.suggestions.length,
        },
      });
    }

    const intentSuggestionResult = await buildIntentSuggestions({
      classification: result.diagnostics?.input_classification,
      rawText,
      locationId,
      userId: authenticatedUserId,
      parsedItems: [...sessionContext.parsedItems, ...result.parsed_items],
    });
    const shouldUseIntentSuggestionMessage = result.recommendations.length === 0 && result.stock_updates.length === 0;
    const suggestions = result.recommendations.length > 0 || result.stock_updates.length > 0
      ? []
      : intentSuggestionResult.suggestions;

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

    const finalResponse = {
      ...result,
      suggestions,
      assistant_message: shouldUseIntentSuggestionMessage ? intentSuggestionResult.message ?? result.assistant_message : result.assistant_message,
      reply_text: shouldUseIntentSuggestionMessage ? intentSuggestionResult.message ?? result.reply_text : result.reply_text,
      display_message: shouldUseIntentSuggestionMessage ? intentSuggestionResult.message ?? result.display_message : result.display_message,
      speech_message: shouldUseIntentSuggestionMessage ? intentSuggestionResult.message ?? result.speech_message : result.speech_message,
      diagnostics: {
        ...(result.diagnostics ?? {}),
        suggestion_count: suggestions.length,
        history_lookup_result: intentSuggestionResult.historyResult,
      },
    };
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
    return jsonResponse({
      error: 'Internal server error',
      code: 'parser_error',
    }, 500);
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
