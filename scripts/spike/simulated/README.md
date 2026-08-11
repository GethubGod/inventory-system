# SIMULATED parse outputs — no model was called

GEMINI_API_KEY was not available in this environment, so these `*.parsed.json`
files are HAND-WRITTEN simulations of a plausible Gemini 2.5 Flash parse:
mostly-correct extraction plus typical error modes observed with this model
family on text-in-image tasks (one struck-through item not skipped, one item
dropped inside chat noise, a range taken at its lower bound, an untranslated
CJK unit, a missed shorthand unit). All numbers produced from these files are
SYNTHETIC/SIMULATED. Re-run the real pass with:

    GEMINI_API_KEY=... node scripts/spike/parse-order-screenshot.mjs --out scripts/spike/real scripts/spike/fixtures/*.png
    node scripts/spike/score.mjs --parsed scripts/spike/real
