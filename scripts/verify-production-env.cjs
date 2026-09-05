#!/usr/bin/env node
'use strict';

const EXPECTED_API_HOST = 'whrohvitvmcrmedepurd.supabase.co';

function validateProductionEnvironment(env) {
  const errors = [];
  try {
    const url = new URL((env.EXPO_PUBLIC_SUPABASE_URL || '').trim());
    if (url.protocol !== 'https:' || url.host !== EXPECTED_API_HOST || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      errors.push('EXPO_PUBLIC_SUPABASE_URL must use the verified production project over HTTPS.');
    }
  } catch {
    errors.push('EXPO_PUBLIC_SUPABASE_URL must be a valid production HTTPS URL.');
  }
  const key = (env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    errors.push('Set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to the active project publishable key. The legacy EAS anon key failed production auth validation.');
  }
  return errors;
}

if (require.main === module) {
  if (process.argv.includes('--eas-hook') && process.env.EAS_BUILD_PROFILE !== 'production') {
    console.log('Production API configuration check skipped for this non-production profile.');
  } else {
    const errors = validateProductionEnvironment(process.env);
    if (errors.length) {
      errors.forEach((error) => console.error(`FAIL: ${error}`));
      process.exitCode = 1;
    } else {
      console.log('PASS: production API host and public key format. Live authentication still requires release verification.');
    }
  }
}

module.exports = { validateProductionEnvironment };
