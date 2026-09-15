/**
 * Moving a column within an order.
 *
 * Kept as a pure function so the index arithmetic — the part that is easy to
 * get subtly wrong and impossible to see in a screenshot — can be tested on its
 * own, away from drag events and React state.
 */

/** Which edge of the target the caret was on when the column was dropped. */
export type DropSide = "start" | "end"

/**
 * Move `draggedId` next to `targetId`.
 *
 * @param order - Current column order. Not modified.
 * @param draggedId - The column being moved.
 * @param targetId - The column it was dropped on.
 * @param side - Whether it was dropped on the target's leading or trailing edge.
 * @returns A new order, or the original array's contents when nothing moves.
 *
 * @example
 * moveColumn(["a", "b", "c"], "a", "c", "end") // ["b", "c", "a"]
 */
export function moveColumn(
  order: readonly string[],
  draggedId: string,
  targetId: string,
  side: DropSide,
): string[] {
  const next = [...order]
  const from = next.indexOf(draggedId)
  const targetIndex = next.indexOf(targetId)

  if (from === -1 || targetIndex === -1 || draggedId === targetId) return next

  // The gap the caret sits in, expressed against the ORIGINAL array.
  const gap = side === "start" ? targetIndex : targetIndex + 1

  // Removing the dragged column shifts every later index down by one, so the
  // destination has to be corrected before the insert — this is the step the
  // `splice(to, 0, ...splice(from, 1))` idiom silently skips.
  const insertAt = from < gap ? gap - 1 : gap
  if (insertAt === from) return next

  const [moved] = next.splice(from, 1)
  next.splice(insertAt, 0, moved as string)
  return next
}

/**
 * Which half of an element a pointer is over.
 *
 * Read from the event at the moment it is needed rather than remembered in
 * state between `dragover` and `drop`: a state update queued by the last
 * `dragover` has not necessarily been applied by the time `drop` runs, so the
 * drop handler would read a stale side. In a browser many `dragover` events
 * fire and the state usually settles in time, which is what makes the failure
 * intermittent rather than obvious.
 *
 * @param clientX - Pointer position from the drag event.
 * @param rect - The target's bounding box.
 * @returns The edge the pointer is nearest.
 */
export function dropSideAt(
  clientX: number | undefined,
  rect: { left: number; width: number },
): DropSide {
  // A synthetic event may carry no coordinate. `NaN > x` is false, which would
  // silently pick "start"; saying so outright keeps the reason visible.
  if (!Number.isFinite(clientX) || rect.width === 0) return "start"
  return (clientX as number) - rect.left > rect.width / 2 ? "end" : "start"
}
