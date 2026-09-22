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
  // One column is a run of one. Expressed in terms of {@link moveRun} rather
  // than beside it: a group drag and a leaf drag land in the same places
  // because they are literally the same arithmetic, not two copies of it.
  return moveRun(order, [draggedId], [targetId], side)
}

/**
 * Where each of a set of ids sits in an order.
 *
 * @param order - The order to look them up in.
 * @param ids - Distinct ids.
 * @returns Their positions, ascending, or `null` when the set is empty or one
 *   of them is not in this order at all.
 */
function positionsOf(order: readonly string[], ids: readonly string[]): number[] | null {
  if (ids.length === 0) return null
  const positions: number[] = []
  for (const id of ids) {
    const index = order.indexOf(id)
    if (index === -1) return null
    positions.push(index)
  }
  return positions.sort((a, b) => a - b)
}

/**
 * Move a whole run of columns next to another run.
 *
 * What a column GROUP is, to an order that only knows leaves: a group header
 * stands over a run of leaf ids, and dragging it moves that run — every leaf,
 * in the order it already had — to one side of the target's run. A leaf
 * dragged onto a group is the same move with a run of one, which is why the
 * group is never landed *inside*: the destination is a gap at one END of the
 * target's run, never a position within it.
 *
 * The run is a SET of ids and not a slice, because the two orders this is
 * applied to do not always hold a group's leaves side by side. A grouped
 * table lifts the column holding the group values to the front of its
 * section, and that lift is a view of the stored order rather than a change
 * to it — so a group the user sees as three columns in a row can be, in the
 * array being rewritten, three ids with the hoisted one still sitting between
 * two of them. Demanding a contiguous slice refused exactly that move, and
 * refused it after the header had already drawn the slot for it. Gathering
 * the ids instead closes the gap the lifted column left, which is the same
 * arrangement read back.
 *
 * Both runs still have to exist in `order`, and they may not overlap: a
 * column dropped on itself, or a leaf dropped on the group it belongs to,
 * names no gap to move to.
 *
 * @param order - Current order. Not modified.
 * @param moved - The ids being moved, in any order.
 * @param target - The ids being dropped onto, likewise.
 * @param side - Whether the drop was on the target run's leading or trailing edge.
 * @returns A new order, or the original array's contents when nothing moves.
 *
 * @example
 * moveRun(["a", "b", "c", "d"], ["a", "b"], ["d"], "end") // ["c", "d", "a", "b"]
 */
export function moveRun(
  order: readonly string[],
  moved: readonly string[],
  target: readonly string[],
  side: DropSide,
): string[] {
  const from = positionsOf(order, moved)
  const to = positionsOf(order, target)
  if (from === null || to === null) return [...order]

  const lifted = new Set(from)
  if (to.some((index) => lifted.has(index))) return [...order]

  // The gap the caret sits in, expressed against the ORIGINAL array: the far
  // edge of the target's run, whatever else happens to lie inside it.
  const gap = side === "start" ? (to[0] as number) : (to[to.length - 1] as number) + 1

  // Taking the run out shifts every later index down by however many of it
  // stood before the gap, so the destination has to be corrected before the
  // insert — the step the `splice(to, 0, ...splice(from, 1))` idiom skips.
  const insertAt = gap - from.filter((index) => index < gap).length

  const block = order.filter((_, index) => lifted.has(index))
  const rest = order.filter((_, index) => !lifted.has(index))
  return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)]
}

/**
 * The column whose place a drop would take.
 *
 * The drag affordance is a slot, not a seam: the element that currently sits
 * at the index the dragged column will land on is the one that wears the slot,
 * so a user sees the place the column is going rather than the gap it falls
 * through. Deriving that index from {@link moveColumn} — the very function the
 * drop itself runs — is what keeps preview and outcome from drifting apart. A
 * slot computed from the caret's side alone would be a second implementation
 * of the same arithmetic, free to disagree with the first.
 *
 * Nothing has moved yet while the slot is on screen, so the post-move index is
 * read back against the order as it stands now.
 *
 * @param order - The order as currently rendered. Not modified.
 * @param draggedId - The column in flight.
 * @param targetId - The column the pointer is over.
 * @param side - Which edge of the target the pointer is nearest.
 * @returns The id of the column standing at the destination, or `null` when
 *   either id is not in this order.
 *
 * @example
 * // "a" lands at index 2, where "c" stands today.
 * dropSlotId(["a", "b", "c", "d"], "a", "c", "end") // "c"
 */
export function dropSlotId(
  order: readonly string[],
  draggedId: string,
  targetId: string,
  side: DropSide,
): string | null {
  if (!order.includes(draggedId) || !order.includes(targetId)) return null
  const index = moveColumn(order, draggedId, targetId, side).indexOf(draggedId)
  return order[index] ?? null
}

/**
 * The drop that lands `draggedId` at `index` — what a keyboard says with a
 * position and a pointer says with a target and an edge.
 *
 * Translating rather than adding a second move function keeps the keyboard
 * path on exactly the code the pointer path is tested against, so both resolve
 * to the same slot and the same final order.
 *
 * @param order - The order as currently rendered. Not modified.
 * @param draggedId - The column being moved.
 * @param index - The position in `order` it should end up at.
 * @returns The equivalent target and edge, or `null` when the column or the
 *   index is not in this order.
 *
 * @example
 * dropAtIndex(["a", "b", "c"], "a", 2) // { targetId: "c", side: "end" }
 */
export function dropAtIndex(
  order: readonly string[],
  draggedId: string,
  index: number,
): { targetId: string; side: DropSide } | null {
  const from = order.indexOf(draggedId)
  const targetId = order[index]
  if (from === -1 || targetId === undefined) return null
  // Coming from the left the column lands after the target, from the right
  // before it. At `index === from` the two spellings mean the same thing —
  // "stay" — and `moveColumn` returns the order unchanged either way.
  return { targetId, side: index > from ? "end" : "start" }
}

/**
 * The run of positions a column may move within.
 *
 * Not every position in a list is reachable: a leaf column cannot leave its
 * group, and a pinned column keeps its section however the stored order
 * changes, so a move across either boundary is refused. A slot beyond the
 * boundary would promise a move that never happens — which is the one thing a
 * drop preview must never do — so the keyboard stops at the edge of the run
 * the column already sits in.
 *
 * Expressed over opaque region keys rather than over columns, so the rule can
 * be tested without a table and the caller decides what makes two positions
 * part of the same region.
 *
 * @param regions - The region each position belongs to, in order.
 * @param from - The position being moved.
 * @returns The first and last positions reachable from `from`, inclusive. Both
 *   are `from` itself when the position is outside the list.
 *
 * @example
 * reachableRange(["x", "x", "y", "y"], 0) // { first: 0, last: 1 }
 */
export function reachableRange(
  regions: readonly string[],
  from: number,
): { first: number; last: number } {
  const region = regions[from]
  if (region === undefined) return { first: from, last: from }

  let first = from
  while (first > 0 && regions[first - 1] === region) first -= 1
  let last = from
  while (last < regions.length - 1 && regions[last + 1] === region) last += 1
  return { first, last }
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

/**
 * Move a column to the front of an order.
 *
 * What a grouped table does to its group column, so the tree reads from the
 * left edge rather than from wherever that column happened to be declared.
 *
 * Leading the FLAT order is enough to lead the screen, and that is worth
 * saying because neither of the boundaries a user's own drag is refused at
 * applies to this move. A column group cannot be torn, because the group
 * column has already left its group — `hoistGroupColumn` takes it out of the
 * definitions, since a leaf leading the table from inside a group would have
 * that group's header drawn twice. And a pinning section cannot be crossed,
 * because the sections are rendered from `columnPinning` and not from this:
 * the pinned ids here are filtered out of the scrolling run, so where they sit
 * in this array says nothing. A pinned group column leads its own array
 * instead, by the same call.
 *
 * @param order - Column ids in some order. Not modified.
 * @param columnId - The column to put first.
 * @returns A new order; `order`'s contents unchanged when the column is not
 *   in it or is already first.
 *
 * @example
 * leadColumn(["a", "b", "d"], "d") // ["d", "a", "b"]
 */
export function leadColumn(order: readonly string[], columnId: string): string[] {
  const from = order.indexOf(columnId)
  if (from <= 0) return [...order]
  const next = [...order]
  next.splice(from, 1)
  next.unshift(columnId)
  return next
}

/**
 * The order columns render in when nothing has been reordered.
 *
 * TanStack renders `columnPinning.start`, then everything unpinned in
 * declaration order, then `columnPinning.end` — so "natural order" is not
 * declaration order the moment anything is pinned. A fallback that said
 * otherwise would scramble every column on the very first drag, which is the
 * bug this spelling exists to avoid.
 *
 * Computed from ids rather than read off the table because both callers need
 * it before the table has been built: the derived column order is an INPUT to
 * `useTable`, and the reorder handler must start from the order the user has,
 * not from the one the grouping derived on top of it.
 *
 * @param columnIds - Every leaf id, in declaration order, hidden ones included.
 * @param pinning - The pinning slice. Ids it names that are not leaves are
 *   ignored, the way TanStack ignores them.
 * @returns Every id in `columnIds`, pinned sections first and last.
 *
 * @example
 * pinnedFirstOrder(["a", "b", "c"], { start: ["c"], end: [] }) // ["c", "a", "b"]
 */
export function pinnedFirstOrder(
  columnIds: readonly string[],
  pinning: { start: readonly string[]; end: readonly string[] },
): string[] {
  const known = new Set(columnIds)
  const start = pinning.start.filter((id) => known.has(id))
  const pinned = new Set(start)
  // A column named on both sides is pinned to the start, which is how TanStack
  // resolves it too: `getStartLeafColumns` reaches it first.
  const end = pinning.end.filter((id) => known.has(id) && !pinned.has(id))
  for (const id of end) pinned.add(id)
  return [...start, ...columnIds.filter((id) => !pinned.has(id)), ...end]
}
