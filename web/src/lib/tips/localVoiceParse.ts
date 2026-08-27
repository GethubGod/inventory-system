// On-device utterance parser for the "local_live" voice variant. Turns one
// speech-recognition utterance ("fifty for cash", "actually seventy",
// "Maria and Tom closed", "dinner") into the same TipVoiceFields shape the
// Gemini edge function returns, so the existing mergeParsed() machinery and
// review UI work unchanged — just with ~0ms latency instead of a network
// round trip per pause.
//
// The caller re-parses the utterance on every interim recognition result
// against a snapshot of the fields taken before the utterance began, so
// in-utterance revisions ("fifteen" heard, then corrected to "fifty")
// converge without special handling. Pure and synchronous — unit tested.

import type { RosterPerson } from "./api";
import type { TipVoiceFields } from "./voiceSchema";

export interface KnownFieldState {
  /** Current cash/card values (null = not captured yet). */
  cash: number | null;
  card: number | null;
  /** The amount field most recently set by voice — the target of a bare
   *  "actually seventy" correction. */
  lastAmountField: "cash" | "card" | null;
  /** Already-selected people ({id,name}); spoken names ADD to this set. */
  people: { id: string; name: string }[];
}

const MAX_AMOUNT = 99999.99;

// ---------------------------------------------------------------------------
// Number words
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

interface Token {
  raw: string;
  /** Numeric value when this token is a digit-number ("126.50", "$70"). */
  digits: number | null;
}

function tokenize(utterance: string): Token[] {
  return utterance
    .toLowerCase()
    .replace(/[$,]/g, " ")
    .replace(/[^\w.\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const cleaned = raw.replace(/\.+$/, "");
      const digits = /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
      return { raw: cleaned, digits };
    })
    .filter((t) => t.raw.length > 0);
}

/**
 * Consume a number starting at tokens[i]. Returns the value and the index
 * after the last consumed token, or null when tokens[i] doesn't start one.
 * Handles digits ("126.50"), word numbers ("fifty five", "one hundred
 * twenty"), the spoken-price form ("three fifty" = 350), and decimals via
 * "point" ("fifty point five" = 50.5).
 */
function readNumber(tokens: Token[], start: number): { value: number; next: number } | null {
  const first = tokens[start];
  if (!first) return null;

  if (first.digits !== null) {
    let value = first.digits;
    let next = start + 1;
    // "1 50" from "$1.50"? Rare — recognizers emit "1.50". Handle
    // "hundred/thousand" after a digit ("2 hundred").
    while (tokens[next] && (tokens[next].raw === "hundred" || tokens[next].raw === "thousand")) {
      value *= tokens[next].raw === "hundred" ? 100 : 1000;
      next += 1;
    }
    return { value, next };
  }

  const isUnit = (t: Token | undefined) => t !== undefined && t.raw in UNITS;
  const isTens = (t: Token | undefined) => t !== undefined && t.raw in TENS;
  if (!isUnit(first) && !isTens(first) && first.raw !== "hundred") return null;

  let value = 0;
  let current = 0; // running chunk below the next hundred/thousand
  let i = start;
  let consumedAny = false;

  while (i < tokens.length) {
    const t = tokens[i];
    if (isTens(t)) {
      // "three fifty" → 350 (spoken price), but "twenty fifty" is two
      // numbers — only fold a UNIT prefix into the hundreds place.
      if (current > 0 && current <= 9 && value === 0) {
        current = current * 100 + TENS[t.raw];
      } else if (current === 0 || (current >= 20 && current % 10 === 0)) {
        if (current !== 0 && current % 100 >= 20) break; // "fifty sixty" = two numbers
        current += TENS[t.raw];
      } else {
        break;
      }
      i += 1;
      consumedAny = true;
      continue;
    }
    if (isUnit(t)) {
      const unit = UNITS[t.raw];
      if (current % 10 !== 0 || (current % 100 >= 10 && current % 100 <= 19)) break;
      if (current % 100 >= 20 && unit >= 10) break;
      if (current === 0) current = unit;
      else if (current % 100 >= 20 && unit <= 9) current += unit;
      else if (current >= 100 && current % 100 === 0) current += unit; // "one hundred five"
      else break;
      i += 1;
      consumedAny = true;
      continue;
    }
    if (t.raw === "hundred") {
      current = (current === 0 ? 1 : current) * 100;
      i += 1;
      consumedAny = true;
      continue;
    }
    if (t.raw === "thousand") {
      value += (current === 0 ? 1 : current) * 1000;
      current = 0;
      i += 1;
      consumedAny = true;
      continue;
    }
    if (t.raw === "and" && consumedAny && (isUnit(tokens[i + 1]) || isTens(tokens[i + 1]))) {
      // "one hundred and five"
      i += 1;
      continue;
    }
    break;
  }

  if (!consumedAny) return null;
  value += current;

  // Decimal tail: "point five" / "point five oh".
  let next = i;
  if (tokens[next]?.raw === "point") {
    let decimals = "";
    let j = next + 1;
    while (tokens[j] && (tokens[j].digits !== null || tokens[j].raw in UNITS)) {
      const d = tokens[j].digits !== null ? String(tokens[j].digits) : String(UNITS[tokens[j].raw]);
      decimals += d;
      j += 1;
    }
    if (decimals.length > 0) {
      value = Number(`${Math.trunc(value)}.${decimals}`);
      next = j;
    }
  }

  return { value, next };
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

const CASH_WORDS = new Set(["cash"]);
const CARD_WORDS = new Set(["card", "cards", "credit", "visa", "charge", "charged"]);
const MEAL_WORDS: Record<string, "lunch" | "dinner"> = {
  lunch: "lunch",
  dinner: "dinner",
  tonight: "dinner",
};
const CORRECTION_WORDS = new Set(["actually", "wait", "no", "scratch", "correction", "change"]);
const EVERYONE_WORDS = new Set(["everyone", "everybody"]);
const REMOVE_WORDS = new Set(["not", "without", "remove", "minus", "except"]);
/** Dollar amounts read back with units: "fifty dollars", "seventy bucks". */
const MONEY_UNIT_WORDS = new Set(["dollar", "dollars", "buck", "bucks"]);
/** Connectors that may sit between a number and its field name. */
const FILLER_WORDS = new Set(["for", "in", "on", "was", "is", "of", "the", "and", "a", "it", "make", "to", "that"]);

function fieldWordAt(tokens: Token[], i: number): "cash" | "card" | null {
  const t = tokens[i];
  if (!t) return null;
  if (CASH_WORDS.has(t.raw)) return "cash";
  if (CARD_WORDS.has(t.raw)) return "card";
  return null;
}

// ---------------------------------------------------------------------------
// Roster matching
// ---------------------------------------------------------------------------

function normalizeName(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Match roster names against the token stream. First names win when unique;
 * an ambiguous first name needs the next token to disambiguate via the full
 * name. Returns matched people (deduped) and which token indices were
 * consumed by a name.
 */
function matchRoster(
  tokens: Token[],
  roster: RosterPerson[],
): { matches: { id: string; name: string; index: number }[]; consumed: Set<number> } {
  const matches: { id: string; name: string; index: number }[] = [];
  const consumed = new Set<number>();
  const byFirst = new Map<string, RosterPerson[]>();
  for (const person of roster) {
    const first = normalizeName(person.name.trim().split(/\s+/)[0] ?? "");
    if (!first) continue;
    const list = byFirst.get(first) ?? [];
    list.push(person);
    byFirst.set(first, list);
  }

  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed.has(i)) continue;
    const word = normalizeName(tokens[i].raw);
    const candidates = byFirst.get(word);
    if (!candidates || candidates.length === 0) continue;
    if (candidates.length === 1) {
      matches.push({ id: candidates[0].id, name: candidates[0].name, index: i });
      consumed.add(i);
      continue;
    }
    // Shared first name: try to disambiguate with the following token.
    const nextWord = tokens[i + 1] ? normalizeName(tokens[i + 1].raw) : "";
    const full = candidates.find((p) => {
      const parts = p.name.trim().split(/\s+/).map(normalizeName);
      return parts.length > 1 && parts[1].startsWith(nextWord) && nextWord.length > 0;
    });
    if (full) {
      matches.push({ id: full.id, name: full.name, index: i });
      consumed.add(i);
      consumed.add(i + 1);
    }
    // Still ambiguous → skip; review screen handles it.
  }
  return { matches, consumed };
}

// ---------------------------------------------------------------------------
// Main parse
// ---------------------------------------------------------------------------

function emptyResult(): TipVoiceFields {
  return {
    meal: { value: null, confidence: 0 },
    cash: { value: null, confidence: 0 },
    card: { value: null, confidence: 0 },
    people: { matched: [], unmatched: [], confidence: 0 },
  };
}

function clampAmount(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Parse one utterance into TipVoiceFields.
 *
 * Amount targeting rules (matching how people actually read tips out):
 *  - "cash fifty" / "fifty for cash" / "cash is fifty" → that field, high
 *    confidence.
 *  - A bare number goes to the first empty amount field, cash before card
 *    (the sheet's top-to-bottom order).
 *  - Two bare numbers → cash then card, in spoken order.
 *  - A bare number when both are filled (or after "actually/no/wait")
 *    replaces the amount field voice touched last.
 *  - People ADD to the known selection; "not Maria" removes.
 */
export function parseLocalUtterance(
  utterance: string,
  roster: RosterPerson[],
  known: KnownFieldState,
): TipVoiceFields {
  const result = emptyResult();
  const tokens = tokenize(utterance);
  if (tokens.length === 0) return result;

  // Roster names first — a matched name's tokens can't be numbers/keywords.
  const { matches, consumed } = matchRoster(tokens, roster);

  let sawCorrection = false;
  const bareNumbers: number[] = [];
  // Explicit field assignments found in this utterance.
  const assigned: { cash: number | null; card: number | null } = { cash: null, card: null };

  let i = 0;
  while (i < tokens.length) {
    if (consumed.has(i)) {
      i += 1;
      continue;
    }
    const t = tokens[i];

    if (CORRECTION_WORDS.has(t.raw)) {
      sawCorrection = true;
      i += 1;
      continue;
    }

    const meal = MEAL_WORDS[t.raw];
    if (meal) {
      result.meal = { value: meal, confidence: t.raw === "tonight" ? 0.6 : 0.95 };
      i += 1;
      continue;
    }

    // "cash [is/was] <number>"
    const field = fieldWordAt(tokens, i);
    if (field) {
      let j = i + 1;
      while (tokens[j] && FILLER_WORDS.has(tokens[j].raw) && !consumed.has(j)) j += 1;
      const num = !consumed.has(j) ? readNumber(tokens, j) : null;
      if (num) {
        const amount = clampAmount(num.value);
        if (amount !== null) {
          assigned[field] = amount;
          i = num.next;
          // swallow a trailing "dollars"
          if (tokens[i] && MONEY_UNIT_WORDS.has(tokens[i].raw)) i += 1;
          continue;
        }
      }
      i += 1;
      continue;
    }

    // "<number> [dollars] [for/on] cash|card"  or bare number
    const num = readNumber(tokens, i);
    if (num) {
      let j = num.next;
      if (tokens[j] && MONEY_UNIT_WORDS.has(tokens[j].raw)) j += 1;
      let k = j;
      while (tokens[k] && FILLER_WORDS.has(tokens[k].raw) && !consumed.has(k)) k += 1;
      const trailingField = !consumed.has(k) ? fieldWordAt(tokens, k) : null;
      const amount = clampAmount(num.value);
      if (amount !== null) {
        if (trailingField) {
          assigned[trailingField] = amount;
          i = k + 1;
          continue;
        }
        bareNumbers.push(amount);
      }
      i = j;
      continue;
    }

    i += 1;
  }

  // Distribute bare numbers.
  const cashKnown = assigned.cash ?? known.cash;
  const cardKnown = assigned.card ?? known.card;
  if (bareNumbers.length >= 2) {
    // "fifty and seventy" → cash then card in spoken order; an explicitly
    // assigned field keeps its value and the bare numbers fill the rest.
    const queue = [...bareNumbers];
    if (assigned.cash === null) assigned.cash = queue.shift() ?? null;
    if (assigned.card === null) assigned.card = queue.shift() ?? null;
  } else if (bareNumbers.length === 1) {
    const value = bareNumbers[0];
    if (assigned.cash === null && assigned.card === null) {
      if (sawCorrection && known.lastAmountField) {
        assigned[known.lastAmountField] = value;
      } else if (cashKnown === null) {
        assigned.cash = value;
      } else if (cardKnown === null) {
        assigned.card = value;
      } else if (known.lastAmountField) {
        // Both filled, no correction word — later speech still wins on the
        // most recent field.
        assigned[known.lastAmountField] = value;
      } else {
        assigned.cash = value;
      }
    } else if (assigned.cash !== null && assigned.card === null && cardKnown === null) {
      // "cash fifty seventy" → the stray number falls through to card.
      assigned.card = value;
    }
  }

  if (assigned.cash !== null) {
    result.cash = { value: assigned.cash, confidence: bareNumbers.includes(assigned.cash) ? 0.8 : 0.95 };
  }
  if (assigned.card !== null) {
    result.card = { value: assigned.card, confidence: bareNumbers.includes(assigned.card) ? 0.8 : 0.95 };
  }

  // People: additions + removals against the known selection.
  const everyone = tokens.some((t) => EVERYONE_WORDS.has(t.raw));
  const removals = new Set<string>();
  for (const match of matches) {
    // A removal word within the two tokens before the name flags a removal.
    for (let back = 1; back <= 2; back += 1) {
      const before = tokens[match.index - back];
      if (before && REMOVE_WORDS.has(before.raw)) {
        removals.add(match.id);
        break;
      }
    }
  }
  if (everyone || matches.length > 0) {
    const byId = new Map<string, { id: string; name: string }>();
    if (everyone) {
      for (const person of roster) byId.set(person.id, { id: person.id, name: person.name });
    } else {
      for (const person of known.people) byId.set(person.id, person);
    }
    for (const match of matches) {
      if (!removals.has(match.id)) byId.set(match.id, { id: match.id, name: match.name });
    }
    for (const id of removals) byId.delete(id);
    result.people = {
      matched: [...byId.values()],
      unmatched: [],
      confidence: 0.9,
    };
  }

  return result;
}
