# Row numbers and a status bar

Two additions the author asked for after comparing the playground with AG Grid's
Theme Builder demo, where both are grid features you tick on: a leading column
carrying each row's position, and a band under the table stating facts about the
result set.

**Licence.** AG Grid's status bar panels beyond the row counts (selection and
aggregation) are Enterprise. Their published behaviour may inform the design; no
code is read or ported. Everything here is our own.

---

## 1. Both are feature flags, off by default

`DataTableFeatureFlags` gains two entries. Unlike every flag already there,
these default to **false**: the existing flags each turn OFF a rearrangement the
table has always offered, so `true` preserves behaviour, whereas these two add
furniture a host did not ask for. A table that gains a numbered column and a new
band on upgrade would be a breaking change dressed as a minor one.

```ts
/** A leading column numbering the rows. Default false. */
rowNumbers?: boolean
/** A band under the table stating what the result set contains. Default false. */
statusBar?: boolean
```

The playground's Grid Features group gets both checkboxes, translated in all
three chrome languages, so the author can see them the way the screenshot does.

---

## 2. The row-number column

### What the number means

**The row's 1-based position in the whole result set**, not in the page:
`pageIndex * pageSize + indexOnPage + 1`. Numbering restarting at 1 on page 2 of
a hundred thousand rows tells the user nothing they did not already know, and
this table is server-paged, so the offset is the one thing the client always has.

**Every flattened row is numbered, group rows included.** This is the decision
most likely to be questioned, so it is written down: AG Grid leaves group rows
blank, but it can, because it holds the whole result. Numbering only leaves
requires knowing how many group rows precede this page — a count no field on the
wire carries and one the client cannot derive from a page. Numbering everything
is computable from the page offset alone and is truthful about position in the
list being looked at. The README says so beside the grouping contract.

**The "continued" group header takes no number.** It is drawn by the client from
`startPath`, not returned by the server, so consuming a number would make every
row after a page boundary off by one. Its number cell is empty.

### What the column is

It is **chrome, not a column of data**, and the difference decides every
remaining question:

- It leads the table, before the group column when grouping is active.
- Pinned to the start, and not unpinnable.
- Not sortable, not filterable, not groupable, not editable, not hideable, not
  reorderable, and **absent from the Columns panel tree** — a tick that could
  remove it would contradict the flag that put it there.
- Resizable, with a default width wide enough for the largest number the current
  `rowCount` can produce. A width the user sets belongs in the saved layout like
  any other column width.
- Its header cell is empty to the eye and named for a screen reader through a
  new `rowNumber` label, in all three label sets.

It must not disturb what already exists: `declaredLeafIds` answers about the
host's declarations and must keep doing so, the drop-slot invariant in
`ReorderInvariant.test.tsx` must still hold with the column present, and
`dropRegionOf` must place it where nothing can be dropped beside it.

### Failure modes that need a test each

- A page whose server answer arrives while the user is on a later page: the
  number must come from the page the rows belong to, never from a stale offset.
- `rowCount` undefined, before a server has answered.
- A grouped page whose first row is a leaf (the `startPath` case).
- Client mode, where the page offset comes from a different place than in server
  mode, and unpaginated client mode, where there is no offset at all.
- The column present together with pinned columns, so the sticky offsets that
  `column.getStart()` computes still add up.

---

## 3. The status bar

### Why it is not the footer

The footer already prints `Rows: 100 000` beside the page controls. A status bar
repeating it would be duplication, and the version in the screenshot is a band of
its own above the pagination for a reason: **the footer is navigation, the status
bar is what the result contains.** So when the status bar is on, the row count
moves out of the footer into it, and the footer keeps the page-size selector, the
range and the page buttons. With the status bar off the footer is exactly what it
is today. This is the whole interaction between them, and a test pins both
shapes.

### What it says

- **Total rows** — `rowCount`, in the same formatting the footer already uses, so
  the two never disagree about what a thousand looks like.
- **Filtered** — when any filter or the quick search is narrowing the result, the
  count is labelled as filtered rather than total. To say *filtered out of how
  many* the server has to tell us, because a server-side filter means the client
  never sees the wider set: the page answer gains an **optional**
  `unfilteredTotal`. When it is absent the bar says only how many rows matched,
  which is honest; when present it says `X of Y`. Absent must be the graceful
  case, not a hole.
- **Grouped by** — when grouping is active, the columns being grouped by, in
  order, reusing the label the Row Groups chips already speak.
- **A host slot.** `statusBar` on `DataTable` may also take a `ReactNode` instead
  of `true`, rendered at the end of the band, so a host can state something this
  library has no business knowing. Same flag, two shapes, one decision for the
  host to make.

**Not in this version:** selected-row counts (there is no row-selection feature
for them to count) and aggregations such as sum and average (the Values zone is
explicitly deferred on the roadmap, and an aggregate over one page of a
server-side result would be wrong in the way client-side grouping would have
been). Neither is a gap to fill quietly later; both need their own decision.

### Shape

A `role="status"` region with `aria-live="polite"`, because its whole job is to
report a change the user caused elsewhere. Polite, not assertive — a row count
must never interrupt what a screen reader is reading. Its parts are separate
elements with their own labels rather than one concatenated sentence, so a
translation can reorder them.

Every string goes through `DataTableLabels`. The Russian ones need plural
agreement on every count (one / few / many, with the 11–14 exception the existing
helper already handles).

---

## 4. Constraints that hold throughout

- Every new string lands in `src/labels/ru.ts` and `src/labels/uz.ts` in the same
  commit, with the ʻ U+02BB / ʼ U+02BC orthography the Uzbek file enforces.
- No new `--dt-*` token unless unavoidable; both shadcn presets must map every
  one and `src/themes/themes.test.ts` enforces it.
- Animate only `transform` and `opacity`; honour `prefers-reduced-motion`.
- Keyboard-reachable and named throughout; contrast at WCAG AA in every theme.
- The fake server must actually answer `unfilteredTotal`, so the playground shows
  the filtered case working rather than mocking it at the last step.
