import type { Column, RowData } from "@tanstack/react-table"
import type { CSSProperties } from "react"
import type { DataTableFeatures } from "../useDataTable"

/**
 * Sticky placement for pinned columns.
 *
 * This is the one place where pinning and resizing meet, and where hand-rolled
 * tables usually break: a pinned column's offset is the sum of the widths of
 * every pinned column before it, and those widths change on every frame while
 * a resize handle is being dragged.
 *
 * TanStack already maintains that sum — `getStart()` and `getAfter()` read from
 * a single memoised table-level offset map, so the value is both correct and
 * O(1). Recomputing it here would be slower and would drift.
 */

/**
 * Inline styles that stick a column to the appropriate edge.
 *
 * @param column - The column being rendered.
 * @returns Positioning styles, or an empty object when the column is not
 *   pinned.
 *
 * @example
 * <td style={{ width: cell.column.getSize(), ...pinnedStyle(cell.column) }} />
 */
export function pinnedStyle<TData extends RowData>(
  column: Column<DataTableFeatures, TData, unknown>,
): CSSProperties {
  const pinned = column.getIsPinned()
  if (!pinned) return {}

  return pinned === "start"
    ? { insetInlineStart: column.getStart("start") }
    : { insetInlineEnd: column.getAfter("end") }
}

/**
 * Visible leaf columns in the order they are rendered.
 *
 * `table.getVisibleLeafColumns()` groups pinned columns first, which is not the
 * order the cells appear in — pinned cells keep their natural DOM position and
 * are stuck with `position: sticky`. Feeding that order to a `<colgroup>` hands
 * each column somebody else's width.
 *
 * The first header group covers every column in visual order, so flattening it
 * gives the order the DOM actually uses, and it works with zero rows.
 *
 * @param table - The table instance.
 * @returns Visible leaf columns, left to right.
 */
export function renderedLeafColumns<TData extends RowData>(
  table: {
    getHeaderGroups: () => { headers: { column: Column<DataTableFeatures, TData, unknown> }[] }[]
  },
): Column<DataTableFeatures, TData, unknown>[] {
  const first = table.getHeaderGroups()[0]
  if (!first) return []
  return first.headers
    .flatMap((header) => header.column.getLeafColumns())
    .filter((column) => column.getIsVisible())
}
