-- Fix handle_new_user trigger: add search_path, on conflict, explicit enum cast
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'employee'::public.user_role
  )
  on conflict (id) do update set
    email = excluded.email,
    name = coalesce(excluded.name, public.users.name);

  return new;
end;
$$;
