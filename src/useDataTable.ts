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
  type ColumnSizingState,
  type RowData,
  type Updater,
} from "@tanstack/react-table"
import { useCallback, useMemo, useRef, useState } from "react"
import { noLayoutStorage, pruneLayout } from "./core/persistence"
import { clampColumnWidth, type ColumnBounds, type SizedColumn } from "./core/sizing"
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
}

/** The layout plus what the table knows about where it came from. */
interface Arrangement {
  layout: TableLayout
  /** Differs from the declared layout, so a Reset control makes sense. */
  isCustomised: boolean
  /**
   * Changed by the user since mount, so worth writing. Distinct from
   * `isCustomised`: a layout read from storage is customised but has nothing
   * new to save, and re-saving it on mount is a pointless write — or a network
   * request, for a server-backed adapter.
   */
  hasUnsavedChanges: boolean
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

  // Read storage once per table id. Re-reading on every render would fight the
  // user: a change is saved, then immediately re-applied from disk.
  //
  // `columnOrder` starts empty rather than pre-seeded. TanStack reads it as
  // "natural order" when empty, and seeding it is how grouped tables break:
  // the ordering feature matches leaf ids, so a seeded list containing group
  // ids silently reorders every column that is not in it.
  const [arrangement, setArrangement] = useState<Arrangement>(() => {
    const stored = store.load(id)
    return {
      layout: { ...EMPTY_LAYOUT, ...initialLayout, ...pruneLayout(stored ?? {}, columnIds) },
      isCustomised: stored !== null,
      hasUnsavedChanges: false,
    }
  })
  const { layout, isCustomised, hasUnsavedChanges } = arrangement

  const initialRef = useRef(initialLayout)

  useDebouncedSave(store, id, layout, hasUnsavedChanges)

  /**
   * Record a change to one slice of the layout.
   *
   * A change that leaves the slice as it was is dropped: TanStack commits a
   * width on every mouseup, so a press-and-release on a resize handle would
   * otherwise mark the table as customised and write an identical layout.
   */
  const updateSlice = useCallback(
    <TKey extends keyof TableLayout>(
      key: TKey,
      updater: Updater<TableLayout[TKey]>,
      normalise: (slice: TableLayout[TKey]) => TableLayout[TKey] = (slice) => slice,
    ) => {
      setArrangement((previous) => {
        const next = normalise(apply(updater, previous.layout[key]))
        if (layoutSliceEqual(next, previous.layout[key])) return previous
        return {
          layout: { ...previous.layout, [key]: next },
          isCustomised: true,
          hasUnsavedChanges: true,
        }
      })
    },
    [],
  )

  const resetLayout = useCallback(() => {
    store.clear(id)
    setArrangement({
      layout: { ...EMPTY_LAYOUT, ...initialRef.current },
      isCustomised: false,
      hasUnsavedChanges: false,
    })
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
    /*
     * TanStack collapses everything whenever `data` changes identity. Callers
     * routinely pass a fresh array per render (`data: items.slice(0, 8)`), and
     * with the default a toggle click re-renders the host, which resets the
     * row it just opened. Expansion is this hook's own state; it decides.
     */
    autoResetExpanded: false,
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
    onSortingChange: (updater) => updateSlice("sorting", updater),
  })

  return { table, id, flags, bounds, resetLayout, isCustomised, expanded }
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
 * Structural equality for a layout slice.
 *
 * Slices are JSON-shaped — arrays of ids, maps of primitives, `{ id, desc }`
 * pairs — so a plain recursive comparison is exact, and it is what tells a
 * genuine change from TanStack rebuilding an identical array.
 */
function layoutSliceEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => layoutSliceEqual(item, b[index]))
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && layoutSliceEqual(a[key], b[key]))
    )
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
