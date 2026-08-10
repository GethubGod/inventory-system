-- Pin search_path on the tips updated_at trigger function
-- (security advisor: function_search_path_mutable).

create or replace function public.tip_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
