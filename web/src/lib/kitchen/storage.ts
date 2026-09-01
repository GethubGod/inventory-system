// Device-remembered kitchen preferences (localStorage): the location this
// phone or display works, and which screen a dual-access user last used.
// Neither grants anything; the server decides access on every call.

import { isKitchenView } from "@/lib/kitchen/access";
import type { KitchenView } from "@/lib/kitchen/types";

const LOCATION_KEY = "smelter_kitchen_location";
const VIEW_KEY = "smelter_kitchen_view";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadRememberedLocation(): string | null {
  const value = storage()?.getItem(LOCATION_KEY);
  return value && value.length > 0 ? value : null;
}

export function saveRememberedLocation(locationId: string | null): void {
  const store = storage();
  if (!store) return;
  if (locationId) store.setItem(LOCATION_KEY, locationId);
  else store.removeItem(LOCATION_KEY);
}

export function loadRememberedView(): KitchenView | null {
  const value = storage()?.getItem(VIEW_KEY);
  return isKitchenView(value) ? value : null;
}

export function saveRememberedView(view: KitchenView): void {
  storage()?.setItem(VIEW_KEY, view);
}
