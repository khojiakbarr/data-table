import { useRef } from "react"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

/** Inputs to {@link useAwaitingFirstPage}. */
export interface AwaitingFirstPageOptions {
  /** Server mode. A client table holds all its rows already, so it is never waiting. */
  server: boolean
  /** Rows the table is rendering this commit. */
  rows: number
  /** The host's `rowCount`: a number once a page has been counted, undefined until then. */
  rowCount: number | undefined
  /** The host's `loading` prop this render. */
  loading: boolean
  /** Whether the host's `error` prop holds something this render. */
  hasError: boolean
}

/**
 * Whether a server table's first query is still unanswered.
 *
 * A server table asks before it can show anything: the initial query is
 * announced from a passive effect, one commit after mount, and the host then
 * needs at least one more commit to report its request. Every one of those
 * commits has no rows, no error and `loading === false` — which reads exactly
 * like "the server has nothing", and would paint the empty state before anyone
 * had fetched. This is the difference between the two.
 *
 * An answer is anything the host can say about the page it was asked for:
 * rows, a `rowCount` (0 counts — an empty page is an answer), an error, or
 * `loading` turning true. The first of those latches, so the empty state is
 * available from then on, including for a page that legitimately comes back
 * with nothing.
 *
 * A server table whose host reports none of the four says nothing the library
 * can read, and keeps its skeleton. That is the honest rendering of "asked,
 * never answered" — and passing `rowCount` in server mode is required for a
 * working footer anyway.
 *
 * @param options - See {@link AwaitingFirstPageOptions}.
 * @returns True while a server table has had no answer to its first query.
 *
 * @example
 * const awaitingFirstPage = useAwaitingFirstPage({ server, rows: rows.length, rowCount, loading, hasError })
 * const showEmpty = !loading && !awaitingFirstPage && !hasError && rows.length === 0
 */
export function useAwaitingFirstPage({
  server,
  rows,
  rowCount,
  loading,
  hasError,
}: AwaitingFirstPageOptions): boolean {
  /*
   * Latched in an effect rather than during render: a render can be thrown
   * away, and a throwaway render that latched "answered" would let the next
   * committed one paint an empty state for a page nobody has received. What
   * this render can see is read from its own props below, so the ref only ever
   * has to remember what a *committed* render already knew.
   */
  const answeredRef = useRef(false)
  const answered =
    answeredRef.current || loading || hasError || rows > 0 || rowCount !== undefined

  useIsomorphicLayoutEffect(() => {
    answeredRef.current = answered
  })

  return server && !answered
}
