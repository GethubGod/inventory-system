-- Allow imported order history to be attributed to typed employee names before
-- the employee has a user record, then auto-link when the user exists.

alter table public.historical_order_imports
  add column if not exists employee_name_text text,
  add column if not exists employee_name_key text,
  add column if not exists placed_at_text text;

create index if not exists historical_order_imports_employee_name_key_idx
  on public.historical_order_imports(employee_name_key)
  where employee_id is null and employee_name_key is not null;

create or replace function public.normalize_history_employee_name(p_name text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(trim(coalesce(p_name, ''))), '\s+', ' ', 'g'), '')
$$;

create or replace function public.set_historical_import_employee_name_key()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.employee_name_key := public.normalize_history_employee_name(new.employee_name_text);
  return new;
end;
$$;

drop trigger if exists set_historical_import_employee_name_key on public.historical_order_imports;
create trigger set_historical_import_employee_name_key
before insert or update of employee_name_text
on public.historical_order_imports
for each row execute function public.set_historical_import_employee_name_key();

create or replace function public.link_historical_imports_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name_key text;
begin
  v_name_key := public.normalize_history_employee_name(new.name);
  if v_name_key is null then
    return new;
  end if;

  update public.historical_order_imports
  set employee_id = new.id
  where employee_id is null
    and employee_name_key = v_name_key;

  return new;
end;
$$;

drop trigger if exists link_historical_imports_after_user_insert on public.users;
create trigger link_historical_imports_after_user_insert
after insert or update of name
on public.users
for each row execute function public.link_historical_imports_for_user();

update public.historical_order_imports
set employee_name_key = public.normalize_history_employee_name(employee_name_text)
where employee_name_text is not null
  and employee_name_key is distinct from public.normalize_history_employee_name(employee_name_text);

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
