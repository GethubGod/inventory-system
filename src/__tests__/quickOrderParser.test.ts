import { matchCatalogItem } from '../../supabase/functions/parse-order/catalog-matcher.ts';
import { resolveParsedItemConflicts } from '../../supabase/functions/parse-order/conflicts.ts';
import { parseDeterministicOrder } from '../../supabase/functions/parse-order/deterministic-parser.ts';
import { parseJsonPayload } from '../../supabase/functions/parse-order/llm-fallback.ts';
import { parseQuickOrder } from '../../supabase/functions/parse-order/orchestrator.ts';
import type { CatalogItem, ParsedItem, ParserCorrection } from '../../supabase/functions/parse-order/types.ts';
import { validateParsedLine } from '../../supabase/functions/parse-order/validator.ts';
import {
  buildQuickOrderAssistantMessage,
  normalizeQuickOrderParseResponse,
} from '../features/ordering/quickOrderResponse';
import {
  applyQuickOrderClarificationAction,
  detectRepeatedOrderList,
  getParsedItemKey,
  mergeQuickOrderParsedItemsDetailed,
  mergeQuickOrderParsedItems,
  type ParsedQuickOrderItem,
} from '../features/ordering/quickOrderItems';

const catalog: CatalogItem[] = [
  { id: 'salmon-id', name: 'Salmon', aliases: ['sake'], default_unit: 'cs', base_unit: 'lb', pack_unit: 'cs', allowed_units: ['lb', 'cs', 'pc'] },
  { id: 'uni-id', name: 'Uni', aliases: ['sea urchin'], default_unit: 'oz', base_unit: 'oz', pack_unit: null, allowed_units: ['oz', 'pc'] },
  { id: 'yellowtail-id', name: 'Yellowtail', aliases: ['hamachi', 'yellow tail'], default_unit: 'lb', base_unit: 'lb', pack_unit: 'cs' },
  { id: 'octopus-id', name: 'Octopus', aliases: ['tako'], default_unit: 'cs', base_unit: 'lb', pack_unit: 'cs' },
  { id: 'tuna-id', name: 'Tuna', aliases: ['maguro'], default_unit: 'cs', base_unit: 'lb', pack_unit: 'cs' },
  { id: 'tuna-loin-id', name: 'Tuna Loin', aliases: ['tuna loin'], default_unit: 'lb', base_unit: 'lb', pack_unit: 'cs' },
  { id: 'brisket-id', name: 'Beef Brisket', aliases: [], default_unit: 'lb', base_unit: 'lb', pack_unit: null },
  { id: 'escolar-id', name: 'Escolar', aliases: [], default_unit: 'lb', base_unit: 'lb', pack_unit: null },
  { id: 'soy-id', name: 'Soy Sauce', aliases: ['soy'], default_unit: 'ea', base_unit: 'ea', pack_unit: 'cs' },
];

function parsed(overrides: Partial<ParsedItem>): ParsedItem {
  return {
    item_id: 'salmon-id',
    item_name: 'Salmon',
    raw_token: 'salmon',
    quantity: 4,
    unit: 'cs',
    confidence: 1,
    needs_clarification: false,
    unresolved: false,
    notes: null,
    ...overrides,
  };
}

describe('deterministic quick order parser', () => {
  test.each([
    ['salmon 2cs', 'salmon', 2, 'cs'],
    ['salmon 2 cs', 'salmon', 2, 'cs'],
    ['2cs salmon', 'salmon', 2, 'cs'],
    ['2 cs salmon', 'salmon', 2, 'cs'],
    ['1pc salmon', 'salmon', 1, 'pc'],
    ['1 lb escolar', 'escolar', 1, 'lb'],
    ['beef brisket 4lb', 'beef brisket', 4, 'lb'],
    ['unii 1 oz', 'unii', 1, 'oz'],
    ['1cs tai', 'tai', 1, 'cs'],
    ['Yellowtail 4cs', 'yellowtail', 4, 'cs'],
    ['Salmon 5cs', 'salmon', 5, 'cs'],
    ['8cs octopus', 'octopus', 8, 'cs'],
    ['1cs tuna', 'tuna', 1, 'cs'],
    ['7pc uni', 'uni', 7, 'pc'],
    ['1.5 lb salmon', 'salmon', 1.5, 'lb'],
    ['salmon 0.5 lb', 'salmon', 0.5, 'lb'],
    ['salmon 2', 'salmon', 2, null],
    ['salmon', 'salmon', null, null],
  ])('parses %s', (input, itemText, quantity, unit) => {
    expect(parseDeterministicOrder(input)[0]).toMatchObject({
      item_text: itemText,
      quantity,
      unit,
    });
  });

  test('parses mixed multiline and comma-separated orders', () => {
    const result = parseDeterministicOrder('Tuna loin 1cs\n1pc salmon, Unii 1 oz; Beef brisket 4lb\n1 lb escolar');
    expect(result.map((line) => [line.item_text, line.quantity, line.unit])).toEqual([
      ['tuna loin', 1, 'cs'],
      ['salmon', 1, 'pc'],
      ['unii', 1, 'oz'],
      ['beef brisket', 4, 'lb'],
      ['escolar', 1, 'lb'],
    ]);
  });
});

describe('catalog matcher', () => {
  test('prioritizes exact item names and aliases over fuzzy matches', () => {
    expect(matchCatalogItem('salmon', catalog).match_type).toBe('exact_name');
    expect(matchCatalogItem('hamachi', catalog)).toMatchObject({
      item_id: 'yellowtail-id',
      match_type: 'exact_alias',
    });
  });

  test('handles normalized aliases and spelling mistakes', () => {
    expect(matchCatalogItem('yellow tail', catalog)).toMatchObject({ item_id: 'yellowtail-id' });
    expect(matchCatalogItem('unii', catalog)).toMatchObject({ item_id: 'uni-id', match_type: 'fuzzy' });
    expect(matchCatalogItem('salmn', catalog)).toMatchObject({ item_id: 'salmon-id', match_type: 'fuzzy' });
    expect(matchCatalogItem('yelowtail', catalog)).toMatchObject({ item_id: 'yellowtail-id', match_type: 'fuzzy' });
  });

  test('uses recent corrections before fuzzy matching', () => {
    const corrections: ParserCorrection[] = [{
      raw_token: 'tai',
      parser_suggested_item_id: null,
      user_corrected_item_id: 'yellowtail-id',
      user_corrected_qty: null,
      user_corrected_unit: null,
    }];
    expect(matchCatalogItem('tai', catalog, corrections)).toMatchObject({
      item_id: 'yellowtail-id',
      match_type: 'correction',
    });
  });

  test('returns unresolved for low-confidence unknown text', () => {
    expect(matchCatalogItem('not a fish', catalog)).toMatchObject({
      item_id: null,
      needs_clarification: true,
    });
  });
});

describe('validation', () => {
  test('flags missing quantity and missing unit without dropping the item', () => {
    const candidate = parseDeterministicOrder('salmon')[0];
    const result = validateParsedLine({
      candidate,
      match: matchCatalogItem(candidate.item_text, catalog),
      catalog,
    });
    expect(result.item).toMatchObject({
      item_id: 'salmon-id',
      quantity: null,
      unit: null,
      needs_clarification: true,
    });
    expect(result.flags.map((flag) => flag.type)).toEqual(['missing_quantity', 'missing_unit']);
  });

  test('flags unsupported units for a matched item', () => {
    const candidate = parseDeterministicOrder('soy sauce 2lb')[0];
    const result = validateParsedLine({
      candidate,
      match: matchCatalogItem(candidate.item_text, catalog),
      catalog,
    });
    expect(result.item.needs_clarification).toBe(true);
    expect(result.flags.some((flag) => flag.type === 'unsupported_unit')).toBe(true);
  });
});

describe('LLM JSON parsing fallback', () => {
  test('extracts valid JSON from wrapped model text', () => {
    const parsed = parseJsonPayload('Here you go {"parsed_items":[{"item_id":"salmon-id"}]} thanks');
    expect(parsed.value).toEqual({ parsed_items: [{ item_id: 'salmon-id' }] });
    expect(parsed.repairNeeded).toBe(true);
  });

  test('repairs trailing commas when possible and safely fails otherwise', () => {
    expect(parseJsonPayload('{"parsed_items":[{"item_id":"salmon-id",}],}').value).toEqual({
      parsed_items: [{ item_id: 'salmon-id' }],
    });
    expect(parseJsonPayload('not json at all').value).toBeNull();
  });
});

describe('repeated item conflicts', () => {
  test('same item same unit neutral text asks add vs replace', () => {
    const result = resolveParsedItemConflicts(
      [parsed({ quantity: 4, unit: 'cs' })],
      [parsed({ quantity: 2, unit: 'cs', raw_token: 'salmon 2cs' })],
      'salmon 2cs',
    );
    expect(result.pendingClarifications[0]).toMatchObject({ type: 'quantity_conflict' });
    expect(result.acceptedItems).toHaveLength(0);
  });

  test('same item same unit additive and replacement language are deterministic', () => {
    expect(resolveParsedItemConflicts(
      [parsed({ quantity: 4, unit: 'cs' })],
      [parsed({ quantity: 2, unit: 'cs' })],
      'add salmon 2cs',
    ).updatedItems[0].quantity).toBe(6);

    expect(resolveParsedItemConflicts(
      [parsed({ quantity: 4, unit: 'cs' })],
      [parsed({ quantity: 2, unit: 'cs' })],
      'change salmon to 2cs',
    ).updatedItems[0].quantity).toBe(2);
  });

  test('same item different unit asks or separates/replaces based on intent', () => {
    expect(resolveParsedItemConflicts(
      [parsed({ quantity: 4, unit: 'cs' })],
      [parsed({ quantity: 4, unit: 'pc' })],
      'salmon 4pc',
    ).pendingClarifications[0].type).toBe('unit_conflict');

    expect(resolveParsedItemConflicts(
      [parsed({ quantity: 4, unit: 'cs' })],
      [parsed({ quantity: 4, unit: 'pc' })],
      'add salmon 4pc',
    ).acceptedItems[0].unit).toBe('pc');

    expect(resolveParsedItemConflicts(
      [parsed({ quantity: 4, unit: 'cs' })],
      [parsed({ quantity: 4, unit: 'pc' })],
      'actually salmon 4pc',
    ).updatedItems[0].unit).toBe('pc');
  });

  test('multiple existing same item lines asks which line to update', () => {
    const result = resolveParsedItemConflicts(
      [parsed({ quantity: 4, unit: 'cs' }), parsed({ quantity: 4, unit: 'pc', client_key: 'salmon-pc' })],
      [parsed({ quantity: 2, unit: 'lb', raw_token: 'salmon 2' })],
      'salmon 2',
    );
    expect(result.pendingClarifications[0]).toMatchObject({ type: 'choose_existing_line' });
  });
});

describe('quick order orchestration', () => {
  test('mixed multiline order preserves successes and unresolved tai', async () => {
    const result = await parseQuickOrder({
      rawText: 'Tuna loin 1cs\n1pc salmon\n1cs tai\nUnii 1 oz\nBeef brisket 4lb\n1 lb escolar',
      catalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });

    expect(result.reply_text).not.toContain('LLM did not return');
    expect(result.parsed_items.filter((item) => !item.needs_clarification).map((item) => item.item_id)).toEqual([
      'tuna-loin-id',
      'salmon-id',
      'uni-id',
      'brisket-id',
      'escolar-id',
    ]);
    expect(result.parsed_items.find((item) => item.raw_token === '1cs tai')).toMatchObject({
      item_id: null,
      needs_clarification: true,
    });
  });

  test('screenshot order parses to non-empty parsed_items', async () => {
    const result = await parseQuickOrder({
      rawText: 'Yellowtail 4cs\nSalmon 5cs\n8cs octopus\n1cs tuna\n7pc uni',
      catalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });

    expect(result.parsed_items.map((item) => [item.item_id, item.quantity, item.unit])).toEqual([
      ['yellowtail-id', 4, 'cs'],
      ['salmon-id', 5, 'cs'],
      ['octopus-id', 8, 'cs'],
      ['tuna-id', 1, 'cs'],
      ['uni-id', 7, 'pc'],
    ]);
    expect(result.assistant_message).toBeTruthy();
    expect(result.diagnostics?.items_accepted).toBe(5);
  });

  test('repeated full list plus one new item returns only the new item', async () => {
    const existingParsedItems: ParsedItem[] = [
      parsed({ item_id: 'yellowtail-id', item_name: 'Yellowtail', display_name: 'Yellowtail', quantity: 4, unit: 'cs' }),
      parsed({ item_id: 'salmon-id', item_name: 'Salmon', display_name: 'Salmon', quantity: 5, unit: 'cs' }),
      parsed({ item_id: 'octopus-id', item_name: 'Octopus', display_name: 'Octopus', quantity: 8, unit: 'cs' }),
      parsed({ item_id: 'tuna-id', item_name: 'Tuna', display_name: 'Tuna', quantity: 1, unit: 'cs' }),
    ];

    const result = await parseQuickOrder({
      rawText: 'Yellowtail 4cs\nSalmon 5cs\n8cs octopus\n1cs tuna\n7pc uni',
      catalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems,
    });

    expect(result.parsed_items).toHaveLength(1);
    expect(result.parsed_items[0]).toMatchObject({ item_id: 'uni-id', quantity: 7, unit: 'pc' });
    expect(result.diagnostics?.unchanged_count).toBe(4);
  });

  test('invalid LLM output does not discard deterministic partial results', async () => {
    const result = await parseQuickOrder({
      rawText: 'salmon 1pc\nmystery thing 2lb',
      catalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
      callLlm: async () => 'this is not json',
    });

    expect(result.reply_text).not.toContain('LLM did not return');
    expect(result.parsed_items.some((item) => item.item_id === 'salmon-id')).toBe(true);
    expect(result.flags.some((flag) => flag.type === 'invalid_json')).toBe(true);
  });
});

describe('frontend quick order merge and clarification helpers', () => {
  const existing: ParsedQuickOrderItem = {
    item_id: 'salmon-id',
    item_name: 'Salmon',
    raw_token: 'salmon 4cs',
    quantity: 4,
    unit: 'cs',
  };

  test('keys include unit so different units do not overwrite each other', () => {
    const pc: ParsedQuickOrderItem = { ...existing, raw_token: 'salmon 4pc', quantity: 4, unit: 'pc' };
    expect(getParsedItemKey(existing)).not.toBe(getParsedItemKey(pc));
    expect(mergeQuickOrderParsedItems([existing], [pc])).toHaveLength(2);
  });

  test('detailed merge keeps null-item-id review rows instead of dropping them', () => {
    const review: ParsedQuickOrderItem = {
      item_id: null,
      item_name: 'tai',
      display_name: 'tai',
      raw_text: '1cs tai',
      raw_token: '1cs tai',
      quantity: 1,
      unit: 'cs',
      needs_clarification: true,
      unresolved: true,
      status: 'ambiguous',
    };
    const result = mergeQuickOrderParsedItemsDetailed([], [review]);
    expect(result.items).toEqual([review]);
    expect(result.reviewCount).toBe(1);
  });

  test('repeated full list with one new item detects unchanged and adds only new item', () => {
    const existingItems: ParsedQuickOrderItem[] = [
      { item_id: 'yellowtail-id', item_name: 'Yellowtail', quantity: 4, unit: 'cs' },
      { item_id: 'salmon-id', item_name: 'Salmon', quantity: 5, unit: 'cs' },
      { item_id: 'octopus-id', item_name: 'Octopus', quantity: 8, unit: 'cs' },
      { item_id: 'tuna-id', item_name: 'Tuna', quantity: 1, unit: 'cs' },
    ];
    const incomingItems: ParsedQuickOrderItem[] = [
      ...existingItems,
      { item_id: 'uni-id', item_name: 'Uni', quantity: 7, unit: 'pc' },
    ];

    const repeated = detectRepeatedOrderList(existingItems, incomingItems);
    const result = mergeQuickOrderParsedItemsDetailed(existingItems, incomingItems);
    expect(repeated).toMatchObject({ isRepeatedList: true, unchangedCount: 4 });
    expect(result.items).toHaveLength(5);
    expect(result.addedItems).toEqual([{ item_id: 'uni-id', item_name: 'Uni', quantity: 7, unit: 'pc' }]);
    expect(result.unchangedCount).toBe(4);
  });

  test('exact repeated full list reports unchanged instead of duplicating', () => {
    const existingItems: ParsedQuickOrderItem[] = [
      { item_id: 'yellowtail-id', item_name: 'Yellowtail', quantity: 4, unit: 'cs' },
      { item_id: 'salmon-id', item_name: 'Salmon', quantity: 5, unit: 'cs' },
    ];
    const result = mergeQuickOrderParsedItemsDetailed(existingItems, [...existingItems]);
    expect(result.items).toHaveLength(2);
    expect(result.addedCount).toBe(0);
    expect(result.unchangedCount).toBe(2);
  });

  test('normalizes malformed parser response without Got it copy', () => {
    const normalized = normalizeQuickOrderParseResponse({ status: 'ok', reply_text: 'Got it.', parsed_items: [] });
    const mergeResult = mergeQuickOrderParsedItemsDetailed([], normalized.parsedItems);
    expect(buildQuickOrderAssistantMessage({
      normalized,
      mergeResult,
      pendingCount: normalized.pendingActions.length,
    })).toBe('I had trouble reading that order. Please try again or add the items manually.');
  });

  test('assistant message is based on merge result', () => {
    const normalized = normalizeQuickOrderParseResponse({
      assistant_message: 'Got it.',
      parsed_items: [{ item_id: 'uni-id', item_name: 'Uni', quantity: 7, unit: 'pc' }],
    });
    const mergeResult = mergeQuickOrderParsedItemsDetailed([], normalized.parsedItems);
    expect(buildQuickOrderAssistantMessage({
      normalized,
      mergeResult,
      pendingCount: 0,
    })).toBe('Added 1 item.');
  });

  test('clarification add, replace, keep separate, and cancel work', () => {
    const incoming: ParsedQuickOrderItem = { ...existing, raw_token: 'salmon 2cs', quantity: 2 };
    const clarification = {
      id: 'c1',
      type: 'quantity_conflict' as const,
      item_id: 'salmon-id',
      item_name: 'Salmon',
      existing_item_key: getParsedItemKey(existing),
      incoming_item: incoming,
      message: 'Add or replace?',
      actions: [],
    };
    expect(applyQuickOrderClarificationAction([existing], clarification, { id: 'add', label: 'Add' })[0].quantity).toBe(6);
    expect(applyQuickOrderClarificationAction([existing], clarification, { id: 'replace', label: 'Replace' })[0].quantity).toBe(2);
    expect(applyQuickOrderClarificationAction([existing], clarification, { id: 'keep_separate', label: 'Keep both' })).toHaveLength(2);
    expect(applyQuickOrderClarificationAction([existing], clarification, { id: 'cancel', label: 'Cancel' })).toEqual([existing]);
  });
});
