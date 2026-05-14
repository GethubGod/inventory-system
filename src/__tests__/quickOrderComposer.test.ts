import {
  clampComposerContentHeight,
  isMessageSubmittable,
} from '../features/ordering/quickOrderComposer';

describe('isMessageSubmittable', () => {
  it('is false for empty or whitespace-only text', () => {
    expect(isMessageSubmittable('', false)).toBe(false);
    expect(isMessageSubmittable('   ', false)).toBe(false);
    expect(isMessageSubmittable('\n\t', false)).toBe(false);
  });

  it('is false while a send is in flight, even with valid text', () => {
    expect(isMessageSubmittable('2 cases tomato', true)).toBe(false);
  });

  it('is true for non-empty text when no send is in flight', () => {
    expect(isMessageSubmittable('2 cases tomato', false)).toBe(true);
    expect(isMessageSubmittable('  hello  ', false)).toBe(true);
  });
});

describe('clampComposerContentHeight', () => {
  const bounds = { minHeight: 42, maxHeight: 152 };

  it('returns minHeight for non-finite input', () => {
    expect(clampComposerContentHeight(Number.NaN, bounds)).toBe(42);
    expect(clampComposerContentHeight(Number.POSITIVE_INFINITY, bounds)).toBe(42);
    expect(clampComposerContentHeight(Number.NEGATIVE_INFINITY, bounds)).toBe(42);
  });

  it('clamps values below minHeight up to minHeight', () => {
    expect(clampComposerContentHeight(10, bounds)).toBe(42);
    expect(clampComposerContentHeight(-50, bounds)).toBe(42);
  });

  it('clamps values above maxHeight down to maxHeight', () => {
    expect(clampComposerContentHeight(400, bounds)).toBe(152);
  });

  it('rounds fractional input within range', () => {
    expect(clampComposerContentHeight(42.6, bounds)).toBe(43);
    expect(clampComposerContentHeight(88.2, bounds)).toBe(88);
  });
});
