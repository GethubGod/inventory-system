"use client";

// Variant B mic feedback: a small white pill showing the trailing edge of the
// live transcript (last ~28 chars) with the newest words in ink and a
// blinking cursor bar.

const TAIL_CHARS = 28;

export function LiveTranscript({ text }: { text: string }) {
  const trimmed = text.trim();
  const tail =
    trimmed.length > TAIL_CHARS ? trimmed.slice(-TAIL_CHARS) : trimmed;
  // Newest word(s): the last two space-separated tokens of the tail.
  const tokens = tail.split(" ");
  const newest = tokens.slice(-2).join(" ");
  const older = tokens.slice(0, -2).join(" ");

  return (
    <div className="bg-card rounded-full px-3 py-1.5 max-w-[55%] overflow-hidden whitespace-nowrap flex items-center">
      <span className="overflow-hidden whitespace-nowrap text-sm">
        {older && <span className="text-ink3">{older} </span>}
        <span className="text-ink">{newest}</span>
      </span>
      <span aria-hidden className="w-0.5 h-4 bg-accent animate-pulse ml-1 shrink-0" />
    </div>
  );
}
