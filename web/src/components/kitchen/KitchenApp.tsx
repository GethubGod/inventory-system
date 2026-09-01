"use client";

// Signed-in kitchen shell: brand bar with who you are, location choice when
// the account is not pinned to one, a chef/kitchen switch only for accounts
// that have both modules, and the live request list shared by both screens.

import { useEffect, useState } from "react";
import { SmelterLogo } from "@/components/Logo";
import {
  availableViews,
  canSwitchLocation,
  resolveLocation,
  resolveView,
} from "@/lib/kitchen/access";
import type { KitchenAccess } from "@/lib/kitchen/api";
import { formatTag } from "@/lib/kitchen/format";
import { openQueuedCount } from "@/lib/kitchen/state";
import {
  loadRememberedLocation,
  loadRememberedView,
  saveRememberedLocation,
  saveRememberedView,
} from "@/lib/kitchen/storage";
import type { KitchenLocation, KitchenView } from "@/lib/kitchen/types";
import ChefView from "@/components/kitchen/ChefView";
import KitchenDisplayView from "@/components/kitchen/KitchenDisplayView";
import { useKitchenRequests } from "@/components/kitchen/useKitchenRequests";

function LocationPicker({
  locations,
  onPick,
}: {
  locations: KitchenLocation[];
  onPick: (location: KitchenLocation) => void;
}) {
  const active = locations.filter((location) => location.active);
  return (
    <section>
      <div className="mb-3.5">
        <h1 className="text-[22px] font-bold text-ink">Which kitchen?</h1>
        <p className="text-[13px] text-ink2 mt-0.5">This device remembers your choice.</p>
      </div>
      {active.length === 0 ? (
        <div className="bg-card rounded-card p-5">
          <p className="text-ink2 text-sm">No active locations. Ask a manager.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {active.map((location) => (
            <button
              key={location.id}
              type="button"
              onClick={() => onPick(location)}
              className="bg-card rounded-card px-4.5 py-5 text-left text-lg font-bold text-ink"
            >
              {location.name}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function LiveScreens({
  access,
  location,
  view,
  views,
  onChangeView,
}: {
  access: KitchenAccess;
  location: KitchenLocation;
  view: KitchenView;
  views: KitchenView[];
  onChangeView: (view: KitchenView) => void;
}) {
  const requests = useKitchenRequests(location.id);
  const queued = openQueuedCount(requests.state);
  return (
    <>
      {views.length > 1 ? (
        <div
          role="tablist"
          aria-label="Screen"
          className="flex bg-card rounded-full p-1 mb-4 border border-hairline"
        >
          {views.map((option) => {
            const on = option === view;
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onChangeView(option)}
                className={`flex-1 rounded-full py-[11px] text-sm flex items-center justify-center gap-1.5 ${
                  on ? "bg-ink text-white font-bold" : "text-ink2 font-semibold"
                }`}
              >
                {option === "chef" ? "Chef" : "Kitchen display"}
                {option === "kitchen" ? (
                  <span
                    className={`text-[11px] font-bold min-w-5 h-5 rounded-full inline-flex items-center justify-center px-1.5 ${
                      on ? "bg-white/20 text-white" : "bg-well text-ink2"
                    }`}
                  >
                    {queued}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {view === "chef" ? (
        <ChefView
          requests={requests}
          selfUserId={access.identity.userId}
          canManage={access.isManager}
        />
      ) : (
        <KitchenDisplayView requests={requests} />
      )}
    </>
  );
}

export default function KitchenApp({
  access,
  onSignOut,
}: {
  access: KitchenAccess;
  onSignOut: () => void;
}) {
  const views = availableViews(access.modules);
  const [view, setView] = useState<KitchenView>(
    () => resolveView(access.modules, loadRememberedView()) ?? views[0],
  );
  const [location, setLocation] = useState<KitchenLocation | null>(() =>
    resolveLocation(access.defaultLocationId, access.locations, loadRememberedLocation()),
  );
  const switchable = canSwitchLocation(access.defaultLocationId, access.locations);

  useEffect(() => {
    saveRememberedView(view);
  }, [view]);

  function pickLocation(next: KitchenLocation | null) {
    setLocation(next);
    saveRememberedLocation(next?.id ?? null);
  }

  return (
    <div className="max-w-[430px] mx-auto px-4 pt-3.5 pb-24 min-h-dvh">
      <div className="flex items-center justify-between mb-2.5 gap-3">
        <div className="flex items-center gap-2.5">
          <SmelterLogo height={26} />
          <span className="text-[13px] font-semibold text-ink2">Kitchen</span>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="bg-card rounded-full px-3 py-1.5 text-xs font-semibold text-ink2 shrink-0"
        >
          Sign out
        </button>
      </div>

      {/* Who is signed in (name and @tag stamp every request) and where. */}
      <div className="flex items-center justify-between gap-3 mb-3.5 text-xs text-ink3">
        <p className="truncate min-w-0">
          <span className="font-semibold text-ink">{access.identity.displayName}</span>{" "}
          <span className="text-ink2">{formatTag(access.identity.tag)}</span>
          {location ? <span> · {location.name}</span> : null}
        </p>
        {location && switchable ? (
          <button
            type="button"
            onClick={() => pickLocation(null)}
            className="font-semibold text-ink2 underline shrink-0"
          >
            Change
          </button>
        ) : null}
      </div>

      {location ? (
        <LiveScreens
          key={location.id}
          access={access}
          location={location}
          view={view}
          views={views}
          onChangeView={setView}
        />
      ) : (
        <LocationPicker locations={access.locations} onPick={pickLocation} />
      )}
    </div>
  );
}
