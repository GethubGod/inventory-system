import { processQuickOrderMessage } from '../../supabase/functions/parse-order/process-message.ts';
import { classifyQuickOrderInput } from '../../supabase/functions/parse-order/input-classifier.ts';
import { extractStockUpdates } from '../../supabase/functions/parse-order/stock-updates.ts';
import { buildUnitAliases } from '../../supabase/functions/parse-order/units.ts';
import {
  buildCatalogFromInventoryItemRows,
  buildGlobalCatalogFromQoItemRows,
  mergeCatalogWithInventoryFallback,
} from '../../supabase/functions/parse-order/catalog-builder.ts';
import {
  normalizeQuickOrderParseResponse,
  shouldDiscardQuickOrderResponseAsError,
} from '../features/ordering/quickOrderResponse';
import type {
  CatalogItem,
  QuickOrderReorderRule,
  QuickOrderUnitRule,
} from '../../supabase/functions/parse-order/types.ts';

const catalog: CatalogItem[] = [
  { id: 'sriracha-id', name: 'Sriracha', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
  { id: 'tamago-id', name: 'Tamago', aliases: [], default_unit: 'pack', order_unit: 'pack', base_unit: 'pack', pack_unit: 'pack' },
];

const parserSettings = {
  order_mode_missing_unit_strategy: 'item_default_order_unit',
  order_mode_employee_personalization: true,
  inventory_mode_employee_personalization: true,
  global_aliases_enabled: true,
  fuzzy_match_requires_confirmation: false,
  status_terms_enabled: true,
};

async function brain(message: string, overrides: Partial<Parameters<typeof processQuickOrderMessage>[0]> = {}) {
  const unitAliases = overrides.unitAliases ?? buildUnitAliases({ box: 'case' });
  return processQuickOrderMessage({
    catalog,
    globalCatalog: catalog,
    corrections: [],
    previousMessages: [],
    existingParsedItems: [],
    limits: [],
    allowedUnitRules: [],
    recentOrders: [],
    unitAliases,
    classification: classifyQuickOrderInput(message, { hasPendingDuplicateAction: false }),
    parserSettings,
    modelConfig: {
      defaultModel: 'gemini-2.5-flash',
      fallbackModel: 'gemini-2.5-flash',
      advancedModel: 'gemini-3.1-pro',
      liveModel: 'gemini-live',
      advancedEnabled: true,
    },
    ...overrides,
    request: {
      source: 'typed',
      mode: 'order',
      session_id: 'session-id',
      location_id: 'sushi-location',
      user_id: 'user-id',
      existing_items: [],
      ...overrides.request,
      message,
    },
  });
}

const nateTamagoCustomPackUnit: QuickOrderUnitRule = {
  item_id: 'tamago-id',
  from_unit: null,
  to_unit: 'pack',
  multiplier: 1,
  scope_type: 'employee',
  employee_name: 'Nate',
  employee_name_key: 'nate',
  mode_scope: 'inventory',
  is_default_when_missing: true,
  active: true,
  is_custom_counting_unit: true,
  tracking_unit: 'order',
};

describe('qo restructure fix: tracking_unit dedupe', () => {
  test('preserves both default-unit and custom-unit counts for same item', () => {
    const { stockUpdates } = extractStockUpdates({
      message: 'Tamago 10, Tamago 5 pack',
      source: 'typed',
      catalog,
      corrections: [],
      employeeNameKeys: ['nate'],
      unitRules: [nateTamagoCustomPackUnit],
      assumeStock: true,
    });
    expect(stockUpdates).toHaveLength(2);
    expect(stockUpdates.every((update) => update.item_id === 'tamago-id' && update.unit === 'pack')).toBe(true);
    expect(stockUpdates.map((update) => update.tracking_unit).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([null, 'order']);
  });
});

describe('qo restructure fix: reorder resolver does not abort on unit mismatch', () => {
  const nateSrirachaLiterMismatch: QuickOrderReorderRule = {
    item_id: 'sriracha-id',
    scope_type: 'employee',
    employee_name: 'Nate',
    employee_name_key: 'nate',
    mode_scope: 'inventory',
    counted_unit: 'liter',
    trigger_type: 'at_or_below',
    trigger_qty_min: 2,
    action_type: 'fixed_order_qty',
    order_qty: 99,
    order_unit: 'liter',
    priority: 1,
    active: true,
  };

  const nateSrirachaCaseMatch: QuickOrderReorderRule = {
    item_id: 'sriracha-id',
    scope_type: 'employee',
    employee_name: 'Nate',
    employee_name_key: 'nate',
    mode_scope: 'inventory',
    counted_unit: 'case',
    trigger_type: 'at_or_below',
    trigger_qty_min: 0.5,
    action_type: 'fixed_order_qty',
    order_qty: 1,
    order_unit: 'case',
    priority: 2,
    active: true,
  };

  test('falls through to global rule when employee rule has unit mismatch', async () => {
    const result = await brain('Sriracha 0.5 case', {
      employeeNameKeys: ['nate'],
      quickOrderReorderRules: [nateSrirachaLiterMismatch, nateSrirachaCaseMatch],
      request: { mode: 'inventory', employee_name: 'Nate' } as any,
    });
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({ suggested_quantity: 1, unit: 'case' });
  });
});

describe('qo restructure fix: Issue 11 tracking_unit threshold isolation', () => {
  const nateTamagoOrderUnit: QuickOrderUnitRule = {
    item_id: 'tamago-id',
    from_unit: null,
    to_unit: 'order',
    multiplier: 1,
    scope_type: 'employee',
    employee_name: 'Nate',
    employee_name_key: 'nate',
    mode_scope: 'inventory',
    is_default_when_missing: true,
    active: true,
    is_custom_counting_unit: true,
    tracking_unit: 'order',
  };

  const nateTamagoOrderRule: QuickOrderReorderRule = {
    item_id: 'tamago-id',
    scope_type: 'employee',
    employee_name: 'Nate',
    employee_name_key: 'nate',
    mode_scope: 'inventory',
    counted_unit: 'order',
    trigger_type: 'at_or_below',
    trigger_qty_min: 5,
    action_type: 'fixed_order_qty',
    order_qty: 1,
    order_unit: 'pack',
    active: true,
  };

  test('employee order-unit snapshot triggers reorder; default-unit snapshot does not contaminate', async () => {
    const { stockUpdates } = extractStockUpdates({
      message: 'Tamago 10 pack, Tamago 4',
      source: 'typed',
      catalog,
      corrections: [],
      employeeNameKeys: ['nate'],
      unitRules: [nateTamagoOrderUnit],
      assumeStock: true,
    });
    expect(stockUpdates).toHaveLength(2);
    expect(stockUpdates.find((update) => update.tracking_unit == null)).toMatchObject({ quantity: 10, unit: 'pack' });
    expect(stockUpdates.find((update) => update.tracking_unit === 'order')).toMatchObject({ quantity: 4, unit: 'order' });

    const result = await brain('Tamago 10 pack, Tamago 4', {
      employeeNameKeys: ['nate'],
      unitRules: [nateTamagoOrderUnit],
      quickOrderReorderRules: [nateTamagoOrderRule],
      request: { mode: 'inventory', employee_name: 'Nate' } as any,
    });

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      item_id: 'tamago-id',
      suggested_quantity: 1,
      unit: 'pack',
    });
  });
});

describe('qo restructure fix: Issue 15 running low status phrase reorder', () => {
  const srirachaRule: QuickOrderReorderRule = {
    item_id: 'sriracha-id',
    scope_type: 'global',
    mode_scope: 'inventory',
    counted_unit: 'case',
    trigger_type: 'at_or_below',
    trigger_qty_min: 0.5,
    action_type: 'fixed_order_qty',
    order_qty: 1,
    order_unit: 'case',
    active: true,
  };

  test('"Sriracha running low" with check_reorder_rule keyword emits one case recommendation', async () => {
    const result = await brain('Sriracha running low', {
      inventoryStatusTerms: [{
        phrase: 'running low',
        phrase_key: 'running low',
        status: 'low',
        remaining_qty: null,
        remaining_unit_behavior: 'none',
        recommendation_action: 'check_reorder_rule',
        active: true,
      }],
      quickOrderReorderRules: [srirachaRule],
      request: { mode: 'inventory' } as any,
    });

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      suggested_quantity: 1,
      unit: 'case',
    });
  });
});

describe('qo restructure fix: fetchGlobalCatalog warns on unlinked qo_items', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  test('logs structured warning and excludes unlinked active qo_items rows', () => {
    const builtCatalog = buildGlobalCatalogFromQoItemRows([
      {
        id: 'qo-unlinked-id',
        inventory_item_id: null,
        name: 'Sheet Only Item',
        order_unit: 'case',
        location_scope: 'Babytuna Sushi',
        active: true,
        inventory_items: null,
      },
      {
        id: 'qo-linked-id',
        inventory_item_id: 'inventory-linked-id',
        name: 'Linked Item',
        order_unit: 'case',
        location_scope: null,
        active: true,
        inventory_items: {
          id: 'inventory-linked-id',
          base_unit: 'case',
          pack_unit: 'case',
          allowed_units: ['case'],
          supplier_id: null,
          default_order_unit: 'case',
        },
      },
    ]);

    expect(builtCatalog).toHaveLength(1);
    expect(builtCatalog[0]).toMatchObject({ id: 'inventory-linked-id', name: 'Linked Item' });
    expect(warnSpy).toHaveBeenCalledWith(
      '[parse-order] qo_items row has no inventory_item_id; excluding from catalog',
      {
        qo_items_id: 'qo-unlinked-id',
        name: 'Sheet Only Item',
        location_scope: 'Babytuna Sushi',
      },
    );
  });
});

describe('qo restructure fix: sushi inventory screenshot regression', () => {
  const sushiCatalog: CatalogItem[] = [
    { id: 'salmon-id', name: 'Salmon', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
    { id: 'yellowtail-id', name: 'Yellowtail', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
    { id: 'tuna-id', name: 'Tuna', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
    { id: 'albacore-id', name: 'Albacore', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
    { id: 'spicy-tuna-id', name: 'Spicy Tuna', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
    { id: 'shrimp-id', name: 'Shrimp', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
    { id: 'squid-id', name: 'Squid', aliases: [], default_unit: 'pack', order_unit: 'pack', base_unit: 'pack', pack_unit: 'pack' },
    { id: 'red-clam-id', name: 'Red Clam', aliases: [], default_unit: 'bag', order_unit: 'bag', base_unit: 'bag', pack_unit: 'bag' },
    { id: 'white-fish-id', name: 'White Fish', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
    { id: 'ono-id', name: 'Ono', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
    { id: 'mackerel-id', name: 'Mackerel', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
    { id: 'octopus-id', name: 'Octopus', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
    { id: 'ikura-id', name: 'Ikura', aliases: [], default_unit: 'pack', order_unit: 'pack', base_unit: 'pack', pack_unit: 'pack' },
    { id: 'chili-oil-id', name: 'Chili Oil', aliases: [], default_unit: 'bottle', order_unit: 'bottle', base_unit: 'bottle', pack_unit: 'case' },
    { id: 'sriracha-id', name: 'Sriracha', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
    { id: 'tamago-id', name: 'Tamago', aliases: [], default_unit: 'pack', order_unit: 'pack', base_unit: 'pack', pack_unit: 'pack' },
  ];

  const screenshotMessage = `Salmon 3
Yellowtail 3
Tuna 5
Albacore 3
Spicy Tuna 3 box
Shrimp 2
Squid 1 1/2 pack
Red Clam 1 1/2 bags
White Fish 2
Ono 8
Mackerel 1
Tamago 3
Octopus 2
Ikura 1 pack + 3
Chili oil 5 1/2
Sriracha 1 1/2 box`;

  async function parseSushiScreenshot(mode: 'order' | 'inventory') {
    return processQuickOrderMessage({
      catalog: sushiCatalog,
      globalCatalog: sushiCatalog,
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
      limits: [],
      allowedUnitRules: [],
      recentOrders: [],
      unitAliases: buildUnitAliases({ box: 'case' }),
      classification: classifyQuickOrderInput(screenshotMessage, { hasPendingDuplicateAction: false }),
      parserSettings,
      modelConfig: {
        defaultModel: 'gemini-2.5-flash',
        fallbackModel: 'gemini-2.5-flash',
        advancedModel: 'gemini-3.1-pro',
        liveModel: 'gemini-live',
        advancedEnabled: true,
      },
      request: {
        source: 'typed',
        mode,
        session_id: 'session-id',
        location_id: 'sushi-location',
        user_id: 'user-id',
        existing_items: [],
        message: screenshotMessage,
      },
    });
  }

  test('inventory mode reads the full list and preserves mixed/compound counts', async () => {
    const result = await parseSushiScreenshot('inventory');

    expect(result.stock_updates).toHaveLength(15);
    expect(result.assistant_message).not.toContain('I had trouble reading');
    expect(result.assistant_message).toContain('Ikura');
    expect(result.stock_updates.find((update) => update.item_id === 'squid-id')).toMatchObject({ quantity: 1.5, unit: 'pack' });
    expect(result.stock_updates.find((update) => update.item_id === 'red-clam-id')).toMatchObject({ quantity: 1.5, unit: 'bag' });
    expect(result.stock_updates.find((update) => update.item_id === 'chili-oil-id')).toMatchObject({ quantity: 5.5, unit: 'bottle', unit_inferred: true });
    expect(result.stock_updates.find((update) => update.item_id === 'sriracha-id')).toMatchObject({ quantity: 1.5, unit: 'cs' });
    expect(result.safety_warnings.find((warning) => warning.item_id === 'ikura-id')).toMatchObject({
      type: 'recommendation_unavailable',
      reason_codes: ['compound_count_needs_unit'],
    });

    const normalized = normalizeQuickOrderParseResponse(result);
    expect(normalized.stockUpdates).toHaveLength(15);
    expect(normalized.assistantMessage).not.toContain('I had trouble reading');
    expect(shouldDiscardQuickOrderResponseAsError(normalized)).toBe(false);
  });

  test('order mode reads the same list instead of returning the generic failure', async () => {
    const result = await parseSushiScreenshot('order');

    expect(result.parsed_items.length).toBeGreaterThanOrEqual(15);
    expect(result.stock_updates).toHaveLength(0);
    expect(result.assistant_message).not.toContain('I had trouble reading');
    expect(result.parsed_items.find((item) => item.item_id === 'squid-id')).toMatchObject({ quantity: 1.5, unit: 'pack' });
    expect(result.parsed_items.find((item) => item.item_id === 'red-clam-id')).toMatchObject({ quantity: 1.5, unit: 'bag' });
    expect(result.parsed_items.find((item) => item.item_id === 'chili-oil-id')).toMatchObject({ quantity: 5.5, unit: 'bottle' });
    expect(result.parsed_items.find((item) => item.item_id === 'sriracha-id')).toMatchObject({ quantity: 1.5, unit: 'cs' });

    const normalized = normalizeQuickOrderParseResponse(result);
    expect(normalized.parsedItems.length).toBeGreaterThanOrEqual(15);
    expect(normalized.assistantMessage).not.toContain('I had trouble reading');
    expect(shouldDiscardQuickOrderResponseAsError(normalized)).toBe(false);
  });

  test('mobile error guard does not discard inventory output with a transient raw error', async () => {
    const result = await parseSushiScreenshot('inventory');
    const normalized = normalizeQuickOrderParseResponse({
      ...result,
      error: 'transient save warning',
    });

    expect(normalized.rawError).toBe('transient save warning');
    expect(normalized.parsedItems).toHaveLength(0);
    expect(normalized.stockUpdates).toHaveLength(15);
    expect(shouldDiscardQuickOrderResponseAsError(normalized)).toBe(false);
  });
});

describe('qo restructure fix: inventory_items catalog fallback', () => {
  test('keeps active inventory items parseable when qo_items rows are unlinked or missing', () => {
    const qoItemsCatalog = buildGlobalCatalogFromQoItemRows(
      [
        {
          id: 'qo-unlinked-id',
          inventory_item_id: null,
          name: 'Ikura',
          order_unit: 'pack',
          location_scope: 'Babytuna Sushi',
          active: true,
          inventory_items: null,
        },
      ],
      { onUnlinked: () => undefined },
    );
    const fallbackCatalog = buildCatalogFromInventoryItemRows([
      {
        id: 'ikura-id',
        name: 'Ikura',
        aliases: ['salmon roe'],
        base_unit: 'pack',
        pack_unit: 'pack',
        default_order_unit: 'pack',
        allowed_units: ['pack'],
        active: true,
      },
    ]);

    expect(qoItemsCatalog).toHaveLength(0);
    expect(mergeCatalogWithInventoryFallback(qoItemsCatalog, fallbackCatalog)).toMatchObject([
      { id: 'ikura-id', name: 'Ikura', default_unit: 'pack' },
    ]);
  });

  test('qo_items settings win when both catalogs contain the same inventory item', () => {
    const qoItemsCatalog = buildGlobalCatalogFromQoItemRows([
      {
        id: 'qo-chili-oil-id',
        inventory_item_id: 'chili-oil-id',
        name: 'Chili Oil',
        aliases: 'hot oil',
        order_unit: 'bottle',
        target_stock: 4,
        active: true,
        inventory_items: {
          id: 'chili-oil-id',
          base_unit: 'case',
          pack_unit: 'case',
          allowed_units: ['case'],
          default_order_unit: 'case',
        },
      },
    ]);
    const fallbackCatalog = buildCatalogFromInventoryItemRows([
      {
        id: 'chili-oil-id',
        name: 'Chili Oil',
        aliases: [],
        base_unit: 'case',
        pack_unit: 'case',
        default_order_unit: 'case',
        allowed_units: ['case'],
        target_stock: null,
        active: true,
      },
    ]);

    expect(mergeCatalogWithInventoryFallback(qoItemsCatalog, fallbackCatalog)).toMatchObject([
      {
        id: 'chili-oil-id',
        name: 'Chili Oil',
        aliases: ['hot oil'],
        default_unit: 'bottle',
        target_stock: 4,
      },
    ]);
  });
});
