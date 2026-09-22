import type { Column, ColumnPinningPosition, RowData } from "@tanstack/react-table"
import type { DataTableFeatures } from "../useDataTable"
import { isRowNumberColumn } from "./rowNumbers"

/**
 * The prefix a region nobody can share is spelled with.
 *
 * An ordinary region key is a parent group's id, a pipe, and one of `start`,
 * `end` or `center` — so it can begin with a pipe (a top-level column has no
 * parent) but never with two, because a pinning side is never empty. Every
 * solitary region starts with two, which is what makes {@link isMovableRegion}
 * a question about the key rather than a second list of special cases.
 */
const SOLITARY_PREFIX = "||"

/**
 * The region the group column is alone in, so nothing may be dropped on it and
 * it may be dropped nowhere.
 */
const GROUP_COLUMN_REGION = `${SOLITARY_PREFIX}group-column`

/**
 * The region the row-number column is alone in.
 *
 * It is pinned to the start, so without this it would share `"|start"` with
 * every other start-pinned column and could be swapped with them — a move
 * that the shell would then refuse (the column is not one of the host's
 * declarations, so `declaredLeafIds` answers null for it) after the header
 * had already drawn the slot for it. Its place is not the user's to set at
 * all: it leads the table because the `rowNumbers` flag put it there.
 */
const ROW_NUMBER_COLUMN_REGION = `${SOLITARY_PREFIX}row-number`

/**
 * A group whose leaves straddle a pinning boundary: alone in a region of its
 * own, one per column so two such groups cannot pair up with each other.
 *
 * TanStack draws such a group twice, once over the pinned leaves and once over
 * the rest, and neither header is the group: moving it would have to carry
 * leaves out of the section the user froze them in. There is no honest place
 * for it to go, so it goes nowhere.
 */
const splitGroupRegion = (columnId: string): string => `${SOLITARY_PREFIX}split|${columnId}`

/**
 * How a column is pinned, for a column that may be a whole group.
 *
 * `column.getIsPinned()` answers "start" as soon as ANY leaf under a group is
 * pinned, which is the wrong answer for a boundary question: it would put a
 * group with one frozen leaf in the same region as the genuinely pinned
 * columns and let it be dropped among them.
 *
 * @param column - Any column, leaf or group.
 * @returns The side every leaf shares, `"center"` when none is pinned, or
 *   `null` when the leaves disagree.
 */
function pinnedSideOf<TData extends RowData>(
  column: Column<DataTableFeatures, TData, unknown>,
): ColumnPinningPosition | "center" | null {
  if (column.columns.length === 0) return column.getIsPinned() || "center"
  const leaves = column.getLeafColumns()
  const side = leaves[0]?.getIsPinned() ?? false
  if (leaves.some((leaf) => leaf.getIsPinned() !== side)) return null
  return side || "center"
}

/**
 * Which run of the order a column may be moved within.
 *
 * Three boundaries are impassable, and for the same reason: a move that
 * crossed one would be carried out wrongly rather than as promised. A column
 * cannot leave its group — moving a leaf out would tear the group's header
 * apart, and moving a GROUP into another one would nest it somewhere the
 * column definitions never put it. A pinned column keeps its section however
 * the stored order changes, so a move into another section would simply not
 * show. And the group column's place is not the user's to set at all: while
 * the table is grouped it leads its own section, derived from the grouping, so
 * a drop that appeared to move it would be undone on the very next render.
 *
 * A group header is a draggable thing in its own right, and it drags among its
 * SIBLINGS: the key it gets is its own parent's, not its children's, so a
 * group and the leaves inside it are never in the same region and neither can
 * be dropped on the other. That one line is the whole rule for groups —
 * "a group moves among its siblings at its own level" is what `parent?.id`
 * already says for a leaf, said again one level up.
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
 * @param column - Any column: a leaf, or a group that stands over leaves.
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
  if (isRowNumberColumn(column.id)) return ROW_NUMBER_COLUMN_REGION
  if (groupColumnId !== undefined && column.id === groupColumnId) return GROUP_COLUMN_REGION
  const pinned = pinnedSideOf(column)
  if (pinned === null) return splitGroupRegion(column.id)
  return `${column.parent?.id ?? ""}|${pinned}`
}

/**
 * Whether a region has anyone else in it, ever.
 *
 * A column alone in its region cannot be dropped anywhere and nothing can be
 * dropped on it, so it must not be offered as draggable either — a grab cursor
 * on something that can never land is the same broken promise as a slot that
 * does not deliver, made one step earlier.
 *
 * @param region - A key from {@link dropRegionOf}.
 * @returns False for the row-number column, for the group column, and for a
 *   group split by pinning.
 *
 * @example
 * const canDrag = flags.reordering && isMovableRegion(dropRegionOf(column, groupId))
 */
export function isMovableRegion(region: string): boolean {
  return !region.startsWith(SOLITARY_PREFIX)
}
