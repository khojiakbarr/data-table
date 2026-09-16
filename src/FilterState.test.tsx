import { createColumnHelper } from "@tanstack/react-table"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { localStorageLayout } from "./core/persistence"
import type { FilterCondition } from "./core/filters"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * Filter state: where it lives, what it resets, and what it persists.
 *
 * No UI and no TanStack filtering features yet — this is the layout slices,
 * the mutators and the round-trip, driven through the instance API.
 */

interface Row {
  id: string
  name: string
  amount: number
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 100 }),
  helper.accessor("amount", { header: "Amount", size: 100 }),
]
const data: Row[] = Array.from({ length: 300 }, (_, index) => ({
  id: `r${index}`,
  name: `Row ${index}`,
  amount: index * 10,
}))

const contains: FilterCondition = { kind: "text", field: "name", op: "contains", value: "7" }
const over: FilterCondition = { kind: "number", field: "amount", op: "gt", value: 100 }

const setup = (id: string, options: { persist?: boolean } = {}) =>
  renderHook(() =>
    useDataTable<Row>({
      id,
      columns,
      data,
      pagination: true,
      getRowId: (row) => row.id,
      storage: localStorageLayout(),
      ...(options.persist === undefined ? {} : { filtering: { persist: options.persist } }),
    }),
  )

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

describe("filter mutators", () => {
  it("setCondition stores the condition and goes back to the first page", () => {
    const { result } = setup("f1")
    act(() => result.current.pagination.setPageIndex(3))

    act(() => result.current.filtering.setCondition(contains))

    expect(result.current.filtering.conditions).toEqual([contains])
    expect(result.current.pagination.pageIndex).toBe(0)
    expect(result.current.filtering.isFiltered).toBe(true)
  })

  it("setCondition replaces the condition on the same column", () => {
    const { result } = setup("f2")
    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.filtering.setCondition({ ...contains, value: "9" }))

    expect(result.current.filtering.conditions).toEqual([{ ...contains, value: "9" }])
  })

  it("setCondition clears the column when the condition constrains nothing", () => {
    const { result } = setup("f3")
    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.filtering.setCondition({ ...contains, value: "" }))

    expect(result.current.filtering.conditions).toEqual([])
  })

  it("clearColumn removes only that column's condition, and resets the page", () => {
    const { result } = setup("f4")
    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.filtering.setCondition(over))
    act(() => result.current.pagination.setPageIndex(2))

    act(() => result.current.filtering.clearColumn("name"))

    expect(result.current.filtering.conditions).toEqual([over])
    expect(result.current.pagination.pageIndex).toBe(0)
  })

  it("setSearch stores the raw text and resets the page", () => {
    const { result } = setup("f5")
    act(() => result.current.pagination.setPageIndex(4))

    act(() => result.current.filtering.setSearch("kr 102 "))

    expect(result.current.filtering.search).toBe("kr 102 ")
    expect(result.current.pagination.pageIndex).toBe(0)
  })

  it("clearAll clears conditions and search together, and resets the page", () => {
    const { result } = setup("f6")
    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.filtering.setSearch("kr"))
    act(() => result.current.pagination.setPageIndex(1))

    act(() => result.current.filtering.clearAll())

    expect(result.current.filtering.conditions).toEqual([])
    expect(result.current.filtering.search).toBe("")
    expect(result.current.filtering.isFiltered).toBe(false)
    expect(result.current.pagination.pageIndex).toBe(0)
  })

  it("counts a whitespace-only search as no search", () => {
    const { result } = setup("f7")
    act(() => result.current.filtering.setSearch("   "))
    expect(result.current.filtering.isFiltered).toBe(false)
  })
})

describe("the filter model round-trip", () => {
  it("restores a stored model, dropping what it cannot honour, and resets the page", () => {
    const { result } = setup("f8")
    const unknownColumn: FilterCondition = { kind: "text", field: "gone", op: "contains", value: "x" }
    act(() => result.current.pagination.setPageIndex(3))

    act(() =>
      result.current.filtering.setModel({ filters: [contains, unknownColumn], search: "kr" }),
    )

    expect(result.current.filtering.getModel()).toEqual({ filters: [contains], search: "kr" })
    // `setModel` is a mutator like the other four: it goes through
    // `updateFilters` and `updateSearch`, so it resets the page too.
    expect(result.current.pagination.pageIndex).toBe(0)
  })

  it("keeps one condition per column when a stored model carries two", () => {
    const { result } = setup("f8b")
    const later: FilterCondition = { kind: "text", field: "name", op: "equals", value: "Row 7" }

    act(() => result.current.filtering.setModel({ filters: [contains, later], search: "" }))

    // `setModel` runs the same `pruneFilters` a stored layout does, so it
    // inherits the one-condition-per-column guarantee: the projection is the
    // only writer of `ColumnFilter.id` and two entries could not share one.
    expect(result.current.filtering.conditions).toEqual([later])
  })

  it("produces an identical query from a differently-key-ordered condition", () => {
    const { result } = setup("f9")
    const handBuilt = { value: "7", op: "contains", field: "name", kind: "text" } as FilterCondition

    act(() => result.current.filtering.setCondition(contains))
    const canonical = result.current.query
    act(() => result.current.filtering.setModel({ filters: [handBuilt], search: "" }))

    // Same object, not merely an equal one: a re-ordered condition that
    // stringified differently would hand the host a new fetch key.
    expect(result.current.query).toBe(canonical)
  })

  it("publishes filters on the query, sorted by field", () => {
    const { result } = setup("f10")
    act(() => result.current.filtering.setCondition(over))
    act(() => result.current.filtering.setCondition(contains))

    expect(result.current.query.filters.map((condition) => condition.field)).toEqual(["amount", "name"])
  })
})

describe("persistence", () => {
  it("persists filters with the layout and restores them on the next mount", () => {
    vi.useFakeTimers()
    const first = setup("f11")
    act(() => first.result.current.filtering.setCondition(contains))
    act(() => vi.advanceTimersByTime(400))
    first.unmount()
    vi.useRealTimers()

    const second = setup("f11")
    expect(second.result.current.filtering.conditions).toEqual([contains])
  })

  it("persist: false keeps filters out of storage and schedules no write", () => {
    vi.useFakeTimers()
    const first = setup("f12", { persist: false })
    act(() => first.result.current.filtering.setCondition(contains))
    act(() => first.result.current.filtering.setSearch("kr"))
    act(() => vi.advanceTimersByTime(400))
    // Nothing was written at all: for the server-backed adapter `types.ts`
    // recommends, a write per pause is a network request per pause.
    expect(localStorage.getItem("data-table:layout:f12")).toBeNull()
    first.unmount()
    vi.useRealTimers()

    const second = setup("f12", { persist: false })
    expect(second.result.current.filtering.conditions).toEqual([])
    expect(second.result.current.filtering.search).toBe("")
  })

  it("does not mark the layout customised for a filter or a search", () => {
    const { result } = setup("f13")
    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.filtering.setSearch("kr"))

    // The Columns tab's Reset link is about columns; a search has nothing to
    // do with it.
    expect(result.current.isCustomised).toBe(false)
  })

  it("is on by default and off when filtering is false", () => {
    const enabled = setup("f14")
    expect(enabled.result.current.filtering.enabled).toBe(true)

    const { result } = renderHook(() =>
      useDataTable<Row>({ id: "f15", columns, data, filtering: false, getRowId: (row) => row.id }),
    )
    expect(result.current.filtering.enabled).toBe(false)
  })
})
