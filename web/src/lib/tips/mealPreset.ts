// Meal-period preset for the entry form: the time of day picks the shift
// (lunch until 4pm LA time, dinner after — today.defaultMeal, computed
// server-side), and a shift that is already recorded today is locked out so
// the same slot can never be entered twice from an entry device. Fixing a
// recorded slot is a manager-dashboard job.

import type { MealPeriod } from "@/types/database";
import type { TodayStatus } from "./api";

export interface MealPreset {
  /** The shift to pre-select, or null when both are already recorded. */
  meal: MealPeriod | null;
  /** Shifts that are recorded today and therefore un-selectable. */
  disabled: MealPeriod[];
  /** True when there is nothing left to enter today. */
  allRecorded: boolean;
}

export function mealPreset(today: TodayStatus): MealPreset {
  const disabled: MealPeriod[] = [];
  if (today.lunchRecorded) disabled.push("lunch");
  if (today.dinnerRecorded) disabled.push("dinner");

  const allRecorded = today.lunchRecorded && today.dinnerRecorded;
  const other: MealPeriod = today.defaultMeal === "lunch" ? "dinner" : "lunch";
  const meal = allRecorded
    ? null
    : disabled.includes(today.defaultMeal)
      ? other
      : today.defaultMeal;

  return { meal, disabled, allRecorded };
}
