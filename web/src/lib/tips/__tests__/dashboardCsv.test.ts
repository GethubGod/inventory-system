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
    enteredById: "maria",
    enteredByName: "Maria",
    entryMethod: "voice",
    flagged: false,
    flaggedRaw: false,
    anomalyReason: null,
    createdAt: "2026-08-10T05:24:00Z",
    ...overrides,
  };
}

describe("buildLedgerCsv", () => {
  it("writes the mockup's exact header", () => {
    const csv = buildLedgerCsv([], (id) => LOCATION_LABELS[id]);
    expect(csv).toBe(
      "Business date,Restaurant,Meal,Cash (split pool),Card (logged only)," +
        "People on split,Names,Per-person share,Flagged,Entered by,Entry method",
    );
  });

  it("writes one row per record with the record's own year and cash-only share", () => {
    const csv = buildLedgerCsv([entry({})], (id) => LOCATION_LABELS[id]);
    const rows = csv.split("\n");
    expect(rows).toHaveLength(2);
    // 41200¢ / 3 = 13733.33¢ → $137.33 cash-only share.
    expect(rows[1]).toBe(
      'Sun Aug 9 2026,Sushi,Dinner,412.00,688.50,3,"Maria; Jose; Ken",137.33,no,Maria,voice',
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
