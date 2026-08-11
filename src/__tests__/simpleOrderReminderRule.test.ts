import type { RecurringReminderRule } from '@/services/employeeReminders';
import {
  buildOrderDayReminderInput,
  defaultOrderDayReminderForm,
  findMyChecklistOrderDayRule,
  formatTimeLabel,
  mapRuleToOrderDayForm,
  shiftTime,
  summarizeDays,
  summarizeOrderDayRule,
  toggleDay,
} from '@/features/simpleOrder/orderDayReminder';

function makeRule(overrides: Partial<RecurringReminderRule> = {}): RecurringReminderRule {
  return {
    id: 'rule-1',
    scope: 'employee',
    employee_id: 'user-1',
    location_id: null,
    rule_kind: 'checklist_order_day',
    location_group: 'sushi',
    days_of_week: [1, 4],
    time_of_day: '10:00:00',
    timezone: 'America/Los_Angeles',
    condition_type: 'no_order_today',
    condition_value: null,
    quiet_hours_enabled: false,
    quiet_hours_start: null,
    quiet_hours_end: null,
    channels: { push: true, in_app: true },
    enabled: true,
    created_by: 'user-1',
    last_triggered_at: null,
    created_at: '2026-08-10T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
    ...overrides,
  };
}

describe('findMyChecklistOrderDayRule', () => {
  it('finds the checklist rule for the requested location group', () => {
    const standard = makeRule({ id: 'std', rule_kind: 'standard', location_group: null });
    const poki = makeRule({ id: 'poki', location_group: 'poki' });
    const sushi = makeRule({ id: 'sushi', location_group: 'sushi' });

    expect(findMyChecklistOrderDayRule([standard, poki, sushi], 'sushi')?.id).toBe('sushi');
    expect(findMyChecklistOrderDayRule([standard, poki, sushi], 'poki')?.id).toBe('poki');
  });

  it('returns null when no checklist rule exists', () => {
    const standard = makeRule({ rule_kind: 'standard', location_group: null });
    expect(findMyChecklistOrderDayRule([standard], 'sushi')).toBeNull();
  });
});

describe('mapRuleToOrderDayForm', () => {
  it('normalizes db values into form state', () => {
    const form = mapRuleToOrderDayForm(
      makeRule({ days_of_week: [4, 1, 1], time_of_day: '15:30:00', enabled: false }),
    );
    expect(form).toEqual({ daysOfWeek: [1, 4], timeOfDay: '15:30', enabled: false });
  });

  it('falls back to a sane time when the stored value is broken', () => {
    const form = mapRuleToOrderDayForm(makeRule({ time_of_day: 'garbage' }));
    expect(form.timeOfDay).toBe('10:00');
  });
});

describe('toggleDay', () => {
  it('adds and removes days keeping sorted unique output', () => {
    expect(toggleDay([1, 4], 2)).toEqual([1, 2, 4]);
    expect(toggleDay([1, 2, 4], 2)).toEqual([1, 4]);
  });

  it('ignores out-of-range days', () => {
    expect(toggleDay([1], 7)).toEqual([1]);
    expect(toggleDay([1], -1)).toEqual([1]);
  });
});

describe('shiftTime', () => {
  it('steps forward and backward by minutes', () => {
    expect(shiftTime('10:00', 30)).toBe('10:30');
    expect(shiftTime('10:00', -30)).toBe('09:30');
  });

  it('wraps across midnight in both directions', () => {
    expect(shiftTime('23:30', 30)).toBe('00:00');
    expect(shiftTime('00:00', -30)).toBe('23:30');
  });
});

describe('formatTimeLabel / summarizeDays / summarizeOrderDayRule', () => {
  it('formats 24h times as 12h labels', () => {
    expect(formatTimeLabel('00:00')).toBe('12:00 AM');
    expect(formatTimeLabel('10:30')).toBe('10:30 AM');
    expect(formatTimeLabel('12:00')).toBe('12:00 PM');
    expect(formatTimeLabel('15:30')).toBe('3:30 PM');
  });

  it('summarizes day selections', () => {
    expect(summarizeDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(summarizeDays([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(summarizeDays([1, 4])).toBe('Mon, Thu');
    expect(summarizeDays([])).toBe('No days');
  });

  it('summarizes a rule with seconds-bearing db time', () => {
    expect(summarizeOrderDayRule(makeRule({ days_of_week: [1, 4], time_of_day: '10:00:00' }))).toBe(
      'Mon, Thu at 10:00 AM',
    );
  });
});

describe('buildOrderDayReminderInput', () => {
  it('produces the service payload for a new rule', () => {
    const { input, error } = buildOrderDayReminderInput(
      { daysOfWeek: [4, 1], timeOfDay: '10:30', enabled: true },
      'sushi',
      null,
    );
    expect(error).toBeNull();
    expect(input).toMatchObject({
      locationGroup: 'sushi',
      daysOfWeek: [1, 4],
      timeOfDay: '10:30',
      channels: { push: true, in_app: true },
      enabled: true,
    });
    expect(input && 'id' in input).toBe(false);
    expect(typeof input?.timezone).toBe('string');
    expect(input?.timezone.length).toBeGreaterThan(0);
  });

  it('carries the existing rule id through for edits', () => {
    const { input } = buildOrderDayReminderInput(
      defaultOrderDayReminderForm(),
      'poki',
      'rule-9',
    );
    expect(input?.id).toBe('rule-9');
    expect(input?.locationGroup).toBe('poki');
  });

  it('rejects an empty day selection', () => {
    const { input, error } = buildOrderDayReminderInput(
      { daysOfWeek: [], timeOfDay: '10:00', enabled: true },
      'sushi',
    );
    expect(input).toBeNull();
    expect(error).toMatch(/at least one day/i);
  });

  it('rejects an invalid time', () => {
    const { input, error } = buildOrderDayReminderInput(
      { daysOfWeek: [1], timeOfDay: '25:99', enabled: true },
      'sushi',
    );
    expect(input).toBeNull();
    expect(error).toMatch(/valid reminder time/i);
  });

  it('drops out-of-range days before validating', () => {
    const { input } = buildOrderDayReminderInput(
      { daysOfWeek: [1, 9, -2, 1], timeOfDay: '9:05', enabled: false },
      'sushi',
    );
    expect(input?.daysOfWeek).toEqual([1]);
    expect(input?.timeOfDay).toBe('09:05');
    expect(input?.enabled).toBe(false);
  });
});
