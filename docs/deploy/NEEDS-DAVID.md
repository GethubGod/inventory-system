# Needs David — running ledger (roadmap build, Aug 2026)

Things only David can do. Agents keep building; none of these block later phases.
Each phase also gets a deploy checklist in `docs/deploy/phase-N.md` (staged — nothing
is pushed to production by agents).

## Carry-over from tips launch (production, do whenever)
- [ ] Keep the Supabase secret aligned with the web domains: `ALLOWED_ORIGINS=https://tips.smelterpos.com,https://dashboard.smelterpos.com,https://tips.babytunasystems.com` (the last host is the temporary legacy fallback).
- [ ] Rotate seeded entry tokens + PINs from `/manager` (Sushi 4271, Poki 8356 are seeded fixtures)
- [ ] Rename placeholder roster (Maria/Jose/Lena/Tom/Ken)
- [ ] Reprint QR stickers from the dashboard after this fix ships. QR/NFC links now always use `https://tips.smelterpos.com/e`, regardless of which manager or preview host generated them.

## Real-world verification (build is done with fixtures; these prove it)
- [ ] Phase 1: send a real order-day Send All run from a physical iPhone
      (`sms:` deep-link recipient+body quirks can only be proven on-device)
- [ ] Phase 5c: confirm an order-day reminder push lands on a real device
- [ ] Complete one invited-user onboarding on a physical iPhone, then confirm
      PIN/password sign-in and in-app account deletion.

## Final
- [ ] Deploy the retained migrations before or with the changed Edge Functions.
- [ ] Deploy `web/`, then change the App Store Connect privacy-policy URL to
      `https://tips.babytunasystems.com/privacy`.
- [ ] Review and merge the curated integration branch; merging to `main`
      deploys `web/` through Vercel.
