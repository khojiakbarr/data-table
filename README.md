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
| **Reorder columns** | Drag a header onto another; a caret shows which side it will land on. |
| **Sort** | Click a header: ascending, descending, off. Multi-sort shows its position. |
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
to be a pure function of its row. Change what it answers for the same row —
a density toggle, say — and the table notices from the rows on screen and
measures again on the next frame.

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
`TableQuery` — sorting, pagination, and (reserved for later) filters and
grouping. With TanStack Query:

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
  // `exactOptionalPropertyTypes` rejects `rowCount: undefined` — spread the
  // key in only once it is known, rather than writing it with `| undefined`.
  ...(data ? { rowCount: data.total } : {}),
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

---

## Styling

Every colour and dimension is a CSS custom property with a working default, so the table
looks finished out of the box and restyles without touching its source:

```css
.my-app {
  --dt-header-bg: var(--table-header-bg);
  --dt-row-hover: var(--table-row-hover);
  --dt-accent: var(--primary);
  --dt-radius: 6px;
}
```

<details>
<summary>All tokens</summary>

| Token | Purpose |
|---|---|
| `--dt-bg` `--dt-fg` `--dt-muted-fg` | Surface and text |
| `--dt-border` `--dt-radius` | Edges |
| `--dt-header-bg` `--dt-header-fg` `--dt-header-height` | Header row |
| `--dt-row-hover` `--dt-row-stripe` `--dt-row-height` | Body rows |
| `--dt-accent` `--dt-accent-fg` `--dt-focus-ring` | Interactive accents |
| `--dt-resize-handle` `--dt-resize-handle-active` | Resize handle |
| `--dt-drop-indicator` | Reorder caret |
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
sheet, so `--dt-header-height`, `--dt-row-height`, `--dt-indent` and
`--dt-font-size` are still yours to set on `.dt-root`. A mapped token needs a
rule that matches the preset's specificity, which the repeated class gives
without excluding anything:

```css
.dt-root.dt-root {
  --dt-accent: var(--chart-2);
}
```

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
const { items, top, bottom, measureElement } = useRowVirtualizer({
  rows: table.getRowModel().rows,
  viewportRef,
  headRef,
  rowHeight: instance.rowHeight,
  getRowHeight: instance.getRowHeight,
  isDetailOpen: useCallback((row) => row.getIsExpanded(), []),
  enabled: true,
})
```

`useUnboundedViewport()` — the check behind the fallback bound in
[Large data](#large-data), for a shell with its own viewport. It answers
whether the scroller it was given has a height of its own; render
`data-dt-unbounded` on the viewport when it says no, and the stylesheet does
the rest.

`<TablePagination instance={instance} labels={labels} />` — the footer
`<DataTable>` renders when `footer` is on, exported so a shell of your own can
reuse it rather than rebuild the range math and page-size select.

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
| `getRowId` | `(row: TData, index: number, parent?: Row) => string` | — | Stable row identity. Required in server mode for expansion to follow records across pages. |
| `onQueryChange` | `(query: TableQuery) => void` | — | Called with the query on mount and after every change to it. |
| `rowHeight` | `number` | `40` | Pixel height of a data row; also sets `--dt-row-height`. |
| `getRowHeight` | `(row: TData) => number` | — | Height for particular rows, known ahead of render. A pure function of its row; may be inline. |

Returns `{ table, id, flags, bounds, resetLayout, isCustomised, expanded, mode, query, pagination, rowHeight, getRowHeight }`.

### `<DataTable />`

| Prop | Type | Default | |
|---|---|---|---|
| `instance` | `DataTableInstance` | — | **Required.** From `useDataTable`. |
| `striped` | `boolean` | `false` | |
| `height` | `number \| string` | auto | Fixed height for the whole table, toolbar included; header and pinned columns stay put while the rows scroll. Virtualisation needs this, or a height on an ancestor — see [Large data](#large-data). |
| `toolbar` | `boolean` | `true` | |
| `toolbarContent` | `ReactNode` | — | Rendered before the Columns button. |
| `emptyState` | `ReactNode` | `labels.empty` | |
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
- Sort controls, the resize handle, the per-column menu and the Columns panel are all
  reachable by keyboard with a visible focus ring. A focused resize handle resizes with
  ← / → (Shift for larger steps) and fits the column on Enter.
- The Columns panel closes on `Escape` and on an outside click.
- The per-column menu opens from a button as well as from right-click, and is reachable
  by keyboard; it closes on `Escape`.
- Row toggles report `aria-expanded` and name themselves.
- Reordering is drag-only today. If you need a keyboard path, the Columns panel is the
  place to add it — see [#1](https://github.com/khojiakbarr/data-table/issues).
- `prefers-reduced-motion` disables transitions.

---

## Requirements

React 18 or 19, and `@tanstack/react-table` v9 and `@tanstack/react-virtual` v3
as peer dependencies.

## Licence

MIT
