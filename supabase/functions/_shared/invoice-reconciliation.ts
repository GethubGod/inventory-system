/**
 * Deterministic invoice/order reconciliation helpers.
 *
 * parse-order's full catalog matcher is app-specific and brings in a large
 * Quick Order graph, so Edge Functions cannot import it safely. This is the
 * intentionally small shared equivalent: it preserves the same NFKC, punctuation
 * cleanup, compact, singular, token-set, and alias matching ideas while only
 * considering the lines on the linked past order.
 */

export type InvoiceParsedLine = {
  rawName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
};

export type InvoiceOrderCandidate = {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  aliases?: string[];
  orderedUnitPrice?: number | null;
};

export type InvoiceLineMatch = {
  candidate: InvoiceOrderCandidate | null;
  score: number;
};

export type ReconciledInvoiceLine = InvoiceParsedLine & {
  matchedItemId: string | null;
  matchedPastOrderItemId: string | null;
  matchScore: number;
  priceDelta: number | null;
  quantityDelta: number | null;
  priceMismatch: boolean;
  quantityMismatch: boolean;
};

const SMART_QUOTES = /[\u2018\u2019\u201A\u201B\u2032`´]/g;
const SPLIT_PATTERN = /[()[\]{}\/,\-_]+/g;
const EPSILON = 0.000001;

export function normalizeInvoiceItemName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(SMART_QUOTES, "'")
    .replace(/&/g, " and ")
    .replace(SPLIT_PATTERN, " ")
    .replace(/[^\p{L}\p{N}\s']+/gu, " ")
    .replace(/'+/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeInvoiceUnit(value: string): string {
  const normalized = normalizeInvoiceItemName(value);
  const aliases: Record<string, string> = {
    case: "case",
    cases: "case",
    cs: "case",
    box: "box",
    boxes: "box",
    bx: "box",
    bag: "bag",
    bags: "bag",
    bg: "bag",
    pack: "pack",
    packs: "pack",
    pk: "pack",
    pkg: "pack",
    bottle: "bottle",
    bottles: "bottle",
    bt: "bottle",
    tray: "tray",
    trays: "tray",
    each: "each",
    ea: "each",
    pc: "each",
    pcs: "each",
    piece: "each",
    pieces: "each",
    pound: "lb",
    pounds: "lb",
    lb: "lb",
    lbs: "lb",
    ounce: "oz",
    ounces: "oz",
    oz: "oz",
    kilogram: "kg",
    kilograms: "kg",
    kg: "kg",
    gram: "g",
    grams: "g",
    g: "g",
  };
  return aliases[normalized] ?? normalized;
}

export function supplierPriceKey(itemId: string, unit: string): string {
  return `${itemId}::${normalizeInvoiceUnit(unit)}`;
}

function singularizeToken(token: string): string {
  if (token.length <= 3) return token;
  if (token === "cases") return "case";
  if (token === "boxes") return "box";
  if (token === "packs") return "pack";
  if (token === "pieces") return "piece";
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (
    token.endsWith("ches") || token.endsWith("shes") || token.endsWith("xes") ||
    token.endsWith("ses")
  ) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function pluralNormalized(value: string): string {
  return normalizeInvoiceItemName(value)
    .split(" ")
    .filter(Boolean)
    .map(singularizeToken)
    .join(" ");
}

function tokenKey(value: string): string {
  return pluralNormalized(value)
    .split(" ")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .join(" ");
}

function compact(value: string): string {
  return normalizeInvoiceItemName(value).replace(/\s+/g, "");
}

function candidateTerms(candidate: InvoiceOrderCandidate): string[] {
  return [candidate.itemName, ...(candidate.aliases ?? [])]
    .map(normalizeInvoiceItemName)
    .filter((term) => term.length >= 2);
}

function scoreTerm(rawName: string, term: string): number {
  const normalized = normalizeInvoiceItemName(rawName);
  if (!normalized || !term) return 0;
  if (normalized === term) return 1;
  if (compact(normalized) === compact(term)) return 0.99;
  if (pluralNormalized(normalized) === pluralNormalized(term)) return 0.95;
  if (
    tokenKey(normalized) === tokenKey(term) &&
    tokenKey(normalized).includes(" ")
  ) return 0.92;

  const inputTokens = new Set(
    pluralNormalized(normalized).split(" ").filter(Boolean),
  );
  const termTokens = new Set(pluralNormalized(term).split(" ").filter(Boolean));
  const shared =
    [...inputTokens].filter((token) => termTokens.has(token)).length;
  const total = new Set([...inputTokens, ...termTokens]).size;
  const overlap = total > 0 ? shared / total : 0;
  return shared >= 2 && overlap >= 0.8 ? 0.85 : 0;
}

/** Matches a parsed invoice name only to the linked past-order's candidates. */
export function matchInvoiceLine(
  rawName: string,
  candidates: InvoiceOrderCandidate[],
): InvoiceLineMatch {
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: Math.max(
        0,
        ...candidateTerms(candidate).map((term) => scoreTerm(rawName, term)),
      ),
    }))
    .filter((entry) => entry.score >= 0.85)
    .sort((left, right) =>
      right.score - left.score ||
      left.candidate.itemName.localeCompare(right.candidate.itemName)
    );

  const best = scored[0];
  if (!best) return { candidate: null, score: 0 };

  // Do not silently select one of two equally strong order lines. The compare
  // view can show it as unmatched for a human to resolve.
  const runnerUp = scored[1];
  if (runnerUp && Math.abs(best.score - runnerUp.score) < 0.03) {
    return { candidate: null, score: best.score };
  }
  return best;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Calculates deltas against the latest confirmed supplier price. For a first
 * observed price, the caller may provide an ordered unit price if its archived
 * order payload contains one; otherwise priceDelta remains null (not a false
 * "no change").
 */
export function reconcileInvoiceLines(input: {
  lines: InvoiceParsedLine[];
  candidates: InvoiceOrderCandidate[];
  latestPriceByItemAndUnit: Map<string, number>;
}): ReconciledInvoiceLine[] {
  return input.lines.map((line) => {
    const match = matchInvoiceLine(line.rawName, input.candidates);
    const candidate = match.candidate;
    const previousPrice = candidate
      ? input.latestPriceByItemAndUnit.get(
        supplierPriceKey(candidate.itemId, line.unit),
      )
      : undefined;
    const baselinePrice = finiteOrNull(previousPrice) ??
      finiteOrNull(candidate?.orderedUnitPrice);
    const priceDelta = baselinePrice === null
      ? null
      : line.unitPrice - baselinePrice;
    const quantityDelta = candidate ? line.quantity - candidate.quantity : null;

    return {
      ...line,
      unit: normalizeInvoiceUnit(line.unit) || "each",
      matchedItemId: candidate?.itemId ?? null,
      matchedPastOrderItemId: candidate?.id ?? null,
      matchScore: match.score,
      priceDelta,
      quantityDelta,
      priceMismatch: priceDelta !== null && Math.abs(priceDelta) > EPSILON,
      quantityMismatch: quantityDelta !== null &&
        Math.abs(quantityDelta) > EPSILON,
    };
  });
}
