import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '@/store';
import type { Location } from '@/types';

function getAvailableLocations(locations: Location[] | null | undefined): Location[] {
  const safeLocations = Array.isArray(locations)
    ? locations.filter((location): location is Location => Boolean(location?.id))
    : [];
  const activeLocations = safeLocations.filter((location) => location.active !== false);
  return activeLocations.length > 0 ? activeLocations : safeLocations;
}

function resolveLocation(
  currentLocation: Location | null,
  availableLocations: Location[],
): Location | null {
  if (availableLocations.length === 0) {
    return null;
  }

  if (!currentLocation?.id) {
    return availableLocations[0] ?? null;
  }

  return (
    availableLocations.find((location) => location.id === currentLocation.id) ??
    availableLocations[0] ??
    null
  );
}

export function useResolvedActiveLocation() {
  const { location, locations, setLocation } = useAuthStore(
    useShallow((state) => ({
      location: state.location,
      locations: state.locations,
      setLocation: state.setLocation,
    })),
  );

  const availableLocations = useMemo(
    () => getAvailableLocations(locations),
    [locations],
  );
  const activeLocation = useMemo(
    () => resolveLocation(location, availableLocations),
    [availableLocations, location],
  );

  useEffect(() => {
    if (!activeLocation) {
      if (location) {
        setLocation(null);
      }
      return;
    }

    if (location?.id !== activeLocation.id) {
      setLocation(activeLocation);
    }
  }, [activeLocation, location, setLocation]);

  return {
    location: activeLocation,
    locations: availableLocations,
    setLocation,
  };
}
