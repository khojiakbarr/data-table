<!--
  The image URLs below are absolute on purpose. This README is also the
  package page on npmjs.com, which does not resolve repository-relative paths
  the way GitHub does — a relative `src` renders as a broken image there while
  looking perfectly fine in the repo, so the breakage is invisible from here.
-->
<div align="center">

<img src="https://raw.githubusercontent.com/khojiakbarr/data-table/main/public/assets/logo.svg" width="84" alt="">

# @hojiakbar_dev/data-table

**A React data table people can rearrange — and that remembers how they left it.**

Nested column groups · server-side paging, filtering and row grouping · pinning, resizing
and reordering · virtualised rows · per-user persisted layout · a token-driven theme

[![npm](https://img.shields.io/npm/v/%40hojiakbar_dev%2Fdata-table?color=2f6feb&label=npm)](https://www.npmjs.com/package/@hojiakbar_dev/data-table)
[![Playground](https://github.com/khojiakbarr/data-table/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/khojiakbarr/data-table/actions/workflows/deploy-pages.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-2f6feb.svg)](#licence)
[![Types: included](https://img.shields.io/badge/types-included-2f6feb.svg)](#api)
[![React 18 · 19](https://img.shields.io/badge/react-18%20%C2%B7%2019-2f6feb.svg)](#requirements)

### [→ Open the live playground](https://khojiakbarr.github.io/data-table/)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/khojiakbarr/data-table/main/docs/media/hero.png">
  <img src="https://raw.githubusercontent.com/khojiakbarr/data-table/main/docs/media/hero-light.png" width="880"
       alt="A receipts table with two levels of column headers — Document over Code and Partner, Payment over Amount and Status — numbered rows, a status bar reading 100 000 rows total, and pagination.">
</picture>

</div>

---

Built on [TanStack Table v9](https://tanstack.com/table). Ships as a hook plus an
optional styled shell, so you can take the behaviour and write your own markup.

Every rearrangement is a **request, not a mutation**: the table asks your server for a
page and asks your code to commit an edit. It never writes to its own data, which is what
lets one table sit in front of a hundred thousand rows it has never seen.

```bash
npm i @hojiakbar_dev/data-table @tanstack/react-table @tanstack/react-virtual
```

<details>
<summary><b>Contents</b></summary>

- [What it does](#what-it-does)
- [Nested columns](#nested-columns) · [Column widths](#column-widths) · [Large data](#large-data)
- [Server-side data](#server-side-data) — [filters on the wire](#filters-on-the-wire), [row grouping](#row-grouping)
- [Editing cells](#editing-cells) · [Row selection](#row-selection) · [Row numbers](#row-numbers) · [Status bar](#status-bar)
- [Expandable rows](#expandable-rows) · [Two tables on one page](#two-tables-on-one-page) · [Persistence](#persistence)
- [Styling](#styling) — [shadcn/ui](#shadcnui), [Material UI](#material-ui)
- [Headless use](#headless-use) · [API](#api) · [Accessibility](#accessibility)
- [Development](#development) · [Requirements](#requirements) · [Licence](#licence)

</details>

```tsx
import { DataTable, useDataTable, localStorageLayout } from "@hojiakbar_dev/data-table"
import "@hojiakbar_dev/data-table/styles.css"

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
| **Select rows** | A leading column of checkboxes whose header takes **everything the current query matches**, not the page on screen — so approving 25 000 receipts is one click, not 500 screens. Or `{ scope: "page" }`, for a backend that can only act on ids. Off by default. |
| **Number the rows** | An optional leading column carrying each row's place in the whole result set — not in the page. Off by default. |
| **Totals footer** | A row under the body, aligned and pinned with the columns, holding a total you supply per column. The library computes none of it. |
| **Expand rows** | A detail panel under a row, child rows that indent by depth, or both. Nesting is unlimited. |
| **Per-column menu** | Right-click a header, or use its ⋮ button: sort, pin, fit width, hide. |
| **Edit a cell** | Right-click a body cell and choose **Edit**. Text, number, date, boolean and single-choice list editors. The edit is a request to your `onCellEdit` — the table never writes to its own data. |
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
A group header carries no sort control — sorting acts on one column — but it is
**dragged and resized as a unit**: dragging a group's edge scales every column
under it by the same proportion, and dragging the header itself moves the whole
group, every leaf in its existing order.

A group moves **among its siblings at its own level**, which is the rule its
leaves already obey one level down: a group is never dropped inside another
group, and a leaf is never dropped onto a group. `dropRegionOf` owns that
boundary for every surface, so no slot is ever drawn where the drop would be
refused — see [Accessibility](#accessibility) for the keyboard path.

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
`TableQuery` — sorting, filters, quick search, row grouping and pagination.
With TanStack Query:

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

**One more, optional, field on the answer: `unfilteredTotal`.** It is
`rowCount` before `query.filters` and `query.search` narrowed it, for the
[status bar](#status-bar)'s "X of Y" — `SELECT COUNT(*) FROM receipts` with no
`WHERE`, run alongside the filtered count your endpoint already computes for
`rowCount`. Wire it exactly like `rowCount`:

```tsx
unfilteredTotal: data?.unfilteredTotal, // optional; undefined reads as "state only what matched"
```

Leave it off a response and the status bar states just the matched count —
the graceful case a backend can ship before this extra query exists, not a
state it has to guard against.

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
  "expanded": [],
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

### Your own filters in the Filters tab

Some backends do not translate conditions at all: their list endpoint takes a
few fixed parameters — a role id, a status — one value each. Offering "any of
these", "not", "blank" over such a list would show an unfiltered page under a
filter's name, so turn the columns' filters off (`meta: { filter: false }`)
and draw the parameters the endpoint really takes, with your own fields,
inside the side bar's Filters tab:

```tsx
<DataTable
  instance={table}
  filtersPanel={{
    content: (
      <>
        <RolePicker value={roleId} onChange={setRoleId} />
        <StatusSelect value={status} onChange={setStatus} />
      </>
    ),
    activeCount: [roleId, status].filter(Boolean).length,
  }}
/>
```

- `content` is drawn at the top of the tab, above any column filters. The
  fields are yours: they apply however you make them apply, and you reset the
  page when they change (`instance.pagination.resetPage()`).
- `activeCount` is shown on the rail's Filters tab while above 0, and spoken
  as words after its name ("Filters, 2 active") — the panel is usually shut,
  and the count is what says why a row is missing.
- With `filtersPanel` the tab is offered even when no column can be filtered,
  and then it draws only your fields: no "No filters applied", no "Clear all
  filters" for filters that cannot be made there.
- **Without it, a table with no filterable column has no Filters tab.** The
  tab used to appear whenever quick search was on, and opened onto an empty
  note and a disabled button.

### Row grouping

Drag a column into the **Row groups** zone in the side panel — or send it there from the
keyboard — and the rows group by it. The grouping is computed by your server, not in the
browser: grouping the fifty rows a pager handed you and presenting the answer as if it
were the whole table is not merely incomplete, it is wrong in a way the user cannot see.

<img src="https://raw.githubusercontent.com/khojiakbarr/data-table/main/docs/media/grouping.png" width="880"
     alt="The same table grouped by Status. A group header reads Closed with a count of 25 000, the grouped column leads the table, and the side panel shows the column tree with a Status chip in the Row groups zone.">


Grouping is **server-side**. The table holds one page of fifty rows out of a
hundred thousand; grouping those fifty would present a partial answer as if it
were the whole table — counts that are wrong, and wrong in a way the user
cannot see. So the grouping travels on the query and your backend answers it.
There is no client-mode fallback: `instance.grouping` refuses to set one, and
says so in a development warning.

```ts
instance.grouping.add("status")        // group by status
instance.grouping.add("partner")       // nest partner inside it
instance.grouping.toggle(["received"]) // open a group, by its key path
instance.grouping.clear()              // every column back exactly where it was
```

Two fields go out and one comes back:

```json
{
  "grouping": ["status", "partner"],
  "expanded": [["received"], ["received", "Toshkent Kimyo Zavodi"]]
}
```

`grouping` is column ids, **outermost first** — its order is its nesting, so
unlike `filters` it is not sorted. `expanded` is the exact key paths of the
groups the user has opened, canonicalised so that opening A then B produces
the same query as opening B then A.

The answer is a page of the **flattened visible rows** — what the user would
see with those groups open — where a row is either one of your records or a
group header:

```ts
interface GroupRow {
  kind: "group"
  /** The key path identifying this group, outermost first. */
  path: (string | number | boolean)[]
  /** How many LEAF rows are under it, at every depth. */
  count: number
}
```

Return them interleaved in `data`, in visible order. The table recognises a
group header by its `kind` and hands one to no callback of yours — not
`getRowId`, `getRowHeight`, `getSubRows`, `canExpand`, a cell renderer or
`renderDetail` — so your accessors never see a row they have no fields for.
`kind: "group"` is therefore **reserved**: a record of your own carrying it
would be drawn as a header.

`rowCount` is the length of the whole flattened list, group headers included:
they are rows the pager pages past, and a total of records alone would let it
run off the end.

For the same reason, **[row numbers](#row-numbers) count group headers too**
— they are rows of the list being looked at, and the offset a page carries is
the only thing either feature can count from.

**One more field on the answer: `startPath`.** With a group open and a page
boundary falling inside it, a page comes back as records with no header above
them — and a record carries no path, so nothing in the rows says which group
they belong to. Report the open group the page's FIRST row sits inside (`[]`
at the top level) and the table draws a "continued" header above them. Only
the first row can ask: every later row's context is re-established by the
header above it, which is why this is one field per page rather than a path
per row.

```ts
useDataTable({ mode: "server", data: page.rows, rowCount: page.total, startPath: page.startPath, … })
```

**The SQL.** Group the level being listed, filtered by the open path, and
count:

```sql
SELECT COALESCE(NULLIF(status::text, ''), '') AS key, COUNT(*) AS count
FROM receipts
WHERE <the filters and the search, exactly as above>
GROUP BY 1
ORDER BY (key = '') , key   -- blanks above every value, as everywhere else
```

`COALESCE(NULLIF(col::text, ''), '')` and not a bare `GROUP BY col`: **a blank
key is one group, keyed by `""`**. A literal group-by gives two — one for
`NULL`, one for `''` — and the contract does not survive that split, because
`blank` matches both: a "(Blanks)" filter would report twenty thousand rows
beside two headers dividing them, the filter and the counts disagreeing about
the same word.

**Order of operations, and it matters**: filter and search, then group, then
sort within a level, then flatten against the open paths, then page. A backend
that groups before it filters returns counts that do not match the rows under
them.

**Sorting a grouped table sorts within its level.** Group headers are ordered
by their own key; the level whose column the sort names takes the sort's
direction while every other level stays ascending; records are ordered inside
the innermost group they belong to and never move between groups. Blanks rank
above every value for group keys exactly as they do for records, so one rule
covers both kinds of row.

**The Row Groups zone** sits in the side bar's Columns tab, under the column
tree. Drag a column into it — from its row in that tree, or straight off its
header — and the table groups by it; drag a second one in and it nests inside
the first. Each level is a chip, outermost at the top, removable by its own
button and draggable to renest. While nothing is grouped the zone is a dashed
area saying what it is for, rather than an invisible target. The drop
affordance is the one the columns already use: the chip standing where the
dragged column will land is outlined, and when the destination is past the last
level a chip is drawn for the incoming column so there is something to outline.

Nothing here needs a pointer. Every row in the Columns tab carries a group
toggle — `Group rows by Status`, and `Remove Status from row groups` once it is
one — and a chip is renested with the same keys the column list uses: Space to
pick it up, the arrows to move it, Space to drop it, Escape to give up, with
each step announced.

**The zone only exists where grouping can work.** `instance.grouping.enabled`
is false on a client table, so there is no zone on one: a drop that grouped
fifty rows out of a hundred thousand would answer with counts for the page, and
a target that took a drop and did nothing would be worse still.

**In the table**, a grouped column leaves the body and its slot becomes the
group column, holding the chevron, the value and the count — `received
(25 000)` — with a mark in its header. It keeps its header, so sorting it
still reorders that level. Nesting a second level hides that column's own
slot; removing the grouping puts every column back exactly where it was,
because the derived visibility never touches the layout the user arranged.

**The group column has a floor under its width** while it is grouped, because
its slot was sized for that column's values and not for a chevron, a value and
a count side by side — a 90px `Status` would crowd all three. The floor starts
at 200px and gains one indent step per extra level, since each level pushes the
chevron further in. It is a floor and not a clamp: a width you set yourself, by
the resize handle or by `columnSizing`, wins outright, and nothing is written
into the saved layout, so taking the last chip out restores the column exactly.
`groupColumnMinWidth(levels)` is exported for a shell that wants the same rule.
Opening a group is a **refetch**, so the loading treatment is the one for a
page that is already on screen: the rows stay and a progress bar shows.

**Grouping and its open branches are part of the saved layout**, beside
`sorting`. Every change to either resets the page, the way sorting does.

**What is deliberately not here.** Aggregations (AG Grid's Values zone) are
out of this version — a header carries its value and its count and nothing
else. So is "expand everything": `expanded` is exact key paths, which is right
for the semantics and fine at any depth, but opening every group of a
high-cardinality column would put one path per group into a query that is
compared by `JSON.stringify` on every render. If one is ever wanted, `expanded`
gains a companion rather than growing. And there is no per-group lazy fetch:
one flat page keeps one request and one answer, and composes with the paging
and virtualisation that already exist. The cost is the refetch on expand; the
shape leaves room for the lazy version later, because `expanded` already
travels as key paths.

**Turn it off with `features: { grouping: false }` when your backend cannot
group.** Grouping is already server-only; this flag is for the server host
whose list endpoint has nothing more than paging, sizing and a search string
— no group-by at all — so the table would otherwise offer a Row groups zone
the backend can never answer. Default `true`, so every existing server host
is unaffected. With it off there is no Row groups zone, no per-column group
toggle, `query.grouping` and `query.expanded` stay `[]`, and
`instance.grouping.add`/`toggle` refuse with the same development warning
client mode already gives. A layout saved while grouping was on keeps its
grouping in storage untouched — turning the flag back on picks it back up —
but the table renders and reports as ungrouped while the flag is off.

```ts
useDataTable({ id: "receipts", data, columns, mode: "server", features: { grouping: false } })
```

---

## Editing cells

Right-click a body cell; the first item in the menu is **Edit**. The cell becomes
an editor with its value selected, **Enter** or a click away saves, **Escape**
cancels, and **Tab** saves and moves to the next editable cell in the row,
wrapping to the next row at the end.

A column opts in through `meta.editable`, and the table sends every commit to
`onCellEdit`. Both are required: a column that declares one without the other
is a misconfiguration, and the table says so once in development and leaves
Edit disabled.

```tsx
const col = createColumnHelper<DataTableFeatures, Receipt>()

const columns = [
  col.accessor("code", { header: "Code", meta: { editable: "text" } }),
  col.accessor("date", { header: "Date", meta: { editable: "date" } }),
  col.accessor("partner", {
    header: "Partner",
    // A single-choice list. Its options are `meta.values` — the same list a
    // list FILTER uses, because "which values may I write" and "which values
    // exist" are usually the same question asked twice.
    meta: { editable: "list", values: PARTNERS.map((value) => ({ value })) },
  }),
  col.accessor("amount", {
    header: "Amount",
    // The predicate form: the column offers an editor, and this row's own
    // state takes it away. Edit is then disabled saying the ROW refused it,
    // not the column.
    meta: { editable: (row: Receipt) => row.status !== "closed" },
  }),
]

<DataTable
  instance={table}
  onCellEdit={async ({ row, columnId, value, previous }) => {
    await api.patch(`/receipts/${row.id}`, { [columnId]: value })
    refetch()
  }}
/>
```

The five kinds are the filter kinds, deliberately: a column that filters as a
date edits as a date. A **predicate** names no kind, so the kind is inferred the
way the filter's is — from `meta.filter` when it is set, otherwise from the
values. Declare the kind outright wherever it matters.

**Optimism.** The new value shows while your promise is in flight, marked as
pending; the cell keeps its own renderer, so a formatted column stays
formatted. A rejection reverts it and puts the reason in a notice that stays
until it is dismissed — there is no timer, because a notice that removes itself
removes itself while somebody is reading it.

After a successful write a server-mode host usually refetches. The optimistic
value stands until that answer arrives and then steps aside for it, whatever it
says — including a value the server normalised into something else. Nothing
fights.

`previous` is the value the cell held **when the editor opened**, not one read
back at commit time, so a refetch in between cannot rewrite what the edit was
from.

**What it will not edit.** A group row and the grouped column have no value of
their own; both offer the menu with Edit disabled, saying so. A cell whose
column declared nothing does the same. A menu that sometimes fails to appear
teaches people the feature is broken, so it always appears — and the browser's
own context menu is left alone over a table that no column made editable.

**An edit can make its row vanish.** Change a cell a filter or the search is
looking at and the next refetch will not return that row. That is correct, and
it looks exactly like a bug, so the table says what happened. The same notice
covers an editor whose row left the page underneath it — scrolled out of a
virtualised body, or refetched away: the edit is abandoned rather than written,
and never in silence.

> ### Editing is pointer-only for now
>
> There is no focused-cell model in this library yet, so there is nothing for
> the **ContextMenu** key or **Shift+F10** to anchor a menu to, and no way to
> reach an editor without a pointer. Roving `tabindex` across body cells is the
> conventional answer and it is a bigger change than it looks; it is its own
> piece of work. Until it lands, do not ship cell editing as the only route to
> something a keyboard user must be able to do.

---

## Row selection

Off by default, like [row numbers](#row-numbers) and for the same reason —
this adds a column rather than turning an interaction off — plus one of its
own: a table that started selecting rows on a minor upgrade would put a bulk
action in front of users you never meant to offer one to.

```tsx
useDataTable({
  id: "receipts",
  data,
  columns,
  mode: "server",
  rowCount: page.total,
  getRowId: (row) => row.id,          // effectively required; see below
  features: { selection: true },
  onSelectionChange: setSelection,
})
```

### The header checkbox means every matching row

Not the fifty on screen. A user approving 25 000 receipts must not have to
page through 500 screens, and a table that made them would be offering a
feature that does not do the job it exists for.

That decides the shape of everything else, because 25 000 ids is not a thing
to hold, to publish or to put in a `WHERE` clause — and the rows the user
means are mostly rows the browser has never been sent. So a selection is not a
list of ids. It is one of two statements **about the query**:

```ts
type SelectionModel =
  /** Rows the user picked one at a time. The empty array is "nothing". */
  | { mode: "ids"; ids: readonly string[] }
  /** Everything the query matches, minus the rows the user unticked. */
  | { mode: "all-matching"; excluded: readonly string[] }
```

**Neither mode ever converts into the other.** Untick every row of a page
while in `all-matching` and you still have "everything except these fifty",
which is the correct reading of what you did — not "nothing", which would
discard a selection of 25 000 in response to fifty clicks. Tick every row of a
page one at a time and you have those fifty, not everything: you never said
everything.

**The count.** In `ids` it is `ids.length`. In `all-matching` it is
`rowCount - excluded.length`, and it is **undefined until your server has
answered with a `rowCount`** — the table says so rather than showing a number
it cannot know. The header checkbox is named "Select all rows" in that window,
with no figure in it.

### `scope: "page"` — when your backend acts on ids only

Use it when **your backend has no bulk-by-query endpoint**: every write is one
row by id, and there is no call you could translate `all-matching` into. For
such a host the default header checkbox is a promise you cannot keep — the user
ticks it, reads "all matching rows selected", and you are holding 50 ids out of
5 000.

```tsx
features: { selection: { scope: "page" } }
```

`true` is exactly `{ scope: "all-matching" }`, the default and everything
described above. `{ scope: "page" }` changes one control and nothing else:

- The header checkbox ticks the **selectable rows of the current page** —
  group headers are not among them — and produces `{ mode: "ids", ids }`. It is
  checked when every one of them is selected, indeterminate when some are,
  unchecked when none are, and unchecked on a page with nothing selectable on
  it at all.
- **Ids survive a page turn**, so a selection is built across pages one page at
  a time: tick page 1, go to page 2 — where the header is *unchecked*, because
  nothing here is selected — tick it, and you hold both pages. Unticking the
  header on page 2 takes page 2 back out and leaves page 1 alone.
- **`all-matching` is unreachable.** No control and no hook action produces it.
  A model that arrives in that mode anyway — you moved `scope` under a live
  selection — is read as no selection and said once in development, rather than
  silently honoured.
- The count and the bulk-action bar read `ids.length`, so nothing here waits
  for a `rowCount`, not even in a grouped table where the default scope has to
  go quiet.
- The header checkbox is named "Select all rows on this page"
  (`labels.selectAllRowsOnPage`), because a control that reaches one page must
  not say the sentence the other one says.

Everything else is unchanged, including the rule below.

### A change to the query clears the selection

The filters, the search and the grouping (including which groups are open).
Not the sorting, and not the page.

This is the rule that makes the feature safe rather than dangerous.
`all-matching` is defined relative to a query; let the query move under it and
a selection of 25 000 silently becomes a selection of 90 000 with no gesture
from the user — and then your bulk action runs on them. Sorting and paging
change no row's membership, only the order and which slice is on screen, so
clearing there would make the feature useless for the case it exists for.

The cleared selection is **published**, not merely emptied: `onSelectionChange`
fires with `{ mode: "ids", ids: [] }` and the new query. A model only the table
knows it has dropped is the same defect one layer up.

### What you receive

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

The query is **not optional**. `{ mode: "all-matching", excluded: [] }` names
no row on its own; the filters it was drawn against are what turn it into
rows. It is not called on mount — nothing is selected there, and
`onQueryChange` has already announced the query.

### The SQL

An `ids` selection is the rows it names, and nothing else — not the filters as
well. The user named those records; a filter applied since cannot un-name one.

```sql
UPDATE receipts SET flagged = true WHERE id = ANY($1)   -- $1 = ids
```

An `all-matching` selection is the query's own predicate — [the same filters
and search](#filters-on-the-wire) the page was built from — minus what the
user took back out:

```sql
UPDATE receipts SET flagged = true
WHERE <the filters and the search, exactly as in "Filters on the wire">
  AND id NOT IN (<excluded>)
```

The grouping, the sorting and the pagination play no part. None of them
changes which rows match — only how they are presented — and a bulk action
acts on the rows. The pagination in particular: the whole point is that the
user ticked the header, not the page they could see.

Answer with **how many rows you actually changed**, not how many were
selected. It is the number worth showing afterwards, and it is the only thing
that ever reveals a client-side count that had drifted from yours.

### The bulk-action slot

```tsx
<DataTable
  instance={table}
  renderSelectionActions={({ mode, ids, excluded, query, count, clear }) => (
    <>
      <strong>{count === undefined ? "All matching rows" : `${count} rows`} selected</strong>
      <button onClick={async () => {
        await api.flag({ mode, ids, excluded, query })
        clear()
        refetch()
      }}>
        Flag these
      </button>
      <button onClick={clear}>Cancel</button>
    </>
  )}
/>
```

Rendered **only while something is selected**, in a bar of its own above the
table. That is the whole difference from `toolbarContent`, which is a static
`ReactNode` and knows nothing about a selection; a bar you want on screen
always goes there instead. `clear` rides along with the model so a Cancel
button does not have to reach back into the instance.

The bar appears once, when the first row is ticked, and goes once, when the
last is unticked — it does not come and go as the count changes, so the table
is not pushed down and back on every click. Its entrance animates `transform`
and `opacity` only, and stops animating under `prefers-reduced-motion`.

### The rest of it

- **`getRowId` is effectively required.** Without it TanStack keys rows by
  position, and a selection then follows the *slot* rather than the record:
  sort the table — which deliberately does not clear the selection — and the
  ticks stay on rows three to seven while three to seven are now different
  records. The table says so once in development, in both modes.
- **A selection is never written to `storage`.** `pruneLayout` is a whitelist
  and rebuilds a stored layout from the keys it recognises, so nothing about a
  selection can survive a reload. One restored from last week, against a query
  that has since changed, is the query-change failure wearing a hat.
- **Group rows are not selectable in this version.** A group stands for
  children the browser does not hold — in server mode most of them have never
  been sent — so a tick on one could only mean "every row under this group",
  which is a third mode no backend could answer without a path predicate the
  wire does not carry. Its checkbox cell is kept and left empty.
- **The column is chrome, not data.** It leads the table, before the row
  numbers and before the grouped column; pinned to the start and not
  unpinnable; not sortable, filterable, groupable, editable, hideable,
  reorderable or resizable; and absent from the Columns panel.
- **Both new strings are `DataTableLabels`.** `selectRow(rowNumber)` names a
  row's own box — the number is the only thing telling one from another — and
  `selectAllRows(count, raw)` names the header's, including the branch with no
  count in it at all.
- **Counting with a grouping on:** `rowCount` in a grouped server table is the
  length of the *flattened* list, group headers included, so it is not a count
  of records. The selection itself is unaffected — `all-matching` means the
  query's filters minus the exclusions, which your `WHERE` resolves to records
  either way — but the number the header checkbox would speak is not the number
  the user is about to act on. So it does not speak one: a grouped table says
  "select all rows" without a count.

  Pass `selectableRowCount` to say it properly:

  ```tsx
  useDataTable({
    rowCount: page.total,             // flattened: what the pager measures
    selectableRowCount: page.records, // records: what a selection counts
  })
  ```

  **Do not put a leaf count in `rowCount` instead.** `pageCount` is derived from
  it, so a smaller number there silently takes pages away from the user.

---

## Your own buttons in the toolbar

Two slots, one at each edge:

```tsx
<DataTable
  instance={table}
  toolbarContent={<ViewPicker />}                       {/* beside the search */}
  toolbarActions={<button onClick={exportRows}>Export</button>}  {/* far right */}
/>
```

`toolbarContent` sits at the leading edge, next to the quick search;
`toolbarActions` sits at the trailing edge, which is where an Export or a
"New" button usually belongs. Neither is rendered when `toolbar={false}` — the
host owns the row entirely in that case, and `QuickSearch`, `TablePagination`,
`StatusBar`, `TotalsFooter` and `TableSideBar` are all exported so it can be
rebuilt piece by piece.

### Exporting

There is no built-in CSV or Excel export, and that is a decision rather than a
gap. In server mode the browser holds one page; a client-side export would
write out the fifty rows on screen and call the file "the table", which is the
same lie that made [row grouping](#row-grouping) server-side — and the kind a
user cannot see. Export belongs to the endpoint that holds the rows.

What the table gives you is the state to send it. `instance.query` is the
current `TableQuery` — the filters, the search, the sorting and the grouping,
exactly as they are on screen:

```tsx
async function exportRows() {
  const response = await fetch("/api/receipts/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Drop `pagination`: an export wants every matching row, not this page.
    body: JSON.stringify({ ...table.query, pagination: undefined }),
  })
  // …hand the response to the browser as a download
}
```

With [row selection](#row-selection) on, send what `onSelectionChange` last
gave you instead, and your endpoint exports exactly the rows the checkboxes
mean — including "everything matching, except these", which no list of ids
could have expressed.

---

## Row numbers

Off by default, like [row selection](#row-selection) and the
[status bar](#status-bar). Every other flag turns OFF something the table has
always done, so `true` is what you already had; these add a column (or a band),
and a table that grew one on a minor upgrade would be a breaking change dressed
as a small one.

```tsx
useDataTable({ id: "receipts", data, columns, features: { rowNumbers: true } })
```

The number is the row's **1-based place in the whole result set** —
`pageIndex * pageSize + indexOnPage + 1` — and not its place on the page. A
count that restarted at 1 on page 2 of a hundred thousand rows would tell the
user nothing they did not already know, and in server mode the page offset is
the one thing the client always has.

**Group rows are numbered too.** This is not what AG Grid does, and the
difference is deliberate: numbering only the records needs to know how many
group headers come before this page, and no field on the wire carries that —
a page is a window, and the client cannot count what it has never been sent.
Numbering every flattened row is computable from the offset alone and is
truthful about position in the list on screen. The one row with no number is
the "continued" header the table draws itself from
[`startPath`](#row-grouping): it was never in the server's answer, so giving
it one would put every row after a page boundary out by one. Its cell is
there and empty.

The column is **chrome, not a column of data**, and that decides the rest:

- It leads everything the host declared, the grouped column included — and
  follows the [selection column](#row-selection) when both are on.
- Pinned to the start, and not unpinnable.
- Not sortable, filterable, groupable, editable, hideable or reorderable, and
  **absent from the Columns panel** — a tick that could remove it would
  contradict the flag that put it there.
- Resizable, and the width you drag it to is saved in the layout like any
  other column width. Its default width is as wide as the largest number the
  current `rowCount` can print.
- Its header is empty to the eye and named for a screen reader through the
  `rowNumber` label, so translate that one alongside the rest.

---

## Status bar

Off by default, for the same reason [row numbers](#row-numbers) is: every
other flag turns OFF something the table has always done, so `true` is what
you already had, while this one adds a band nobody asked for.

```tsx
useDataTable({ id: "receipts", data, columns, features: { statusBar: true } })
```

**Why it is not the footer.** The footer already prints `Rows: 100 000`
beside the page controls — that is navigation. The status bar is content: how
many rows, whether a filter is narrowing them, what they are grouped by. A
band that repeated a number already on screen would be worse than no band, so
turning it on moves the row count OUT of the footer and into the bar; with it
off the footer is exactly what it has always been. Both surfaces read the same
`instance.flags.statusBar` to agree on which of them owns the count, so a
shell built on `useDataTable` and `<TablePagination>` alone gets the hand-off
for free the moment it flips the flag — no prop of its own to keep in sync.

**What it says**, as separate parts rather than one sentence, so a translation
can put a different one first:

- **Total rows** — `rowCount`, formatted the same way the footer's own total
  is, so the two never disagree about what a thousand looks like.
- **Filtered**, instead of total, the moment a column filter or the quick
  search is narrowing the result (`instance.filtering.isFiltered`). To say
  "X of Y" the server has to tell you Y, because a server-side filter means
  the client never sees the wider set — pass `unfilteredTotal` alongside
  `rowCount`:

  ```tsx
  useDataTable({
    mode: "server",
    data: page.rows,
    rowCount: page.total,
    unfilteredTotal: page.unfilteredTotal, // optional
    …
  })
  ```

  **Absent is the graceful case, not a hole.** A backend that has not
  implemented the extra count yet leaves the bar stating only how many rows
  matched, which is the honest reading of "unknown". In client mode you never
  need this option at all: `data` there already IS the whole set the table
  filters, so the table reads `data.length` for itself.
- **Grouped by**, while [row grouping](#row-grouping) is active — the columns
  being grouped by, in order, using the same names the Row Groups chips
  already speak.
- **A host slot.** Pass a `ReactNode` instead of `true` to keep the band but
  add content of your own at its end — something this library has no business
  knowing, the way `toolbarContent` extends the toolbar. Same flag, two
  shapes, one decision.

**Deliberately not in this version:** a selected-row count, although
[row selection](#row-selection) now exists — the count belongs beside the
action it is about to be used for, and that is the bulk-action bar, in your
own words. Repeating it down here would put the same number on screen twice,
which is the thing this band exists to stop the footer doing. Nor an
aggregate like a sum or an average — summing one SERVER page of a filtered
result would be wrong in the exact way client-side grouping would have been,
a partial answer presented as the whole one. See
[Totals footer](#totals-footer) for the honest version: you answer the query
for your own total, and hand the finished number over.

**Shape.** A `role="status"` region with `aria-live="polite"`: its whole job
is to report a change you caused elsewhere, and polite is what keeps a row
count from interrupting whatever a screen reader is already reading.

---

## Totals footer

```tsx
<DataTable instance={table} totals={{ amount: formatMoney(page.amountTotal) }} />
```

A row under the body, aligned with the columns, holding whatever you put
under each column id — and nothing under the rest.

**This library computes none of it.** Summing the fifty rows of a page and
presenting it as the table's total is the same lie that forced
[row grouping](#row-grouping) to be server-side: a filtered or paged result
would print a number describing only what happens to be rendered, and it is
a lie the user cannot see. Answer the query for your own total — the same
query `onQueryChange` already hands you — and pass the finished `ReactNode`.
This was the author's explicit choice over a wire field the table would fetch
on its own: a field is one more thing every backend has to implement before
the feature works at all, and a prop is not.

**It sticks to the bottom of the viewport**, the way the header sticks to the
top — `stickyHeader`'s own mechanism, mirrored rather than reinvented, with
no prop of its own to turn it off: a total that scrolls out of view is a
total nobody reads.

**It respects pinning.** A total under a column pinned to either edge sticks
with it, at the exact `column.getStart()`/`getAfter()` offset the body's own
pinned cells use — the same `pinnedStyle` helper, not a second copy of the
arithmetic.

**It respects the column's own alignment**, so money lands under money — with
no alignment concept of its own to get wrong. Each cell is a plain `.dt-td`,
the same box model (padding, height) a body cell renders with, so a
right-aligned `<span>` you already use in the Amount column's cell renderer
comes out aligned identically here.

**The leading cell carries a caption** — `labels.totalsRow`, translated in
all three shipped sets — beside whatever total you gave that same column, if
any. The row itself carries the same string as its `aria-label`, so a screen
reader does not read it as one more record.

**`totals={{}}` still draws the row**, with only the caption in it — `totals`
being absent is the only thing that renders no `<tfoot>` at all. This is
deliberate: a total that only your server can answer is not known on the
first render, and a row that popped into existence the instant the answer
landed would shift the body down by a row's height at an arbitrary moment.
Pass `{}` the moment the feature is turned on and fill it in once the answer
arrives, the way the playground's own Totals row toggle does.

A `totals` key naming a column that does not exist, or one that is hidden,
changes nothing: the row is built by walking the table's own rendered
columns, not by walking `totals`' keys, so an unmatched entry is simply never
read.

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
import { localStorageLayout } from "@hojiakbar_dev/data-table"

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

**Every colour token has to be opaque, including the tints.** A registry that keeps
opacity scalars separate from colours — `--table-row-hover` plus a hover opacity, the way
Material UI states `action.hover` — cannot hand this table the pair. Each cell paints
exactly one solid colour, and a pinned cell is `position: sticky`, so a see-through fill
would show the columns scrolling underneath it rather than compositing with the row. Hand
us a **pre-composited** colour instead: mix your tint against the surface it will sit on
and pass the result, e.g.
`--dt-row-hover: color-mix(in oklab, var(--accent) 8%, var(--background))`. Where two
tints would have stacked — a pinned column over a striped, hovered row — only one can
paint, and the row's state wins over `--dt-pinned-bg` by design; pick the composite you
want that cell to end up with rather than expecting the layers to add.

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
| `--dt-pinned-bg` | Resting fill of a pinned *body* cell — defaults to `--dt-bg`, set it to hold a frozen column apart from the ones scrolling under it. A pinned *header* cell stays on `--dt-header-bg`. The row's own state wins: a striped, hovered, expanded or group row paints its cells its own colour, tint or no tint |
| `--dt-footer-bg` `--dt-footer-fg` | The pagination band — default to `--dt-bg` / `--dt-muted-fg`. Set as a pair: the text is 13px, so a tinted band needs its foreground re-picked to stay at 4.5:1 |
| `--dt-indent` `--dt-detail-bg` | Nested rows and detail panels |
| `--dt-viewport-max-height` | Fallback height for a table nobody bounded; see [Large data](#large-data) |
| `--dt-font` `--dt-font-size` | Typography |
| `--dt-button-bg` `--dt-button-fg` `--dt-button-border` `--dt-button-radius` `--dt-button-hover-bg` | The toolbar/menu buttons, the pagination buttons and the side bar rail tabs — see [Buttons](#buttons) below |
| `--dt-button-primary-bg` `--dt-button-primary-fg` | The one emphatic action a surface has (currently the filter editor's Apply button, `.dt-menu-button-primary`) — see [Buttons](#buttons) below |

</details>

Dark mode follows `prefers-color-scheme`. Pass `theme="light"` or `theme="dark"` to pin it —
or hand the table a design system's own mode, as [Material UI](#material-ui) below does.

### Buttons

The toolbar/menu buttons, the pagination buttons and the side bar rail tabs all draw from
one group of tokens, so they restyle together instead of one override per selector:

```css
.dt-root.dt-root {
  --dt-button-bg: #fff;
  --dt-button-fg: #18181b;
  --dt-button-border: #e4e4e7;
  --dt-button-radius: 6px;
  --dt-button-hover-bg: #f4f4f5;
  /* The one emphatic action a surface has — currently the filter editor's
     Apply button. Background and foreground only; it still inherits its
     border and its rest state from the group above. */
  --dt-button-primary-bg: #2563eb;
  --dt-button-primary-fg: #fff;
}
```

Every default reproduces exactly what these buttons already painted before this group
existed — `--dt-button-bg` starts out identical to `--dt-bg`, `--dt-button-hover-bg` to
`--dt-row-hover`, and so on — so a host that never sets any of these six tokens sees no
change at all. `--dt-button-primary-bg` / `-fg` default to the *ordinary* button's own
colours for the same reason: until you (or a shadcn/MUI preset) point them at a real
accent, the emphatic button looks exactly like every other one.

**`.dt-menu-button` is public API.** A host's own buttons passed through `toolbarActions`,
`toolbarContent` or `renderSelectionActions` (the bulk-action bar) can carry this class to
match the table's own toolbar buttons pixel for pixel — border, radius, hover and all,
following the same `--dt-button-*` tokens. Add `dt-menu-button-primary` alongside it for a
button that should read as the emphatic one of that group:

```tsx
<DataTable
  instance={table}
  toolbarActions={
    <button type="button" className="dt-menu-button" onClick={exportRows}>
      Export
    </button>
  }
  renderSelectionActions={({ count, clear }) => (
    <>
      <button type="button" className="dt-menu-button dt-menu-button-primary" onClick={flagSelected}>
        Flag {count}
      </button>
      <button type="button" className="dt-menu-button" onClick={clear}>
        Cancel
      </button>
    </>
  )}
/>
```

### shadcn/ui

Two presets map the tokens onto shadcn's variables. Import one after the
base stylesheet and the table follows the host's palette, radius, font and
dark mode:

```tsx
import "@hojiakbar_dev/data-table/styles.css"
import "@hojiakbar_dev/data-table/themes/shadcn.css"      // Tailwind v4 / oklch variables
// or
import "@hojiakbar_dev/data-table/themes/shadcn-hsl.css"  // hsl(var(--x)) variables
```

Pick by how your shadcn variables are written. A complete colour such as
`oklch(0.62 0.19 259)` needs `shadcn.css`; a bare channel triplet such as
`221 83% 53%`, read by the host as `hsl(var(--primary))`, needs
`shadcn-hsl.css`. The wrong file produces no colour at all rather than a
warning, so check one variable before deciding.

Both presets map the [button tokens](#buttons) onto the same roles shadcn's own `<Button>`
uses: `--secondary` / `--secondary-foreground` for `.dt-menu-button`, `--primary` /
`--primary-foreground` for `.dt-menu-button-primary`, `--radius` for the corner and
`--input` for the border — so a table styled with either preset picks up the host's
existing button look with no `--dt-button-*` override needed.

#### Your own table tokens win

shadcn's vocabulary stops at general roles, so a table header can only be
approximated — from `--muted`, which is rarely the colour a design system
actually intends for one. If yours has gone further and named the table
surfaces itself, both presets read **your** token first and fall back to the
shadcn variable they have always used:

| Your token | Sets |
|---|---|
| `--table-header-bg` `--table-header-fg` | The header row, instead of `--muted` / `--muted-foreground` |
| `--table-row-hover` | The hover fill, instead of `--accent` |
| `--table-row-stripe` | The stripe, instead of a mix of `--muted` and `--background` |
| `--table-pinned-bg` | The resting fill of a pinned body cell, instead of `--background` |
| `--table-footer-bg` `--table-footer-fg` | The pagination band, instead of `--background` / `--muted-foreground` |

Define none of them and nothing changes — every fallback fires and the output
is what it was before these existed. Define some and only those move. There is
no second import and no flag.

These tokens *refine* a shadcn palette; they do not replace one. Everything
they do not name still reads `--background`, `--foreground`, `--muted`,
`--muted-foreground`, `--border` and `--primary` directly, with no fallback of
its own — so a host that defines the `--table-*` group and none of the shadcn
variables gets **no palette at all**, not a partial one: cells paint
transparent and the border colour collapses onto the text colour. Reach for a
preset only over a complete shadcn variable set. If your design system names
its table surfaces but not the shadcn roles, set the `--dt-*` tokens yourself
on `.dt-root` and skip the preset entirely.

`--table-row-selected` is not read. [Row selection](#row-selection) exists,
but a selected row is marked by its own ticked checkbox rather than by a tint
on the row: the header checkbox selects rows the browser has never been sent,
so a tint could only ever colour the handful on screen and would read as "these
are the selected ones". Mapping the token would publish a colour that paints
nothing.

**In `shadcn-hsl.css`, a `--table-*` value is a complete colour, not a channel
triplet** — `hsl(210 40% 96%)`, not `210 40% 96%`. The `hsl()` wrapper in that
file belongs to the *shadcn* variable, which is what makes a bare triplet a
colour; your table token carries no such convention and reaches the table the
way every `--dt-*` token does. If your table group really does hold triplets,
map it yourself in one rule at `.dt-root.dt-root.dt-root`, as below.

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

### Material UI

MUI gets a function rather than a stylesheet:

```tsx
import { useTheme } from "@mui/material"
import { muiTokens } from "@hojiakbar_dev/data-table"

const theme = useTheme()
return <DataTable instance={table} style={muiTokens(theme)} />
```

A stylesheet preset works by pointing `--dt-*` at the host's own custom
properties, and **a MUI v5 application publishes none** — there is nothing for
a stylesheet to read, so the shadcn approach cannot be repeated here. v6 in
CSS-variables mode does publish `--mui-*`, but its `theme.palette` still holds
those `var(--mui-…)` references, so reading the theme object covers both
versions with one code path. The library does not depend on MUI and does not
import it, not even as a type: the parameter is typed structurally against the
fields actually read, each optional, so a v5 theme, a v6 theme and a
hand-written object all compile and no host needs MUI installed to typecheck.

| Token | From | |
|---|---|---|
| `--dt-bg` | `palette.background.paper` | the table is a raised surface on the page |
| `--dt-header-bg` | `palette.background.default` | …but only when the host set it apart from `paper`; see below |
| `--dt-fg` `--dt-muted-fg` | `palette.text.primary` / `.secondary` | |
| `--dt-header-fg` | `palette.text.secondary` | a header label is quieter body text, not a heading |
| `--dt-border` `--dt-resize-handle` | `palette.divider` | |
| `--dt-accent` | `palette.primary.main` | |
| `--dt-accent-fg` | `palette.primary.contrastText` | what that field is for — text printed *on* the accent |
| `--dt-accent-text` | `palette.primary.main` | unchanged: `primary.main` is already what MUI prints as text on a surface (`Link`, a text `Button`) |
| `--dt-row-hover` | `palette.action.hoverOpacity` | recomposited — see below |
| `--dt-row-stripe` | a quarter of that hover | a permanent tint has to stay quieter than a transient one |
| `--dt-detail-bg` | `palette.action.selectedOpacity` | a panel you opened is a region, not a hover |
| `--dt-radius` | `shape.borderRadius` | unitless numbers mean pixels |
| `--dt-font` `--dt-font-size` | `typography.fontFamily` / `.fontSize` | |
| `--dt-button-bg` `--dt-button-fg` `--dt-button-border` | `--dt-bg` / `--dt-fg` / `--dt-border` above | MUI has no dedicated "secondary button" palette role; an outlined MUI button is already paper with a divider border |
| `--dt-button-radius` | `shape.borderRadius` | falls back to 6px, not `--dt-radius`'s 8px — the base sheet's own button radius |
| `--dt-button-hover-bg` | `palette.action.hoverOpacity` | same recomposited tint as `--dt-row-hover` |
| `--dt-button-primary-bg` `--dt-button-primary-fg` | `palette.primary.main` / `.contrastText` | the [emphatic button](#buttons) — same values as `--dt-accent` / `--dt-accent-fg` above |

Three of those need a word.

**The header.** MUI's own stock palettes state `background.paper` and
`background.default` identically — `#fff` and `#fff` in v5 light, `#121212`
twice in v5 dark — so copying `default` would give the header the body's exact
colour. When the host *has* set the two apart, as an admin template with a
tinted page background has, their `default` is used. When it has not, the
header is tinted off the surface instead. Either way it still reads as a
header.

**The action tints.** MUI states `action.hover` and `action.selected` as
translucent colours meant to be laid over whatever is beneath them, and this
table cannot take them that way: a cell paints an opaque `--dt-bg`, and a
pinned cell is `position: sticky`, so a see-through hover would show the
columns scrolling underneath it. The *opacities* are read instead and
recomposited against `--dt-bg` with `color-mix()`, which is the same recipe
MUI uses (`alpha(common.black | common.white, …)`) with an opaque result.

**Not covered.** Density and shape: row height, header height, indent,
borders, elevation. The table keeps its own proportions and takes your
palette, typography and radius — `muiTokens` is a colour bridge, not a MUI X
Data Grid impersonation. Set the sizes the usual way, on `.dt-root`.

#### Dark mode

**The MUI theme's `palette.mode` wins, and it is meant to.** An inline style
beats every stylesheet rule, so these tokens override both the built-in
`prefers-color-scheme` block and the `theme` prop — pass the table your MUI
theme and its mode is your application's, not the operating system's and not
the prop's. Drive it from MUI's own `ThemeProvider` and drop the `theme` prop;
leaving it on is not an error, it simply has nothing left to decide.

That is only safe because `muiTokens` emits **every** token the base sheet
swaps between its light and dark blocks. A partial map would leave a light MUI
theme with dark borders on a machine set to dark; a test asserts the two sets
still match. For the same reason the fallbacks come in pairs: a theme that
states nothing but `palette: { mode: "dark" }` gets the built-in *dark*
palette, and `muiTokens({})` reproduces the built-in light one exactly.

#### Contrast

The palette is yours, so its contrast is yours: a `primary.main` that fails
4.5:1 as text on `background.paper` fails here too, because the table prints it
as text in the same places MUI does. What `muiTokens` guarantees is that it
introduces no failure of its own — every token is either copied from the theme
unchanged or derived by a rule that cannot move a pair's contrast further than
the tint strength MUI itself stated. Two cases worth knowing:

- A hand-written theme that sets `primary.main` and omits
  `primary.contrastText` gets the built-in `--dt-accent-fg`, which was tuned
  against the built-in accent. Set both, or let `createTheme` compute it.
- Override anything afterwards by putting it later in the same object:
  `style={{ ...muiTokens(theme), "--dt-accent-text": "#1565c0" }}`.

---

## Headless use

`DataTable` is optional. The hook returns the TanStack instance plus this library's
additions, so you can render whatever markup you need and keep the behaviour:

```tsx
import { useDataTable, pinnedStyle, renderedLeafColumns } from "@hojiakbar_dev/data-table"

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
import type { DataTableFeatures } from "@hojiakbar_dev/data-table"

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
import { DataTable, ruLabels, uzLabels } from "@hojiakbar_dev/data-table"

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
Below 640px the rail stays where it is — it is the only way into the panel, at
any width — and the panel it opens overlays the card at full width instead of
docking beside it, with the rail laid horizontally across the top of that
overlay.

`<TablePanel instance={instance} labels={…} tab={tab} onTabChange={setTab} onReorder={…} onClose={…} />` —
the side panel with both tabs, for a shell that wants to choose which one opens;
`<ColumnsTab>` and `<FiltersTab>` are its halves. The Filters tab lists every
filterable column, **hidden ones included and marked** — a hidden column's
filter goes on applying and its header is not there to say so.

The Columns tab lists the column **tree**, not a flat run of leaves: a group,
then its children indented beneath it, to whatever depth the columns nest.

- A group carries its own checkbox. Ticking it shows every leaf under it,
  unticking hides them all, and it is **indeterminate** when only some are
  visible — clicking it then shows the rest rather than hiding what is left.
- A group collapses, per group, expanded by default. Collapsed state is UI
  state and not part of the saved layout, so `resetLayout` does not touch it.
- **Every column keeps its row, hidden or not**, and a group keeps its row even
  when every leaf under it is hidden. A row is how a hidden column is shown
  again; a list of only the visible ones is a one-way door.
- **A group row carries a drag handle of its own**, like the header's, and
  dragging it moves the whole group — every leaf under it, in the order it
  already had. Pointer and keyboard both, on the same terms.
- Dragging inside the tree still refuses to cross a group boundary, which is
  `dropRegionOf`'s rule and not the tree's — a leaf that left its group would
  tear the group's header apart, and a group dropped into another one would
  nest it somewhere the column definitions never put it. A drag is always a
  move among **siblings**, so the drop slot, the keyboard's reachable run and
  the announced "position 2 of 4" are all counted at the dragged row's own
  level — never in leaves, because a group three columns wide does not land on
  one-column steps.
- A group split by pinning — TanStack draws its header twice, once over the
  pinned part and once over the rest — is listed twice, the same way, and each
  half answers for its own run. Neither half is the group, so neither offers a
  handle: there is no honest place for it to go.

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
| `data` | `(TData \| GroupRow)[]` | — | One page in server mode. A grouped page interleaves group headers; the table recognises them and hands one to no callback of yours. |
| `columns` | `ColumnDef[]` | — | Standard TanStack column definitions. |
| `storage` | `LayoutStorage` | none | Where layouts live. |
| `initialLayout` | `Partial<TableLayout>` | `{}` | Applied on a user's first visit. |
| `features` | `DataTableFeatureFlags` | all on except `selection`/`rowNumbers`/`statusBar` | Turn off `sorting`, `resizing`, `reordering`, `pinning`, `hiding`, `heightGrip` or `grouping`; turn **on** `selection`, `rowNumbers` or `statusBar` (`true`, or `{ scope: "page" }` for `selection`, or a `ReactNode` for the bar's host slot). See [Row selection](#row-selection), [Row numbers](#row-numbers), [Row grouping](#row-grouping) and [Status bar](#status-bar). |
| `defaultColumnWidth` | `number` | `160` | |
| `minColumnWidth` | `number` | `60` | |
| `maxColumnWidth` | `number` | `800` | |
| `direction` | `"ltr" \| "rtl"` | `"ltr"` | Which way a drag widens a column. |
| `getSubRows` | `(row: TData) => TData[]` | — | Child rows, for tree data. |
| `canExpand` | `(row: TData) => boolean` | all rows | Which rows may open a detail panel. |
| `mode` | `"client" \| "server"` | `"client"` | `"server"`: `data` is one page, already sorted; the table only describes what it wants. |
| `rowCount` | `number` | — | Total rows across all pages. Server mode only; undefined until known. |
| `unfilteredTotal` | `number` | — | Rows before the active filter and search narrowed them, for the status bar's "X of Y". Server mode only; optional, undefined until answered. See [Status bar](#status-bar). |
| `pagination` | `boolean \| PaginationOptions` | off (client) / on (server) | `{ pageSize?, pageSizeOptions? }`. See [Server-side data](#server-side-data). |
| `filtering` | `boolean \| FilteringOptions` | on | `{ debounceMs?, persist?, searchFields?, loadValues? }`. `false` turns filtering off. |
| `startPath` | `FilterValue[]` | `[]` | The open group the page's first row sits inside. See [Row grouping](#row-grouping). |
| `getRowId` | `(row: TData, index: number, parent?: Row) => string` | — | Stable row identity. Required in server mode for expansion to follow records across pages, and effectively required by [row selection](#row-selection) in either mode. Never called for a group header, whose id is its key path joined. |
| `onQueryChange` | `(query: TableQuery) => void` | — | Called with the query on mount and after every change to it. |
| `onSelectionChange` | `(selection: SelectionChange) => void` | — | Called whenever the selection changes, including when the table clears it because the query moved. Carries the model, the query it is relative to and the count. Not called on mount. See [Row selection](#row-selection). |
| `rowHeight` | `number` | `40` | Pixel height of a data row; also sets `--dt-row-height`. |
| `getRowHeight` | `(row: TData) => number` | — | Height for particular rows, known ahead of render. A pure function of its row; may be inline. |
| `heightVersion` | `string \| number` | — | Changes when `getRowHeight` starts answering differently, for a change too narrow for the table to sample. See [Large data](#large-data). |

Returns `{ table, id, flags, bounds, reorderColumn, resetLayout, isCustomised, expanded, mode, query, pagination, filtering, grouping, selection, tableHeight, rowHeight, getRowHeight, heightVersion }`.

`grouping` is `{ enabled, columns, isGrouped, has, columnId, set, add, remove, clear, expanded, isExpanded, toggle, collapseAll, startPath }` — see [Row grouping](#row-grouping).

`selection` is `{ enabled, headerScope, model, count, rowsMatching, isEmpty, isRowSelected, toggleRow, toggleAll, clear, headerChecked, headerIndeterminate, summary }` — see [Row selection](#row-selection).

### `<DataTable />`

| Prop | Type | Default | |
|---|---|---|---|
| `instance` | `DataTableInstance` | — | **Required.** From `useDataTable`. |
| `striped` | `boolean` | `false` | |
| `height` | `number \| string` | auto | Fixed height for the whole table, toolbar included; header and pinned columns stay put while the rows scroll. Virtualisation needs this, or a height on an ancestor — see [Large data](#large-data). |
| `toolbar` | `boolean` | `true` | |
| `toolbarContent` | `ReactNode` | — | Rendered at the toolbar's leading edge. |
| `toolbarActions` | `ReactNode` | — | Rendered at the toolbar's trailing edge. |
| `renderSelectionActions` | `(selection: SelectionSummary) => ReactNode` | — | A bulk-action bar above the table, rendered **only while rows are selected** and handed `clear()` beside the model, the query and the count. See [Row selection](#row-selection). |
| `totals` | `Record<string, ReactNode>` | — | A row under the body, keyed by column id. Computes nothing — you answer the query for your own total. Absent renders no `<tfoot>`; `{}` still renders the row, caption only. See [Totals footer](#totals-footer). |
| `emptyState` | `ReactNode` | `labels.empty`, or `labels.noMatches` with a Clear filters and/or Clear grouping button while the table is filtered or grouped | Supplying this replaces **both** defaults, including the narrowed-empty exit — a host that wants its own art for "no data" but still wants a way out should branch on `instance.filtering.isFiltered` and `instance.grouping.isGrouped` itself. |
| `labels` | `Partial<DataTableLabels>` | English | Every string, for translation. |
| `theme` | `"light" \| "dark"` | system | Ignored for any token a `style` of your own sets — see [Material UI](#material-ui). |
| `className` | `string` | — | Added to `.dt-root`. |
| `style` | `CSSProperties` | — | Inline styles on `.dt-root`, which is where `muiTokens(theme)` goes. The table's own `height` and `--dt-row-height` still win over it. |
| `renderDetail` | `(row: TData) => ReactNode` | — | Content revealed under an expanded row. |
| `stickyHeader` | `boolean` | `true` | Keep the header in view while the body scrolls. |
| `onRowClick` | `(row: TData) => void` | — | |
| `onRowContextMenu` | `(row: TData, event: MouseEvent) => void` | — | A right-click on a data row, for the host's own row menu. Call `event.preventDefault()` when you open one; group and totals rows do not call it. |
| `footer` | `boolean` | `true` | Show the pagination footer when paging is on. |
| `virtualize` | `boolean` | `true` | Render only the visible window of rows. `false` renders every row. |
| `loading` | `boolean` | `false` | Rows are on their way. Skeleton rows with none yet, a progress bar once some are on screen. |
| `error` | `unknown` | — | Loading failed. Shown as a banner with a Retry button when `onRetry` is given. |
| `onRetry` | `() => void` | — | Called by the Retry button. |
| `onCellEdit` | `(edit: { row, columnId, value, previous }) => void \| Promise<void>` | — | Save one cell's edit. Without it no column can be edited. See [Editing cells](#editing-cells). |

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
- Every [selection](#row-selection) checkbox is a real `<input type="checkbox">`: in the `Tab`
  order, answering `Space`, reporting its own state, and rendering the third one. A row's box is
  named with the row's place in the result set (`selectRow`), because otherwise every box in the
  column is announced identically; the header's says what it will take and how many that is
  (`selectAllRows`) — and says it with no number at all until the server has answered, rather
  than naming the control after a figure nobody can stand behind. The header's `indeterminate`
  is written to the DOM property, which is the only place it exists: there is no attribute for
  it and no way to reach it from CSS.
- The [row-number](#row-numbers) column's header is empty to the eye and carries the
  `rowNumber` label for a screen reader. The number it prints is the same quantity every row
  already announces as `aria-rowindex`, so the two can never tell a user two different things
  about where a row is.
- The [status bar](#status-bar) is a `role="status"` region with `aria-live="polite"`: it exists
  to report a change you caused elsewhere, and polite is what keeps a row count from interrupting
  whatever a screen reader is already reading. Its total, filtered and grouped-by parts are
  separate elements rather than one concatenated sentence, so a translation can put a different
  one first.
- Reordering has a keyboard path: each row of the **Columns** panel carries a drag handle that
  is in the `Tab` order — a group row's included, so a group is not the one thing that needs a
  mouse. `Space` picks the row up, the arrow keys move the drop slot, `Space` puts it down and
  `Escape` gives it back. The handle reports `aria-pressed`, and every position — including the
  one a cancel returns to — is announced politely, counted at the row's own level, which is the
  only run the arrows can reach. A group speaks its name through `columnGroup`, the same
  "Document column group" its checkbox already uses, so a group and a column of one name are
  told apart by ear. The slot stops at a group or pinning boundary, because a move across one is
  refused. The strings it speaks are the `reorderHint`, `reorderPosition` and `columnGroup`
  labels.
- The cell menu is the header menu's sibling: it opens at the pointer, clamps itself into
  the viewport, takes the focus on its first item, closes on `Escape` and hands the focus back
  to the cell it opened on. A cell that cannot be edited still gets the menu, with the reason
  written into Edit's own accessible name rather than hidden in a tooltip. A pending cell is
  dimmed **and** says "Saving" to a screen reader; an edit notice is a live region, assertive
  for a refusal and polite otherwise.
- **Cell editing is reachable by pointer only.** A body cell cannot hold focus yet, so there is
  no cell for the ContextMenu key or `Shift+F10` to open a menu on. See
  [Editing cells](#editing-cells).
- `prefers-reduced-motion` disables transitions.

---

## Development

```bash
pnpm install
pnpm dev          # the playground, on http://localhost:5199
pnpm test         # the suite
pnpm typecheck
pnpm build        # the library, into dist/
pnpm build:demo   # the playground as a static site, into demo-dist/
```

The playground in `src/demo/` is not a toy: it talks to a fake server in
`src/demo/fakeServer.ts` that implements the whole wire contract — every filter operator,
the search, the sorting rules, the grouping and the paging — over 100 000 rows. That is
deliberate. A fake server that fakes its answers teaches nothing, and building it first is
what exposed the gap in the grouping contract that `startPath` now fills.

`pnpm build` and `pnpm build:demo` use **different Vite configs**. The library build
externalises React and TanStack, because a library must not bundle its host's copy; the
demo build bundles them, because a static site has no import map to resolve them. The demo
also carries `base: "/data-table/"`, since GitHub Pages serves it from a project subpath.

Pushing to `main` deploys the playground to GitHub Pages, gated on the typecheck and the
full suite passing first — a Pages deploy is not reviewed the way a pull request is, so
the gate is the only thing standing between a broken commit and a broken live demo.

### Releasing

A release is a tag. Bump the version, tag it, push the tag:

```bash
npm version patch          # or minor / major — writes package.json and tags
git push --follow-tags
```

The release workflow then checks that the tag and `package.json` agree, runs the
typecheck, the suite and the build, and publishes.

**No npm token is stored anywhere.** Publishing uses npm's
[trusted publishing](https://docs.npmjs.com/trusted-publishers/): GitHub Actions mints a
short-lived OIDC token scoped to this repository and this workflow file, and npm trusts it
because the package is configured to. There is no long-lived credential to leak, to
rotate, or to hand around — and the account keeps its 2FA, which an automation token that
bypasses 2FA would have undermined. Provenance attestations are attached automatically, so
the published package carries a verifiable record of the commit and workflow that built
it.

Configured once, on npmjs.com → the package → Settings → Trusted publishing, naming this
repository and `release.yml`.

## Requirements

React 18 or 19, and `@tanstack/react-table` v9 and `@tanstack/react-virtual` v3
as peer dependencies.

## Licence

MIT
