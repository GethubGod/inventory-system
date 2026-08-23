alter table public.suppliers
  add column if not exists contact_phone text,
  add column if not exists contact_channel text not null default 'share_sheet'
    check (contact_channel in ('sms', 'whatsapp', 'share_sheet')),
  add column if not exists contact_name text,
  add column if not exists contact_notes text;
