import { beforeEach, describe, expect, it } from "vitest"
import type { FilterCondition, FilterKind } from "./filters"
import { localStorageLayout, noLayoutStorage, pruneLayout } from "./persistence"
import type { TableLayout } from "../types"

const layout: TableLayout = {
  columnOrder: ["a", "b", "c"],
  columnVisibility: { b: false },
  columnPinning: { start: ["a"], end: ["c"] },
  columnSizing: { a: 120 },
  sorting: [{ id: "b", desc: true }],
  filters: [],
  search: "",
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

  it("keeps a positive page size and drops anything else", () => {
    expect(pruneLayout({ pageSize: 100 }, ["a"]).pageSize).toBe(100)
    expect(pruneLayout({ pageSize: 0 }, ["a"]).pageSize).toBeUndefined()
    expect(pruneLayout({ pageSize: "x" as unknown as number }, ["a"]).pageSize).toBeUndefined()
  })

  it("does not throw when an array-shaped slice comes back from storage as something else", () => {
    // `stored` is whatever `JSON.parse` produced from untrusted data (a
    // hand-edited localStorage entry, a server response), so nothing here
    // guarantees `columnOrder`/`sorting`/`columnPinning.start`/`.end` are
    // actually arrays. This runs inside `useArrangement`'s `useState`
    // initialiser, so a throw here is a render crash with no self-healing
    // path — the bad entry is never cleared and every reload crashes again.
    const damaged = {
      columnOrder: { a: 1 } as unknown as string[],
      sorting: { a: 1 } as unknown as TableLayout["sorting"],
      columnPinning: { start: "oops", end: 5 } as unknown as TableLayout["columnPinning"],
    }
    expect(() => pruneLayout(damaged, ["a", "b"])).not.toThrow()
    const pruned = pruneLayout(damaged, ["a", "b"])
    // Neither slice is copied when its shape is wrong — `pruneLayout` rebuilds
    // from recognised keys, so an unrecognised shape is treated the same as
    // an absent one rather than guessed at.
    expect(pruned.columnOrder).toBeUndefined()
    expect(pruned.sorting).toBeUndefined()
    expect(pruned.columnPinning).toEqual({ start: [], end: [] })
  })
})

describe("pruneLayout — filters", () => {
  const kinds: ReadonlyMap<string, FilterKind | false> = new Map<string, FilterKind | false>([
    ["a", "text"],
    ["b", "number"],
    ["c", false],
  ])
  const contains: FilterCondition = { kind: "text", field: "a", op: "contains", value: "x" }

  it("keeps a condition on a live column, rebuilt in canonical form", () => {
    // Two columns, not two conditions on one: the model is one condition per
    // column, and the case below is what holds that line.
    const handBuilt = { op: "in", values: ["open", "closed"], field: "b", kind: "list" } as FilterCondition
    const pruned = pruneLayout({ filters: [contains, handBuilt] }, ["a", "b"])
    expect(pruned.filters).toEqual([
      contains,
      { kind: "list", field: "b", op: "in", values: ["closed", "open"] },
    ])
  })

  it("keeps at most one condition per column, and it is the last one", () => {
    // The projection into `state.columnFilters` is the only writer of
    // `ColumnFilter.id`, so two conditions on one field would become two
    // entries sharing an id: the row model applies both while every editor,
    // which looks a column's condition up by `field`, shows only the first.
    const later: FilterCondition = { kind: "text", field: "a", op: "equals", value: "y" }
    expect(pruneLayout({ filters: [contains, later] }, ["a"], kinds).filters).toEqual([later])
  })

  it("drops a condition on a column the table no longer defines", () => {
    expect(pruneLayout({ filters: [contains] }, ["b"], kinds).filters).toEqual([])
  })

  it("drops a condition whose kind disagrees with the column's resolved kind", () => {
    // Reachable with no host code change: a kind inferred from data can differ
    // between visits, and a text condition on a number column would send ILIKE
    // for an integer column, which is an error in Postgres.
    expect(pruneLayout({ filters: [{ ...contains, field: "b" }] }, ["a", "b"], kinds).filters).toEqual([])
    expect(pruneLayout({ filters: [{ ...contains, field: "c" }] }, ["a", "c"], kinds).filters).toEqual([])
  })

  it("drops a condition of an unknown kind or a shape its operator cannot carry", () => {
    const unknownKind = { kind: "colour", field: "a", op: "is" } as unknown as FilterCondition
    const wrongArity = { kind: "text", field: "a", op: "contains" } as unknown as FilterCondition
    expect(pruneLayout({ filters: [unknownKind, wrongArity] }, ["a"], kinds).filters).toEqual([])
  })

  it("keeps a stored search string and ignores anything else", () => {
    expect(pruneLayout({ search: "kr-102" }, ["a"]).search).toBe("kr-102")
    expect(pruneLayout({ search: 5 as unknown as string }, ["a"]).search).toBeUndefined()
    expect(pruneLayout({}, ["a"]).search).toBeUndefined()
  })

  it("does not throw when the stored filters container is not an array", () => {
    // Reproduces seeding localStorage with `{"v":1,"layout":{"filters":{"a":1}}}`
    // and mounting a table: `stored.filters` is truthy, so pruneLayout used to
    // hand a non-iterable straight to `for...of` inside pruneFilters, throwing
    // from `useArrangement`'s `useState` initialiser on every mount.
    const damagedFilters = { a: 1 } as unknown as FilterCondition[]
    expect(() => pruneLayout({ filters: damagedFilters }, ["a"], kinds)).not.toThrow()
    expect(pruneLayout({ filters: damagedFilters }, ["a"], kinds).filters).toEqual([])
  })
})
