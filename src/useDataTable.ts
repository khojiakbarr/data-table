import {
  columnOrderingFeature,
  createExpandedRowModel,
  rowExpandingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createCoreRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnSizingState,
  type PaginationState,
  type Row,
  type RowData,
  type Updater,
} from "@tanstack/react-table"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { noLayoutStorage } from "./core/persistence"
import { buildQuery, queriesEqual, type TableQuery } from "./core/query"
import { clampColumnWidth, type ColumnBounds, type SizedColumn } from "./core/sizing"
import { apply, useArrangement } from "./core/useArrangement"
import { usePagination } from "./core/usePagination"
import type { DataTableFeatureFlags, LayoutStorage, TableLayout } from "./types"

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
  coreRowModel: createCoreRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns,
})

export type DataTableFeatures = typeof FEATURES

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
  data: TData[]
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
  /** Total rows across all pages. Server mode only; undefined until known. */
  rowCount?: number
  /**
   * Page the rows. Off by default in client mode, on in server mode. Pass
   * `true` for the defaults or an object to set the page size and choices.
   */
  pagination?: boolean | PaginationOptions
  /**
   * Stable identity for a row.
   *
   * In server mode rows come and go between pages; without an id, expansion
   * state belongs to positions instead of records.
   */
  getRowId?: (row: TData, index: number, parent?: Row<DataTableFeatures, TData>) => string
  /** Called with the initial query on mount and after every change to it. */
  onQueryChange?: (query: TableQuery) => void
  /** Pixel height of a data row. Default 40; also sets `--dt-row-height`. */
  rowHeight?: number
  /** Height for particular rows, known ahead of render. */
  getRowHeight?: (row: TData) => number
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
  pagination,
  getRowId,
  onQueryChange,
  rowHeight = 40,
  getRowHeight,
}: UseDataTableOptions<TData>) {
  const flags: Required<DataTableFeatureFlags> = useMemo(
    () => ({
      sorting: features?.sorting ?? true,
      resizing: features?.resizing ?? true,
      reordering: features?.reordering ?? true,
      pinning: features?.pinning ?? true,
      hiding: features?.hiding ?? true,
    }),
    [features],
  )

  const store = useMemo(() => storage ?? noLayoutStorage(), [storage])

  const columnIds = useMemo(() => collectLeafIds(columns), [columns])

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

  const { layout, isCustomised, updateSlice, resetLayout } = useArrangement({
    id,
    store,
    initialLayout,
    columnIds,
  })

  /*
   * Last render's client row count. The table has to be built before the count
   * exists, and `usePagination` runs before that, so a client-mode table can
   * only be clamped against what the previous render measured — which is
   * current by the time a user clicks anything. The shrink case that this
   * misses is corrected below, before paint.
   */
  const clientRowCountRef = useRef<number | undefined>(undefined)

  // Stable, so the memoised `pageState` below really is stable.
  const persistPageSize = useCallback(
    (size: number) => updateSlice("pageSize", size),
    [updateSlice],
  )

  const pageState = usePagination({
    enabled: paginationOptions !== null,
    pageSize: layout.pageSize ?? paginationOptions?.pageSize ?? DEFAULT_PAGE_SIZE,
    pageSizeOptions: paginationOptions?.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS,
    rowCount: isServer ? rowCount : clientRowCountRef.current,
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
   * Which rows are open is deliberately NOT part of the layout: it is a
   * transient reading position, not an arrangement the user chose to keep, and
   * restoring it on the next visit would be surprising.
   */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const table = useTable<DataTableFeatures, TData>({
    features: FEATURES,
    data,
    columns,
    state: {
      columnOrder: layout.columnOrder,
      columnVisibility: layout.columnVisibility,
      columnPinning: layout.columnPinning,
      columnSizing: layout.columnSizing,
      sorting: layout.sorting,
      pagination: { pageIndex: pageState.pageIndex, pageSize: pageState.pageSize },
      expanded,
    },
    ...(getRowId ? { getRowId } : {}),
    ...(getSubRows ? { getSubRows } : {}),
    /*
     * Every row is expandable as far as TanStack is concerned. Whether a
     * toggle actually appears is decided where it is rendered — a row shows one
     * when it has children or when the table was given a detail renderer — and
     * the hook cannot see the latter. Leaving the default in place instead
     * would make `toggleExpanded()` a no-op for detail panels.
     */
    getRowCanExpand: canExpand ? (row) => canExpand(row.original) : () => true,
    /*
     * TanStack collapses everything whenever `data` changes identity. Callers
     * routinely pass a fresh array per render (`data: items.slice(0, 8)`), and
     * with the default a toggle click re-renders the host, which resets the
     * row it just opened. Expansion is this hook's own state; it decides.
     */
    autoResetExpanded: false,
    manualSorting: isServer,
    manualPagination: isServer || paginationOptions === null,
    ...(isServer && rowCount !== undefined ? { rowCount } : {}),
    /*
     * Same reasoning as `autoResetExpanded`: TanStack would send the user back
     * to page one whenever `data` changes identity, which in server mode is
     * every response to the query that asked for page four.
     */
    autoResetPageIndex: false,
    onPaginationChange: (updater: Updater<PaginationState>) => {
      const next = apply(updater, { pageIndex: pageState.pageIndex, pageSize: pageState.pageSize })
      if (next.pageSize !== pageState.pageSize) pageState.setPageSize(next.pageSize)
      if (next.pageIndex !== pageState.pageIndex) pageState.setPageIndex(next.pageIndex)
    },
    onExpandedChange: (updater) =>
      setExpanded((prev) => apply(updater, prev) as Record<string, boolean>),
    defaultColumn: {
      size: defaultColumnWidth,
      minSize: minColumnWidth,
      maxSize: maxColumnWidth,
    },
    enableSorting: flags.sorting,
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
  })

  /*
   * In client mode the total is whatever survived filtering, which only the
   * table knows; in server mode it is `rowCount` and the table never sees the
   * other pages. Undefined when nothing is being paged.
   */
  const clientRowCount =
    paginationOptions !== null && !isServer
      ? table.getPrePaginatedRowModel().rows.length
      : undefined
  clientRowCountRef.current = clientRowCount

  // Client mode learns its row count only once the table is built. A user
  // action is clamped against last render's count, which is current by the
  // time they act; the one case that is not is the count falling below the
  // current page (data replaced, rows removed) — fix that before paint.
  useLayoutEffect(() => {
    if (isServer || clientRowCount === undefined) return
    const last = Math.max(1, Math.ceil(clientRowCount / pageState.pageSize)) - 1
    if (pageState.pageIndex > last) pageState.setPageIndex(last)
  })

  const paginationApi = useMemo(
    () => ({
      ...pageState,
      rowCount: isServer ? rowCount : clientRowCount,
      pageCount: isServer
        ? pageState.pageCount
        : clientRowCount === undefined
          ? 1
          : Math.max(1, Math.ceil(clientRowCount / pageState.pageSize)),
    }),
    [pageState, isServer, rowCount, clientRowCount],
  )

  /*
   * Read and written during render on purpose. The query is the host's fetch
   * key: a fresh object every render would refetch on every render, and an
   * effect that rebuilt it would hand out a stale query for one commit first.
   * Comparing structurally and keeping the previous object gives the host an
   * identity that changes exactly when the request would.
   */
  const queryInputs = {
    sorting: layout.sorting,
    pageIndex: pageState.pageIndex,
    pageSize: pageState.pageSize,
  }
  const queryRef = useRef<TableQuery>(buildQuery(queryInputs))
  const candidate = buildQuery(queryInputs)
  if (!queriesEqual(candidate, queryRef.current)) queryRef.current = candidate
  const query = queryRef.current

  // Kept in a ref so an inline `onQueryChange={(q) => …}` does not refire the
  // effect on every render; the query's own identity is the trigger.
  const onQueryChangeRef = useRef(onQueryChange)
  onQueryChangeRef.current = onQueryChange
  useEffect(() => {
    onQueryChangeRef.current?.(query)
  }, [query])

  if (import.meta.env.DEV && isServer && !getRowId) {
    warnOnce(
      `useDataTable("${id}"): mode "server" without getRowId keys rows by position; ` +
        `expansion will not follow records across pages.`,
    )
  }

  return {
    table,
    id,
    flags,
    bounds,
    resetLayout,
    isCustomised,
    expanded,
    mode,
    query,
    pagination: paginationApi,
    rowHeight,
    getRowHeight,
  }
}

const warned = new Set<string>()
/** Say a thing once per process; a hook re-runs every render. */
function warnOnce(message: string): void {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(message)
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

interface ColumnDefShape {
  id?: string
  accessorKey?: unknown
  columns?: readonly ColumnDefShape[]
}

/**
 * Leaf column ids, in declaration order.
 *
 * Only leaves carry order, visibility, width and pinning, so a group's own id
 * must not appear — mixing them in makes TanStack drop every id it cannot match
 * and reshuffle the rest. Mirrors TanStack's own id resolution so stored
 * layouts line up with live columns.
 *
 * @param columns - Column definitions, possibly nested.
 * @returns Every leaf id, depth-first.
 */
function collectLeafIds(columns: readonly ColumnDefShape[]): string[] {
  return columns.flatMap((column, index) => {
    if (column.columns?.length) return collectLeafIds(column.columns)
    if (typeof column.id === "string") return [column.id]
    if (typeof column.accessorKey === "string") return [column.accessorKey]
    return [String(index)]
  })
}
