-- Voice entry gains a third variant: "local_live" — on-device speech
-- recognition parsed client-side, filling fields as words are spoken.
-- (The A/B readout keys on voice_variant, so the new mode must be
-- distinguishable from the Gemini chunk pipeline it replaces as default.)
--
-- Additive only: widens the CHECK constraint on tip_entries.voice_variant.

alter table public.tip_entries
  drop constraint if exists tip_entries_voice_variant_check;

alter table public.tip_entries
  add constraint tip_entries_voice_variant_check
  check (voice_variant in ('waveform', 'live_transcript', 'local_live'));
