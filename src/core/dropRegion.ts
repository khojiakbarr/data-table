import type { Column, RowData } from "@tanstack/react-table"
import type { DataTableFeatures } from "../useDataTable"

/**
 * The region the group column is alone in, so nothing may be dropped on it and
 * it may be dropped nowhere.
 *
 * Spelled so that no ordinary region can equal it: a region key is a parent
 * group's id, a pipe, and one of `start`, `end` or `center`, so a key ending
 * in `group-column` would need a pinning side by that name.
 */
const GROUP_COLUMN_REGION = "||group-column"

/**
 * Which run of the order a column may be moved within.
 *
 * Three boundaries are impassable, and for the same reason: a move that
 * crossed one would be carried out wrongly rather than as promised. A leaf
 * cannot leave its group — moving it would tear the group's header apart. A
 * pinned column keeps its section however the stored order changes, so a move
 * into another section would simply not show. And the group column's place is
 * not the user's to set at all: while the table is grouped it leads its own
 * section, derived from the grouping, so a drop that appeared to move it would
 * be undone on the very next render.
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
 * @param groupColumnId - The column holding the group values, or undefined
 *   when nothing is grouped. Required rather than optional: a surface that
 *   forgot to pass it would draw slots the shell then refuses, which is the
 *   exact defect this function exists to prevent.
 * @returns An opaque key; two columns may swap exactly when their keys match.
 *   Ready to hand to `reachableRange`, which works over such keys in order.
 *
 * @example
 * if (dropRegionOf(dragged, groupId) !== dropRegionOf(target, groupId)) return
 */
export function dropRegionOf<TData extends RowData>(
  column: Column<DataTableFeatures, TData, unknown>,
  groupColumnId: string | undefined,
): string {
  if (groupColumnId !== undefined && column.id === groupColumnId) return GROUP_COLUMN_REGION
  return `${column.parent?.id ?? ""}|${column.getIsPinned() || "center"}`
}
