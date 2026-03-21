function normalizeCandidate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getEmailFallback(email: string | null | undefined): string | null {
  const normalized = normalizeCandidate(email);
  if (!normalized) {
    return null;
  }

  const [localPart] = normalized.split('@');
  return normalizeCandidate(localPart);
}

export function getUserDisplayName(options: {
  fullName?: string | null;
  name?: string | null;
  email?: string | null;
  fallback?: string;
}) {
  const {
    fullName,
    name,
    email,
    fallback = 'Crew member',
  } = options;

  return (
    normalizeCandidate(fullName) ??
    normalizeCandidate(name) ??
    getEmailFallback(email) ??
    fallback
  );
}

export function getUserFirstName(options: {
  fullName?: string | null;
  name?: string | null;
  email?: string | null;
  fallback?: string;
}) {
  const displayName = getUserDisplayName(options);
  const [firstName] = displayName.split(/\s+/);
  return firstName || displayName;
}
