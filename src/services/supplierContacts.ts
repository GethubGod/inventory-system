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

type SupplierContactRow = {
  id: string;
  name: string;
  contact_phone: string | null;
  contact_channel: SupplierContactChannel | null;
  contact_name: string | null;
  contact_notes: string | null;
};

const SUPPLIER_CONTACT_COLUMNS =
  'id,name,contact_phone,contact_channel,contact_name,contact_notes';

function normalizeContactChannel(channel: unknown): SupplierContactChannel {
  if (channel === 'sms' || channel === 'whatsapp' || channel === 'share_sheet') {
    return channel;
  }

  return 'share_sheet';
}

function toSupplierContact(row: SupplierContactRow): SupplierContact {
  return {
    supplierId: row.id,
    supplierName: row.name,
    contactPhone: row.contact_phone,
    contactChannel: normalizeContactChannel(row.contact_channel),
    contactName: row.contact_name,
    contactNotes: row.contact_notes,
  };
}

export async function listSupplierContacts(): Promise<SupplierContact[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select(SUPPLIER_CONTACT_COLUMNS)
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as SupplierContactRow[]).map(toSupplierContact);
}

export async function updateSupplierContact(
  supplierId: string,
  patch: Partial<
    Pick<
      SupplierContact,
      'contactPhone' | 'contactChannel' | 'contactName' | 'contactNotes'
    >
  >,
): Promise<SupplierContact> {
  const contactPatch: Record<string, string | null> = {};

  if (patch.contactPhone !== undefined) {
    contactPatch.contact_phone = patch.contactPhone;
  }
  if (patch.contactChannel !== undefined) {
    contactPatch.contact_channel = patch.contactChannel;
  }
  if (patch.contactName !== undefined) {
    contactPatch.contact_name = patch.contactName;
  }
  if (patch.contactNotes !== undefined) {
    contactPatch.contact_notes = patch.contactNotes;
  }

  const { data, error } = await supabase
    .from('suppliers')
    .update(contactPatch)
    .eq('id', supplierId)
    .select(SUPPLIER_CONTACT_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('Supplier contact was not found.');
  }

  return toSupplierContact(data as SupplierContactRow);
}
