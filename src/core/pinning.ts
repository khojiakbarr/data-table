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
 * Built from the three pinning buckets, which is the only source that matches
 * the DOM. The obvious alternatives are both wrong:
 *
 * - `getVisibleLeafColumns()` returns declaration order, so it disagrees the
 *   moment anything is pinned.
 * - Flattening `getHeaderGroups()[0]` looks right until a column is pinned out
 *   of a group: the column then appears both in its pinned position and still
 *   under its original group header, so it is counted twice. That produced more
 *   `<col>` elements than there are cells, and every width after the duplicate
 *   landed on the wrong column — which reads as "I dragged this column's edge
 *   and a different one resized".
 *
 * @param table - The table instance.
 * @returns Visible leaf columns, left to right.
 */
export function renderedLeafColumns<TData extends RowData>(
  table: {
    getStartVisibleLeafColumns: () => Column<DataTableFeatures, TData, unknown>[]
    getCenterVisibleLeafColumns: () => Column<DataTableFeatures, TData, unknown>[]
    getEndVisibleLeafColumns: () => Column<DataTableFeatures, TData, unknown>[]
  },
): Column<DataTableFeatures, TData, unknown>[] {
  return [
    ...table.getStartVisibleLeafColumns(),
    ...table.getCenterVisibleLeafColumns(),
    ...table.getEndVisibleLeafColumns(),
  ]
}
