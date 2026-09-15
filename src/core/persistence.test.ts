import { beforeEach, describe, expect, it } from "vitest"
import { localStorageLayout, noLayoutStorage, pruneLayout } from "./persistence"
import type { TableLayout } from "../types"

const layout: TableLayout = {
  columnOrder: ["a", "b", "c"],
  columnVisibility: { b: false },
  columnPinning: { start: ["a"], end: ["c"] },
  columnSizing: { a: 120 },
  sorting: [{ id: "b", desc: true }],
}

describe("localStorageLayout", () => {
  beforeEach(() => localStorage.clear())

  it("round-trips a layout", () => {
    const store = localStorageLayout()
    store.save("receipts", layout)
    expect(store.load("receipts")).toEqual(layout)
  })

  it("keeps tables apart", () => {
    const store = localStorageLayout()
    store.save("receipts", layout)
    store.save("products", { ...layout, columnOrder: ["x", "y"] })

    expect(store.load("receipts")?.columnOrder).toEqual(["a", "b", "c"])
    expect(store.load("products")?.columnOrder).toEqual(["x", "y"])
  })

  it("forgets one table without touching the other", () => {
    const store = localStorageLayout()
    store.save("receipts", layout)
    store.save("products", layout)

    store.clear("receipts")

    expect(store.load("receipts")).toBeNull()
    expect(store.load("products")).not.toBeNull()
  })

  it("returns null for a layout written by an older format", () => {
    localStorage.setItem("data-table:layout:old", JSON.stringify({ v: 0, layout }))
    expect(localStorageLayout().load("old")).toBeNull()
  })

  it("returns null instead of throwing on corrupt data", () => {
    localStorage.setItem("data-table:layout:broken", "{not json")
    expect(localStorageLayout().load("broken")).toBeNull()
  })
})

describe("noLayoutStorage", () => {
  it("never remembers anything", () => {
    const store = noLayoutStorage()
    store.save("receipts", layout)
    expect(store.load("receipts")).toBeNull()
  })
})

describe("pruneLayout", () => {
  it("drops columns the table no longer defines", () => {
    const pruned = pruneLayout(layout, ["a", "b"])

    expect(pruned.columnOrder).toEqual(["a", "b"])
    expect(pruned.columnPinning).toEqual({ start: ["a"], end: [] })
    expect(pruned.sorting).toEqual([{ id: "b", desc: true }])
  })

  it("appends columns added since the layout was saved", () => {
    const pruned = pruneLayout(layout, ["a", "b", "c", "d"])
    expect(pruned.columnOrder).toEqual(["a", "b", "c", "d"])
  })

  it("keeps the user's order for columns that still exist", () => {
    const reordered = { ...layout, columnOrder: ["c", "a", "b"] }
    const pruned = pruneLayout(reordered, ["a", "b", "c", "d"])
    expect(pruned.columnOrder).toEqual(["c", "a", "b", "d"])
  })

  it("keeps sizing values numeric", () => {
    const pruned = pruneLayout(layout, ["a", "b", "c"])
    expect(pruned.columnSizing).toEqual({ a: 120 })
  })

  it("drops a width that is not a positive finite number", () => {
    const damaged = {
      columnSizing: { a: Number.NaN, b: "abc" as unknown as number, c: 0, d: 120 },
    }
    const pruned = pruneLayout(damaged, ["a", "b", "c", "d"])
    expect(pruned.columnSizing).toEqual({ d: 120 })
  })

  it("drops sorting on a removed column", () => {
    const pruned = pruneLayout(layout, ["a", "c"])
    expect(pruned.sorting).toEqual([])
  })
})
