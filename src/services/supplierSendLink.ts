import { Platform } from 'react-native';

import type { SupplierContactChannel } from './supplierContacts';

export interface SendTarget {
  channel: SupplierContactChannel;
  phone: string | null;
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) {
    return null;
  }

  const compactPhone = phone.trim().replace(/[\s()-]/g, '');
  const hasLeadingPlus = compactPhone.startsWith('+');
  const digits = compactPhone.replace(/\D/g, '');

  if (!digits) {
    return null;
  }

  return `${hasLeadingPlus ? '+' : ''}${digits}`;
}

/** Returns null when channel is share_sheet or phone missing → caller falls back to share sheet. */
export function buildSupplierSendUrl(target: SendTarget, body: string): string | null {
  const phone = normalizePhone(target.phone);

  if (target.channel === 'share_sheet' || !phone) {
    return null;
  }

  const encodedBody = encodeURIComponent(body);

  if (target.channel === 'whatsapp') {
    return `whatsapp://send?phone=${phone.replace(/\D/g, '')}&text=${encodedBody}`;
  }

  const bodySeparator = Platform.OS === 'ios' ? '&body=' : '?body=';
  return `sms:${phone}${bodySeparator}${encodedBody}`;
}
