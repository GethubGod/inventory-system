# smelter brand assets

Everything shipped by the app, `web/`, and `marketing/` is derived from the two
masters in `source/`. Regenerate with:

```
python3 scripts/brand/generate-brand-assets.py    # needs Pillow + numpy
```

That also copies the results into all three consumers, so it is the only step
needed after the masters change.

## The rule

**The artwork ships exactly as delivered.** No tonal variants, no containers or
rings, no recolouring. The only processing is cutting the white background away
from *outside* the mark's circle and recovering the wordmark's alpha.

Inside the circle the art keeps its own colours — so on a black page the white
in the swirl stays white. That is the intended look, on every background.

| Asset | Use |
|---|---|
| `mark/` | the globe alone, for tight spots |
| `lockup/` | globe + red wordmark, scaling as one unit — the default |

The lockup's height equals the mark's diameter, and its width is `4.6615 ×`
that. `SmelterLogo height={n}` (web) and `AuthLogoHeader size={n}` (native)
both take that height, so the whole lockup scales from one number.

Proportions are measured off the lockup master and held exactly: gap
`0.1878 ×` mark width, wordmark `3.4765 ×` wide and `0.7210 ×` tall, sitting
`0.0635 ×` above the mark's centre. Wordmark red is the delivered `#ff5049`,
which is intentionally a little brighter than the UI accent `#e84d38`.

## Backgrounds

The mark is a light artwork (median luminance 234): 17.5:1 on black, 1.1:1 on
our cream. It is used as delivered on both, so on light surfaces it reads as a
pale sphere and it is at its strongest on dark ones. Give it room — at roughly
24px and below on a light page the swirl detail stops resolving.

App icon and favicon sit on **white**, the art's native ground. The splash
stays **black**, matching the auth screens that follow it.

Anything that prints (the QR sticker sheet) needs `print-color-adjust: exact`,
or the logo drops out of the printout.

## Geometry

Both masters are 4000×4000 with a baked white background. The mark's disc is a
circle of radius 1300 centred at (2002, 2105); the wordmark in the lockup
master starts right of x=1150. Those constants live atop the generator.
