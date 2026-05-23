import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '@/store/authStore';
import type { Location } from '@/types';

function getAvailableLocations(locations: Location[] | null | undefined): Location[] {
  const safeLocations = Array.isArray(locations)
    ? locations.filter((location): location is Location => Boolean(location?.id))
    : [];
  const activeLocations = safeLocations.filter((location) => location.active !== false);
  return activeLocations.length > 0 ? activeLocations : safeLocations;
}

export function resolveLocation(
  currentLocation: Location | null,
  availableLocations: Location[],
): Location | null {
  if (availableLocations.length === 0) {
    return null;
  }

  const defaultLocation =
    availableLocations.find((loc) => loc.name.toLowerCase().includes('sushi')) ??
    availableLocations[0] ??
    null;

  if (!currentLocation?.id) {
    return defaultLocation;
  }

  return (
    availableLocations.find((location) => location.id === currentLocation.id) ??
    defaultLocation
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
