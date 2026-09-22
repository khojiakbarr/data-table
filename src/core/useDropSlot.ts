import { useEffect, useState } from "react"
import { dropAtIndex, dropSlotId, type DropSide } from "./reorder"

/**
 * The drag in progress, shared by the two surfaces that reorder columns.
 *
 * The header and the side panel's Columns tab are separate code paths — one
 * drags a `<th>`, the other a row of a list — and before this hook each kept
 * its own drag state and drew its own indicator, which is how they came to
 * disagree about what a drag looks like. The state and the resolution live
 * here once; each surface only decides which element the slot class goes on.
 */

/**
 * What is held while a column is in flight.
 *
 * Stored as "who is moving, and where was it last pointed" rather than as a
 * resolved slot id: the slot is derived again on every render from the order
 * as it stands, so a column that is hidden, pinned or reordered mid-drag
 * cannot leave a stale slot behind on an element that has moved.
 */
interface DropSlotDrag {
  draggedId: string
  /** Where the pointer — or the keyboard — last said the column should go. */
  target: { id: string; side: DropSide } | null
  /** A keyboard grab persists between key presses; a pointer drag does not. */
  keyboard: boolean
}

/**
 * The order a slot is resolved against.
 *
 * A plain array for a surface where every draggable thing sits in one list —
 * the Columns tab's leaves, the Row Groups zone's levels. A FUNCTION where the
 * list depends on what was picked up: the table header drags a leaf among its
 * group's children and a group header among the groups beside it, and those
 * are different orders with different steps. The function is called with the
 * column in flight, which is only known once the drag has started, so a caller
 * cannot compute it up front.
 */
export type DropSlotOrder = readonly string[] | ((draggedId: string) => readonly string[])

/** The drag state and the handlers a reordering surface drives it with. */
export interface DropSlot {
  /** The column in flight, or `null` when nothing is being dragged. */
  draggedId: string | null
  /** The column whose place the drop would take; the one that wears `.dt-drop-slot`. */
  slotId: string | null
  /** Where {@link slotId} sits in the order this hook was given; `-1` when there is no slot. */
  slotIndex: number
  /** Whether the current grab came from the keyboard rather than a pointer. */
  isKeyboardGrab: boolean
  /** Pick a column up. A keyboard grab shows its slot immediately, at its own place. */
  start: (draggedId: string, options?: { keyboard?: boolean }) => void
  /** The pointer is over `targetId`, nearest `side`. */
  over: (targetId: string, side: DropSide) => void
  /** Put the slot at a position, which is how the keyboard moves it. */
  moveTo: (index: number) => void
  /** The pointer has left `targetId`; ignored when the slot has already moved on. */
  leave: (targetId: string) => void
  /** The drag is over, however it ended — drop, Escape, or the pointer leaving the window. */
  end: () => void
  /** The move the current slot stands for, ready to hand to a reorder handler. */
  resolve: () => { draggedId: string; targetId: string; side: DropSide } | null
}

/**
 * Track a column drag and resolve the slot it would land in.
 *
 * @param order - Column ids in the order they are rendered, which is the order
 *   the slot is resolved against — or a function of the column in flight, for
 *   a surface whose order depends on what was picked up (see
 *   {@link DropSlotOrder}). Read on every call, so it may change between
 *   renders.
 * @returns The current drag and the handlers that drive it. See {@link DropSlot}.
 *
 * @example
 * const drop = useDropSlot(columns.map((column) => column.id))
 * <th
 *   className={drop.slotId === column.id ? "dt-drop-slot" : undefined}
 *   onDragStart={() => drop.start(column.id)}
 *   onDragEnd={drop.end}
 * />
 */
export function useDropSlot(order: DropSlotOrder): DropSlot {
  const [drag, setDrag] = useState<DropSlotDrag | null>(null)

  /*
   * A backstop for the case a `dragend` on the source element never arrives.
   *
   * `onDragEnd={drop.end}` on the dragged element is the ordinary way a drag
   * ends — a drop, Escape, and the pointer released outside the window all
   * fire it — but it depends on that element still being in the document when
   * the browser goes to dispatch it. A drop that is itself the cause of the
   * dragged element's removal — grouping a column drops it into the Row
   * Groups zone, which hides or hoists that very header or panel row out of
   * the tree the state update this drop triggers — can unmount the source
   * before the browser gets there, and per the drag-and-drop spec a source no
   * longer in a document gets no `dragend` at all. Left alone, `draggedId`
   * and the dragging class it drives would survive indefinitely, clearing
   * only when some unrelated drag on the same surface happened to end.
   *
   * `document` is the fix rather than the element: it is an ancestor of
   * every possible drop target, including ones far outside this hook's own
   * surface — the table header, the Columns tab and the Row Groups zone each
   * run their own `useDropSlot`, and a header drag can be consumed by the
   * zone's `<li>`, in a different component entirely. `drop` and `dragend`
   * both bubble, and they bubble from the TARGET (or, for `dragend`, from a
   * source that is still attached) — an element that is still mounted at
   * the moment the browser dispatches the event, before the state change the
   * drop causes has had a chance to unmount anything — so by the time either
   * reaches `document` the bubbling itself is not at risk, only the source's
   * own listener was. Listening in the capture phase means no drop handler
   * added later, on this surface or another, can hide the event from this
   * hook with `stopPropagation()`.
   *
   * Scoped to `drag?.draggedId` rather than to every change of `drag`: `over`
   * and `moveTo` update `drag.target` on nearly every `dragover`, and
   * tearing this listener down and back up that often would be pure waste for
   * a pair of listeners that only ever need to exist once per drag.
   */
  useEffect(() => {
    if (drag === null) return
    const clear = () => setDrag(null)
    document.addEventListener("dragend", clear, { capture: true })
    document.addEventListener("drop", clear, { capture: true })
    return () => {
      document.removeEventListener("dragend", clear, { capture: true })
      document.removeEventListener("drop", clear, { capture: true })
    }
  }, [drag?.draggedId])

  /** The order this particular column is moving within. */
  const orderFor = (draggedId: string): readonly string[] =>
    typeof order === "function" ? order(draggedId) : order

  /*
   * A pointer drag shows no slot until the pointer is over a column it may
   * drop on — there is nothing to promise yet, and a slot under the original
   * position would read as "it will go back here". A keyboard grab is the
   * opposite: the column has been picked up deliberately and has not been
   * asked to go anywhere, so its own place is exactly where it would land.
   */
  const activeOrder = drag === null ? null : orderFor(drag.draggedId)
  const slotId =
    drag === null || activeOrder === null
      ? null
      : drag.target
        ? dropSlotId(activeOrder, drag.draggedId, drag.target.id, drag.target.side)
        : drag.keyboard && activeOrder.includes(drag.draggedId)
          ? drag.draggedId
          : null

  return {
    draggedId: drag?.draggedId ?? null,
    slotId,
    slotIndex: slotId === null || activeOrder === null ? -1 : activeOrder.indexOf(slotId),
    isKeyboardGrab: drag?.keyboard ?? false,

    start: (draggedId, options) =>
      setDrag({ draggedId, target: null, keyboard: options?.keyboard ?? false }),

    over: (targetId, side) =>
      setDrag((current) =>
        current === null ? null : { ...current, target: { id: targetId, side } },
      ),

    moveTo: (index) =>
      setDrag((current) => {
        if (current === null) return null
        const next = dropAtIndex(orderFor(current.draggedId), current.draggedId, index)
        // Past either end of the order there is no position to move to, so the
        // slot stays where it is rather than jumping to an edge.
        return next === null
          ? current
          : { ...current, target: { id: next.targetId, side: next.side } }
      }),

    leave: (targetId) =>
      setDrag((current) =>
        /*
         * Only the cell the slot is currently resolved against may take it
         * away. `dragleave` on the element just left can arrive after
         * `dragover` on the element just entered, and an unguarded clear
         * would then wipe a slot that the new cell had already set.
         */
        current === null || current.target?.id !== targetId
          ? current
          : { ...current, target: null },
      ),

    end: () => setDrag(null),

    resolve: () =>
      drag?.target
        ? { draggedId: drag.draggedId, targetId: drag.target.id, side: drag.target.side }
        : null,
  }
}
