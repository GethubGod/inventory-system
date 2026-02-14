export interface ResolveLocationSwitchTargetInput {
  currentLocationId: string | null;
  availableLocationIds: readonly string[];
}

export interface ResolveLocationSwitchTargetResult {
  mode: 'toggle' | 'selector' | 'unavailable';
  targetLocationId: string | null;
}

function uniqueLocationIds(locationIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  locationIds.forEach((locationId) => {
    const trimmed = typeof locationId === 'string' ? locationId.trim() : '';
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    unique.push(trimmed);
  });
  return unique;
}

export function getOtherLocationId(
  currentLocationId: string | null,
  locationIds: readonly string[]
): string | null {
  const unique = uniqueLocationIds(locationIds);
  if (unique.length !== 2) return null;

  const [first, second] = unique;
  if (currentLocationId === first) return second;
  if (currentLocationId === second) return first;
  return first;
}

export function resolveLocationSwitchTarget(
  input: ResolveLocationSwitchTargetInput
): ResolveLocationSwitchTargetResult {
  const unique = uniqueLocationIds(input.availableLocationIds);

  if (unique.length < 2) {
    return {
      mode: 'unavailable',
      targetLocationId: null,
    };
  }

  // Product rule: with exactly two locations, "Change Location" should be a one-tap toggle.
  if (unique.length === 2) {
    return {
      mode: 'toggle',
      targetLocationId: getOtherLocationId(input.currentLocationId, unique),
    };
  }

  return {
    mode: 'selector',
    targetLocationId: null,
  };
}
