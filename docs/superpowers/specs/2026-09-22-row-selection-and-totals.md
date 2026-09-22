# Row selection, a bulk-action slot, and a totals footer

Three gaps an ERP hits on day one: you cannot pick rows, so you cannot act on
them in bulk, and a money column has no total under it.

**Decided — do not reopen.**

- The header checkbox means **everything the current query matches**, not the
  fifty rows on screen. A user approving 25 000 receipts must not page through
  500 screens.
- Totals come from the **host, as a prop**. The page answer is not touched.

---

## 1. What a selection IS

Not a list of ids. A hundred thousand ids is not a thing to hold, publish, or
put in a `WHERE` clause — and the rows a user means are mostly rows the browser
has never seen.

```ts
type SelectionModel =
  /** Rows the user picked one at a time. The empty array is "nothing". */
  | { mode: "ids"; ids: readonly string[] }
  /** Everything the query matches, minus the rows the user unticked. */
  | { mode: "all-matching"; excluded: readonly string[] }
```

The header checkbox flips between `{ mode: "ids", ids: [] }` and
`{ mode: "all-matching", excluded: [] }`. Unticking a row in `all-matching` adds
to `excluded`; ticking one in `ids` adds to `ids`. Neither mode ever converts
into the other by accident — a user who unticks every row of a page while in
`all-matching` still has "everything except these fifty", which is the correct
reading of what they did.

**The count.** In `ids` it is `ids.length`. In `all-matching` it is
`rowCount - excluded.length`, and it is *undefined* until the server has
answered with a `rowCount` — say so rather than showing a wrong number.

### The rule that makes this safe

**A change to the query clears the selection.** `all-matching` is defined
relative to a query; when the filter, the search or the grouping changes, "all
matching" silently comes to mean a different set of rows — a selection of 25 000
becoming a selection of 90 000 with no gesture from the user, and then a bulk
action on them. Sorting and paging do NOT clear it: neither changes which rows
match, only their order and which slice is on screen.

This is the one rule most likely to be quietly dropped during implementation. It
needs its own test, and the test needs to assert the cleared selection reaches
the host, not merely that the checkbox looks empty.

### What the host receives

```ts
onSelectionChange?: (selection: {
  mode: "ids" | "all-matching"
  ids?: readonly string[]
  excluded?: readonly string[]
  /** The query the selection is relative to. Meaningless without it. */
  query: TableQuery
  /** Undefined until a server has answered. */
  count: number | undefined
}) => void
```

A backend turns `all-matching` into `WHERE <the query's filters> AND id NOT IN
(<excluded>)`. The README carries that SQL beside the filter and grouping SQL it
already documents.

### Constraints that fall out

- **`getRowId` is required.** Without it TanStack keys rows by position, and a
  selection would follow the *slot* rather than the record across a page change.
  Warn through the existing `warnOnce` the moment selection is switched on
  without it, and say what goes wrong rather than that something is missing.
- **Selection is not layout.** It never goes to `storage`; `pruneLayout` is a
  whitelist and must keep ignoring it. A selection restored from last week,
  against a query that has since changed, is the failure above wearing a hat.
- **Group rows are not selectable in this version.** A group stands for children
  the browser does not hold, so a tick on one cannot honestly mean anything yet.
  The checkbox cell on a group row is empty, and the README says why.

---

## 2. The selection column

Chrome, exactly as the row-number column is chrome — read `src/core/rowNumbers.ts`
and follow it rather than inventing a second pattern.

- Leads the table: **selection, then row numbers, then the group column.**
- Pinned to the start, not unpinnable, absent from the Columns panel, and alone
  in its own `SOLITARY_PREFIX` region in `dropRegion.ts` so nothing can be
  dropped beside it and it can be dropped nowhere.
- The header cell holds the all-matching checkbox, `indeterminate` when a
  selection exists but is not everything — set through the DOM property, which
  cannot be set from an attribute or CSS.
- Every checkbox is reachable and operable from the keyboard and named for a
  screen reader: a row's says which row, the header's says what it will select
  and how many that is.

---

## 3. The bulk-action slot

`toolbarContent` already exists and is a static `ReactNode` — it knows nothing
about a selection, which is exactly what a bulk-action bar needs.

```ts
renderSelectionActions?: (selection: SelectionSummary) => ReactNode
```

Rendered only while something is selected, in a bar of its own above the table,
and handed a `clear()` alongside the model and the count so the host's "Cancel"
does not have to reach back into the instance. A host that wants the bar always
present can render it from `toolbarContent` instead; this slot is for the thing
that appears *because* rows are selected.

The bar must not push the table down and back on every tick — reserve its space
or animate only `transform`/`opacity`, and honour `prefers-reduced-motion`.

---

## 4. The totals footer

```ts
totals?: Record<string, ReactNode>   // keyed by column id
```

A row under the body, **aligned with the columns**, holding whatever the host
put under each column id and nothing under the rest.

- The library computes nothing. Summing the fifty rows of a page and presenting
  it as the table's total is the same lie that made grouping server-side, and it
  would be a lie the user cannot see.
- It is a `<tfoot>`, so the table's own semantics carry it, and it **sticks to
  the bottom of the viewport** the way the header sticks to the top — a total
  that scrolls away is a total nobody reads.
- It respects pinning: a total under a pinned column stays pinned with it, at
  the same sticky offset `column.getStart()` already computes.
- It respects the column's alignment, so money lands under money.
- Its leading cell carries a label (`labels.totalsRow`, in all three sets), and
  the row is named for a screen reader so it is not read as one more data row.
- With `totals` absent there is no `<tfoot>` at all — not an empty one.

---

## 5. Constraints that hold throughout

- Every new string goes through `DataTableLabels` and lands in `src/labels/ru.ts`
  and `src/labels/uz.ts` in the same commit, with ʻ U+02BB / ʼ U+02BC in Uzbek
  and Russian plural agreement wherever a count is spoken — and a selection
  count is spoken.
- No new `--dt-*` token unless unavoidable; `src/themes/themes.test.ts` enforces
  that both shadcn presets map every one, and text at 4.5:1.
- `src/ReorderInvariant.test.tsx` must still hold with the selection column
  present. Extend it; do not weaken it.
- The playground must show all three working, with the fake server answering a
  real bulk action, so the whole round trip is visible rather than mocked at the
  last step.
