import { describe, expect, it } from "vitest"
import { buildQuery } from "./query"
import {
  ALL_MATCHING_SELECTION,
  EMPTY_SELECTION,
  headerScopeOf,
  isRowSelected,
  isSelectionEmpty,
  isSelectionEnabled,
  pageHeaderState,
  selectionCount,
  selectionScopeOf,
  withPageRows,
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

describe("what `features.selection` says", () => {
  it("reads `true` and an options object alike as \"on\"", () => {
    expect(isSelectionEnabled(true)).toBe(true)
    expect(isSelectionEnabled({})).toBe(true)
    expect(isSelectionEnabled({ scope: "page" })).toBe(true)
    expect(isSelectionEnabled(false)).toBe(false)
  })

  it("defaults the header scope to `all-matching`, for `true` and for `{}` alike", () => {
    // `true` is what every host on 0.6 wrote, and it must keep meaning exactly
    // what it meant: a host that said nothing about the header checkbox gets
    // the header checkbox it had.
    expect(headerScopeOf(true)).toBe("all-matching")
    expect(headerScopeOf(false)).toBe("all-matching")
    expect(headerScopeOf({})).toBe("all-matching")
    expect(headerScopeOf({ scope: undefined })).toBe("all-matching")
    expect(headerScopeOf({ scope: "all-matching" })).toBe("all-matching")
    expect(headerScopeOf({ scope: "page" })).toBe("page")
  })
})

describe("the header checkbox in `page` header scope", () => {
  const page1 = ["r0", "r1", "r2"]
  const page2 = ["r3", "r4"]

  it("ticks this page's rows, as ids, and never as `all-matching`", () => {
    const after = withPageRows(EMPTY_SELECTION, page1, true)
    expect(after).toEqual({ mode: "ids", ids: page1 })
  })

  it("adds the next page to what the user already had", () => {
    // The point of the mode: a selection built across pages, one page at a
    // time, is the only honest thing a backend without a bulk endpoint can act
    // on.
    const both = withPageRows({ mode: "ids", ids: page1 }, page2, true)
    expect(both).toEqual({ mode: "ids", ids: [...page1, ...page2] })
  })

  it("unticks only this page, leaving the ids picked up on other pages", () => {
    const after = withPageRows({ mode: "ids", ids: [...page1, ...page2] }, page2, false)
    expect(after).toEqual({ mode: "ids", ids: page1 })
  })

  it("comes back to the shared empty selection when the last id goes", () => {
    // Identity, for the same reason `EMPTY_SELECTION` exists: a new-but-equal
    // object would announce a change that did not happen.
    expect(withPageRows({ mode: "ids", ids: page1 }, page1, false)).toBe(EMPTY_SELECTION)
  })

  it("hands back the same object when the page is already as asked", () => {
    const model: SelectionModel = { mode: "ids", ids: page1 }
    expect(withPageRows(model, page1, true)).toBe(model)
    expect(withPageRows(model, page2, false)).toBe(model)
    // A page with nothing selectable on it — every row a group header — is a
    // header click that changes nothing rather than one that clears.
    expect(withPageRows(model, [], true)).toBe(model)
    expect(withPageRows(model, [], false)).toBe(model)
  })

  it("reads an `all-matching` model as nothing rather than as every row", () => {
    // It cannot be produced in this header scope; reading it as "everything"
    // would turn one header click into a selection the host cannot act on.
    expect(withPageRows(ALL_MATCHING_SELECTION, page1, true)).toEqual({ mode: "ids", ids: page1 })
    expect(withPageRows(ALL_MATCHING_SELECTION, page1, false)).toBe(EMPTY_SELECTION)
    expect(pageHeaderState(ALL_MATCHING_SELECTION, page1)).toEqual({
      checked: false,
      indeterminate: false,
    })
  })

  it("states checked, indeterminate and unchecked over THIS page", () => {
    expect(pageHeaderState(EMPTY_SELECTION, page1)).toEqual({
      checked: false,
      indeterminate: false,
    })
    expect(pageHeaderState({ mode: "ids", ids: ["r1"] }, page1)).toEqual({
      checked: false,
      indeterminate: true,
    })
    expect(pageHeaderState({ mode: "ids", ids: page1 }, page1)).toEqual({
      checked: true,
      indeterminate: false,
    })
  })

  it("is unchecked — not indeterminate — on a page none of whose rows are selected", () => {
    // Fifty ids from page 1, and the user lands on page 2: nothing HERE is
    // selected, and an indeterminate box would say this page is partly taken.
    expect(pageHeaderState({ mode: "ids", ids: page1 }, page2)).toEqual({
      checked: false,
      indeterminate: false,
    })
  })

  it("is unchecked on a page with nothing selectable on it", () => {
    // "All of nothing is selected" is true and useless; an empty square is the
    // honest drawing of a control with nothing to take.
    expect(pageHeaderState({ mode: "ids", ids: page1 }, [])).toEqual({
      checked: false,
      indeterminate: false,
    })
  })

  it("counts the ids, with no `rowCount` waited for", () => {
    const both = withPageRows({ mode: "ids", ids: page1 }, page2, true)
    expect(selectionCount(both, undefined)).toBe(5)
  })
})
