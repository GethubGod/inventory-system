// PHASE1-STUB: replaced by backend implementation at merge
// Contract: docs/phases/phase1-contract.md — do not change these signatures.
import { Platform } from 'react-native';
import type { SupplierContactChannel } from '@/services/supplierContacts';

export interface SendTarget {
  channel: SupplierContactChannel;
  phone: string | null;
}

/** Strip spaces/dashes/parens; keep a leading `+`. Returns null when nothing usable remains. */
function normalizePhone(raw: string | null): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (digits.length === 0) return null;
  return hasPlus ? `+${digits}` : digits;
}

/** Returns null when channel is share_sheet or phone missing → caller falls back to share sheet. */
export function buildSupplierSendUrl(target: SendTarget, body: string): string | null {
  if (target.channel === 'share_sheet') return null;

  const phone = normalizePhone(target.phone);
  if (!phone) return null;

  const encodedBody = encodeURIComponent(body);

  if (target.channel === 'whatsapp') {
    return `whatsapp://send?phone=${phone.replace(/^\+/, '')}&text=${encodedBody}`;
  }

  // sms: iOS wants `&body=`, Android wants `?body=`.
  const separator = Platform.OS === 'ios' ? '&' : '?';
  return `sms:${phone}${separator}body=${encodedBody}`;
}
