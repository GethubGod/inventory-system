import type { CandidateParsedLine } from './types.ts';
import { normalizeUnit, UNIT_WORDS } from './units.ts';

const QUANTITY = String.raw`(\d+(?:\.\d+)?)`;
const UNIT = UNIT_WORDS.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const QTY_UNIT = new RegExp(`${QUANTITY}\\s*(${UNIT})\\b`, 'i');
const QTY_ONLY = new RegExp(`\\b${QUANTITY}\\b`, 'i');

const LEADING_INTENT = /^(?:please\s+)?(?:(?:add(?:\s+another)?|also|plus|another|need(?:\s+more)?|change(?:\s+to)?|make(?:\s+it|\s+that)?|replace|actually|update|set)\s+)/i;
const TRAILING_INTENT = /\s+(?:to|instead)$/i;

export function normalizeOrderText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' ').toLowerCase())
    .join('\n')
    .trim();
}

function hasQuantitySignal(value: string): boolean {
  return QTY_UNIT.test(value) || QTY_ONLY.test(value);
}

function splitSafeAnd(segment: string): string[] {
  const parts = segment.split(/\s+\band\b\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return [segment];
  return parts.every(hasQuantitySignal) ? parts : [segment];
}

export function splitOrderLines(rawText: string): string[] {
  const primary = rawText
    .replace(/\r\n?/g, '\n')
    .split(/\n|,|;/)
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .filter(Boolean);

  return primary.flatMap(splitSafeAnd);
}

function cleanItemText(value: string): string {
  let next = value.trim().replace(/[ \t]+/g, ' ');
  let previous = '';
  while (next !== previous) {
    previous = next;
    next = next.replace(LEADING_INTENT, '').replace(TRAILING_INTENT, '').trim();
  }
  return next;
}

function toQuantity(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseDeterministicOrder(rawText: string): CandidateParsedLine[] {
  const lines = splitOrderLines(rawText);
  return lines.map((rawLine, index) => parseLine(rawLine, index));
}

function parseLine(rawLine: string, index: number): CandidateParsedLine {
  const normalized = rawLine.trim().replace(/[ \t]+/g, ' ').toLowerCase();
  let itemText = normalized;
  let quantity: number | null = null;
  let unit: string | null = null;
  let confidence = 0.55;

  const qtyUnitAtStart = normalized.match(new RegExp(`^\\s*${QUANTITY}\\s*(${UNIT})\\b\\s+(.+)$`, 'i'));
  if (qtyUnitAtStart) {
    quantity = toQuantity(qtyUnitAtStart[1]);
    unit = normalizeUnit(qtyUnitAtStart[2]);
    itemText = qtyUnitAtStart[3];
    confidence = 0.92;
  } else {
    const qtyAtStart = normalized.match(new RegExp(`^\\s*${QUANTITY}\\b\\s+(.+)$`, 'i'));
    if (qtyAtStart) {
      quantity = toQuantity(qtyAtStart[1]);
      itemText = qtyAtStart[2];
      confidence = 0.78;
    } else {
      const qtyUnitAtEnd = normalized.match(new RegExp(`^(.+?)\\s+${QUANTITY}\\s*(${UNIT})\\s*$`, 'i'));
      if (qtyUnitAtEnd) {
        itemText = qtyUnitAtEnd[1];
        quantity = toQuantity(qtyUnitAtEnd[2]);
        unit = normalizeUnit(qtyUnitAtEnd[3]);
        confidence = 0.92;
      } else {
        const qtyAtEnd = normalized.match(new RegExp(`^(.+?)\\s+${QUANTITY}\\s*$`, 'i'));
        if (qtyAtEnd) {
          itemText = qtyAtEnd[1];
          quantity = toQuantity(qtyAtEnd[2]);
          confidence = 0.74;
        }
      }
    }
  }

  if (!unit) {
    const unitMatch = normalized.match(QTY_UNIT);
    if (unitMatch) unit = normalizeUnit(unitMatch[2]);
  }

  itemText = cleanItemText(itemText);
  const issue = !itemText ? 'missing_item' : quantity == null ? 'missing_quantity' : unit == null ? 'missing_unit' : undefined;

  return {
    raw_text: rawLine,
    normalized_text: normalized,
    item_text: itemText || normalized,
    quantity,
    unit,
    parse_source: 'deterministic',
    parse_confidence: issue ? Math.min(confidence, 0.65) : confidence,
    line_index: index,
    issue,
  };
}

