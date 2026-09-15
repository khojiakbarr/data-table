import { createColumnHelper } from "@tanstack/react-table"
import { useCallback, useEffect, useState } from "react"
import { DataTable } from "../components/DataTable"
import type { TableQuery } from "../core/query"
import { localStorageLayout } from "../core/persistence"
import { useDataTable, type DataTableFeatures } from "../useDataTable"
import { fetchReceipts, type ServerPage, type ServerReceipt } from "./fakeServer"

const storage = localStorageLayout()
const columnHelper = createColumnHelper<DataTableFeatures, ServerReceipt>()
const columns = [
  columnHelper.accessor("code", { header: "Kod", size: 120 }),
  columnHelper.accessor("partner", { header: "Kontragent", size: 260 }),
  columnHelper.accessor("amount", {
    header: "Summa",
    size: 160,
    cell: (info) => <span className="num">{info.getValue().toLocaleString("ru-RU")}</span>,
  }),
  columnHelper.accessor("status", { header: "Holat", size: 130 }),
  columnHelper.accessor("date", { header: "Sana", size: 120 }),
]
const EMPTY: ServerReceipt[] = []

/**
 * Server mode against a fake endpoint: every sort or page change becomes a
 * query, the "server" answers after 300 ms, and a checkbox makes the next
 * request fail so the error state can be seen.
 */
export function ServerDemo() {
  const [query, setQuery] = useState<TableQuery>()
  const [page, setPage] = useState<ServerPage>()
  /*
   * Starts `true`, not `false`: `useTableQuery` only announces its initial
   * query from a passive effect, one commit after mount, so the first paint
   * happens with `query` still `undefined` and the fetch-effect below still
   * unrun. Starting `false` would make that first commit render with
   * loading=false, rows=[], error=null — DataTable's `showEmpty` reads that
   * as "no rows", and the table flashes "No rows" before the skeleton. This
   * cannot leave a stuck spinner: `useDataTable` guarantees a query lands on
   * mount, so the fetch effect always runs and clears `loading`.
   */
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [failNext, setFailNext] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!query) return
    let cancelled = false
    setLoading(true)
    setError(null)
    // One-shot: capture and disarm as the request goes out, not when it
    // resolves. Disarming on success only would leave the flag `true` after a
    // failure, so a retry read it again and failed forever; disarming here
    // instead also stops the flag being cleared out from under a checkbox the
    // user ticked *during* an in-flight (about-to-succeed) request.
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
     * `failNext` is intentionally left out of the dependency array: it is
     * read once when the request starts (captured into `shouldFail`), and
     * re-running the effect whenever it changes would refetch the current
     * page for no reason. `attempt` is the deliberate re-run trigger, bumped
     * by `retry`. This repository has no eslint installed, so there is no
     * react-hooks/exhaustive-deps rule to satisfy here.
     */
  }, [query, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  const table = useDataTable({
    id: "demo-server",
    columns,
    data: page?.rows ?? EMPTY,
    mode: "server",
    // `rowCount` is undefined until the first page resolves; under
    // exactOptionalPropertyTypes the key must be omitted rather than set to
    // an explicit `undefined` for that "not known yet" state.
    ...(page ? { rowCount: page.total } : {}),
    getRowId: (row) => row.id,
    onQueryChange: setQuery,
    storage,
  })

  return (
    <>
      <label className="hint">
        <input type="checkbox" checked={failNext} onChange={(event) => setFailNext(event.target.checked)} /> Keyingi
        so'rov xato bilan qaytsin
      </label>
      <DataTable instance={table} height={420} striped loading={loading} error={error} onRetry={retry} />
    </>
  )
}
