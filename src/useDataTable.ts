import {
  columnOrderingFeature,
  createExpandedRowModel,
  rowExpandingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createCoreRowModel,
  createSortedRowModel,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table"
import { useCallback, useMemo, useRef, useState } from "react"
import { noLayoutStorage, pruneLayout } from "./core/persistence"
import { useDebouncedSave } from "./core/useDebouncedSave"
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
  coreRowModel: createCoreRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns,
})

export type DataTableFeatures = typeof FEATURES

const EMPTY_LAYOUT: TableLayout = {
  columnOrder: [],
  columnVisibility: {},
  columnPinning: { start: [], end: [] },
  columnSizing: {},
  sorting: [],
}

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
  getSubRows,
  canExpand,
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

  // Read storage once per table id. Re-reading on every render would fight the
  // user: a change is saved, then immediately re-applied from disk.
  //
  // `columnOrder` starts empty rather than pre-seeded. TanStack reads it as
  // "natural order" when empty, and seeding it is how grouped tables break:
  // the ordering feature matches leaf ids, so a seeded list containing group
  // ids silently reorders every column that is not in it.
  const [layout, setLayout] = useState<TableLayout>(() => ({
    ...EMPTY_LAYOUT,
    ...initialLayout,
    ...pruneLayout(store.load(id) ?? {}, columnIds),
  }))

  const initialRef = useRef(initialLayout)
  const [isCustomised, setIsCustomised] = useState(() => store.load(id) !== null)

  useDebouncedSave(store, id, layout, isCustomised)

  /** Record a layout change and mark the table as arranged by its user. */
  const updateLayout = useCallback((patch: (previous: TableLayout) => TableLayout) => {
    setIsCustomised(true)
    setLayout(patch)
  }, [])

  const resetLayout = useCallback(() => {
    store.clear(id)
    setIsCustomised(false)
    setLayout({ ...EMPTY_LAYOUT, ...initialRef.current })
  }, [store, id])

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
    state: { ...layout, expanded },
    ...(getSubRows ? { getSubRows } : {}),
    /*
     * Every row is expandable as far as TanStack is concerned. Whether a
     * toggle actually appears is decided where it is rendered — a row shows one
     * when it has children or when the table was given a detail renderer — and
     * the hook cannot see the latter. Leaving the default in place instead
     * would make `toggleExpanded()` a no-op for detail panels.
     */
    getRowCanExpand: canExpand ? (row) => canExpand(row.original) : () => true,
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
    onColumnOrderChange: (updater) =>
      updateLayout((prev) => ({ ...prev, columnOrder: apply(updater, prev.columnOrder) })),
    onColumnVisibilityChange: (updater) =>
      updateLayout((prev) => ({
        ...prev,
        columnVisibility: apply(updater, prev.columnVisibility),
      })),
    onColumnPinningChange: (updater) =>
      updateLayout((prev) => ({ ...prev, columnPinning: apply(updater, prev.columnPinning) })),
    onColumnSizingChange: (updater) =>
      updateLayout((prev) => ({ ...prev, columnSizing: apply(updater, prev.columnSizing) })),
    onSortingChange: (updater) =>
      updateLayout((prev) => ({ ...prev, sorting: apply(updater, prev.sorting) })),
  })

  return { table, id, flags, resetLayout, isCustomised, expanded }
}

/**
 * Everything {@link useDataTable} returns: the TanStack instance plus this
 * library's additions.
 */
export type DataTableInstance<TData extends RowData> = ReturnType<
  typeof useDataTable<TData>
>

/** TanStack state setters accept a value or an updater function. */
function apply<T>(updater: T | ((old: T) => T), current: T): T {
  return typeof updater === "function" ? (updater as (old: T) => T)(current) : updater
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
