# Design brief — Babytuna tip-tracking manager dashboard

You are designing a manager dashboard for a small restaurant group. Deliver
**one self-contained HTML file containing three distinct design variants** of
that dashboard.

This brief gives you the domain, the data, and the functional requirements. It
deliberately does **not** tell you how the page should look or how it should be
laid out — the information architecture, visual design, and interaction model
are the work, and they are yours to decide.

---

## 1. Output contract

Write exactly one file:

```
docs/mockups/tips-dashboard/<your-label>.html
```

Replace `<your-label>` with a short lowercase identifier for yourself (e.g.
`claude-opus`, `gpt`, `gemini`). Do not create any other files. Do not modify
any existing file in the repository.

The file must:

- Open and work correctly by double-clicking it — `file://`, no server, no
  build step, no install.
- Be **fully self-contained**. All CSS and JS inline. No CDN links, no external
  fonts, no remote images, no `fetch`. Any imagery must be inline SVG or a
  `data:` URI. A machine with no network must render it identically.
- Contain **three complete variants** of the dashboard, reachable from a
  persistent control at the top of the page (however you choose to present
  that). Switching variants must not reload the page or lose scroll position
  unrecoverably.
- Label each variant with a short name and a **one-to-two sentence design
  thesis** — what this version optimizes for and what it trades away. Put this
  where a reviewer will read it before scrolling into the variant.
- Be populated with the sample data in §6 — all three variants, same numbers.
  Do not invent different data per variant; the comparison is about design.
- Be responsive down to a 1024px-wide laptop screen. Mobile is not required.

Static mockup, not a working app. Buttons and controls do not need real
behavior. Interactions that are *part of the design being evaluated* (switching
variants, opening a modal or drawer, expanding a row, toggling a filter) should
actually work, using local state only, so the reviewer can feel the flow.
Everything else can be inert.

---

## 2. What this product is

Two restaurants — **Babytuna Sushi** and **Babytuna Poki & Pho** — under one
owner.

At the end of each shift, whoever is closing records that shift's tips on a
phone. They open a small web app by scanning a QR sticker by the register,
enter two amounts and pick which staff are splitting, and save. That phone app
already exists and is in use. It is a separate screen from what you are
designing.

You are designing the **manager side**: the single page the owner opens on a
laptop to see what was recorded, fix mistakes, and manage the staff list and
device access.

---

## 3. Who uses it

One person: the owner. Not a finance team, not a shift lead, not a multi-tenant
SaaS admin. He is checking last night's numbers, correcting the occasional
mistake, adding a new hire before their first shift, and pulling a spreadsheet
when it is time to do payroll.

He is on a laptop, usually in the middle of doing five other things. He is not
going to read documentation or discover features by exploration.

---

## 4. The domain rules that matter

**Shifts.** Each restaurant records tips twice a day: **lunch** and **dinner**.
So there are at most four records per day across the group. A record is
uniquely identified by (date, restaurant, meal) — there is exactly one lunch
record for Sushi on a given day, and re-recording it edits the existing one.

**Business date.** The day rolls over at 4am, not midnight. Tips entered at
12:30am after a Friday dinner shift belong to Friday. Dates you display are
business dates.

**Cash and card are treated differently — this is the central rule.**

- **Cash tips are split** evenly among the staff on that shift, and handed out
  that night. The per-person share is what people actually care about.
- **Card tips are recorded but not split.** They are logged for payroll and
  reporting and are paid out through a separate process. They must never be
  included in the per-person share.

Per-person share = **cash ÷ number of people**, rounded to the nearest cent,
with exact half-cents rounding **up** (`$96.25 ÷ 2` = `$48.13`, not `$48.12`).
Card is not in that number. Rounding remainders stay in the drawer, so the
shares will not always sum exactly to the cash total (`$100 ÷ 3` = `$33.33`
each, `$99.99` distributed). This is intentional and correct.

The design needs to make the cash/card distinction legible without a reviewer
having to be told. A manager glancing at a row should not be able to confuse
"the pool that gets split" with "the amount that was logged."

**Flagged entries.** When an amount is wildly out of line with history for that
restaurant and meal (a suspected typo — `$3,000` where the slot normally sees
`$150–$350`), the entry is saved but marked as flagged. The manager should be
able to notice these and act on them. There is no separate approval workflow;
flagging is informational.

**Who entered it.** Each record notes which staff member closed, and whether it
was typed or dictated by voice. Minor metadata, but present.

---

## 5. What the page must do

All four areas below live on **one page**. Do not put them behind a tab bar or
a router — the owner should be able to scroll the whole thing, and this page
will later be embedded as one section inside a larger dashboard. How you order,
group, prioritize, or progressively disclose these areas is a design decision
and a meaningful part of what is being compared.

**A. Review recorded tips.**
Filter by date range and restaurant. See the records in that range with their
cash, card, per-person share, who was on the split, and whether they were
flagged. Show totals for the range and some sense of daily subtotals. Export
to spreadsheet.

**B. Correct a record after the fact.**
The owner needs to fix a shift that was entered wrong — change the cash amount,
the card amount, or who was on the split — without going to the restaurant and
using the phone. Corrections change what people get paid, so the design should
handle confirmation and consequence with appropriate weight.

**C. Manage the staff list.**
Add a person. Rename them. Set which restaurant they work at — Sushi, Poki &
Pho, or both. Control the order they appear in on the phone app's picker, since
that is what closers tap through every night. Deactivate someone who left
(their history must survive) and delete someone added by mistake. A new hire
being added before their first shift is the common case and should be fast.

**D. Device access.**
Each restaurant has a QR sticker and a numeric PIN that let a phone sign in.
Both can be rotated, and each shows when it was last rotated. Rotating the QR
code invalidates the printed sticker and requires printing a new one; rotating
the PIN means telling the closers a new number. There is also a "sign out every
phone at this restaurant" action. These are destructive and infrequent — treat
them accordingly.

A rotated secret is displayed exactly once, immediately after rotation, and is
unrecoverable afterward because only a hash is stored. That one-time reveal is
a real design problem worth solving well.

---

## 6. Sample data — use exactly this

**Staff**

| Name  | Works at     | Status   |
|-------|--------------|----------|
| Maria | Sushi        | active   |
| Jose  | Sushi        | active   |
| Ken   | Both         | active   |
| Rey   | Both         | active   |
| Lena  | Poki & Pho   | active   |
| Tom   | Poki & Pho   | active   |
| Aiko  | Sushi        | inactive |

**Records** (most recent first; per-person is cash ÷ people)

| Date         | Restaurant | Meal   | Cash      | Card    | People            | Per person | Flag |
|--------------|------------|--------|-----------|---------|-------------------|------------|------|
| Sun Aug 9    | Sushi      | Dinner | 412.00    | 688.50  | Maria, Jose, Ken  | 137.33     |      |
| Sun Aug 9    | Sushi      | Lunch  | 96.25     | 210.00  | Maria, Ken        | 48.13      |      |
| Sun Aug 9    | Poki & Pho | Dinner | 188.00    | 402.75  | Lena, Tom         | 94.00      |      |
| Sat Aug 8    | Sushi      | Dinner | 366.50    | 594.00  | Jose, Ken, Rey    | 122.17     |      |
| Sat Aug 8    | Poki & Pho | Dinner | 205.75    | 388.00  | Lena, Tom, Rey    | 68.58      |      |
| Sat Aug 8    | Poki & Pho | Lunch  | 74.00     | 165.25  | Lena              | 74.00      |      |
| Fri Aug 7    | Sushi      | Dinner | 3,100.00  | 610.00  | Maria, Jose       | 1,550.00   | ⚑    |
| Fri Aug 7    | Sushi      | Lunch  | 88.50     | 174.00  | Maria             | 88.50      |      |
| Fri Aug 7    | Poki & Pho | Dinner | 197.25    | 351.50  | Tom, Rey          | 98.63      |      |
| Thu Aug 6    | Sushi      | Dinner | 344.00    | 561.25  | Maria, Jose, Ken  | 114.67     |      |

Range totals across those ten records: **cash $5,072.25**, **card $4,145.25**,
10 records. Note that the flagged Friday dinner is the reason the cash total
looks the way it does — a good design lets a reviewer notice that.

Every per-person figure above is already correct under the §4 rule; reproduce
them as given. Two of them (`48.13` and `98.63`) land on an exact half-cent and
are the reason the rounding direction is specified.

**Access state**

| Restaurant | QR sticker rotated | PIN rotated  |
|------------|--------------------|--------------|
| Sushi      | Aug 8, 2026        | Aug 8, 2026  |
| Poki & Pho | never              | Aug 8, 2026  |

---

## 7. Visual context

The phone app these records come from uses a warm, flat, quiet visual language.
Stating it as fact, not as instruction:

```
cream background   #f5f1e8      accent / primary   #e84d38
white cards        #ffffff      accent tint        #fbeae7
primary text       #1a1a1a      alert text         #c03520
secondary text     #5f5f5f      muted text         #9c9890
hairline           rgba(0,0,0,0.06)
card radius 20px · inner radius 14px · system sans-serif
no gradients, no drop shadows, no decorative emoji
```

You may carry this into the dashboard, adapt it for a denser laptop surface, or
argue for something different — a phone form for one closer and a laptop
console for the owner are not the same design problem. If you depart from it,
say so in the variant's thesis.

---

## 8. The three variants

They must be **three genuinely different answers**, not one answer in three
color schemes. Vary the things that actually change how the page works:
what gets priority, how much is visible at once versus revealed on demand,
how editing is entered and confirmed, how dense the data presentation is,
how the destructive actions are kept away from the routine ones.

For each variant, commit to a thesis and follow it through consistently. A
variant that is clearly the wrong choice for this user but internally coherent
and well-argued is more useful to the comparison than three cautious middles.

Do not rank them or mark one as recommended. The point is comparison.

---

## 9. Constraints and non-goals

- No frameworks, no build tooling, no external requests. Plain HTML, CSS, and
  vanilla JS in one file.
- No login screen, no authentication flow — assume the owner is already in.
- No charts library. If a chart earns its place, hand-draw it in SVG.
- Don't design the phone entry app. It exists; it isn't the deliverable.
- Don't add features nobody asked for (payroll runs, scheduling, messaging,
  notifications, multi-tenant settings, dark mode toggles). Depth on the four
  required areas beats breadth.
- Keep it accessible: real semantic elements, labeled controls, focus-visible
  states, and text contrast that holds up. This counts as part of the design.

---

## 10. Before you finish

Check each one honestly:

- [ ] Opens from `file://` with no network and renders identically.
- [ ] All three variants present, switchable, each with a visible thesis.
- [ ] Per-person share equals cash ÷ people everywhere it appears. Card is
      never folded into it.
- [ ] A first-time viewer can tell, without explanation, which money gets split
      and which is only logged.
- [ ] All four functional areas (§5) are present in every variant.
- [ ] The flagged record is noticeable.
- [ ] Adding a new hire is quick to find and quick to complete.
- [ ] Rotating a QR code or PIN reads as consequential, and the one-time reveal
      of the new secret is handled.
- [ ] The three variants would lead to visibly different products.

Do not write a summary document, a README, or a report. The HTML file is the
entire deliverable.
