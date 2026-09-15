import type { Column, ColumnPinningPosition, Header, RowData } from "@tanstack/react-table"
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

type AnyColumn<TData extends RowData> = Column<DataTableFeatures, TData, unknown>
type AnyHeader<TData extends RowData> = Header<DataTableFeatures, TData, unknown>

/**
 * Inline styles that stick a leaf column to the appropriate edge.
 *
 * Widths are NOT set here: they belong in the `<colgroup>`, the only thing
 * `table-layout: fixed` consults. See {@link renderedLeafColumns}.
 *
 * @param column - The column being rendered.
 * @returns Positioning styles, or an empty object when the column is not
 *   pinned.
 *
 * @example
 * <td style={pinnedStyle(cell.column)} />
 */
export function pinnedStyle<TData extends RowData>(column: AnyColumn<TData>): CSSProperties {
  const pinned = column.getIsPinned()
  if (!pinned) return {}

  return pinned === "start"
    ? { insetInlineStart: column.getStart("start") }
    : { insetInlineEnd: column.getAfter("end") }
}

/** How a header, group headers included, is pinned. */
export interface HeaderPinning {
  side: ColumnPinningPosition
  /** Sticky offset; empty when not pinned. */
  style: CSSProperties
  /** Whether this header borders the scrolling columns, where the seam shadow goes. */
  isInnerEdge: boolean
}

const NOT_PINNED: HeaderPinning = { side: false, style: {}, isInnerEdge: false }

/**
 * Pinning for a header of any depth.
 *
 * A group column cannot simply be asked `getIsPinned()`: TanStack answers
 * "start" as soon as ANY leaf under it is pinned, and the offset map only
 * knows leaf ids, so `getStart()` on a group returns 0. Rendering a group from
 * those answers sticks its whole header at the left edge, on top of the
 * columns that are actually pinned.
 *
 * A header is pinned only when every leaf under it is pinned to the same edge
 * — which is always the case for the headers TanStack builds, because it
 * splits a group whose leaves straddle a pinning boundary into one header per
 * side. Its offset is that of its first (start) or last (end) leaf.
 *
 * @param header - Any header, leaf or group.
 * @returns Side, sticky style and whether it borders the unpinned columns.
 */
export function headerPinning<TData extends RowData>(header: AnyHeader<TData>): HeaderPinning {
  const leaves = leafColumnsOf(header)
  const first = leaves[0]
  const last = leaves[leaves.length - 1]
  if (!first || !last) return NOT_PINNED

  const side = first.getIsPinned()
  if (!side || leaves.some((leaf) => leaf.getIsPinned() !== side)) return NOT_PINNED

  const table = header.column.table
  if (side === "start") {
    const pinnedColumns = table.getStartVisibleLeafColumns()
    return {
      side,
      style: { insetInlineStart: first.getStart("start") },
      isInnerEdge: pinnedColumns[pinnedColumns.length - 1]?.id === last.id,
    }
  }

  return {
    side,
    style: { insetInlineEnd: last.getAfter("end") },
    isInnerEdge: table.getEndVisibleLeafColumns()[0]?.id === first.id,
  }
}

/**
 * The leaf columns a header stands over, in this header's own section.
 *
 * `header.getLeafHeaders()` is post-order and includes the header it was
 * called on, so for a group header its last entry is the group itself — which
 * has no offset, no width of its own and no place in a sizing map. Only
 * headers with nothing beneath them are real leaves.
 *
 * @param header - Any header, leaf or group.
 * @returns Its leaf columns, left to right.
 */
export function leafColumnsOf<TData extends RowData>(header: AnyHeader<TData>): AnyColumn<TData>[] {
  return header
    .getLeafHeaders()
    .filter((leaf) => leaf.subHeaders.length === 0)
    .map((leaf) => leaf.column)
}

interface PinnedBuckets<TData extends RowData> {
  getStartVisibleLeafColumns: () => AnyColumn<TData>[]
  getCenterVisibleLeafColumns: () => AnyColumn<TData>[]
  getEndVisibleLeafColumns: () => AnyColumn<TData>[]
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
  table: PinnedBuckets<TData>,
): AnyColumn<TData>[] {
  return [
    ...table.getStartVisibleLeafColumns(),
    ...table.getCenterVisibleLeafColumns(),
    ...table.getEndVisibleLeafColumns(),
  ]
}

/**
 * Where the filler column sits among the rendered columns.
 *
 * The table never stretches its columns to fill the container; leftover width
 * goes to a filler column instead, and the filler must sit BEFORE the
 * end-pinned columns so that those stay flush with the right edge — the way
 * AG Grid's right-pinned section does — rather than floating after the last
 * scrolling column.
 *
 * @param table - The table instance.
 * @returns The index at which to insert the filler into
 *   {@link renderedLeafColumns} (or a row's visible cells).
 */
export function fillerIndex<TData extends RowData>(table: PinnedBuckets<TData>): number {
  return table.getStartVisibleLeafColumns().length + table.getCenterVisibleLeafColumns().length
}
