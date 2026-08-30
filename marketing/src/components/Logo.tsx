import Image from "next/image";

// The delivered artwork, used as-is on every background. The mark's circle is
// the only cut: inside it the art keeps its own colours, so the white in the
// swirl stays white on a black page. See brand/README.md.
const MARK_SRC = "/brand/smelter-mark.png";
const LOCKUP_SRC = "/brand/smelter-lockup.png";

/** Lockup width / height. The height equals the mark's diameter. */
const LOCKUP_ASPECT = 1198 / 257;

/** The mark on its own, for tight spots. `size` is its diameter. */
export function SmelterMark({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src={MARK_SRC}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
      priority
    />
  );
}

/**
 * Mark + "smelter" wordmark, scaling as one unit.
 *
 * `height` is the mark's diameter; the wordmark and the gap scale with it at
 * the proportions of the delivered lockup.
 */
export function SmelterLogo({
  height = 28,
  className = "",
}: {
  height?: number;
  className?: string;
}) {
  const width = Math.round(height * LOCKUP_ASPECT);
  return (
    <Image
      src={LOCKUP_SRC}
      alt="smelter"
      width={width}
      height={height}
      className={className}
      style={{ width, height }}
      priority
    />
  );
}
