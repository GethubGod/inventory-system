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
    const context = (error as { context?: any }).context;

    if (context) {
      // Newer supabase-js: context is the already-parsed JSON body
      if (typeof context === 'object' && !(context instanceof Response) && typeof context.error === 'string') {
        return context.error;
      }

      // Older supabase-js: context is a Response object
      if (typeof context.json === 'function') {
        try {
          const payload = await context.json();
          if (typeof payload?.error === 'string') {
            return payload.error;
          }
        } catch {
          // body already consumed or not JSON – fall through
        }
      }
    }
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (
      typeof message === 'string' &&
      !message.toLowerCase().includes('edge function returned a non-2xx')
    ) {
      return message;
    }
  }

  return null;
}

export async function validateAccessCode(accessCode: string): Promise<UserRole> {
  const normalizedCode = accessCode.trim();

  if (!ACCESS_CODE_REGEX.test(normalizedCode)) {
    throw new Error('Access code must be exactly 4 digits');
  }

  const { data, error } = await supabase.functions.invoke('validate-access-code', {
    body: { accessCode: normalizedCode },
  });
  const typedData = data as ValidateAccessCodeResponse | null;

  if (error) {
    const message = (await getFunctionErrorMessage(error)) ?? '';
    if (message.toLowerCase().includes('invalid access code')) {
      throw new Error('Invalid access code.');
    }
    throw new Error('Unable to validate access code. Please try again.');
  }

  if (typedData?.role !== 'employee' && typedData?.role !== 'manager') {
    throw new Error('Invalid access code.');
  }

  return typedData.role;
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

  const { data, error } = await supabase.functions.invoke('update-access-codes', {
    body: {
      employeeAccessCode: employeeCode,
      managerAccessCode: managerCode,
    },
  });
  const typedData = data as { success?: boolean } | null;

  if (error) {
    const message = (await getFunctionErrorMessage(error)) ?? '';

    if (message.toLowerCase().includes('only managers')) {
      throw new Error('Only managers can update access codes.');
    }

    if (message.toLowerCase().includes('4 digits')) {
      throw new Error('Both access codes must be exactly 4 digits.');
    }

    if (message.toLowerCase().includes('must be different')) {
      throw new Error('Employee and manager codes cannot be the same.');
    }

    throw new Error(message || 'Unable to update access codes.');
  }

  if (typedData?.success !== true) {
    throw new Error('Unable to update access codes.');
  }
}
