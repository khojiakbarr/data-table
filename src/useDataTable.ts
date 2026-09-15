import {
  columnOrderingFeature,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { noLayoutStorage, pruneLayout } from "./core/persistence"
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

  const columnIds = useMemo(
    () => columns.map((column, index) => resolveColumnId(column, index)),
    [columns],
  )

  // Read storage once per table id. Re-reading on every render would fight the
  // user: a change is saved, then immediately re-applied from disk.
  const [layout, setLayout] = useState<TableLayout>(() => ({
    ...EMPTY_LAYOUT,
    columnOrder: columnIds,
    ...initialLayout,
    ...pruneLayout(store.load(id) ?? {}, columnIds),
  }))

  const initialRef = useRef(initialLayout)
  const firstRender = useRef(true)

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    store.save(id, layout)
  }, [store, id, layout])

  const resetLayout = useCallback(() => {
    store.clear(id)
    setLayout({ ...EMPTY_LAYOUT, columnOrder: columnIds, ...initialRef.current })
  }, [store, id, columnIds])

  const isCustomised = useMemo(
    () => store.load(id) !== null,
    // `layout` is the trigger: the stored value changes as the user rearranges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, id, layout],
  )

  const table = useTable<DataTableFeatures, TData>({
    features: FEATURES,
    data,
    columns,
    state: layout,
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
      setLayout((prev) => ({ ...prev, columnOrder: apply(updater, prev.columnOrder) })),
    onColumnVisibilityChange: (updater) =>
      setLayout((prev) => ({
        ...prev,
        columnVisibility: apply(updater, prev.columnVisibility),
      })),
    onColumnPinningChange: (updater) =>
      setLayout((prev) => ({ ...prev, columnPinning: apply(updater, prev.columnPinning) })),
    onColumnSizingChange: (updater) =>
      setLayout((prev) => ({ ...prev, columnSizing: apply(updater, prev.columnSizing) })),
    onSortingChange: (updater) =>
      setLayout((prev) => ({ ...prev, sorting: apply(updater, prev.sorting) })),
  })

  return { table, id, flags, resetLayout, isCustomised }
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

/** Mirror TanStack's column id resolution so stored layouts line up. */
function resolveColumnId(column: { id?: string; accessorKey?: unknown }, index: number): string {
  if (typeof column.id === "string") return column.id
  if (typeof column.accessorKey === "string") return column.accessorKey
  return String(index)
}
