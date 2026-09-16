import type { SortingState } from "@tanstack/react-table"
import { useEffect, useRef } from "react"
import { buildQuery, queriesEqual, type TableQuery } from "./query"

/** Inputs to {@link useTableQuery}. */
export interface UseTableQueryOptions {
  /**
   * The sort order, which must be identity-stable across renders that did not
   * change it — otherwise every render produces a new query and a host keyed
   * on it refetches forever. `useArrangement` guarantees this.
   */
  sorting: SortingState
  pageIndex: number
  pageSize: number
  /** Called with the initial query on mount and after every change to it. */
  onQueryChange?: ((query: TableQuery) => void) | undefined
}

/**
 * The request the table wants answered, and the callback that announces it.
 *
 * The returned object is the host's fetch key, so its identity is the contract:
 * it changes exactly when the request would, and not once more. That is what
 * lets a host drop it straight into a dependency array.
 *
 * `onQueryChange` fires once on mount — twice in development under
 * `StrictMode`, which mounts effects twice on purpose — and once per change
 * thereafter. It is held in a ref, so an inline arrow does not refire it, and
 * a host that echoes the query back into its own state does not either: the
 * resulting render produces the same query object.
 *
 * A fresh query is built every render — cheap, at this shape — and compared
 * against the previous one with {@link queriesEqual} rather than trusted to a
 * `useMemo` cache: React is explicit that a memo may be discarded and
 * recomputed for a render that changed none of its inputs, and a discarded
 * cache here would hand back a structurally identical but referentially new
 * object, which the effect below would read as a real change and re-announce.
 * A plain `useRef` has no such discard, so holding the last query there is
 * what actually keeps the identity — and the announcements — stable.
 *
 * In client mode, a row count that shrinks below the current page is corrected
 * before paint, but the query for the transient page is still announced once;
 * hosts that mirror the query into a URL should treat consecutive
 * announcements as replaceable.
 *
 * @param options - See {@link UseTableQueryOptions}.
 * @returns The current query, stable between renders that did not change it.
 *
 * @example
 * const query = useTableQuery({ sorting, pageIndex, pageSize, onQueryChange })
 * const { data } = useQuery({ queryKey: ["rows", query], queryFn: fetchRows })
 */
export function useTableQuery({
  sorting,
  pageIndex,
  pageSize,
  onQueryChange,
}: UseTableQueryOptions): TableQuery {
  const candidate = buildQuery({ sorting, pageIndex, pageSize })
  const queryRef = useRef<TableQuery | undefined>(undefined)
  if (queryRef.current === undefined || !queriesEqual(queryRef.current, candidate)) {
    queryRef.current = candidate
  }
  const query = queryRef.current

  /*
   * Updated in an effect rather than during render: a render can be thrown
   * away, and writing to a ref in one that is would leave the table announcing
   * its query to a callback that never committed.
   */
  const onQueryChangeRef = useRef(onQueryChange)
  useEffect(() => {
    onQueryChangeRef.current = onQueryChange
  })

  useEffect(() => {
    onQueryChangeRef.current?.(query)
  }, [query])

  return query
}
