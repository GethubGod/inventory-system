import type {
  ChecklistSendLine,
  DirectSendGroup,
} from '@/services/orderChecklist';
import type { SupplierContactChannel } from '@/services/supplierContacts';
import { getCheckedLines, type SelectionState } from './checklistSelection';

/**
 * Pure helpers for the Phase 5b direct-send card queue. The queue mechanics
 * themselves are the Phase 1 Send All reducer
 * (src/features/fulfillment/sendAll/sendAllQueue.ts) — these helpers adapt
 * checklist selection state and DirectSendGroups to that reducer's string-id
 * world. No React/React Native imports; unit-tested in
 * src/__tests__/simpleOrderDirectSend.test.ts.
 */

export const UNASSIGNED_GROUP_KEY = 'unassigned';

/** Stable queue id for a direct-send group (supplier id, or the Unassigned bucket). */
export function directSendGroupKey(
  group: Pick<DirectSendGroup, 'supplierId'>,
): string {
  return group.supplierId ?? UNASSIGNED_GROUP_KEY;
}

/**
 * Channel used for a direct-send card. Mirrors SendAllScreen: a configured
 * sms/whatsapp channel only counts when a phone number exists; everything
 * else (including the contactless Unassigned card) uses the share sheet.
 */
export function channelForGroup(
  group: Pick<DirectSendGroup, 'contact'>,
): SupplierContactChannel {
  const contact = group.contact;
  if (
    contact?.contactPhone &&
    (contact.contactChannel === 'sms' || contact.contactChannel === 'whatsapp')
  ) {
    return contact.contactChannel;
  }
  return 'share_sheet';
}

export interface BuiltDirectSendLines {
  lines: ChecklistSendLine[];
}

/**
 * Direct mode sends every checked line — including ones that never matched
 * inventory (they land on the share-sheet-only Unassigned card). This differs
 * from review mode's buildSendLines, which must drop unmatched lines because
 * submit_order_rpc requires inventory ids.
 */
export function buildDirectSendLines(state: SelectionState): BuiltDirectSendLines {
  const lines: ChecklistSendLine[] = [];
  for (const line of getCheckedLines(state)) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    lines.push({
      itemId: line.itemId,
      itemName: line.itemName,
      unit: line.unit,
      quantity: line.quantity,
    });
  }
  return { lines };
}

/** Orders groups for the queue: contactable suppliers first, Unassigned last. */
export function orderGroupsForQueue(groups: DirectSendGroup[]): DirectSendGroup[] {
  return [...groups].sort((left, right) => {
    const leftUnassigned = left.supplierId === null ? 1 : 0;
    const rightUnassigned = right.supplierId === null ? 1 : 0;
    if (leftUnassigned !== rightUnassigned) return leftUnassigned - rightUnassigned;
    return left.supplierName.localeCompare(right.supplierName);
  });
}
