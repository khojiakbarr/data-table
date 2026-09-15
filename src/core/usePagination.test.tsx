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
  const hook = renderHook((p: typeof props) => usePagination(p), { initialProps: props })
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
    const { result, onPageSizeChange } = setup()
    act(() => result.current.setPageIndex(4)) // rows 200–249
    act(() => result.current.setPageSize(100))
    expect(onPageSizeChange).toHaveBeenCalledWith(100)
    // The parent re-renders with the new size; the index was recomputed to 2 (rows 200–299).
    expect(result.current.pageIndex).toBe(2)
  })

  it("adds a page size that is not among the options", () => {
    const { result } = setup({ pageSize: 30 })
    expect(result.current.pageSizeOptions).toEqual([20, 30, 50, 100])
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

  it("is inert when disabled", () => {
    const { result } = setup({ enabled: false, rowCount: 1000 })
    expect(result.current.pageCount).toBe(1)
    act(() => result.current.setPageIndex(5))
    expect(result.current.pageIndex).toBe(0)
  })
})
