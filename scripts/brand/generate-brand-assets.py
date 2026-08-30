#!/usr/bin/env python3
"""Derive every smelter brand asset from the two master PNGs in brand/source.

The masters are 4000x4000 RGB with a baked white background:
  smelter-mark-master.png    the circular swirl mark, alone
  smelter-lockup-master.png  mark + "smelter" wordmark, horizontal

The artwork ships exactly as delivered -- no tonal variants, no containers, no
recolouring. The only processing is cutting the white background away from around
the mark's circle and recovering the wordmark's alpha, so the logo can sit on
any background while keeping its own colours (the white inside the circle stays
white on a black page).

Usage:  python3 scripts/brand/generate-brand-assets.py
Requires: Pillow, numpy
"""

from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "brand" / "source"
OUT = ROOT / "brand" / "dist"

# Mark disc, measured off the master.
MARK_CENTER = (2002, 2105)
MARK_RADIUS = 1300

# Lockup proportions, measured off the lockup master and expressed as multiples
# of the mark's width so the lockup scales as one unit at any size.
WORDMARK_X0 = 1150          # right of this is wordmark only, in the master
WORDMARK_RED = (255, 80, 73)
GAP_RATIO = 0.1878          # mark -> wordmark
WORDMARK_H_RATIO = 0.7210
WORDMARK_W_RATIO = 3.4765
WORDMARK_DY_RATIO = -0.0635  # wordmark optical centre sits above the mark's

PAPER = (255, 255, 255)     # app icon / favicon ground: the art's native white
SPLASH_BG = (0, 0, 0)       # matches the app's black auth screens


def _circle_alpha(size: int, ss: int = 4) -> Image.Image:
    big = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(big).ellipse((0, 0, size * ss - 1, size * ss - 1), fill=255)
    return big.resize((size, size), Image.LANCZOS)


def build_mark() -> Image.Image:
    """The mark, cut to its circle. Transparent only OUTSIDE the disc."""
    im = Image.open(SRC / "smelter-mark-master.png").convert("RGB")
    cx, cy, r = *MARK_CENTER, MARK_RADIUS
    mark = im.crop((cx - r, cy - r, cx + r, cy + r)).convert("RGBA")
    mark.putalpha(_circle_alpha(mark.width))
    return mark


def build_wordmark() -> Image.Image:
    """The wordmark in its delivered red, with a recovered alpha channel."""
    im = Image.open(SRC / "smelter-lockup-master.png").convert("RGB")
    a = np.asarray(im).astype(float)

    # Red text composited on white: O = alpha*C + (1-alpha)*255, solved on green.
    alpha = np.clip((255.0 - a[:, :, 1]) / (255.0 - WORDMARK_RED[1]), 0.0, 1.0)
    alpha[:, :WORDMARK_X0] = 0.0

    ys, xs = np.nonzero(alpha > 0.02)
    out = Image.new("RGBA", im.size, (*WORDMARK_RED, 0))
    out.putalpha(Image.fromarray((alpha * 255).round().astype(np.uint8)))
    return out.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def build_lockup(mark: Image.Image, word: Image.Image, mark_px: int) -> Image.Image:
    """Mark + wordmark at the delivered proportions, transparent background."""
    gap = round(mark_px * GAP_RATIO)
    ww = round(mark_px * WORDMARK_W_RATIO)
    wh = round(mark_px * WORDMARK_H_RATIO)
    dy = round(mark_px * WORDMARK_DY_RATIO)

    w = mark_px + gap + ww
    h = max(mark_px, wh + abs(dy) * 2)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.alpha_composite(mark.resize((mark_px, mark_px), Image.LANCZOS),
                        (0, (h - mark_px) // 2))
    out.alpha_composite(word.resize((ww, wh), Image.LANCZOS),
                        (mark_px + gap, (h - wh) // 2 + dy))
    return out


def on_ground(mark: Image.Image, size: int, inset: float, ground) -> Image.Image:
    """Opaque square tile -- platform icons cannot ship transparency."""
    tile = Image.new("RGB", (size, size), ground)
    inner = round(size * inset)
    m = mark.resize((inner, inner), Image.LANCZOS)
    tile.paste(m, ((size - inner) // 2, (size - inner) // 2), m)
    return tile


def save(im: Image.Image, rel: str):
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    im.save(p, optimize=True)
    print(f"  {rel:<46} {im.width}x{im.height}")


def distribute():
    jobs = [
        ("mark/smelter-mark-512.png",       "assets/images/smelter-mark.png"),
        ("lockup/smelter-lockup-1200.png",  "assets/images/smelter-lockup.png"),
        ("icon/app-icon-1024.png",          "assets/images/app-icon.png"),
        ("icon/adaptive-icon-foreground-1024.png",
                                            "assets/images/adaptive-icon.png"),
        ("splash/splash-1284.png",          "assets/images/splash.png"),
    ]
    for site in ("web", "marketing"):
        jobs += [
            ("mark/smelter-mark-512.png",      f"{site}/public/brand/smelter-mark.png"),
            ("lockup/smelter-lockup-1200.png", f"{site}/public/brand/smelter-lockup.png"),
            ("icon/favicon-512.png",           f"{site}/src/app/icon.png"),
            ("icon/favicon-180.png",           f"{site}/src/app/apple-icon.png"),
        ]

    print("\ndistributing:")
    for src, dst in jobs:
        d = ROOT / dst
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(OUT / src, d)
        print(f"  {dst}")


def main():
    mark = build_mark()
    word = build_wordmark()
    print(f"mark {mark.size}   wordmark {word.size}")

    print("\nmark (transparent outside the disc):")
    for s in (1024, 512, 256, 128, 64):
        save(mark.resize((s, s), Image.LANCZOS), f"mark/smelter-mark-{s}.png")

    print("\nlockup (mark + red wordmark, scales as one unit):")
    for total_w in (2400, 1200, 600):
        mark_px = round(total_w / (1 + GAP_RATIO + WORDMARK_W_RATIO))
        save(build_lockup(mark, word, mark_px), f"lockup/smelter-lockup-{total_w}.png")

    print("\nplatform icons (white ground -- the art's native background):")
    save(on_ground(mark, 1024, 0.80, PAPER), "icon/app-icon-1024.png")
    fg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    inner = round(1024 * 0.58)                      # Android adaptive safe zone
    fg.alpha_composite(mark.resize((inner, inner), Image.LANCZOS),
                       ((1024 - inner) // 2,) * 2)
    save(fg, "icon/adaptive-icon-foreground-1024.png")
    for s in (512, 192, 180, 32, 16):
        save(on_ground(mark, s, 0.86, PAPER), f"icon/favicon-{s}.png")

    print("\nsplash (black, matching the app's auth screens):")
    save(on_ground(mark, 1284, 0.42, SPLASH_BG), "splash/splash-1284.png")

    distribute()


if __name__ == "__main__":
    main()
