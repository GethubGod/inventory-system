"use client";

// Dashboard chrome: sidebar on desktop, brand bar + pill nav on mobile.
// Rendered only after DashboardGate has verified a manager session.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface NavItem {
  label: string;
  href?: string;
  external?: boolean;
  disabledNote?: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Team", href: "/dashboard/team" },
  { label: "Suppliers", href: "/dashboard/suppliers" },
  { label: "Ordering setup", href: "/dashboard/ordering" },
  { label: "Tips", href: "/manager", external: true },
  { label: "Analytics", disabledNote: "Soon" },
];

function navClasses(active: boolean, horizontal: boolean): string {
  const base = horizontal
    ? "rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap"
    : "rounded-well px-4 py-2.5 text-sm font-semibold";
  if (active) return `${base} bg-accent text-white`;
  return `${base} bg-card text-ink2 hover:text-ink`;
}

function NavLinks({ horizontal }: { horizontal: boolean }) {
  const pathname = usePathname();
  return (
    <>
      {NAV_ITEMS.map((item) => {
        if (!item.href) {
          return (
            <span
              key={item.label}
              aria-disabled="true"
              title="Coming soon"
              className={`${
                horizontal
                  ? "rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap"
                  : "rounded-well px-4 py-2.5 text-sm font-semibold"
              } text-disabled cursor-not-allowed flex items-center gap-2`}
            >
              {item.label}
              <span className="text-[10px] font-bold uppercase tracking-wide border border-hairline rounded-full px-2 py-0.5">
                {item.disabledNote}
              </span>
            </span>
          );
        }
        if (item.external) {
          return (
            <a
              key={item.label}
              href={item.href}
              className={navClasses(false, horizontal)}
            >
              {item.label} ↗
            </a>
          );
        }
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.label}
            href={item.href}
            className={navClasses(active, horizontal)}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export default function DashboardShell({
  children,
  onSignOut,
}: {
  children: ReactNode;
  onSignOut: () => void;
}) {
  return (
    <div className="min-h-dvh w-full md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col gap-6 border-r border-hairline px-4 py-6 sticky top-0 h-dvh">
        <div className="px-2">
          <p className="wordmark">smelter</p>
          <p className="text-lg font-bold text-ink">Dashboard</p>
        </div>
        <nav className="flex flex-col gap-1.5">
          <NavLinks horizontal={false} />
        </nav>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onSignOut}
          className="self-start bg-card border border-hairline rounded-full px-5 py-2.5 text-sm font-semibold text-ink2"
        >
          Sign out
        </button>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden px-5 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="wordmark">smelter</p>
            <p className="text-lg font-bold text-ink">Dashboard</p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="bg-card rounded-full px-4 py-2 text-sm font-semibold text-ink2"
          >
            Sign out
          </button>
        </div>
        <nav className="flex gap-2 mt-4 overflow-x-auto pb-1 -mx-5 px-5">
          <NavLinks horizontal />
        </nav>
      </div>

      <main className="flex-1 min-w-0 px-5 py-6 md:py-8">
        <div className="w-full max-w-5xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
