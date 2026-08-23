-- Phase 7b: supplier invoice photos, parsed invoice lines, and confirmed prices.
--
-- There is no existing storage bucket declaration migration in this repository,
-- so this migration owns the private `supplier-invoices` bucket declaration.
-- Invoice photos are deliberately kept private and are served only through
-- Storage RLS or the service-role Edge Functions below.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'supplier-invoices',
  'supplier-invoices',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.invoice_scans (
  id uuid primary key default gen_random_uuid(),
  past_order_id uuid references public.past_orders(id) on delete set null,
  supplier_id text not null,
  uploaded_by uuid not null references public.users(id) on delete restrict,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'parsed', 'failed')),
  image_path text not null
    check (btrim(image_path) <> '' and position('..' in image_path) = 0),
  parsed_at timestamp with time zone,
  parse_error text,
  confirmed_at timestamp with time zone,
  confirmed_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.invoice_scan_items (
  id uuid primary key default gen_random_uuid(),
  invoice_scan_id uuid not null references public.invoice_scans(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  raw_name text not null check (btrim(raw_name) <> ''),
  qty numeric not null check (qty >= 0),
  unit text not null check (btrim(unit) <> ''),
  unit_price numeric not null check (unit_price >= 0),
  total_price numeric not null check (total_price >= 0),
  matched_item_id text,
  matched_past_order_item_id uuid references public.past_order_items(id) on delete set null,
  price_delta numeric,
  quantity_delta numeric,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint invoice_scan_items_scan_line_number_key unique (invoice_scan_id, line_number)
);

create table if not exists public.supplier_price_history (
  id uuid primary key default gen_random_uuid(),
  supplier_id text not null,
  item_id text not null,
  -- Price is unit-sensitive: the same item may be invoiced by case or each.
  unit text not null check (btrim(unit) <> ''),
  unit_price numeric not null check (unit_price >= 0),
  observed_at timestamp with time zone not null default now(),
  source_invoice_scan_id uuid not null references public.invoice_scans(id) on delete restrict,
  source_invoice_scan_item_id uuid not null references public.invoice_scan_items(id) on delete restrict,
  created_at timestamp with time zone not null default now(),
  constraint supplier_price_history_source_scan_item_key unique (source_invoice_scan_item_id)
);

create index if not exists invoice_scans_supplier_created_at_idx
  on public.invoice_scans(supplier_id, created_at desc);

create index if not exists invoice_scans_past_order_id_idx
  on public.invoice_scans(past_order_id)
  where past_order_id is not null;

create index if not exists invoice_scan_items_invoice_scan_id_idx
  on public.invoice_scan_items(invoice_scan_id, line_number);

create index if not exists invoice_scan_items_matched_past_order_item_id_idx
  on public.invoice_scan_items(matched_past_order_item_id)
  where matched_past_order_item_id is not null;

create index if not exists supplier_price_history_lookup_idx
  on public.supplier_price_history(supplier_id, item_id, unit, observed_at desc);

drop trigger if exists set_invoice_scans_updated_at on public.invoice_scans;
create trigger set_invoice_scans_updated_at
before update on public.invoice_scans
for each row execute function public.set_updated_at();

drop trigger if exists set_invoice_scan_items_updated_at on public.invoice_scan_items;
create trigger set_invoice_scan_items_updated_at
before update on public.invoice_scan_items
for each row execute function public.set_updated_at();

alter table public.invoice_scans enable row level security;
alter table public.invoice_scan_items enable row level security;
alter table public.supplier_price_history enable row level security;

-- A photo can be created by its uploader (or a manager), but parsing and
-- confirmation state are server-controlled by the authenticated Edge Functions.
drop policy if exists invoice_scans_select_uploader_or_manager on public.invoice_scans;
create policy invoice_scans_select_uploader_or_manager
on public.invoice_scans
for select
to authenticated
using (
  uploaded_by = (select auth.uid())
  or public.current_user_is_manager()
);

drop policy if exists invoice_scans_insert_uploader_or_manager on public.invoice_scans;
create policy invoice_scans_insert_uploader_or_manager
on public.invoice_scans
for insert
to authenticated
with check (
  (
    uploaded_by = (select auth.uid())
    or public.current_user_is_manager()
  )
  and status = 'uploaded'
  and parsed_at is null
  and parse_error is null
  and confirmed_at is null
  and confirmed_by is null
  and (
    past_order_id is null
    or exists (
      select 1
      from public.past_orders past_order
      where past_order.id = invoice_scans.past_order_id
        and (
          past_order.created_by = (select auth.uid())
          or public.current_user_is_manager()
        )
    )
  )
);

-- Parsed lines are derived server-side. Uploader/manager access is read-only so
-- a client cannot manufacture price-history evidence before confirmation.
drop policy if exists invoice_scan_items_select_uploader_or_manager on public.invoice_scan_items;
create policy invoice_scan_items_select_uploader_or_manager
on public.invoice_scan_items
for select
to authenticated
using (
  exists (
    select 1
    from public.invoice_scans scan
    where scan.id = invoice_scan_id
      and (
        scan.uploaded_by = (select auth.uid())
        or public.current_user_is_manager()
      )
  )
);

-- Price history is finalized only by confirm-invoice-scan with service-role
-- access. It remains a manager-only read surface.
drop policy if exists supplier_price_history_select_manager on public.supplier_price_history;
create policy supplier_price_history_select_manager
on public.supplier_price_history
for select
to authenticated
using (public.current_user_is_manager());

grant select, insert on public.invoice_scans to authenticated;
grant select on public.invoice_scan_items to authenticated;
grant select on public.supplier_price_history to authenticated;

-- Storage object names are user-scoped (`<auth.uid()>/<file-name>`). This keeps
-- client uploads private while allowing a manager to review any supplier invoice.
drop policy if exists supplier_invoices_select_uploader_or_manager on storage.objects;
create policy supplier_invoices_select_uploader_or_manager
on storage.objects
for select
to authenticated
using (
  bucket_id = 'supplier-invoices'
  and (
    owner_id = (select auth.uid()::text)
    or public.current_user_is_manager()
  )
);

drop policy if exists supplier_invoices_insert_uploader_or_manager on storage.objects;
create policy supplier_invoices_insert_uploader_or_manager
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'supplier-invoices'
  and (
    public.current_user_is_manager()
    or (
      owner_id = (select auth.uid()::text)
      and (storage.foldername(name))[1] = (select auth.uid()::text)
    )
  )
);

drop policy if exists supplier_invoices_update_uploader_or_manager on storage.objects;
create policy supplier_invoices_update_uploader_or_manager
on storage.objects
for update
to authenticated
using (
  bucket_id = 'supplier-invoices'
  and (
    owner_id = (select auth.uid()::text)
    or public.current_user_is_manager()
  )
)
with check (
  bucket_id = 'supplier-invoices'
  and (
    public.current_user_is_manager()
    or (
      owner_id = (select auth.uid()::text)
      and (storage.foldername(name))[1] = (select auth.uid()::text)
    )
  )
);

drop policy if exists supplier_invoices_delete_uploader_or_manager on storage.objects;
create policy supplier_invoices_delete_uploader_or_manager
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'supplier-invoices'
  and (
    owner_id = (select auth.uid()::text)
    or public.current_user_is_manager()
  )
);

notify pgrst, 'reload schema';
