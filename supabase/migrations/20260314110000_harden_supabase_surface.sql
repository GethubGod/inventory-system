-- Harden exposed Supabase surfaces without rewriting historical migrations.

do $$
begin
  if to_regprocedure('public.manager_update_access_codes(text,text)') is not null then
    revoke all on function public.manager_update_access_codes(text, text)
      from public, anon, authenticated;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.unit_conversions') is not null then
    alter table public.unit_conversions enable row level security;

    execute 'drop policy if exists unit_conversions_select_authenticated on public.unit_conversions';
    execute '
      create policy unit_conversions_select_authenticated
      on public.unit_conversions
      for select
      to authenticated
      using (true)
    ';

    revoke insert, update, delete on public.unit_conversions from authenticated;
    grant select on public.unit_conversions to authenticated;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.storage_areas') is not null then
    alter table public.storage_areas enable row level security;
    execute 'drop policy if exists storage_areas_manager_all on public.storage_areas';
    execute '
      create policy storage_areas_manager_all
      on public.storage_areas
      for all
      to authenticated
      using (public.current_user_is_manager())
      with check (public.current_user_is_manager())
    ';
    grant select, insert, update, delete on public.storage_areas to authenticated;
  end if;

  if to_regclass('public.area_items') is not null then
    alter table public.area_items enable row level security;
    execute 'drop policy if exists area_items_manager_all on public.area_items';
    execute '
      create policy area_items_manager_all
      on public.area_items
      for all
      to authenticated
      using (public.current_user_is_manager())
      with check (public.current_user_is_manager())
    ';
    grant select, insert, update, delete on public.area_items to authenticated;
  end if;

  if to_regclass('public.stock_updates') is not null then
    alter table public.stock_updates enable row level security;
    execute 'drop policy if exists stock_updates_manager_all on public.stock_updates';
    execute '
      create policy stock_updates_manager_all
      on public.stock_updates
      for all
      to authenticated
      using (public.current_user_is_manager())
      with check (public.current_user_is_manager())
    ';
    grant select, insert, update, delete on public.stock_updates to authenticated;
  end if;

  if to_regclass('public.stock_check_sessions') is not null then
    alter table public.stock_check_sessions enable row level security;
    execute 'drop policy if exists stock_check_sessions_manager_all on public.stock_check_sessions';
    execute '
      create policy stock_check_sessions_manager_all
      on public.stock_check_sessions
      for all
      to authenticated
      using (public.current_user_is_manager())
      with check (public.current_user_is_manager())
    ';
    grant select, insert, update, delete on public.stock_check_sessions to authenticated;
  end if;
end;
$$;
