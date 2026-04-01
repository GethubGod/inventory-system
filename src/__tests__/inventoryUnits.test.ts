import {
  getInventoryConversionSummary,
  getInventoryUnitLabel,
  getInventoryUnitSummary,
  hasInventoryUnit,
  normalizeInventoryItemUnits,
  normalizeInventoryPackSize,
  resolvePreferredInventoryUnitType,
} from '../lib/inventoryUnits';

const makeItem = (overrides: Partial<{
  base_unit: string;
  pack_unit: string;
  pack_size: number | null;
}> = {}) => ({
  base_unit: 'lb',
  pack_unit: 'case',
  pack_size: 10,
  ...overrides,
});

describe('inventoryUnits helpers', () => {
  test('defaults pack size to 1 when missing or invalid', () => {
    expect(normalizeInventoryPackSize(null)).toBe(1);
    expect(normalizeInventoryPackSize('')).toBe(1);
    expect(normalizeInventoryPackSize(0)).toBe(1);
    expect(normalizeInventoryPackSize('3')).toBe(3);
  });

  test('detects available units independently', () => {
    expect(hasInventoryUnit(makeItem(), 'base')).toBe(true);
    expect(hasInventoryUnit(makeItem(), 'pack')).toBe(true);
    expect(hasInventoryUnit(makeItem({ pack_unit: '' }), 'pack')).toBe(false);
    expect(hasInventoryUnit(makeItem({ base_unit: '' }), 'base')).toBe(false);
  });

  test('falls back to the only available unit type', () => {
    expect(resolvePreferredInventoryUnitType(makeItem({ pack_unit: '' }), 'pack')).toBe('base');
    expect(resolvePreferredInventoryUnitType(makeItem({ base_unit: '' }), 'base')).toBe('pack');
  });

  test('returns a fallback label when requested unit is missing', () => {
    expect(getInventoryUnitLabel(makeItem({ pack_unit: '' }), 'pack')).toBe('lb');
    expect(getInventoryUnitLabel(makeItem({ base_unit: '' }), 'base')).toBe('case');
  });

  test('formats summaries for dual-unit and single-unit items', () => {
    expect(getInventoryUnitSummary(makeItem())).toBe('10 lb/case');
    expect(getInventoryUnitSummary(makeItem({ pack_unit: '', pack_size: null }))).toBe('Per lb');
    expect(getInventoryConversionSummary(makeItem())).toBe('1 case = 10 lb');
    expect(getInventoryConversionSummary(makeItem({ base_unit: '', pack_unit: 'bag' }))).toBe('Ordering unit: bag');
  });

  test('normalizes inventory item input and requires at least one unit', () => {
    expect(
      normalizeInventoryItemUnits({
        base_unit: ' gallon ',
        pack_unit: '',
        pack_size: '',
      })
    ).toEqual({
      base_unit: 'gallon',
      pack_unit: '',
      pack_size: 1,
    });

    expect(() =>
      normalizeInventoryItemUnits({
        base_unit: '   ',
        pack_unit: '',
        pack_size: null,
      })
    ).toThrow('At least one unit is required.');
  });
});
