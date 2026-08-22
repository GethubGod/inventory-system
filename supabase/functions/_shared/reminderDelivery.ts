export type ChecklistLocationGroup = 'sushi' | 'poki';

export interface ChecklistReminderMessage {
  body: string;
  uncheckedDefaultItemCount: number | null;
  checklistFound: boolean;
}

export function buildChecklistOrderDayMessage(
  locationGroup: ChecklistLocationGroup,
  uncheckedDefaultItemCount: number | null
): string {
  // “Fish” is the employee-facing name for the sushi ordering group.
  const orderLabel = locationGroup === 'sushi' ? 'Fish' : 'Poki';
  const genericMessage = `${orderLabel} order due today`;

  if (uncheckedDefaultItemCount == null) {
    return genericMessage;
  }

  return `${genericMessage} — ${uncheckedDefaultItemCount} items unchecked`;
}

export function isExpoDeviceNotRegistered(value: any): boolean {
  return value?.details?.error === 'DeviceNotRegistered' || value?.error === 'DeviceNotRegistered';
}
