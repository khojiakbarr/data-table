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
import { useCallback, useMemo, useRef, useState } from "react"
import { noLayoutStorage } from "./core/persistence"
import type { TableQuery } from "./core/query"
import { clampColumnWidth, type ColumnBounds, type SizedColumn } from "./core/sizing"
import { apply, useArrangement } from "./core/useArrangement"
import { useIsomorphicLayoutEffect } from "./core/useIsomorphicLayoutEffect"
import { usePagination, type PaginationApi } from "./core/usePagination"
import { useTableQuery } from "./core/useTableQuery"
import { warnOnce } from "./core/warnOnce"
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
  /**
   * Height for particular rows, known ahead of render.
   *
   * A pure function of its row. The identity may change freely — an inline
   * arrow is fine, and costs nothing — but what it answers for a given row
   * must not depend on anything the table cannot see. A policy that starts
   * answering differently (a density toggle, say) is noticed from the rows on
   * screen and corrected on the next frame.
   */
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

  const {
    layout,
    isCustomised,
    updateSlice,
    resetLayout: resetArrangement,
  } = useArrangement({
    id,
    store,
    initialLayout,
    columnIds,
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
   * Which rows are open is deliberately NOT part of the layout: it is a
   * transient reading position, not an arrangement the user chose to keep, and
   * restoring it on the next visit would be surprising.
   */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

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
    rowId: getRowId !== undefined,
    subRows: getSubRows !== undefined,
    totals: isServer,
  }

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

  const paginationApi: PaginationApi = useMemo(
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
    }),
    [pageState, isServer, rowCount, clientRowCount],
  )

  const query = useTableQuery({
    sorting: layout.sorting,
    pageIndex: pageState.pageIndex,
    pageSize: pageState.pageSize,
    onQueryChange,
  })

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
