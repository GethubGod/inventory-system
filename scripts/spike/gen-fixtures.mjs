#!/usr/bin/env node
// Phase 6a spike — synthetic order-screenshot fixture generator.
//
// Zero npm deps. Emits an SVG per fixture, converts it to PNG with the macOS
// built-in `qlmanage` (QuickLook thumbnailer renders SVG text, including CJK,
// via system fonts), and writes a ground-truth JSON next to each image.
//
// Regenerate with:  node scripts/spike/gen-fixtures.mjs
// (macOS only for the PNG step; the committed SVGs are the source of truth.)

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, renameSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures');
mkdirSync(outDir, { recursive: true });

const W = 640;

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * lines: array of
 *   { text, size?, weight?, color?, strike?, x? }              — plain line
 *   { bubble: text, side: 'left'|'right' }                     — chat bubble
 */
function renderSvg({ lines, bg = '#ffffff', font = 'Helvetica, PingFang SC, Hiragino Sans' }) {
  const parts = [];
  let y = 48;
  for (const line of lines) {
    if (line.bubble !== undefined) {
      const size = 22;
      const padX = 16;
      const textW = Math.min(line.bubble.length * size * 0.58 + padX * 2, W - 60);
      const h = 44;
      const x = line.side === 'right' ? W - 30 - textW : 30;
      const fill = line.side === 'right' ? '#34c759' : '#e9e9eb';
      const textColor = line.side === 'right' ? '#ffffff' : '#111111';
      parts.push(`<rect x="${x}" y="${y - 30}" width="${textW}" height="${h}" rx="18" fill="${fill}"/>`);
      parts.push(
        `<text x="${x + padX}" y="${y}" font-family="${font}" font-size="${size}" fill="${textColor}">${esc(line.bubble)}</text>`,
      );
      y += h + 14;
      continue;
    }
    const size = line.size ?? 26;
    const x = line.x ?? 32;
    const weight = line.weight ?? 'normal';
    const color = line.color ?? '#111111';
    parts.push(
      `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(line.text)}</text>`,
    );
    if (line.strike) {
      // Explicit line instead of text-decoration so every renderer shows it.
      const approxW = line.text.length * size * 0.55;
      parts.push(
        `<line x1="${x - 2}" y1="${y - size * 0.32}" x2="${x + approxW}" y2="${y - size * 0.32}" stroke="${color}" stroke-width="2.5"/>`,
      );
    }
    y += size + 18;
  }
  const height = y + 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">` +
    `<rect width="${W}" height="${height}" fill="${bg}"/>${parts.join('')}</svg>`;
}

// Ground-truth conventions (mirrored by the prompt in parse-order-screenshot.mjs):
// - name: item text as written on the screenshot (verbatim, lowercased ok);
//   matching to inventory happens later (score.mjs), not at extraction time.
// - quantity: number or null; ranges take the UPPER bound with the range noted.
// - unit: canonical singular (case, box, bag, pack, bottle, tray, piece, lb, tub)
//   or null when the screenshot names none. 箱 translates to case.
// - struck-through items are excluded.
const fixtures = [
  {
    id: '01-clean-list',
    svg: {
      lines: [
        { text: 'Fish order — Monday', size: 30, weight: 'bold' },
        { text: '1. Salmon fillet - 2 cases' },
        { text: '2. Tuna belly - 1 case' },
        { text: '3. Nori - 3 packs' },
        { text: '4. Masago - 2 tubs' },
        { text: '5. Sushi rice - 1 bag' },
        { text: '6. Hondashi - 1 box' },
      ],
    },
    truth: [
      { name: 'salmon fillet', quantity: 2, unit: 'case' },
      { name: 'tuna belly', quantity: 1, unit: 'case' },
      { name: 'nori', quantity: 3, unit: 'pack' },
      { name: 'masago', quantity: 2, unit: 'tub' },
      { name: 'sushi rice', quantity: 1, unit: 'bag' },
      { name: 'hondashi', quantity: 1, unit: 'box' },
    ],
  },
  {
    id: '02-texting-shorthand',
    svg: {
      bg: '#f6f6f6',
      lines: [
        { text: '2 cs salmon' },
        { text: 'nori x3' },
        { text: 'masago 1 tub' },
        { text: 'hamachi 2' },
        { text: 'kewpie mayo 1 btl' },
      ],
    },
    truth: [
      { name: 'salmon', quantity: 2, unit: 'case' },
      { name: 'nori', quantity: 3, unit: null },
      { name: 'masago', quantity: 1, unit: 'tub' },
      { name: 'hamachi', quantity: 2, unit: null },
      { name: 'kewpie mayo', quantity: 1, unit: 'bottle' },
    ],
  },
  {
    id: '03-mixed-units',
    svg: {
      lines: [
        { text: 'Salmon 5 lb' },
        { text: 'Gyoza 3 pk' },
        { text: 'Rice 1 bag (50 lb)' },
        { text: 'Ebi shrimp 2 boxes' },
        { text: 'Unagi 10 pcs' },
      ],
    },
    truth: [
      { name: 'salmon', quantity: 5, unit: 'lb' },
      { name: 'gyoza', quantity: 3, unit: 'pack' },
      { name: 'rice', quantity: 1, unit: 'bag', note: '50 lb bag' },
      { name: 'ebi shrimp', quantity: 2, unit: 'box' },
      { name: 'unagi', quantity: 10, unit: 'piece' },
    ],
  },
  {
    id: '04-quantity-ranges',
    svg: {
      bg: '#fffef2',
      lines: [
        { text: 'salmon 2-3 cs' },
        { text: 'shrimp 5~6 lb' },
        { text: 'eel 1 or 2 boxes' },
        { text: 'crab stick x4' },
      ],
    },
    truth: [
      { name: 'salmon', quantity: 3, unit: 'case', note: 'range 2-3' },
      { name: 'shrimp', quantity: 6, unit: 'lb', note: 'range 5-6' },
      { name: 'eel', quantity: 2, unit: 'box', note: 'range 1-2' },
      { name: 'crab stick', quantity: 4, unit: null },
    ],
  },
  {
    id: '05-strikethrough-noise',
    svg: {
      lines: [
        { text: 'Today 9:41 AM', size: 18, color: '#8e8e93', x: 250 },
        { text: 'order for tomorrow:' },
        { text: 'salmon 2 cs' },
        { text: 'tuna 1 cs', strike: true, color: '#8e8e93' },
        { text: 'nori 3 packs' },
        { text: '(tuna cancelled)', size: 20, color: '#8e8e93' },
      ],
    },
    truth: [
      { name: 'salmon', quantity: 2, unit: 'case' },
      { name: 'nori', quantity: 3, unit: 'pack' },
    ],
  },
  {
    id: '06-mixed-en-cn',
    svg: {
      lines: [
        { text: '鲑鱼 2 箱' },
        { text: 'nori 海苔 3 pack' },
        { text: '金枪鱼 1 case' },
        { text: 'white tuna 白吞拿 2 lb' },
      ],
    },
    truth: [
      { name: '鲑鱼', quantity: 2, unit: 'case' },
      { name: 'nori', quantity: 3, unit: 'pack' },
      { name: '金枪鱼', quantity: 1, unit: 'case' },
      { name: 'white tuna', quantity: 2, unit: 'lb' },
    ],
  },
  {
    id: '07-messy-typos',
    svg: {
      bg: '#f2f7ff',
      lines: [
        { text: 'SAMON 2CS' },
        { text: 'yellow tail 1' },
        { text: 'MASSAGO 2 TUBS' },
        { text: 'kani x4' },
      ],
    },
    truth: [
      { name: 'samon', quantity: 2, unit: 'case' },
      { name: 'yellow tail', quantity: 1, unit: null },
      { name: 'massago', quantity: 2, unit: 'tub' },
      { name: 'kani', quantity: 4, unit: null },
    ],
  },
  {
    id: '08-chat-noise',
    svg: {
      lines: [
        { bubble: 'hey can u order for tmrw', side: 'right' },
        { bubble: 'sure what do u need', side: 'left' },
        { bubble: 'salmon 2cs, mayo 1 btl', side: 'right' },
        { bubble: 'also masago 1 tub thx', side: 'right' },
        { bubble: 'ok got it', side: 'left' },
      ],
    },
    truth: [
      { name: 'salmon', quantity: 2, unit: 'case' },
      { name: 'mayo', quantity: 1, unit: 'bottle' },
      { name: 'masago', quantity: 1, unit: 'tub' },
    ],
  },
];

for (const fixture of fixtures) {
  const svgPath = join(outDir, `${fixture.id}.svg`);
  const pngPath = join(outDir, `${fixture.id}.png`);
  writeFileSync(svgPath, renderSvg(fixture.svg));
  writeFileSync(join(outDir, `${fixture.id}.gt.json`), `${JSON.stringify({ items: fixture.truth }, null, 2)}\n`);
  try {
    if (existsSync(pngPath)) rmSync(pngPath);
    execFileSync('qlmanage', ['-t', '-s', '1280', '-o', outDir, svgPath], { stdio: 'pipe' });
    renameSync(join(outDir, `${fixture.id}.svg.png`), pngPath);
    console.log(`rendered ${fixture.id}.png`);
  } catch (error) {
    console.warn(`PNG render failed for ${fixture.id} (qlmanage missing?): ${error.message}`);
  }
}
console.log(`\n${fixtures.length} fixtures in ${outDir}`);
