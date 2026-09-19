# @khojiakbarr/data-table

A React data table that lets people rearrange it — pin columns to either edge, drag to
reorder, drag to resize, sort, hide — and remembers how each person left it.

Built on [TanStack Table v9](https://tanstack.com/table). Ships as a hook plus an
optional styled shell, so you can take the behaviour and write your own markup.

```bash
npm i @khojiakbarr/data-table @tanstack/react-table @tanstack/react-virtual
```

```tsx
import { DataTable, useDataTable, localStorageLayout } from "@khojiakbarr/data-table"
import "@khojiakbarr/data-table/styles.css"

function Receipts({ data, columns }) {
  const table = useDataTable({
    id: "receipts",              // required — see "Two tables on one page"
    data,
    columns,
    storage: localStorageLayout(),
    initialLayout: { columnPinning: { start: ["code"], end: ["status"] } },
  })

  return <DataTable instance={table} striped height={480} />
}
```

---

## What it does

| | |
|---|---|
| **Nested column groups** | Group headers to any depth. A column that sits above the deepest level spans down to meet the rows. |
| **Pin columns** | To the start edge, the end edge, or both. Pinned columns stay put while the rest scrolls, with a shadow marking the seam. |
| **Resize columns** | Drag the right edge of a header; double-click it to fit the column to its content. A group header's edge resizes every column under it. Columns are never stretched to fill the container. |
| **Reorder columns** | Drag a header onto another; the column it will land on is outlined. Also from the keyboard, in the **Columns** panel. |
| **Sort** | Click a header: ascending, descending, off. Multi-sort shows its position. |
| **Quick search** | One box over every searchable column. Every token must appear somewhere on the row; different tokens may match different columns. |
| **Filter columns** | Text, number, date, boolean and values-list filters, from the header menu or the side panel's Filters tab. Each one is published as an explicit operator a backend can translate. |
| **Hide columns** | From the **Columns** panel. |
| **Expand rows** | A detail panel under a row, child rows that indent by depth, or both. Nesting is unlimited. |
| **Per-column menu** | Right-click a header, or use its ⋮ button: sort, pin, fit width, hide. |
| **Remember all of it** | Per table, per user, wherever you choose to put it. |

---

## Nested columns

Use TanStack's `group()` helper. Wrap each group's children in `columns()` so
TypeScript keeps each column's own value type:

```tsx
const col = createColumnHelper<DataTableFeatures, Receipt>()

const columns = [
  col.accessor("code", { header: "Code", size: 100 }),
  col.group({
    id: "document",
    header: "Document",
    columns: col.columns([
      col.accessor("partner", { header: "Partner", size: 240 }),
      col.accessor("city", { header: "City", size: 170 }),
    ]),
  }),
  col.accessor("status", { header: "Status", size: 120 }),
]
```

```
┌──────┬──────────────────────┬────────┐
│      │       Document       │        │
│ Code ├───────────┬──────────┤ Status │
│      │  Partner  │   City   │        │
├──────┼───────────┼──────────┼────────┤
```

`Code` and `Status` span down to the rows on their own; you do not declare that.
Group headers carry no sort or drag control — those act on one column. A group's
width is the sum of its children's, and dragging a group's edge scales them all by
the same proportion.

Widths are declared in a `<colgroup>` rather than on each cell. Under
`table-layout: fixed` the browser reads widths from the first row only, which
with grouped headers is a row of spanning cells — so per-cell widths get
divided evenly and every column comes out the wrong size.

---

## Column widths

Every column is exactly as wide as it says. The table is as wide as its container
or as wide as its columns, whichever is larger, and any space left over goes to a
blank filler column between the scrolling columns and the end-pinned ones — the
way AG Grid leaves room after its last column.

The alternative, stretching columns to fill the container, is what makes resizing
feel broken: every rendered width then differs from the declared one, so dragging
one edge visibly moves every other column, and pinned offsets (which are sums of
declared widths) land in the wrong place.

Widths are clamped to `minColumnWidth` / `maxColumnWidth` (or a column's own
`minSize` / `maxSize`) when they are written, so a stored layout never holds a
width the table would refuse to render. A press-and-release on a handle changes
nothing and marks nothing.

**Fit to content.** Double-click a handle, press Enter on it, or use *Fit this
column* / *Fit all columns* from the column menu. Fitting measures the rows
currently rendered — header, cells, and in the first column the expand toggle
and indent of nested rows. On a virtualised table (the default — see
[Large data](#large-data)) "currently rendered" means the current viewport,
not the whole dataset: a wide value scrolled out of view is not accounted for
until it is fitted again. *Fit all columns* also keeps every group label
readable by widening the group's children when they come up short.

**Keyboard.** With a resize handle focused, ← and → change the width by 10px,
Shift-← and Shift-→ by 50px, Enter fits the column.

**Right-to-left.** Pass `direction: "rtl"` to the hook so a drag away from the
column widens it there too.

---

## Large data

Rows are virtualised: only the rows in view (plus a few either side) are in
the DOM, whatever the row count. Data rows have a known height —
`rowHeight` (default 40) or `getRowHeight(row)` — so the scrollbar is exact
without measuring anything; only open detail panels are measured. Pass
`virtualize={false}` to render every row (printing, very small tables).

```tsx
useDataTable({ id: "receipts", data, columns, rowHeight: 32 })
// or, when rows vary in height:
useDataTable({ id: "receipts", data, columns, getRowHeight: (row) => rowHeightFor(row) })
```

`getRowHeight` may be written inline like that: its identity is not a
measurement input, so a new arrow on every render costs nothing. It does have
to be a pure function of its row.

**Changing what it answers.** A density toggle, or any other swap of the
height policy for rows the table already holds, is noticed by asking the
function again — for every row on screen, and for 16 rows spread evenly over
the whole list. That second sample is what catches a change below the fold,
and it is deliberately a fixed 16 rather than every row: this runs on each
render, and a 100 000-row table has to stay cheap. So the promise is exact
and bounded rather than unconditional:

- a change over **any run of about `rowCount / 16` neighbouring rows** — every
  row, every row of a kind, a whole region — is seen at once, wherever it is
  and whether or not any of those rows are on screen;
- a **narrower** change with **no row on screen** in it (one outlier row
  10 000 places down) is the one the sample can step over. Nothing is wrong on
  screen, but the scrollbar is short by the difference until those rows are
  scrolled to.

Pass **`heightVersion`** when your policy can change that narrowly — any value
that changes with the policy. It re-estimates every row at once:

```tsx
useDataTable({ id: "receipts", data, columns, getRowHeight, heightVersion: density })
```

It costs one pass over the rows each time the value changes, which is why it
is opt-in rather than the default. A change to `data` or to `rowHeight`
already re-estimates everything on its own — `heightVersion` is only for a
policy that moves while both of those stand still.

**Virtualisation needs something to scroll.** The table's root has no height
of its own, so a table given neither `height` nor an ancestor with a height
grows to fit its rows: nothing scrolls, the visible "window" is the whole
list, and 100 000 rows go into the DOM. Give it a bound:

```tsx
<DataTable instance={table} height={520} />          // the table's own box
<div style={{ height: "100%" }}><DataTable … /></div> // or an ancestor's
```

A table that ends up unbounded anyway is not left to freeze: once measured as
unable to scroll while holding more rows than any screen can show, its
viewport falls back to `--dt-viewport-max-height` (70vh) and says so in the
console in development. Set the token to `none` to opt out of the rescue. A
table that already scrolls — bounded by the prop, by an ancestor, by anything
— is never touched by it.

`<DataTable>` sets `--dt-row-height` as an **inline** style on its root
element — it has to, so the virtualiser's row estimate and the CSS token
never disagree. An inline style beats every selector-based rule short of
`!important`, so `.my-app { --dt-row-height: 32px }` in a stylesheet has no
effect on it. Reach for `!important` if you must override it from CSS; the
supported way is to pass `rowHeight` / `getRowHeight` instead, which is what
actually drives both the row and the token.

---

## Server-side data

Set `mode: "server"` and the table stops sorting and paging: `data` is one
page, already sorted, and the table tells you what it wants through a
`TableQuery` — sorting, filters, quick search, pagination, and (reserved for
row grouping) `grouping`. With TanStack Query:

```tsx
const EMPTY: Receipt[] = [] // stable identity, so an empty page isn't a new `data` array every render
const [query, setQuery] = useState<TableQuery>()
const { data, isFetching, error, refetch } = useQuery({
  queryKey: ["receipts", query],
  queryFn: () => api.receipts(query!),
  enabled: query !== undefined,
  placeholderData: keepPreviousData,
})
const table = useDataTable({
  id: "receipts",
  columns,
  mode: "server",
  data: data?.rows ?? EMPTY,
  rowCount: data?.total, // undefined until the response arrives; rowCount accepts that
  getRowId: (row) => row.id,
  onQueryChange: setQuery,
})
<DataTable instance={table} loading={isFetching} error={error} onRetry={refetch} />
```

`onQueryChange` fires once on mount with the persisted sorting and page size,
then on every change. Sorting resets the page to the first; a new `data`
array does not. Give rows a stable `getRowId` so expansion follows records
across pages. `instance.query` holds the same object and only changes
identity when its contents change.

**Pagination** is on by default in server mode and off in client mode; pass
`pagination: { pageSize: 100, pageSizeOptions: [50, 100, 500] }` to change
either. The footer shows the total, a page-size select, the current range and
first/previous/next/last controls with a page number box. The chosen page
size is persisted with the rest of the layout.

**States.** `loading` with no rows shows skeleton rows; with rows it shows a
progress bar and dims them. `error` shows a banner with a Retry button that
calls `onRetry`; rows already on screen stay put.

**The empty state waits for the first answer.** The initial query is announced
from an effect, one commit after mount, so a server table always commits at
least one render with no rows, no error and `isFetching === false` — the query
above is still disabled — and a host that starts its request from an effect of
its own commits a second. Those look exactly like "the server has nothing",
and a table that believed them would flash "No rows" before its first
skeleton. It does not: in server mode the empty state waits until the host has
answered once, where an answer is rows, a `rowCount` (`0` counts — an empty
page is an answer), an `error`, or `loading` turning true. The recipe above
reports all four, so copying it is enough.

The other side of that guarantee: a server table whose host reports none of
the four has said nothing the table can read, and keeps its skeleton rather
than claiming an emptiness nobody confirmed. Pass `rowCount` with each page —
server mode needs it for the footer anyway — and `loading` while the request
is out. A shell of your own has to draw the same line: no rows, no error,
nothing loading and `rowCount === undefined` means the query has not been
answered yet, not that the answer was empty.

### Filters on the wire

A filter is not a client-side trick that happens to work remotely: it is a value
you hand to your backend and translate into SQL without interpreting anything.

```json
{
  "sorting": [{ "id": "created", "desc": true }],
  "filters": [
    { "kind": "number", "field": "amount",  "op": "between",  "from": 1000000, "to": null },
    { "kind": "date",   "field": "created", "op": "range",    "from": "2026-03-01", "before": "2026-04-01" },
    { "kind": "text",   "field": "partner", "op": "contains", "value": "agro" },
    { "kind": "list",   "field": "status",  "op": "in",       "values": ["in_process", "open"] }
  ],
  "search": { "text": "KR-102", "fields": ["code", "partner", "status"] },
  "grouping": [],
  "pagination": { "pageIndex": 0, "pageSize": 50 }
}
```

`filters` is a flat array, implicitly ANDed, and **sorted by `field`** — which is
why `amount` comes first here rather than the order the user set the filters in.
Sorting it is what stops a column drag changing the query string and making you
refetch an identical result set. When cross-column OR eventually ships it will
arrive as a **new optional field**, never as a change to the element type, so a
backend written against this shape keeps working.

| Operator | On | Means |
|---|---|---|
| `contains` / `notContains` | text | Substring, **case-insensitive** |
| `equals` / `notEquals` | text | Whole value, **case-insensitive** |
| `startsWith` / `endsWith` | text | **Case-insensitive** |
| `eq` `ne` `lt` `lte` `gt` `gte` | number | |
| `between` | number | **Inclusive on both ends**; `null` is unbounded |
| `range` | date | `from <= value < before`; either bound may be `null` |
| `is` | boolean | |
| `in` / `notIn` | list | |
| `blank` / `notBlank` | every kind | Nullish or empty, and its complement |

A published operator's meaning never changes; new behaviour gets a new name. Four
rules are easy to get wrong, and the table itself follows all four.

**All six text operators are case-insensitive**, `equals` included. A backend
using a case-sensitive collation will return different row counts from client
mode for the same filter, and your users will report that as a data bug.

**`between` is inclusive on both ends.** AG Grid's number `inRange` is exclusive
by default, so a backend ported from it will disagree.

**Negated operators never match a blank value.** `notContains`, `notEquals` and
`notIn` exclude a row whose value is `NULL` or `''`, because that is what
`NOT (col ILIKE …)` does in SQL, where a comparison against NULL is NULL rather
than true. The number comparators do the same: a nullish value satisfies none of
them. `blank` is the operator for reaching those rows, and `blank` / `notBlank`
partition every row between them:

```sql
-- blank
(col IS NULL OR col::text = '')
-- notBlank
(col IS NOT NULL AND col::text <> '')
```

The `IS NOT NULL` guard is not optional — the naive `col <> ''` silently excludes
every NULL through three-valued logic, and then the two operators no longer
partition the table. For a non-text column the `''` half is always false and may
be dropped.

**A date range is half-open**, always: `from` is inclusive, `before` is exclusive.
One clause covers every case, and it is correct whether the column is a `date` or
a `timestamptz`:

```sql
(:from   IS NULL OR created >= :from)
AND (:before IS NULL OR created <  :before)
```

The bug this prevents: an inclusive `<= '2026-03-31'` against a timestamp column
silently drops every row recorded during that last day. The table never emits a
time or a zone — a day is a day in the user's calendar. If you store instants,
converting the day boundary into your own zone is your decision to make and to
document.

**Quick search is AND over tokens, OR over fields.** Split `text` on whitespace;
every token must appear, case-insensitively, in at least one of `fields` on that
row; different tokens may match different columns. The naive `contains: text`
across the fields disagrees with client mode the moment a user types two words.

```ts
const { text, fields } = query.search!
where: {
  AND: [
    { amount:  { gte: 1000000 } },
    { created: { gte: new Date("2026-03-01"), lt: new Date("2026-04-01") } },
    { partner: { contains: "agro", mode: "insensitive" } },
    { status:  { in: ["in_process", "open"] } },
    // Every token must hit some field; different tokens may hit different fields.
    ...text.split(/\s+/).map((token) => ({
      OR: fields.map((f) => ({ [f]: { contains: token, mode: "insensitive" } })),
    })),
  ],
}
```

Every text operator carries `mode: "insensitive"`, `equals` included. The
`new Date("…")` calls are the backend choosing to read a calendar day as UTC
midnight, which is its prerogative and its decision to document.

`fields` is a list of columns your backend should be prepared to search. Quick
search over unindexed text columns is a good way to take down a database with
three characters; mark sensitive or unindexed columns as unsearchable so they
never reach `fields`.

**The operator vocabulary is closed.** The operators in the table above are the
whole list, and a condition carrying anything else is dropped rather than
published — a backend cannot be expected to translate an operator it has never
seen, and minting one locally would produce a filter that works in client mode
and silently does nothing in server mode. A host that needs different *matching*
keeps the vocabulary and changes the client half of it: `columnDef.filterFn`
accepts a function as well as a name, such a function needs no registration, and
it receives the column's own `FilterCondition` as its filter value — so it can
change how `contains` matches without inventing a `matchesRegex`. A host that
needs something the vocabulary cannot express at all turns the built-in filter
off for that column with `meta: { filter: false }` and keeps its own control
beside the table; what reaches `query.filters` is always one of the conditions
documented here.

**`meta.filter` picks the editor; it does not type the value.** A condition's
value is not checked against the column's own `TValue`, because `columns` is
`ColumnDef<…, any>[]` and there is no per-column value type left to check it
against. `meta: { filter: "number" }` on a text column compiles, and the
mismatch turns up at runtime as a filter that matches nothing. Declare the kind
that matches the data; a column that declares nothing has its kind inferred from
its first non-null value — string → text, number → number, boolean → boolean,
anything else → text — which is a convenience and not a contract, and is why a
stored condition is dropped on load when the kind it was built for is no longer
the kind the column resolves to.

**Build conditions with the exported constructors** — `textCondition`,
`numberCondition`, `dateCondition`, `booleanCondition`, `listCondition` — and
never by hand. They fix each condition's key order, sort a list's values and
return `null` for a condition that constrains nothing, and `instance.query`'s
identity depends on all three.

**Which columns `fields` holds** is every visible, accessor-backed column whose
`meta.searchable` resolves true, *plus* every visible, accessor-backed column
that has neither a declared `meta.searchable` nor a sampled value yet — an
unresolved column stays in `fields` rather than being dropped from it. The
default for `meta.searchable`, once a sample exists, is "the column's first
non-null value is a string or a number", so a numeric column is searched too —
mark anything unindexed or sensitive `meta: { searchable: false }`.

`columnDef.enableGlobalFilter: false` also takes a column out of `fields`,
ahead of `meta.searchable` and inference alike: TanStack's own client-side
global filter honours that flag regardless of what this library's gate says,
so `fields` has to agree with it or a server honouring the wire's `fields`
would return rows the same table, in client mode, would show none of.

That unresolved rule has a consequence in server mode: a column with nothing
declared is unresolved at mount, before the first page has arrived, so `fields`
can change — narrower or wider — once real data lands and a sample is found.
A column resolves at most once from inference, though: once a sampled value has
settled it one way or the other, that verdict is cached for the life of the
table, so a later page whose sample happens to be all-null cannot re-open the
question. That cache only ever applies to inference — a column whose
searchability is *declared* (`meta.searchable`, or `enableGlobalFilter: false`)
is never cached and always reads the current declaration, so flipping it after
mount (behind an async permission check, a "search this column" toggle) takes
effect on the very next render, narrowing or widening. Set
`filtering.searchFields` explicitly to skip inference altogether, including the
one request its first resolution can cost.

Hiding a column narrows the search, which is surprising either way and is why
`filtering.searchFields` overrides the list outright. What it cannot override
is what the client will actually match: an entry naming no column, naming a
display column, or naming one with `enableGlobalFilter: false` is dropped, with
a dev-mode warning naming it, because TanStack refuses those three underneath
us and the wire would otherwise ask a backend to search columns this table
searches none of. Name the *live* id — a nested `accessorKey` like
`"partner.name"` has id `"partner_name"`. `search` is `null` when the box is
empty, when it holds only whitespace, and when no column is searchable at all —
including when every `searchFields` entry was dropped — the client has nothing
to match against either, so both modes return everything.

**The published value is debounced**, by `filtering.debounceMs` (default
300 ms). The box itself stays responsive: the raw text is in state on the
keystroke, and what waits is the query. Column filters are never debounced —
they commit on Apply, Enter or blur. Nor is a programmatic write: `clearAll()`
and `setModel()` publish their search with their filters, in one query, so
clearing the toolbar or restoring a shared URL never announces an intermediate
request a host would fetch.

**A values filter's choices come from exactly one source**, in this order:
`meta.values` on the column, wherever it is declared and in either mode, shown
without counts; otherwise, in client mode, the data itself, with counts, and
narrowed by whatever the *other* columns are filtered by; otherwise, in server
mode, `filtering.loadValues(columnId, { search, signal })`. A server-mode list
column with neither is disabled with a label rather than shown an empty list —
an empty list reads as "there is no data". While a request is out the previous
answer stays on screen, dimmed and `aria-busy`, and a rejected one keeps it and
offers a retry; `signal` aborts a superseded request. Declaring `meta.values` on
a client-mode column trades the free counts for fixed labels, which is a real
trade.

---

## Expandable rows

Two shapes, one mechanism. Use either, or both together.

**A detail panel** under a row — pass `renderDetail`:

```tsx
<DataTable
  instance={table}
  renderDetail={(row) => <MovementHistory sku={row.sku} />}
/>
```

The panel holds anything, including another `<DataTable>`. Give each nested
table its own `id` and they stay independent:

```tsx
function Detail({ product }) {
  const table = useDataTable({ id: `movements-${product.sku}`, data, columns })
  return <DataTable instance={table} toolbar={false} stickyHeader={false} />
}
```

**Child rows** — pass `getSubRows`:

```tsx
useDataTable({ id: "bom", data, columns, getSubRows: (row) => row.children })
```

```
▸ Cement M400 — 1 t
  ▾ Clinker
    · Limestone
    · Gypsum
  · Packaging
```

Each level expands on its own and indents by `--dt-indent`. A row with no
children keeps its alignment with a spacer rather than a disabled control.

Which rows are open is **not** persisted: it is a reading position, not an
arrangement someone chose to keep, and restoring it days later is surprising.

---

## Two tables on one page

This is the part most table wrappers get wrong, so it is worth being explicit.

Every `useDataTable()` call builds its own table with its own state. Two tables rendered
together share nothing — sorting one leaves the other alone.

The part that *can* go wrong is persistence. If both tables wrote their layout under one
key, rearranging either would clobber the other. That is why **`id` is required**: it is
the storage key.

```tsx
const receipts = useDataTable({ id: "receipts", /* … */ })
const products = useDataTable({ id: "products", /* … */ })
```

Give every table in your application a distinct `id` and the problem cannot occur.

---

## Persistence

By default nothing is stored — a table resets when it unmounts.

```tsx
import { localStorageLayout } from "@khojiakbarr/data-table"

useDataTable({ id: "receipts", storage: localStorageLayout(), /* … */ })
```

`localStorage` is per browser. In a multi-user application you usually want layouts on the
server so they follow the user across devices. Supply any object with three methods:

```tsx
const serverLayout: LayoutStorage = {
  load: (id) => cache.get(id) ?? null,
  save: (id, layout) => { void fetch(`/api/table-layout/${id}`, {
    method: "PUT", body: JSON.stringify(layout),
  }) },
  clear: (id) => { void fetch(`/api/table-layout/${id}`, { method: "DELETE" }) },
}
```

`load` is called once when the table mounts, so it must be synchronous — fetch layouts
alongside the rest of your page data and read them from your cache here. `save` is
called only after the user changes something, a short while after the last change —
never on mount, and never on every frame of a drag.

**Columns that disappear.** When you remove a column from the code, stored layouts still
mention it. Those references are dropped on load, and columns added since are appended, so
an old layout never leaves a user with a phantom column or a missing one.

**Filters persist too**, with the rest of the layout, and a stored condition is
dropped on load when its column is gone, when its shape does not match its
operator, or when the column's filter kind has changed since. Pass
`filtering: { persist: false }` to keep filters and the search box out of
storage entirely, for a table you would rather have every visit start clean:
nothing is then written for a filter change at all — which matters most for a
server-backed adapter, where a write is a network request — and anything an
earlier visit had already stored is dropped on load rather than restored. A
filter or a search never counts as *customising* the layout either way — the
Columns tab's Reset link is about columns.

**`filtering: false` turns the feature off, not just its surfaces.** No filter
state enters the layout at all: nothing is restored from storage, nothing is
taken from `initialLayout`, `query.filters` stays empty, and the mutators on
`instance.filtering` do nothing. That is what stops a table you disabled from
going on asking its backend for a filtered page nothing on screen can clear.

---

## Styling

Every colour and dimension is a CSS custom property with a working default, so the table
looks finished out of the box and restyles without touching its source. The base sheet
declares every token directly on `.dt-root`, so an override has to match that same
element — a rule on an ancestor never reaches it, because `.dt-root` already carries its
own value for the property, and an own declaration always beats one inherited from further
out. Doubling the class raises an override's specificity above the base sheet's, with
nothing left to depend on which stylesheet happens to load last:

```css
.dt-root.dt-root {
  --dt-header-bg: var(--table-header-bg);
  --dt-row-hover: var(--table-row-hover);
  --dt-accent: var(--primary);
  --dt-accent-text: var(--primary);
  --dt-radius: 6px;
}
```

**`--dt-accent` and `--dt-accent-text` are two different pairings of your brand colour, and
setting one does not set the other.** `--dt-accent` is a *fill* — the focus ring, resize
handle, drop indicator and pin badge are all painted in it, against whatever sits next to
them, so WCAG only asks it to clear 3:1. `--dt-accent-text` is that same colour printed AS
TEXT directly on `--dt-bg` (`.dt-link`'s "Show all" / "Reset" buttons, and the current
choice in a header menu — the active sort direction and the active pin), which needs the
stricter 4.5:1 body-text minimum — a brand blue that clears 3:1
as a fill can still fail 4.5:1 as text, which is why the base sheet keeps these as two
tokens instead of deriving one from the other. Set both when you override the accent; if
your brand colour does not itself clear 4.5:1 on `--dt-bg`, give `--dt-accent-text` a
darkened (light mode) or lightened (dark mode) variant of it instead of the same value.

<details>
<summary>All tokens</summary>

| Token | Purpose |
|---|---|
| `--dt-bg` `--dt-fg` `--dt-muted-fg` | Surface and text |
| `--dt-border` `--dt-radius` | Edges |
| `--dt-header-bg` `--dt-header-fg` `--dt-header-height` | Header row |
| `--dt-row-hover` `--dt-row-stripe` `--dt-row-height` | Body rows |
| `--dt-accent` | Fill: focus ring, resize handle, drop indicator, pin badge (needs 3:1) |
| `--dt-accent-fg` | Text printed ON `--dt-accent` (the pin badge; needs 4.5:1 there) |
| `--dt-accent-text` | `--dt-accent`'s colour printed AS text on `--dt-bg` (`.dt-link`, and the current choice in a header menu — active sort direction and active pin; needs 4.5:1 there) — set alongside `--dt-accent`, see above |
| `--dt-focus-ring` | Focus outline |
| `--dt-resize-handle` `--dt-resize-handle-active` | Resize handle |
| `--dt-drop-indicator` | The drop slot a dragged column will land in |
| `--dt-pin-shadow-start` `--dt-pin-shadow-end` | Pinned column seams |
| `--dt-indent` `--dt-detail-bg` | Nested rows and detail panels |
| `--dt-viewport-max-height` | Fallback height for a table nobody bounded; see [Large data](#large-data) |
| `--dt-font` `--dt-font-size` | Typography |

</details>

Dark mode follows `prefers-color-scheme`. Pass `theme="light"` or `theme="dark"` to pin it.

### shadcn/ui

Two presets map the tokens onto shadcn's variables. Import one after the
base stylesheet and the table follows the host's palette, radius, font and
dark mode:

```tsx
import "@khojiakbarr/data-table/styles.css"
import "@khojiakbarr/data-table/themes/shadcn.css"      // Tailwind v4 / oklch variables
// or
import "@khojiakbarr/data-table/themes/shadcn-hsl.css"  // hsl(var(--x)) variables
```

Pick by how your shadcn variables are written. A complete colour such as
`oklch(0.62 0.19 259)` needs `shadcn.css`; a bare channel triplet such as
`221 83% 53%`, read by the host as `hsl(var(--primary))`, needs
`shadcn-hsl.css`. The wrong file produces no colour at all rather than a
warning, so check one variable before deciding.

Only tokens shadcn has an equivalent for are mapped. Sizes stay with the base
sheet, so `--dt-header-height`, `--dt-indent` and `--dt-font-size` are still
yours to set on `.dt-root`. `--dt-row-height` is the one exception: it is
written inline on `.dt-root` every render (see [Large data](#large-data)), so
no stylesheet rule reaches it either way — set it via `rowHeight` /
`getRowHeight` instead.

A mapped token needs a rule that *beats* the preset's specificity, not merely
matches it: `.dt-root.dt-root` ties the preset's own `(0,2,0)` selector, and a
tie is broken by whichever stylesheet loads last — so a host rule written
that way can lose silently depending on import order. Repeat the class once
more to win outright, with nothing left to depend on:

```css
.dt-root.dt-root.dt-root {
  --dt-accent: var(--chart-2);
  --dt-accent-text: var(--chart-2);
}
```

Same pairing as in [Styling](#styling) above: `--dt-accent` recolours the fill (focus ring,
resize handle, drop indicator, pin badge) and `--dt-accent-text` recolours the accent
printed as text (`.dt-link`, the current choice in a header menu) — set both, since a design-system
token like `--chart-2` is not guaranteed to clear the stricter 4.5:1 text needs as-is.

`theme="light"` or `theme="dark"` opts that table out of the preset and back
onto the built-in palette, so the prop still means what it says while other
tables on the page keep following shadcn.

---

## Headless use

`DataTable` is optional. The hook returns the TanStack instance plus this library's
additions, so you can render whatever markup you need and keep the behaviour:

```tsx
import { useDataTable, pinnedStyle, renderedLeafColumns } from "@khojiakbarr/data-table"

const { table } = useDataTable({ id: "receipts", data, columns })

// Widths belong in a colgroup, in render order — not on each cell.
<colgroup>
  {renderedLeafColumns(table).map((c) => (
    <col key={c.id} style={{ width: c.getSize() }} />
  ))}
</colgroup>

// Skip headers a spanning cell above already covers.
headerGroup.headers.filter((h) => h.rowSpan > 0)

<td style={pinnedStyle(cell.column)} />
```

Two helpers are worth borrowing rather than rewriting:

`pinnedStyle()` — a pinned column's offset is the running total of every pinned column
before it, and those widths change on every frame while a resize handle is dragged. It
reads TanStack's memoised offset map instead of recomputing. For headers, including
group headers, use `headerPinning(header)`: TanStack calls a group "pinned" as soon as
one leaf under it is, and knows no offset for a group id, so a group rendered from
`pinnedStyle` would stick at the left edge on top of the real pinned columns.

`renderedLeafColumns()` — `table.getVisibleLeafColumns()` groups pinned columns first,
which is *not* the order cells appear in, because pinned cells keep their DOM position and
are stuck with `position: sticky`. Feeding that order to a `<colgroup>` hands every column
somebody else's width. `fillerIndex()` says where the filler column goes in that order.

`useAutosize()` — "fit to content" for your own markup. Give it the instance and a ref to
your `<table>`, put `data-column-id` on every `<th>`, `<td>` and `<col>` as the built-in
shell does, and wire `autosize(columnId)` / `autosizeAll()` to whatever you like:

```tsx
const tableRef = useRef<HTMLTableElement>(null)
const { autosize, autosizeAll } = useAutosize(instance, tableRef)
```

`useRowVirtualizer()` — the windowing behind [Large data](#large-data), for your
own markup. Give it the rows, a ref to the scrolling viewport, a ref to the
`<thead>` (its height offsets every row in the same scroll box), the row
height(s) and a stable `isDetailOpen`; it returns the items to render plus
`top` / `bottom` spacer heights and a `measureElement` ref-callback for detail
rows. Pass `unmeasuredFloor: pageSize` when you page the rows, so the leading
window rendered before anything is measured — every server render — covers the
whole page:

```tsx
import type { Row } from "@tanstack/react-table"
import type { DataTableFeatures } from "@khojiakbarr/data-table"

// `useCallback`'s own type parameter is inferred from the arrow, not from
// `isDetailOpen`'s contextual type, so `row` needs an explicit annotation —
// left off, it infers as `never` and the object literal fails to type-check.
const isDetailOpen = useCallback(
  (row: Row<DataTableFeatures, Receipt>) => row.getIsExpanded(),
  [],
)

const { items, top, bottom, measureElement } = useRowVirtualizer({
  rows: table.getRowModel().rows,
  viewportRef,
  headRef,
  rowHeight: instance.rowHeight,
  getRowHeight: instance.getRowHeight,
  heightVersion: instance.heightVersion,
  isDetailOpen,
  enabled: true,
})
```

`useUnboundedViewport()` — the check behind the fallback bound in
[Large data](#large-data), for a shell with its own viewport. It answers
whether the scroller it was given has a height of its own; render
`data-dt-unbounded` on the viewport when it says no, and the stylesheet does
the rest.

`<TablePagination instance={instance} labels={{ ...defaultLabels, ...myLabels }} />` — the
footer `<DataTable>` renders when `footer` is on, exported so a shell of your own can reuse
it rather than rebuild the range math and page-size select. Its `labels` is the full
`DataTableLabels`, not the `Partial` `<DataTable>` accepts — there is no default shell
underneath it to fall back on for a key you left out — so spread `defaultLabels`, exported
alongside it, over your own overrides.

Filtering adds a large batch of keys — operator names, editor labels, the
search placeholder, the tab names, the clear actions and the no-matches copy.
Spread `defaultLabels` and override what you need; building the object by hand
means adding every new key on each minor release.

`ruLabels` and `uzLabels` — Russian and Uzbek translations of the whole label
set, shipped so those two hosts do not have to translate 100-odd keys by hand.
Pass one straight through:

```tsx
import { DataTable, ruLabels, uzLabels } from "@khojiakbarr/data-table"

<DataTable instance={instance} labels={ruLabels} />

// Or keep the translation and change the wording that is yours:
<DataTable instance={instance} labels={{ ...ruLabels, empty: "Накладных пока нет" }} />
```

Both are typed as the full `DataTableLabels` rather than a `Partial`, so a key
added to the interface fails to compile in this package instead of silently
staying English in yours — which also means spreading `defaultLabels` under
them is unnecessary. `<DataTable labels>` itself still takes a `Partial`, so
the spread form above needs no filler for the keys you are not changing.

`<TableStatus loading={…} error={…} onRetry={…} labels={…} />` and `<SkeletonRows
widths={…} count={…} />` — the loading, error and skeleton states `<DataTable>` renders
above and in place of its rows (the **States** paragraph under [Server-side
data](#server-side-data) describes the precedence between them). Exported for the same
reason as the footer: a shell that reuses `TablePagination` usually wants these too, rather
than rebuilding the same four-state contract against undocumented class names.

`<QuickSearch instance={instance} labels={{ ...defaultLabels, ...myLabels }} />` — the
toolbar's search box on its own, for a shell that renders `toolbar={false}`. Like
the footer it takes the full `DataTableLabels` rather than a `Partial`. It writes
straight to `instance.filtering.setSearch`, so the debounce, the result-count
announcement and the page reset come with it.

`<TableSideBar instance={instance} labels={…} tabs={["columns", "filters"]} open={open} tab={tab} onToggle={…} onTabChange={…} onClose={…} onReorder={…} />` —
the docked side bar the built-in shell renders: a rail of vertical tabs pinned
to the table's inline-end edge, visible whether or not a panel is open, and the
panel one of them opens *beside* the table rather than over it. Opening it takes
width from the table, which is the point — this table scrolls horizontally, and
a floating panel covers columns the user cannot then scroll out from under it.
Below 640px the rail is withdrawn, the toolbar's Columns button is the only way
in, and the panel overlays the card at full width.

`<TablePanel instance={instance} labels={…} tab={tab} onTabChange={setTab} onReorder={…} onClose={…} />` —
the side panel with both tabs, for a shell that wants to choose which one opens;
`<ColumnsTab>` and `<FiltersTab>` are its halves. The Filters tab lists every
filterable column, **hidden ones included and marked** — a hidden column's
filter goes on applying and its header is not there to say so.

`presentation` decides how the panel behaves, and it is a prop rather than
something inferred from where the panel is mounted:

| `presentation` | Looks like | Dismisses on |
| --- | --- | --- |
| `"floating"` (default) | A popover over the table, with its own tab strip | An outside press, and `Escape` from anywhere |
| `"docked"` | Furniture inside `<TableSideBar>`, in flow beside the table, no tab strip of its own — the rail is the `tablist` | The active rail tab, and `Escape` **only while focus is inside it**. Never an outside click. |

`<ColumnPanel>` is still exported and still takes exactly the four props it
always did, still floating, still opening on the Columns tab: the shell moved
to a docked bar, the component did not change.

---

## API

### `useDataTable(options)`

| Option | Type | Default | |
|---|---|---|---|
| `id` | `string` | — | **Required.** Unique per application; the persistence key. |
| `data` | `TData[]` | — | |
| `columns` | `ColumnDef[]` | — | Standard TanStack column definitions. |
| `storage` | `LayoutStorage` | none | Where layouts live. |
| `initialLayout` | `Partial<TableLayout>` | `{}` | Applied on a user's first visit. |
| `features` | `DataTableFeatureFlags` | all on | Turn off `sorting`, `resizing`, `reordering`, `pinning` or `hiding`. |
| `defaultColumnWidth` | `number` | `160` | |
| `minColumnWidth` | `number` | `60` | |
| `maxColumnWidth` | `number` | `800` | |
| `direction` | `"ltr" \| "rtl"` | `"ltr"` | Which way a drag widens a column. |
| `getSubRows` | `(row: TData) => TData[]` | — | Child rows, for tree data. |
| `canExpand` | `(row: TData) => boolean` | all rows | Which rows may open a detail panel. |
| `mode` | `"client" \| "server"` | `"client"` | `"server"`: `data` is one page, already sorted; the table only describes what it wants. |
| `rowCount` | `number` | — | Total rows across all pages. Server mode only; undefined until known. |
| `pagination` | `boolean \| PaginationOptions` | off (client) / on (server) | `{ pageSize?, pageSizeOptions? }`. See [Server-side data](#server-side-data). |
| `filtering` | `boolean \| FilteringOptions` | on | `{ debounceMs?, persist?, searchFields?, loadValues? }`. `false` turns filtering off. |
| `getRowId` | `(row: TData, index: number, parent?: Row) => string` | — | Stable row identity. Required in server mode for expansion to follow records across pages. |
| `onQueryChange` | `(query: TableQuery) => void` | — | Called with the query on mount and after every change to it. |
| `rowHeight` | `number` | `40` | Pixel height of a data row; also sets `--dt-row-height`. |
| `getRowHeight` | `(row: TData) => number` | — | Height for particular rows, known ahead of render. A pure function of its row; may be inline. |
| `heightVersion` | `string \| number` | — | Changes when `getRowHeight` starts answering differently, for a change too narrow for the table to sample. See [Large data](#large-data). |

Returns `{ table, id, flags, bounds, resetLayout, isCustomised, expanded, mode, query, pagination, filtering, rowHeight, getRowHeight, heightVersion }`.

### `<DataTable />`

| Prop | Type | Default | |
|---|---|---|---|
| `instance` | `DataTableInstance` | — | **Required.** From `useDataTable`. |
| `striped` | `boolean` | `false` | |
| `height` | `number \| string` | auto | Fixed height for the whole table, toolbar included; header and pinned columns stay put while the rows scroll. Virtualisation needs this, or a height on an ancestor — see [Large data](#large-data). |
| `toolbar` | `boolean` | `true` | |
| `toolbarContent` | `ReactNode` | — | Rendered before the Columns button. |
| `emptyState` | `ReactNode` | `labels.empty`, or `labels.noMatches` with a Clear filters button while `instance.filtering.isFiltered` | Supplying this replaces **both** defaults, including the filtered-empty exit — a host that wants its own art for "no data" but still wants a way out of a filtered-empty table should branch on `instance.filtering.isFiltered` itself. |
| `labels` | `Partial<DataTableLabels>` | English | Every string, for translation. |
| `theme` | `"light" \| "dark"` | system | |
| `renderDetail` | `(row: TData) => ReactNode` | — | Content revealed under an expanded row. |
| `stickyHeader` | `boolean` | `true` | Keep the header in view while the body scrolls. |
| `onRowClick` | `(row: TData) => void` | — | |
| `footer` | `boolean` | `true` | Show the pagination footer when paging is on. |
| `virtualize` | `boolean` | `true` | Render only the visible window of rows. `false` renders every row. |
| `loading` | `boolean` | `false` | Rows are on their way. Skeleton rows with none yet, a progress bar once some are on screen. |
| `error` | `unknown` | — | Loading failed. Shown as a banner with a Retry button when `onRetry` is given. |
| `onRetry` | `() => void` | — | Called by the Retry button. |

---

## Accessibility

- Headers carry `aria-sort`, and each sort control names its column, so a screen reader
  announces "Amount: sort ascending" rather than three identical buttons.
- Sort controls, the resize handle, the per-column menu and the side bar are all
  reachable by keyboard with a visible focus ring. A focused resize handle resizes with
  ← / → (Shift for larger steps) and fits the column on Enter.
- The side bar's rail is a vertical `tablist` with a name of its own, one roving tab stop,
  and ↑ / ↓ / Home / End along it — which move between tabs without opening or closing the
  panel. Each tab states `aria-selected` **and** `aria-expanded`, so pressing the tab that is
  already showing is announced as collapsing it rather than as doing nothing. Its label is
  turned by `writing-mode`, so it stays one run of real, selectable text.
- The docked panel closes on `Escape` **only while focus is inside it**, and hands focus back
  to its rail tab; it does not close on an outside click, because a bar docked beside the table
  is furniture and using the table is not a request to dismiss it. A floating `<ColumnPanel>`
  still closes on `Escape` and on an outside click.
- The per-column menu opens from a button as well as from right-click, and is reachable
  by keyboard; it closes on `Escape`.
- The quick-search box announces its result count politely and never takes focus.
- The header menu's **Filter…** item opens a popover rather than putting form controls inside a
  `role="menu"`, which would be invalid. The popover is a labelled `role="dialog"`, keeps `Tab`
  inside itself, closes on `Escape` **discarding the draft**, and returns focus to the column's ⋮
  button. **Filter in panel…** beside it opens the side panel's Filters tab instead, with that
  column's editor expanded and focused.
- A filtered column is marked in its header with a labelled icon. The side panel's Filters tab
  lists hidden columns too, marked as hidden — a hidden column's filter goes on applying and has no
  header to say so.
- A floating panel's own two tabs are a `tablist` with arrow-key movement and a single roving tab stop, the same as the rail's.
- An empty table says whether it has no rows or no *matching* rows, and the second offers a way out.
- Row toggles report `aria-expanded` and name themselves.
- Reordering has a keyboard path: each row of the **Columns** panel carries a drag handle that
  is in the `Tab` order. `Space` picks the column up, the arrow keys move the drop slot,
  `Space` puts it down and `Escape` gives it back. The handle reports `aria-pressed`, and every
  position — including the one a cancel returns to — is announced politely. The slot stops at a
  group or pinning boundary, because a move across one is refused. The two strings it speaks are
  the `reorderHint` and `reorderPosition` labels.
- `prefers-reduced-motion` disables transitions.

---

## Requirements

React 18 or 19, and `@tanstack/react-table` v9 and `@tanstack/react-virtual` v3
as peer dependencies.

## Licence

MIT
