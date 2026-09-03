import { describe, expect, it } from "vitest";

import { buildLedgerCsv } from "../dashboardCsv";
import type { LedgerEntry } from "../dashboardDerive";

const LOCATION_LABELS: Record<string, string> = {
  "loc-sushi": "Sushi",
  "loc-poki": "Poki & Pho",
};

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: "e1",
    businessDate: "2026-08-09",
    locationId: "loc-sushi",
    meal: "dinner",
    cashCents: 41200,
    cardCents: 68850,
    splitCount: 3,
    peopleIds: ["maria", "jose", "ken"],
    peopleNames: ["Maria", "Jose", "Ken"],
    weights: [1, 1, 1],
    gratuityCents: 0,
    enteredScope: "shift",
    rawCashCents: null,
    rawCardCents: null,
    rawGratuityCents: null,
    note: null,
    noteAt: null,
    enteredById: "maria",
    enteredByName: "Maria",
    entryMethod: "voice",
    flagged: false,
    flaggedRaw: false,
    flagVerifiedAt: null,
    anomalyReason: null,
    createdAt: "2026-08-10T05:24:00Z",
    ...overrides,
  };
}

describe("buildLedgerCsv", () => {
  it("keeps the existing columns in place and appends the v3 columns", () => {
    const csv = buildLedgerCsv([], (id) => LOCATION_LABELS[id]);
    expect(csv).toBe(
      "Business date,Restaurant,Meal,Cash (split pool),Card (logged only)," +
        "People on split,Names,Per-person share,Flagged,Entered by,Entry method," +
        "Gratuity,Entered scope,Raw cash,Raw card,Note,Weights",
    );
  });

  it("writes one row per record with the record's own year and cash-only share", () => {
    const csv = buildLedgerCsv([entry({})], (id) => LOCATION_LABELS[id]);
    const rows = csv.split("\n");
    expect(rows).toHaveLength(2);
    // 41200¢ / 3 = 13733.33¢ → $137.33 cash-only share. Pre-v3 row: zero
    // gratuity, shift scope, no raw figures, no note, all-full weights.
    expect(rows[1]).toBe(
      'Sun Aug 9 2026,Sushi,Dinner,412.00,688.50,3,"Maria; Jose; Ken",137.33,no,Maria,voice,' +
        '0.00,shift,,,,"100; 100; 100"',
    );
  });

  it("exports gratuity, day scope, raw figures, note, and weights", () => {
    const csv = buildLedgerCsv(
      [
        entry({
          cashCents: 20500,
          cardCents: 63500,
          gratuityCents: 21600,
          enteredScope: "day",
          rawCashCents: 32300,
          rawCardCents: 77700,
          rawGratuityCents: 21600,
          note: 'Drawer $20 short, Marco said "recounted"',
          weights: [1, 1, 0.5],
        }),
      ],
      (id) => LOCATION_LABELS[id],
    );
    const row = csv.split("\n")[1];
    // Full share = round(20500 / 2.5) = 8200¢ → $82.00.
    expect(row).toBe(
      'Sun Aug 9 2026,Sushi,Dinner,205.00,635.00,3,"Maria; Jose; Ken",82.00,no,Maria,voice,' +
        '216.00,day,323.00,777.00,"Drawer $20 short, Marco said ""recounted""","100; 100; 50"',
    );
  });

  it("always quotes Names and escapes embedded quotes", () => {
    const csv = buildLedgerCsv(
      [
        entry({
          peopleIds: ["a"],
          peopleNames: ['Maria "Mo" Lopez'],
          splitCount: 1,
          enteredByName: 'Maria "Mo" Lopez',
        }),
      ],
      (id) => LOCATION_LABELS[id],
    );
    const row = csv.split("\n")[1];
    expect(row).toContain('"Maria ""Mo"" Lopez"');
  });

  it("quotes free-text fields containing commas", () => {
    const csv = buildLedgerCsv(
      [entry({ locationId: "loc-poki", enteredByName: "Lena, Jr." })],
      (id) => LOCATION_LABELS[id],
    );
    const row = csv.split("\n")[1];
    expect(row).toContain(",Poki & Pho,"); // no comma in the name — stays unquoted
    expect(row).toContain('"Lena, Jr."');
  });

  it("Flagged reflects the stored anomaly flag even after verification", () => {
    const csv = buildLedgerCsv(
      [entry({ flaggedRaw: true, flagged: false })],
      (id) => LOCATION_LABELS[id],
    );
    expect(csv.split("\n")[1].split(",")).toContain("yes");
  });

  it("neutralizes spreadsheet formula injection in free-text fields", () => {
    const csv = buildLedgerCsv(
      [
        entry({
          peopleIds: ["a"],
          peopleNames: ["=HYPERLINK(\"https://evil.example\",\"x\")"],
          splitCount: 1,
          enteredByName: "+1-555-0100",
        }),
      ],
      (id) => LOCATION_LABELS[id],
    );
    const row = csv.split("\n")[1];
    // A leading ' makes Excel/Sheets treat the cell as text, not a formula.
    expect(row).toContain("'=HYPERLINK");
    expect(row).toContain("'+1-555-0100");
    expect(row).not.toContain(',=HYPERLINK');
  });
});
