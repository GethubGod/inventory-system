import { classifyQuickOrderInput } from './input-classifier.ts';
import { processQuickOrderMessage, type ProcessQuickOrderMessageInput } from './process-message.ts';
import { DEFAULT_UNIT_ALIASES } from './units.ts';
import type { CatalogItem, EmployeeQuickOrderAlias } from './types.ts';

const ORDER_TEXT = 'albacore 2\navocado 1 case\nginger root 4';

const CATALOG: CatalogItem[] = [
  {
    id: 'albacore',
    name: 'Albacore',
    aliases: [],
    default_unit: 'case',
    allowed_units: ['case'],
  },
  {
    id: 'avocado',
    name: 'Avocado',
    aliases: [],
    default_unit: 'case',
    allowed_units: ['case'],
  },
  {
    id: 'ginger-root',
    name: 'Ginger Root',
    aliases: [],
    default_unit: 'case',
    allowed_units: ['case'],
  },
];

const ALIAS_CATALOG: CatalogItem[] = [
  {
    id: 'albacore',
    name: 'Fish Selection A',
    aliases: [],
    default_unit: 'case',
    allowed_units: ['case'],
  },
  {
    id: 'avocado',
    name: 'Produce Selection B',
    aliases: [],
    default_unit: 'case',
    allowed_units: ['case'],
  },
  {
    id: 'ginger-root',
    name: 'Spice Selection C',
    aliases: [],
    default_unit: 'case',
    allowed_units: ['case'],
  },
];

const EMPLOYEE_ALIASES: EmployeeQuickOrderAlias[] = [
  {
    employee_name: 'Test Employee',
    employee_name_key: 'test employee',
    alias_text: 'albacore',
    alias_key: 'albacore',
    inventory_item_id: 'albacore',
  },
  {
    employee_name: 'Test Employee',
    employee_name_key: 'test employee',
    alias_text: 'avocado',
    alias_key: 'avocado',
    inventory_item_id: 'avocado',
  },
  {
    employee_name: 'Test Employee',
    employee_name_key: 'test employee',
    alias_text: 'ginger root',
    alias_key: 'ginger root',
    inventory_item_id: 'ginger-root',
  },
];

type LlmCallback = NonNullable<ProcessQuickOrderMessageInput['callLlm']>;

function createInput(
  message: string,
  catalog: CatalogItem[],
  callLlm?: LlmCallback,
  employeeAliases?: EmployeeQuickOrderAlias[],
): ProcessQuickOrderMessageInput {
  const input: ProcessQuickOrderMessageInput = {
    request: {
      source: 'typed',
      mode: 'order',
      message,
      session_id: null,
      location_id: 'location-1',
      user_id: 'user-1',
      existing_items: [],
    },
    catalog,
    corrections: [],
    previousMessages: [],
    existingParsedItems: [],
    limits: [],
    allowedUnitRules: [],
    recentOrders: [],
    modelConfig: {
      defaultModel: 'gemini-2.5-flash',
      fallbackModel: 'gemini-2.5-flash',
      advancedModel: 'gemini-3.1-pro',
      liveModel: 'gemini-live',
      advancedEnabled: true,
    },
    unitAliases: DEFAULT_UNIT_ALIASES,
    classification: classifyQuickOrderInput(message),
  };
  if (callLlm) input.callLlm = callLlm;
  if (employeeAliases) input.employeeAliases = employeeAliases;
  return input;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertOrderItems(result: Awaited<ReturnType<typeof processQuickOrderMessage>>): void {
  assertEqual(result.parsed_items.length, 3, 'deterministic fallback item count');
  assertEqual(
    result.parsed_items.map((item) => item.raw_token),
    ['albacore 2', 'avocado 1 case', 'ginger root 4'],
    'deterministic fallback lines',
  );
  assertEqual(
    result.parsed_items.map((item) => item.quantity),
    [2, 1, 4],
    'deterministic fallback quantities',
  );
  assert(result.parsed_items.every((item) => item.parse_source === 'deterministic'), 'all fallback items should be deterministic');
}

Deno.test('a missing LLM callback parses a plain multiline order deterministically', async () => {
  const result = await processQuickOrderMessage(createInput(ORDER_TEXT, CATALOG));

  assertOrderItems(result);
  assertEqual(result.metrics?.parse_mode_used, 'deterministic_only', 'missing callback parse mode');
});

Deno.test('an LLM intent-router failure falls back to the deterministic parser', async () => {
  let callCount = 0;
  const throwingLlm: LlmCallback = async () => {
    callCount += 1;
    throw new Error('provider unavailable');
  };
  const result = await processQuickOrderMessage(createInput(ORDER_TEXT, ALIAS_CATALOG, throwingLlm, EMPLOYEE_ALIASES));

  assertEqual(callCount, 1, 'LLM intent router call count');
  assertOrderItems(result);
  assertEqual(result.diagnostics?.input_classification, 'order_entry', 'failed route should keep source classification');
  assertEqual(result.metrics?.parse_mode_used, 'deterministic_only', 'failed route parse mode');
});

Deno.test('a successful LLM intent route keeps the existing route-only response', async () => {
  let callCount = 0;
  const successfulLlm: LlmCallback = async () => {
    callCount += 1;
    return JSON.stringify({
      classification: 'history_request',
      intent: 'show_recent_orders',
      confidence: 0.95,
      entities: { time_range: 'recent' },
      requires_action: true,
      should_mutate_cart: false,
    });
  };
  const result = await processQuickOrderMessage(createInput('Show me my recent orders', [], successfulLlm));

  assertEqual(callCount, 1, 'successful LLM intent router call count');
  assertEqual(result.parsed_items.length, 0, 'successful route parsed item count');
  assertEqual(result.diagnostics?.parse_mode, 'llm_intent_router', 'successful route diagnostics mode');
  assertEqual(result.metrics?.parse_mode_used, 'llm_only_fallback', 'successful route metrics mode');
  assert(result.assistant_message?.includes('recent order') === true, 'successful route should keep the history response');
});

Deno.test('a malformed LLM router reply falls back to the deterministic parser', async () => {
  let callCount = 0;
  const malformedLlm: LlmCallback = async () => {
    callCount += 1;
    return 'not-json';
  };
  const result = await processQuickOrderMessage(createInput(ORDER_TEXT, ALIAS_CATALOG, malformedLlm, EMPLOYEE_ALIASES));

  assert(callCount >= 1, 'LLM intent router should have been called');
  assertOrderItems(result);
  assertEqual(result.metrics?.parse_mode_used, 'deterministic_only', 'malformed route parse mode');
});
