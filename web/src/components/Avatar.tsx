import { initialsFor } from "@/lib/tips/format";

/** Initials avatar in a cream circle (roster cards, closer pill). */
export function Avatar({
  name,
  size = 44,
}: {
  name: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-full bg-well font-semibold text-ink2"
      style={{ width: size, height: size, fontSize: Math.max(12, size * 0.36) }}
    >
      {initialsFor(name)}
    </span>
  );
}
