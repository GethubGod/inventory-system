// Which kitchen screen a signed-in user gets, and at which location. Pure
// resolution logic (unit tested); the fetch lives in api.ts.

import type {
  KitchenLocation,
  KitchenModules,
  KitchenView,
} from "@/lib/kitchen/types";

export function isKitchenView(value: unknown): value is KitchenView {
  return value === "chef" || value === "kitchen";
}

/** Views this user may open, in display order. Empty means no access. */
export function availableViews(modules: KitchenModules): KitchenView[] {
  const views: KitchenView[] = [];
  if (modules.kitchen_requests) views.push("chef");
  if (modules.kitchen_display) views.push("kitchen");
  return views;
}

/**
 * The view to show: the remembered one when it is still allowed, else the
 * first allowed one. Null when the user has neither module.
 */
export function resolveView(
  modules: KitchenModules,
  remembered: KitchenView | null,
): KitchenView | null {
  const views = availableViews(modules);
  if (views.length === 0) return null;
  if (remembered && views.includes(remembered)) return remembered;
  return views[0];
}

/**
 * The location to work in. A works-at location on the account always wins;
 * otherwise the remembered choice if it is still an active location; a
 * single active location needs no choice. Null means "ask".
 */
export function resolveLocation(
  defaultLocationId: string | null,
  locations: KitchenLocation[],
  remembered: string | null,
): KitchenLocation | null {
  const active = locations.filter((location) => location.active);
  if (defaultLocationId) {
    const pinned = active.find((location) => location.id === defaultLocationId);
    if (pinned) return pinned;
  }
  if (remembered) {
    const chosen = active.find((location) => location.id === remembered);
    if (chosen) return chosen;
  }
  if (active.length === 1) return active[0];
  return null;
}

/** Whether the user may switch locations (no works-at pin, 2+ active). */
export function canSwitchLocation(
  defaultLocationId: string | null,
  locations: KitchenLocation[],
): boolean {
  if (
    defaultLocationId &&
    locations.some((l) => l.id === defaultLocationId && l.active)
  ) {
    return false;
  }
  return locations.filter((location) => location.active).length > 1;
}
