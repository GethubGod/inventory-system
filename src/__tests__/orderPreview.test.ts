import {
  buildComposerItemNameList,
  buildComposerOrderText,
} from '../features/ordering/orderPreview';

describe('buildComposerOrderText', () => {
  it('renders one parser-friendly line per item with pluralized units', () => {
    const text = buildComposerOrderText([
      { item_name: 'Squid', quantity: 1, unit: 'pack' },
      { item_name: 'Salmon', quantity: 4, unit: 'case' },
    ]);
    expect(text).toBe('Squid 1 pack\nSalmon 4 cases');
  });

  it('keeps the singular unit when quantity is 1 and handles missing units', () => {
    expect(
      buildComposerOrderText([{ item_name: 'Tuna Loin', quantity: 1, unit: 'case' }]),
    ).toBe('Tuna Loin 1 case');
    expect(
      buildComposerOrderText([{ item_name: 'Avocado', quantity: 2, unit: null }]),
    ).toBe('Avocado 2');
  });

  it('uses the irregular plural for "box"', () => {
    expect(
      buildComposerOrderText([{ item_name: 'Gloves', quantity: 3, unit: 'box' }]),
    ).toBe('Gloves 3 boxes');
  });
});

describe('buildComposerItemNameList', () => {
  it('renders item names only, one per line, dropping quantities and units', () => {
    const text = buildComposerItemNameList([
      { item_name: 'Salmon', quantity: 3, unit: 'case' },
      { item_name: 'Yellowtail (Hamachi)', quantity: 0, unit: 'case' },
      { item_name: 'Tuna Loin', quantity: 5, unit: null },
    ]);
    expect(text).toBe('Salmon\nYellowtail (Hamachi)\nTuna Loin');
  });

  it('trims names, de-duplicates case-insensitively, and skips blanks', () => {
    const text = buildComposerItemNameList([
      { item_name: '  Ebi  ', quantity: 1, unit: 'pack' },
      { item_name: 'ebi', quantity: 2, unit: 'pack' },
      { item_name: '   ', quantity: 1, unit: null },
      { item_name: 'Mackerel', quantity: 3, unit: 'pack' },
    ]);
    expect(text).toBe('Ebi\nMackerel');
  });
});
