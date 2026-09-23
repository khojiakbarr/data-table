import {
  columnFacetingFeature,
  columnFilteringFeature,
  columnOrderingFeature,
  createExpandedRowModel,
  rowExpandingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createCoreRowModel,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnMeta,
  type ColumnSizingState,
  type PaginationState,
  type Row,
  type RowData,
  type Updater,
} from "@tanstack/react-table"
import { useCallback, useMemo, useRef, useState } from "react"
import { declaredLeafIds, deriveColumnId, leafIdsOf } from "./core/columnIds"
import { dropRegionOf } from "./core/dropRegion"
import {
  ROW_NUMBER_COLUMN_ID,
  rowNumberColumnDef,
  rowNumberColumnWidth,
} from "./core/rowNumbers"
import {
  SELECTION_COLUMN_ID,
  headerScopeOf,
  isSelectionEnabled,
  selectionColumnDef,
} from "./core/selection"
import { useSelection, type SelectionChange } from "./core/useSelection"
import { filterFn_dt } from "./core/filterFn"
import { collectFilterKinds } from "./core/filterKinds"
import {
  pruneFilters,
  type FilterCondition,
  type FilterKind,
  type FilterModel,
  type FilterValue,
  type FilterValueOption,
} from "./core/filters"
import {
  groupColumnMinWidth,
  groupRowId,
  isGroupRow,
  isPathExpanded,
  pruneGrouping,
  togglePath,
  type GroupRow,
} from "./core/grouping"
import { noLayoutStorage } from "./core/persistence"
import type { TableQuery, TableSearch } from "./core/query"
import { leadColumn, moveRun, pinnedFirstOrder, type DropSide } from "./core/reorder"
import { collectSearchFields, filterFn_dtSearch, pruneSearchFields } from "./core/search"
import { clampColumnWidth, type ColumnBounds, type SizedColumn } from "./core/sizing"
import { clampTableHeight, minTableHeight, tableHeightStep } from "./core/tableHeight"
import { apply, layoutSliceEqual, sliceChange, useArrangement } from "./core/useArrangement"
import { useDebouncedValue } from "./core/useDebouncedValue"
import { useIsomorphicLayoutEffect } from "./core/useIsomorphicLayoutEffect"
import { usePagination, type PaginationApi } from "./core/usePagination"
import { useTableQuery } from "./core/useTableQuery"
import { warnOnce } from "./core/warnOnce"
import type {
  DataTableColumnMeta,
  DataTableFeatureFlags,
  LayoutStorage,
  TableLayout,
} from "./types"

/**
 * The feature set this library composes.
 *
 * `columnSizingFeature` is not optional even when resizing is turned off: it is
 * what backs `column.getStart()` / `getAfter()`, which every pinned column needs
 * to compute its sticky offset. Pinning without it produces columns that overlap
 * as soon as any width differs from the default.
 */
const FEATURES = tableFeatures({
  columnOrderingFeature,
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  /*
   * `globalFilteringFeature` REQUIRES `columnFilteringFeature` — the compiler
   * says so through `FeatureSlotPrereqs` — so quick search cannot ship alone.
   * The faceting slots are composed here too, though nothing reads them until
   * the values editors land: the feature set is composed once, so
   * `DataTableFeatures` widens once rather than twice.
   */
  columnFilteringFeature,
  globalFilteringFeature,
  columnFacetingFeature,
  coreRowModel: createCoreRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  sortFns,
  /*
   * One registered function, not the deprecated bulk `filterFns` export, which
   * puts every built-in in the bundle. Registering a name also narrows the
   * legal `columnDef.filterFn` strings to the keys here, which is why
   * `defaultColumn` below has to state `filterFn: "dt"`.
   */
  filterFns: { dt: filterFn_dt },
  /*
   * Claims TanStack's per-table `columnMeta` slot, which is what makes
   * `meta: { filter: "number" }` type-checked with no generic reaching the
   * host. The slot REPLACES the global `ColumnMeta` interface rather than
   * extending it, so declaring `DataTableColumnMeta` alone would silently
   * delete the fields of any host who declaration-merges `ColumnMeta` today —
   * their own `meta` key would become an excess-property error. The
   * intersection keeps that merge working.
   *
   * The `any` arguments are deliberate and unavoidable: the slot sits inside
   * the call whose `typeof` *is* `DataTableFeatures`, so naming that type here
   * would be circular.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columnMeta: {} as DataTableColumnMeta & ColumnMeta<any, any, any>,
})

export type DataTableFeatures = typeof FEATURES

/**
 * The "not grouped" values, at module scope.
 *
 * `useTableQuery` keeps its query object only while every input holds its
 * identity, so a fresh `[]` per render for a table that groups nothing would
 * make the query new on every render and a host keyed on it refetch forever.
 */
const NO_GROUPING: string[] = []
const NO_EXPANDED: FilterValue[][] = []
/** The top level: what a row sits inside when it sits inside nothing. */
const NO_PATH: FilterValue[] = []

/** Rows per page before the user has chosen one. */
const DEFAULT_PAGE_SIZE = 50
/** Page sizes offered in the footer before the caller narrows them. */
const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [20, 50, 100, 200]

/** How rows are paged; see {@link UseDataTableOptions.pagination}. */
export interface PaginationOptions {
  /** Rows per page on first visit; the user's later choice is persisted. Default 50. */
  pageSize?: number
  /** Choices offered in the footer. Default [20, 50, 100, 200]. */
  pageSizeOptions?: readonly number[]
}

/** Where rows are sorted and paged. */
export type TableMode = "client" | "server"

/** How rows are filtered; see {@link UseDataTableOptions.filtering}. */
export interface FilteringOptions {
  /** ms before quick search is published. Default 300. Column filters are never debounced. */
  debounceMs?: number
  /** Keep active filters in the saved layout. Default true. */
  persist?: boolean
  /**
   * Columns quick search covers, by leaf column id. Default: every visible
   * searchable column.
   *
   * Overrides inference and the hidden-column narrowing, but not what the
   * client can actually match: an id naming no column, a display column, or a
   * column with `enableGlobalFilter: false` is dropped — with a dev-mode
   * warning naming it — so the wire never asks a backend to search a column
   * this table searches none of. A nested `accessorKey` like `"partner.name"`
   * has live id `"partner_name"`, which is the id to name here.
   */
  searchFields?: string[]
  /**
   * Server-mode source of a values filter's choices. Never called in client mode.
   *
   * Written `| undefined` like the hook's other forwarded callbacks, because
   * `exactOptionalPropertyTypes` otherwise rejects passing one through.
   */
  loadValues?:
    | ((columnId: string, options: { search: string; signal: AbortSignal }) => Promise<FilterValueOption[]>)
    | undefined
}

/** How long quick search waits before it is published. */
const DEFAULT_SEARCH_DEBOUNCE_MS = 300

export interface UseDataTableOptions<TData extends RowData> {
  /**
   * Stable identity for this table.
   *
   * Required, and it must be unique within the application: it is the key the
   * layout is stored under. Two tables sharing an ID overwrite each other's
   * columns the moment either is rearranged — which is exactly the bug this
   * option exists to prevent.
   */
  id: string
  /**
   * The rows to render.
   *
   * In server mode this is one page, already filtered, sorted and paged by the
   * host. A GROUPED page is flattened — group headers and records interleaved
   * in the order the user would see them — which is why {@link GroupRow} is in
   * the element type: the table recognises a group row by its `kind` and never
   * hands one to a host callback (`getRowId`, `getRowHeight`, `getSubRows`,
   * `canExpand`, a cell renderer or `renderDetail`), so an accessor written
   * against the host's own row is never asked to read one.
   */
  data: (TData | GroupRow)[]
  /**
   * Column definitions.
   *
   * `any` for the cell value mirrors TanStack's own `columns` signature: each
   * column carries its own value type, and a single concrete type here would
   * reject every heterogeneous column array.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<DataTableFeatures, TData, any>[]
  /**
   * Where layouts are kept. Defaults to not persisting at all; pass
   * `localStorageLayout()` for per-browser memory, or your own adapter to store
   * layouts on a server.
   */
  storage?: LayoutStorage
  /** Layout applied the first time a user opens this table. */
  initialLayout?: Partial<TableLayout>
  /** Turn individual interactions off. Everything is enabled by default. */
  features?: DataTableFeatureFlags
  /** Width applied to a column that does not declare one. */
  defaultColumnWidth?: number
  minColumnWidth?: number
  maxColumnWidth?: number
  /**
   * Writing direction of the page the table is rendered in.
   *
   * The resize handle sits on a column's trailing edge, which in a
   * right-to-left layout is its left edge; the drag arithmetic has to know
   * which way "wider" is.
   */
  direction?: "ltr" | "rtl"
  /**
   * Child rows of a row, for tree data.
   *
   * Returning children makes a row expandable and indents its descendants.
   * Nesting is unlimited; each level is expanded on its own.
   */
  getSubRows?: (row: TData) => TData[] | undefined
  /**
   * Whether a row can open a detail panel.
   *
   * Only consulted when `<DataTable renderDetail>` is supplied. Defaults to
   * every row being expandable.
   */
  canExpand?: (row: TData) => boolean
  /**
   * Where rows are sorted and paged.
   *
   * `"client"` (default): the table sorts and pages `data` itself.
   * `"server"`: `data` is one page already sorted; the table only describes
   * what it wants through `onQueryChange` / `query`.
   */
  mode?: TableMode
  /**
   * Total rows across all pages. Server mode only; undefined until known.
   *
   * It is also how `<DataTable>` knows a page has been counted: with no rows,
   * no error and nothing loading, a `rowCount` of 0 is what makes the empty
   * state honest rather than a guess about a query nobody has answered.
   *
   * Explicitly `| undefined` under `exactOptionalPropertyTypes`: the natural
   * call site is `rowCount: data?.total`, itself `number | undefined` before
   * the response arrives, and an optional property alone would reject that.
   */
  rowCount?: number | undefined
  /**
   * How many RECORDS the query matches, when that differs from `rowCount`.
   *
   * It differs in exactly one case: a grouped table, where `rowCount` is the
   * length of the flattened list and therefore counts group headers as well as
   * leaves. Only the selection count reads this; paging deliberately does not,
   * because the pager measures the list it actually shows.
   *
   * Leave it out and a grouped table simply says "select all rows" without a
   * number, which is true. Do NOT put a leaf count in `rowCount` instead:
   * `rowCount` is what `pageCount` is derived from, so a smaller number there
   * takes pages away from the user.
   */
  selectableRowCount?: number | undefined
  /**
   * Rows before the active filter and the quick search narrowed them, for the
   * status bar's "X of Y" — see `DataTableFeatureFlags.statusBar`.
   *
   * **Server mode only, and undefined is the graceful case, not a hole.** A
   * server-side filter means the client never sees the wider set, so it has
   * to be told; a backend that has not implemented this field yet leaves the
   * status bar stating only how many rows matched, which is the honest
   * reading of "unknown" rather than a state the bar has to guard against.
   *
   * Ignored in client mode: `data` there already IS the whole set the table
   * filters, so `instance.pagination.unfilteredTotal` is `data.length` on its
   * own — nothing a host could pass here would tell the table something it
   * does not already know.
   *
   * Explicitly `| undefined` under `exactOptionalPropertyTypes`, for the same
   * reason {@link UseDataTableOptions.rowCount} is: the natural call site is
   * `unfilteredTotal: data?.unfilteredTotal`, itself optional before the
   * response arrives.
   */
  unfilteredTotal?: number | undefined
  /**
   * Page the rows. Off by default in client mode, on in server mode. Pass
   * `true` for the defaults or an object to set the page size and choices.
   */
  pagination?: boolean | PaginationOptions
  /**
   * Filtering: quick search and per-column filters. On by default. Pass
   * `false` to turn it off, or an object to configure it.
   */
  filtering?: boolean | FilteringOptions
  /**
   * Stable identity for a row.
   *
   * In server mode rows come and go between pages; without an id, expansion
   * state belongs to positions instead of records.
   *
   * Never called for a group row: a group is not one of the host's records and
   * carries none of its fields, so its id is its key path, joined — see
   * {@link groupRowId}.
   */
  getRowId?: (row: TData, index: number, parent?: Row<DataTableFeatures, TData>) => string
  /**
   * The open group the FIRST row of `data` sits inside, from the answer to
   * `query`. Omit it, or pass `[]`, when that row is at the top level.
   *
   * It exists for one case, and only a real implementation turns it up: with a
   * group open and a page boundary falling inside it, the page comes back as
   * leaf rows and no group header at all, and nothing else on the wire says
   * which group they belong to — a leaf carries no path. The user would see
   * rows under nothing. Given this, the table draws a "continued" header above
   * them.
   *
   * A path on every leaf would answer the same question and cost an array per
   * row; only the first row of a page can ask it, because every later row's
   * context is re-established by the group header above it.
   */
  startPath?: FilterValue[] | undefined
  /**
   * Called with the initial query on mount and after every change to it.
   *
   * Explicitly `| undefined` under `exactOptionalPropertyTypes`: a host
   * usually forwards its own optional handler at the call site
   * (`onQueryChange={props.onQueryChange}`), and an optional property alone
   * would reject that.
   */
  onQueryChange?: ((query: TableQuery) => void) | undefined
  /**
   * Called whenever the row selection changes — including when the table
   * clears it because the query moved under it.
   *
   * It carries the model, the {@link TableQuery} the selection is relative to,
   * and how many rows that is. The query is not optional: `all-matching` names
   * no row on its own, and a host handed it without the filters it was drawn
   * against has nothing to turn into a `WHERE` clause. See the README's
   * Row selection section for that translation.
   *
   * Not called on mount — nothing is selected there, and `onQueryChange` has
   * already announced the query.
   *
   * Explicitly `| undefined` under `exactOptionalPropertyTypes`, like the
   * hook's other forwarded callbacks.
   */
  onSelectionChange?: ((selection: SelectionChange) => void) | undefined
  /** Pixel height of a data row. Default 40; also sets `--dt-row-height`. */
  rowHeight?: number
  /**
   * Height for particular rows, known ahead of render.
   *
   * A pure function of its row. The identity may change freely — an inline
   * arrow is fine, and costs nothing — but what it answers for a given row
   * must not depend on anything the table cannot see. A policy that starts
   * answering differently (a density toggle, say) is noticed by asking it
   * again: for every row on screen, and for a bounded sample spread across
   * the rest. See {@link UseDataTableOptions.heightVersion} for the one
   * change that sample can miss.
   *
   * Explicitly `| undefined` under `exactOptionalPropertyTypes`: whether rows
   * vary in height is usually a condition at the call site
   * (`getRowHeight={varies ? measure : undefined}`), and an optional
   * property alone would reject that.
   */
  getRowHeight?: ((row: TData) => number) | undefined
  /**
   * Any value that changes when `getRowHeight` starts answering differently.
   *
   * Only needed for a change the table cannot see coming: one that leaves
   * every rendered row's height alone and moves too few off-screen rows for
   * the sample to land on. The scrollbar is what goes stale, until the
   * changed rows are scrolled to. A new value here re-estimates every row at
   * once instead.
   *
   * ```tsx
   * useDataTable({ id: "receipts", data, columns, getRowHeight, heightVersion: density })
   * ```
   */
  heightVersion?: string | number | undefined
}

/**
 * Build a table with column pinning, resizing, reordering, sorting and
 * visibility, and remember how the user arranged it.
 *
 * Each call creates an independent table. Two tables on one page share no
 * state, provided they are given different `id`s.
 *
 * @param options - See {@link UseDataTableOptions}; `id` is required.
 * @returns The TanStack table instance plus this library's additions.
 *
 * @example
 * const receipts = useDataTable({
 *   id: "receipts",
 *   data,
 *   columns,
 *   storage: localStorageLayout(),
 * })
 * return <DataTable instance={receipts} />
 */
export function useDataTable<TData extends RowData>({
  id,
  data,
  columns,
  storage,
  initialLayout,
  features,
  defaultColumnWidth = 160,
  minColumnWidth = 60,
  maxColumnWidth = 800,
  direction = "ltr",
  getSubRows,
  canExpand,
  mode = "client",
  rowCount,
  selectableRowCount,
  unfilteredTotal,
  pagination,
  filtering,
  getRowId,
  startPath,
  onQueryChange,
  onSelectionChange,
  rowHeight = 40,
  getRowHeight,
  heightVersion,
}: UseDataTableOptions<TData>) {
  const flags: Required<DataTableFeatureFlags> = useMemo(
    () => ({
      sorting: features?.sorting ?? true,
      resizing: features?.resizing ?? true,
      reordering: features?.reordering ?? true,
      pinning: features?.pinning ?? true,
      hiding: features?.hiding ?? true,
      heightGrip: features?.heightGrip ?? true,
      /*
       * False, unlike every flag above it. The others turn OFF something the
       * table has always done, so `true` is what a host already had; this one
       * adds a column, and a table that grew one on a minor upgrade would be
       * a breaking change dressed as a small one. See the flag's own JSDoc.
       */
      rowNumbers: features?.rowNumbers ?? false,
      // False for the same reason `rowNumbers` is, and with one more of its
      // own: a table that started selecting rows on a minor upgrade would put
      // a bulk action in front of users the host never meant to offer one to.
      selection: features?.selection ?? false,
      // False for the same reason `rowNumbers` is — see that flag's JSDoc and
      // `DataTableFeatureFlags.statusBar`'s own. `??` only steps in for a
      // missing (`undefined`/`null`) flag; a host's own `true`, `false` or a
      // `ReactNode` passes through exactly as given.
      statusBar: features?.statusBar ?? false,
      // True, unlike `rowNumbers` and `selection`: this flag turns an
      // existing behaviour OFF rather than adding new furniture, so `true` is
      // what every server host already had. See the flag's own JSDoc.
      grouping: features?.grouping ?? true,
    }),
    [features],
  )

  /*
   * The two halves of `features.selection`, which is a flag OR a flag with
   * options: whether rows are selectable at all, and what the header checkbox
   * reaches. Read once here so nothing downstream has to know the flag has two
   * shapes — and note that `headerScopeOf`'s "scope" is the reach of that one
   * control, not the query scope a selection is cleared by (`selectionScopeOf`).
   */
  const selectionEnabled = isSelectionEnabled(flags.selection)
  const headerSelectionScope = headerScopeOf(flags.selection)

  const store = useMemo(() => storage ?? noLayoutStorage(), [storage])

  const columnIds = useMemo(() => leafIdsOf(columns), [columns])

  /*
   * The same ids, plus the row-number column's, for the STORED layout alone.
   *
   * `pruneLayout` drops every reference to a column the table does not
   * define, which is what keeps a stale layout from resurrecting a column
   * that has been removed — and without this it would also drop the width the
   * user dragged the row-number column to, on the very next load. The column
   * really is one the table defines while the flag is on, so saying so here
   * is honest rather than a loophole.
   *
   * It is `columnIds` and NOT this that everything else reads — the filter
   * prune, the grouping prune, the natural-order fallback — because those
   * answer questions about the HOST's columns, and the row-number column is
   * not one: nothing may filter it, group by it, or move it.
   */
  const layoutColumnIds = useMemo(
    () => (flags.rowNumbers ? [ROW_NUMBER_COLUMN_ID, ...columnIds] : columnIds),
    [flags.rowNumbers, columnIds],
  )

  const bounds: ColumnBounds = useMemo(
    () => ({ min: minColumnWidth, max: maxColumnWidth }),
    [minColumnWidth, maxColumnWidth],
  )

  const isServer = mode === "server"
  /*
   * Paging is opt-in on the client — a short table with a footer nobody needs
   * is worse than no footer — but implied by server mode, where a page is the
   * only thing a server can sensibly return.
   */
  const paginationOptions: PaginationOptions | null =
    pagination === false || (pagination === undefined && !isServer)
      ? null
      : pagination === true || pagination === undefined
        ? {}
        : pagination

  const filteringOptions: FilteringOptions | null =
    filtering === false ? null : filtering === true || filtering === undefined ? {} : filtering
  // A boolean rather than the object above, which is a fresh `{}` on every
  // render for the two shorthand forms and would break the memo below.
  const filteringEnabled = filteringOptions !== null

  /*
   * Grouping is SERVER-SIDE and there is no client-mode fallback in this
   * version, so the feature exists only in server mode.
   *
   * The reason is not an omission. A client table holds one page — fifty rows
   * out of a hundred thousand — and grouping those fifty would present a
   * partial answer as if it were the whole table: counts that are wrong, and
   * wrong in a way the user cannot see. Refusing is the honest behaviour; the
   * grouping travels on the query instead and the host answers it.
   *
   * `flags.grouping` is the other half: a server host whose backend has no
   * group-by support at all (client mode is already refused above) turns it
   * off so the table stops claiming a grouping the rows do not have. Every
   * downstream consumer — the Row groups zone, the per-column toggle, the
   * status bar, `query.grouping`/`query.expanded`, `instance.grouping` — reads
   * this ONE boolean rather than `isServer`/`mode` directly, so there is a
   * single switch and not a second one hiding somewhere else.
   */
  const groupingEnabled = isServer && flags.grouping

  /*
   * Resolved from the column definitions and the data rather than from the
   * table, which does not exist yet: a stored layout is pruned on the very
   * first render, and pruning is where a condition whose kind no longer
   * matches its column has to be dropped.
   */
  /*
   * `data` with the group headers taken out, for everything that SAMPLES a row
   * to infer something about a column — the filter kinds below, and quick
   * search's field list further down.
   *
   * A group header has none of the host's fields, so sampling one reads every
   * column as blank: a nullable column whose page happens to start with a
   * group row would infer no filter kind and drop out of quick search, and
   * would do it differently on every page. Identity is preserved when there is
   * nothing to take out, so an ungrouped table's memos are untouched.
   */
  const sampleRows = useMemo(
    () => (data.some(isGroupRow) ? (data.filter((row) => !isGroupRow(row)) as TData[]) : (data as TData[])),
    [data],
  )

  const filterKinds = useMemo<ReadonlyMap<string, FilterKind | false>>(
    () => collectFilterKinds(columns, sampleRows),
    [columns, sampleRows],
  )

  const {
    layout,
    isCustomised,
    updateSlice,
    updateSlices,
    resetLayout: resetArrangement,
  } = useArrangement({
    id,
    store,
    initialLayout,
    // The stored layout may name the row-number column's width; see
    // `layoutColumnIds`.
    columnIds: layoutColumnIds,
    filterKinds,
    /*
     * Both, and not `persist` alone: `filteringOptions?.persist ?? true` reads
     * `true` for `filtering: false` — `null?.persist` is `undefined` — so the
     * two are combined where they are read, and `filtering: false` implies
     * `persist: false` there rather than here.
     */
    filteringEnabled,
    persistFilters: filteringOptions?.persist ?? true,
  })

  /*
   * The row count as of the last commit, written below once the table exists.
   *
   * The table has to be built before a client-mode count exists, and
   * `usePagination` runs before that, so the count this render can hand it is
   * the one the previous render measured. That is enough to derive a page
   * count from — the shrink case it misses is corrected before paint — but not
   * to clamp a click against, because by then the table may have been rebuilt
   * over more rows. Setters read this ref instead, which is current whenever
   * one of them runs.
   */
  const rowCountRef = useRef<number | undefined>(undefined)
  const getRowCount = useCallback(() => rowCountRef.current, [])

  // Stable, so the memoised `pageState` below really is stable.
  const persistPageSize = useCallback(
    (size: number) => updateSlice("pageSize", size),
    [updateSlice],
  )

  const pageState = usePagination({
    enabled: paginationOptions !== null,
    pageSize: layout.pageSize ?? paginationOptions?.pageSize ?? DEFAULT_PAGE_SIZE,
    pageSizeOptions: paginationOptions?.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS,
    rowCount: isServer ? rowCount : rowCountRef.current,
    getRowCount,
    onPageSizeChange: persistPageSize,
  })

  /*
   * A new sort order makes the current page meaningless — page four of the old
   * order holds different records under the new one — so sorting sends the
   * user back to the first page. A data change deliberately does not: in server
   * mode every fetch is a fresh array, and resetting there would make paging
   * forward impossible.
   */
  const { resetPage } = pageState
  const updateSorting = useCallback(
    (updater: Updater<TableLayout["sorting"]>) => {
      updateSlice("sorting", updater)
      resetPage()
    },
    [updateSlice, resetPage],
  )

  /*
   * For the same reason, and one more: a reset replaces the sort order *and*
   * the page size, two of the three inputs to the query, so the page number
   * the user is on describes a result set that no longer exists. The page is
   * reset here rather than in `useArrangement`, which does not own it.
   */
  const resetLayout = useCallback(() => {
    resetArrangement()
    resetPage()
  }, [resetArrangement, resetPage])

  /*
   * The table's own height, as the grip (or a host control) last left it.
   *
   * It is a layout slice like a column width: it persists, it makes the table
   * "customised", and `resetLayout` drops it — which is what puts the `height`
   * prop back in charge, since `undefined` here means "nobody has overridden
   * it". Clamped on the way in, so a stored or typed value below the minimum
   * cannot render a table with no rows in it.
   */
  const setTableHeight = useCallback(
    (pixels: number) => updateSlice("height", clampTableHeight(pixels, rowHeight)),
    [updateSlice, rowHeight],
  )
  const tableHeight = useMemo(
    () => ({
      /** Whether the grip is offered at all. */
      enabled: flags.heightGrip,
      /** The override in pixels, or undefined while the `height` prop rules. */
      value: layout.height === undefined ? undefined : clampTableHeight(layout.height, rowHeight),
      /** The shortest the table may be: chrome plus a row or two. */
      min: minTableHeight(rowHeight),
      /** One arrow press, in pixels; Shift holds the coarse step. */
      step: tableHeightStep(rowHeight, false),
      coarseStep: tableHeightStep(rowHeight, true),
      set: setTableHeight,
    }),
    [flags.heightGrip, layout.height, rowHeight, setTableHeight],
  )

  /*
   * Filters and search change the result set exactly as sorting does, so both
   * go back to the first page. Every public mutator goes through one of these
   * two, so there is no path that changes the result set without resetting the
   * page — TanStack's own post-filter reset is unavailable here because
   * `autoResetPageIndex: false` is set for good server-mode reasons, and on
   * page 40 of 100 typing three characters would otherwise land the user on
   * page 3 of 3 of the results.
   *
   * Being the one path every mutator takes also makes them the whole mutation
   * boundary for `filtering: false`, and gating them is what makes that option
   * mean "off" rather than "the surfaces are hidden but the state still
   * ships": without it a table a host had disabled went on publishing whatever
   * was already in `query.filters`, with nothing left on screen able to clear
   * it. The load half — `initialLayout` and storage — is `useArrangement`'s.
   */
  const updateFilters = useCallback(
    (updater: Updater<TableLayout["filters"]>) => {
      if (!filteringEnabled) return
      updateSlice("filters", updater)
      resetPage()
    },
    [filteringEnabled, updateSlice, resetPage],
  )
  const updateSearch = useCallback(
    (text: string) => {
      if (!filteringEnabled) return
      /*
       * Coerced once here rather than at each caller: `setSearch` is this
       * function verbatim and `setModel` takes the same untrusted input, while
       * `filtering.isFiltered` calls `.trim()` on whatever lands in the slice —
       * so a number from a JS host used to take the table down on every
       * subsequent render.
       */
      updateSlice("search", typeof text === "string" ? text : "")
      resetPage()
    },
    [filteringEnabled, updateSlice, resetPage],
  )

  /*
   * The grouping actually in force, and which of its branches are open.
   *
   * Read through the gate rather than straight off the layout: a client-mode
   * table with a grouping in `initialLayout` (or in a layout saved while the
   * same table was in server mode) must not publish one, since nothing would
   * answer it. Module-level constants keep the identity stable, which is what
   * `useTableQuery` needs from every one of its inputs.
   */
  const grouping = groupingEnabled ? layout.grouping : NO_GROUPING
  const expandedGroups = groupingEnabled ? layout.expanded : NO_EXPANDED

  /*
   * Grouping changes the row count — a grouped list is groups plus whatever
   * is open inside them — so the page the user is on describes a result set
   * that no longer exists, exactly as it does after a sort or a filter.
   *
   * A change to WHICH columns group the rows resets the page unconditionally,
   * because it also clears every open path below: every level of the
   * grouping is being replaced, so nothing about the previous flattened
   * list — its length or what was open in it — still applies. `toggleGroup`
   * below opens or closes ONE existing group without touching the others, and
   * resets the page on a narrower condition; see the comment there.
   *
   * A grouping change also clears the open paths. A path's keys are
   * positional — index 0 is the outermost level — so adding or removing a
   * level silently re-reads every saved key as belonging to a different one:
   * `["received", "Acme"]` under `["status", "partner"]` would come back
   * meaning "the status group Acme" the moment `status` went away. Reopening
   * nothing is honest; reopening the wrong branches is not.
   */
  const updateGrouping = useCallback(
    (updater: Updater<TableLayout["grouping"]>) => {
      if (!groupingEnabled) {
        if (process.env.NODE_ENV !== "production") {
          /*
           * Two different reasons end up here, and they need different advice.
           * A client table is told to switch to server mode; a server table
           * that turned the flag off must NOT be told that — it is already in
           * server mode, the host switched grouping off on purpose, and the
           * advice would send them looking for a fix that changes nothing.
           */
          warnOnce(
            isServer
              ? `useDataTable("${id}"): grouping was ignored because features.grouping is false. ` +
                  `The flag is for a backend that cannot group, so the table never sends a grouping ` +
                  `it would answer with plain rows. Remove the flag if your backend answers query.grouping.`
              : `useDataTable("${id}"): grouping is server-side and was ignored in client mode. ` +
                  `Grouping one page of rows would report counts for the page rather than for the table. ` +
                  `Pass mode: "server" and answer query.grouping.`,
          )
        }
        return
      }
      updateSlices([
        sliceChange("grouping", (current) => pruneGrouping(apply(updater, current), columnIds)),
        sliceChange("expanded", () => []),
      ])
      resetPage()
    },
    [groupingEnabled, isServer, id, updateSlices, columnIds, resetPage],
  )

  /**
   * Open or close one group, without disturbing the others.
   *
   * Only a COLLAPSE resets the page: it can only shorten the flattened list,
   * and an un-reset page can point past its new end. An EXPAND can only
   * lengthen the list, so it never needs a reset — resetting on expand was
   * the bug this fixes: it sent a page-2 user back to page 1 for opening a
   * group they could already see, discarding the very page they clicked from.
   *
   * The collapse-side reset is belt-and-braces rather than load-bearing:
   * `usePagination` already clamps `pageIndex` to `pageCount - 1` during
   * render (see usePagination.ts), so an un-reset page cannot actually end up
   * past the end. It is kept anyway so a host watching `resetPage`'s effects
   * (`onQueryChange`, for one) sees the page settle on the same tick as the
   * collapse rather than one render later, behind a clamp this function does
   * not control.
   */
  const toggleGroup = useCallback(
    (path: readonly FilterValue[]) => {
      if (!groupingEnabled || path.length === 0) return
      const wasOpen = isPathExpanded(layout.expanded, path)
      updateSlice("expanded", (current) => togglePath(current, path))
      if (wasOpen) resetPage()
    },
    [groupingEnabled, layout.expanded, updateSlice, resetPage],
  )

  const collapseAllGroups = useCallback(() => {
    if (!groupingEnabled) return
    updateSlice("expanded", [])
    resetPage()
  }, [groupingEnabled, updateSlice, resetPage])

  /**
   * Which grouped column holds the group values.
   *
   * A grouped column leaves the body and one group column takes its place, so
   * exactly one of them has to keep its slot. The outermost level gets it,
   * because that is the column the user grouped by first and the one whose
   * header still means something to sort by — and because "takes its place"
   * is only true of a column that has a place.
   *
   * A grouped column the user has hidden is skipped: hiding is a view
   * concern and must not stop the column grouping, but it should not drag a
   * hidden column back on screen either. When every grouped column is hidden
   * the outermost is forced visible regardless, since the group values need
   * somewhere to render.
   */
  const groupColumnId = useMemo(() => {
    if (grouping.length === 0) return undefined
    return grouping.find((columnId) => layout.columnVisibility[columnId] !== false) ?? grouping[0]
  }, [grouping, layout.columnVisibility])

  /*
   * Visibility as the table renders it: the user's own choices, with every
   * grouped column but the group slot hidden.
   *
   * Derived here rather than written into the layout slice, which is what
   * makes "removing the last chip puts every column back exactly where it
   * was" true by construction: the user's `columnVisibility` is never touched,
   * so nothing has to be restored. `onColumnVisibilityChange` applies its
   * updater to the LAYOUT slice (see `updateSlice`), not to this object, so a
   * tick in the Columns panel still writes what the user meant.
   */
  const columnVisibility = useMemo(() => {
    if (grouping.length === 0) return layout.columnVisibility
    const derived = { ...layout.columnVisibility }
    for (const columnId of grouping) derived[columnId] = columnId === groupColumnId
    return derived
  }, [grouping, groupColumnId, layout.columnVisibility])

  /*
   * The definitions the table is built from: the host's own, with the group
   * column hoisted out of its column group while there is one. See
   * {@link hoistGroupColumn} — a derived order can move a leaf but cannot
   * change whose header stands above it, and a leaf that leads the table from
   * inside a group splits that group's header in two.
   */
  /*
   * How wide the row-number column is declared, from the number it will have
   * to print in the last row.
   *
   * The COUNT is not the dependency — the width is. A count changes whenever
   * a filter narrows the result; the width changes only when the count gains
   * or loses a digit, and rebuilding every column definition (which is what a
   * new `tableColumns` array makes TanStack do) on every count change would
   * be a rebuild per keystroke of a search.
   *
   * In server mode the count is `rowCount` and the table never sees the other
   * pages; in client mode `data` IS the whole result, so its length is the
   * same quantity read where the client keeps it.
   */
  const rowNumberWidth = flags.rowNumbers
    ? rowNumberColumnWidth(isServer ? rowCount : data.length)
    : 0
  const rowNumberDef = useMemo(
    () => (flags.rowNumbers ? rowNumberColumnDef<TData>(rowNumberWidth) : null),
    [flags.rowNumbers, rowNumberWidth],
  )

  /*
   * The selection column, which takes no width argument: a checkbox is the
   * widest thing in it and does not grow with the row count.
   */
  const selectionDef = useMemo(
    () => (selectionEnabled ? selectionColumnDef<TData>() : null),
    [selectionEnabled],
  )

  /*
   * The chrome columns lead EVERYTHING, the group column included, which is
   * why they are prepended after the hoist rather than inside it: the hoist
   * decides where the host's own columns stand, and these stand before all of
   * them.
   *
   * Selection first, then row numbers — the order the spec asks for. This
   * array is where the two are named in that order, but it is NOT where the
   * order is enforced: both columns are pinned to the start, and TanStack
   * renders that section from `columnPinning.start` rather than from the
   * definitions or the flat order. `columnPinning` below is where "selection,
   * then row numbers, then the group column" actually happens, and the two
   * spellings are kept in step by hand because there is no third place that
   * could derive one from the other.
   */
  const tableColumns = useMemo(() => {
    const declared = groupColumnId === undefined ? columns : hoistGroupColumn(columns, groupColumnId)
    const chrome = [selectionDef, rowNumberDef].filter((def) => def !== null)
    return chrome.length === 0 ? declared : [...chrome, ...declared]
  }, [columns, groupColumnId, rowNumberDef, selectionDef])

  /*
   * Order as the table renders it: the user's own, with the group column
   * lifted to the front of its section.
   *
   * This is the whole of "the group column leads the table". The grouped
   * column is not replaced by a synthetic one — it IS the group column, moved
   * — which is what keeps its header, and therefore keeps the sort control
   * that reorders that level's group rows.
   *
   * Derived rather than written into the layout, for the reason
   * `columnVisibility` above is: taking the last chip out has to put every
   * column back exactly where it was, and the only way that is true by
   * construction is if nothing was moved to begin with. `onColumnOrderChange`
   * and `reorderColumn` both write to the LAYOUT slice, never to this.
   *
   * The front of this flat array is the front of the SCROLLING columns, which
   * is where the group column belongs: the pinned sections are rendered from
   * `columnPinning` instead, and a column the user froze at an edge stays
   * frozen there. A group column the user had pinned leads its own pinned
   * array instead, just below.
   */
  const columnOrder = useMemo(() => {
    if (groupColumnId === undefined) return layout.columnOrder
    /*
     * An empty slice means "natural order" to TanStack, and there is nothing
     * to lift a column within, so the natural order is spelled out first — the
     * same spelling `reorderColumn` falls back to, so a drag while grouped
     * starts from the order the user has rather than from the derived one.
     */
    const base = layout.columnOrder.length
      ? layout.columnOrder
      : pinnedFirstOrder(columnIds, layout.columnPinning)
    return leadColumn(base, groupColumnId)
  }, [groupColumnId, layout.columnOrder, layout.columnPinning, columnIds])

  /*
   * Pinning as the table renders it: the user's own, with the group column
   * leading the section it is pinned to.
   *
   * A pinned section renders from these arrays and not from `columnOrder`, so
   * a grouped column the user pinned needs the same lift applied here or it
   * would keep its old place in the frozen block. The user's pinning is never
   * changed — a column is not pinned or unpinned by grouping it, because the
   * pinned section is a choice the user made and the grouping has no business
   * overriding it. That is also the answer to "does the group column lead the
   * whole table": it leads the table when nothing is pinned before it, and
   * otherwise it leads the section it is in.
   */
  const columnPinning = useMemo(() => {
    const grouped = (() => {
      if (groupColumnId === undefined) return layout.columnPinning
      const { start, end } = layout.columnPinning
      if (start.includes(groupColumnId)) {
        return { ...layout.columnPinning, start: leadColumn(start, groupColumnId) }
      }
      if (end.includes(groupColumnId)) {
        return { ...layout.columnPinning, end: leadColumn(end, groupColumnId) }
      }
      return layout.columnPinning
    })()
    /*
     * And the chrome columns lead the start section, which — since TanStack
     * renders that section in `columnPinning.start` order and puts it before
     * everything else — is where "selection, then row numbers, then the group
     * column" is actually ENFORCED. The definitions name them in that order
     * too (see `tableColumns`), but a pinned section does not read the
     * definitions or the flat order, so this array is the one that decides.
     *
     * Derived, never written into `layout.columnPinning`, for the same reason
     * the group lift above is not: turning either flag off again has to leave
     * the user's own pinning exactly as it was, and the only way that is true
     * by construction is if nothing was written to begin with.
     *
     * Not `columnOrder`: the columns are pinned, and a pinned section is
     * rendered from these arrays rather than from the flat order.
     */
    const lead = [
      ...(selectionEnabled ? [SELECTION_COLUMN_ID] : []),
      ...(flags.rowNumbers ? [ROW_NUMBER_COLUMN_ID] : []),
    ]
    if (lead.length === 0) return grouped
    return { ...grouped, start: [...lead, ...grouped.start] }
  }, [groupColumnId, layout.columnPinning, flags.rowNumbers, selectionEnabled])

  /*
   * Widths as the table renders them: the user's own, with a floor under the
   * group column.
   *
   * The group column is a grouped column's SLOT, so without this it inherits a
   * width chosen for that column's values — and a 90px `Status` leaves the
   * chevron, the value and the count with nowhere to go. The floor is
   * {@link groupColumnMinWidth}, one indent step wider per level.
   *
   * Three things this deliberately is not:
   *
   * - It is not written into the layout, for the reason `columnVisibility`
   *   above is not: taking the last chip out has to put every column back
   *   exactly as it was, and the only way that is true by construction is if
   *   nothing was changed to begin with.
   * - It does not fight the resizer. A width the user set themselves is in
   *   `layout.columnSizing`, and that wins outright — the floor only applies
   *   where the user has expressed nothing, so a drag narrower than the floor
   *   sticks. The floor is also what a drag STARTS from, since TanStack reads
   *   `getSize()` at pointer-down and that reads this. The one seam is a drag
   *   that lands on EXACTLY the declared width: `normaliseSizing` drops such an
   *   entry as carrying no information, which is what makes "Reset width" work,
   *   and the floor then applies again.
   * - It does not fight the `<colgroup>` either, because it is not a second
   *   width: it goes in through the same `columnSizing` state every other
   *   width does, so the colgroup, the header, the body and the resize handle
   *   all read one number.
   */
  const groupColumnDeclaredWidth = useMemo(
    () => (groupColumnId === undefined ? undefined : declaredLeafSize(columns, groupColumnId)),
    [columns, groupColumnId],
  )

  const columnSizing = useMemo(() => {
    if (groupColumnId === undefined) return layout.columnSizing
    // A width the user set is the user's. Only an untouched column gets a floor.
    if (layout.columnSizing[groupColumnId] !== undefined) return layout.columnSizing
    const declared = groupColumnDeclaredWidth ?? defaultColumnWidth
    // Never past the table's own ceiling: a floor above `maxColumnWidth` would
    // be a width the resizer could not reach back to.
    const floor = Math.min(maxColumnWidth, groupColumnMinWidth(grouping.length))
    if (declared >= floor) return layout.columnSizing
    return { ...layout.columnSizing, [groupColumnId]: floor }
  }, [
    groupColumnId,
    groupColumnDeclaredWidth,
    grouping.length,
    layout.columnSizing,
    defaultColumnWidth,
    maxColumnWidth,
  ])

  /*
   * Which rows are open is deliberately NOT part of the layout: it is a
   * transient reading position, not an arrangement the user chose to keep, and
   * restoring it on the next visit would be surprising. Group expansion is the
   * documented exception and lives in the layout instead — see
   * {@link TableLayout.expanded}.
   */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  /**
   * `getRowId`, with the one row the host cannot answer for handled here.
   *
   * A group row is not one of the host's records — it carries a key path and a
   * count and nothing else — so there is no field for `getRowId` to read, and
   * TanStack's positional default would key it by where it happened to land on
   * the page. Its id is its key path joined, which is both unique among the
   * groups of one table and stable across refetches, so an open group keeps
   * its identity when the page is fetched again.
   *
   * Supplied whenever grouping is possible, even with no host `getRowId`:
   * {@link defaultRowId} is TanStack's own default, restated, so a table that
   * relied on it keeps exactly the ids it had.
   */
  const rowIdOption = useMemo(() => {
    if (!groupingEnabled) return getRowId
    return (row: TData, index: number, parent?: Row<DataTableFeatures, TData>): string =>
      isGroupRow(row)
        ? groupRowId(row.path)
        : getRowId
          ? getRowId(row, index, parent)
          : defaultRowId(index, parent)
  }, [groupingEnabled, getRowId])

  /*
   * Which of the options that follow a prop this render actually states.
   * `mergeOptions` below withdraws the rest, and needs this: it runs
   * synchronously inside the `useTable` on the next line but cannot see the
   * literal being merged in, and the function doing the merging is the
   * previous render's, so it cannot have closed over them either. Written and
   * read within the one render rather than carried across renders.
   */
  const stated = useRef({ rowId: false, subRows: false, totals: false })
  stated.current = {
    rowId: rowIdOption !== undefined,
    subRows: getSubRows !== undefined,
    totals: isServer,
  }

  /*
   * The one list quick search covers: `searchFields` if the host supplied it,
   * otherwise every visible, searchable, accessor-backed column. It is used
   * twice — as `getColumnCanGlobalFilter` below, and as `search.fields` on the
   * wire — so the client and a backend search the same columns for the same
   * text. `filteringOptions` itself is not a dependency: it is a fresh `{}` per
   * render for the two shorthand forms, and only this member is read.
   */
  const resolvedSearchFieldsRef = useRef<string[]>([])
  /*
   * A column resolves at most once per table. `collectSearchFields` folds an
   * unresolved column into inclusion so a server-mode mount is not
   * unsearchable before the first page arrives (see the Task 7 review
   * correction below) — but that same fold, redone every render, opens a
   * feedback loop: `search` depends on `data`, `data` is the host's response
   * to `search`, and a nullable column whose *current* page happens to sample
   * all-null goes back to `unresolved` even after an earlier page proved it
   * unsearchable (a Date or boolean column, say). Re-including it then
   * reopens the request that excluded it, which can narrow the next page back
   * to all-null, forever.
   *
   * This map is the fix: the first time `collectSearchFields` resolves an
   * *inferred* id definitely — in `fields` or in `excluded`, never
   * `unresolved` — that verdict is recorded here and every later render
   * consults it first, instead of re-folding a since-unresolved id back into
   * the default. A table's search-field set can still change once real data
   * replaces the pre-mount default, but never oscillates once a definite
   * answer exists.
   *
   * A *declared* id — `meta.searchable`, or `enableGlobalFilter: false` on the
   * column definition — never enters this cache at all: `collectSearchFields`
   * reports those separately, in `declared`, and this render's fresh
   * `fields`/`excluded` membership decides them outright every time. A
   * declaration is not an inference from sampled `data`, so there is no
   * feedback loop here for the cache to guard against, and a host that
   * changes the declaration after mount — an async permission check, a
   * "search this column" toggle — has to see the new value take effect on the
   * very next render, narrowing or widening.
   */
  const searchVerdictsRef = useRef<Map<string, boolean>>(new Map())
  const resolvedSearchFields = useMemo(() => {
    const next = (() => {
      if (!filteringEnabled) return []
      const declaredOverride = filteringOptions?.searchFields
      if (declaredOverride) {
        /*
         * Named explicitly, but still held to what the client can actually
         * match: `pruneSearchFields` drops an id that names no column, names a
         * display column, or names one that opted out with
         * `enableGlobalFilter: false`, because TanStack's own
         * `column_getCanGlobalFilter` refuses all three underneath
         * `getColumnCanGlobalFilter` below and the wire would otherwise ask a
         * backend to search columns this table searches none of. Visibility is
         * not part of that gate: overriding the hidden-column narrowing is
         * what `searchFields` is for.
         */
        const { fields, dropped } = pruneSearchFields(columns, sampleRows, declaredOverride)
        if (process.env.NODE_ENV !== "production" && dropped.length > 0) {
          warnOnce(
            `useDataTable("${id}"): filtering.searchFields dropped ${dropped.map((field) => `"${field}"`).join(", ")}. ` +
              `Quick search only covers a column that exists, has an accessor, and does not set enableGlobalFilter: false. ` +
              `A nested accessorKey's live column id replaces each "." with "_".`,
          )
        }
        return fields
      }
      const { fields, unresolved, excluded, declared } = collectSearchFields(columns, sampleRows, layout.columnVisibility)
      const verdicts = searchVerdictsRef.current
      const declaredIds = new Set(declared)
      const fieldsSet = new Set(fields)
      // Record every *inferred* id this render resolved for real, the first
      // time it is resolved — see the JSDoc above. A verdict already cached
      // (from an earlier render) is left as-is even if this render's evidence
      // disagrees: it is the *first* resolution that is authoritative. A
      // declared id is skipped here on purpose; it is decided below instead.
      for (const id of fields) if (!declaredIds.has(id) && !verdicts.has(id)) verdicts.set(id, true)
      for (const id of excluded) if (!declaredIds.has(id) && !verdicts.has(id)) verdicts.set(id, false)
      return [...fields, ...excluded, ...unresolved]
        .filter((id) =>
          declaredIds.has(id)
            ? // A declaration reads this render's membership outright, bypassing
              // the cache entirely — see the JSDoc above.
              fieldsSet.has(id)
            : // A column with nothing declared and no sampled value yet — ever,
              // for this id — stays included rather than dropped, so a
              // server-mode table's first render is still searchable before
              // `data` has arrived. See the Task 7 review correction next to
              // `collectSearchFields`'s own definition for why folding
              // `unresolved` into exclusion is wrong, and the JSDoc above for
              // why a *cached* verdict, not this render's raw `unresolved`, is
              // what decides an inferred id that has resolved before.
              (verdicts.get(id) ?? true),
        )
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    })()
    /*
     * `filteringOptions?.searchFields` is a fresh array for the natural inline
     * call form `filtering: { searchFields: [...] }` — the options object is
     * an object literal, so this memo's own dependency changes identity every
     * render even when the resolved list is byte-identical. That churn would
     * otherwise reach `columnFilters` below (whose second dependency this is)
     * and, through it, `createFilteredRowModel`'s reference-equality memo
     * deps: every unrelated host re-render would re-filter, re-sort and
     * re-paginate, and feed a fresh `rows` array into `useRowVirtualizer`,
     * forcing a re-measure of every virtual item. Held in a ref and compared
     * structurally — the same ref-plus-structural-compare idiom
     * `useArrangement` uses for `persistedRef` — so the identity this hook
     * hands out changes only when the resolved fields actually do.
     */
    if (layoutSliceEqual(resolvedSearchFieldsRef.current, next)) {
      return resolvedSearchFieldsRef.current
    }
    resolvedSearchFieldsRef.current = next
    return next
  }, [filteringEnabled, filteringOptions?.searchFields, columns, sampleRows, layout.columnVisibility])

  /*
   * Bumped by the programmatic writers — `clearAll` and `setModel` — and by
   * nothing else. Both write `layout.filters` synchronously and `layout.search`
   * through the debounce, so without this the filters landed at once and the
   * search 300 ms later: a host wired to `onQueryChange` fired one wasted
   * round-trip and showed a two-step settle on every "Clear all" click and
   * every URL restore. A keystroke leaves the token alone and goes on waiting
   * out `debounceMs`, which is the whole point of the debounce.
   */
  const [publishToken, setPublishToken] = useState(0)
  const publishNow = useCallback(() => setPublishToken((token) => token + 1), [])

  /*
   * `layout.search` holds the raw text and is written on every keystroke, which
   * keeps the input a normal controlled field. What is debounced is everything
   * downstream: `state.globalFilter`, and `search` on the wire. Ten keystrokes
   * then produce ten renders that change nothing the row model memoises on, and
   * one query.
   *
   * Both sides get `text.trim()`: `createFilteredRowModel` treats `" "` as a
   * live global filter and would search for a space, while a wire carrying
   * `null` would have the server return everything.
   */
  const searchText = useDebouncedValue(
    layout.search.trim(),
    filteringOptions?.debounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS,
    publishToken,
  )
  // An empty field list means search is off: the client has nothing to match
  // against, so the wire carries `null` rather than a term no backend could honour.
  const search = useMemo<TableSearch | null>(
    () =>
      searchText === "" || resolvedSearchFields.length === 0
        ? null
        : { text: searchText, fields: resolvedSearchFields },
    [searchText, resolvedSearchFields],
  )

  /*
   * `filters` is the first layout slice whose shape is not already TanStack's,
   * so it is the first that cannot be passed straight through.
   *
   * Memoised because `createFilteredRowModel` compares its memo deps by
   * reference and a controlled state slice is read back verbatim: a fresh array
   * per render would re-filter every row on every unrelated host re-render. It
   * runs in server mode too — the filtered row model is inert there, but
   * `column.getIsFiltered()` still reads the slice, and that is what marks a
   * filtered header. `condition.field` is authoritative: this is the only
   * writer of `ColumnFilter.id`, so the two can never disagree.
   *
   * `resolvedSearchFields` is the second dependency, and it is not decoration.
   * `createFilteredRowModel` memoises on exactly three things — the core row
   * model, `columnFilters` and `globalFilter` — while `getColumnCanGlobalFilter`
   * below is a function of the resolved field list. Hiding a column while a
   * search is active changes which columns are searched and changes none of
   * those three, so without this the filtered row model would not recompute:
   * the client would go on matching a hidden column that `search.fields` on the
   * wire had already dropped, which is the exact divergence §3.3 states the
   * predicate to prevent. The list is itself memoised, so an unrelated
   * re-render still gets the same array back and the identity holds.
   */
  const columnFilters = useMemo<ColumnFiltersState>(
    () => layout.filters.map((condition) => ({ id: condition.field, value: condition })),
    [layout.filters, resolvedSearchFields],
  )

  /*
   * `column.setFilterValue(condition)` keeps working for a host driving the
   * table through TanStack's own API: the value *is* the condition, so the
   * touched entry maps straight back to a condition — through `pruneFilters`,
   * the same gate `setModel` and `setCondition` run, since this input is no
   * more trusted. Without it, this path is how a condition no editor could
   * reach gets onto `state.columnFilters` and `query.filters` and stays
   * there: an unknown column id (`table.setColumnFilters([{ id: "ghost", … }])`),
   * a condition whose kind no longer matches the column's resolved kind
   * (including a column declared `meta: { filter: false }`, for which
   * `resolveFilterKind` returns `false`), or two entries for the same field —
   * exactly the stranded-filter case `pruneFilters` exists to prevent,
   * reachable here too because TanStack's own `setColumnFilters` passes an
   * unknown id straight through. Left unwired entirely, the default updater
   * would write to an atom that the controlled `state.columnFilters`
   * overrides, and `setFilterValue` would silently do nothing.
   *
   * Only the entry (or entries) TanStack actually changed are re-validated —
   * the rest are folded back in as the already-canonical condition, exactly
   * like `setCondition` does for the rest of the list. `filterKinds` is
   * re-derived from `data` (see the memo above) and can drift between
   * renders: a column with no declared `meta.filter` infers its kind from
   * sampled data, so it can read as unresolved on an empty first render and
   * resolve once data arrives. Running every entry, touched or not, back
   * through `pruneFilters` on every write means a condition set while a
   * column's kind was still unresolved gets silently re-judged — and
   * possibly dropped — the next time an unrelated column's filter changes,
   * with no error and a trigger ("which page happened to load first") the
   * user has no way to correlate with the action. `setCondition` already
   * gives untouched conditions this guarantee; an entry counts as untouched
   * here when TanStack hands back the very same `value` reference it was
   * given, which is what `column_setFilterValue` does for every column but
   * the one it is changing.
   */
  const updateFiltersFromTanStack = useCallback(
    (updater: Updater<ColumnFiltersState>) => {
      updateFilters((current) => {
        const beforeById = new Map(current.map((condition) => [condition.field, condition]))
        const before: ColumnFiltersState = current.map((condition) => ({
          id: condition.field,
          value: condition,
        }))

        const order: string[] = []
        const seenIds = new Set<string>()
        const touchedFields = new Set<string>()
        const touchedCandidates: FilterCondition[] = []
        for (const entry of apply(updater, before)) {
          if (seenIds.has(entry.id)) continue
          seenIds.add(entry.id)
          order.push(entry.id)
          const priorCondition = beforeById.get(entry.id)
          if (priorCondition !== undefined && entry.value === priorCondition) continue
          touchedFields.add(entry.id)
          const value = entry.value as FilterCondition
          if (typeof value === "object" && value !== null) {
            touchedCandidates.push({ ...value, field: entry.id })
          }
        }

        const prunedTouched = new Map(
          pruneFilters(touchedCandidates, columnIds, filterKinds).map((condition) => [
            condition.field,
            condition,
          ]),
        )
        // A touched field that `pruneFilters` drops is gone — never fall
        // back to its prior condition, or an invalidated write would restore
        // the stale value it was meant to replace.
        return order.flatMap((id) => {
          const kept = touchedFields.has(id) ? prunedTouched.get(id) : beforeById.get(id)
          return kept === undefined ? [] : [kept]
        })
      })
    },
    [updateFilters, columnIds, filterKinds],
  )

  const table = useTable<DataTableFeatures, TData>({
    features: FEATURES,
    /*
     * The one cast in this file, and it is the price of the flat grouped page.
     * A group row travels in `data` beside the host's records because that is
     * the order the user sees, and TanStack is generic over ONE row type. It
     * never reaches a host callback — `rowIdOption`, `getSubRows`,
     * `getRowCanExpand` below and `TableBody` all narrow with `isGroupRow`
     * first — and accessors are lazy, so a cell renderer is only ever called
     * for a row rendered as a record.
     */
    data: data as TData[],
    columns: tableColumns,
    state: {
      columnOrder,
      columnVisibility,
      columnPinning,
      columnSizing,
      sorting: layout.sorting,
      columnFilters,
      globalFilter: searchText,
      pagination: { pageIndex: pageState.pageIndex, pageSize: pageState.pageSize },
      expanded,
    },
    ...(rowIdOption ? { getRowId: rowIdOption } : {}),
    // A group row has no children of the host's kind; asking would hand the
    // host a row it has no accessor for.
    ...(getSubRows ? { getSubRows: (row: TData) => (isGroupRow(row) ? undefined : getSubRows(row)) } : {}),
    /*
     * Every row is expandable as far as TanStack is concerned. Whether a
     * toggle actually appears is decided where it is rendered — a row shows one
     * when it has children or when the table was given a detail renderer — and
     * the hook cannot see the latter. Leaving the default in place instead
     * would make `toggleExpanded()` a no-op for detail panels.
     */
    getRowCanExpand: (row) =>
      // A group row opens through `grouping.toggle`, which is a refetch, not
      // through TanStack's expansion — and a detail panel under a group header
      // would be a panel for a row that is not a record.
      isGroupRow(row.original) ? false : canExpand ? canExpand(row.original) : true,
    /*
     * TanStack collapses everything whenever `data` changes identity. Callers
     * routinely pass a fresh array per render (`data: items.slice(0, 8)`), and
     * with the default a toggle click re-renders the host, which resets the
     * row it just opened. Expansion is this hook's own state; it decides.
     */
    autoResetExpanded: false,
    manualSorting: isServer,
    /*
     * Written unconditionally on every render, as a plain boolean, so the
     * option merge can never carry a stale value — it needs no `mergeOptions`
     * branch, which exists only for the four options this hook *omits*.
     *
     * It turns off the filtered row model, not the filter state:
     * `column.getIsFiltered()` reads `state.columnFilters` directly and keeps
     * working, which is what drives the header marker in server mode.
     */
    manualFiltering: isServer,
    /*
     * Defaults to false, which for tree data hides a matching child whenever
     * its parent fails the filter — a filtered tree would show nothing for a
     * term only leaves contain. Expansion survives a filter change with no
     * work: it is keyed by row id and `autoResetExpanded: false` is already set.
     */
    filterFromLeafRows: getSubRows !== undefined,
    /*
     * Stated, because the default is `"auto"` — one whole-string substring test
     * applied once per searchable column with that column's id, ORed with a
     * break on the first true. That cannot express "tokens may match different
     * columns": searching `KR-102 agro` would look for the literal string
     * inside one column at a time. Ours is a row-level predicate that ignores
     * the column id it is handed, so TanStack's own OR and break are harmless.
     */
    globalFilterFn: filterFn_dtSearch,
    /*
     * Stated too. TanStack's own default applies a value-type heuristic as a
     * gate *underneath* the flags rather than as a default a host can override,
     * and never consults visibility at all — so without this a hidden column
     * would go on being searched client-side while `search.fields` omitted it,
     * and the two modes would search different columns for the same text.
     */
    getColumnCanGlobalFilter: (column) => resolvedSearchFields.includes(column.id),
    manualPagination: isServer || paginationOptions === null,
    /*
     * Both totals are written on every server render rather than omitted when
     * unknown: a total that returned to "unknown" would otherwise go on
     * reporting the stale one.
     *
     * `pageCount: -1` is TanStack's own word for "unknown". Without it it
     * counts the rows it can see — one page — concludes there is nothing after
     * them, and kills the Next button until the total arrives.
     */
    ...(isServer
      ? { rowCount: rowCount ?? data.length, pageCount: pageState.pageCount ?? -1 }
      : {}),
    /*
     * Withdraw the four options above that follow a prop. The adapter merges
     * each render's options into the previous object (`{ ...prev, ...next }`),
     * so one left out keeps the value it had last time: a table switched to
     * client mode would go on reporting the server's totals from
     * `getRowCount()` and `getPageCount()` — and refusing, in `setPageIndex()`,
     * to page to rows it is holding — while a `getRowId` that stopped being
     * supplied would go on keying rows by a record id the host no longer has.
     *
     * Deleting rather than writing `undefined`: TanStack types these as
     * `pageCount?: number`, which under `exactOptionalPropertyTypes` cannot be
     * given the one value that means "unset".
     */
    mergeOptions: (previous, next) => {
      const merged = { ...previous, ...next }
      if (!stated.current.rowId) delete merged.getRowId
      if (!stated.current.subRows) delete merged.getSubRows
      if (!stated.current.totals) {
        delete merged.rowCount
        delete merged.pageCount
      }
      return merged
    },
    /*
     * Same reasoning as `autoResetExpanded`: TanStack would send the user back
     * to page one whenever `data` changes identity, which in server mode is
     * every response to the query that asked for page four.
     */
    autoResetPageIndex: false,
    /*
     * Two page moves in one tick are last-write-wins: both read the same
     * `pageState`, so the second overwrites the first. Every footer control is
     * its own tick, so this costs nothing in practice.
     */
    onPaginationChange: (updater: Updater<PaginationState>) => {
      const next = apply(updater, { pageIndex: pageState.pageIndex, pageSize: pageState.pageSize })
      if (next.pageSize !== pageState.pageSize) {
        /*
         * A size change always arrives with an index: `setPageSize` computes
         * one from the top row, `setPagination` states one outright. Applying
         * them separately would clamp that index against the old size's page
         * count — dropping `setPagination({ pageIndex: 7, pageSize: 20 })` onto
         * page 0 — so both go in together.
         */
        pageState.setPagination(next)
        return
      }
      if (next.pageIndex !== pageState.pageIndex) pageState.setPageIndex(next.pageIndex)
    },
    onExpandedChange: (updater) =>
      setExpanded((prev) => apply(updater, prev) as Record<string, boolean>),
    defaultColumn: {
      size: defaultColumnWidth,
      minSize: minColumnWidth,
      maxSize: maxColumnWidth,
      /*
       * `columnFilteringFeature` defaults every column to `filterFn: "auto"`,
       * which resolves a built-in *name* through the very registry narrowed to
       * `{ dt }` above. Every lookup would miss, `column_getFilterFn` would
       * return undefined, and `createFilteredRowModel` would skip that filter
       * entirely — every row passing, with one dev-console warning and nothing
       * else. TanStack merges the feature default first, then this, then a
       * host's own column def, so this sets the default without taking the
       * escape hatch away.
       */
      filterFn: "dt",
    },
    enableSorting: flags.sorting,
    /*
     * Ascending-first for every column, overriding TanStack's own per-column
     * sniff (`column_getAutoSortDir`, used whenever a column declares neither
     * `sortDescFirst` nor a `sortFn` that implies one). That sniff reads at
     * most ten rows of `getFilteredRowModel()`, and in this table that model
     * holds one SERVER page at an arbitrary offset — sometimes group headers
     * (no value for the grouped column, so the sniff's `continue` loop falls
     * through to its `desc` default), sometimes leaves, sometimes a page of
     * numbers where non-string values also default to `desc`. A fifty-row
     * window of a hundred-thousand-row result cannot answer "does this column
     * sort ascending or descending first", so the answer must not depend on
     * it — different columns sniffing different directions, or the same
     * column flipping across pages, is what this line stops. Ascending-first
     * is also what the header button's label has always promised on a first
     * click; see `sortActionLabel` in HeaderCell, which now asks
     * `getNextSortingOrder()` instead of assuming this cycle, so a column
     * that overrides `sortDescFirst` on its own definition still gets a
     * truthful label.
     */
    sortDescFirst: false,
    enableColumnResizing: flags.resizing,
    enableColumnPinning: flags.pinning,
    enableHiding: flags.hiding,
    columnResizeMode: "onChange",
    columnResizeDirection: direction,
    onColumnOrderChange: (updater) => updateSlice("columnOrder", updater),
    onColumnVisibilityChange: (updater) => updateSlice("columnVisibility", updater),
    onColumnPinningChange: (updater) => updateSlice("columnPinning", updater),
    onColumnSizingChange: (updater) =>
      updateSlice("columnSizing", updater, (sizing) => normaliseSizing(sizing, table)),
    onSortingChange: updateSorting,
    onColumnFiltersChange: updateFiltersFromTanStack,
    /*
     * `state.globalFilter` is controlled from `layout.search`, so TanStack's
     * default updater would write to an atom the controlled value overrides,
     * and `table.setGlobalFilter()` would silently do nothing — the same trap
     * `onColumnFiltersChange` avoids for `column.setFilterValue()`.
     */
    onGlobalFilterChange: (updater: Updater<string>) => updateSearch(apply(updater, layout.search)),
  })

  /**
   * Move a column — or a whole column group — next to another one, the way
   * both drag surfaces ask for.
   *
   * Lives here, with the layout, because a move is not always one slice. The
   * rendered order is `columnPinning.start`, then `columnOrder` minus the
   * pinned columns, then `columnPinning.end` — so moving a PINNED column has
   * to rewrite the pinning array as well, or the order changes underneath a
   * header that renders exactly as before. That was the bug: the panel drew
   * the slot, the live region announced the new position, the screen did not
   * move, and storage kept an order it did not show, waiting to spring on the
   * next unpin.
   *
   * Both slices go in one {@link updateSlices} call. Two calls would each be
   * honest on their own and leave a window — one render, one debounced save —
   * in which the table has the new pinning and the old order, which is the
   * self-contradicting layout this exists to prevent.
   *
   * A GROUP is moved the same way, because to this order a group is simply
   * the run of leaf ids it stands over: {@link moveRun} lifts that run out
   * whole and puts it down at one end of the target's run, so every leaf
   * arrives together and in the order it already had. The target may be a
   * group too, and the run is never landed inside it — which is what keeps a
   * drag between groups from quietly nesting one in the other.
   *
   * Which run that is comes from the HOST's definitions and never from the
   * live columns — see {@link declaredLeafIds}. The stored order is the
   * host's arrangement, so a group's run in it is the one the host declared,
   * whatever a grouped table has hoisted out of it to render.
   *
   * @param draggedId - The column being moved: a leaf, or a group column.
   * @param targetId - The column it was dropped on, likewise.
   * @param side - Which edge of the target it was dropped on.
   */
  const reorderColumn = useCallback(
    (draggedId: string, targetId: string, side: DropSide) => {
      /*
       * The order is a flat list, so a move across a group or a pinning
       * boundary would either be ignored or tear a group's header apart.
       * Refusing it is the honest outcome — and both drag surfaces ask
       * `dropRegionOf` the same question before they draw a slot, so nothing
       * that reaches here should ever be refused.
       */
      const dragged = table.getColumn(draggedId)
      const target = table.getColumn(targetId)
      if (!dragged || !target) return
      if (dropRegionOf(dragged, groupColumnId) !== dropRegionOf(target, groupColumnId)) return

      /*
       * What each of them is, to an order made of leaves: itself, or its run.
       *
       * Read off the HOST's definitions, not off the live column. While rows
       * are grouped the table is built from a hoisted tree — the column
       * holding the group values has been taken out of its column group so it
       * can lead the table — and that tree answers with one leaf where the
       * host declared two. Carrying the move out against that answer drops the
       * dragged column into the gap the hoisted leaf left, splitting the group
       * in the stored order: two headers with one name, and no sign of it
       * until the grouping comes off. See {@link declaredLeafIds}.
       */
      const movedIds = declaredLeafIds(columns, draggedId)
      const targetIds = declaredLeafIds(columns, targetId)
      // Both columns were just found on a table built from these definitions,
      // so this is unreachable rather than a refusal a surface has to predict.
      if (movedIds === null || targetIds === null) return

      /*
       * Same region, so the target is pinned exactly as the dragged column is
       * — this is which array, if any, also has to move. Read off a leaf: a
       * group answers "start" as soon as any one leaf under it is pinned, and
       * `dropRegionOf` has already refused a group whose leaves disagree.
       */
      const pinnedSide = dragged.getLeafColumns()[0]?.getIsPinned() ?? false

      updateSlices([
        sliceChange("columnOrder", (current) => {
          /*
           * When nothing has been reordered yet the order is empty, meaning
           * "natural". The fallback must be the order the columns are RENDERED
           * in — pinned sections first and last, which declaration order alone
           * does not say — so it scrambles nothing on the very first drag.
           *
           * Read off the ids and the pinning slice rather than off the table,
           * which would answer with the order the GROUPING derived: lifting
           * the group column to the front is a view, and baking it into the
           * user's own slice is how "take the last chip out and every column
           * is back where it was" would quietly stop being true.
           *
           * Hidden columns included: TanStack appends whatever an order does
           * not name, so a fallback built from the visible columns alone would
           * send every hidden one to the end of the table on the first drag.
           */
          const order = current.length ? current : pinnedFirstOrder(columnIds, layout.columnPinning)
          return moveRun(order, movedIds, targetIds, side)
        }),
        /*
         * Written even for a pinned move, where it changes nothing on screen:
         * the pinned columns are not rendered from it. It is what the move
         * means once the column is unpinned again, and leaving it behind is
         * the same silent disagreement one slice over.
         */
        ...(pinnedSide === false
          ? []
          : [
              sliceChange("columnPinning", (current) =>
                pinnedSide === "start"
                  ? { ...current, start: moveRun(current.start, movedIds, targetIds, side) }
                  : { ...current, end: moveRun(current.end, movedIds, targetIds, side) },
              ),
            ]),
      ])
    },
    [table, updateSlices, groupColumnId, columns, columnIds, layout.columnPinning],
  )

  /*
   * How many rows the QUERY matches, across every page.
   *
   * In server mode it is `rowCount` and the table never sees the other pages;
   * in client mode `data` is the whole set and the post-filter, pre-pagination
   * row model is the same quantity measured where the client keeps it. It is
   * what the `all-matching` selection counts against — see `selectionCount`,
   * which answers `undefined` rather than a guess while this is undefined.
   */
  const matchingRowCount = isServer ? rowCount : table.getPrePaginatedRowModel().rows.length

  /*
   * The same quantity, corrected for the one case where `rowCount` is not a
   * count of records: a GROUPED server table, where it is the length of the
   * flattened page list and so counts group headers alongside leaves. "Select
   * all 84 rows" over 84 group headers is simply a wrong number, and the model
   * underneath it is still right — `all-matching` means the query's filters
   * minus the exclusions, which a backend resolves to records either way. Only
   * the spoken count is at stake, so the answer is to stop speaking it rather
   * than to speak a number that is not the one the user will act on.
   *
   * `selectableRowCount` is the host's way to say it properly, the way
   * `unfilteredTotal` already lets a host say something only the server knows.
   * Absent while grouped, the count is undefined and `labels.selectAllRows`
   * falls back to its no-number wording, which it already has for the window
   * before a server answers at all.
   */
  const selectableCount =
    selectableRowCount ?? (grouping.length > 0 ? undefined : matchingRowCount)

  /*
   * In client mode the total is whatever survived filtering, which only the
   * table knows; in server mode it is `rowCount` and the table never sees the
   * other pages. Undefined when nothing is being paged.
   */
  const clientRowCount = paginationOptions !== null && !isServer ? matchingRowCount : undefined

  /*
   * Publish the count the table just produced, then correct the one case the
   * render could not: a count that fell below the current page (data replaced,
   * rows removed). Before paint, so the user never sees the empty page — and
   * after the ref is written, so the clamp inside `setPageIndex` measures
   * against the new count rather than the one this render was built from.
   *
   * A count that grew needs no correction here: the page the user is on still
   * exists, and their next click reads the same ref.
   */
  useIsomorphicLayoutEffect(() => {
    rowCountRef.current = isServer ? rowCount : clientRowCount
    if (isServer || clientRowCount === undefined) return
    const last = Math.max(1, Math.ceil(clientRowCount / pageState.pageSize)) - 1
    if (pageState.pageIndex > last) pageState.setPageIndex(last)
  })

  const paginationApi: PaginationApi & { unfilteredTotal: number | undefined } = useMemo(
    () => ({
      ...pageState,
      rowCount: isServer ? rowCount : clientRowCount,
      pageCount: isServer
        ? pageState.pageCount
        : clientRowCount === undefined
          ? // Client mode with paging off, or the very first render before the
            // table has been built. One page is the honest answer: every row
            // there is to show is on screen.
            1
          : Math.max(1, Math.ceil(clientRowCount / pageState.pageSize)),
      /*
       * Server mode: whatever the host passed, undefined until it has — see
       * `UseDataTableOptions.unfilteredTotal`. Client mode: `data` already IS
       * the whole set the table filters, so its own length answers the
       * question outright and a host has nothing to add. `data.length` and
       * not `clientRowCount`: that one is POST-filter (`getPrePaginatedRowModel`),
       * the very count this field exists to be compared against.
       */
      unfilteredTotal: isServer ? unfilteredTotal : data.length,
    }),
    [pageState, isServer, rowCount, clientRowCount, unfilteredTotal, data.length],
  )

  const query = useTableQuery({
    sorting: layout.sorting,
    filters: layout.filters,
    search,
    grouping,
    expanded: expandedGroups,
    pageIndex: pageState.pageIndex,
    pageSize: pageState.pageSize,
    onQueryChange,
  })

  /*
   * The selection, and the rule that keeps it safe.
   *
   * It is given the QUERY rather than the mutators, because a change to the
   * filters, the search or the grouping has to clear it and there are more
   * ways to change a query than there are mutators — see `useSelection`, which
   * explains why that reset lives there rather than beside the `resetPage()`
   * calls above.
   *
   * It is deliberately NOT a layout slice, so nothing about it is passed to
   * `useArrangement` and nothing about it reaches `storage`. A selection
   * restored from last week, against a query that has since changed, is the
   * query-change failure wearing a hat.
   */
  /*
   * The rows a `"page"`-scoped header checkbox reaches: the ones the body is
   * about to draw a checkbox on, which is not the same list as the ones it is
   * about to draw. Group headers are left out — a group stands for children
   * the browser does not hold, so `BodyRow` gives it no checkbox — and a page
   * that is all group headers therefore leaves nothing for the header to take.
   *
   * Undefined in the default header scope, where the row model is not even
   * asked for: a table whose header means "everything matching" must not build
   * one for a list nothing reads — a headless host may never render rows at
   * all.
   */
  const pageRows = headerSelectionScope === "page" ? table.getRowModel().rows : null
  const pageRowIds = useMemo(
    () =>
      pageRows === null
        ? undefined
        : pageRows.filter((row) => !isGroupRow(row.original)).map((row) => row.id),
    [pageRows],
  )

  const selection = useSelection({
    id,
    enabled: selectionEnabled,
    query,
    rowCount: selectableCount,
    hasRowId: getRowId !== undefined,
    headerScope: headerSelectionScope,
    pageRowIds,
    onSelectionChange,
  })

  const setCondition = useCallback(
    (condition: FilterCondition) => {
      /*
       * The same gate `setModel` and a stored layout go through, rather than
       * the condition's own constructor alone: a column the table does not
       * define, and a kind that no longer matches the column, are how a
       * condition no editor could reach used to get onto `query.filters` and
       * stay there — the stranded-filter case `pruneFilters` exists to
       * prevent, arriving through the mutator instead of through storage. An
       * editor that constrains nothing comes back empty too, and clears the
       * column.
       */
      const [built] = pruneFilters([condition], columnIds, filterKinds)
      // `pruneFilters` reads a malformed entry without dereferencing it, so
      // the field being cleared is read just as carefully.
      const field =
        built?.field ??
        (typeof condition === "object" && condition !== null ? condition.field : undefined)
      if (field === undefined) return
      updateFilters((current) => {
        const rest = current.filter((existing) => existing.field !== field)
        return built === undefined ? rest : [...rest, built]
      })
    },
    [updateFilters, columnIds, filterKinds],
  )
  const clearColumn = useCallback(
    (columnId: string) =>
      updateFilters((current) => current.filter((existing) => existing.field !== columnId)),
    [updateFilters],
  )
  const clearAll = useCallback(() => {
    updateFilters([])
    updateSearch("")
    // Both halves of "clear" belong to one query: see `publishNow`.
    publishNow()
  }, [updateFilters, updateSearch, publishNow])
  const setModel = useCallback(
    (model: FilterModel) => {
      /*
       * Untrusted input — a URL, a host's own store, a hand-written literal —
       * so it is held to the same rules as a stored layout, and every
       * surviving condition is re-run through its constructor. Without the
       * re-run a condition assembled in a different key order would stringify
       * differently from an identical one the editors built, and the
       * no-spurious-refetch story would have a hole in it reachable through
       * the very API recommended for URL round-trips.
       */
      updateFilters(pruneFilters(model.filters ?? [], columnIds, filterKinds))
      // `updateSearch` is where a non-string is coerced, for every caller at
      // once; a second check here would be the same rule written twice.
      updateSearch(model.search)
      // A whole model is one request, not two: see `publishNow`. Announcing the
      // filters without the search would be the spurious refetch the re-run
      // above exists to prevent, arriving from the other side.
      publishNow()
    },
    [updateFilters, updateSearch, publishNow, columnIds, filterKinds],
  )

  const filteringApi = useMemo(
    () => ({
      enabled: filteringEnabled,
      /*
       * Which editor each column gets. Published because every filter surface
       * needs it and §7.4's resolution is data-dependent: a component that
       * re-derived it would be free to disagree with the map `pruneFilters`
       * used on load, and a column would then edit as one kind and prune as
       * another.
       */
      kinds: filterKinds,
      /*
       * Forwarded so a values editor can reach it. Never called in client
       * mode, where faceting computes the list for free and for nothing; in
       * server mode it is the only source of choices a host can supply.
       */
      loadValues: filteringOptions?.loadValues,
      conditions: layout.filters as readonly FilterCondition[],
      search: layout.search,
      isFiltered: layout.filters.length > 0 || layout.search.trim() !== "",
      setCondition,
      clearColumn,
      clearAll,
      setSearch: updateSearch,
      getModel: (): FilterModel => ({ filters: [...layout.filters], search: layout.search }),
      setModel,
    }),
    [
      filteringEnabled,
      filterKinds,
      filteringOptions?.loadValues,
      layout.filters,
      layout.search,
      setCondition,
      clearColumn,
      clearAll,
      updateSearch,
      setModel,
    ],
  )

  /*
   * Everything a host — or the drag zone that sets the grouping — needs to
   * read, set and clear it. Shaped like {@link filteringApi}: one object with
   * the feature's own flag, its state, and the mutators that change it, so
   * there is one idiom for "a feature's public surface" rather than a new one
   * per feature.
   */
  const groupingApi = useMemo(
    () => ({
      /** Whether this table can group at all — server mode only. */
      enabled: groupingEnabled,
      /** Column ids grouped by, outermost first. Empty means no grouping. */
      columns: grouping as readonly string[],
      isGrouped: grouping.length > 0,
      /** Whether a column is one of the grouping levels. */
      has: (columnId: string) => grouping.includes(columnId),
      /**
       * Which grouped column holds the group values, so a header can badge
       * itself and the body knows which cell to render the chevron in.
       */
      columnId: groupColumnId,
      /** Replace the whole grouping; unknown and repeated ids are dropped. */
      set: (columnIds: readonly string[]) => updateGrouping([...columnIds]),
      /**
       * Add a level. Defaults to the innermost position; pass `atIndex` to
       * nest it anywhere else. A column already grouped is MOVED rather than
       * repeated, which is what a drag onto a zone that already holds it means.
       */
      add: (columnId: string, atIndex?: number) =>
        updateGrouping((current) => {
          const without = current.filter((id) => id !== columnId)
          const at = atIndex === undefined ? without.length : Math.max(0, Math.min(atIndex, without.length))
          return [...without.slice(0, at), columnId, ...without.slice(at)]
        }),
      remove: (columnId: string) => updateGrouping((current) => current.filter((id) => id !== columnId)),
      clear: () => updateGrouping([]),
      /** Open group key paths, outermost key first. */
      expanded: expandedGroups as readonly FilterValue[][],
      /**
       * The group the first row of the current page sits inside, as the host
       * reported it. Empty when that row is at the top level, when nothing is
       * grouped, or when the host does not publish it.
       */
      startPath: (groupingEnabled ? (startPath ?? NO_PATH) : NO_PATH) as readonly FilterValue[],
      isExpanded: (path: readonly FilterValue[]) => isPathExpanded(expandedGroups, path),
      /** Open a closed group or close an open one. Closing drops its descendants. */
      toggle: toggleGroup,
      collapseAll: collapseAllGroups,
    }),
    [
      groupingEnabled,
      grouping,
      groupColumnId,
      expandedGroups,
      startPath,
      updateGrouping,
      toggleGroup,
      collapseAllGroups,
    ],
  )

  /*
   * `process.env.NODE_ENV` and not `import.meta.env.DEV`: this library is built
   * in Vite's library mode, which substitutes `import.meta.env.DEV` with our
   * own build's value and so would strip the warning from the shipped bundle
   * entirely. `process.env` is deliberately left alone for the consumer's
   * bundler to substitute, which is what puts the warning in their dev build.
   *
   * Bare, with no `typeof process` guard: esbuild folds `typeof process` to
   * "undefined" for browser targets, which would make the warning unreachable
   * for everyone. `@tanstack/table-core` — a required peer, so it is in every
   * consumer's graph — reads `process.env.NODE_ENV` bare for the same reason.
   */
  if (process.env.NODE_ENV !== "production" && isServer && !getRowId) {
    warnOnce(
      `useDataTable("${id}"): mode "server" without getRowId keys rows by position; ` +
        `expansion will not follow records across pages.`,
    )
  }

  /*
   * Turning paging off does not stop the query describing a page: `TableQuery`
   * has no way to say "all of them", so it carries the default size and a
   * backend written against it answers with 50 rows — with no footer to page
   * past them and no total to reveal the rest.
   */
  if (process.env.NODE_ENV !== "production" && isServer && paginationOptions === null) {
    warnOnce(
      `useDataTable("${id}"): mode "server" with pagination turned off still asks for ` +
        `one page of ${pageState.pageSize} rows, and offers no way to reach the rest. ` +
        `Leave pagination on in server mode, or page the rows in the server's own query.`,
    )
  }

  /*
   * There is deliberately NO dev warning for a server table that is still
   * awaiting its first page. Every signal available here is ambiguous: this
   * hook cannot see `loading` or `error` (they are `<DataTable>` props), and
   * "no rows, no rowCount, no onQueryChange" is also what a perfectly healthy
   * host looks like on its first render before its own props resolve. A
   * warning that fires there cries wolf on the very hosts it was meant to
   * help and, being a warnOnce, can never take itself back. The behaviour it
   * would have explained is documented in the README's server-mode section
   * and pinned by `ServerFirstPaint.test.tsx` instead.
   */

  return {
    table,
    id,
    flags,
    bounds,
    reorderColumn,
    resetLayout,
    isCustomised,
    expanded,
    mode,
    query,
    pagination: paginationApi,
    filtering: filteringApi,
    grouping: groupingApi,
    selection,
    tableHeight,
    rowHeight,
    getRowHeight,
    heightVersion,
  }
}

/**
 * Everything {@link useDataTable} returns: the TanStack instance plus this
 * library's additions.
 */
export type DataTableInstance<TData extends RowData> = ReturnType<
  typeof useDataTable<TData>
>

/**
 * Widths as they will be rendered.
 *
 * TanStack stores whatever a drag produced and clamps only when the width is
 * read, so a pull past the minimum would persist as 0. Clamp on the way in.
 * Entries that merely restate the declared width are dropped: they carry no
 * information, and without them a press-and-release on a handle — which
 * commits the current width — changes nothing.
 *
 * Group ids are dropped too. TanStack's group resize snapshots
 * `header.getLeafHeaders()`, which includes the group header itself, and a
 * group has no width of its own — its width is its children's.
 */
function normaliseSizing(
  sizing: ColumnSizingState,
  table: { getColumn: (id: string) => (SizedColumn & { columns: unknown[] }) | undefined },
): ColumnSizingState {
  const next: ColumnSizingState = {}
  for (const [columnId, width] of Object.entries(sizing)) {
    const column = table.getColumn(columnId)
    if (!column || column.columns.length > 0 || !Number.isFinite(width)) continue
    const clamped = clampColumnWidth(column, width)
    if (clamped === column.columnDef.size) continue
    next[columnId] = clamped
  }
  return next
}

/**
 * TanStack's own default row id, restated.
 *
 * {@link UseDataTableOptions.getRowId} becomes mandatory-in-effect once a
 * grouped page can arrive, because a group row needs an id of its own — so
 * this hook supplies a `getRowId` whether the host did or not. Restating the
 * default here is what keeps a table that never passed one on exactly the ids
 * it had: `table_getRowId` in `@tanstack/table-core` falls back to the same
 * expression.
 *
 * @param index - The row's index within its parent, or within `data`.
 * @param parent - The parent row, for tree data.
 * @returns The id TanStack would have minted.
 */
function defaultRowId(index: number, parent?: { id: string }): string {
  return parent ? `${parent.id}.${index}` : String(index)
}

interface ColumnDefShape {
  id?: string
  accessorKey?: unknown
  header?: unknown
  size?: number
  columns?: readonly ColumnDefShape[]
}

/**
 * A leaf column's declared width, by id.
 *
 * Read off the definitions rather than off the table, because the one caller
 * runs before `useTable` does — the derived `columnSizing` is an INPUT to it.
 * Ids are derived with {@link deriveColumnId}, the same way `leafIdsOf` does,
 * so a column declared with an `accessorKey` and no `id` is found.
 *
 * @param columns - Column definitions, possibly nested.
 * @param columnId - The leaf being looked up.
 * @returns Its `size`, or `undefined` when it declares none or is not there.
 */
function declaredLeafSize(
  columns: readonly ColumnDefShape[],
  columnId: string,
): number | undefined {
  for (const [index, column] of columns.entries()) {
    if (column.columns?.length) {
      const nested = declaredLeafSize(column.columns, columnId)
      if (nested !== undefined) return nested
      continue
    }
    if (deriveColumnId(column, index) === columnId) return column.size
  }
  return undefined
}

/** The column-definition element the public `columns` option carries. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TableColumnDef<TData extends RowData> = ColumnDef<DataTableFeatures, TData, any>

/**
 * A group definition's children, or undefined for a leaf.
 *
 * `ColumnDef` is a union and only its group member declares `columns`, so the
 * property cannot be read off the union directly; `in` is the narrowing the
 * union supports.
 *
 * @param def - Any column definition.
 * @returns Its children, or undefined when it has none.
 */
function childDefs<TData extends RowData>(
  def: TableColumnDef<TData>,
): readonly TableColumnDef<TData>[] | undefined {
  return "columns" in def ? def.columns : undefined
}

/**
 * The definitions a grouped table is built from: the group column pulled out
 * of its column group and put first.
 *
 * The other half of "the group column leads the table", and the half that
 * cannot be done with state. A column's place in the header tree is
 * structural, so a derived `columnOrder` alone would move the leaf and leave
 * its group header behind — TanStack draws one header per RUN of adjacent
 * leaves sharing a parent, so a `Payment` group would be drawn twice: once
 * over the group column at the left edge and once over what it left behind.
 * One name, two headers, and no way for a user to tell which is which.
 *
 * And while a table is grouped the column genuinely is not a member of that
 * group any more: it is holding a tree of values from every level, not the
 * payment half of a receipt. Hoisting it says so — it gets a full-height
 * header of its own, the way a column declared outside every group does, and
 * the group it left shrinks to what is still in it.
 *
 * The definition itself is otherwise untouched, which is what keeps the
 * header, the sort control, the filter and the declared width it already had.
 * An explicit `id` is written onto the copy so the hoist cannot change what
 * the column is called: an id TanStack derives from a definition's position
 * would move with it.
 *
 * A group left with no children is dropped, since a header spanning nothing
 * has nothing to span.
 *
 * @param columns - The host's definitions, untouched.
 * @param columnId - The leaf to hoist.
 * @returns A new top-level array — a copy of `columns` when the leaf is
 *   already at the top level and there is nothing structural to do.
 */
function hoistGroupColumn<TData extends RowData>(
  columns: readonly TableColumnDef<TData>[],
  columnId: string,
): TableColumnDef<TData>[] {
  const taken = takeLeafDef(columns, columnId)
  if (taken === null) return [...columns]
  return [{ ...taken.def, id: columnId }, ...taken.rest]
}

/** What {@link takeLeafDef} found: the leaf, and everything else. */
interface TakenLeaf<TData extends RowData> {
  def: TableColumnDef<TData>
  rest: TableColumnDef<TData>[]
}

/**
 * Remove one leaf from a definition tree, keeping a copy of it.
 *
 * @param columns - Definitions to search, possibly nested.
 * @param columnId - The leaf to take.
 * @param parentId - The group this level sits under; omitted at the top.
 * @returns The leaf and the tree without it, or null when the leaf is not
 *   nested inside a group — at the top level there is nothing to hoist it out
 *   of, and its position is the derived order's business alone.
 */
function takeLeafDef<TData extends RowData>(
  columns: readonly TableColumnDef<TData>[],
  columnId: string,
  parentId?: string,
): TakenLeaf<TData> | null {
  for (const [index, def] of columns.entries()) {
    const children = childDefs(def)
    const id = deriveColumnId(def, index)

    if (children?.length) {
      const taken = takeLeafDef(children, columnId, id)
      if (taken === null) continue
      const rest = [...columns]
      // A group emptied by the hoist goes with it; otherwise it keeps its own
      // definition and loses one child.
      const remaining: TableColumnDef<TData>[] = taken.rest
      rest.splice(index, 1, ...(remaining.length ? [{ ...def, columns: remaining }] : []))
      return { def: taken.def, rest }
    }

    if (id !== columnId) continue
    // A top-level leaf is in no group, so there is nothing structural to undo.
    if (parentId === undefined) return null
    return { def, rest: columns.filter((_, at) => at !== index) }
  }
  return null
}
