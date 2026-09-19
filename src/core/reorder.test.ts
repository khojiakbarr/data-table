import { describe, expect, it } from "vitest"
import { dropAtIndex, dropSlotId, moveColumn, reachableRange } from "./reorder"

/**
 * Reordering is the feature that looks simplest and breaks most quietly.
 *
 * `splice(to, 0, ...splice(from, 1))` reads as an idiom but evaluates the inner
 * splice first, so every index at or after `from` has already shifted by the
 * time the outer one runs. The result is a move that lands one place too far in
 * one direction and correctly in the other — which is exactly the kind of bug a
 * person reports as "sometimes it works".
 */

const order = ["a", "b", "c", "d", "e"]

describe("moveColumn", () => {
  it("drops before the target when the caret is on its leading edge", () => {
    expect(moveColumn(order, "a", "c", "start")).toEqual(["b", "a", "c", "d", "e"])
  })

  it("drops after the target when the caret is on its trailing edge", () => {
    expect(moveColumn(order, "a", "c", "end")).toEqual(["b", "c", "a", "d", "e"])
  })

  it("moves leftwards before the target", () => {
    expect(moveColumn(order, "e", "b", "start")).toEqual(["a", "e", "b", "c", "d"])
  })

  it("moves leftwards after the target", () => {
    expect(moveColumn(order, "e", "b", "end")).toEqual(["a", "b", "e", "c", "d"])
  })

  it("treats the two edges of the same gap as one position", () => {
    // Dropping on b's trailing edge and on c's leading edge are the same gap.
    expect(moveColumn(order, "e", "b", "end")).toEqual(moveColumn(order, "e", "c", "start"))
  })

  it("leaves the order alone when a column is dropped on itself", () => {
    expect(moveColumn(order, "c", "c", "start")).toEqual(order)
    expect(moveColumn(order, "c", "c", "end")).toEqual(order)
  })

  it("leaves the order alone when the column would not move", () => {
    // b is already immediately after a.
    expect(moveColumn(order, "b", "a", "end")).toEqual(order)
  })

  it("ignores ids it does not know", () => {
    expect(moveColumn(order, "zz", "c", "start")).toEqual(order)
    expect(moveColumn(order, "a", "zz", "start")).toEqual(order)
  })

  it("does not mutate the array it was given", () => {
    const input = [...order]
    moveColumn(input, "a", "d", "end")
    expect(input).toEqual(order)
  })

  it("moves to the very start and to the very end", () => {
    expect(moveColumn(order, "c", "a", "start")).toEqual(["c", "a", "b", "d", "e"])
    expect(moveColumn(order, "c", "e", "end")).toEqual(["a", "b", "d", "e", "c"])
  })
})

/**
 * The slot is the whole promise a drag makes: "let go here and the column
 * lands there". A slot computed from the caret's side would be a second
 * implementation of the move, free to drift from the first; these tests pin
 * it to the move itself, and cover the three positions the design calls out —
 * past the last column, over the dragged column, and a target that does not
 * exist.
 */
describe("dropSlotId", () => {
  it("names the column standing where the dragged one will land", () => {
    // a -> after c gives [b, c, a, d, e]: index 2, where c stands today.
    expect(dropSlotId(order, "a", "c", "end")).toBe("c")
  })

  it("names the column the dragged one will land before", () => {
    // a -> before c gives [b, a, c, d, e]: index 1, where b stands today.
    expect(dropSlotId(order, "a", "c", "start")).toBe("b")
  })

  it("resolves a leftward move the same way", () => {
    // e -> before b gives [a, e, b, c, d]: index 1, where b stands today.
    expect(dropSlotId(order, "e", "b", "start")).toBe("b")
  })

  it("puts the slot on the last column when dragged past the end", () => {
    expect(dropSlotId(order, "a", "e", "end")).toBe("e")
  })

  it("puts the slot under the dragged column when it is dropped on itself", () => {
    // The honest answer for "no move" is the column's own place, not nothing:
    // a drag hovering over its own header has a destination, and it is here.
    expect(dropSlotId(order, "c", "c", "start")).toBe("c")
    expect(dropSlotId(order, "c", "c", "end")).toBe("c")
  })

  it("puts the slot under the dragged column when the move is a no-op", () => {
    // b is already immediately after a, so this drop changes nothing.
    expect(dropSlotId(order, "b", "a", "end")).toBe("b")
  })

  it("shows no slot for an id this order does not contain", () => {
    expect(dropSlotId(order, "zz", "c", "start")).toBeNull()
    expect(dropSlotId(order, "a", "zz", "start")).toBeNull()
  })

  it("agrees with moveColumn for every target and both edges", () => {
    // The invariant the whole affordance rests on: whatever the slot claims,
    // the move puts the column exactly there.
    for (const dragged of order) {
      for (const target of order) {
        for (const side of ["start", "end"] as const) {
          const slot = dropSlotId(order, dragged, target, side)
          const landedAt = moveColumn(order, dragged, target, side).indexOf(dragged)
          expect(order[landedAt]).toBe(slot)
        }
      }
    }
  })
})

describe("dropAtIndex", () => {
  it("lands the column at the index it was given, from either direction", () => {
    for (const dragged of order) {
      for (let index = 0; index < order.length; index += 1) {
        const move = dropAtIndex(order, dragged, index)
        expect(move).not.toBeNull()
        if (!move) continue
        const next = moveColumn(order, dragged, move.targetId, move.side)
        expect(next.indexOf(dragged)).toBe(index)
      }
    }
  })

  it("reads as the target's trailing edge going right and its leading edge going left", () => {
    expect(dropAtIndex(order, "a", 2)).toEqual({ targetId: "c", side: "end" })
    expect(dropAtIndex(order, "e", 2)).toEqual({ targetId: "c", side: "start" })
  })

  it("refuses a position or a column outside the order", () => {
    expect(dropAtIndex(order, "a", 5)).toBeNull()
    expect(dropAtIndex(order, "a", -1)).toBeNull()
    expect(dropAtIndex(order, "zz", 0)).toBeNull()
  })
})

describe("reachableRange", () => {
  // Two groups and a pinned column, as the panel keys them.
  const regions = ["pinned", "left", "left", "right", "right", "right"]

  it("stops at the edges of the run the position is in", () => {
    expect(reachableRange(regions, 1)).toEqual({ first: 1, last: 2 })
    expect(reachableRange(regions, 4)).toEqual({ first: 3, last: 5 })
  })

  it("leaves a lone position with nowhere to go", () => {
    expect(reachableRange(regions, 0)).toEqual({ first: 0, last: 0 })
  })

  it("answers with the position itself when it is off the end", () => {
    expect(reachableRange(regions, 9)).toEqual({ first: 9, last: 9 })
  })

  it("spans the whole list when every position is in one region", () => {
    expect(reachableRange(["x", "x", "x"], 1)).toEqual({ first: 0, last: 2 })
  })
})
