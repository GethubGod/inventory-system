import Link from "next/link";

// Placeholder home page while the real marketing site is designed: the
// wordmark, a one-line status, and construction icons bobbing above it.
export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div
        aria-hidden
        className="mb-8 flex items-end gap-6 text-[52px] sm:text-[64px]"
      >
        <span className="float-icon">🏗️</span>
        <span className="float-icon [animation-delay:-1.1s]">🚧</span>
        <span className="float-icon [animation-delay:-2.2s]">🔨</span>
      </div>

      <h1 className="wordmark !text-[clamp(48px,10vw,76px)] leading-none">
        smelter
      </h1>
      <p className="mt-4 text-[17px] text-ink2">site is being built</p>

      <nav
        aria-label="Site pages"
        className="mt-14 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-ink2"
      >
        <Link className="underline underline-offset-4" href="/terms">
          Terms
        </Link>
        <Link className="underline underline-offset-4" href="/privacy">
          Privacy
        </Link>
        <Link className="underline underline-offset-4" href="/support">
          Support
        </Link>
      </nav>
    </main>
  );
}
