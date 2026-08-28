import { describe, expect, it } from "vitest";
import { mealPreset } from "../mealPreset";
import type { TodayStatus } from "../api";

function today(partial: Partial<TodayStatus>): TodayStatus {
  return {
    businessDate: "2026-08-11",
    lunchRecorded: false,
    dinnerRecorded: false,
    defaultMeal: "lunch",
    lunch: null,
    ...partial,
  };
}

describe("mealPreset", () => {
  it("follows the time-of-day default when nothing is recorded", () => {
    expect(mealPreset(today({ defaultMeal: "lunch" }))).toEqual({
      meal: "lunch",
      disabled: [],
      allRecorded: false,
    });
    expect(mealPreset(today({ defaultMeal: "dinner" }))).toEqual({
      meal: "dinner",
      disabled: [],
      allRecorded: false,
    });
  });

  it("locks a recorded shift and presets the remaining one", () => {
    // Lunch already entered, user opens the app at 5pm: dinner only.
    expect(
      mealPreset(today({ lunchRecorded: true, defaultMeal: "dinner" })),
    ).toEqual({ meal: "dinner", disabled: ["lunch"], allRecorded: false });
  });

  it("falls to the other shift when the time default is already recorded", () => {
    // Still lunchtime but lunch is recorded: preset dinner, not lunch.
    expect(
      mealPreset(today({ lunchRecorded: true, defaultMeal: "lunch" })),
    ).toEqual({ meal: "dinner", disabled: ["lunch"], allRecorded: false });
    // Late-night dinner recorded: the remaining slot is lunch.
    expect(
      mealPreset(today({ dinnerRecorded: true, defaultMeal: "dinner" })),
    ).toEqual({ meal: "lunch", disabled: ["dinner"], allRecorded: false });
  });

  it("reports all-recorded with nothing selectable", () => {
    expect(
      mealPreset(
        today({ lunchRecorded: true, dinnerRecorded: true, defaultMeal: "dinner" }),
      ),
    ).toEqual({
      meal: null,
      disabled: ["lunch", "dinner"],
      allRecorded: true,
    });
  });
});
