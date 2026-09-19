import { describe, expect, it } from "vitest"
import { clampTableHeight, minTableHeight, tableHeightStep } from "./tableHeight"

/**
 * Where a height drag lands.
 *
 * These are the decisions the grip is made of, kept out of the component so
 * they can be checked as arithmetic: jsdom lays nothing out, so a component
 * test can only ever confirm that these were consulted, never what they said.
 */

/** The default row height, and the one `useDataTable` falls back to. */
const ROW = 40

describe("the table's minimum height", () => {
  it("leaves room for the chrome and two rows", () => {
    // 130px of toolbar, header and footer, plus two 40px rows.
    expect(minTableHeight(ROW)).toBe(210)
  })

  it("grows with the row height, so a tall-rowed table still shows two rows", () => {
    expect(minTableHeight(80)).toBe(minTableHeight(ROW) + 2 * 40)
  })

  it("falls back to the default row height rather than collapsing on an unusable one", () => {
    // A host can pass any of these; each would otherwise make the minimum
    // either NaN or smaller than the chrome it exists to protect.
    for (const unusable of [0, -20, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(minTableHeight(unusable)).toBe(minTableHeight(ROW))
    }
  })
})

describe("what a drag of N pixels resolves to", () => {
  it("adds the distance dragged to the height it started at", () => {
    expect(clampTableHeight(400 + 120, ROW)).toBe(520)
    expect(clampTableHeight(400 - 120, ROW)).toBe(280)
  })

  it("stops at the minimum however far past it the pointer goes", () => {
    expect(clampTableHeight(400 - 1000, ROW)).toBe(210)
    expect(clampTableHeight(0, ROW)).toBe(210)
    expect(clampTableHeight(-4000, ROW)).toBe(210)
  })

  it("has no maximum: a table taller than the window is a layout the host chose", () => {
    expect(clampTableHeight(12_000, ROW)).toBe(12_000)
  })

  it("rounds, so a sub-pixel drag is not persisted as one", () => {
    expect(clampTableHeight(520.4, ROW)).toBe(520)
    expect(clampTableHeight(520.6, ROW)).toBe(521)
  })

  it("answers the minimum for a height that is not a number at all", () => {
    // A hand-edited storage entry, or a drag that started from an unmeasured
    // box; `height: NaN` on the root renders as no height at all.
    expect(clampTableHeight(Number.NaN, ROW)).toBe(210)
  })
})

describe("the keyboard step", () => {
  it("moves one row per press, so a press reveals exactly one more row", () => {
    expect(tableHeightStep(ROW, false)).toBe(40)
    expect(tableHeightStep(64, false)).toBe(64)
  })

  it("moves five rows with Shift held", () => {
    expect(tableHeightStep(ROW, true)).toBe(200)
  })
})
