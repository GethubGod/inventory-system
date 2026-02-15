-- Set access codes to known working values (4 digits each).
-- Run in Supabase SQL editor.
-- Replace 1234/9999 with your desired employee/manager codes.

select public.set_org_access_codes_plain('1234', '9999', null);

-- Verify a row exists and values are hashed.
select
  id,
  org_id,
  employee_access_code,
  manager_access_code,
  updated_at
from public.org_settings
order by updated_at desc nulls last
limit 1;
