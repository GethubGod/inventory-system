const mockAuthGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: mockAuthGetUser },
    from: mockFrom,
    functions: { invoke: jest.fn() },
  },
}));

jest.mock('../lib/api/client', () => ({
  listEmployeesWithStatus: jest.fn(),
}));

import { upsertMyChecklistOrderDayReminderRule } from '../services/employeeReminders';

function upsertQuery(result: { data: unknown; error: unknown }) {
  const query: any = {
    upsert: jest.fn(),
    select: jest.fn(),
    single: jest.fn(),
  };
  query.upsert.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.single.mockResolvedValue(result);
  return query;
}

describe('checklist order-day reminder service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'employee-1' } }, error: null });
  });

  it('pins a self-service rule to the signed-in employee and checklist-only context', async () => {
    const savedRule = { id: 'rule-1', rule_kind: 'checklist_order_day', location_group: 'sushi' };
    const query = upsertQuery({ data: savedRule, error: null });
    mockFrom.mockReturnValue(query);

    await expect(
      upsertMyChecklistOrderDayReminderRule({
        id: 'rule-1',
        locationGroup: 'sushi',
        daysOfWeek: [5, 1, 1],
        timeOfDay: '09:30',
        timezone: 'America/Los_Angeles',
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        channels: { push: true, in_app: false },
        enabled: false,
      })
    ).resolves.toEqual(savedRule);

    expect(mockFrom).toHaveBeenCalledWith('recurring_reminder_rules');
    expect(query.upsert).toHaveBeenCalledWith({
      id: 'rule-1',
      scope: 'employee',
      employee_id: 'employee-1',
      location_id: null,
      rule_kind: 'checklist_order_day',
      location_group: 'sushi',
      days_of_week: [1, 5],
      time_of_day: '09:30',
      timezone: 'America/Los_Angeles',
      condition_type: 'no_order_today',
      condition_value: null,
      quiet_hours_enabled: true,
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      channels: { push: true, in_app: false },
      enabled: false,
      created_by: 'employee-1',
    });
  });

  it('requires at least one weekday before writing a rule', async () => {
    await expect(
      upsertMyChecklistOrderDayReminderRule({
        locationGroup: 'poki',
        daysOfWeek: [],
        timeOfDay: '09:30',
        timezone: 'America/Los_Angeles',
      })
    ).rejects.toThrow('Choose at least one day');

    expect(mockFrom).not.toHaveBeenCalled();
  });
});
