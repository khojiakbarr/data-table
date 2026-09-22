import type { DragEvent, KeyboardEvent } from "react"
import type { DataTableLabels } from "../types"

/**
 * The grip a row of the Columns panel is picked up by.
 *
 * One component for both row kinds the tree draws. A leaf row and a group row
 * are different things to look at — one has a checkbox for itself, the other
 * speaks for everything under it — but they are the SAME thing to drag: a
 * column with an id, moving among its siblings. Writing the grip twice is how
 * the two surfaces came to disagree in the first place, one level down.
 */

export interface ColumnDragHandleProps {
  /**
   * The column this grip picks up: a leaf, or a whole column group.
   *
   * It is what goes into the `dataTransfer`, so it is what the row the drop
   * lands on will read back — the same id the drag surfaces identify rows by.
   */
  columnId: string
  /**
   * What this row is called, already in the form a screen reader should hear
   * it. A group's name arrives as {@link DataTableLabels.columnGroup} has
   * phrased it, so "Document" the group and "Document" the column are told
   * apart.
   */
  name: string
  labels: DataTableLabels
  /** Whether a keyboard grab is currently holding this column. */
  held: boolean
  /** Space, the arrows and Escape; the whole keyboard reorder path. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  /** The column has been picked up. The `dataTransfer` is already filled. */
  onDragStart: () => void
  /** The drag is over, however it ended. */
  onDragEnd: () => void
}

/**
 * The drag grip, and the keyboard's only route to reordering.
 *
 * @param props - See {@link ColumnDragHandleProps}.
 * @returns A focusable grip that starts a drag and takes the reorder keys.
 *
 * @example
 * <ColumnDragHandle columnId="amount" name="Amount" labels={labels} held={false} … />
 */
export function ColumnDragHandle({
  columnId,
  name,
  labels,
  held,
  onKeyDown,
  onDragStart,
  onDragEnd,
}: ColumnDragHandleProps) {
  return (
    <span
      className="dt-drag-handle"
      draggable
      role="button"
      /*
       * In the Tab order, unlike the decorative grip it used to be: this is
       * the whole keyboard route to reordering, and the instructions ride on
       * the label because there is nowhere else a screen reader would find
       * them in time.
       */
      tabIndex={0}
      aria-pressed={held}
      aria-label={`${name}: ${labels.dragHint}. ${labels.reorderHint}`}
      title={labels.dragHint}
      onKeyDown={onKeyDown}
      onDragStart={(event: DragEvent<HTMLElement>) => {
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", columnId)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
    >
      <GripIcon />
    </span>
  )
}

function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" fill="currentColor">
      {[2, 7, 12].map((y) =>
        [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />),
      )}
    </svg>
  )
}
