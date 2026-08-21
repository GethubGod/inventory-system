import Link from "next/link";
import type { ReactNode } from "react";

export function LegalPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
      <article className="rounded-card bg-card px-6 py-8 sm:px-10">
        <p className="section-label mb-3">Babytuna Systems</p>
        <h1 className="text-3xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm text-ink2">Effective August 21, 2026</p>
        <div className="mt-8 space-y-7 text-[15px] leading-7 text-ink2">
          {children}
        </div>
      </article>
      <nav
        aria-label="Legal pages"
        className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-ink2"
      >
        <Link className="underline underline-offset-4" href="/terms">
          Terms
        </Link>
        <Link className="underline underline-offset-4" href="/privacy">
          Privacy
        </Link>
        <a
          className="underline underline-offset-4"
          href="https://apps.apple.com/us/app/babytuna-systems/id6759226573"
        >
          App Store
        </a>
      </nav>
    </main>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-bold text-ink">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
