import {
  buildChecklistOrderDayMessage,
  isExpoDeviceNotRegistered,
} from './reminderDelivery.ts';

Deno.test('buildChecklistOrderDayMessage includes the server-computed unchecked count', () => {
  const message = buildChecklistOrderDayMessage('sushi', 3);
  if (message !== 'Fish order due today — 3 items unchecked') {
    throw new Error(`Unexpected checklist reminder message: ${message}`);
  }
});

Deno.test('buildChecklistOrderDayMessage falls back to a generic message without a checklist', () => {
  const message = buildChecklistOrderDayMessage('poki', null);
  if (message !== 'Poki order due today') {
    throw new Error(`Unexpected generic checklist reminder message: ${message}`);
  }
});

Deno.test('isExpoDeviceNotRegistered recognizes ticket and receipt errors', () => {
  const ticketError = { details: { error: 'DeviceNotRegistered' } };
  const receiptError = { error: 'DeviceNotRegistered' };

  if (!isExpoDeviceNotRegistered(ticketError) || !isExpoDeviceNotRegistered(receiptError)) {
    throw new Error('Expected DeviceNotRegistered errors to be recognized.');
  }
  if (isExpoDeviceNotRegistered({ details: { error: 'MessageTooBig' } })) {
    throw new Error('Expected unrelated Expo errors not to be treated as token invalidation.');
  }
});
