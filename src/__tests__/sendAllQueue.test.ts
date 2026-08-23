import {
  createSendAllQueue,
  findNextPendingId,
  getSendAllQueueProgress,
  sendAllQueueReducer,
  type SendAllQueueState,
} from '../features/fulfillment/sendAll/sendAllQueue';

describe('createSendAllQueue', () => {
  test('starts on the first supplier with all cards pending', () => {
    const state = createSendAllQueue(['a', 'b', 'c']);
    expect(state.activeId).toBe('a');
    expect(state.order).toEqual(['a', 'b', 'c']);
    expect(state.statuses).toEqual({ a: 'pending', b: 'pending', c: 'pending' });
    expect(state.awaitingReturnId).toBeNull();
  });

  test('drops empty and duplicate ids', () => {
    const state = createSendAllQueue(['a', '', 'a', 'b']);
    expect(state.order).toEqual(['a', 'b']);
  });

  test('empty queue has no active card', () => {
    const state = createSendAllQueue([]);
    expect(state.activeId).toBeNull();
    expect(getSendAllQueueProgress(state).isComplete).toBe(true);
  });
});

describe('sendAllQueueReducer', () => {
  test('send-completed marks sent and advances to the next pending card', () => {
    let state = createSendAllQueue(['a', 'b', 'c']);
    state = sendAllQueueReducer(state, { type: 'send-completed', id: 'a' });
    expect(state.statuses.a).toBe('sent');
    expect(state.activeId).toBe('b');
  });

  test('skip marks skipped and advances', () => {
    let state = createSendAllQueue(['a', 'b']);
    state = sendAllQueueReducer(state, { type: 'skip', id: 'a' });
    expect(state.statuses.a).toBe('skipped');
    expect(state.activeId).toBe('b');
  });

  test('send-cancelled keeps the card active and pending', () => {
    let state = createSendAllQueue(['a', 'b']);
    state = sendAllQueueReducer(state, { type: 'send-launched', id: 'a', awaitReturn: true });
    expect(state.awaitingReturnId).toBe('a');
    state = sendAllQueueReducer(state, { type: 'send-cancelled', id: 'a' });
    expect(state.awaitingReturnId).toBeNull();
    expect(state.statuses.a).toBe('pending');
    expect(state.activeId).toBe('a');
  });

  test('completing the last pending card finishes the queue', () => {
    let state = createSendAllQueue(['a', 'b']);
    state = sendAllQueueReducer(state, { type: 'send-completed', id: 'a' });
    state = sendAllQueueReducer(state, { type: 'send-completed', id: 'b' });
    expect(state.activeId).toBeNull();
    const progress = getSendAllQueueProgress(state);
    expect(progress.isComplete).toBe(true);
    expect(progress.sent).toBe(2);
    expect(progress.pending).toBe(0);
  });

  test('skipping every card finishes the queue', () => {
    let state = createSendAllQueue(['a', 'b']);
    state = sendAllQueueReducer(state, { type: 'skip', id: 'a' });
    state = sendAllQueueReducer(state, { type: 'skip', id: 'b' });
    expect(state.activeId).toBeNull();
    expect(getSendAllQueueProgress(state).skipped).toBe(2);
  });

  test('advancement wraps around to earlier pending cards', () => {
    let state = createSendAllQueue(['a', 'b', 'c']);
    // Skip a, complete b — next pending should wrap past c? No: c is pending, so c.
    state = sendAllQueueReducer(state, { type: 'skip', id: 'a' });
    state = sendAllQueueReducer(state, { type: 'send-completed', id: 'b' });
    expect(state.activeId).toBe('c');

    // Now with c active, completing c ends the queue (a is skipped, not pending).
    state = sendAllQueueReducer(state, { type: 'send-completed', id: 'c' });
    expect(state.activeId).toBeNull();
  });

  test('advancement wraps to an earlier card that is still pending', () => {
    let state: SendAllQueueState = {
      order: ['a', 'b', 'c'],
      statuses: { a: 'pending', b: 'pending', c: 'pending' },
      activeId: 'c',
      awaitingReturnId: null,
    };
    state = sendAllQueueReducer(state, { type: 'send-completed', id: 'c' });
    expect(state.activeId).toBe('a');
  });

  test('send-completed for an already handled card is a no-op', () => {
    let state = createSendAllQueue(['a', 'b']);
    state = sendAllQueueReducer(state, { type: 'skip', id: 'a' });
    const next = sendAllQueueReducer(state, { type: 'send-completed', id: 'a' });
    expect(next).toBe(state);
  });

  test('events for unknown ids are ignored', () => {
    const state = createSendAllQueue(['a']);
    expect(sendAllQueueReducer(state, { type: 'send-completed', id: 'zz' })).toBe(state);
    expect(sendAllQueueReducer(state, { type: 'skip', id: 'zz' })).toBe(state);
    expect(sendAllQueueReducer(state, { type: 'send-launched', id: 'zz', awaitReturn: true })).toBe(
      state
    );
  });

  test('send-launched without awaitReturn clears any stale awaiting flag', () => {
    let state = createSendAllQueue(['a', 'b']);
    state = sendAllQueueReducer(state, { type: 'send-launched', id: 'a', awaitReturn: true });
    state = sendAllQueueReducer(state, { type: 'send-launched', id: 'a', awaitReturn: false });
    expect(state.awaitingReturnId).toBeNull();
  });
});

describe('findNextPendingId', () => {
  test('returns null when nothing is pending', () => {
    const state: SendAllQueueState = {
      order: ['a', 'b'],
      statuses: { a: 'sent', b: 'skipped' },
      activeId: null,
      awaitingReturnId: null,
    };
    expect(findNextPendingId(state, 'a')).toBeNull();
  });

  test('prefers the next card in order before wrapping', () => {
    const state: SendAllQueueState = {
      order: ['a', 'b', 'c'],
      statuses: { a: 'pending', b: 'pending', c: 'pending' },
      activeId: 'b',
      awaitingReturnId: null,
    };
    expect(findNextPendingId(state, 'b')).toBe('c');
  });
});

describe('getSendAllQueueProgress', () => {
  test('reports the 1-based active position', () => {
    let state = createSendAllQueue(['a', 'b', 'c']);
    expect(getSendAllQueueProgress(state).position).toBe(1);
    state = sendAllQueueReducer(state, { type: 'send-completed', id: 'a' });
    expect(getSendAllQueueProgress(state).position).toBe(2);
  });
});
