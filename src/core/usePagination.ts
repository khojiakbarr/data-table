import { useCallback, useEffect, useMemo, useState } from "react"

/** Inputs to {@link usePagination}. */
export interface UsePaginationOptions {
  enabled: boolean
  /** Rows per page, owned by the layout so it persists. Floored to a whole page. */
  pageSize: number
  pageSizeOptions: readonly number[]
  /** Total rows as of this render, or undefined while a server has not said yet. */
  rowCount: number | undefined
  /**
   * The total as of the latest commit, read when a setter runs.
   *
   * A client-mode table only learns its row count once the table is built,
   * which is after this hook has run, so `rowCount` above can describe the
   * render before this one. A setter runs in an event handler, long after that
   * render was committed, and has to clamp against what is true by then —
   * otherwise a data set that grew leaves Next and Last refusing to move.
   */
  getRowCount: () => number | undefined
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
 * longer exists. The clamp is then written back, so the page the user is
 * looking at is the page the state holds: a total that changes again must
 * move them on from where they are, not from a page they left behind. While
 * the total is unknown — a request in flight — nothing is clamped and nothing
 * is written, so a refetch does not cost the user their place.
 */
export function usePagination({
  enabled,
  pageSize: requestedPageSize,
  pageSizeOptions,
  rowCount,
  getRowCount,
  onPageSizeChange,
}: UsePaginationOptions): PaginationApi {
  const [rawIndex, setRawIndex] = useState(0)

  /*
   * Sanitised here rather than trusted, because every consumer takes it at
   * face value: `Math.ceil(rowCount / pageSize)` below, TanStack's own
   * `rows.slice()`, and the footer's select. A host sizing pages from a
   * container it has not measured yet (`Math.floor(height / rowHeight)`) hands
   * over a 0, and an empty table over a full data set reads as "no data"
   * rather than as the misconfiguration it is.
   */
  const pageSize = normalisePageSize(requestedPageSize)

  const pageCount = useMemo(() => {
    if (!enabled) return 1
    if (rowCount === undefined || !Number.isFinite(rowCount)) return undefined
    return Math.max(1, Math.ceil(rowCount / pageSize))
  }, [enabled, rowCount, pageSize])

  // Clamped during render, not in an effect: no extra commit, no frame where
  // the footer shows "Page 6 of 1", and a server never sees a query for a
  // page that no longer exists.
  const pageIndex = pageCount === undefined ? rawIndex : Math.min(rawIndex, pageCount - 1)

  /*
   * Write the clamp back. It changes nothing on screen — this is the index the
   * render above already used — but it is what stops a derived clamp from
   * being undone later: left alone, a raw index of 19 survives a total of 100
   * as "page 2", and then a total of 200 silently teleports the user to page 4
   * and fetches it. A total of `undefined` states nothing about where the user
   * is, so it commits nothing; nor does a disabled table, whose one page is a
   * consequence of the feature being off rather than of the data.
   *
   * Keyed on the page count, which is the only thing that can put the index
   * out of range: a setter clamps its own argument, and an effect that ran on
   * every render would re-schedule itself forever, since React renders once
   * more even for a state update that changes nothing.
   */
  useEffect(() => {
    if (!enabled || pageCount === undefined) return
    setRawIndex((index) => Math.min(index, pageCount - 1))
  }, [enabled, pageCount])

  /*
   * The last page as of now, not as of the render this callback was built in.
   * `getRowCount` is what makes that distinction possible; see
   * {@link UsePaginationOptions.getRowCount}.
   */
  const lastPage = useCallback(
    (size: number) => {
      const total = getRowCount()
      if (total === undefined || !Number.isFinite(total)) return Number.MAX_SAFE_INTEGER
      return Math.max(1, Math.ceil(total / size)) - 1
    },
    [getRowCount],
  )

  const setPageIndex = useCallback(
    (index: number) => {
      if (!enabled) return
      setRawIndex(Math.max(0, Math.min(index, lastPage(pageSize))))
    },
    [enabled, lastPage, pageSize],
  )

  const setPageSize = useCallback(
    (next: number) => {
      if (!Number.isFinite(next)) return
      const size = normalisePageSize(next)
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
      const size = normalisePageSize(next.pageSize)
      // A disabled table has one page, but the size is still a preference
      // worth persisting for when paging is turned back on.
      if (enabled) setRawIndex(Math.max(0, Math.min(next.pageIndex, lastPage(size))))
      if (size !== pageSize) onPageSizeChange(size)
    },
    [enabled, lastPage, pageSize, onPageSizeChange],
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

/**
 * A usable rows-per-page: a whole number, at least one.
 *
 * @param size - The size as supplied, which may be anything a `number` can be.
 * @returns The size floored to a whole page, or 1 for a value no page can be
 * built from.
 */
function normalisePageSize(size: number): number {
  return Number.isFinite(size) ? Math.max(1, Math.floor(size)) : 1
}
