/**
 * Phase 3 — module access logic: role-default fallbacks, effective module
 * derivation, tab-list building, and the subscription-driven store that keeps
 * tab sets live when a manager flips a toggle.
 */

const mockGetMyModules = jest.fn();
const mockSubscribeToMyModules = jest.fn();

jest.mock('@/services/userModules', () => ({
  getMyModules: (...args: unknown[]) => mockGetMyModules(...args),
  subscribeToMyModules: (...args: unknown[]) => mockSubscribeToMyModules(...args),
}));

/* eslint-disable import/first -- Dependencies must be mocked before importing. */
import {
  getManageableModuleKeys,
  getRoleDefaultModules,
  getVisibleEmployeeTabs,
  getVisibleManagerTabs,
  resolveEffectiveModules,
} from '../store/moduleStore.helpers';
import { acquireModuleAccess, useModuleStore } from '../store/moduleStore';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('role default modules', () => {
  it('gives employees the ordering checklist and stock check by default', () => {
    expect(getRoleDefaultModules('employee')).toEqual({
      ordering_simple: true,
      ordering_advanced: false,
      stock_check: true,
      tips: false,
      fulfillment: false,
    });
  });

  it('gives managers everything by default', () => {
    expect(getRoleDefaultModules('manager')).toEqual({
      ordering_simple: true,
      ordering_advanced: true,
      stock_check: true,
      tips: true,
      fulfillment: true,
    });
  });

  it('treats an unresolved role like an employee (least privilege)', () => {
    expect(getRoleDefaultModules(null)).toEqual(getRoleDefaultModules('employee'));
  });
});

describe('resolveEffectiveModules', () => {
  it('returns pure role defaults when nothing was fetched (fetch failure fallback)', () => {
    expect(resolveEffectiveModules('employee', null)).toEqual(
      getRoleDefaultModules('employee'),
    );
  });

  it('overlays fetched states on top of role defaults', () => {
    const effective = resolveEffectiveModules('employee', [
      { key: 'ordering_advanced', enabled: true },
      { key: 'stock_check', enabled: false },
    ]);

    expect(effective).toEqual({
      ordering_simple: true,
      ordering_advanced: true,
      stock_check: false,
      tips: false,
      fulfillment: false,
    });
  });

  it('lets fetched states disable manager defaults', () => {
    const effective = resolveEffectiveModules('manager', [
      { key: 'fulfillment', enabled: false },
    ]);

    expect(effective.fulfillment).toBe(false);
    expect(effective.ordering_advanced).toBe(true);
  });
});

describe('employee tab list', () => {
  it('includes the Order tab for default employees (ordering_simple on by default)', () => {
    expect(getVisibleEmployeeTabs(getRoleDefaultModules('employee'))).toEqual([
      'index',
      'simple-order',
      'cart',
      'settings',
    ]);
  });

  it('drops the Order tab when ordering_simple is switched off', () => {
    const modules = { ...getRoleDefaultModules('employee'), ordering_simple: false };
    expect(getVisibleEmployeeTabs(modules)).toEqual([
      'index',
      'cart',
      'settings',
    ]);
  });

  it('adds the Advanced ordering tab when ordering_advanced is on', () => {
    const modules = {
      ...getRoleDefaultModules('employee'),
      ordering_simple: false,
      ordering_advanced: true,
    };
    expect(getVisibleEmployeeTabs(modules)).toEqual([
      'index',
      'quick-order',
      'cart',
      'settings',
    ]);
  });

  it('orders simple before advanced when both are on', () => {
    const modules = {
      ...getRoleDefaultModules('employee'),
      ordering_simple: true,
      ordering_advanced: true,
    };
    expect(getVisibleEmployeeTabs(modules)).toEqual([
      'index',
      'simple-order',
      'quick-order',
      'cart',
      'settings',
    ]);
  });

  it('never renders a tips tab yet, even when the module is enabled (Phase 4 ships the surface)', () => {
    const modules = { ...getRoleDefaultModules('employee'), tips: true };
    expect(getVisibleEmployeeTabs(modules)).not.toContain('tips');
  });
});

describe('manager tab list', () => {
  it('includes fulfillment for default managers', () => {
    expect(getVisibleManagerTabs(getRoleDefaultModules('manager'))).toEqual([
      'index',
      'quick-order',
      'fulfillment',
      'profile',
    ]);
  });

  it('drops the fulfillment tab when the module is off', () => {
    const modules = { ...getRoleDefaultModules('manager'), fulfillment: false };
    expect(getVisibleManagerTabs(modules)).toEqual([
      'index',
      'quick-order',
      'profile',
    ]);
  });

  it('drops the quick-order tab when ordering_advanced is off', () => {
    const modules = { ...getRoleDefaultModules('manager'), ordering_advanced: false };
    expect(getVisibleManagerTabs(modules)).toEqual([
      'index',
      'fulfillment',
      'profile',
    ]);
  });
});

describe('manageable module keys', () => {
  it('excludes the manager-side fulfillment module for employees', () => {
    expect(getManageableModuleKeys('employee')).toEqual([
      'ordering_simple',
      'ordering_advanced',
      'stock_check',
      'tips',
    ]);
  });

  it('exposes all five keys for managers', () => {
    expect(getManageableModuleKeys('manager')).toContain('fulfillment');
  });
});

describe('module store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useModuleStore.setState({ userId: null, fetched: null, status: 'idle' });
    mockSubscribeToMyModules.mockReturnValue(jest.fn());
  });

  it('loads the effective module set and marks the store ready', async () => {
    mockGetMyModules.mockResolvedValue([{ key: 'stock_check', enabled: true }]);

    await useModuleStore.getState().load('user-1');

    expect(useModuleStore.getState()).toMatchObject({
      userId: 'user-1',
      fetched: [{ key: 'stock_check', enabled: true }],
      status: 'ready',
    });
  });

  it('falls back to no data (role defaults downstream) when the fetch fails', async () => {
    mockGetMyModules.mockRejectedValue(new Error('network down'));

    await useModuleStore.getState().load('user-1');

    expect(useModuleStore.getState()).toMatchObject({
      userId: 'user-1',
      fetched: null,
      status: 'error',
    });
    // Downstream consumers resolve to role defaults so nobody is locked out.
    expect(resolveEffectiveModules('employee', null).stock_check).toBe(true);
  });

  it('keeps last-known data when a refresh for the same user fails', async () => {
    mockGetMyModules.mockResolvedValueOnce([{ key: 'tips', enabled: true }]);
    await useModuleStore.getState().load('user-1');

    mockGetMyModules.mockRejectedValueOnce(new Error('flaky'));
    await useModuleStore.getState().load('user-1');

    expect(useModuleStore.getState()).toMatchObject({
      fetched: [{ key: 'tips', enabled: true }],
      status: 'error',
    });
  });

  it('drops stale data when a different user loads', async () => {
    mockGetMyModules.mockResolvedValueOnce([{ key: 'tips', enabled: true }]);
    await useModuleStore.getState().load('user-1');

    let resolveSecond: (value: unknown) => void = () => {};
    mockGetMyModules.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve;
      }),
    );
    const secondLoad = useModuleStore.getState().load('user-2');

    // While in flight, the first user's data must not leak to the second.
    expect(useModuleStore.getState()).toMatchObject({
      userId: 'user-2',
      fetched: null,
      status: 'loading',
    });

    resolveSecond([{ key: 'fulfillment', enabled: false }]);
    await secondLoad;

    expect(useModuleStore.getState()).toMatchObject({
      fetched: [{ key: 'fulfillment', enabled: false }],
      status: 'ready',
    });
  });

  it('subscribes once, reloads on realtime changes, and tears down on last release', async () => {
    const unsubscribe = jest.fn();
    let realtimeCallback: () => void = () => {};
    mockSubscribeToMyModules.mockImplementation((onChange: () => void) => {
      realtimeCallback = onChange;
      return unsubscribe;
    });
    mockGetMyModules.mockResolvedValue([{ key: 'ordering_simple', enabled: true }]);

    const releaseA = acquireModuleAccess('user-1');
    const releaseB = acquireModuleAccess('user-1');
    await flushPromises();

    expect(mockSubscribeToMyModules).toHaveBeenCalledTimes(1);
    expect(mockGetMyModules).toHaveBeenCalledTimes(1);

    // A manager flips a toggle → realtime callback → reload (live tab flip).
    mockGetMyModules.mockResolvedValue([{ key: 'ordering_simple', enabled: false }]);
    realtimeCallback();
    await flushPromises();

    expect(mockGetMyModules).toHaveBeenCalledTimes(2);
    expect(useModuleStore.getState().fetched).toEqual([
      { key: 'ordering_simple', enabled: false },
    ]);

    releaseA();
    expect(unsubscribe).not.toHaveBeenCalled();

    releaseB();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(useModuleStore.getState()).toMatchObject({
      userId: null,
      fetched: null,
      status: 'idle',
    });
  });
});
