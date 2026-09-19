import type { Column, RowData } from "@tanstack/react-table"
import type { DataTableFeatures } from "../useDataTable"

/**
 * Which run of the order a column may be moved within.
 *
 * Two boundaries are impassable, and for the same reason: a move that crosses
 * either would be carried out wrongly rather than as promised. A leaf cannot
 * leave its group — moving it would tear the group's header apart — and a
 * pinned column keeps its section however the stored order changes, so a move
 * into another section would simply not show.
 *
 * WITHIN a region the move is always real, which is what makes the boundary
 * the only thing this has to decide. A pinned column moving among its own
 * neighbours is carried out in `columnPinning`, the array its section is
 * rendered from, as well as in the flat order — see `reorderColumn`. Region
 * keys carry the pinned side for the boundary's sake, not because a pinned
 * column is frozen where it stands.
 *
 * Every surface that previews a move has to ask this question before it draws
 * anything: a slot outside the dragged column's own region would promise a move
 * that never happens, which is the one thing a drop preview must never do. It
 * lives here, once, because the header, the side panel and the shell's reorder
 * handler all have to answer it the same way — they did not, and the header
 * drew slots the shell then refused.
 *
 * @param column - Any leaf column.
 * @returns An opaque key; two columns may swap exactly when their keys match.
 *   Ready to hand to `reachableRange`, which works over such keys in order.
 *
 * @example
 * if (dropRegionOf(dragged) !== dropRegionOf(target)) return // no slot, no drop
 */
export function dropRegionOf<TData extends RowData>(
  column: Column<DataTableFeatures, TData, unknown>,
): string {
  return `${column.parent?.id ?? ""}|${column.getIsPinned() || "center"}`
}
