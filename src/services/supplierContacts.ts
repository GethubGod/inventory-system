// PHASE1-STUB: replaced by backend implementation at merge
// Contract: docs/phases/phase1-contract.md — do not change these signatures.
import { supabase } from '@/lib/supabase';

export type SupplierContactChannel = 'sms' | 'whatsapp' | 'share_sheet';

export interface SupplierContact {
  supplierId: string;
  supplierName: string;
  contactPhone: string | null;
  contactChannel: SupplierContactChannel;
  contactName: string | null;
  contactNotes: string | null;
}

function toChannel(value: unknown): SupplierContactChannel {
  return value === 'sms' || value === 'whatsapp' ? value : 'share_sheet';
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapRow(row: Record<string, unknown>): SupplierContact {
  return {
    supplierId: String(row.id ?? ''),
    supplierName: toNullableString(row.name) ?? 'Unknown Supplier',
    contactPhone: toNullableString(row.contact_phone),
    contactChannel: toChannel(row.contact_channel),
    contactName: toNullableString(row.contact_name),
    contactNotes: toNullableString(row.contact_notes),
  };
}

export async function listSupplierContacts(): Promise<SupplierContact[]> {
  const { data, error } = await (supabase as any)
    .from('suppliers')
    .select('id, name, contact_phone, contact_channel, contact_name, contact_notes')
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) {
    // Contact columns may not exist until the Phase 1 migration lands — fall back
    // to the bare supplier list so the editor still renders.
    if ((error as any).code === '42703') {
      const fallback = await (supabase as any)
        .from('suppliers')
        .select('id, name')
        .eq('active', true)
        .order('name', { ascending: true });
      if (fallback.error) throw fallback.error;
      return (fallback.data ?? []).map((row: Record<string, unknown>) => mapRow(row));
    }
    throw error;
  }

  return (data ?? []).map((row: Record<string, unknown>) => mapRow(row));
}

export async function updateSupplierContact(
  supplierId: string,
  patch: Partial<Pick<SupplierContact, 'contactPhone' | 'contactChannel' | 'contactName' | 'contactNotes'>>,
): Promise<SupplierContact> {
  const update: Record<string, unknown> = {};
  if ('contactPhone' in patch) update.contact_phone = patch.contactPhone ?? null;
  if ('contactChannel' in patch) update.contact_channel = toChannel(patch.contactChannel);
  if ('contactName' in patch) update.contact_name = patch.contactName ?? null;
  if ('contactNotes' in patch) update.contact_notes = patch.contactNotes ?? null;

  const { data, error } = await (supabase as any)
    .from('suppliers')
    .update(update)
    .eq('id', supplierId)
    .select('id, name, contact_phone, contact_channel, contact_name, contact_notes')
    .single();

  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}
