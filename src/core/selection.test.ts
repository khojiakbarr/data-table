import { describe, expect, it } from "vitest"
import { buildQuery } from "./query"
import {
  ALL_MATCHING_SELECTION,
  EMPTY_SELECTION,
  isRowSelected,
  isSelectionEmpty,
  selectionCount,
  selectionScopeOf,
  withRow,
  type SelectionModel,
} from "./selection"
import { textCondition, type TextCondition } from "./filters"

/**
 * The selection model, as arithmetic.
 *
 * The component tests drive the same rules through checkboxes; these pin the
 * two the components cannot show cheaply — that neither mode converts into the
 * other however many rows are ticked, and that a count with no `rowCount`
 * behind it is undefined rather than a number.
 */

/** One canonical text condition, the way the editors build them. */
const contains = (field: string, value: string): TextCondition => {
  const condition = textCondition({ kind: "text", field, op: "contains", value })
  if (condition === null) throw new Error(`unbuildable fixture condition on ${field}`)
  return condition
}

/** The query everything below is relative to, with the one filter varied. */
const queryWith = (overrides: Partial<Parameters<typeof buildQuery>[0]> = {}) =>
  buildQuery({
    sorting: [],
    filters: [],
    search: null,
    grouping: [],
    expanded: [],
    pageIndex: 0,
    pageSize: 50,
    ...overrides,
  })

describe("what a selection is", () => {
  it("starts empty, and `all-matching` is never empty", () => {
    expect(isSelectionEmpty(EMPTY_SELECTION)).toBe(true)
    expect(isSelectionEmpty(ALL_MATCHING_SELECTION)).toBe(false)
    // Every visible row unticked is still "everything except these": the rows
    // it stands for are mostly rows the browser has never seen.
    expect(isSelectionEmpty({ mode: "all-matching", excluded: ["a", "b", "c"] })).toBe(false)
  })

  it("reads a row's tick from whichever list the mode carries", () => {
    expect(isRowSelected({ mode: "ids", ids: ["a"] }, "a")).toBe(true)
    expect(isRowSelected({ mode: "ids", ids: ["a"] }, "b")).toBe(false)
    expect(isRowSelected({ mode: "all-matching", excluded: ["a"] }, "a")).toBe(false)
    expect(isRowSelected({ mode: "all-matching", excluded: ["a"] }, "b")).toBe(true)
  })

  it("hands back the same object when a tick changed nothing", () => {
    // Identity is the contract: the hook holds this in state and publishes it
    // on change, so a new-but-equal object would announce a change that did
    // not happen — to React first, and then to the host.
    const model: SelectionModel = { mode: "ids", ids: ["a"] }
    expect(withRow(model, "a", true)).toBe(model)
    expect(withRow(model, "b", false)).toBe(model)
  })
})

describe("the two modes never convert", () => {
  it("unticking every visible row in `all-matching` leaves everything except them", () => {
    const page = ["r1", "r2", "r3"]
    const after = page.reduce<SelectionModel>(
      (model, rowId) => withRow(model, rowId, false),
      ALL_MATCHING_SELECTION,
    )
    expect(after.mode).toBe("all-matching")
    expect(after).toEqual({ mode: "all-matching", excluded: page })
    // Not nothing: 50 clicks must not silently discard a selection of 25 000.
    expect(isSelectionEmpty(after)).toBe(false)
    expect(selectionCount(after, 25_000)).toBe(24_997)
  })

  it("ticking rows one at a time never becomes `all-matching`", () => {
    const every = ["r1", "r2", "r3"]
    const after = every.reduce<SelectionModel>(
      (model, rowId) => withRow(model, rowId, true),
      EMPTY_SELECTION,
    )
    // Even with every row of the page ticked, the user never said
    // "everything": there are 24 997 more rows they have not seen.
    expect(after).toEqual({ mode: "ids", ids: every })
    expect(selectionCount(after, 25_000)).toBe(3)
  })

  it("returning an excluded row puts it back, without leaving `all-matching`", () => {
    const after = withRow({ mode: "all-matching", excluded: ["a", "b"] }, "a", true)
    expect(after).toEqual({ mode: "all-matching", excluded: ["b"] })
  })
})

describe("the count", () => {
  it("is the number of ids, always known", () => {
    expect(selectionCount(EMPTY_SELECTION, undefined)).toBe(0)
    expect(selectionCount({ mode: "ids", ids: ["a", "b"] }, undefined)).toBe(2)
  })

  it("is `rowCount - excluded` in `all-matching`", () => {
    expect(selectionCount(ALL_MATCHING_SELECTION, 100_000)).toBe(100_000)
    expect(selectionCount({ mode: "all-matching", excluded: ["a", "b"] }, 100_000)).toBe(99_998)
  })

  it("is undefined — not 0, not NaN — until a server has answered", () => {
    const count = selectionCount(ALL_MATCHING_SELECTION, undefined)
    expect(count).toBeUndefined()
    // The two ways this has gone wrong before: printing the rows on screen, and
    // printing arithmetic on an undefined total.
    expect(count).not.toBe(0)
    expect(Number.isNaN(count as unknown as number)).toBe(false)
  })

  it("never reports a negative number of rows", () => {
    // Only reachable from a rowCount that shrank under a live selection;
    // reporting -3 rows would be worse than reporting none of them.
    expect(selectionCount({ mode: "all-matching", excluded: ["a", "b", "c"] }, 1)).toBe(0)
  })
})

describe("the scope a selection is relative to", () => {
  const base = queryWith()

  it("changes with the filters, the search and the grouping", () => {
    const filtered = queryWith({ filters: [contains("code", "KR")] })
    const searched = queryWith({ search: { text: "agro", fields: ["partner"] } })
    const grouped = queryWith({ grouping: ["status"] })
    const opened = queryWith({ grouping: ["status"], expanded: [["open"]] })

    for (const query of [filtered, searched, grouped, opened]) {
      expect(selectionScopeOf(query)).not.toBe(selectionScopeOf(base))
    }
    // And the open branches move it too: `rowCount` is the length of the
    // FLATTENED list, so opening a group changes the number "all matching"
    // speaks without any row's membership changing.
    expect(selectionScopeOf(opened)).not.toBe(selectionScopeOf(grouped))
  })

  it("does NOT change with the sorting or the page", () => {
    const sorted = queryWith({ sorting: [{ id: "amount", desc: true }] })
    const paged = queryWith({ pageIndex: 7 })
    const resized = queryWith({ pageSize: 200 })

    for (const query of [sorted, paged, resized]) {
      expect(selectionScopeOf(query)).toBe(selectionScopeOf(base))
    }
  })

  it("ignores the order the filters were added in", () => {
    // `buildQuery` sorts them, which is what lets a stringify be an exact
    // comparison here — otherwise adding two filters and removing one would
    // clear a selection the user still had every right to.
    const one = queryWith({
      filters: [contains("code", "KR"), contains("partner", "a")],
    })
    const other = queryWith({
      filters: [contains("partner", "a"), contains("code", "KR")],
    })
    expect(selectionScopeOf(one)).toBe(selectionScopeOf(other))
  })
})
