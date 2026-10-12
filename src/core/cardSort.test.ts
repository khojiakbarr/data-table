import { describe, expect, it } from "vitest"
import { cardSortOptions, cardSortSummary, nextCardSorting, type CardSortColumn } from "./cardSort"

const drawn = () => null

const COLUMNS: CardSortColumn[] = [
  { id: "pick", header: drawn, canSort: false },
  { id: "expiry", header: "Expiry", canSort: true },
  { id: "left", header: drawn, label: "Left", canSort: true },
  { id: "actions", header: "Actions", canSort: false },
]

describe("cardSortOptions", () => {
  it("offers every column that can sort, by its name, in column order", () => {
    expect(cardSortOptions(COLUMNS)).toEqual([
      { id: "expiry", label: "Expiry" },
      { id: "left", label: "Left" },
    ])
  })

  it("offers nothing when no column can sort", () => {
    expect(cardSortOptions([{ id: "actions", header: "Actions", canSort: false }])).toEqual([])
  })
})

describe("nextCardSorting", () => {
  it("sorts by a chosen column ascending when nothing was sorted", () => {
    expect(nextCardSorting([], { column: "expiry" })).toEqual([{ id: "expiry", desc: false }])
  })

  it("keeps the direction when another column is chosen", () => {
    expect(nextCardSorting([{ id: "expiry", desc: true }], { column: "left" })).toEqual([{ id: "left", desc: true }])
  })

  it("turns the current column's direction", () => {
    expect(nextCardSorting([{ id: "expiry", desc: false }], { desc: true })).toEqual([{ id: "expiry", desc: true }])
  })

  it("leaves an unsorted table unsorted when only a direction is chosen", () => {
    const none: [] = []
    expect(nextCardSorting(none, { desc: true })).toBe(none)
  })

  it("replaces a sort by several columns with the one chosen", () => {
    const multi = [
      { id: "expiry", desc: true },
      { id: "left", desc: false },
    ]
    expect(nextCardSorting(multi, { column: "left" })).toEqual([{ id: "left", desc: true }])
    expect(nextCardSorting(multi, { desc: false })).toEqual([{ id: "expiry", desc: false }])
  })

  it("clears the sort", () => {
    expect(nextCardSorting([{ id: "expiry", desc: false }], "clear")).toEqual([])
  })

  it("does not change what it was given", () => {
    const current = [{ id: "expiry", desc: false }]
    nextCardSorting(current, { desc: true })
    expect(current).toEqual([{ id: "expiry", desc: false }])
  })
})

describe("cardSortSummary", () => {
  const labelOf = (id: string) => ({ expiry: "Expiry", left: "Left" })[id] ?? id

  it("names the first sorted column and its direction", () => {
    expect(cardSortSummary([{ id: "expiry", desc: true }], labelOf)).toEqual({ id: "expiry", label: "Expiry", desc: true, more: 0 })
  })

  it("counts the further columns of a multi-column sort", () => {
    const multi = [
      { id: "left", desc: false },
      { id: "expiry", desc: true },
    ]
    expect(cardSortSummary(multi, labelOf)).toEqual({ id: "left", label: "Left", desc: false, more: 1 })
  })

  it("is nothing while the table is not sorted", () => {
    expect(cardSortSummary([], labelOf)).toBeUndefined()
  })
})
