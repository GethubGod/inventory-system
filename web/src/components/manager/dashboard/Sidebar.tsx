"use client";

// Collapsible sidebar: 216px full ↔ 66px icon rail. Pages, then profile +
// Log out pinned to the bottom. Nav icons come straight from the approved
// mockup.

import type { NavId } from "./types";

const NAV_ITEMS: Array<{ id: NavId; label: string; icon: React.ReactNode }> = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 3v18h18" />
        <path d="M6 15l4-5 3 3 5-7" />
      </svg>
    ),
  },
  {
    id: "ledger",
    label: "Recorded tips",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M3 14h18M9 4v16" />
      </svg>
    ),
  },
  {
    id: "staff",
    label: "Staff & schedule",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 19c.8-3 3-4.5 5.5-4.5S13.7 16 14.5 19" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M15.5 14.7c2.3.2 4.1 1.6 4.8 4.3" />
      </svg>
    ),
  },
  {
    id: "logdev",
    label: "Devices & entry log",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <path d="M14 14h3v3h-3zM18 18h3v3h-3z" />
      </svg>
    ),
  },
];

export function Sidebar({
  nav,
  onNav,
  collapsed,
  onToggleCollapsed,
  attention,
  profileName,
  profileEmail,
  onSignOut,
}: {
  nav: NavId;
  onNav: (nav: NavId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Shows the red dot on Overview while something needs attention. */
  attention: boolean;
  profileName: string;
  profileEmail: string;
  onSignOut: () => void;
}) {
  return (
    <aside
      className={`sticky top-0 flex h-screen flex-none flex-col border-r border-line bg-card ${
        collapsed ? "w-[66px] px-[9px]" : "w-[216px] px-3"
      } py-[18px]`}
    >
      <div className={`mb-3 flex ${collapsed ? "justify-center" : "justify-end"}`}>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-line bg-well text-ink2 hover:bg-tint hover:text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={`h-[18px] w-[18px] ${collapsed ? "rotate-180" : ""}`}
          >
            <path d="M11 7l-5 5 5 5" />
            <path d="M18 7l-5 5 5 5" />
          </svg>
        </button>
      </div>

      {NAV_ITEMS.map((item) => {
        const active = nav === item.id;
        return (
          <button
            key={item.id}
            type="button"
            title={item.label}
            aria-current={active}
            onClick={() => onNav(item.id)}
            className={`mb-0.5 flex w-full items-center gap-[9px] rounded-full px-3 py-[9px] text-left text-[13.5px] font-semibold ${
              active ? "bg-tint text-alert" : "text-ink2 hover:bg-well hover:text-ink"
            } ${collapsed ? "justify-center px-0 py-2.5" : ""}`}
          >
            <span className="h-[18px] w-[18px] flex-none [&_svg]:block [&_svg]:h-full [&_svg]:w-full">
              {item.icon}
            </span>
            {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
            {!collapsed && item.id === "overview" && attention && (
              <span className="ml-auto h-[7px] w-[7px] rounded-full bg-accent" aria-hidden />
            )}
          </button>
        );
      })}

      <div className="mt-auto flex flex-col gap-2 px-1 pt-2.5">
        <div className={`flex items-center gap-2.5 rounded-[10px] p-2 ${collapsed ? "justify-center p-0" : ""}`}>
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent text-sm font-extrabold text-white">
            {(profileName.trim()[0] ?? "?").toUpperCase()}
          </span>
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <b className="block truncate text-[13px] text-ink">{profileName}</b>
              <span className="block truncate text-[11px] text-ink2 opacity-75">
                {profileEmail}
              </span>
            </span>
          )}
        </div>
        <button
          type="button"
          title="Log out"
          onClick={onSignOut}
          className={`flex w-full items-center gap-[9px] rounded-full border border-alert/30 px-3 py-[9px] text-[13px] font-bold text-alert hover:bg-flagtint ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          <span className="h-[18px] w-[18px] flex-none [&_svg]:block [&_svg]:h-full [&_svg]:w-full">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5M21 12H9" />
            </svg>
          </span>
          {!collapsed && <span>Log out</span>}
        </button>
      </div>
    </aside>
  );
}
