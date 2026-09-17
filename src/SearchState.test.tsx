import { createColumnHelper } from "@tanstack/react-table"
import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { TableQuery } from "./core/query"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * Quick search between the layout slice and the wire: what is debounced, what
 * is trimmed, and which columns the search covers.
 */

interface Row {
  id: string
  name: string
  amount: number
  tag: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 100 }),
  helper.accessor("amount", { header: "Amount", size: 100 }),
  helper.accessor("tag", { header: "Tag", size: 100 }),
]
const data: Row[] = [
  { id: "r0", name: "Agro Ltd", amount: 100, tag: "open" },
  { id: "r1", name: "Temir", amount: 500, tag: "closed" },
  { id: "r2", name: "KR-102", amount: 900, tag: "open" },
]

const server = (id: string, onQueryChange: (query: TableQuery) => void) =>
  renderHook(() =>
    useDataTable<Row>({
      id,
      columns,
      data,
      mode: "server",
      rowCount: 3,
      getRowId: (row) => row.id,
      onQueryChange,
    }),
  )

const client = (id: string) =>
  renderHook(() => useDataTable<Row>({ id, columns, data, getRowId: (row) => row.id }))

afterEach(() => vi.useRealTimers())

describe("quick search", () => {
  it("coalesces a burst of keystrokes into one query", () => {
    vi.useFakeTimers()
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result } = server("q1", onQueryChange)
    onQueryChange.mockClear()

    act(() => result.current.filtering.setSearch("t"))
    act(() => result.current.filtering.setSearch("te"))
    act(() => result.current.filtering.setSearch("tem"))
    expect(onQueryChange).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(300))
    expect(onQueryChange).toHaveBeenCalledTimes(1)
    expect(onQueryChange.mock.calls[0]![0].search).toEqual({
      text: "tem",
      fields: ["amount", "name", "tag"],
    })
  })

  it("keeps the input responsive while the published value waits", () => {
    vi.useFakeTimers()
    const { result } = client("q2")
    act(() => result.current.filtering.setSearch("temir "))

    // The raw text is in state on the keystroke, trailing space and all; only
    // what is downstream of it waits.
    expect(result.current.filtering.search).toBe("temir ")
    expect(result.current.table.getRowModel().rows).toHaveLength(3)

    act(() => vi.advanceTimersByTime(300))
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r1"])
  })

  it("matches tokens across different columns", () => {
    vi.useFakeTimers()
    const { result } = client("q3")
    act(() => result.current.filtering.setSearch("temir closed"))
    act(() => vi.advanceTimersByTime(300))

    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r1"])
  })

  it("counts a whitespace-only search as no search on the wire", () => {
    vi.useFakeTimers()
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result } = server("q4", onQueryChange)
    act(() => result.current.filtering.setSearch("   "))
    act(() => vi.advanceTimersByTime(300))

    // `createFilteredRowModel` treats " " as a live global filter and would
    // search for a space, while a wire carrying null returns everything.
    expect(result.current.query.search).toBeNull()
    expect(result.current.filtering.search).toBe("   ")
  })

  it("narrows the searched fields when a column is hidden", () => {
    vi.useFakeTimers()
    const { result } = client("q5")
    act(() => result.current.table.getColumn("tag")!.toggleVisibility(false))
    act(() => result.current.filtering.setSearch("closed"))
    act(() => vi.advanceTimersByTime(300))

    // Hiding a column narrows search, and the wire says exactly which columns
    // the client searched.
    expect(result.current.query.search).toEqual({ text: "closed", fields: ["amount", "name"] })
    expect(result.current.table.getRowModel().rows).toHaveLength(0)
  })

  it("narrows them the other way round too, when the column is hidden after the search", () => {
    vi.useFakeTimers()
    const { result } = client("q5b")
    act(() => result.current.filtering.setSearch("closed"))
    act(() => vi.advanceTimersByTime(300))
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r1"])

    act(() => result.current.table.getColumn("tag")!.toggleVisibility(false))

    /*
     * This is the order that can actually go wrong. `createFilteredRowModel`
     * memoises on the core row model, `columnFilters` and `globalFilter`, and
     * hiding a column changes none of the three — so without the projection's
     * dependency on `resolvedSearchFields` the client would go on matching
     * `tag` while the wire had already dropped it, which is precisely the
     * divergence the predicate exists to prevent.
     */
    expect(result.current.query.search).toEqual({ text: "closed", fields: ["amount", "name"] })
    expect(result.current.table.getRowModel().rows).toHaveLength(0)
  })

  it("honours searchFields over the default predicate", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "q6",
        columns,
        data,
        getRowId: (row) => row.id,
        filtering: { searchFields: ["tag"], debounceMs: 50 },
      }),
    )
    act(() => result.current.filtering.setSearch("agro"))
    act(() => vi.advanceTimersByTime(50))

    expect(result.current.query.search).toEqual({ text: "agro", fields: ["tag"] })
    expect(result.current.table.getRowModel().rows).toHaveLength(0)
  })

  it("routes table.setGlobalFilter back through the layout", () => {
    const { result } = client("q7")
    act(() => result.current.table.setGlobalFilter("temir"))

    // `state.globalFilter` is controlled, so the default updater would write to
    // an atom the controlled value overrides and this would do nothing.
    expect(result.current.filtering.search).toBe("temir")
  })

  it("publishes nothing to search when no column is searchable", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "q8",
        columns,
        data,
        getRowId: (row) => row.id,
        filtering: { searchFields: [] },
      }),
    )
    act(() => result.current.filtering.setSearch("agro"))
    act(() => vi.advanceTimersByTime(300))

    // An empty field list means search is off: the client has nothing to match
    // against, so the wire carries null rather than a term no backend could honour.
    expect(result.current.query.search).toBeNull()
    expect(result.current.table.getRowModel().rows).toHaveLength(3)
  })
})
