import type {
  ChecklistOrderDayReminderRuleInput,
  RecurringReminderRule,
} from '@/services/employeeReminders';

/**
 * Pure form-state helpers for the employee's checklist order-day reminder
 * (Phase 5c). The sheet component keeps a small OrderDayReminderFormState and
 * uses these helpers to convert to/from the recurring-rule service payloads,
 * so the mapping logic stays unit-testable without React Native.
 */

export interface OrderDayReminderFormState {
  daysOfWeek: number[];
  /** 24h "HH:MM" */
  timeOfDay: string;
  enabled: boolean;
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const REMINDER_TIME_STEP_MINUTES = 30;

export function timeZoneDefault(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
  } catch {
    return 'America/Los_Angeles';
  }
}

export function defaultOrderDayReminderForm(): OrderDayReminderFormState {
  return {
    daysOfWeek: [1, 4], // Mon + Thu — common fish-order cadence starting point
    timeOfDay: '10:00',
    enabled: true,
  };
}

/** Finds the signed-in employee's checklist order-day rule for a location group.
 * RLS already limits visible checklist rules to the caller's own. */
export function findMyChecklistOrderDayRule(
  rules: RecurringReminderRule[],
  locationGroup: 'sushi' | 'poki',
): RecurringReminderRule | null {
  return (
    rules.find(
      (rule) =>
        rule.rule_kind === 'checklist_order_day' &&
        rule.location_group === locationGroup,
    ) ?? null
  );
}

export function mapRuleToOrderDayForm(
  rule: RecurringReminderRule,
): OrderDayReminderFormState {
  return {
    daysOfWeek: normalizeDays(Array.isArray(rule.days_of_week) ? rule.days_of_week : []),
    timeOfDay: normalizeTime(rule.time_of_day) ?? '10:00',
    enabled: rule.enabled !== false,
  };
}

export function toggleDay(days: number[], day: number): number[] {
  if (!Number.isInteger(day) || day < 0 || day > 6) return normalizeDays(days);
  const set = new Set(normalizeDays(days));
  if (set.has(day)) {
    set.delete(day);
  } else {
    set.add(day);
  }
  return [...set].sort((left, right) => left - right);
}

/** Shifts an "HH:MM" time by deltaMinutes, wrapping across midnight. */
export function shiftTime(time: string, deltaMinutes: number): string {
  const normalized = normalizeTime(time) ?? '10:00';
  const [hours, minutes] = normalized.split(':').map(Number);
  const total = (((hours * 60 + minutes + deltaMinutes) % 1440) + 1440) % 1440;
  const outHours = Math.floor(total / 60);
  const outMinutes = total % 60;
  return `${String(outHours).padStart(2, '0')}:${String(outMinutes).padStart(2, '0')}`;
}

/** "15:30" -> "3:30 PM" */
export function formatTimeLabel(time: string): string {
  const normalized = normalizeTime(time);
  if (!normalized) return time;
  const [hours, minutes] = normalized.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function summarizeDays(days: number[]): string {
  const normalized = normalizeDays(days);
  if (normalized.length === 7) return 'Every day';
  if (normalized.length === 0) return 'No days';
  const weekdays = [1, 2, 3, 4, 5];
  if (
    normalized.length === 5 &&
    weekdays.every((day) => normalized.includes(day))
  ) {
    return 'Weekdays';
  }
  return normalized.map((day) => WEEKDAY_LABELS[day]).join(', ');
}

/** Short human summary of an existing rule, e.g. "Mon, Thu at 10:00 AM". */
export function summarizeOrderDayRule(rule: RecurringReminderRule): string {
  const days = summarizeDays(Array.isArray(rule.days_of_week) ? rule.days_of_week : []);
  const time = formatTimeLabel(normalizeTime(rule.time_of_day) ?? '10:00');
  return `${days} at ${time}`;
}

export interface OrderDayReminderBuildResult {
  input: ChecklistOrderDayReminderRuleInput | null;
  error: string | null;
}

/**
 * Converts sheet form state into the service payload for
 * upsertMyChecklistOrderDayReminderRule. Returns an error message instead of
 * a payload when the form cannot be saved.
 */
export function buildOrderDayReminderInput(
  form: OrderDayReminderFormState,
  locationGroup: 'sushi' | 'poki',
  existingRuleId?: string | null,
): OrderDayReminderBuildResult {
  const daysOfWeek = normalizeDays(form.daysOfWeek);
  if (daysOfWeek.length === 0) {
    return { input: null, error: 'Pick at least one day to be reminded.' };
  }

  const timeOfDay = normalizeTime(form.timeOfDay);
  if (!timeOfDay) {
    return { input: null, error: 'Pick a valid reminder time.' };
  }

  return {
    input: {
      ...(existingRuleId ? { id: existingRuleId } : {}),
      locationGroup,
      daysOfWeek,
      timeOfDay,
      timezone: timeZoneDefault(),
      channels: { push: true, in_app: true },
      enabled: form.enabled,
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Internal normalizers
// ---------------------------------------------------------------------------

function normalizeDays(days: number[]): number[] {
  return [...new Set(days.map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((left, right) => left - right);
}

function normalizeTime(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
