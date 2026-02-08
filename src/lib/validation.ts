export type PasswordCheck = {
  key: string;
  label: string;
  ok: boolean;
};

export type PasswordValidationResult = {
  isValid: boolean;
  checks: PasswordCheck[];
};

const COMMON_PASSWORD_DENYLIST = new Set([
  'password',
  'password123',
  '123456',
  '12345678',
  '123456789',
  'qwerty',
  'qwerty123',
  'letmein',
  'admin',
  'welcome',
  'iloveyou',
  'abc123',
]);

export function validatePassword(password: string): PasswordValidationResult {
  const normalized = password.toLowerCase();

  const checks: PasswordCheck[] = [
    {
      key: 'length',
      label: 'At least 8 characters',
      ok: password.length >= 8,
    },
    {
      key: 'letter',
      label: 'At least 1 letter',
      ok: /[A-Za-z]/.test(password),
    },
    {
      key: 'number',
      label: 'At least 1 number (0-9)',
      ok: /[0-9]/.test(password),
    },
    {
      key: 'spaces',
      label: 'No spaces',
      ok: !/\s/.test(password),
    },
    {
      key: 'denylist',
      label: 'Not a common password',
      ok: !COMMON_PASSWORD_DENYLIST.has(normalized),
    },
  ];

  return {
    isValid: checks.every((check) => check.ok),
    checks,
  };
}
