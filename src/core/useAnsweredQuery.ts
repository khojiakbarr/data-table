import { useRef } from "react"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

/** Inputs to {@link useAnsweredQuery}. */
export interface AnsweredQueryOptions {
  /**
   * What the caller is waiting for an answer to, compared with `!==`.
   *
   * The query object itself is the obvious thing to pass: its identity is the
   * contract `useTableQuery` maintains, changing exactly when the request
   * would. A caller that only cares about part of the request passes a value
   * key built from that part instead — an object identity cannot serve there,
   * because a fresh query is minted whenever *any* part of it changes, so a
   * page turn would read as a new question (see `QuickSearch`'s match key).
   */
  query: unknown
  /** The rows the host handed the table this render, by reference. */
  data: unknown
  /** The host's `rowCount` this render; `undefined` until it has reported one. */
  rowCount: number | undefined
  /** The host's `loading` prop this render; `false` when it passes none. */
  loading: boolean
}

/**
 * Whether the rows and counts on screen belong to the query on the wire.
 *
 * Server mode asks before it can show anything, and the asking is one commit
 * behind the showing: a settled search changes `query` during render, while
 * `onQueryChange` fires from a passive effect *after* that commit. So on the
 * render where a new search first exists, every number the table is holding —
 * `rowCount` above all — still answers the query before it. Anything that
 * reads one of those numbers out to the user has to know that.
 *
 * An answer is what the host does next: new rows, a different `rowCount`, or
 * `loading` going back to false after it was true. Any one of them means the
 * host has moved on to the new request; until one arrives this is false, and
 * the honest thing to say is that the answer is not in yet.
 *
 * A host that answers with byte-identical rows, an identical `rowCount` and no
 * `loading` at all says nothing this can read, and this stays false. That is
 * the safe direction: a caller then withholds a number rather than reading out
 * one that belongs to a query the user has already replaced.
 *
 * @param options - See {@link AnsweredQueryOptions}.
 * @returns True once the host has answered the query currently on the wire.
 *
 * @example
 * const answered = useAnsweredQuery({ query: instance.query, data, rowCount, loading })
 */
export function useAnsweredQuery({ query, data, rowCount, loading }: AnsweredQueryOptions): boolean {
  /*
   * Latched in an effect rather than during render, for the reason
   * `useAwaitingFirstPage` gives: a render can be thrown away, and a throwaway
   * render that recorded "answered" would let the next committed one read out
   * a number nobody has confirmed. What this render can see is derived from
   * its own arguments below, so the ref only ever remembers what a *committed*
   * render already knew.
   */
  const lastRef = useRef<{
    query: unknown
    data: unknown
    rowCount: number | undefined
    loading: boolean
    answered: boolean
  } | null>(null)
  const last = lastRef.current

  const answered =
    last === null
      ? // Mount: the first query has not been announced yet, let alone answered.
        false
      : last.query !== query
        ? // Announced this very commit — from a passive effect that has not run
          // yet — so no answer to it can exist.
          false
        : last.answered || last.data !== data || last.rowCount !== rowCount || (last.loading && !loading)

  useIsomorphicLayoutEffect(() => {
    lastRef.current = { query, data, rowCount, loading, answered }
  })

  return answered
}
