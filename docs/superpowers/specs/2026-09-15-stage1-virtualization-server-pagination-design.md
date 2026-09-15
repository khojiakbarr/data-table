# Stage 1 — Row virtualisation, server-side data model, pagination, shadcn theme

Date: 2026-09-15 · Package: `@khojiakbarr/data-table` · Target version: 0.4.0

## Goal

Make the table usable on real ERP data: tens of thousands of rows without
DOM cost, a clean contract for tables whose rows live on a server, a
pagination footer whose page size the user can change, and colours/radius
that follow a shadcn/ui host application without configuration.

This is the first of four stages agreed with the author:

1. **This stage** — virtualisation, server-side model, pagination, shadcn preset.
2. Quick search, per-column filters, Filters side-panel tab.
3. Side panel with a Columns tab (tree, drag, Row Groups / Values zones).
4. Row grouping (client-side, then server-side lazy children).

Everything in this spec keeps the current behaviour for existing users: a
table with no new options renders exactly as today.

## Decisions taken with the author

| Question | Decision |
|---|---|
| Server contract | Neutral `TableQuery` + `onQueryChange`; the host fetches (TanStack Query) and passes `data`, `rowCount`. No fetching inside the table. |
| Paging model | Page-based pagination now; infinite scroll later behind `paginationMode: "infinite"` on the same foundation. |
| Row heights | Uniform `rowHeight` per table, `getRowHeight(row)` for known exceptions, measurement only for detail panels. |
| Column virtualisation | Not now (10–30 columns typical). Row virtualisation only. |
| Rendering technique | Keep `<table>` markup; virtualise with top/bottom spacer rows. |
| shadcn integration | Token preset (`themes/shadcn.css`), no component slots. |

Licensing note: AG Grid's pagination, row virtualisation and client-side
row model are MIT (Community) and may inform the logic. Its server-side row
model, row grouping and tool panels are Enterprise-licensed and are not
copied; those stages are built on TanStack's own features.

## Non-goals

- Column virtualisation, infinite scroll, selection, editing.
- Component slots for shadcn primitives (buttons, selects). Tokens only.
- Row grouping, filters, quick search (later stages — the query object
  already reserves their fields so the server contract will not change).

## Architecture

```
useDataTable ──── owns layout (persisted) + transient state (expanded, pageIndex)
   │                 builds TableQuery, calls onQueryChange
   │
   ├── mode: "client"  → TanStack row models: core → sorted → expanded → paginated
   └── mode: "server"  → manualSorting/manualFiltering/manualPagination: rows pass through

<DataTable>
   ├── toolbar (unchanged)
   ├── .dt-viewport (scrolls)
   │     ├── <table> thead (sticky, unchanged)
   │     ├── tbody: spacer ▸ virtual rows ▸ spacer      ← useRowVirtualizer
   │     ├── loading progress bar / error banner / skeleton / empty
   └── .dt-footer: Rows: N · rows per page ▾ · 1–50 of 1 000 · ⏮ ◀ [3] ▶ ⏭
```

## Data model and query contract

### New `useDataTable` options

| Option | Type | Default | Notes |
|---|---|---|---|
| `mode` | `"client" \| "server"` | `"client"` | Server mode sets `manualSorting`, `manualFiltering`, `manualPagination` (and `manualGrouping` when stage 4 lands). |
| `rowCount` | `number` | derived | Total rows across all pages. Required in server mode; ignored in client mode. |
| `pagination` | `boolean \| { pageSize?: number; pageSizeOptions?: readonly number[] }` | client: `false`, server: `true` | `pageSize` default 50, `pageSizeOptions` default `[20, 50, 100, 200]`. A `pageSize` not in the options is added to them. |
| `getRowId` | `(row, index, parent?) => string` | TanStack default (index) | Strongly recommended in server mode: row identity must survive page changes for expansion state and virtualiser keys. |
| `onQueryChange` | `(query: TableQuery) => void` | — | Called after mount with the initial query, then after every change. Called in both modes. |
| `rowHeight` | `number` | `40` | Pixel height of a data row. Written to `--dt-row-height` on the root so CSS and the virtualiser agree. |
| `getRowHeight` | `(row: TData) => number` | — | Per-row override, known ahead of render. |

### `TableQuery`

```ts
interface TableQuery {
  sorting: SortingState                    // [{ id, desc }]
  columnFilters: ColumnFiltersState         // stage 2; always [] for now
  globalFilter: string                      // stage 2; always "" for now
  grouping: GroupingState                   // stage 4; always [] for now
  pagination: { pageIndex: number; pageSize: number }
}
```

`instance.query` is memoised: it changes identity only when one of its
fields changes, so it can be used directly as a TanStack Query key.
`onQueryChange` is fired from an effect keyed on the same fields; the first
call happens on mount so the host performs the initial fetch with the
persisted sorting and page size.

### Page state

- `pageSize` is part of `TableLayout` (new optional field `pageSize`) and is
  persisted like every other layout choice. `pruneLayout` keeps it when it is
  a positive finite number.
- `pageIndex` is transient state in the hook, like `expanded`.
- `pageIndex` resets to 0 when `sorting`, `columnFilters`, `globalFilter` or
  `grouping` change, in both modes, done by the hook itself. TanStack's
  `autoResetPageIndex` is set to `false` because it also fires on every
  `data` identity change, which in server mode is every fetch.
- When `rowCount` shrinks below the current page, `pageIndex` is clamped to
  the last page (effect in the hook).
- `setPageSize` keeps the first visible row on screen: TanStack's own
  `setPageSize` already recomputes `pageIndex = floor(topRow / newSize)`.

### Client mode with pagination on

`createPaginatedRowModel()` slices the sorted/expanded rows; `rowCount` is
the pre-paginated row count; `pageCount` is derived by TanStack.

### Server mode

`pageCount = ceil(rowCount / pageSize)` is passed to TanStack so
`getCanNextPage()` / `getCanLastPage()` are correct. Rows are rendered as
received; no local sort, filter or slice. `data` may be a fresh array on
every render.

### Host usage (documented in README)

```tsx
const [query, setQuery] = useState<TableQuery>()
const { data, isFetching, error, refetch } = useQuery({
  queryKey: ["receipts", query],
  queryFn: () => api.receipts(query!),
  enabled: query !== undefined,
  placeholderData: keepPreviousData,
})
const table = useDataTable({
  id: "receipts", columns, mode: "server",
  data: data?.rows ?? EMPTY, rowCount: data?.total,
  getRowId: (row) => row.id, onQueryChange: setQuery,
})
<DataTable instance={table} loading={isFetching} error={error} onRetry={refetch} />
```

## Virtualisation

### Library

`@tanstack/react-virtual` `^3.14` as a **required peer dependency**
(React 16.8–19 peers, ~7.8 kB gzip, ESM). It is imported only by
`useRowVirtualizer`, so a headless shell that does not virtualise pays
nothing at runtime beyond the module load.

### DOM technique

The `<table>`, `<colgroup>`, sticky `<thead>`, pinned cells and filler are
untouched. `<tbody>` renders:

1. a top spacer `<tr class="dt-spacer" aria-hidden>` with one
   `<td colSpan=…>` and `height = firstVisible.start − scrollMargin`;
2. the visible rows (viewport ± `overscan: 8`), in normal flow;
3. a bottom spacer with `height = totalSize − lastVisible.end`.

Rows stay in normal table flow, so `position: sticky` on pinned cells and
`table-layout: fixed` widths behave exactly as they do today. The two
spacer heights are the only styles that change per scroll frame.

`scrollMargin` is the rendered height of `<thead>` (it sits inside the same
scroll element, before the rows); it is read with a ResizeObserver on the
`<thead>` so grouped headers of any depth work.

### Items and sizes

The virtualiser's item list is the *display list*: for each TanStack row
(already flattened by the expanded row model, so tree children are
included) one `row` item, followed by a `detail` item when the row is
expanded and `renderDetail` is set. A pure helper builds this list and is
unit-tested on its own.

- `estimateSize(index)`: for a `row` item, `getRowHeight?.(row.original) ?? rowHeight`;
  for a `detail` item, `DETAIL_ESTIMATE_PX = 160` until measured.
- Data rows are never measured: their size is exact by construction, so the
  scrollbar is exact even with 100 000 rows and there is no ResizeObserver
  per row.
- Detail rows carry `data-index` and `ref={virtualizer.measureElement}`;
  the ResizeObserver re-measures when the panel's content changes height.
  The known Firefox off-by-border on `<tr>` measurement is tolerated (≤1px).
- `getItemKey` returns `row.id` (or `row.id + ":detail"`), so a page change
  in server mode does not reuse DOM across unrelated rows.

### Striping and parity

`.dt-striped .dt-tr:nth-child(even)` cannot work with spacers and virtual
windows. Rows carry `data-parity="even" | "odd"` computed from the row's
index in the row model; CSS keys on the attribute. This also fixes the
deferred finding that a detail row flipped stripe parity.

### Opt-out

`<DataTable virtualize={false}>` renders every row without spacers. Used
for printing, tiny tables and tests that assert on the whole body.

### Headless

`useRowVirtualizer(instance, viewportRef, { rowHeight, getRowHeight, expanded, renderDetail })`
returns `{ items, topSpacer, bottomSpacer, measureElement }` and is
exported, mirroring `useAutosize`.

## Footer and loading states

### Footer (`.dt-footer`)

Outside the scrolling viewport, `flex: none`, hidden when pagination is off
and there is nothing to show. Left to right, following AG Grid's default
order:

1. `Rows: 1 000` — `rowCount`. (In stage 2 becomes `Rows: 40 of 1 000` when filtered.)
2. spacer
3. `Rows per page` `<select>` with `pageSizeOptions`.
4. `1–50 of 1 000` (1-based, en dash).
5. First / Previous buttons, a page number `<input type="number">`
   (`Page 3 of 20` around it), Next / Last buttons. Buttons carry
   `aria-label`s and are disabled at the edges; Enter or blur on the input
   navigates, out-of-range values are clamped.

All strings are `DataTableLabels` entries; the range and page texts are
label functions so word order can change per language.

### States (`<DataTable loading error onRetry>`)

| Situation | Rendering |
|---|---|
| `loading` and no rows | Skeleton: `min(pageSize, 8)` rows of shimmer bars, one per column, sized by column width. |
| `loading` with rows | 2px indeterminate progress bar pinned to the top of the viewport; rows at 60% opacity but still interactive. |
| `error` | Banner at the top of the viewport: message (`String(error.message ?? error)`) and a Retry button calling `onRetry`; existing rows stay visible beneath. |
| no rows, not loading, no error | Existing `emptyState`. |

Loading takes precedence over empty, error over loading, as in AG Grid.
`prefers-reduced-motion` disables the shimmer and progress animation.

## shadcn theme preset

Two CSS files are shipped and exported from the package:

- `@khojiakbarr/data-table/themes/shadcn.css` — for hosts whose shadcn
  variables are complete colours (Tailwind v4 / oklch era): `var(--background)`.
- `@khojiakbarr/data-table/themes/shadcn-hsl.css` — for the older
  channel-triplet format: `hsl(var(--background))`.

Mapping:

| Table token | shadcn variable |
|---|---|
| `--dt-bg` / `--dt-fg` | `--background` / `--foreground` |
| `--dt-muted-fg` | `--muted-foreground` |
| `--dt-border`, `--dt-resize-handle` | `--border` |
| `--dt-header-bg` / `--dt-header-fg` | `--muted` / `--muted-foreground` |
| `--dt-row-hover` | `--accent` |
| `--dt-row-stripe`, `--dt-detail-bg` | `color-mix(in oklab, var(--muted) 50%, transparent)` (`--muted` in the HSL file) |
| `--dt-accent`, `--dt-drop-indicator` | `--primary` |
| `--dt-focus-ring` | `--ring` |
| `--dt-radius` | `--radius` |
| `--dt-font` | `--font-sans`, falling back to `inherit` |

Dark mode is the host's business: shadcn swaps its variables on `.dark`, and
the preset maps onto them under every table theme state. The preset's
selectors match or exceed the specificity of the base dark-mode rules
(`.dt-root`, `.dt-root:not([data-dt-theme="light"]):not([data-dt-theme="dark"])`,
`.dt-root[data-dt-theme="light"]`, `.dt-root[data-dt-theme="dark"]`) so importing
it after `styles.css` is enough. A test parses `styles.css` and both presets
and fails if a `--dt-*` token used by the base sheet is missing from a preset.

## Public API changes

- `useDataTable`: options above; returns additionally `query`, `pagination`
  (`{ enabled, pageIndex, pageSize, pageSizeOptions, pageCount, rowCount, setPageIndex, setPageSize }`),
  `rowHeight`, `getRowHeight`.
- `<DataTable>`: `loading?`, `error?`, `onRetry?`, `virtualize?` (default true),
  `footer?` (default true).
- `TableLayout`: optional `pageSize`.
- New exports: `TableQuery`, `useRowVirtualizer`, `TablePagination`
  (the footer, for custom shells), `SkeletonRows`, `buildDisplayList` /
  `spacerSizes` (pure helpers).
- `package.json`: `peerDependencies["@tanstack/react-virtual"] = "^3.14.0"`,
  `exports["./themes/shadcn.css"]`, `exports["./themes/shadcn-hsl.css"]`,
  version 0.4.0.
- Labels added: `rows`, `rowsPerPage`, `range(from, to, total)`,
  `page(page, count)`, `firstPage`, `previousPage`, `nextPage`, `lastPage`,
  `loading`, `loadFailed`, `retry`.

## File layout

```
src/
  useDataTable.ts            options, composition; grows only by delegation
  core/
    useArrangement.ts        layout state + persistence (extracted from useDataTable)
    query.ts                 TableQuery, buildQuery, queriesEqual
    usePagination.ts         pageIndex state, resets, clamping, pageCount
    useRowVirtualizer.ts     react-virtual wrapper
    virtualRows.ts           buildDisplayList, spacerSizes (pure)
  components/
    DataTable.tsx            shell; delegates body and footer
    TableBody.tsx            spacers + BodyRow list (+ skeleton)
    TablePagination.tsx      footer
    TableStatus.tsx          progress bar, error banner
  themes/
    shadcn.css
    shadcn-hsl.css
```

`useDataTable.ts` is already 330 lines; extracting the arrangement state and
pagination keeps every file under the repository's size guideline.

## Testing

- `core/query.test.ts` — shape, memo identity, equality.
- `core/virtualRows.test.ts` — display list with expanded detail rows and
  tree rows; spacer sizes at the top, middle and end of a list.
- `useDataTable` (server mode) — manual flags set; `onQueryChange` called on
  mount and on sort/page changes; sort change resets `pageIndex`; new `data`
  array does not; `rowCount` shrink clamps the page; `pageSize` persisted
  and restored; `getRowId` respected.
- `TablePagination.test.tsx` — texts, disabled states, select and input.
- `Virtualization.test.tsx` — with a ResizeObserver stub and a 300px
  viewport injected via the virtualiser's `observeElementRect` option:
  1 000 rows render ~8 + overscan `<tr>`s, spacer heights sum to
  `totalSize`, scrolling moves the window, an expanded detail row is
  measured, `virtualize={false}` renders all rows.
- `DataTable` states — skeleton on first load, progress bar on refetch,
  error banner with Retry.
- `themes.test.ts` — every `--dt-*` token in `styles.css` is defined in both presets.
- Browser: 100 000-row client table (scroll to bottom/top, jump, open
  detail), server demo with simulated latency (page/size changes, sort
  resets page, stale rows dimmed during fetch, error + retry), shadcn preset
  on the demo page with a `.dark` toggle.

## Demo

Two new sections on the demo page: **Server-side** (an in-memory "API" of
10 000 receipts with 300 ms latency and a failure toggle) and **100 000
rows** (client mode, virtualised, no pagination). A theme switch loads the
shadcn preset with a minimal set of shadcn variables to show the mapping.

## Risks

- Spacer-row layout cost on very wide tables: each scroll frame changes two
  heights; with `table-layout: fixed` this is a single cheap layout. Measure
  in the browser with 30 columns × 100 000 rows before release.
- Firefox measures `<tr>` heights including borders inconsistently; only
  detail rows are measured, drift is ≤1px per open panel.
- Hosts that forget `getRowId` in server mode get index-keyed rows; expansion
  state then belongs to positions, not records. The README says so, and the
  hook warns once in development when `mode: "server"` has no `getRowId`.
