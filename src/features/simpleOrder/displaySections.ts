import { KNOWN_ITEM_CATEGORIES } from '@/types';
import { getCategoryLabel } from '@/constants';
import type { SelectionLine, SelectionState } from './checklistSelection';

/**
 * Pure row/section derivation for the restructured checklist list:
 * - "Show categories" ON  → non-rare lines grouped under category labels.
 * - "Show categories" OFF → one flat list.
 * - "Rarely ordered (N)"  → always its own last section, expanded by default,
 *   collapsible by tapping the header.
 * No React imports; unit-tested in src/__tests__/simpleOrderDisplaySections.test.ts.
 */

export interface DisplaySection {
  key: string;
  /** null = untitled (the flat list). */
  title: string | null;
  data: SelectionLine[];
  /** The collapsible rare section renders its own header. */
  isRare?: boolean;
  rareCount?: number;
}

const OTHER_CATEGORY_KEY = '__other__';

function categoryOrderIndex(categoryKey: string): number {
  const index = (KNOWN_ITEM_CATEGORIES as readonly string[]).indexOf(categoryKey);
  return index === -1 ? KNOWN_ITEM_CATEGORIES.length : index;
}

export interface DeriveDisplaySectionsOptions {
  showCategories: boolean;
  rareExpanded: boolean;
  /** Inventory category key for a line's item id; null/unknown → "Other". */
  categoryForItemId: (itemId: string | null) => string | null;
}

export function deriveDisplaySections(
  state: SelectionState,
  options: DeriveDisplaySectionsOptions,
): DisplaySection[] {
  const mainLines: SelectionLine[] = [];
  const rareLines: SelectionLine[] = [];
  for (const line of state.lines) {
    if (line.source === 'checklist' && line.bucket === 'rare') {
      rareLines.push(line);
    } else {
      mainLines.push(line);
    }
  }

  const sections: DisplaySection[] = [];

  if (!options.showCategories) {
    sections.push({ key: 'all', title: null, data: mainLines });
  } else {
    const groups = new Map<string, SelectionLine[]>();
    for (const line of mainLines) {
      const category = options.categoryForItemId(line.itemId) ?? OTHER_CATEGORY_KEY;
      const key = category.trim() || OTHER_CATEGORY_KEY;
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(line);
      } else {
        groups.set(key, [line]);
      }
    }

    const orderedKeys = Array.from(groups.keys()).sort((left, right) => {
      if (left === OTHER_CATEGORY_KEY) return 1;
      if (right === OTHER_CATEGORY_KEY) return -1;
      const orderDelta = categoryOrderIndex(left) - categoryOrderIndex(right);
      if (orderDelta !== 0) return orderDelta;
      return left.localeCompare(right);
    });

    for (const key of orderedKeys) {
      sections.push({
        key: `category:${key}`,
        title: key === OTHER_CATEGORY_KEY ? 'Other' : getCategoryLabel(key),
        data: groups.get(key) ?? [],
      });
    }

    if (sections.length === 0) {
      sections.push({ key: 'all', title: null, data: [] });
    }
  }

  if (rareLines.length > 0) {
    sections.push({
      key: 'rare',
      title: `Rarely ordered (${rareLines.length})`,
      data: options.rareExpanded ? rareLines : [],
      isRare: true,
      rareCount: rareLines.length,
    });
  }

  return sections;
}
