-- The onboarding credential migration introduced this pure normalizer after
-- the broader search-path hardening pass. Pin it explicitly for the advisor.
alter function public.normalize_login_name(text) set search_path = public;

notify pgrst, 'reload schema';
