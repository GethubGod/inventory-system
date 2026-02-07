# Babytuna Inventory System

## OAuth + Access Code Onboarding

This app now supports:

- Email/password auth
- Google OAuth
- Apple OAuth (iOS)

All auth methods are gated by onboarding on first sign-in:

- Full Name
- 4-digit Access Code

Users cannot enter app stacks until `profiles.profile_completed = true`.

## Supabase Setup

### 1. Apply migrations

```bash
supabase db push
```

### 2. Configure Edge Function secrets

```bash
supabase secrets set SUPABASE_URL=your_project_url
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3. Deploy Edge Functions

```bash
supabase functions deploy validate-access-code
supabase functions deploy update-access-codes
```

## OAuth Provider Notes

In Supabase Auth settings:

- Enable Google provider
- Enable Apple provider
- Add redirect URL for app scheme (for example `babytuna://auth/callback`)

Ensure `app.json` keeps a valid scheme (`"scheme": "babytuna"`).

## Install Dependencies

```bash
npx expo install expo-auth-session expo-web-browser
```
