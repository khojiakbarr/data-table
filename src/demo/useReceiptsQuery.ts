import { useCallback, useEffect, useState } from "react"
import type { TableQuery } from "../core/query"
import { fetchReceipts, type ServerPage } from "./fakeServer"

/** What {@link useReceiptsQuery} hands back to the page. */
export interface ReceiptsQueryResult {
  page: ServerPage | undefined
  /**
   * Starts `true`, not `false`: `useTableQuery` only announces its initial
   * query from a passive effect, one commit after mount, so the first paint
   * happens with `query` still `undefined` and the fetch effect below still
   * unrun. Rows really are on their way in that window, and this is the host
   * saying so — `<DataTable>` holds its skeleton through it regardless, but a
   * host that reported `false` here would be describing itself as idle when
   * it is not.
   */
  loading: boolean
  error: unknown
  retry: () => void
  /** Whether the *next* request is armed to fail, for the playground's own control. */
  failNext: boolean
  setFailNext: (next: boolean) => void
}

/**
 * Run one query against the fake server and keep its answer, loading and
 * error state in sync as `query` changes.
 *
 * Extracted from the fetch effect the filtering-stage demo already proved out
 * (see the regression tests it carried): the one-shot capture-and-disarm of
 * `failNext` as the request goes out — not when it resolves — is what lets a
 * box ticked mid-flight survive an unrelated response, and what stops a
 * failed request re-reading a still-armed flag on retry.
 *
 * @param query - The table's current query, or undefined before the first one lands.
 * @returns The latest page (if any), loading/error state, a retry trigger,
 *   and the fail-next control the playground's own UI offers.
 *
 * @example
 * const { page, loading, error, retry } = useReceiptsQuery(query)
 */
export function useReceiptsQuery(query: TableQuery | undefined): ReceiptsQueryResult {
  const [page, setPage] = useState<ServerPage>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [failNext, setFailNext] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!query) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const shouldFail = failNext
    if (shouldFail) setFailNext(false)
    fetchReceipts(query, { fail: shouldFail })
      .then((result) => {
        if (!cancelled) setPage(result)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    /*
     * `failNext` is read once when the request starts (captured into
     * `shouldFail`) — re-running on every change would refetch the current
     * page for no reason. `attempt` is the deliberate re-run trigger `retry`
     * bumps. This repository has no eslint installed, so there is no
     * react-hooks/exhaustive-deps rule to satisfy here.
     */
  }, [query, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { page, loading, error, retry, failNext, setFailNext }
}
