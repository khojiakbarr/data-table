import type { Row, RowData } from "@tanstack/react-table"
import { useState } from "react"
import type { DataTableFeatures } from "../useDataTable"

type AnyRow<TData extends RowData> = Row<DataTableFeatures, TData>

export interface InfiniteRowsInput<TData extends RowData> {
  /** Cards that scroll on: the pages seen are kept and drawn one after another. Off, the rows pass through. */
  enabled: boolean
  /** The current page's rows, as the table drew them. */
  rows: readonly AnyRow<TData>[]
  pageIndex: number
  pageSize: number
  /** Every row there is, across the pages; undefined while a server table has not said. */
  rowCount: number | undefined
  /** A page is on its way: the rows on hand are still the last page's, so they are not kept as this one's. */
  loading: boolean
  /** The query apart from its page — sorting, filters, search, grouping, the page size: a change starts over. */
  queryKey: string
  setPageIndex: (pageIndex: number) => void
}

export interface InfiniteRows<TData extends RowData> {
  /** The rows of every page kept, in order, each row once. */
  rows: readonly AnyRow<TData>[]
  /** The first page kept: where the rows' numbers start. */
  firstPageIndex: number
  /** There are rows past the last page kept. */
  hasMore: boolean
  /** The next page has been asked for and has not come. */
  isLoadingMore: boolean
  /** Ask for the next page — once the last one asked for has come, and while there is one. */
  loadMore: () => void
}

interface PageStore<TData extends RowData> {
  key: string
  pages: ReadonlyMap<number, readonly AnyRow<TData>[]>
}

/**
 * The pages a list of cards has scrolled through, kept and drawn one after another (0.15.0: a phone's list scrolls
 * on, with no pager under it). Each page is kept as it arrives — not while it is on its way, when the rows on hand
 * are still the last page's — and a change of the query apart from its page starts over, as a step back to an
 * earlier page does (a host's own filter resets the page to the first). A row met on two pages — rows shifted by a
 * write between two asks — is drawn once.
 *
 * Server and client tables alike: a server table is handed each page, a client table slices it, and either way
 * the current page is what the table's row model holds.
 *
 * @param input - See {@link InfiniteRowsInput}.
 * @returns The rows to draw and how to ask for more; with `enabled` off, the page as it is.
 *
 * @example
 * const infinite = useInfiniteRows({ enabled: isCards, rows, pageIndex, pageSize, rowCount, loading, queryKey, setPageIndex })
 */
export function useInfiniteRows<TData extends RowData>(input: InfiniteRowsInput<TData>): InfiniteRows<TData> {
  const { enabled, rows, pageIndex, pageSize, rowCount, loading, queryKey, setPageIndex } = input
  const [store, setStore] = useState<PageStore<TData>>({ key: queryKey, pages: new Map() })

  let pages = store.key === queryKey ? store.pages : new Map<number, readonly AnyRow<TData>[]>()
  // A step back — to the first page, after a filter of the host's changed — leaves only what comes before it.
  if ([...pages.keys()].some((index) => index > pageIndex)) {
    pages = new Map([...pages].filter(([index]) => index <= pageIndex))
  }
  if (enabled && !loading && !sameRows(pages.get(pageIndex), rows)) {
    pages = new Map(pages).set(pageIndex, rows)
  }
  // Kept during the render, as React allows for state derived from props: the next render reads it back unchanged.
  if (pages !== store.pages || store.key !== queryKey) setStore({ key: queryKey, pages })

  if (!enabled) {
    return { rows, firstPageIndex: pageIndex, hasMore: false, isLoadingMore: false, loadMore: () => {} }
  }

  // The run of pages kept that ends at the last one on hand.
  let end = pageIndex
  while (end >= 0 && !pages.has(end)) end -= 1
  let start = end
  while (start > 0 && pages.has(start - 1)) start -= 1

  const seen = new Set<string>()
  const kept: AnyRow<TData>[] = []
  for (let index = start; index <= end; index += 1) {
    for (const row of pages.get(index) ?? []) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      kept.push(row)
    }
  }

  const lastPage = end >= 0 ? (pages.get(end) ?? []) : []
  const hasMore = rowCount !== undefined ? kept.length < rowCount : lastPage.length >= pageSize
  const isLoadingMore = end < pageIndex
  return {
    rows: end >= 0 ? kept : rows,
    firstPageIndex: Math.max(0, start),
    hasMore,
    isLoadingMore,
    loadMore: () => {
      if (hasMore && !loading && end === pageIndex) setPageIndex(pageIndex + 1)
    },
  }
}

/** The same rows — the same ids over the same data — so a render that changed nothing keeps nothing new. */
function sameRows<TData extends RowData>(kept: readonly AnyRow<TData>[] | undefined, rows: readonly AnyRow<TData>[]): boolean {
  if (kept === undefined || kept.length !== rows.length) return false
  return kept.every((row, index) => row.id === rows[index]?.id && row.original === rows[index]?.original)
}
