import type { Row, RowData } from "@tanstack/react-table"
import type { DataTableFeatures } from "../useDataTable"
import type { InfiniteRows, InfiniteRowsInput } from "./useInfiniteRows"

type AnyRow<TData extends RowData> = Row<DataTableFeatures, TData>

/** A server page as kept: its top-level rows, whose open branches are read afresh on every render. */
export type KeptPage<TData extends RowData> = readonly AnyRow<TData>[]

/** Infinite scrolling off: the page as it is. */
export function passThrough<TData extends RowData>(rows: readonly AnyRow<TData>[], pageIndex: number): InfiniteRows<TData> {
  return { rows, keys: rows.map((row) => row.id), firstPageIndex: pageIndex, hasMore: false, isLoadingMore: false, loadMore: () => {} }
}

/** A table that pages its own rows: every page up to the current one, cut from the rows as they are now. */
export function cutFromAll<TData extends RowData>(
  allRows: readonly AnyRow<TData>[],
  pageIndex: number,
  pageSize: number,
  setPageIndex: (pageIndex: number) => void,
): InfiniteRows<TData> {
  const end = Math.min(allRows.length, (pageIndex + 1) * pageSize)
  const rows = allRows.slice(0, end)
  const hasMore = end < allRows.length
  return {
    rows,
    keys: rows.map((row) => row.id),
    firstPageIndex: 0,
    hasMore,
    isLoadingMore: false,
    loadMore: () => {
      if (hasMore) setPageIndex(pageIndex + 1)
    },
  }
}

/** A server table: the run of kept pages that ends at the last one on hand, their open branches opened. */
export function fromKept<TData extends RowData>(
  pages: ReadonlyMap<number, KeptPage<TData>>,
  { rows: current, hasRowId, pageIndex, pageSize, rowCount, loading, setPageIndex }: InfiniteRowsInput<TData>,
): InfiniteRows<TData> {
  let end = pageIndex
  while (end >= 0 && !pages.has(end)) end -= 1
  if (end < 0) return { ...passThrough(current, pageIndex), hasMore: false }
  let start = end
  while (start > 0 && pages.has(start - 1)) start -= 1

  const seen = new Set<string>()
  const rows: AnyRow<TData>[] = []
  const keys: string[] = []
  let topLevelCount = 0
  for (let index = start; index <= end; index += 1) {
    for (const row of withOpenBranches(pages.get(index) ?? [])) {
      if (hasRowId && seen.has(row.id)) continue
      seen.add(row.id)
      rows.push(row)
      keys.push(hasRowId ? row.id : `${String(index)}:${row.id}`)
      if (row.depth === 0) topLevelCount += 1
    }
  }

  const lastPage = pages.get(end) ?? []
  // The server counts top-level rows: an open branch's children are not rows of its pages.
  const hasMore = rowCount !== undefined ? topLevelCount < rowCount : lastPage.length >= pageSize
  return {
    rows,
    keys,
    firstPageIndex: start,
    hasMore,
    isLoadingMore: end < pageIndex,
    loadMore: () => {
      if (hasMore && !loading && end === pageIndex) setPageIndex(pageIndex + 1)
    },
  }
}

/** Top-level rows with every open branch under them, as the table's expansion says now — the order a table draws. */
function withOpenBranches<TData extends RowData>(topLevel: KeptPage<TData>): AnyRow<TData>[] {
  const out: AnyRow<TData>[] = []
  const visit = (row: AnyRow<TData>) => {
    out.push(row)
    if (row.subRows.length > 0 && row.getIsExpanded()) row.subRows.forEach(visit)
  }
  topLevel.forEach(visit)
  return out
}

/** The same rows — the same ids over the same data — so a render that changed nothing keeps nothing new. */
export function sameRows<TData extends RowData>(kept: KeptPage<TData> | undefined, rows: readonly AnyRow<TData>[]): boolean {
  if (kept === undefined || kept.length !== rows.length) return false
  return kept.every((row, index) => row.id === rows[index]?.id && row.original === rows[index]?.original)
}
