import { describe, expect, it } from "vitest"
import { buildDisplayList, displayItemKey, spacerSizes } from "./virtualRows"

const row = (id: string) => ({ id })

describe("buildDisplayList", () => {
  it("lists rows, with a detail item after each open row", () => {
    const rows = [row("a"), row("b"), row("c")]
    const list = buildDisplayList(rows, (r) => r.id === "b")

    expect(list.map((item) => `${item.kind}:${item.row.id}`)).toEqual(["row:a", "row:b", "detail:b", "row:c"])
    expect(list.map((item) => item.position)).toEqual([0, 1, 1, 2])
  })

  it("gives every item a key that cannot collide", () => {
    const list = buildDisplayList([row("a")], () => true)
    expect(list.map(displayItemKey)).toEqual(["a", "a:detail"])
  })

  it("is empty for no rows", () => {
    expect(buildDisplayList([], () => true)).toEqual([])
  })
})

describe("spacerSizes", () => {
  it("is zero at both ends when nothing is virtualised", () => {
    expect(spacerSizes(undefined, undefined, 0, 0)).toEqual({ top: 0, bottom: 0 })
  })

  it("subtracts the header offset from item coordinates", () => {
    // Header is 38px; items start after it. Visible window: items at 400..840 of a 4000px body.
    expect(spacerSizes({ start: 438 }, { end: 878 }, 4000, 38)).toEqual({ top: 400, bottom: 3160 })
  })

  it("never goes negative when a coordinate lands inside the header", () => {
    expect(spacerSizes({ start: 10 }, { end: 100 }, 50, 38)).toEqual({ top: 0, bottom: 0 })
  })

  it("is zero at both ends when only one end is known", () => {
    expect(spacerSizes({ start: 438 }, undefined, 4000, 38)).toEqual({ top: 0, bottom: 0 })
    expect(spacerSizes(undefined, { end: 878 }, 4000, 38)).toEqual({ top: 0, bottom: 0 })
  })
})
