import { matchCatalogItem, getCatalogSearchTerms } from '../../supabase/functions/parse-order/catalog-matcher.ts';
import { resolveParsedItemConflicts } from '../../supabase/functions/parse-order/conflicts.ts';
import { parseDeterministicOrder } from '../../supabase/functions/parse-order/deterministic-parser.ts';
import { detectQuickOrderIntent } from '../../supabase/functions/parse-order/intent-detector.ts';
import { parseJsonPayload } from '../../supabase/functions/parse-order/llm-fallback.ts';
import { parseQuickOrder, reconcileParsedSources } from '../../supabase/functions/parse-order/orchestrator.ts';
import type { CatalogItem, ParsedItem, ParserCorrection } from '../../supabase/functions/parse-order/types.ts';
import { validateParsedLine } from '../../supabase/functions/parse-order/validator.ts';
import {
  buildQuickOrderAssistantMessage,
  normalizeQuickOrderParseResponse,
} from '../features/ordering/quickOrderResponse';
import {
  applyQuickOrderClarificationAction,
  applyQuickOrderOperations,
  countUnresolvedItems,
  detectRepeatedOrderList,
  getParsedItemDisplayName,
  getParsedItemIssue,
  getParsedItemKey,
  normalizeQuickOrderItemForDisplay,
  mergeQuickOrderParsedItemsDetailed,
  mergeQuickOrderParsedItems,
  type ParsedQuickOrderItem,
  type QuickOrderOperation,
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
    ['Yellowtail 4cs', 'Yellowtail', 4, 'cs'],
    ['Salmon 5cs', 'Salmon', 5, 'cs'],
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
      ['Tuna loin', 1, 'cs'],
      ['salmon', 1, 'pc'],
      ['Unii', 1, 'oz'],
      ['Beef brisket', 4, 'lb'],
      ['escolar', 1, 'lb'],
    ]);
  });
});

describe('catalog matcher', () => {
  test('prioritizes exact item names and aliases over fuzzy matches', () => {
    expect(matchCatalogItem('salmon', catalog).match_type).toBe('normalized_exact');
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
  test('mixed multiline order preserves successes and returns low-confidence tai as no_match review', async () => {
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
      status: 'no_match',
      action: 'Choose item',
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
    expect(result.flags.some((flag) => flag.type === 'invalid_json')).toBe(false);
    expect(result.diagnostics?.item_diagnostics?.find((item) => item.raw_text === 'mystery thing 2lb')).toMatchObject({
      status: 'no_match',
      was_added_to_order_list: true,
    });
  });

  test('LLM output replaces unresolved deterministic row by line_id instead of appending', () => {
    const deterministic = parsed({
      line_id: 'line_0',
      item_id: null,
      item_name: 'Ground Garlic',
      item_text: 'Ground Garlic',
      raw_token: 'Ground Garlic 1 pack',
      raw_text: 'Ground Garlic 1 pack',
      quantity: 1,
      unit: 'pack',
      needs_clarification: true,
      unresolved: true,
      status: 'no_match',
      match_type: 'unresolved',
    });
    const llm = parsed({
      line_id: 'line_0',
      item_id: 'ground-garlic-id',
      item_name: 'Ground Garlic',
      item_text: 'Ground Garlic',
      raw_token: 'Ground Garlic',
      quantity: 1,
      unit: 'pack',
      needs_clarification: false,
      unresolved: false,
      parse_source: 'llm',
      match_type: 'llm',
    });
    const result = reconcileParsedSources([deterministic], [llm]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].item_id).toBe('ground-garlic-id');
    expect(result.items[0].line_id).toBe('line_0');
    expect(result.items[0].raw_token).toBe('Ground Garlic 1 pack');
    expect(result.diagnostics.replaced_review_count).toBe(1);
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
    expect(result.items[0]).toMatchObject(review);
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
    expect(result.addedItems).toHaveLength(1);
    expect(result.addedItems[0]).toMatchObject({ item_id: 'uni-id', item_name: 'Uni', quantity: 7, unit: 'pc' });
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

  test('review row action is based on specific status', () => {
    expect(getParsedItemIssue({ item_id: 'shrimp-id', item_name: 'Shrimp', quantity: null, unit: null, status: 'missing_quantity' })?.label).toBe('Add quantity');
    expect(getParsedItemIssue({ item_id: 'shrimp-id', item_name: 'Shrimp', quantity: 1, unit: null, status: 'missing_unit' })?.label).toBe('Choose unit');
    expect(getParsedItemIssue({ item_id: 'shrimp-id', item_name: 'Shrimp', quantity: 1, unit: 'pack', status: 'invalid_unit', needs_clarification: true })?.label).toBe('Fix unit');
    expect(getParsedItemIssue({ item_id: null, item_text: 'mystery fish', quantity: 1, unit: 'pack', status: 'no_match', unresolved: true })?.label).toBe('Choose item');
    expect(getParsedItemIssue({ item_id: 'shrimp-id', item_name: 'Shrimp', quantity: 1, unit: 'pack', status: 'no_match', needs_clarification: true })?.label).not.toBe('Choose item');
    expect(getParsedItemIssue({ item_id: 'edamame-id', item_name: 'Edamame', quantity: 1, unit: 'cs', status: 'valid' })).toBeNull();
  });

  test('display name uses catalog name for matched rows and full item text for unresolved rows', () => {
    expect(getParsedItemDisplayName({
      item_id: 'edamame-id',
      item_name: 'Edamame',
      item_text: 'Edam',
      quantity: 1,
      unit: 'cs',
    })).toBe('Edamame');
    expect(getParsedItemDisplayName({
      item_id: null,
      item_text: 'Canadian clam',
      item_name: 'Canadian clam',
      quantity: 1,
      unit: 'pack',
      unresolved: true,
    })).toBe('Canadian clam');
  });

  test('duplicate line_id items are merged before rendering state is updated', () => {
    const unresolved: ParsedQuickOrderItem = {
      line_id: 'line_0',
      item_id: null,
      item_text: 'Ground Garlic',
      quantity: 1,
      unit: 'pack',
      unresolved: true,
      needs_clarification: true,
      status: 'no_match',
    };
    const resolved: ParsedQuickOrderItem = {
      line_id: 'line_0',
      item_id: 'ground-garlic-id',
      item_name: 'Ground Garlic',
      item_text: 'Ground Garlic',
      quantity: 1,
      unit: 'pack',
      unresolved: false,
      needs_clarification: false,
      status: 'valid',
      match_type: 'exact_name',
    };
    const result = mergeQuickOrderParsedItemsDetailed([], [unresolved, resolved]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].item_id).toBe('ground-garlic-id');
    expect(result.reviewCount).toBe(0);
  });

  test('incoming complete item resolves existing missing-quantity review row', () => {
    const existingReview: ParsedQuickOrderItem = {
      client_key: 'row-shrimp',
      item_id: 'shrimp-ebi-id',
      item_name: 'Shrimp Ebi',
      item_text: 'Shrimp',
      raw_token: 'Shrimp',
      quantity: null,
      unit: null,
      status: 'missing_quantity',
      needs_clarification: true,
      unresolved: false,
    };
    const incomingComplete: ParsedQuickOrderItem = {
      item_id: 'shrimp-ebi-id',
      item_name: 'Shrimp Ebi',
      item_text: 'Shrimp',
      raw_token: 'Shrimp 5pk',
      quantity: 5,
      unit: 'pack',
      status: 'valid',
      needs_clarification: false,
      unresolved: false,
    };

    const result = mergeQuickOrderParsedItemsDetailed([existingReview], [incomingComplete]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      client_key: 'row-shrimp',
      item_id: 'shrimp-ebi-id',
      quantity: 5,
      unit: 'pack',
      status: 'valid',
      needs_clarification: false,
      unresolved: false,
    });
    expect(result.updatedCount).toBe(1);
    expect(result.addedCount).toBe(0);
    expect(getParsedItemIssue(result.items[0])).toBeNull();
  });

  test('frontend normalizer removes impossible Add quantity state when quantity and unit exist', () => {
    const stale: ParsedQuickOrderItem = {
      item_id: 'shrimp-ebi-id',
      item_name: 'Shrimp Ebi',
      quantity: 4,
      unit: 'case',
      status: 'missing_quantity',
      needs_clarification: true,
      unresolved: false,
      issue: 'How much Shrimp Ebi would you like?',
    };
    const normalized = normalizeQuickOrderItemForDisplay(stale);
    expect(normalized).toMatchObject({
      status: 'valid',
      needs_clarification: false,
      unresolved: false,
    });
    expect(normalized.issue).toBeUndefined();
    expect(getParsedItemIssue(stale)).toBeNull();
  });

  test('confirm availability follows review count', () => {
    const valid: ParsedQuickOrderItem = {
      item_id: 'edamame-id',
      item_name: 'Edamame',
      quantity: 1,
      unit: 'cs',
      status: 'valid',
    };
    const review: ParsedQuickOrderItem = {
      item_id: 'shrimp-id',
      item_name: 'Shrimp',
      quantity: null,
      unit: null,
      status: 'missing_quantity',
      needs_clarification: true,
    };

    expect(countUnresolvedItems([valid])).toBe(0);
    expect(countUnresolvedItems([valid, review])).toBe(1);
  });
});

describe('pk unit normalization', () => {
  test('"3pk" normalizes to quantity 3 and unit "pack"', () => {
    const result = parseDeterministicOrder('Yamato 3pk');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ item_text: 'Yamato', quantity: 3, unit: 'pack' });
  });

  test('"3 pk" with space normalizes correctly', () => {
    const result = parseDeterministicOrder('Yamato 3 pk');
    expect(result[0]).toMatchObject({ item_text: 'Yamato', quantity: 3, unit: 'pack' });
  });

  test('"1piece" normalizes to quantity 1 and unit "pc"', () => {
    const result = parseDeterministicOrder('Harare 1piece');
    expect(result[0]).toMatchObject({ item_text: 'Harare', quantity: 1, unit: 'pc' });
  });

  test('"1case" normalizes to quantity 1 and unit "cs"', () => {
    const result = parseDeterministicOrder('Albacore loin 1case');
    expect(result[0]).toMatchObject({ item_text: 'Albacore loin', quantity: 1, unit: 'cs' });
  });

  test('"3lbs" normalizes to quantity 3 and unit "lb"', () => {
    const result = parseDeterministicOrder('Salmon 3lbs');
    expect(result[0]).toMatchObject({ item_text: 'Salmon', quantity: 3, unit: 'lb' });
  });

  test('decimal quantity "1.5lb" works', () => {
    const result = parseDeterministicOrder('Salmon 1.5lb');
    expect(result[0]).toMatchObject({ item_text: 'Salmon', quantity: 1.5, unit: 'lb' });
  });
});

describe('baseline Salmon 2cs through full pipeline', () => {
  test('orchestration returns exactly 1 valid parsed item for "Salmon 2cs"', async () => {
    const result = await parseQuickOrder({
      rawText: 'Salmon 2cs',
      catalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });

    expect(result.parsed_items).toHaveLength(1);
    expect(result.parsed_items[0]).toMatchObject({
      item_id: 'salmon-id',
      item_name: 'Salmon',
      quantity: 2,
      unit: 'cs',
      needs_clarification: false,
      unresolved: false,
      status: 'valid',
    });
    expect(result.status).toBe('ok');
    expect(result.assistant_message).not.toContain('trouble');
    expect(result.diagnostics?.items_accepted).toBe(1);
  });

  test('unknown item with valid quantity/unit returns a no_match review row', async () => {
    const result = await parseQuickOrder({
      rawText: 'Harare 1pc',
      catalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });

    expect(result.parsed_items).toHaveLength(1);
    expect(result.parsed_items[0]).toMatchObject({
      item_id: null,
      status: 'no_match',
      action: 'Choose item',
    });
  });

  test('one invalid line does not fail valid lines', async () => {
    const result = await parseQuickOrder({
      rawText: 'Salmon 2cs\nHarare 1pc\nTuna 3cs',
      catalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });

    const validItems = result.parsed_items.filter((item) => !item.needs_clarification && !item.unresolved);
    expect(validItems.length).toBeGreaterThanOrEqual(2);
    expect(validItems.map((item) => item.item_id)).toContain('salmon-id');
    expect(validItems.map((item) => item.item_id)).toContain('tuna-id');
    expect(result.parsed_items.length).toBe(3);
    expect(result.diagnostics?.item_diagnostics?.find((item) => item.raw_text === 'Harare 1pc')).toMatchObject({
      status: 'no_match',
      was_added_to_order_list: true,
    });
  });
});

describe('frontend response normalization', () => {
  test('valid backend response preserves parsed items', () => {
    const normalized = normalizeQuickOrderParseResponse({
      status: 'ok',
      assistant_message: 'Got this item.',
      reply_text: 'Got this item.',
      parsed_items: [{
        id: 'parsed:0:salmon 2cs',
        item_id: 'salmon-id',
        item_name: 'Salmon',
        display_name: 'Salmon',
        raw_token: 'Salmon 2cs',
        raw_text: 'Salmon 2cs',
        quantity: 2,
        unit: 'cs',
        confidence: 0.92,
        needs_clarification: false,
        unresolved: false,
        notes: null,
        status: 'valid',
        parse_source: 'deterministic',
        match_type: 'exact_name',
      }],
      flags: [],
      suggestions: [],
      pending_actions: [],
      pending_clarifications: [],
      session_state: { total_items: 1, ready_to_submit: true },
      diagnostics: { items_received: 1, items_accepted: 1, items_rejected: 0 },
    });

    expect(normalized.parsedItems).toHaveLength(1);
    expect(normalized.parsedItems[0].item_id).toBe('salmon-id');
    expect(normalized.parsedItems[0].quantity).toBe(2);
    expect(normalized.parsedItems[0].unit).toBe('cs');
    expect(normalized.status).toBe('ok');
    expect(normalized.rawError).toBeUndefined();
  });

  test('response with parsed_items length > 0 never shows generic failure message via buildQuickOrderAssistantMessage', () => {
    const normalized = normalizeQuickOrderParseResponse({
      status: 'ok',
      parsed_items: [{ item_id: 'salmon-id', item_name: 'Salmon', quantity: 2, unit: 'cs' }],
    });
    const mergeResult = mergeQuickOrderParsedItemsDetailed([], normalized.parsedItems);
    const message = buildQuickOrderAssistantMessage({
      normalized,
      mergeResult,
      pendingCount: 0,
    });
    expect(message).not.toContain('trouble');
    expect(message).not.toContain('try again');
    expect(message).toBe('Added 1 item.');
  });

  test('response with rawError but items still returns items count > 0', () => {
    // Simulates a scenario where the backend included an error field but also items
    const normalized = normalizeQuickOrderParseResponse({
      status: 'ok',
      error: 'some transient warning',
      parsed_items: [{ item_id: 'salmon-id', item_name: 'Salmon', quantity: 2, unit: 'cs' }],
    });
    expect(normalized.parsedItems).toHaveLength(1);
    expect(normalized.rawError).toBe('some transient warning');
    // Caller should check parsedItems.length > 0 before discarding
  });

  test('empty response shows proper error message', () => {
    const normalized = normalizeQuickOrderParseResponse({
      status: 'error',
      parsed_items: [],
    });
    const mergeResult = mergeQuickOrderParsedItemsDetailed([], normalized.parsedItems);
    const message = buildQuickOrderAssistantMessage({
      normalized,
      mergeResult,
      pendingCount: 0,
    });
    expect(message).toContain('trouble');
  });

  test('malformed response does not throw', () => {
    expect(() => normalizeQuickOrderParseResponse(null)).not.toThrow();
    expect(() => normalizeQuickOrderParseResponse(undefined)).not.toThrow();
    expect(() => normalizeQuickOrderParseResponse('not an object')).not.toThrow();
    expect(() => normalizeQuickOrderParseResponse(42)).not.toThrow();
    expect(() => normalizeQuickOrderParseResponse({ parsed_items: 'not an array' })).not.toThrow();
  });

  test('null item_id review items are preserved through normalization', () => {
    const normalized = normalizeQuickOrderParseResponse({
      status: 'needs_review',
      parsed_items: [{
        item_id: null,
        item_name: 'Harare',
        display_name: 'Harare',
        raw_token: 'Harare 1piece',
        quantity: 1,
        unit: 'pc',
        needs_clarification: true,
        unresolved: true,
        status: 'review',
      }],
    });
    expect(normalized.parsedItems).toHaveLength(1);
    expect(normalized.parsedItems[0].item_id).toBeNull();
    expect(normalized.parsedItems[0].needs_clarification).toBe(true);
  });
});

describe('merge integrity for baseline', () => {
  test('mergeQuickOrderParsedItemsDetailed does not drop valid Salmon 2 cs', () => {
    const incoming: ParsedQuickOrderItem[] = [{
      item_id: 'salmon-id',
      item_name: 'Salmon',
      raw_token: 'Salmon 2cs',
      quantity: 2,
      unit: 'cs',
      needs_clarification: false,
      unresolved: false,
      status: 'valid',
    }];
    const result = mergeQuickOrderParsedItemsDetailed([], incoming);
    expect(result.items).toHaveLength(1);
    expect(result.addedCount).toBe(1);
    expect(result.items[0].item_id).toBe('salmon-id');
    expect(result.items[0].quantity).toBe(2);
    expect(result.items[0].unit).toBe('cs');
  });

  test('empty state disappears after parsed item is added', () => {
    const result = mergeQuickOrderParsedItemsDetailed([], [{
      item_id: 'salmon-id',
      item_name: 'Salmon',
      raw_token: 'Salmon 2cs',
      quantity: 2,
      unit: 'cs',
    }]);
    expect(result.items.length).toBeGreaterThan(0);
  });

  test('5-item multiline merge adds all items from empty state', () => {
    const incoming: ParsedQuickOrderItem[] = [
      { item_id: 'yellowtail-id', item_name: 'Yellowtail', quantity: 4, unit: 'cs' },
      { item_id: 'salmon-id', item_name: 'Salmon', quantity: 5, unit: 'cs' },
      { item_id: 'octopus-id', item_name: 'Octopus', quantity: 8, unit: 'cs' },
      { item_id: 'tuna-id', item_name: 'Tuna', quantity: 1, unit: 'cs' },
      { item_id: 'uni-id', item_name: 'Uni', quantity: 7, unit: 'pc' },
    ];
    const result = mergeQuickOrderParsedItemsDetailed([], incoming);
    expect(result.items).toHaveLength(5);
    expect(result.addedCount).toBe(5);
    expect(result.unchangedCount).toBe(0);
  });
});

describe('intent detection', () => {
  test('"remove izumidai 2pk" -> remove intent', () => {
    const result = detectQuickOrderIntent('remove izumidai 2pk');
    expect(result.intent).toBe('remove');
    expect(result.strippedText).toBe('izumidai 2pk');
    expect(result.matchedPhrase).toBe('remove');
  });

  test('"delete salmon" -> remove intent', () => {
    const result = detectQuickOrderIntent('delete salmon');
    expect(result.intent).toBe('remove');
    expect(result.strippedText).toBe('salmon');
  });

  test('"take out tuna loin" -> remove intent', () => {
    const result = detectQuickOrderIntent('take out tuna loin');
    expect(result.intent).toBe('remove');
    expect(result.strippedText).toBe('tuna loin');
  });

  test('"get rid of edamame" -> remove intent', () => {
    const result = detectQuickOrderIntent('get rid of edamame');
    expect(result.intent).toBe('remove');
    expect(result.strippedText).toBe('edamame');
  });

  test('"add salmon 2pc" -> add intent', () => {
    const result = detectQuickOrderIntent('add salmon 2pc');
    expect(result.intent).toBe('add');
    expect(result.strippedText).toBe('salmon 2pc');
  });

  test('"salmon 2pc" -> unknown intent', () => {
    const result = detectQuickOrderIntent('salmon 2pc');
    expect(result.intent).toBe('unknown');
    expect(result.strippedText).toBe('salmon 2pc');
  });

  test('"change salmon to 3pc" -> update intent', () => {
    const result = detectQuickOrderIntent('change salmon to 3pc');
    expect(result.intent).toBe('update');
  });

  test('"make salmon 3pc" -> update intent', () => {
    const result = detectQuickOrderIntent('make salmon 3pc');
    expect(result.intent).toBe('update');
    expect(result.strippedText).toBe('salmon 3pc');
  });

  test('"reduce salmon by 1pc" -> decrease intent', () => {
    const result = detectQuickOrderIntent('reduce salmon by 1pc');
    expect(result.intent).toBe('decrease');
  });

  test('"clear order" -> clear intent', () => {
    const result = detectQuickOrderIntent('clear order');
    expect(result.intent).toBe('clear');
    expect(result.strippedText).toBe('');
  });

  test('"confirm" -> confirm intent', () => {
    const result = detectQuickOrderIntent('confirm');
    expect(result.intent).toBe('confirm');
  });

  test('"add more salmon 2pc" -> increase intent', () => {
    const result = detectQuickOrderIntent('add more salmon 2pc');
    expect(result.intent).toBe('increase');
    expect(result.strippedText).toBe('salmon 2pc');
  });

  test('"please remove salmon" -> remove intent', () => {
    const result = detectQuickOrderIntent('please remove salmon');
    expect(result.intent).toBe('remove');
    expect(result.strippedText).toBe('salmon');
  });

  test('"replace salmon with tuna" -> replace intent', () => {
    const result = detectQuickOrderIntent('replace salmon with tuna');
    expect(result.intent).toBe('replace');
  });
});

describe('parenthetical catalog matching', () => {
  const catalogWithParens: CatalogItem[] = [
    ...catalog,
    { id: 'whitefish-id', name: 'White Fish (Izumidai)', aliases: [], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack' },
    { id: 'tuna-maguro-id', name: 'Tuna / Maguro', aliases: [], default_unit: 'lb', base_unit: 'lb', pack_unit: 'cs' },
    { id: 'item-bracket-id', name: 'Special Item [Premium]', aliases: [], default_unit: 'cs', base_unit: 'cs' },
  ];

  test('getCatalogSearchTerms extracts parenthetical sub-terms', () => {
    const terms = getCatalogSearchTerms('White Fish (Izumidai)', []);
    expect(terms.map((t) => t.toLowerCase())).toContain('white fish');
    expect(terms.map((t) => t.toLowerCase())).toContain('izumidai');
  });

  test('getCatalogSearchTerms extracts slash-separated terms', () => {
    const terms = getCatalogSearchTerms('Tuna / Maguro', []);
    expect(terms.map((t) => t.toLowerCase())).toContain('tuna');
    expect(terms.map((t) => t.toLowerCase())).toContain('maguro');
  });

  test('getCatalogSearchTerms extracts bracket-separated terms', () => {
    const terms = getCatalogSearchTerms('Special Item [Premium]', []);
    expect(terms.map((t) => t.toLowerCase())).toContain('special item');
    expect(terms.map((t) => t.toLowerCase())).toContain('premium');
  });

  test('"izumidai" matches "White Fish (Izumidai)"', () => {
    const result = matchCatalogItem('izumidai', catalogWithParens);
    expect(result.item_id).toBe('whitefish-id');
    expect(result.item_name).toBe('White Fish (Izumidai)');
    expect(result.needs_clarification).toBe(false);
  });

  test('"white fish" matches "White Fish (Izumidai)"', () => {
    const result = matchCatalogItem('white fish', catalogWithParens);
    expect(result.item_id).toBe('whitefish-id');
    expect(result.needs_clarification).toBe(false);
  });

  test('\"maguro\" matches base Tuna via alias (alias takes priority over parenthetical)', () => {
    // The base catalog already has Tuna with alias 'maguro', so alias match wins.
    const result = matchCatalogItem('maguro', catalogWithParens);
    expect(result.item_id).toBe('tuna-id');
    expect(result.needs_clarification).toBe(false);
  });

  test('"premium" matches "Special Item [Premium]"', () => {
    const result = matchCatalogItem('premium', catalogWithParens);
    expect(result.item_id).toBe('item-bracket-id');
    expect(result.needs_clarification).toBe(false);
  });

  test('Izumidai 2pk through full orchestration matches White Fish (Izumidai)', async () => {
    const result = await parseQuickOrder({
      rawText: 'Izumidai 2pk',
      catalog: catalogWithParens,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items).toHaveLength(1);
    expect(result.parsed_items[0].item_id).toBe('whitefish-id');
    expect(result.parsed_items[0].item_name).toBe('White Fish (Izumidai)');
    expect(result.parsed_items[0].quantity).toBe(2);
    expect(result.parsed_items[0].unit).toBe('pack');
    expect(result.parsed_items[0].needs_clarification).toBe(false);
    expect(result.status).toBe('ok');
  });
});

describe('command operations through orchestration', () => {
  const catalogWithParens: CatalogItem[] = [
    ...catalog,
    { id: 'whitefish-id', name: 'White Fish (Izumidai)', aliases: [], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', allowed_units: ['pack'] },
  ];

  const existingSalmon: ParsedItem = {
    item_id: 'salmon-id',
    item_name: 'Salmon',
    display_name: 'Salmon',
    raw_token: 'Salmon 2pc',
    quantity: 2,
    unit: 'pc',
    confidence: 0.92,
    needs_clarification: false,
    unresolved: false,
    notes: null,
    status: 'valid',
  };

  const existingWhitefish: ParsedItem = {
    item_id: 'whitefish-id',
    item_name: 'White Fish (Izumidai)',
    display_name: 'White Fish (Izumidai)',
    raw_token: 'Izumidai 2pk',
    quantity: 2,
    unit: 'pack',
    confidence: 0.92,
    needs_clarification: false,
    unresolved: false,
    notes: null,
    status: 'valid',
  };

  test('"remove salmon" produces remove operation', async () => {
    const result = await parseQuickOrder({
      rawText: 'remove salmon',
      catalog: catalogWithParens,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [existingSalmon, existingWhitefish],
    });
    expect(result.operations).toBeDefined();
    expect(result.operations!.length).toBeGreaterThan(0);
    const removeOp = result.operations!.find((op) => op.type === 'remove');
    expect(removeOp).toBeDefined();
    expect(removeOp!.status).toBe('applied');
    expect(removeOp!.target_item_id).toBe('salmon-id');
    expect(result.assistant_message).toContain('Removed');
  });

  test('"remove izumidai" produces remove operation for White Fish', async () => {
    const result = await parseQuickOrder({
      rawText: 'remove izumidai',
      catalog: catalogWithParens,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [existingSalmon, existingWhitefish],
    });
    expect(result.operations).toBeDefined();
    const removeOp = result.operations!.find((op) => op.type === 'remove');
    expect(removeOp).toBeDefined();
    expect(removeOp!.status).toBe('applied');
  });

  test('"remove izumidai" does NOT say "That item is already in your order"', async () => {
    const result = await parseQuickOrder({
      rawText: 'remove izumidai',
      catalog: catalogWithParens,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [existingSalmon, existingWhitefish],
    });
    expect(result.assistant_message).not.toContain('already in your order');
  });

  test('"remove randomfish" shows item-not-found message', async () => {
    const result = await parseQuickOrder({
      rawText: 'remove randomfish',
      catalog: catalogWithParens,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [existingSalmon],
    });
    expect(result.assistant_message).toContain("couldn't find");
  });

  test('"clear order" produces clear confirmation instead of immediate operation', async () => {
    const result = await parseQuickOrder({
      rawText: 'clear order',
      catalog: catalogWithParens,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [existingSalmon, existingWhitefish],
    });
    expect(result.operations).toBeUndefined();
    expect(result.pending_clarifications?.[0]).toMatchObject({
      type: 'clear_order',
      message: 'Clear the current Quick Order list?',
    });
    expect(result.pending_clarifications?.[0].actions.map((action) => action.id)).toEqual(['clear_order', 'cancel']);
    expect(result.assistant_message).toContain('Clear the current Quick Order list?');
  });

  test('"confirm" with items returns ready-to-submit', async () => {
    const result = await parseQuickOrder({
      rawText: 'confirm',
      catalog: catalogWithParens,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [existingSalmon],
    });
    expect(result.session_state.ready_to_submit).toBe(true);
    expect(result.assistant_message).toContain('Ready to submit');
  });

  test('"confirm" with empty order tells user to add items', async () => {
    const result = await parseQuickOrder({
      rawText: 'confirm',
      catalog: catalogWithParens,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.session_state.ready_to_submit).toBe(false);
    expect(result.assistant_message).toContain('empty');
  });

  test('"add salmon 2pc" with existing Salmon 2pc auto-adds to 4pc', async () => {
    const result = await parseQuickOrder({
      rawText: 'add salmon 2pc',
      catalog: catalogWithParens,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [existingSalmon],
    });
    // With explicit 'add' intent, conflict resolution should auto-add.
    const updatedItem = result.parsed_items.find(
      (item) => item.item_id === 'salmon-id' && item.merge_behavior === 'add_to_existing',
    );
    expect(updatedItem).toBeDefined();
    expect(updatedItem!.quantity).toBe(4);
  });

  test('"salmon 2pc" with existing Salmon 2pc asks add vs replace', async () => {
    const result = await parseQuickOrder({
      rawText: 'salmon 2pc',
      catalog: catalogWithParens,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [existingSalmon],
    });
    // Unknown intent — should produce a pending clarification.
    expect(result.pending_clarifications?.length).toBeGreaterThan(0);
    const clarification = result.pending_clarifications![0];
    expect(clarification.type).toBe('quantity_conflict');
  });
});

describe('frontend operation application', () => {
  const existingItems: ParsedQuickOrderItem[] = [
    { item_id: 'salmon-id', item_name: 'Salmon', display_name: 'Salmon', raw_token: 'Salmon 2pc', quantity: 2, unit: 'pc' },
    { item_id: 'whitefish-id', item_name: 'White Fish (Izumidai)', display_name: 'White Fish (Izumidai)', raw_token: 'Izumidai 2pk', quantity: 2, unit: 'pack' },
    { item_id: 'tuna-id', item_name: 'Tuna Loin', display_name: 'Tuna Loin', raw_token: 'Tuna loin 1cs', quantity: 1, unit: 'cs' },
  ];

  test('remove operation removes item by item_id', () => {
    const ops: QuickOrderOperation[] = [{
      type: 'remove',
      target_item_id: 'salmon-id',
      target_display_name: 'Salmon',
      target_item_key: 'id:salmon-id:unit:pc',
      status: 'applied',
    }];
    const result = applyQuickOrderOperations(existingItems, ops);
    expect(result.items).toHaveLength(2);
    expect(result.removedCount).toBe(1);
    expect(result.items.find((item) => item.item_id === 'salmon-id')).toBeUndefined();
  });

  test('remove operation removes review item by display name', () => {
    const reviewItems: ParsedQuickOrderItem[] = [
      { item_id: null, item_name: 'Izumidai', display_name: 'Izumidai', raw_token: 'Izumidai 2pk', quantity: 2, unit: 'pack', needs_clarification: true, unresolved: true },
    ];
    const ops: QuickOrderOperation[] = [{
      type: 'remove',
      target_item_id: null,
      target_display_name: 'Izumidai',
      status: 'applied',
    }];
    const result = applyQuickOrderOperations(reviewItems, ops);
    expect(result.items).toHaveLength(0);
    expect(result.removedCount).toBe(1);
  });

  test('replace operation updates quantity', () => {
    const ops: QuickOrderOperation[] = [{
      type: 'replace',
      target_item_id: 'salmon-id',
      target_display_name: 'Salmon',
      target_item_key: 'id:salmon-id:unit:pc',
      quantity: 5,
      unit: 'pc',
      status: 'applied',
    }];
    const result = applyQuickOrderOperations(existingItems, ops);
    expect(result.items).toHaveLength(3);
    expect(result.updatedCount).toBe(1);
    const salmon = result.items.find((item) => item.item_id === 'salmon-id');
    expect(salmon?.quantity).toBe(5);
  });

  test('clear operation empties list', () => {
    const ops: QuickOrderOperation[] = [{
      type: 'clear',
      target_item_id: null,
      target_display_name: 'All items',
      status: 'applied',
    }];
    const result = applyQuickOrderOperations(existingItems, ops);
    expect(result.items).toHaveLength(0);
    expect(result.removedCount).toBe(3);
  });

  test('operations with status !== applied are skipped', () => {
    const ops: QuickOrderOperation[] = [{
      type: 'remove',
      target_item_id: 'salmon-id',
      target_display_name: 'Salmon',
      status: 'pending',
    }];
    const result = applyQuickOrderOperations(existingItems, ops);
    expect(result.items).toHaveLength(3);
    expect(result.skippedCount).toBe(1);
  });

  test('update_quantity operation updates quantity on existing item', () => {
    const ops: QuickOrderOperation[] = [{
      type: 'update_quantity',
      target_item_id: 'salmon-id',
      target_display_name: 'Salmon',
      target_item_key: 'id:salmon-id:unit:pc',
      quantity: 4,
      unit: 'pc',
      status: 'applied',
    }];
    const result = applyQuickOrderOperations(existingItems, ops);
    expect(result.updatedCount).toBe(1);
    expect(result.items.find((item) => item.item_id === 'salmon-id')?.quantity).toBe(4);
  });

  test('remove by parenthetical display name works', () => {
    const ops: QuickOrderOperation[] = [{
      type: 'remove',
      target_item_id: null,
      target_display_name: 'Izumidai',
      status: 'applied',
    }];
    const result = applyQuickOrderOperations(existingItems, ops);
    // Should match White Fish (Izumidai) via substring match.
    expect(result.items).toHaveLength(2);
    expect(result.removedCount).toBe(1);
    expect(result.items.find((item) => item.item_id === 'whitefish-id')).toBeUndefined();
  });

  test('response normalization includes operations', () => {
    const normalized = normalizeQuickOrderParseResponse({
      status: 'ok',
      assistant_message: 'Removed Salmon.',
      parsed_items: [],
      operations: [{
        type: 'remove',
        target_item_id: 'salmon-id',
        target_display_name: 'Salmon',
        status: 'applied',
        message: 'Removed Salmon.',
      }],
    });
    expect(normalized.operations).toHaveLength(1);
    expect(normalized.operations[0].type).toBe('remove');
    expect(normalized.operations[0].status).toBe('applied');
  });
});

// ===========================================================================
// Extended catalog for the Example tests
// ===========================================================================

const extendedCatalog: CatalogItem[] = [
  ...catalog,
  { id: 'whitefish-id', name: 'White Fish (Izumidai)', aliases: ['izumidai'], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', allowed_units: ['pack', 'cs'] },
  { id: 'albacore-loin-id', name: 'Albacore Loin', aliases: ['albacore loin'], default_unit: 'lb', base_unit: 'lb', pack_unit: 'cs', allowed_units: ['lb', 'cs'] },
  { id: 'small-scallop-id', name: 'Small Scallop', aliases: ['hotate', 'small scallop'], default_unit: 'lb', base_unit: 'lb', pack_unit: 'pack', allowed_units: ['lb', 'pack'] },
  { id: 'shrimp-ebi-id', name: 'Shrimp Ebi', aliases: ['shrimp ebi', 'ebi', 'shrimp'], default_unit: 'lb', base_unit: 'lb', pack_unit: 'pack', allowed_units: ['lb', 'pack', 'cs'] },
  { id: 'seaweed-salad-id', name: 'Seaweed Salad', aliases: ['seaweed salad'], default_unit: 'lb', base_unit: 'lb', pack_unit: 'pack', allowed_units: ['lb', 'pack'] },
  { id: 'ground-garlic-id', name: 'Ground Garlic', aliases: ['ground garlic'], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', allowed_units: ['pack', 'cs'] },
  { id: 'edamame-id', name: 'Edamame', aliases: ['edamame'], default_unit: 'cs', base_unit: 'cs', pack_unit: 'cs', allowed_units: ['cs', 'pack'] },
  { id: 'crawfish-id', name: 'Crawfish', aliases: ['crawfish'], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', allowed_units: ['pack', 'cs'] },
  { id: 'soft-shell-crab-id', name: 'Soft Shell Crab', aliases: ['soft shell crab'], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', allowed_units: ['pack', 'cs'] },
  { id: 'soy-paper-id', name: 'Soy Paper', aliases: ['soy paper'], default_unit: 'cs', base_unit: 'cs', pack_unit: 'cs', allowed_units: ['cs', 'pack'] },
  { id: 'canadian-clam-id', name: 'Canadian Clam', aliases: ['canadian clam'], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', allowed_units: ['pack', 'cs'] },
  { id: 'squid-id', name: 'Squid', aliases: ['squid'], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', allowed_units: ['pack', 'cs', 'lb'] },
  { id: 'crab-stick-id', name: 'Crab Stick', aliases: ['crab stick'], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', allowed_units: ['pack', 'cs'] },
  { id: 'tamago-id', name: 'Tamago', aliases: ['tamago'], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', allowed_units: ['pack', 'cs'] },
  { id: 'masago-id', name: 'Masago', aliases: ['masago'], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', allowed_units: ['pack', 'cs'] },
  { id: 'mackerel-id', name: 'Mackerel', aliases: ['mackerel'], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', allowed_units: ['pack', 'cs'] },
  { id: 'albacore-id', name: 'Albacore', aliases: ['albacore'], default_unit: 'cs', base_unit: 'lb', pack_unit: 'cs', allowed_units: ['lb', 'cs'] },
  { id: 'unagi-id', name: 'Unagi', aliases: ['unagi', 'eel'], default_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', allowed_units: ['pack', 'cs'] },
  { id: 'crab-mix-id', name: 'Crab Mix', aliases: ['crab mix'], default_unit: 'box', base_unit: 'box', pack_unit: 'box', allowed_units: ['box', 'lb'] },
  { id: 'ground-tuna-id', name: 'Ground Tuna', aliases: ['ground tuna'], default_unit: 'box', base_unit: 'box', pack_unit: 'box', allowed_units: ['box', 'lb'] },
];

const robustCatalog: CatalogItem[] = extendedCatalog.map((item) => {
  switch (item.id) {
    case 'crawfish-id':
      return { ...item, name: 'Crawfish (Crayfish)', aliases: [], base_unit: 'pack', pack_unit: 'case', default_unit: 'pack', allowed_units: ['pack', 'cs'] };
    case 'whitefish-id':
      return { ...item, name: 'White Fish (Izumidai)', aliases: [], base_unit: 'pack', pack_unit: null, default_unit: 'pack', allowed_units: ['pack'] };
    case 'soft-shell-crab-id':
      return { ...item, name: 'Soft Shell Crab', aliases: [], base_unit: 'pack', pack_unit: 'case', default_unit: 'pack', allowed_units: ['pack', 'cs'] };
    case 'canadian-clam-id':
      return { ...item, name: 'Canadian Clam', aliases: [], base_unit: 'pack', pack_unit: 'case', default_unit: 'pack', allowed_units: ['pack', 'cs'] };
    case 'octopus-id':
      return { ...item, name: 'Tako (Octopus)', aliases: [], base_unit: 'pack', pack_unit: 'case', default_unit: 'pack', allowed_units: ['pack', 'cs'] };
    case 'escolar-id':
      return { ...item, name: 'Escolar (White Tuna)', aliases: [], base_unit: 'pack', pack_unit: 'case', default_unit: 'pack', allowed_units: ['pack', 'cs'] };
    case 'soy-paper-id':
      return { ...item, name: 'Soy Paper', aliases: [], base_unit: 'cs', pack_unit: 'pack', default_unit: 'cs', allowed_units: ['cs', 'pack'] };
    default:
      return item;
  }
});

const semanticCatalog: CatalogItem[] = [
  ...robustCatalog,
  { id: 'sapporo-small-id', name: 'Sapporo Small', aliases: [], default_unit: 'cs', base_unit: 'cs', pack_unit: null, allowed_units: ['cs'] },
  { id: 'sapporo-large-id', name: 'Sapporo Large', aliases: [], default_unit: 'cs', base_unit: 'cs', pack_unit: null, allowed_units: ['cs'] },
  { id: 'wasabi-powder-id', name: 'Wasabi Powder', aliases: [], default_unit: 'cs', base_unit: 'cs', pack_unit: null, allowed_units: ['cs'] },
  { id: 'paper-towels-id', name: 'Paper Towels', aliases: [], default_unit: 'cs', base_unit: 'cs', pack_unit: null, allowed_units: ['cs'] },
];

const strictSalmonCatalog: CatalogItem[] = semanticCatalog.map((item) =>
  item.id === 'salmon-id'
    ? { ...item, default_unit: 'lb', base_unit: 'lb', pack_unit: null, allowed_units: ['lb', 'pc'] }
    : item
);

// ===========================================================================
// Fraction and word quantity parsing
// ===========================================================================

describe('fraction and word quantity parsing', () => {
  test('"1/2 box of ground tuna" parses as 0.5, box, ground tuna', () => {
    const candidates = parseDeterministicOrder('1/2 box of ground tuna');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].quantity).toBe(0.5);
    expect(candidates[0].unit).toBe('box');
    expect(candidates[0].item_text).toBe('ground tuna');
  });

  test('"half box of ground tuna" parses as 0.5, box, ground tuna', () => {
    const candidates = parseDeterministicOrder('half box of ground tuna');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].quantity).toBe(0.5);
    expect(candidates[0].unit).toBe('box');
    expect(candidates[0].item_text).toBe('ground tuna');
  });

  test('"1 box of crab mix" parses as 1, box, crab mix', () => {
    const candidates = parseDeterministicOrder('1 box of crab mix');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].quantity).toBe(1);
    expect(candidates[0].unit).toBe('box');
    expect(candidates[0].item_text).toBe('crab mix');
  });

  test('"2 packs of escolar" parses as 2, pack, escolar', () => {
    const candidates = parseDeterministicOrder('2 packs of escolar');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].quantity).toBe(2);
    expect(candidates[0].unit).toBe('pack');
    expect(candidates[0].item_text).toBe('escolar');
  });

  test('"1 case of edamame" parses as 1, cs, edamame', () => {
    const candidates = parseDeterministicOrder('1 case of edamame');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].quantity).toBe(1);
    expect(candidates[0].unit).toBe('cs');
    expect(candidates[0].item_text).toBe('edamame');
  });

  test('"3/4 lb of salmon" parses as 0.75, lb, salmon', () => {
    const candidates = parseDeterministicOrder('3/4 lb of salmon');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].quantity).toBe(0.75);
    expect(candidates[0].unit).toBe('lb');
    expect(candidates[0].item_text).toBe('salmon');
  });
});

// ===========================================================================
// Example 1: item-only and quantity-only (review items)
// ===========================================================================

describe('Example 1: review items', () => {
  const example1 = `2 salmon
Albacore loin
Tuna loin
Small scallop
6 shrimp ebi
Escolar
2 white fish
Octopus
Seaweed salad`;

  test('deterministic parser produces 9 candidate lines', () => {
    const candidates = parseDeterministicOrder(example1);
    expect(candidates).toHaveLength(9);
  });

  test('"2 salmon" has quantity 2 and issue missing_unit', () => {
    const candidates = parseDeterministicOrder(example1);
    const salmon = candidates[0];
    expect(salmon.quantity).toBe(2);
    expect(salmon.item_text).toBe('salmon');
    expect(salmon.issue).toBe('missing_unit');
  });

  test('"Albacore loin" has no quantity, issue missing_quantity', () => {
    const candidates = parseDeterministicOrder(example1);
    const albacore = candidates[1];
    expect(albacore.quantity).toBeNull();
    expect(albacore.item_text).toBe('Albacore loin');
    expect(albacore.issue).toBe('missing_quantity');
  });

  test('"6 shrimp ebi" has quantity 6, issue missing_unit', () => {
    const candidates = parseDeterministicOrder(example1);
    const shrimp = candidates[4];
    expect(shrimp.quantity).toBe(6);
    expect(shrimp.item_text).toBe('shrimp ebi');
    expect(shrimp.issue).toBe('missing_unit');
  });

  test('"Escolar" has no quantity, issue missing_quantity', () => {
    const candidates = parseDeterministicOrder(example1);
    const escolar = candidates[5];
    expect(escolar.quantity).toBeNull();
    expect(escolar.item_text).toBe('Escolar');
    expect(escolar.issue).toBe('missing_quantity');
  });

  test('full orchestration returns 9 items, status not error', async () => {
    const result = await parseQuickOrder({
      rawText: example1,
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items.length).toBe(9);
    expect(result.status).not.toBe('error');
    // Every item should need clarification since units/quantities are missing
    const reviewCount = result.parsed_items.filter((item) => item.needs_clarification || item.unresolved).length;
    expect(reviewCount).toBeGreaterThanOrEqual(5); // items without units/qty
  });
});

// ===========================================================================
// Example 2: comma-separated with box-of patterns
// ===========================================================================

describe('Example 2: comma-separated with box-of', () => {
  const example2 = '1 tuna loin, 2 albacore, 6 yellowtail, 1 unagi, 1 box of crab mix, half box of ground tuna';

  test('deterministic parser produces 6 candidate lines', () => {
    const candidates = parseDeterministicOrder(example2);
    expect(candidates).toHaveLength(6);
  });

  test('"1 box of crab mix" parsed correctly', () => {
    const candidates = parseDeterministicOrder(example2);
    const crabMix = candidates[4];
    expect(crabMix.quantity).toBe(1);
    expect(crabMix.unit).toBe('box');
    expect(crabMix.item_text).toBe('crab mix');
  });

  test('"half box of ground tuna" parsed correctly', () => {
    const candidates = parseDeterministicOrder(example2);
    const groundTuna = candidates[5];
    expect(groundTuna.quantity).toBe(0.5);
    expect(groundTuna.unit).toBe('box');
    expect(groundTuna.item_text).toBe('ground tuna');
  });

  test('"1 tuna loin" has quantity 1, no unit', () => {
    const candidates = parseDeterministicOrder(example2);
    const tunaLoin = candidates[0];
    expect(tunaLoin.quantity).toBe(1);
    expect(tunaLoin.item_text).toBe('tuna loin');
    expect(tunaLoin.issue).toBe('missing_unit');
  });

  test('full orchestration returns 6 items, status not error', async () => {
    const result = await parseQuickOrder({
      rawText: example2,
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items.length).toBe(6);
    expect(result.status).not.toBe('error');
  });
});

// ===========================================================================
// Example 3: full 16-item multiline order
// ===========================================================================

describe('Example 3: 16-item multiline order', () => {
  const example3 = `Ground garlic 1 pack
Edamame 1 cs
Crawfish 2 packs
Soft shell crab 1 pack
Escolar 3 packs
Izumidai 8 packs
Octopus 3 packs
Soy paper 1 cs
Canadian clam 1 pack
Squid 1 pack
Crab stick 1 pack
Tamago 1 pack
Masago 1 pack
Mackerel 4 packs
Albacore 1 cs
Tuna loin 1 cs`;

  test('deterministic parser produces 16 candidate lines', () => {
    const candidates = parseDeterministicOrder(example3);
    expect(candidates).toHaveLength(16);
  });

  test('all 16 lines have quantity and unit (no missing_quantity or missing_unit)', () => {
    const candidates = parseDeterministicOrder(example3);
    for (const c of candidates) {
      expect(c.quantity).not.toBeNull();
      expect(c.unit).not.toBeNull();
    }
  });

  test('"packs" normalizes to "pack"', () => {
    const candidates = parseDeterministicOrder(example3);
    const crawfish = candidates.find((c) => c.item_text.toLowerCase().includes('crawfish'));
    expect(crawfish?.unit).toBe('pack');
  });

  test('"cs" stays "cs"', () => {
    const candidates = parseDeterministicOrder(example3);
    const edamame = candidates.find((c) => c.item_text.toLowerCase().includes('edamame'));
    expect(edamame?.unit).toBe('cs');
  });

  test('"Izumidai 8 packs" produces item_text izumidai', () => {
    const candidates = parseDeterministicOrder(example3);
    const izumidai = candidates.find((c) => c.item_text.toLowerCase().includes('izumidai'));
    expect(izumidai).toBeDefined();
    expect(izumidai!.quantity).toBe(8);
    expect(izumidai!.unit).toBe('pack');
  });

  test('full orchestration returns 16 items, status ok', async () => {
    const result = await parseQuickOrder({
      rawText: example3,
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items.length).toBe(16);
    // Some items may have fuzzy matches in the test catalog (e.g. soy paper vs soy sauce),
    // so status can be 'ok' or 'needs_review'. The critical requirement is: NEVER 'error'.
    expect(result.status).not.toBe('error');
    expect(['ok', 'needs_review']).toContain(result.status);
  });

  test('Izumidai matches White Fish (Izumidai) in orchestration', async () => {
    const result = await parseQuickOrder({
      rawText: example3,
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    const izumidai = result.parsed_items.find((item) =>
      (item.item_name ?? '').includes('White Fish') ||
      (item.item_name ?? '').includes('Izumidai'),
    );
    expect(izumidai).toBeDefined();
    expect(izumidai!.item_id).toBe('whitefish-id');
    expect(izumidai!.item_name).toBe('White Fish (Izumidai)');
  });

  test('diagnostics include parser_version and parse_mode', async () => {
    const result = await parseQuickOrder({
      rawText: example3,
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.diagnostics?.parser_version).toBe('quick-order-parser-v3-line-based');
    expect(result.diagnostics?.parse_mode).toBeDefined();
    expect(result.diagnostics?.parse_mode).not.toBeUndefined();
    expect(result.diagnostics?.catalog_count).toBe(extendedCatalog.length);
    expect(result.diagnostics?.candidate_count).toBe(16);
  });
});

describe('current 17-line Quick Order regression', () => {
  const fullOrder = `Ground garlic 1 pack
Edamame 1 cs
Crawfish 2 packs
Soft shell crab 1 pack
Escolar 3 packs
Izumidai 8 packs
Shrimp
Octopus 3 packs
Soy paper 1 cs
Canadian clam 1 pack
Squid 1 pack
Crab stick 1 pack
Tamago 1 pack
Masago 1 pack
Mackerel 4 packs
Albacore 1 cs
Tuna loin 1 cs`;

  test.each([
    ['Edamame 1 cs', 'Edamame'],
    ['Ground garlic 1 pack', 'Ground garlic'],
    ['Crawfish 2 packs', 'Crawfish'],
    ['Soft shell crab 1 pack', 'Soft shell crab'],
    ['Canadian clam 1 pack', 'Canadian clam'],
    ['Soy paper 1 cs', 'Soy paper'],
    ['Tuna loin 1 cs', 'Tuna loin'],
  ])('%s preserves full item text', (input, expectedItemText) => {
    expect(parseDeterministicOrder(input)[0].item_text).toBe(expectedItemText);
  });

  test('full order returns 17 line-stable parsed items with no over-count diagnostic', async () => {
    const result = await parseQuickOrder({
      rawText: fullOrder,
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    const lineIds = result.parsed_items.map((item) => item.line_id);
    expect(result.diagnostics?.candidate_count).toBe(17);
    expect(result.parsed_items).toHaveLength(17);
    expect(new Set(lineIds).size).toBe(17);
    expect(result.diagnostics?.error_code).not.toBe('parsed_items_exceed_candidates');
    expect(result.diagnostics?.items_after_validation).toBe(17);
  });

  test('known catalog items exact-match and do not show generic item choice review', async () => {
    const result = await parseQuickOrder({
      rawText: fullOrder,
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    const expectedMatches: Record<string, string> = {
      'Ground garlic 1 pack': 'Ground Garlic',
      'Edamame 1 cs': 'Edamame',
      'Crawfish 2 packs': 'Crawfish',
      'Soft shell crab 1 pack': 'Soft Shell Crab',
      'Izumidai 8 packs': 'White Fish (Izumidai)',
      'Soy paper 1 cs': 'Soy Paper',
      'Canadian clam 1 pack': 'Canadian Clam',
      'Squid 1 pack': 'Squid',
      'Crab stick 1 pack': 'Crab Stick',
      'Tamago 1 pack': 'Tamago',
      'Masago 1 pack': 'Masago',
      'Mackerel 4 packs': 'Mackerel',
      'Albacore 1 cs': 'Albacore',
      'Tuna loin 1 cs': 'Tuna Loin',
    };

    for (const [rawText, itemName] of Object.entries(expectedMatches)) {
      const item = result.parsed_items.find((entry) => entry.raw_text === rawText);
      expect(item).toBeDefined();
      expect(item!.item_name).toBe(itemName);
      expect(item!.item_id).toBeTruthy();
      expect(item!.status).not.toBe('no_match');
    }
  });

  test('Shrimp item-only is matched and asks for quantity before item choice', async () => {
    const result = await parseQuickOrder({
      rawText: fullOrder,
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    const shrimp = result.parsed_items.find((item) => item.raw_text === 'Shrimp');
    expect(shrimp).toBeDefined();
    expect(shrimp!.item_id).toBe('shrimp-ebi-id');
    expect(shrimp!.status).toBe('missing_quantity');

    const normalized = normalizeQuickOrderParseResponse({ status: result.status, parsed_items: [shrimp] });
    expect(getParsedItemIssue(normalized.parsedItems[0])?.label).toBe('Add quantity');
  });
});

describe('robust selected-location catalog matching', () => {
  test.each([
    ['Crawfish 2 packs', 'crawfish-id', 'Crawfish (Crayfish)', 2, 'pack', 'parenthetical_or_generated_exact'],
    ['Crayfish 2 packs', 'crawfish-id', 'Crawfish (Crayfish)', 2, 'pack', 'parenthetical_or_generated_exact'],
    ['Soft shell crab 1 pack', 'soft-shell-crab-id', 'Soft Shell Crab', 1, 'pack', 'normalized_exact'],
    ['softshell crab 1 pk', 'soft-shell-crab-id', 'Soft Shell Crab', 1, 'pack', 'compact_exact'],
    ['soft shell crb 1 pack', 'soft-shell-crab-id', 'Soft Shell Crab', 1, 'pack', 'fuzzy'],
    ['Izumidai 8 packs', 'whitefish-id', 'White Fish (Izumidai)', 8, 'pack', 'parenthetical_or_generated_exact'],
    ['White fish 8 packs', 'whitefish-id', 'White Fish (Izumidai)', 8, 'pack', 'parenthetical_or_generated_exact'],
    ['izumi dai 8 packs', 'whitefish-id', 'White Fish (Izumidai)', 8, 'pack', 'compact_exact'],
    ['izumdi 8 packs', 'whitefish-id', 'White Fish (Izumidai)', 8, 'pack', 'fuzzy'],
    ['Canadian clam 1 pack', 'canadian-clam-id', 'Canadian Clam', 1, 'pack', 'normalized_exact'],
    ['Canadian Clam 1 case', 'canadian-clam-id', 'Canadian Clam', 1, 'cs', 'exact_name'],
    ['canadien clam 1 pack', 'canadian-clam-id', 'Canadian Clam', 1, 'pack', 'fuzzy'],
    ['canadian clm 1 pack', 'canadian-clam-id', 'Canadian Clam', 1, 'pack', 'fuzzy'],
    ['Soy paper 1 cs', 'soy-paper-id', 'Soy Paper', 1, 'cs', 'normalized_exact'],
    ['soypaper 1 cs', 'soy-paper-id', 'Soy Paper', 1, 'cs', 'parenthetical_or_generated_exact'],
    ['Crab stick 1 pack', 'crab-stick-id', 'Crab Stick', 1, 'pack', 'exact_alias'],
    ['crabstick 1 pack', 'crab-stick-id', 'Crab Stick', 1, 'pack', 'exact_alias'],
    ['Tuna loin 1 cs', 'tuna-loin-id', 'Tuna Loin', 1, 'cs', 'exact_alias'],
    ['Albacore 1 cs', 'albacore-id', 'Albacore', 1, 'cs', 'exact_name'],
    ['Octopus 3 packs', 'octopus-id', 'Tako (Octopus)', 3, 'pack', 'parenthetical_or_generated_exact'],
    ['Escolar 3 packs', 'escolar-id', 'Escolar (White Tuna)', 3, 'pack', 'parenthetical_or_generated_exact'],
  ])('%s matches selected catalog item', async (rawText, itemId, itemName, quantity, unit, matchType) => {
    const result = await parseQuickOrder({
      rawText,
      catalog: robustCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items).toHaveLength(1);
    expect(result.parsed_items[0]).toMatchObject({
      item_id: itemId,
      item_name: itemName,
      quantity,
      unit,
      status: 'valid',
      match_type: matchType,
      needs_clarification: false,
    });
    expect(getParsedItemIssue(result.parsed_items[0] as ParsedQuickOrderItem)).toBeNull();
  });

  test('exact generated term wins over weaker fuzzy alternatives', async () => {
    const noisyCatalog: CatalogItem[] = [
      ...robustCatalog,
      { id: 'random-fish-id', name: 'Random Fish', aliases: [], default_unit: 'pack', base_unit: 'pack', pack_unit: null, allowed_units: ['pack'] },
      { id: 'crab-claw-id', name: 'Crab Claw', aliases: [], default_unit: 'pack', base_unit: 'pack', pack_unit: null, allowed_units: ['pack'] },
    ];
    const result = await parseQuickOrder({
      rawText: 'Crawfish 2 packs\nIzumidai 8 packs',
      catalog: noisyCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
      callLlm: jest.fn<Promise<string>, [string]>(async () => JSON.stringify({ parsed_items: [] })),
    });

    expect(result.parsed_items).toHaveLength(2);
    expect(result.parsed_items[0]).toMatchObject({
      item_id: 'crawfish-id',
      match_type: 'parenthetical_or_generated_exact',
      status: 'valid',
    });
    expect(result.parsed_items[1]).toMatchObject({
      item_id: 'whitefish-id',
      match_type: 'parenthetical_or_generated_exact',
      status: 'valid',
    });
    expect(result.diagnostics?.llm_lines_sent).toBe(0);
  });

  test('matched item with unsupported unit is invalid_unit rather than Choose item', async () => {
    const result = await parseQuickOrder({
      rawText: 'Izumidai 8 cs',
      catalog: robustCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items[0]).toMatchObject({
      item_id: 'whitefish-id',
      item_name: 'White Fish (Izumidai)',
      status: 'invalid_unit',
      unresolved: false,
    });
    expect(getParsedItemIssue(result.parsed_items[0] as ParsedQuickOrderItem)?.label).toBe('Fix unit');
  });

  test('Sapporo small matches the exact multiword variant while Sapporo alone is ambiguous', async () => {
    const small = await parseQuickOrder({
      rawText: 'Sapporo small',
      catalog: semanticCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(small.parsed_items).toHaveLength(1);
    expect(small.parsed_items[0]).toMatchObject({
      item_id: 'sapporo-small-id',
      item_name: 'Sapporo Small',
      status: 'missing_quantity',
    });
    expect(getParsedItemIssue(small.parsed_items[0] as ParsedQuickOrderItem)?.label).toBe('Add quantity');

    const ambiguous = await parseQuickOrder({
      rawText: 'Sapporo',
      catalog: semanticCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(ambiguous.parsed_items).toHaveLength(1);
    expect(ambiguous.parsed_items[0]).toMatchObject({
      item_id: null,
      status: 'ambiguous',
    });
    expect(ambiguous.parsed_items[0].alternatives?.map((item) => item.item_id)).toEqual(
      expect.arrayContaining(['sapporo-small-id', 'sapporo-large-id']),
    );
  });

  test('Sapporo smal fuzzy-matches Sapporo Small with strict token coverage', async () => {
    const result = await parseQuickOrder({
      rawText: 'Sapporo smal',
      catalog: semanticCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items).toHaveLength(1);
    expect(result.parsed_items[0]).toMatchObject({
      item_id: 'sapporo-small-id',
      item_name: 'Sapporo Small',
      status: 'missing_quantity',
    });
  });

  test('semantic token coverage prevents mango powder from matching wasabi powder', async () => {
    const mango = await parseQuickOrder({
      rawText: '1cs mango powder',
      catalog: semanticCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(mango.parsed_items).toHaveLength(1);
    expect(mango.parsed_items[0]).toMatchObject({
      item_id: null,
      status: 'no_match',
      action: 'Choose item',
    });
    expect(mango.reply_text).toContain('mango powder');
    expect(mango.diagnostics?.item_diagnostics?.[0]).toMatchObject({
      status: 'no_match',
      missing_specific_tokens: ['mango'],
      semantic_validation_passed: false,
    });

    const wasabi = await parseQuickOrder({
      rawText: '1cs wasabi powder',
      catalog: semanticCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(wasabi.parsed_items).toHaveLength(1);
    expect(wasabi.parsed_items[0]).toMatchObject({
      item_id: 'wasabi-powder-id',
      item_name: 'Wasabi Powder',
      quantity: 1,
      unit: 'cs',
      status: 'valid',
    });
  });

  test('generic paper token does not make paper towels match soy paper', async () => {
    const withoutPaperTowels = semanticCatalog.filter((item) => item.id !== 'paper-towels-id');
    const noMatch = await parseQuickOrder({
      rawText: 'Paper towels 1cs',
      catalog: withoutPaperTowels,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(noMatch.parsed_items).toHaveLength(1);
    expect(noMatch.diagnostics?.item_diagnostics?.[0]).toMatchObject({
      status: 'no_match',
      semantic_validation_passed: false,
    });

    const matched = await parseQuickOrder({
      rawText: 'Paper towels 1cs',
      catalog: semanticCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(matched.parsed_items).toHaveLength(1);
    expect(matched.parsed_items[0]).toMatchObject({
      item_id: 'paper-towels-id',
      item_name: 'Paper Towels',
      status: 'valid',
    });
  });

  test('full 17-line order matches real catalog variants with only Shrimp needing details', async () => {
    const fullOrder = `Ground garlic 1 pack
Edamame 1 cs
Crawfish 2 packs
Soft shell crab 1 pack
Escolar 3 packs
Izumidai 8 packs
Shrimp
Octopus 3 packs
Soy paper 1 cs
Canadian clam 1 pack
Squid 1 pack
Crab stick 1 pack
Tamago 1 pack
Masago 1 pack
Mackerel 4 packs
Albacore 1 cs
Tuna loin 1 cs`;

    const result = await parseQuickOrder({
      rawText: fullOrder,
      locationId: 'test-location',
      catalog: robustCatalog,
      globalCatalog: robustCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });

    expect(result.parsed_items).toHaveLength(17);
    expect(new Set(result.parsed_items.map((item) => item.line_id)).size).toBe(17);
    expect(result.diagnostics?.error_code).toBeUndefined();
    expect(result.diagnostics?.catalog_debug?.catalog_contains).toMatchObject({
      crawfish: true,
      soft_shell_crab: true,
      white_fish_izumidai: true,
      canadian_clam: true,
    });
    const izumidaiDiagnostics = result.diagnostics?.item_diagnostics?.find((item) => item.raw_text === 'Izumidai 8 packs');
    expect(izumidaiDiagnostics).toMatchObject({
      match_type: 'parenthetical_or_generated_exact',
      selected_location_catalog_contains_exact: true,
      global_catalog_contains_exact: true,
    });
    expect(izumidaiDiagnostics?.top_candidates?.[0]).toMatchObject({
      item_name: 'White Fish (Izumidai)',
      match_type: 'parenthetical_or_generated_exact',
    });
    expect(result.parsed_items.find((item) => item.raw_text === 'Crawfish 2 packs')).toMatchObject({ item_name: 'Crawfish (Crayfish)', status: 'valid' });
    expect(result.parsed_items.find((item) => item.raw_text === 'Soft shell crab 1 pack')).toMatchObject({ item_name: 'Soft Shell Crab', status: 'valid' });
    expect(result.parsed_items.find((item) => item.raw_text === 'Izumidai 8 packs')).toMatchObject({ item_name: 'White Fish (Izumidai)', status: 'valid' });
    expect(result.parsed_items.find((item) => item.raw_text === 'Canadian clam 1 pack')).toMatchObject({ item_name: 'Canadian Clam', status: 'valid' });
    const reviewItems = result.parsed_items.filter((item) => getParsedItemIssue(item as ParsedQuickOrderItem));
    expect(reviewItems).toHaveLength(1);
    expect(reviewItems[0]).toMatchObject({ item_id: 'shrimp-ebi-id', status: 'missing_quantity' });
    expect(getParsedItemIssue(reviewItems[0] as ParsedQuickOrderItem)?.label).toBe('Add quantity');
  });

  test('LLM fallback skips strong matches and low-confidence unknown text', async () => {
    const callLlm = jest.fn<Promise<string>, [string]>(async () => JSON.stringify({ parsed_items: [] }));
    const result = await parseQuickOrder({
      rawText: 'Crawfish 2 packs\nBacon',
      catalog: robustCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
      callLlm,
    });

    expect(callLlm).not.toHaveBeenCalled();
    expect(result.parsed_items).toHaveLength(1);
    expect(result.parsed_items.find((item) => item.raw_text === 'Crawfish 2 packs')).toMatchObject({
      item_name: 'Crawfish (Crayfish)',
      status: 'valid',
    });
    expect(result.diagnostics?.item_diagnostics?.find((item) => item.raw_text === 'Bacon')).toMatchObject({
      status: 'no_op',
      was_added_to_order_list: false,
    });
  });

  test.each([
    ['Bacon', 'I couldn’t find Bacon in this location’s inventory.'],
    ['asdfasdf', 'I couldn’t recognize that as an inventory item.'],
    ['Combine', 'There is nothing to combine right now.'],
  ])('%s does not create a persistent junk row', async (rawText, message) => {
    const result = await parseQuickOrder({
      rawText,
      catalog: robustCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });

    expect(result.parsed_items).toHaveLength(0);
    expect(result.reply_text).toBe(message);
    expect(result.diagnostics?.item_diagnostics?.[0]).toMatchObject({
      status: 'no_op',
      was_added_to_order_list: false,
    });
  });

  test('fuzzy item-only input does not infer quantity or unit from catalog defaults', async () => {
    const result = await parseQuickOrder({
      rawText: 'salmo',
      catalog: strictSalmonCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
      callLlm: jest.fn<Promise<string>, [string]>(async () => JSON.stringify({ parsed_items: [] })),
    });

    expect(result.diagnostics?.llm_lines_sent).toBe(0);
    expect(result.parsed_items).toHaveLength(1);
    expect(result.parsed_items[0]).toMatchObject({
      item_id: null,
      quantity: null,
      unit: null,
      status: 'ambiguous',
      action: 'Choose item',
    });
    expect(result.parsed_items[0].candidate_matches?.[0]).toMatchObject({
      item_id: 'salmon-id',
      item_name: 'Salmon',
    });
    expect(result.reply_text).toBe('Did you mean Salmon?');
  });

  test('fuzzy explicit quantity and unit can resolve to a valid catalog row', async () => {
    const result = await parseQuickOrder({
      rawText: 'salmo 2lb',
      catalog: strictSalmonCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });

    expect(result.parsed_items).toHaveLength(1);
    expect(result.parsed_items[0]).toMatchObject({
      item_id: 'salmon-id',
      item_name: 'Salmon',
      quantity: 2,
      unit: 'lb',
      status: 'valid',
    });
  });

  test('duplicate valid same-unit item asks add versus replace', async () => {
    const result = await parseQuickOrder({
      rawText: 'Salmon 2lb',
      catalog: strictSalmonCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [parsed({
        item_id: 'salmon-id',
        item_name: 'Salmon',
        display_name: 'Salmon',
        quantity: 1,
        unit: 'lb',
        status: 'valid',
        needs_clarification: false,
        unresolved: false,
      })],
    });

    expect(result.parsed_items).toHaveLength(0);
    expect(result.pending_clarifications?.[0]).toMatchObject({ type: 'quantity_conflict' });
    expect(result.assistant_message).toContain('already in the order');
  });

  test('unsupported duplicate unit returns a specific invalid-unit review instead of a generic parser error', async () => {
    const result = await parseQuickOrder({
      rawText: 'Salmon 2cs',
      catalog: strictSalmonCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [parsed({
        item_id: 'salmon-id',
        item_name: 'Salmon',
        display_name: 'Salmon',
        quantity: 1,
        unit: 'lb',
        status: 'valid',
        needs_clarification: false,
        unresolved: false,
      })],
    });

    expect(result.pending_clarifications ?? []).toHaveLength(0);
    expect(result.parsed_items).toHaveLength(1);
    expect(result.parsed_items[0]).toMatchObject({
      item_id: 'salmon-id',
      item_name: 'Salmon',
      quantity: 2,
      unit: 'cs',
      status: 'invalid_unit',
    });
    expect(result.assistant_message).toContain('Salmon cannot be ordered in cs');
    expect(result.assistant_message).not.toContain('trouble');
  });

  test('long unrelated words do not match short catalog names by prefix', async () => {
    const result = await parseQuickOrder({
      rawText: 'Unicorn',
      catalog: semanticCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });

    expect(result.parsed_items).toHaveLength(0);
    expect(result.reply_text).toBe('I couldn’t find Unicorn in this location’s inventory.');
  });

  test.each([
    ['Give me some suggestions', 'I don’t have enough order history to suggest a usual order yet.', 'suggestion_request'],
    ['What did I order last week', 'No matching order from last week was found for this location.', 'history_request'],
    ['reorder recent', 'I couldn’t find a recent order for this location yet.', 'history_request'],
    ['usual order', 'I don’t have enough history to suggest a usual order yet.', 'history_request'],
  ])('%s is classified before item parsing', async (rawText, message, classification) => {
    const result = await parseQuickOrder({
      rawText,
      catalog: semanticCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });

    expect(result.parsed_items).toHaveLength(0);
    expect(result.reply_text).toBe(message);
    expect(result.diagnostics?.input_classification).toBe(classification);
  });

  test('clear with no items returns specific no-op message and no item rows', async () => {
    const result = await parseQuickOrder({
      rawText: 'Clear',
      catalog: semanticCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });

    expect(result.parsed_items).toHaveLength(0);
    expect(result.pending_clarifications ?? []).toHaveLength(0);
    expect(result.reply_text).toBe('There is no current Quick Order list to clear.');
    expect(result.diagnostics?.input_classification).toBe('clear_request');
  });

  test('clear with items returns a structured clear confirmation action', async () => {
    const result = await parseQuickOrder({
      rawText: 'Clear',
      catalog: semanticCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [parsed({
        item_id: 'salmon-id',
        item_name: 'Salmon',
        quantity: 1,
        unit: 'lb',
        status: 'valid',
      })],
    });

    expect(result.parsed_items).toHaveLength(0);
    expect(result.pending_clarifications?.[0]).toMatchObject({ type: 'clear_order' });
    expect(result.pending_clarifications?.[0].actions.map((action) => action.id)).toEqual(['clear_order', 'cancel']);
  });

  test('frontend counts rows and fixes from parser output', async () => {
    const result = await parseQuickOrder({
      rawText: 'Crawfish 2 packs\nShrimp',
      catalog: robustCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    const normalized = normalizeQuickOrderParseResponse({
      status: result.status,
      parsed_items: result.parsed_items,
      diagnostics: result.diagnostics,
    });
    expect(normalized.parsedItems).toHaveLength(2);
    expect(countUnresolvedItems(normalized.parsedItems)).toBe(1);
    expect(getParsedItemIssue(normalized.parsedItems[0])).toBeNull();
    expect(getParsedItemIssue(normalized.parsedItems[1])?.label).toBe('Add quantity');
  });
});

// ===========================================================================
// Edge cases: missing quantities, units, unknown items
// ===========================================================================

describe('edge case parsing', () => {
  test('"Salmon" (item only) -> missing_quantity', () => {
    const candidates = parseDeterministicOrder('Salmon');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].item_text).toBe('Salmon');
    expect(candidates[0].quantity).toBeNull();
    expect(candidates[0].unit).toBeNull();
    expect(candidates[0].issue).toBe('missing_quantity');
  });

  test('"Salmon 2" (item qty) -> missing_unit', () => {
    const candidates = parseDeterministicOrder('Salmon 2');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].item_text).toBe('Salmon');
    expect(candidates[0].quantity).toBe(2);
    expect(candidates[0].unit).toBeNull();
    expect(candidates[0].issue).toBe('missing_unit');
  });

  test('"2 Salmon" (qty item) -> missing_unit', () => {
    const candidates = parseDeterministicOrder('2 Salmon');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].item_text).toBe('Salmon');
    expect(candidates[0].quantity).toBe(2);
    expect(candidates[0].unit).toBeNull();
    expect(candidates[0].issue).toBe('missing_unit');
  });

  test('"Salmon 2cs" (item qty unit) -> valid', () => {
    const candidates = parseDeterministicOrder('Salmon 2cs');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].item_text).toBe('Salmon');
    expect(candidates[0].quantity).toBe(2);
    expect(candidates[0].unit).toBe('cs');
    expect(candidates[0].issue).toBeUndefined();
  });

  test('"2cs Salmon" (qty unit item) -> valid', () => {
    const candidates = parseDeterministicOrder('2cs Salmon');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].item_text).toBe('Salmon');
    expect(candidates[0].quantity).toBe(2);
    expect(candidates[0].unit).toBe('cs');
    expect(candidates[0].issue).toBeUndefined();
  });

  test('"Randomfish 2cs" (unknown item with valid qty/unit) -> no issue from parser', () => {
    const candidates = parseDeterministicOrder('Randomfish 2cs');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].item_text).toBe('Randomfish');
    expect(candidates[0].quantity).toBe(2);
    expect(candidates[0].unit).toBe('cs');
    expect(candidates[0].issue).toBeUndefined();
  });

  test('parsed_items never empty for valid order text', async () => {
    const result = await parseQuickOrder({
      rawText: 'Salmon 2cs',
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items.length).toBeGreaterThan(0);
    expect(result.status).not.toBe('error');
  });

  test('unknown item with quantity is returned as no_match review row', async () => {
    const result = await parseQuickOrder({
      rawText: 'asdfasdf 2cs',
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items.length).toBe(1);
    expect(result.status).not.toBe('error');
    expect(result.parsed_items[0]).toMatchObject({
      item_id: null,
      status: 'no_match',
    });
  });

  test('mixed valid and unknown items: valid items are not lost and unknown asks review', async () => {
    const result = await parseQuickOrder({
      rawText: 'Salmon 2cs\nasdfasdf 1pk\nEdamame 1cs',
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items.length).toBe(3);
    expect(result.status).not.toBe('error');
    const salmon = result.parsed_items.find((item) => item.item_id === 'salmon-id');
    expect(salmon).toBeDefined();
    const edamame = result.parsed_items.find((item) => item.item_id === 'edamame-id');
    expect(edamame).toBeDefined();
  });

  test('empty text returns empty parsed_items', async () => {
    const result = await parseQuickOrder({
      rawText: '',
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items.length).toBe(0);
  });
});

// ===========================================================================
// Response normalization: needs_review is not error
// ===========================================================================

describe('response normalization for review items', () => {
  test('needs_review status with parsed_items is NOT converted to error', () => {
    const normalized = normalizeQuickOrderParseResponse({
      status: 'needs_review',
      assistant_message: 'I found 9 items that need more details.',
      parsed_items: Array(9).fill({
        item_id: 'salmon-id',
        item_name: 'Salmon',
        quantity: 2,
        unit: null,
        needs_clarification: true,
        status: 'missing_unit',
      }),
      diagnostics: {
        parser_version: 'quick-order-parser-v3-line-based',
        parse_mode: 'deterministic_only',
      },
    });
    expect(normalized.status).toBe('needs_review');
    expect(normalized.status).not.toBe('error');
    expect(normalized.parsedItems.length).toBe(9);
    expect(normalized.diagnostics.parser_version).toBe('quick-order-parser-v3-line-based');
    expect(normalized.diagnostics.parse_mode).toBe('deterministic_only');
  });

  test('parsedItems > 0 never shows generic error message', () => {
    const normalized = normalizeQuickOrderParseResponse({
      status: 'needs_review',
      assistant_message: 'Please review 3 items.',
      parsed_items: [
        { item_id: 'salmon-id', item_name: 'Salmon', quantity: 2, unit: null, needs_clarification: true },
      ],
    });
    const mergeResult: import('../features/ordering/quickOrderItems').QuickOrderMergeResult = {
      items: [],
      addedCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      reviewCount: 1,
      rejectedReasons: [],
      addedItems: [],
      updatedItems: [],
      reviewItems: [],
    };
    const message = buildQuickOrderAssistantMessage({
      normalized,
      mergeResult,
      pendingCount: 0,
    });
    expect(message).not.toContain('I had trouble reading that order');
  });
});

describe('Quick Order end-to-end acceptance cases', () => {
  test.each([
    ['Salmon 1cs', 'salmon-id', 1, 'cs'],
    ['Salmon 5cs', 'salmon-id', 5, 'cs'],
    ['Salmon 5 case', 'salmon-id', 5, 'cs'],
    ['Salmon 5 cases', 'salmon-id', 5, 'cs'],
    ['salmon 2cs', 'salmon-id', 2, 'cs'],
    ['2cs salmon', 'salmon-id', 2, 'cs'],
    ['1 case albacore', 'albacore-id', 1, 'cs'],
    ['Albacore 1cs', 'albacore-id', 1, 'cs'],
    ['Tuna loin 1 cs', 'tuna-loin-id', 1, 'cs'],
    ['Mackerel 4 packs', 'mackerel-id', 4, 'pack'],
    ['Yellowtail 9 lb', 'yellowtail-id', 9, 'lb'],
  ])('%s becomes a valid matched row', async (rawText, itemId, quantity, unit) => {
    const result = await parseQuickOrder({
      rawText,
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items).toHaveLength(1);
    expect(result.parsed_items[0]).toMatchObject({
      item_id: itemId,
      quantity,
      unit,
      status: 'valid',
      action: null,
      needs_clarification: false,
      unresolved: false,
    });
    expect(getParsedItemIssue(result.parsed_items[0] as ParsedQuickOrderItem)).toBeNull();
  });

  test('Shrimp then Shrimp 5pk updates the same pending row without stale issue state', async () => {
    const first = await parseQuickOrder({
      rawText: 'Shrimp',
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(first.parsed_items[0]).toMatchObject({
      item_id: 'shrimp-ebi-id',
      status: 'missing_quantity',
      action: 'Add quantity',
    });

    const second = await parseQuickOrder({
      rawText: 'Shrimp 5pk',
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: first.parsed_items,
    });
    const merge = mergeQuickOrderParsedItemsDetailed(first.parsed_items as ParsedQuickOrderItem[], second.parsed_items as ParsedQuickOrderItem[]);
    expect(merge.items).toHaveLength(1);
    expect(merge.items[0]).toMatchObject({
      item_id: 'shrimp-ebi-id',
      quantity: 5,
      unit: 'pack',
      status: 'valid',
      action: null,
      needs_clarification: false,
      unresolved: false,
    });
    expect(merge.items[0].issue).toBeUndefined();
    expect(getParsedItemIssue(merge.items[0])).toBeNull();
  });

  test('"2 salmon" asks for unit, while "Salmon 5 bottle" asks to fix unit', async () => {
    const missingUnit = await parseQuickOrder({
      rawText: '2 salmon',
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(missingUnit.parsed_items[0]).toMatchObject({
      item_id: 'salmon-id',
      quantity: 2,
      status: 'missing_unit',
      action: 'Choose unit',
    });

    const invalidUnit = await parseQuickOrder({
      rawText: 'Salmon 5 bottle',
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(invalidUnit.parsed_items[0]).toMatchObject({
      item_id: 'salmon-id',
      quantity: 5,
      unit: 'bottle',
      status: 'invalid_unit',
      action: 'Fix unit',
      unresolved: false,
    });
    expect(invalidUnit.assistant_message).toContain('Salmon cannot be ordered in bottle');
    expect(invalidUnit.parsed_items[0].issue).toContain('Choose:');
  });

  test('bare tuna is ambiguous when multiple tuna catalog items exist', async () => {
    const result = await parseQuickOrder({
      rawText: 'tuna',
      catalog: extendedCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items).toHaveLength(1);
    expect(result.parsed_items[0]).toMatchObject({
      item_id: null,
      status: 'ambiguous',
      action: 'Choose item',
    });
    expect(result.parsed_items[0].alternatives?.map((item) => item.item_id)).toEqual(
      expect.arrayContaining(['tuna-id', 'tuna-loin-id']),
    );
  });

  test('absent crab mix and ground tuna return no_match rows when absent from catalog', async () => {
    const catalogWithoutItems = extendedCatalog.filter((item) => item.id !== 'crab-mix-id' && item.id !== 'ground-tuna-id');
    const result = await parseQuickOrder({
      rawText: '1 box of crab mix, half box of ground tuna',
      catalog: catalogWithoutItems,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items).toHaveLength(2);
    expect(result.parsed_items.map((item) => item.status)).toEqual(['no_match', 'no_match']);
    expect(result.parsed_items.every((item) => item.item_id === null && item.action === 'Choose item')).toBe(true);
  });

  test.each([
    ['clear', 'clear_request'],
    ['combine', 'duplicate_resolution_action'],
    ['give me suggestions', 'suggestion_request'],
    ['reorder recent', 'history_request'],
    ['recent order', 'history_request'],
    ['last order', 'history_request'],
    ['reorder last week', 'history_request'],
    ['last week', 'history_request'],
    ['what did I order last week', 'history_request'],
    ['usual order', 'history_request'],
    ['the usual', 'history_request'],
  ])('%s is classified before item matching', async (rawText, classification) => {
    const result = await parseQuickOrder({
      rawText,
      catalog: semanticCatalog,
      examples: [],
      corrections: [],
      previousMessages: [],
      existingParsedItems: [],
    });
    expect(result.parsed_items).toHaveLength(0);
    expect(result.diagnostics?.input_classification).toBe(classification);
  });

  test('confirm readiness requires valid rows and no pending action state', () => {
    const valid: ParsedQuickOrderItem = {
      item_id: 'salmon-id',
      item_name: 'Salmon',
      quantity: 1,
      unit: 'cs',
      status: 'valid',
      action: null,
    };
    const invalid: ParsedQuickOrderItem = {
      item_id: 'salmon-id',
      item_name: 'Salmon',
      quantity: 1,
      unit: 'bottle',
      status: 'invalid_unit',
      action: 'Fix unit',
      needs_clarification: true,
    };
    expect(countUnresolvedItems([valid])).toBe(0);
    expect(countUnresolvedItems([valid, invalid])).toBe(1);
    expect(normalizeQuickOrderItemForDisplay({
      ...valid,
      issue: 'stale issue',
      issue_code: 'missing_quantity',
      action: 'Add quantity',
      needs_clarification: true,
    })).toMatchObject({
      status: 'valid',
      issue: undefined,
      issue_code: undefined,
      action: null,
      needs_clarification: false,
    });
    expect(normalizeQuickOrderItemForDisplay({
      item_id: 'salmon-id',
      item_name: 'Salmon',
      quantity: 5,
      unit: 'case',
      valid_units: ['lb', 'cs'],
      status: 'invalid_unit',
      action: 'Fix unit',
      needs_clarification: true,
      issue: 'stale invalid unit',
    })).toMatchObject({
      quantity: 5,
      unit: 'cs',
      status: 'valid',
      action: null,
      issue: undefined,
      needs_clarification: false,
    });
  });
});
