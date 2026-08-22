"use client";

// First-launch onboarding carousel — shown once per device (session.ts flag),
// re-viewable via /?onboarding=a|b for preview. Two variants for David to
// pick from:
//   * "cards" (A, default): cream background, swipeable white cards with
//     dots, Skip in the corner — matches the app's card language.
//   * "story" (B): full-bleed accent panels with a segmented progress bar,
//     tap anywhere to advance — faster, more phone-native.

import { useCallback, useRef, useState } from "react";

export type OnboardingVariant = "cards" | "story";

interface Slide {
  title: string;
  body: string;
  icon: "scan" | "mic" | "check";
}

const SLIDES: Slide[] = [
  {
    title: "Scan to start",
    body: "Scan the sticker by the register with your camera, or tap Scan here. No PIN needed.",
    icon: "scan",
  },
  {
    title: "Speak it in",
    body: "Say the shift, cash, card, and who's splitting. Any order or accent works. You can also tap a row to type.",
    icon: "mic",
  },
  {
    title: "Save and go",
    body: "Check the numbers and tap Save. You'll see a quick confirmation, then the app resets for the next shift.",
    icon: "check",
  },
];

function SlideIcon({
  icon,
  variant,
}: {
  icon: Slide["icon"];
  variant: OnboardingVariant;
}) {
  const size = variant === "story" ? 52 : 44;
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "onboarding-kinetic-graphic",
  };

  const graphic = (() => {
    if (icon === "scan") {
      return (
        <svg {...common}>
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
          <rect x="8" y="8" width="8" height="8" rx="1.5" />
          <path className="onboarding-kinetic-scan-beam" d="M5 12h14" />
        </svg>
      );
    }

    if (icon === "mic") {
      return (
        <span className="onboarding-kinetic-eq">
          <span />
          <span />
          <span />
          <span />
          <span />
        </span>
      );
    }

    return (
      <>
        <span className="onboarding-kinetic-glint" />
        <svg {...common} className="onboarding-kinetic-graphic onboarding-kinetic-check">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </>
    );
  })();

  const sizeClasses = variant === "story" ? "h-28 w-28" : "h-24 w-24";
  const colorClass = variant === "story" ? "text-white" : "text-accent";

  return (
    <span
      aria-hidden="true"
      data-onboarding-icon={icon}
      data-onboarding-variant={variant}
      className={`onboarding-kinetic-stage flex items-center justify-center ${sizeClasses} ${colorClass}`}
    >
      <span className="onboarding-kinetic-tile" />
      {graphic}
    </span>
  );
}

export function Onboarding({
  variant,
  onDone,
}: {
  variant: OnboardingVariant;
  onDone: () => void;
}) {
  return variant === "story" ? (
    <StoryOnboarding onDone={onDone} />
  ) : (
    <CardsOnboarding onDone={onDone} />
  );
}

// ---- Variant A: swipeable cards on cream.

function CardsOnboarding({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const last = SLIDES.length - 1;

  const handleScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setIndex(
      Math.max(
        0,
        Math.min(last, Math.round(track.scrollLeft / track.clientWidth)),
      ),
    );
  }, [last]);

  // Advance state first, then scroll — the button must keep working even if
  // smooth scrolling (and its scroll events) is unavailable.
  const goTo = useCallback(
    (next: number) => {
      setIndex(Math.max(0, Math.min(last, next)));
      const track = trackRef.current;
      if (!track) return;
      track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
    },
    [last],
  );

  return (
    <div className="fixed inset-0 z-50 bg-cream">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col pb-8 pt-5">
        <div className="flex h-10 items-center justify-end px-5">
          <button
            type="button"
            onClick={onDone}
            className="rounded-full bg-card px-4 py-2 text-sm font-semibold text-ink2 active:bg-well"
          >
            Skip
          </button>
        </div>

        <div
          ref={trackRef}
          onScroll={handleScroll}
          aria-label="Tutorial slides"
          className="mt-6 flex flex-1 snap-x snap-mandatory overflow-x-auto"
          style={{ scrollbarWidth: "none" }}
        >
          {SLIDES.map((slide) => (
            <div
              key={slide.title}
              className="flex w-full shrink-0 snap-center flex-col px-5"
            >
              <div className="flex flex-1 flex-col items-center justify-center rounded-card bg-card p-8 text-center">
                <SlideIcon icon={slide.icon} variant="cards" />
                <h2 className="mt-6 text-2xl font-bold text-ink">
                  {slide.title}
                </h2>
                <p className="mt-3 text-ink2">{slide.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-center gap-2">
          {SLIDES.map((slide, i) => (
            <span
              key={slide.title}
              className={`h-2 rounded-full transition-all ${
                i === index ? "w-6 bg-accent" : "w-2 bg-disabled"
              }`}
            />
          ))}
        </div>

        <div className="mt-6 px-5">
          <button
            type="button"
            onClick={() => (index === last ? onDone() : goTo(index + 1))}
            className="w-full rounded-full bg-accent py-4 font-semibold text-white active:opacity-90"
          >
            {index === last ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Variant B: full-bleed story panels, tap to advance.

function StoryOnboarding({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const last = SLIDES.length - 1;
  const slide = SLIDES[index];

  // onDone must run as a plain event side effect, never inside a state
  // updater (StrictMode double-invokes updaters; React warns on the
  // cross-component update).
  const advance = useCallback(() => {
    if (index === last) onDone();
    else setIndex(index + 1);
  }, [index, last, onDone]);

  const back = useCallback(() => {
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-accent text-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-5">
        <div className="flex items-center gap-2 pt-2">
          {SLIDES.map((s, i) => (
            <span
              key={s.title}
              className={`h-1 flex-1 rounded-full ${
                i <= index ? "bg-white" : "bg-white/30"
              }`}
            />
          ))}
        </div>

        {/* Tap zones: left third back, rest forward. */}
        <button
          type="button"
          aria-label={index === last ? "Finish" : "Next"}
          onClick={advance}
          className="flex flex-1 flex-col items-center justify-center text-center"
        >
          <SlideIcon icon={slide.icon} variant="story" />
          <h2 className="mt-8 text-3xl font-bold">{slide.title}</h2>
          <p className="mt-4 max-w-xs text-white/85">{slide.body}</p>
        </button>
        {index > 0 && (
          <button
            type="button"
            aria-label="Back"
            onClick={back}
            className="absolute left-0 top-24 h-2/3 w-1/4"
          />
        )}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onDone}
            className="px-2 py-3 font-semibold text-white/70"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={advance}
            className="rounded-full bg-white px-8 py-3.5 font-semibold text-accent active:opacity-90"
          >
            {index === last ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
