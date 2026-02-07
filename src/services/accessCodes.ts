import { supabase } from '@/lib/supabase';
import { UserRole } from '@/types';

interface ValidateAccessCodeResponse {
  role: UserRole;
}

interface UpdateAccessCodesInput {
  employeeAccessCode: string;
  managerAccessCode: string;
}

const ACCESS_CODE_REGEX = /^\d{4}$/;

async function getFunctionErrorMessage(error: unknown): Promise<string | null> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json();
        if (typeof payload?.error === 'string') {
          return payload.error;
        }
      } catch {
        // Ignore parse errors and fallback to generic messages.
      }
    }
  }

  if (error && typeof error === 'object' && 'message' in error) {
    try {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export async function validateAccessCode(accessCode: string): Promise<UserRole> {
  const normalizedCode = accessCode.trim();

  if (!ACCESS_CODE_REGEX.test(normalizedCode)) {
    throw new Error('Access code must be exactly 4 digits');
  }

  const { data, error } = await supabase.functions.invoke<ValidateAccessCodeResponse>(
    'validate-access-code',
    {
      body: { accessCode: normalizedCode },
    }
  );

  if (error) {
    const message = (await getFunctionErrorMessage(error)) ?? '';
    if (message.toLowerCase().includes('invalid access code')) {
      throw new Error('Invalid access code.');
    }
    throw new Error('Unable to validate access code. Please try again.');
  }

  if (data?.role !== 'employee' && data?.role !== 'manager') {
    throw new Error('Invalid access code.');
  }

  return data.role;
}

export async function updateAccessCodes({
  employeeAccessCode,
  managerAccessCode,
}: UpdateAccessCodesInput): Promise<void> {
  const employeeCode = employeeAccessCode.trim();
  const managerCode = managerAccessCode.trim();

  if (!ACCESS_CODE_REGEX.test(employeeCode) || !ACCESS_CODE_REGEX.test(managerCode)) {
    throw new Error('Both access codes must be exactly 4 digits.');
  }

  if (employeeCode === managerCode) {
    throw new Error('Employee and manager codes cannot be the same.');
  }

  const { error } = await supabase.rpc('manager_update_access_codes', {
    p_employee_code: employeeCode,
    p_manager_code: managerCode,
  });

  if (error) {
    throw new Error(error.message || 'Unable to update access codes.');
  }
}
