import { describe, expect, it } from "vitest"
import { moveColumn } from "./reorder"

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
