import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { TableQuery } from "./query"
import { useTableQuery, type UseTableQueryOptions } from "./useTableQuery"

const setup = (initialProps: UseTableQueryOptions) => {
  const hook = renderHook((props: UseTableQueryOptions) => useTableQuery(props), {
    initialProps,
  })
  return hook
}

describe("useTableQuery", () => {
  it("keeps the same query identity across a render that rebuilt an equal sorting array", () => {
    /*
     * `sorting` is documented as needing to be identity-stable, but nothing
     * in this hook can enforce that from the outside — a host (or a future
     * caller inside this library) that hands it a fresh-but-equal array every
     * render is exactly the shape of a discarded `useMemo` cache: same
     * values, new reference. `queriesEqual` inside the hook is what has to
     * absorb that, not the caller's discipline.
     */
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result, rerender } = setup({
      sorting: [{ id: "name", desc: false }],
      filters: [],
      search: null,
      pageIndex: 0,
      pageSize: 50,
      onQueryChange,
    })
    const first = result.current

    rerender({
      sorting: [{ id: "name", desc: false }], // new array, same contents
      filters: [],
      search: null,
      pageIndex: 0,
      pageSize: 50,
      onQueryChange,
    })

    expect(result.current).toBe(first)
  })

  it("does not re-announce the query when its identity was preserved", () => {
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { rerender } = setup({
      sorting: [],
      filters: [],
      search: null,
      pageIndex: 0,
      pageSize: 50,
      onQueryChange,
    })
    expect(onQueryChange).toHaveBeenCalledTimes(1)

    act(() => {
      rerender({ sorting: [], filters: [], search: null, pageIndex: 0, pageSize: 50, onQueryChange }) // new array, same contents
    })

    // A discarded-memo-shaped rebuild must not read as a second request.
    expect(onQueryChange).toHaveBeenCalledTimes(1)
  })

  it("still produces a new identity, and re-announces, when the query actually changed", () => {
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result, rerender } = setup({
      sorting: [],
      filters: [],
      search: null,
      pageIndex: 0,
      pageSize: 50,
      onQueryChange,
    })
    const first = result.current

    act(() => {
      rerender({ sorting: [], filters: [], search: null, pageIndex: 1, pageSize: 50, onQueryChange })
    })

    expect(result.current).not.toBe(first)
    expect(result.current.pagination.pageIndex).toBe(1)
    expect(onQueryChange).toHaveBeenCalledTimes(2)
    expect(onQueryChange).toHaveBeenLastCalledWith(result.current)
  })
})
