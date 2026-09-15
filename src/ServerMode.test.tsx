import { createColumnHelper } from "@tanstack/react-table"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { localStorageLayout } from "./core/persistence"
import type { TableQuery } from "./core/query"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * Server mode: the table describes what it wants (a query) and renders what
 * it is given. Nothing is sorted or sliced locally.
 */

interface Row {
  id: string
  name: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 100 })]
const page = (from: number, count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: `r${from + i}`, name: `Row ${from + i}` }))

describe("server mode", () => {
  it("reports the initial query on mount, with the persisted page size", () => {
    localStorage.clear()
    localStorageLayout().save("srv", {
      columnOrder: [], columnVisibility: {}, columnPinning: { start: [], end: [] },
      columnSizing: {}, sorting: [{ id: "name", desc: true }], pageSize: 100,
    })
    const onQueryChange = vi.fn<(query: TableQuery) => void>()

    renderHook(() =>
      useDataTable<Row>({
        id: "srv", columns, data: [], mode: "server", rowCount: 0,
        storage: localStorageLayout(), getRowId: (row) => row.id, onQueryChange,
      }),
    )

    // Once, because these tests do not render under StrictMode. In a
    // development StrictMode tree React mounts effects twice, so a host sees
    // this fire twice on mount — harmless for a fetch keyed on the query.
    expect(onQueryChange).toHaveBeenCalledTimes(1)
    expect(onQueryChange.mock.calls[0]?.[0]).toEqual({
      sorting: [{ id: "name", desc: true }], columnFilters: [], globalFilter: "", grouping: [],
      pagination: { pageIndex: 0, pageSize: 100 },
    })
  })

  it("renders rows as given, unsorted and unsliced", () => {
    const rows = [...page(0, 3)].reverse()
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "srv2", columns, data: rows, mode: "server", rowCount: 500,
        getRowId: (row) => row.id, initialLayout: { sorting: [{ id: "name", desc: false }] },
      }),
    )
    expect(result.current.table.getRowModel().rows.map((r) => r.id)).toEqual(["r2", "r1", "r0"])
    expect(result.current.pagination.pageCount).toBe(10)
  })

  it("goes back to page one when sorting changes, but not when data changes", () => {
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) =>
        useDataTable<Row>({
          id: "srv3", columns, data, mode: "server", rowCount: 500,
          getRowId: (row) => row.id, onQueryChange,
        }),
      { initialProps: { data: page(0, 50) } },
    )

    act(() => result.current.pagination.setPageIndex(3))
    expect(result.current.query.pagination.pageIndex).toBe(3)

    rerender({ data: page(150, 50) }) // a fresh array, as every fetch produces
    expect(result.current.query.pagination.pageIndex).toBe(3)

    act(() => result.current.table.getColumn("name")!.toggleSorting(false))
    expect(result.current.query.pagination.pageIndex).toBe(0)
    expect(result.current.query.sorting).toEqual([{ id: "name", desc: false }])
    expect(onQueryChange).toHaveBeenLastCalledWith(result.current.query)
  })

  it("keeps the query referentially stable across unrelated renders", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) =>
        useDataTable<Row>({ id: "srv4", columns, data, mode: "server", rowCount: 10, getRowId: (r) => r.id }),
      { initialProps: { data: page(0, 10) } },
    )
    const first = result.current.query
    rerender({ data: page(0, 10) })
    expect(result.current.query).toBe(first)
  })

  it("keeps Next alive while the row count is unknown", () => {
    const { result, rerender } = renderHook(
      ({ total }: { total: number | undefined }) =>
        useDataTable<Row>({
          id: "srv6", columns, data: page(0, 50), mode: "server",
          ...(total === undefined ? {} : { rowCount: total }),
          getRowId: (r) => r.id,
        }),
      { initialProps: { total: undefined as number | undefined } },
    )

    // Left to itself TanStack counts the one page it can see and stops there.
    expect(result.current.table.getCanNextPage()).toBe(true)
    expect(result.current.pagination.pageCount).toBeUndefined()

    rerender({ total: 500 })
    expect(result.current.table.getPageCount()).toBe(10)
    expect(result.current.pagination.pageCount).toBe(10)
  })

  it("does not refire onQueryChange when the host echoes the query back", () => {
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { rerender } = renderHook(
      ({ data }: { data: Row[] }) =>
        useDataTable<Row>({
          id: "srv7", columns, data, mode: "server", rowCount: 500,
          getRowId: (r) => r.id, onQueryChange,
        }),
      { initialProps: { data: page(0, 50) } },
    )
    expect(onQueryChange).toHaveBeenCalledTimes(1)

    // What a host does with the query it was handed: store it, refetch, render
    // the result. None of that describes a new request.
    rerender({ data: page(0, 50) })
    rerender({ data: page(50, 50) })
    expect(onQueryChange).toHaveBeenCalledTimes(1)
  })

  it("uses the row id for expansion state", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) =>
        useDataTable<Row>({ id: "srv5", columns, data, mode: "server", rowCount: 10, getRowId: (r) => r.id }),
      { initialProps: { data: page(0, 2) } },
    )
    act(() => result.current.table.getRow("r1").toggleExpanded())
    rerender({ data: [...page(0, 2)].reverse() })
    expect(result.current.table.getRow("r1").getIsExpanded()).toBe(true)
    expect(result.current.table.getRow("r0").getIsExpanded()).toBe(false)
  })
})

describe("client mode pagination", () => {
  it("is off by default and slices when turned on", () => {
    const data = page(0, 120)
    const off = renderHook(() => useDataTable<Row>({ id: "c1", columns, data }))
    expect(off.result.current.table.getRowModel().rows).toHaveLength(120)
    expect(off.result.current.pagination.enabled).toBe(false)

    const on = renderHook(() => useDataTable<Row>({ id: "c2", columns, data, pagination: { pageSize: 50 } }))
    expect(on.result.current.table.getRowModel().rows).toHaveLength(50)
    expect(on.result.current.pagination.pageCount).toBe(3)
    act(() => on.result.current.pagination.setPageIndex(2))
    expect(on.result.current.table.getRowModel().rows).toHaveLength(20)
  })

  it("keeps the top row in view when TanStack changes the page size", () => {
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "c4", columns, data: page(0, 120), getRowId: (r) => r.id,
        pagination: { pageSize: 50 },
      }),
    )

    act(() => result.current.pagination.setPageIndex(2))
    expect(result.current.table.getRowModel().rows[0]?.id).toBe("r100")

    // TanStack's own setPageSize repositions the index from the top row; the
    // hook must not then re-clamp it against the old page size's page count.
    act(() => result.current.table.setPageSize(20))
    expect(result.current.pagination.pageIndex).toBe(5)
    expect(result.current.table.getRowModel().rows[0]?.id).toBe("r100")
  })

  it("clamps a client-side page to the real last page", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) =>
        useDataTable<Row>({ id: "c3", columns, data, pagination: { pageSize: 50 } }),
      { initialProps: { data: page(0, 120) } },
    )

    act(() => result.current.pagination.setPageIndex(99))
    expect(result.current.pagination.pageIndex).toBe(2)
    expect(result.current.table.getRowModel().rows).toHaveLength(20)

    rerender({ data: page(0, 60) }) // rows removed under the user's feet
    expect(result.current.pagination.pageIndex).toBe(1)
    expect(result.current.table.getRowModel().rows).toHaveLength(10)
  })
})
