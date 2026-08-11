#!/usr/bin/env node
// Phase 6a spike — score parsed screenshots against ground truth.
//
// Usage:
//   node scripts/spike/score.mjs [--fixtures <dir>] [--parsed <dir>]
//
// For each fixtures/<id>.gt.json it loads <parsed>/<id>.parsed.json (default:
// same dir) and reports per-image + aggregate:
//   - item precision/recall (parsed items greedily aligned to ground-truth
//     items by name similarity >= MATCH_THRESHOLD)
//   - quantity accuracy and unit accuracy over aligned pairs
//   - a fuzzy-match pass of parsed names against a mock inventory list using
//     the same normalization the alias infra applies.
//
// Normalization sources mirrored here (keep in sync manually; this is a spike):
//   - aliasKey(): normalize_quick_order_alias_text() from
//     supabase/migrations/20260523120000_employee_quick_order_aliases.sql
//     (lower + trim + collapse whitespace) — also used, generated, by
//     quick_order_alias_rules.alias_key in
//     supabase/migrations/20260525140000_quick_order_parser_rules_v2.sql.
//   - normalizeCatalogText / pluralNormalizedText / similarity (edit distance,
//     token Dice, Jaro-Winkler + prefix boost) ported from
//     supabase/functions/parse-order/catalog-search-index.ts.
//   - unit synonyms from DEFAULT_UNIT_ALIASES in
//     supabase/functions/parse-order/units.ts (plus 'tub', used by fixtures).
// Zero npm dependencies.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let fixturesDir = join(here, 'fixtures');
let parsedDir = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--fixtures') fixturesDir = args[++i];
  else if (args[i] === '--parsed') parsedDir = args[++i];
}
parsedDir = parsedDir ?? fixturesDir;

const MATCH_THRESHOLD = 0.72; // spike choice; production matcher layers extra gates on top

// --- alias-key normalization (SQL normalize_quick_order_alias_text mirror) ---
function aliasKey(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized || null;
}

// --- ported from supabase/functions/parse-order/catalog-search-index.ts ---
const SPLIT_PATTERN = /[()[\]{}\/,\-_]+/g;
const SMART_QUOTES = /[‘’‚‛′`´]/g;

function normalizeCatalogText(value) {
  return value
    .normalize('NFKC')
    .replace(SMART_QUOTES, "'")
    .replace(/&/g, ' and ')
    .replace(SPLIT_PATTERN, ' ')
    .replace(/[^\p{L}\p{N}\s']+/gu, ' ')
    .replace(/'+/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function singularizeToken(token) {
  if (token.length <= 3) return token;
  if (token === 'cases') return 'case';
  if (token === 'packs') return 'pack';
  if (token === 'pieces') return 'piece';
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ches') || token.endsWith('shes') || token.endsWith('xes') || token.endsWith('ses')) {
    return token.slice(0, -2);
  }
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function pluralNormalizedText(value) {
  return normalizeCatalogText(value).split(' ').filter(Boolean).map(singularizeToken).join(' ');
}

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function editSimilarity(a, b) {
  if (!a || !b) return 0;
  const distance = levenshtein(a, b);
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;
  const score = 1 - distance / maxLength;
  if (distance <= 1 && Math.min(a.length, b.length) >= 4) return Math.max(score, 0.88);
  if (distance <= 2 && Math.min(a.length, b.length) >= 7) return Math.max(score, 0.82);
  return score;
}

function tokenDice(a, b) {
  const aTokens = new Set(pluralNormalizedText(a).split(' ').filter(Boolean));
  const bTokens = new Set(pluralNormalizedText(b).split(' ').filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  aTokens.forEach((token) => {
    if (bTokens.has(token)) overlap += 1;
  });
  return (2 * overlap) / (aTokens.size + bTokens.size);
}

function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = Array.from({ length: a.length }, () => false);
  const bMatches = Array.from({ length: b.length }, () => false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let bIndex = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[bIndex]) bIndex += 1;
    if (a[i] !== b[bIndex]) transpositions += 1;
    bIndex += 1;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i += 1) {
    if (a[i] !== b[i]) break;
    prefix += 1;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const normalizedA = normalizeCatalogText(a);
  const normalizedB = normalizeCatalogText(b);
  if (normalizedA === normalizedB) return 1;
  const compactA = normalizedA.replace(/\s+/g, '');
  const compactB = normalizedB.replace(/\s+/g, '');
  if (compactA === compactB) return 0.96;
  const editScore = editSimilarity(compactA, compactB);
  const tokenScore = tokenDice(normalizedA, normalizedB);
  const jaroScore = jaroWinkler(compactA, compactB);
  const lengthRatio = Math.min(compactA.length, compactB.length) / Math.max(compactA.length, compactB.length);
  const prefixBoost = lengthRatio >= 0.65 && (compactB.startsWith(compactA) || compactA.startsWith(compactB)) ? 0.05 : 0;
  return Math.max(0, Math.min(1, Math.max(editScore, tokenScore, jaroScore) + prefixBoost));
}

// --- unit normalization (DEFAULT_UNIT_ALIASES mirror, canonical singular) ---
const UNIT_CANONICAL = {
  cs: 'case', case: 'case', cases: 'case',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  pc: 'piece', pcs: 'piece', piece: 'piece', pieces: 'piece', ea: 'piece', each: 'piece',
  box: 'box', boxes: 'box',
  bottle: 'bottle', bottles: 'bottle', btl: 'bottle', bt: 'bottle',
  bag: 'bag', bags: 'bag',
  tray: 'tray', trays: 'tray',
  pack: 'pack', packs: 'pack', pk: 'pack', pkg: 'pack', package: 'pack', packages: 'pack',
  tub: 'tub', tubs: 'tub',
};

function canonicalUnit(value) {
  if (value === null || value === undefined || value === '') return null;
  const key = String(value).normalize('NFKC').trim().toLowerCase().replace(/\.$/, '');
  return UNIT_CANONICAL[key] ?? key;
}

// --- mock inventory (names + aliases in the style of the seeded alias data in
// supabase/migrations/20260510020000_quick_order_seed_data.sql) ---
const MOCK_INVENTORY = [
  { name: 'Salmon fillet', aliases: ['salmon', 'sake', 'salm', 'atlantic', '鲑鱼'] },
  { name: 'Tuna belly', aliases: ['tuna', 'toro', 'ahi belly', '金枪鱼'] },
  { name: 'Yellowtail', aliases: ['hamachi', 'buri'] },
  { name: 'Albacore', aliases: ['shiro', 'white tuna'] },
  { name: 'Nori', aliases: ['seaweed', '海苔'] },
  { name: 'Masago', aliases: [] },
  { name: 'Sushi rice', aliases: ['rice'] },
  { name: 'Kewpie mayo', aliases: ['mayo'] },
  { name: 'Gyoza', aliases: [] },
  { name: 'Ebi Shrimp 16/20', aliases: ['shrimp', 'ebi', 'ebi shrimp'] },
  { name: 'Unagi eel fillet', aliases: ['unagi', 'eel'] },
  { name: 'Crab stick', aliases: ['kani', 'imitation crab'] },
];

function matchInventory(rawName) {
  const key = aliasKey(rawName);
  for (const item of MOCK_INVENTORY) {
    if (aliasKey(item.name) === key) return { item: item.name, via: 'exact_name', score: 1 };
    for (const alias of item.aliases) {
      if (aliasKey(alias) === key) return { item: item.name, via: 'exact_alias', score: 1 };
    }
  }
  let best = null;
  for (const item of MOCK_INVENTORY) {
    for (const term of [item.name, ...item.aliases]) {
      const score = similarity(rawName, term);
      if (!best || score > best.score) best = { item: item.name, via: 'fuzzy', score };
    }
  }
  if (best && best.score >= MATCH_THRESHOLD) return { ...best, score: Number(best.score.toFixed(3)) };
  return { item: null, via: 'unmatched', score: best ? Number(best.score.toFixed(3)) : 0 };
}

// --- alignment + scoring ---
function alignItems(parsedItems, truthItems) {
  const pairs = [];
  for (let p = 0; p < parsedItems.length; p += 1) {
    for (let t = 0; t < truthItems.length; t += 1) {
      const score = similarity(parsedItems[p].name, truthItems[t].name);
      if (score >= MATCH_THRESHOLD) pairs.push({ p, t, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedP = new Set();
  const usedT = new Set();
  const aligned = [];
  for (const pair of pairs) {
    if (usedP.has(pair.p) || usedT.has(pair.t)) continue;
    usedP.add(pair.p);
    usedT.add(pair.t);
    aligned.push(pair);
  }
  return { aligned, usedP, usedT };
}

function quantityEqual(a, b) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 1e-9;
}

const gtFiles = readdirSync(fixturesDir).filter((f) => f.endsWith('.gt.json')).sort();
if (gtFiles.length === 0) {
  console.error(`no *.gt.json files in ${fixturesDir}`);
  process.exit(1);
}

const totals = { tp: 0, fp: 0, fn: 0, qtyRight: 0, qtyTotal: 0, unitRight: 0, unitTotal: 0 };
const matchTotals = { exact: 0, fuzzy: 0, unmatched: 0 };
const rows = [];
const unmatchedNames = [];
const fuzzyDetails = [];

for (const gtFile of gtFiles) {
  const id = gtFile.replace(/\.gt\.json$/, '');
  const truth = JSON.parse(readFileSync(join(fixturesDir, gtFile), 'utf8')).items;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(parsedDir, `${id}.parsed.json`), 'utf8')).items;
  } catch {
    console.warn(`missing ${id}.parsed.json in ${parsedDir} — skipping`);
    continue;
  }

  const { aligned, usedP } = alignItems(parsed, truth);
  const tp = aligned.length;
  const fp = parsed.length - tp;
  const fn = truth.length - tp;
  let qtyRight = 0;
  let unitRight = 0;
  let unitTotal = 0;
  for (const pair of aligned) {
    if (quantityEqual(parsed[pair.p].quantity ?? null, truth[pair.t].quantity ?? null)) qtyRight += 1;
    const truthUnit = canonicalUnit(truth[pair.t].unit);
    const parsedUnit = canonicalUnit(parsed[pair.p].unit);
    unitTotal += 1;
    if (truthUnit === parsedUnit) unitRight += 1;
  }

  for (let p = 0; p < parsed.length; p += 1) {
    const match = matchInventory(parsed[p].name);
    if (match.via === 'unmatched') {
      matchTotals.unmatched += 1;
      unmatchedNames.push(`${parsed[p].name} (${id}, best ${match.score})`);
    } else if (match.via === 'fuzzy') {
      matchTotals.fuzzy += 1;
      fuzzyDetails.push(`${parsed[p].name} -> ${match.item} (${match.score})`);
    } else {
      matchTotals.exact += 1;
    }
    if (!usedP.has(p)) {
      // false-positive item; still counted in matching stats above
    }
  }

  totals.tp += tp;
  totals.fp += fp;
  totals.fn += fn;
  totals.qtyRight += qtyRight;
  totals.qtyTotal += tp;
  totals.unitRight += unitRight;
  totals.unitTotal += unitTotal;

  rows.push({
    id,
    truth: truth.length,
    parsed: parsed.length,
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    qtyAcc: tp === 0 ? 0 : qtyRight / tp,
    unitAcc: unitTotal === 0 ? 0 : unitRight / unitTotal,
  });
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;
console.log('\nPer-image results');
console.log('| image | GT items | parsed | precision | recall | qty acc | unit acc |');
console.log('|---|---|---|---|---|---|---|');
for (const row of rows) {
  console.log(`| ${row.id} | ${row.truth} | ${row.parsed} | ${pct(row.precision)} | ${pct(row.recall)} | ${pct(row.qtyAcc)} | ${pct(row.unitAcc)} |`);
}
const precision = totals.tp / Math.max(1, totals.tp + totals.fp);
const recall = totals.tp / Math.max(1, totals.tp + totals.fn);
console.log('\nAggregate');
console.log(`| items (GT/parsed) | ${totals.tp + totals.fn} / ${totals.tp + totals.fp} |`);
console.log(`| item precision | ${pct(precision)} |`);
console.log(`| item recall | ${pct(recall)} |`);
console.log(`| quantity accuracy (aligned) | ${pct(totals.qtyTotal ? totals.qtyRight / totals.qtyTotal : 0)} (${totals.qtyRight}/${totals.qtyTotal}) |`);
console.log(`| unit accuracy (aligned) | ${pct(totals.unitTotal ? totals.unitRight / totals.unitTotal : 0)} (${totals.unitRight}/${totals.unitTotal}) |`);

const matchTotal = matchTotals.exact + matchTotals.fuzzy + matchTotals.unmatched;
console.log(`\nInventory matching (mock catalog, threshold ${MATCH_THRESHOLD})`);
console.log(`| exact (alias-key) | ${matchTotals.exact}/${matchTotal} (${pct(matchTotals.exact / Math.max(1, matchTotal))}) |`);
console.log(`| fuzzy (similarity) | ${matchTotals.fuzzy}/${matchTotal} (${pct(matchTotals.fuzzy / Math.max(1, matchTotal))}) |`);
console.log(`| unmatched -> review | ${matchTotals.unmatched}/${matchTotal} (${pct(matchTotals.unmatched / Math.max(1, matchTotal))}) |`);
if (fuzzyDetails.length) console.log(`\nFuzzy matches:\n  ${[...new Set(fuzzyDetails)].join('\n  ')}`);
if (unmatchedNames.length) console.log(`\nUnmatched (needs review UI):\n  ${[...new Set(unmatchedNames)].join('\n  ')}`);
