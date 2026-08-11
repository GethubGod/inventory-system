import { stripIgnoredQuickOrderPhrases } from '../../supabase/functions/parse-order/text-normalization.ts';

describe('stripIgnoredQuickOrderPhrases preserves newlines (regression)', () => {
  const ORDER = `Salmon 3
Yellowtail 3
Tuna 5
Spicy Tuna 3 box`;

  it('keeps multi-line structure when there are no ignore phrases', () => {
    const out = stripIgnoredQuickOrderPhrases(ORDER, []);
    expect(out.split('\n')).toHaveLength(4);
    expect(out).toContain('Salmon 3');
    expect(out).toContain('Yellowtail 3');
  });

  it('keeps line breaks while removing ignore phrases and collapsing spaces', () => {
    const out = stripIgnoredQuickOrderPhrases('please Salmon 3\n  Tuna   5  ', ['please']);
    expect(out).toBe('Salmon 3\nTuna 5');
  });

  it('does NOT flatten the list into a single line', () => {
    const out = stripIgnoredQuickOrderPhrases(ORDER, ['fyi', 'thanks']);
    expect(out.split('\n').length).toBeGreaterThan(1);
  });
});
