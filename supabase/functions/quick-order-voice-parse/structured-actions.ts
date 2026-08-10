import {
  buildCatalogSearchIndex,
  getTopCatalogAlternatives,
  matchCatalogIndex,
  normalizeSearchText,
} from '../parse-order/catalog-matcher.ts';
import type { CatalogAlternative, CatalogItem, ParserCorrection } from '../parse-order/types.ts';

export type GeminiVoiceActionType =
  | 'add'
  | 'remove'
  | 'set_remaining'
  | 'note'
  | 'unknown'
  | 'order'
  | 'inventory_remaining'
  | 'no_order_needed'
  | 'update_quantity'
  | 'needs_input';

export type GeminiVoiceAction = {
  type: GeminiVoiceActionType;
  itemName?: string | null;
  matchedItemId?: string | null;
  spokenItemText?: string | null;
  spokenItemName?: string | null;
  quantity?: number | null;
  unit?: string | null;
  remainingQuantity?: number | null;
  remainingUnit?: string | null;
  confidence?: number | null;
  sourceText?: string | null;
  reason?: string | null;
};

export type VoiceParsedAction = {
  type: 'add' | 'remove' | 'set_remaining' | 'note' | 'unknown';
  itemId: string | null;
  itemName: string;
  canonicalItemName: string | null;
  spokenItemName: string;
  quantity: number | null;
  unit: string | null;
  confidence: number;
  catalogMatchConfidence: number;
  sourceText: string;
  alternatives?: {
    itemId: string;
    itemName: string;
    confidence: number;
  }[];
};

export type VoiceUnresolvedReason =
  | 'missing_quantity'
  | 'missing_unit'
  | 'unknown_item'
  | 'ambiguous_item'
  | 'unsupported_command'
  | 'low_confidence';

export type VoiceUnresolvedAction = {
  sourceText: string;
  reason: VoiceUnresolvedReason;
  spokenItemName?: string;
  alternatives?: {
    itemId: string;
    itemName: string;
    confidence: number;
  }[];
};

export type VoiceActionVerificationResult = {
  actions: VoiceParsedAction[];
  unresolved: VoiceUnresolvedAction[];
  warnings: string[];
  normalizedText: string;
  confidence: number;
  needsReview: boolean;
};

const SAFE_MATCH_THRESHOLD = 0.65;
const LOW_ACTION_CONFIDENCE_THRESHOLD = 0.35;

const NO_ORDER_PHRASE =
  /\b(?:no need|do not order|don't order|dont order|enough|a lot|lots?|plenty|we have a lot|have enough|full)\b/i;

function clampConfidence(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function publicActionType(type: GeminiVoiceActionType): VoiceParsedAction['type'] {
  switch (type) {
    case 'order':
    case 'update_quantity':
      return 'add';
    case 'inventory_remaining':
      return 'set_remaining';
    case 'no_order_needed':
      return 'note';
    case 'needs_input':
      return 'unknown';
    case 'add':
    case 'remove':
    case 'set_remaining':
    case 'note':
    case 'unknown':
      return type;
    default:
      return 'unknown';
  }
}

function spokenItemName(action: GeminiVoiceAction): string {
  return cleanText(action.spokenItemName ?? action.spokenItemText ?? action.itemName);
}

function sourceText(action: GeminiVoiceAction, spoken: string): string {
  return cleanText(action.sourceText) || spoken || cleanText(action.reason) || 'voice input';
}

function publicAlternatives(alternatives: CatalogAlternative[] | undefined) {
  return (alternatives ?? []).slice(0, 3).map((entry) => ({
    itemId: entry.item_id,
    itemName: entry.item_name,
    confidence: clampConfidence(entry.confidence),
  }));
}

function normalizeUnit(value: string | null | undefined): string | null {
  const raw = cleanText(value).toLowerCase();
  if (!raw) return null;
  const aliases: Record<string, string> = {
    case: 'cs',
    cases: 'cs',
    cs: 'cs',
    pack: 'pack',
    packs: 'pack',
    pk: 'pack',
    package: 'pack',
    packages: 'pack',
    bottle: 'bottle',
    bottles: 'bottle',
    bt: 'bottle',
    bag: 'bag',
    bags: 'bag',
    box: 'box',
    boxes: 'box',
    tray: 'tray',
    trays: 'tray',
    piece: 'pc',
    pieces: 'pc',
    pcs: 'pc',
    pc: 'pc',
    each: 'pc',
    ea: 'pc',
    lb: 'lb',
    lbs: 'lb',
    pound: 'lb',
    pounds: 'lb',
  };
  return aliases[raw] ?? raw;
}

function reliableDefaultUnit(item: CatalogItem | null | undefined): string | null {
  if (!item) return null;
  const explicit = normalizeUnit(item.default_order_unit);
  if (explicit) return explicit;
  const allowed = (item.allowed_units ?? []).map(normalizeUnit).filter((unit): unit is string => Boolean(unit));
  const uniqueAllowed = [...new Set(allowed)];
  if (uniqueAllowed.length === 1) return uniqueAllowed[0];
  return null;
}

function formatQuantity(value: number | null): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3))).replace(/\.?0+$/, '');
}

function formatLine(action: VoiceParsedAction): string {
  const quantity = formatQuantity(action.quantity);
  return [action.canonicalItemName ?? action.itemName, quantity, action.unit]
    .filter((part): part is string => Boolean(part))
    .join(' ');
}

function normalizedTextFromResult(actions: VoiceParsedAction[], unresolved: VoiceUnresolvedAction[]): string {
  const actionLines = actions
    .filter((action) => action.type === 'add')
    .map(formatLine)
    .filter(Boolean);
  if (actionLines.length > 0) return [...new Set(actionLines)].join('\n');
  return [...new Set(unresolved.map((entry) => cleanText(entry.sourceText)).filter(Boolean))].join('\n');
}

function unresolvedReasonForMatch(input: {
  actionConfidence: number;
  matchType: string;
  hasAlternatives: boolean;
}): VoiceUnresolvedReason {
  if (input.actionConfidence < LOW_ACTION_CONFIDENCE_THRESHOLD) return 'low_confidence';
  if (input.matchType === 'no_match') return 'unknown_item';
  if (input.matchType === 'ambiguous' || input.hasAlternatives) return 'ambiguous_item';
  return 'unknown_item';
}

export function verifyVoiceActions(input: {
  actions: GeminiVoiceAction[];
  catalog: CatalogItem[];
  corrections?: ParserCorrection[];
  modelConfidence?: number | null;
  warnings?: string[];
}): VoiceActionVerificationResult {
  const index = buildCatalogSearchIndex(input.catalog, input.corrections ?? []);
  const catalogById = new Map(input.catalog.map((item) => [item.id, item]));
  const warnings = [...(input.warnings ?? [])];
  const verified: VoiceParsedAction[] = [];
  const unresolved: VoiceUnresolvedAction[] = [];
  const confidenceParts: number[] = [clampConfidence(input.modelConfidence)];

  for (const action of input.actions) {
    const type = publicActionType(action.type);
    const actionConfidence = clampConfidence(action.confidence);
    confidenceParts.push(actionConfidence);
    const spoken = spokenItemName(action);
    const source = sourceText(action, spoken);
    const phrase = `${source} ${spoken}`;

    if (type === 'note' || NO_ORDER_PHRASE.test(phrase)) {
      warnings.push(spoken ? `No order needed for ${spoken}.` : 'Voice input did not request an order.');
      unresolved.push({
        sourceText: source,
        reason: 'unsupported_command',
        spokenItemName: spoken || undefined,
      });
      continue;
    }

    if (!spoken) {
      unresolved.push({ sourceText: source, reason: 'unknown_item' });
      continue;
    }

    const match = matchCatalogIndex(spoken, index);
    const alternatives = publicAlternatives(match.alternatives ?? getTopCatalogAlternatives(spoken, input.catalog, input.corrections ?? [], 3, index));
    const matchConfidence = clampConfidence(match.confidence);
    confidenceParts.push(matchConfidence);

    if (!match.item_id || match.needs_clarification || matchConfidence < SAFE_MATCH_THRESHOLD) {
      unresolved.push({
        sourceText: source,
        reason: unresolvedReasonForMatch({
          actionConfidence,
          matchType: match.match_type,
          hasAlternatives: alternatives.length > 1 || match.match_type === 'ambiguous',
        }),
        spokenItemName: spoken,
        alternatives: alternatives.length > 0 ? alternatives : undefined,
      });
      warnings.push(`Uncertain item match: ${spoken}`);
      continue;
    }

    const item = catalogById.get(match.item_id) ?? null;
    const quantity = typeof action.quantity === 'number' && Number.isFinite(action.quantity) && action.quantity > 0
      ? action.quantity
      : type === 'set_remaining' && typeof action.remainingQuantity === 'number' && Number.isFinite(action.remainingQuantity)
        ? action.remainingQuantity
        : null;
    const unit = normalizeUnit(type === 'set_remaining' ? action.remainingUnit ?? action.unit : action.unit);
    const finalUnit = unit ?? reliableDefaultUnit(item);

    if ((type === 'add' || type === 'set_remaining') && quantity == null) {
      unresolved.push({
        sourceText: source,
        reason: 'missing_quantity',
        spokenItemName: spoken,
        alternatives: alternatives.length > 0 ? alternatives : undefined,
      });
      continue;
    }

    if ((type === 'add' || type === 'set_remaining') && !finalUnit) {
      unresolved.push({
        sourceText: source,
        reason: 'missing_unit',
        spokenItemName: spoken,
        alternatives: alternatives.length > 0 ? alternatives : undefined,
      });
      continue;
    }

    verified.push({
      type,
      itemId: match.item_id,
      itemName: match.item_name ?? item?.name ?? spoken,
      canonicalItemName: item?.name ?? match.item_name ?? null,
      spokenItemName: spoken,
      quantity,
      unit: finalUnit,
      confidence: clampConfidence(Math.min(actionConfidence, matchConfidence)),
      catalogMatchConfidence: matchConfidence,
      sourceText: source,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
    });
  }

  const normalizedText = normalizedTextFromResult(verified, unresolved);
  const confidence = clampConfidence(Math.min(...confidenceParts));

  return {
    actions: verified,
    unresolved,
    warnings: [...new Set(warnings)],
    normalizedText,
    confidence,
    needsReview: unresolved.length > 0 || verified.length === 0 || confidence < 0.7,
  };
}

export function isVoiceNoOrderPhrase(value: string): boolean {
  return NO_ORDER_PHRASE.test(normalizeSearchText(value));
}
