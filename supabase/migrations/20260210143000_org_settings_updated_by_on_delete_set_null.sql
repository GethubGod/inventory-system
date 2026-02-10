-- Prevent auth user deletion from failing when org_settings.updated_by points to that user.

do $$
declare
  v_constraint_name text;
begin
  select c.conname
  into v_constraint_name
  from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
  where n.nspname = 'public'
    and t.relname = 'org_settings'
    and c.contype = 'f'
    and a.attname = 'updated_by'
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.org_settings drop constraint %I', v_constraint_name);
  end if;

  alter table public.org_settings
    add constraint org_settings_updated_by_fkey
    foreign key (updated_by)
    references auth.users(id)
    on delete set null;
exception
  when duplicate_object then null;
  when undefined_table then null;
  when undefined_column then null;
end;
$$;
