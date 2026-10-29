import type { Row, RowData } from "@tanstack/react-table"
import { useEffect, useState } from "react"
import type { DataTableFeatures } from "../useDataTable"
import { cutFromAll, fromKept, passThrough, sameRows, type KeptPage } from "./infinitePages"

type AnyRow<TData extends RowData> = Row<DataTableFeatures, TData>

export interface InfiniteRowsInput<TData extends RowData> {
  /** Cards that scroll on: the pages seen are kept and drawn one after another. Off, the rows pass through. */
  enabled: boolean
  /** The current page's rows, as the table drew them. */
  rows: readonly AnyRow<TData>[]
  /**
   * A table that pages its own rows: every row of the result, in the order it pages them, open branches included
   * (`getPrePaginatedRowModel`). The pages scrolled through are cut from it on every render, so they show the data,
   * the open branches and the groups as they are now. Absent — a server table, or one whose host pages it — each
   * page is kept as it arrives.
   */
  allRows?: readonly AnyRow<TData>[] | undefined
  /**
   * The host keys its rows (`getRowId`), so a row met on two pages — rows shifted by a write between two asks — is
   * drawn once. Without it an id is a place on a page, every page has a row "0", and every row is drawn.
   */
  hasRowId: boolean
  pageIndex: number
  pageSize: number
  /** Every row there is, across the pages; undefined while a server table has not said. */
  rowCount: number | undefined
  /** A page is on its way: the rows on hand are still the last page's, so they are not kept as this one's. */
  loading: boolean
  /** The query apart from its page — sorting, filters, search, grouping and open groups, the page size. */
  queryKey: string
  setPageIndex: (pageIndex: number) => void
}

export interface InfiniteRows<TData extends RowData> {
  /** The rows of every page kept, in order, each row once. */
  rows: readonly AnyRow<TData>[]
  /** A key per row, unique across the pages kept, for a list that draws them. */
  keys: readonly string[]
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
  pages: ReadonlyMap<number, KeptPage<TData>>
}

/**
 * The pages a list of cards has scrolled through, drawn one after another (0.15.0: a phone's list scrolls on, with
 * no pager under it).
 *
 * A table that pages its own rows holds all of them, so the pages are cut from its row model on every render and
 * nothing is kept: an edit, an open branch or an open group on an earlier page shows at once. A server table is
 * handed one page at a time, so each is kept as it arrives — not while it is on its way, when the rows on hand are
 * still the last page's. A kept page holds its top-level rows and opens their branches as the table's expansion
 * says now, so a tree opened on an earlier page shows its children. A kept page is otherwise what the server sent
 * then: a host that changes a row on an earlier page changes the query (or refetches from the first page) to see it.
 *
 * A server list always runs from the first page: a change of the query apart from its page starts over there, and
 * so does a list that opens on a later page (cards switched on at page 3).
 *
 * @param input - See {@link InfiniteRowsInput}.
 * @returns The rows to draw and how to ask for more; with `enabled` off, the page as it is.
 *
 * @example
 * const infinite = useInfiniteRows({ enabled: isCards, rows, allRows, hasRowId, pageIndex, pageSize, rowCount, loading, queryKey, setPageIndex })
 */
export function useInfiniteRows<TData extends RowData>(input: InfiniteRowsInput<TData>): InfiniteRows<TData> {
  const { enabled, rows, allRows, pageIndex, pageSize, loading, queryKey, setPageIndex } = input
  const isKept = enabled && allRows === undefined
  const [store, setStore] = useState<PageStore<TData>>({ key: queryKey, pages: new Map() })

  let pages = store.key === queryKey ? store.pages : new Map<number, KeptPage<TData>>()
  // A step back — to the first page, after a filter of the host's changed — leaves only what comes before it.
  if ([...pages.keys()].some((index) => index > pageIndex)) {
    pages = new Map([...pages].filter(([index]) => index <= pageIndex))
  }
  const topLevel = isKept ? rows.filter((row) => row.depth === 0) : rows
  /*
   * The rows on hand are still the page before's: a host hears of the new page
   * in an effect, so its `loading` comes a render late, and a query library
   * keeping the previous data hands the same rows back meanwhile. No server
   * sends the very same rows as two pages.
   */
  const isPageBefore = sameRows(pages.get(pageIndex - 1), topLevel)
  if (isKept && !loading && !isPageBefore && !sameRows(pages.get(pageIndex), topLevel)) {
    pages = new Map(pages).set(pageIndex, topLevel)
  }
  // Kept during the render, as React allows for state derived from props: the next render reads it back unchanged.
  if (pages !== store.pages || store.key !== queryKey) setStore({ key: queryKey, pages })

  // A server list that does not reach back to the first page asks for it: rows before the run would never come.
  const isCutOff = isKept && pageIndex > 0 && !pages.has(pageIndex - 1)
  useEffect(() => {
    if (isCutOff) setPageIndex(0)
  }, [isCutOff, setPageIndex])

  if (!enabled) return passThrough(rows, pageIndex)
  if (allRows !== undefined) return cutFromAll(allRows, pageIndex, pageSize, setPageIndex)
  return fromKept(pages, input)
}
