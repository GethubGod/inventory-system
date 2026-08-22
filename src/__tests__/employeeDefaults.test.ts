// Employee invite defaults parsing (the app_config JSON row folded over the
// built-in seed values).

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import {
  getBuiltInEmployeeDefaults,
  parseEmployeeDefaults,
} from '@/services/employeeDefaults';

describe('parseEmployeeDefaults', () => {
  it('mirrors the migration seed row in its built-ins', () => {
    expect(getBuiltInEmployeeDefaults()).toEqual({
      ordering_simple: true,
      ordering_advanced: false,
      stock_check: true,
      tips: false,
    });
  });

  it('folds stored booleans over the built-ins', () => {
    expect(
      parseEmployeeDefaults({ ordering_advanced: true, stock_check: false }),
    ).toEqual({
      ordering_simple: true,
      ordering_advanced: true,
      stock_check: false,
      tips: false,
    });
  });

  it('drops malformed entries and unknown keys', () => {
    expect(
      parseEmployeeDefaults({ ordering_simple: 'yes', fulfillment: true, junk: 1 }),
    ).toEqual(getBuiltInEmployeeDefaults());
  });

  it('returns the built-ins for a missing or non-object row', () => {
    expect(parseEmployeeDefaults(null)).toEqual(getBuiltInEmployeeDefaults());
    expect(parseEmployeeDefaults(['nope'])).toEqual(getBuiltInEmployeeDefaults());
    expect(parseEmployeeDefaults('x')).toEqual(getBuiltInEmployeeDefaults());
  });
});
