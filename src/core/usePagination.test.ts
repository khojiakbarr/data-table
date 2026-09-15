import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { usePagination } from "./usePagination"

const setup = (overrides: Partial<Parameters<typeof usePagination>[0]> = {}) => {
  const onPageSizeChange = vi.fn()
  const props = {
    enabled: true,
    pageSize: 50,
    pageSizeOptions: [20, 50, 100],
    rowCount: 1000 as number | undefined,
    onPageSizeChange,
    ...overrides,
  }
  /*
   * What a setter sees when it runs: the row count of the latest render, the
   * way `useDataTable` supplies it from a ref rather than from a value the
   * callback closed over.
   */
  const latest = { rowCount: props.rowCount }
  const getRowCount = () => latest.rowCount
  const hook = renderHook(
    (p: typeof props) => {
      latest.rowCount = p.rowCount
      return usePagination({ ...p, getRowCount })
    },
    { initialProps: props },
  )
  return { ...hook, props, onPageSizeChange }
}

describe("usePagination", () => {
  it("derives the page count from the row count", () => {
    const { result } = setup()
    expect(result.current.pageCount).toBe(20)
    expect(result.current.pageIndex).toBe(0)
  })

  it("reports an unknown page count while the row count is unknown", () => {
    const { result } = setup({ rowCount: undefined })
    expect(result.current.pageCount).toBeUndefined()
  })

  it("clamps the page index into range", () => {
    const { result } = setup()
    act(() => result.current.setPageIndex(99))
    expect(result.current.pageIndex).toBe(19)
    act(() => result.current.setPageIndex(-5))
    expect(result.current.pageIndex).toBe(0)
  })

  it("keeps the first visible row when the page size changes", () => {
    const { result, rerender, props, onPageSizeChange } = setup()
    act(() => result.current.setPageIndex(4)) // rows 200–249
    act(() => result.current.setPageSize(100))
    expect(onPageSizeChange).toHaveBeenCalledWith(100)
    // The parent re-renders with the new size; the index was recomputed to 2 (rows 200–299).
    expect(result.current.pageIndex).toBe(2)
    rerender({ ...props, pageSize: 100 })
    expect(result.current.pageIndex).toBe(2)
  })

  it("keeps the options stable when an equal array is passed again", () => {
    // A caller writing `pageSizeOptions={[20, 50, 100]}` inline hands over a
    // new array every render; the same contents must not look like a change.
    const { result, rerender, props } = setup()
    const first = result.current.pageSizeOptions
    rerender({ ...props, pageSizeOptions: [20, 50, 100] })
    expect(result.current.pageSizeOptions).toBe(first)
  })

  it("adds a page size that is not among the options", () => {
    const { result } = setup({ pageSize: 30 })
    expect(result.current.pageSizeOptions).toEqual([20, 30, 50, 100])
  })

  it("sets page and size together, clamping against the new size", () => {
    const { result, onPageSizeChange } = setup()

    // 1000 rows at 20 a page is 50 pages, so page 7 is in range and must be
    // honoured rather than clamped against the old size's 20 pages.
    act(() => result.current.setPagination({ pageIndex: 7, pageSize: 20 }))
    expect(result.current.pageIndex).toBe(7)
    expect(onPageSizeChange).toHaveBeenCalledWith(20)

    // 10 pages at 100 a page, so an out-of-range index lands on the last one.
    act(() => result.current.setPagination({ pageIndex: 99, pageSize: 100 }))
    expect(result.current.pageIndex).toBe(9)
  })

  it("goes back to the first page on resetPage", () => {
    const { result } = setup()
    act(() => result.current.setPageIndex(3))
    act(() => result.current.resetPage())
    expect(result.current.pageIndex).toBe(0)
  })

  it("moves to the last page when the row count shrinks below the current page", () => {
    const { result, rerender, props } = setup()
    act(() => result.current.setPageIndex(19))
    rerender({ ...props, rowCount: 120 })
    expect(result.current.pageIndex).toBe(2)
  })

  it("does not take the user back to an abandoned page when the count changes again", () => {
    const { result, rerender, props } = setup()
    act(() => result.current.setPageIndex(19)) // the last page of 1000 rows

    // The host narrows the result set: page 20 is gone, page 2 is the last one.
    rerender({ ...props, rowCount: 100 })
    expect(result.current.pageIndex).toBe(1)

    // A different total arrives. Page 2 is still where the user is; page 4 is
    // a page they last asked for against a total that no longer exists.
    rerender({ ...props, rowCount: 200 })
    expect(result.current.pageIndex).toBe(1)
  })

  it("keeps the page while the row count is unknown, and restores it when it returns", () => {
    const { result, rerender, props } = setup()
    act(() => result.current.setPageIndex(19))

    // "Don't know yet" is not a statement that page 20 is gone.
    rerender({ ...props, rowCount: undefined })
    expect(result.current.pageIndex).toBe(19)
    rerender({ ...props, rowCount: 1000 })
    expect(result.current.pageIndex).toBe(19)
  })

  it("floors a page size below one to a whole page", () => {
    // A host sizing pages from a container that has not been measured yet.
    const { result } = setup({ pageSize: 0, rowCount: 100 })
    expect(result.current.pageSize).toBe(1)
    expect(result.current.pageCount).toBe(100)
    expect(result.current.pageSizeOptions).not.toContain(0)
  })

  it("is inert when disabled", () => {
    const { result } = setup({ enabled: false, rowCount: 1000 })
    expect(result.current.pageCount).toBe(1)
    act(() => result.current.setPageIndex(5))
    expect(result.current.pageIndex).toBe(0)
  })

  it("falls back to the first page when it is disabled after use", () => {
    const { result, rerender, props } = setup()
    act(() => result.current.setPageIndex(5))
    rerender({ ...props, enabled: false })
    expect(result.current.pageIndex).toBe(0)
    expect(result.current.pageCount).toBe(1)
  })

  it("ignores a page size that is not a number", () => {
    const { result, onPageSizeChange } = setup()
    act(() => result.current.setPageIndex(4))
    act(() => result.current.setPageSize(Number.NaN))
    expect(onPageSizeChange).not.toHaveBeenCalled()
    expect(result.current.pageIndex).toBe(4)
  })
})
