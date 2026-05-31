# Quick Order list rows must stay on one line

This note exists because the "ragged spacing" bug keeps coming back. Any list of
`name … value` rows in Quick Order (the floating **Order list** card and the
inventory-mode **Updated** card) must render **one row per line**. When a row is
allowed to wrap, a long item name pushes its trailing value/action onto a second
line, every row ends up a different height, and the card looks like the items are
floating with uneven gaps.

## The rule

A row is two pieces on a single line:

```
[ name (+ counted qty) ……………… ellipsizes ]   [ trailing value / action ]
        flexShrink: 1, minWidth: 0                    flexShrink: 0
        numberOfLines={1}                             flexDirection: 'row'
        ellipsizeMode="tail"
```

- The **name** takes the leftover width and is the only thing allowed to give:
  `flexShrink: 1` + `minWidth: 0` + `numberOfLines={1}` + `ellipsizeMode="tail"`.
  When there isn't enough room it truncates with `…` instead of wrapping.
- The **trailing cluster** (the `→ 1 piece` value, the `Needs input ›` button,
  or the `– 0 cases` no-order text) is a `flexDirection: 'row'` View with
  `flexShrink: 0`, pinned immediately after the name. Because it never shrinks,
  the action the user actually needs is always fully visible.
- **Never put `flexWrap: 'wrap'` on the row or any of its children.** Wrapping is
  exactly what produced the old two-line rows. The icon, dash, label, and chevron
  all live inside the non-shrinking trailing cluster so they travel together.

## Why `minWidth: 0` matters

A flex child defaults to `min-width: auto`, which refuses to shrink below its
content's intrinsic width. Without `minWidth: 0` the name will not truncate — it
overflows or forces a wrap no matter what `numberOfLines` says. Setting
`minWidth: 0` is what actually lets the ellipsis kick in.

## Where this lives

- Inventory-mode "Updated" card:
  [`src/features/ordering/QuickOrderInventoryUpdateCard.tsx`](../src/features/ordering/QuickOrderInventoryUpdateCard.tsx)
  (`styles.row`, `styles.rowName`, `styles.trailing`).
- Order list card rows:
  [`src/features/ordering/QuickOrderItemRow.tsx`](../src/features/ordering/QuickOrderItemRow.tsx)
  (`styles.nameCluster` + the trailing action) — the original reference layout.

## Regression guard

[`src/__tests__/quickOrderInventoryUpdateCard.test.ts`](../src/__tests__/quickOrderInventoryUpdateCard.test.ts)
renders the card and asserts the invariants directly:

- the item name `Text` has `numberOfLines === 1`, `flexShrink === 1`, `minWidth === 0`;
- **no** element in the tree has `flexWrap: 'wrap'`;
- the trailing cluster is a non-shrinking (`flexShrink === 0`) row.

If you change the row markup, keep that test passing. If you add another
`name … value` list to Quick Order, copy this layout and add the same assertions
rather than reaching for `flexWrap`.
