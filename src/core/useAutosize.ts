import type { Column, RowData } from "@tanstack/react-table"
import { useCallback, type RefObject } from "react"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import { measureColumnWidth, measureHeaderWidth } from "./autosize"
import { renderedLeafColumns } from "./pinning"
import { columnBounds } from "./sizing"

type AnyColumn<TData extends RowData> = Column<DataTableFeatures, TData, unknown>

export interface AutosizeActions {
  /** Fit one column to the content currently rendered. */
  autosize: (columnId: string) => void
  /** Fit every resizable column, in one state write. */
  autosizeAll: () => void
}

/**
 * "Fit to content" for a rendered table.
 *
 * The hook that builds the table has no DOM, and measuring needs one, so this
 * lives beside the shell and is exported for a shell of your own: give it the
 * instance and a ref to your `<table>` — whose cells must carry
 * `data-column-id`, as the built-in shell's do — and wire the actions to any
 * control you like.
 *
 * @param instance - From {@link useDataTable}.
 * @param tableRef - The rendered `<table>`.
 * @returns Stable `autosize` and `autosizeAll` callbacks.
 *
 * @example
 * const tableRef = useRef<HTMLTableElement>(null)
 * const { autosize } = useAutosize(instance, tableRef)
 * <button onClick={() => autosize("partner")}>Fit</button>
 */
export function useAutosize<TData extends RowData>(
  instance: DataTableInstance<TData>,
  tableRef: RefObject<HTMLTableElement | null>,
): AutosizeActions {
  const { table } = instance

  const autosize = useCallback(
    (columnId: string) => {
      const element = tableRef.current
      const column = table.getColumn(columnId)
      // A group has no width of its own; fit its leaves instead.
      if (!element || !column || column.columns.length > 0 || !column.getCanResize()) return
      const width = measureColumnWidth(element, columnId, columnBounds(column))
      if (width !== null) table.setColumnSizing((previous) => ({ ...previous, [columnId]: width }))
    },
    [table, tableRef],
  )

  const autosizeAll = useCallback(() => {
    const element = tableRef.current
    if (!element) return
    const sizes: Record<string, number> = {}
    for (const column of renderedLeafColumns(table)) {
      if (!column.getCanResize()) continue
      const width = measureColumnWidth(element, column.id, columnBounds(column))
      if (width !== null) sizes[column.id] = width
    }
    // One state write for the whole table rather than one per column.
    table.setColumnSizing((previous) => ({
      ...previous,
      ...widenGroupsToFitLabels(table.getAllColumns(), element, sizes),
    }))
  }, [table, tableRef])

  return { autosize, autosizeAll }
}

/**
 * Widen fitted leaves so that no group label above them is truncated.
 *
 * A group's rendered width is the sum of its children's, so fitting every leaf
 * to its own content can leave a long group label with too little room. The
 * deficit is spread evenly over the group's visible, resizable leaves, deepest
 * groups first so that an outer group sees its inner groups' final widths.
 *
 * @returns A new sizes map; the input is not modified.
 */
function widenGroupsToFitLabels<TData extends RowData>(
  columns: AnyColumn<TData>[],
  element: HTMLTableElement,
  sizes: Record<string, number>,
): Record<string, number> {
  const next = { ...sizes }
  const groups = collectGroups(columns).sort((a, b) => b.depth - a.depth)

  for (const group of groups) {
    const needed = measureHeaderWidth(element, group.id)
    if (needed === null) continue
    const leaves = group.getLeafColumns().filter((leaf) => leaf.getIsVisible())
    const resizable = leaves.filter((leaf) => leaf.getCanResize())
    if (resizable.length === 0) continue

    const current = leaves.reduce((sum, leaf) => sum + (next[leaf.id] ?? leaf.getSize()), 0)
    const deficit = needed - current
    if (deficit <= 0) continue

    const share = deficit / resizable.length
    for (const leaf of resizable) {
      const { max } = columnBounds(leaf)
      next[leaf.id] = Math.round(Math.min(max, (next[leaf.id] ?? leaf.getSize()) + share))
    }
  }

  return next
}

/** Every group column at any depth, in declaration order. */
function collectGroups<TData extends RowData>(columns: AnyColumn<TData>[]): AnyColumn<TData>[] {
  return columns.flatMap((column) =>
    column.columns.length > 0 ? [column, ...collectGroups(column.columns)] : [],
  )
}
