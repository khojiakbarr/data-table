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
import { deriveColumnId } from "./core/columnIds"
import { filterFn_dt } from "./core/filterFn"
import { collectFilterKinds } from "./core/filterKinds"
import {
  pruneFilters,
  type FilterCondition,
  type FilterModel,
  type FilterValueOption,
} from "./core/filters"
import { noLayoutStorage } from "./core/persistence"
import type { TableQuery, TableSearch } from "./core/query"
import { collectSearchFields, filterFn_dtSearch } from "./core/search"
import { clampColumnWidth, type ColumnBounds, type SizedColumn } from "./core/sizing"
import { apply, layoutSliceEqual, useArrangement } from "./core/useArrangement"
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
  /** Columns quick search covers. Default: every visible searchable column. */
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
   */
  getRowId?: (row: TData, index: number, parent?: Row<DataTableFeatures, TData>) => string
  /**
   * Called with the initial query on mount and after every change to it.
   *
   * Explicitly `| undefined` under `exactOptionalPropertyTypes`: a host
   * usually forwards its own optional handler at the call site
   * (`onQueryChange={props.onQueryChange}`), and an optional property alone
   * would reject that.
   */
  onQueryChange?: ((query: TableQuery) => void) | undefined
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
  pagination,
  filtering,
  getRowId,
  onQueryChange,
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

  const filteringOptions: FilteringOptions | null =
    filtering === false ? null : filtering === true || filtering === undefined ? {} : filtering
  // A boolean rather than the object above, which is a fresh `{}` on every
  // render for the two shorthand forms and would break the memo below.
  const filteringEnabled = filteringOptions !== null

  /*
   * Resolved from the column definitions and the data rather than from the
   * table, which does not exist yet: a stored layout is pruned on the very
   * first render, and pruning is where a condition whose kind no longer
   * matches its column has to be dropped.
   */
  const filterKinds = useMemo(() => collectFilterKinds(columns, data), [columns, data])

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
      if (declaredOverride) return [...declaredOverride].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      const { fields, unresolved, excluded, declared } = collectSearchFields(columns, data, layout.columnVisibility)
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
  }, [filteringEnabled, filteringOptions?.searchFields, columns, data, layout.columnVisibility])

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
    data,
    columns,
    state: {
      columnOrder: layout.columnOrder,
      columnVisibility: layout.columnVisibility,
      columnPinning: layout.columnPinning,
      columnSizing: layout.columnSizing,
      sorting: layout.sorting,
      columnFilters,
      globalFilter: searchText,
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
    filters: layout.filters,
    search,
    pageIndex: pageState.pageIndex,
    pageSize: pageState.pageSize,
    onQueryChange,
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
  }, [updateFilters, updateSearch])
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
    },
    [updateFilters, updateSearch, columnIds, filterKinds],
  )

  const filteringApi = useMemo(
    () => ({
      enabled: filteringEnabled,
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
    [filteringEnabled, layout.filters, layout.search, setCondition, clearColumn, clearAll, updateSearch, setModel],
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
    resetLayout,
    isCustomised,
    expanded,
    mode,
    query,
    pagination: paginationApi,
    filtering: filteringApi,
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

interface ColumnDefShape {
  id?: string
  accessorKey?: unknown
  header?: unknown
  columns?: readonly ColumnDefShape[]
}

/**
 * Leaf column ids, in declaration order.
 *
 * Only leaves carry order, visibility, width and pinning, so a group's own id
 * must not appear — mixing them in makes TanStack drop every id it cannot match
 * and reshuffle the rest. Derives each id with {@link deriveColumnId}, the same
 * way TanStack's own `constructColumn` does, so stored layouts line up with
 * live columns.
 *
 * @param columns - Column definitions, possibly nested.
 * @returns Every leaf id, depth-first.
 */
function collectLeafIds(columns: readonly ColumnDefShape[]): string[] {
  return columns.flatMap((column, index) => {
    if (column.columns?.length) return collectLeafIds(column.columns)
    return [deriveColumnId(column, index)]
  })
}
