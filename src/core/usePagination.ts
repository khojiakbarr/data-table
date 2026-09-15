import { useCallback, useEffect, useMemo, useState } from "react"

/** Inputs to {@link usePagination}. */
export interface UsePaginationOptions {
  enabled: boolean
  /** Rows per page, owned by the layout so it persists. */
  pageSize: number
  pageSizeOptions: readonly number[]
  /** Total rows, or undefined while a server has not said yet. */
  rowCount: number | undefined
  /** Persist a new page size; the hook re-renders with it as `pageSize`. */
  onPageSizeChange: (pageSize: number) => void
}

/** What the footer, the shell and TanStack read and drive. */
export interface PaginationApi {
  enabled: boolean
  pageIndex: number
  pageSize: number
  pageSizeOptions: readonly number[]
  /** Undefined while the row count is unknown. */
  pageCount: number | undefined
  rowCount: number | undefined
  setPageIndex: (pageIndex: number) => void
  setPageSize: (pageSize: number) => void
  /** Back to the first page — called when sorting, filters or grouping change. */
  resetPage: () => void
}

/**
 * Page state.
 *
 * The page index is transient — a reading position, like which rows are
 * expanded — while the page size is a preference that lives in the layout.
 * Nothing here resets on a data change: in server mode every fetch is a new
 * `data` array, and resetting would send the user back to page one on
 * every response. Callers reset explicitly when the query's other inputs
 * change.
 */
export function usePagination({
  enabled,
  pageSize,
  pageSizeOptions,
  rowCount,
  onPageSizeChange,
}: UsePaginationOptions): PaginationApi {
  const [pageIndex, setPageIndexState] = useState(0)

  const pageCount = useMemo(() => {
    if (!enabled) return 1
    if (rowCount === undefined) return undefined
    return Math.max(1, Math.ceil(rowCount / pageSize))
  }, [enabled, rowCount, pageSize])

  const clamp = useCallback(
    (index: number) => {
      const last = pageCount === undefined ? Number.MAX_SAFE_INTEGER : pageCount - 1
      return Math.max(0, Math.min(index, last))
    },
    [pageCount],
  )

  const setPageIndex = useCallback(
    (index: number) => {
      if (!enabled) return
      setPageIndexState(clamp(index))
    },
    [enabled, clamp],
  )

  const setPageSize = useCallback(
    (next: number) => {
      const size = Math.max(1, Math.floor(next))
      // Keep the row at the top of the page in view under the new size.
      setPageIndexState((index) => Math.floor((index * pageSize) / size))
      onPageSizeChange(size)
    },
    [pageSize, onPageSizeChange],
  )

  const resetPage = useCallback(() => setPageIndexState(0), [])

  // A server that now reports fewer rows can leave the page past the end.
  useEffect(() => {
    if (pageCount !== undefined && pageIndex > pageCount - 1) setPageIndexState(pageCount - 1)
  }, [pageCount, pageIndex])

  const options = useMemo(
    () =>
      pageSizeOptions.includes(pageSize)
        ? pageSizeOptions
        : [...pageSizeOptions, pageSize].sort((a, b) => a - b),
    [pageSizeOptions, pageSize],
  )

  return {
    enabled,
    pageIndex,
    pageSize,
    pageSizeOptions: options,
    pageCount,
    rowCount,
    setPageIndex,
    setPageSize,
    resetPage,
  }
}
