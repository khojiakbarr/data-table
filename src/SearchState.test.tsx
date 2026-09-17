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

  it("does not reopen a search field a previous page already resolved, even once a later page samples it as all-null", () => {
    /*
     * Reproduces the Task 10 review finding: `search` depends on
     * `resolvedSearchFields`, which is derived from `data`, and `data` is the
     * host's own response to `search` on the wire — a feedback loop. A column
     * with no declared `meta.searchable` whose non-null values are not a
     * string or a number (`closedAt: Date | null` here) is `unresolved`
     * before any page has arrived, so it starts on the wire; the first real
     * page proves it unsearchable and narrows `fields`. Without a cache
     * remembering that, a later, narrower page's own sample can land on
     * all-null, `collectSearchFields` reports the column `unresolved` again,
     * and folding `unresolved` back into `fields` unconditionally reopens the
     * question the first page already settled — forever, against a backend
     * whose response depends on `fields`.
     */
    interface ClosableRow {
      id: string
      name: string
      closedAt: Date | null
    }
    const closableHelper = createColumnHelper<DataTableFeatures, ClosableRow>()
    const closableColumns = [
      closableHelper.accessor("name", { header: "Name", size: 100 }),
      closableHelper.accessor("closedAt", { header: "Closed", size: 100 }),
    ]
    const beforeFirstPage: ClosableRow[] = []
    const pageWithClosedAt: ClosableRow[] = [
      { id: "r0", name: "Agro Ltd", closedAt: new Date(2026, 0, 1) },
      { id: "r1", name: "Agro Group", closedAt: new Date(2026, 0, 2) },
    ]
    // The host honoured the narrowed `fields: ["name"]` and this page's
    // matched rows all happen to have `closedAt` null.
    const pageWithoutClosedAtSample: ClosableRow[] = [
      { id: "r2", name: "Agro Traders", closedAt: null },
      { id: "r3", name: "Agro Imports", closedAt: null },
    ]

    vi.useFakeTimers()
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result, rerender } = renderHook(
      (props: { data: ClosableRow[] }) =>
        useDataTable<ClosableRow>({
          id: "q9",
          columns: closableColumns,
          data: props.data,
          mode: "server",
          rowCount: 4,
          getRowId: (row) => row.id,
          onQueryChange,
        }),
      { initialProps: { data: beforeFirstPage } },
    )
    onQueryChange.mockClear() // drop the mount announcement (search: null)

    act(() => result.current.filtering.setSearch("agro"))
    act(() => vi.advanceTimersByTime(300))

    // Nothing sampled yet: both columns are unresolved and stay on the wire.
    expect(result.current.query.search).toEqual({ text: "agro", fields: ["closedAt", "name"] })
    expect(onQueryChange).toHaveBeenCalledTimes(1)

    // The first real page proves `closedAt` unsearchable (a Date sample) and
    // narrows `fields` — one extra, expected announcement.
    act(() => rerender({ data: pageWithClosedAt }))
    expect(result.current.query.search).toEqual({ text: "agro", fields: ["name"] })
    expect(onQueryChange).toHaveBeenCalledTimes(2)

    // Toggling between a page that samples `closedAt` as null and one that
    // doesn't must not reopen a question the first page already answered —
    // no further announcement, whichever way the sample swings.
    act(() => rerender({ data: pageWithoutClosedAtSample }))
    act(() => rerender({ data: pageWithClosedAt }))
    act(() => rerender({ data: pageWithoutClosedAtSample }))

    expect(result.current.query.search).toEqual({ text: "agro", fields: ["name"] })
    expect(onQueryChange).toHaveBeenCalledTimes(2)
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
