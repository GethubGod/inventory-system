import { describe, expect, it } from "vitest";
import {
  ANOMALY_MIN_HISTORY,
  anomalyMessage,
  checkAnomaly,
  type AnomalyResult,
} from "../anomaly";

/** 20 entries: cash 100, 105, ... 195 (median 150, max 195); card constant 300. */
function typicalHistory(): Array<{ cash: number; card: number }> {
  return Array.from({ length: 20 }, (_, i) => ({
    cash: 100 + i * 5,
    card: 300,
  }));
}

function zeroHistory(): Array<{ cash: number; card: number }> {
  return Array.from({ length: 20 }, () => ({ cash: 0, card: 0 }));
}

describe("checkAnomaly", () => {
  it("never flags with fewer than 14 history entries, even for $1M", () => {
    const history = Array.from({ length: ANOMALY_MIN_HISTORY - 1 }, () => ({
      cash: 150,
      card: 300,
    }));
    const result = checkAnomaly(history, 1_000_000, 1_000_000);
    expect(result.flagged).toBe(false);
    expect(result.fields).toEqual([]);
    expect(result.sampleSize).toBe(13);
  });

  it("flags cash far beyond both max-ever and 3x median", () => {
    // median 150 -> threshold 450; max 195. 700 exceeds both.
    const result = checkAnomaly(typicalHistory(), 700, 300);
    expect(result.flagged).toBe(true);
    expect(result.fields.map((f) => f.field)).toEqual(["cash"]);
  });

  it("does not flag a value above max-ever but within 3x median", () => {
    // 300 > max 195 but <= 3 * 150 = 450.
    const result = checkAnomaly(typicalHistory(), 300, 300);
    expect(result.flagged).toBe(false);
    expect(result.fields).toEqual([]);
  });

  it("does not flag a value inside the historical range", () => {
    const result = checkAnomaly(typicalHistory(), 190, 300);
    expect(result.flagged).toBe(false);
  });

  it("checks card independently of cash; only the offending field is listed", () => {
    // card median/max are 300 -> threshold max(3*300, ...) needs > 900 AND > 300.
    const result = checkAnomaly(typicalHistory(), 700, 1000);
    expect(result.flagged).toBe(true);
    expect(result.fields.map((f) => f.field)).toEqual(["cash", "card"]);

    const cardOnly = checkAnomaly(typicalHistory(), 150, 1000);
    expect(cardOnly.flagged).toBe(true);
    expect(cardOnly.fields.map((f) => f.field)).toEqual(["card"]);
  });

  it("uses the max(maxEver, 50) fallback when the median is 0", () => {
    // All-zero history: median 0, maxEver 0 -> flag only when value > 50.
    const notFlagged = checkAnomaly(zeroHistory(), 40, 0);
    expect(notFlagged.flagged).toBe(false);

    const flagged = checkAnomaly(zeroHistory(), 60, 0);
    expect(flagged.flagged).toBe(true);
    expect(flagged.fields.map((f) => f.field)).toEqual(["cash"]);
  });

  it("reports rounded typicalLow/typicalHigh within the data range and correct sampleSize", () => {
    const history = typicalHistory();
    const result = checkAnomaly(history, 700, 300);
    expect(result.sampleSize).toBe(20);
    const flag = result.fields[0];
    expect(flag.value).toBe(700);
    expect(flag.maxEver).toBe(195);
    expect(Number.isInteger(flag.typicalLow)).toBe(true);
    expect(Number.isInteger(flag.typicalHigh)).toBe(true);
    expect(flag.typicalLow).toBeGreaterThanOrEqual(100);
    expect(flag.typicalHigh).toBeLessThanOrEqual(195);
    expect(flag.typicalLow).toBeLessThanOrEqual(flag.typicalHigh);
    // Nearest-rank: p25 = values[round(0.25 * 19)] = values[5] = 125,
    // p75 = values[round(0.75 * 19)] = values[14] = 170.
    expect(flag.typicalLow).toBe(125);
    expect(flag.typicalHigh).toBe(170);
  });
});

describe("anomalyMessage", () => {
  it("renders the documented sentence with grouped dollars and an en-dash range", () => {
    const result: AnomalyResult = {
      flagged: true,
      sampleSize: 20,
      fields: [
        {
          field: "cash",
          value: 3000,
          typicalLow: 150,
          typicalHigh: 350,
          maxEver: 400,
        },
      ],
    };
    const message = anomalyMessage(result, "Sushi", "dinner");
    expect(message).toBe(
      "Cash tips of $3,000 is far above the usual $150–$350 for Sushi dinner.",
    );
    expect(message).toContain("$3,000");
    expect(message).toContain("$150–$350");
    expect(message).toContain("Sushi dinner");
  });

  it("joins one sentence per flagged field", () => {
    const result: AnomalyResult = {
      flagged: true,
      sampleSize: 20,
      fields: [
        { field: "cash", value: 900, typicalLow: 100, typicalHigh: 200, maxEver: 250 },
        { field: "card", value: 5000, typicalLow: 250, typicalHigh: 450, maxEver: 500 },
      ],
    };
    const message = anomalyMessage(result, "Poki & Pho", "lunch");
    expect(message).toContain("Cash tips of $900");
    expect(message).toContain("Card tips of $5,000");
    expect(message.match(/for Poki & Pho lunch\./g)).toHaveLength(2);
  });
});
