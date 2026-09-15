import { useCallback, useMemo, useState } from "react"

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
  /** Set both at once; the index is clamped against the page count of the NEW size. */
  setPagination: (next: { pageIndex: number; pageSize: number }) => void
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
 *
 * The returned `pageIndex` is clamped to `pageCount - 1` during render
 * rather than in an effect, so there is no extra commit and no frame where
 * the footer reads "Page 6 of 1" or a query goes out for a page that no
 * longer exists. In server mode the raw index behind it survives a row count
 * that dips and recovers, restoring the user's original position; in client
 * mode the shell commits the clamp instead, because the count only exists
 * once the table is built (see `useDataTable`).
 */
export function usePagination({
  enabled,
  pageSize,
  pageSizeOptions,
  rowCount,
  onPageSizeChange,
}: UsePaginationOptions): PaginationApi {
  const [rawIndex, setRawIndex] = useState(0)

  const pageCount = useMemo(() => {
    if (!enabled) return 1
    if (rowCount === undefined || !Number.isFinite(rowCount)) return undefined
    return Math.max(1, Math.ceil(rowCount / pageSize))
  }, [enabled, rowCount, pageSize])

  // Clamped during render, not in an effect: no extra commit, no frame where
  // the footer shows "Page 6 of 1", and a server never sees a query for a
  // page that no longer exists. The raw index is left alone so a row count
  // that dips and recovers does not lose the user's place until they act.
  const pageIndex = pageCount === undefined ? rawIndex : Math.min(rawIndex, pageCount - 1)

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
      setRawIndex(clamp(index))
    },
    [enabled, clamp],
  )

  const setPageSize = useCallback(
    (next: number) => {
      if (!Number.isFinite(next)) return
      const size = Math.max(1, Math.floor(next))
      // Keep the row at the top of the page in view under the new size.
      setRawIndex(Math.floor((pageIndex * pageSize) / size))
      onPageSizeChange(size)
    },
    [pageIndex, pageSize, onPageSizeChange],
  )

  /*
   * A size change that carries its own index. Clamping against `pageCount`
   * would use the OLD size's page count and throw the caller's index away —
   * `setPagination({ pageIndex: 7, pageSize: 20 })` would land on page 0 — so
   * the last page is recomputed here from the size being set.
   */
  const setPagination = useCallback(
    (next: { pageIndex: number; pageSize: number }) => {
      if (!Number.isFinite(next.pageSize)) return
      const size = Math.max(1, Math.floor(next.pageSize))
      const last =
        rowCount === undefined || !Number.isFinite(rowCount)
          ? Number.MAX_SAFE_INTEGER
          : Math.max(1, Math.ceil(rowCount / size)) - 1
      // A disabled table has one page, but the size is still a preference
      // worth persisting for when paging is turned back on.
      if (enabled) setRawIndex(Math.max(0, Math.min(next.pageIndex, last)))
      if (size !== pageSize) onPageSizeChange(size)
    },
    [enabled, rowCount, pageSize, onPageSizeChange],
  )

  const resetPage = useCallback(() => setRawIndex(0), [])

  const optionsKey = pageSizeOptions.join(",")
  const options = useMemo(
    () =>
      pageSizeOptions.includes(pageSize)
        ? pageSizeOptions
        : [...pageSizeOptions, pageSize].sort((a, b) => a - b),
    /*
     * `optionsKey` stands in for the array's contents. A caller writing
     * `pageSizeOptions={[20, 50]}` inline passes a new array every render, and
     * keying on its identity would make this hook's whole result new every
     * render — which defeats the memo below and every memo built on it.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [optionsKey, pageSize],
  )

  // Memoised so the object itself is stable between renders that changed
  // nothing. Callers spread it into their own memos; a fresh literal here would
  // make every one of those a no-op.
  return useMemo(
    () => ({
      enabled,
      pageIndex,
      pageSize,
      pageSizeOptions: options,
      pageCount,
      rowCount,
      setPageIndex,
      setPageSize,
      setPagination,
      resetPage,
    }),
    [
      enabled,
      pageIndex,
      pageSize,
      options,
      pageCount,
      rowCount,
      setPageIndex,
      setPageSize,
      setPagination,
      resetPage,
    ],
  )
}
