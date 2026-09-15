import { createColumnHelper } from "@tanstack/react-table"
import { act, render, screen } from "@testing-library/react"
import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import type { TableQuery } from "./core/query"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * The README's server-mode recipe, mounted as a host would copy it.
 *
 * `useTableQuery` announces the first query from a passive effect, one commit
 * after mount, so a server table always commits at least one render with no
 * rows, no error and `loading === false`. Nothing about that commit says "the
 * server has nothing"; it says "nobody has asked yet". These tests pin the
 * table to the skeleton for every commit before the first answer.
 */

interface Receipt {
  id: string
  code: string
}

interface ReceiptPage {
  rows: Receipt[]
  total: number
}

const helper = createColumnHelper<DataTableFeatures, Receipt>()
const columns = [helper.accessor("code", { header: "Code", size: 120 })]
/** Stable identity, exactly as the README recipe declares it. */
const EMPTY: Receipt[] = []

const onePage: ReceiptPage = {
  rows: [{ id: "r1", code: "KR-1" }],
  total: 1,
}
const noRowsPage: ReceiptPage = { rows: [], total: 0 }

/**
 * How a host's fetching library reports an in-flight request.
 *
 * - `"optimistic"` is TanStack Query: `useQuery` computes its result during
 *   render, so the render that first enables the query already reports
 *   `isFetching === true`.
 * - `"deferred"` is a hand-rolled `useEffect` fetch (what `ServerDemo` does):
 *   `loading` only turns true one commit later, which opens a second window
 *   in which the host still reports `loading === false` with no rows.
 */
type FetchTiming = "optimistic" | "deferred"

interface FakeQueryOptions {
  query: TableQuery | undefined
  page: ReceiptPage
  timing: FetchTiming
}

/**
 * A stand-in for `useQuery({ enabled: query !== undefined })`.
 *
 * Mirrors the part of TanStack Query's contract this defect lives in: while
 * the query is disabled it reports `isFetching === false`, `data === undefined`
 * and `error === null` — the exact combination `DataTable` used to read as
 * "no rows".
 *
 * @param options - The query to answer, the page to answer it with, and when
 *   the request is allowed to report itself as in flight.
 * @returns The subset of a query result the README recipe passes on.
 */
function useFakeQuery({ query, page, timing }: FakeQueryOptions) {
  const [data, setData] = useState<ReceiptPage>()
  const [error] = useState<unknown>(null)
  const [fetching, setFetching] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const enabled = query !== undefined

  useEffect(() => {
    if (!enabled) return
    setFetching(true)
    let cancelled = false
    void Promise.resolve(page).then((result) => {
      if (cancelled) return
      setData(result)
      setFetching(false)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, query, page, attempt])

  const refetch = useCallback(() => setAttempt((n) => n + 1), [])
  const isFetching = fetching || (timing === "optimistic" && enabled && data === undefined)
  return { data, isFetching, error, refetch }
}

/**
 * Reports every commit, before paint, with the DOM already updated.
 *
 * Rendered from inside the table's own component, so that it re-renders — and
 * re-runs its layout effect — on every one of the host's commits. Handed to it
 * as an already-built element instead, React would reuse that element
 * unchanged and only the mount commit would ever be seen.
 */
function CommitProbe({ onCommit }: { onCommit: () => void }) {
  useLayoutEffect(() => {
    onCommit()
  })
  return null
}

interface RecipeProps {
  page?: ReceiptPage
  timing?: FetchTiming
  onCommit?: (() => void) | undefined
}

/** README.md's server-mode recipe, copied rather than paraphrased. */
function ReceiptsTable({ page = onePage, timing = "optimistic", onCommit }: RecipeProps) {
  const [query, setQuery] = useState<TableQuery>()
  const { data, isFetching, error, refetch } = useFakeQuery({ query, page, timing })
  const table = useDataTable<Receipt>({
    id: `readme-${timing}-${page.total}`,
    columns,
    mode: "server",
    data: data?.rows ?? EMPTY,
    ...(data ? { rowCount: data.total } : {}),
    getRowId: (row) => row.id,
    onQueryChange: setQuery,
  })
  return (
    <>
      <DataTable
        instance={table}
        loading={isFetching}
        error={error}
        onRetry={refetch}
        virtualize={false}
      />
      {onCommit ? <CommitProbe onCommit={onCommit} /> : null}
    </>
  )
}

describe("server mode first paint", () => {
  it("never paints the empty state on the very first commit", () => {
    // `renderToStaticMarkup` runs no effects at all, which is exactly the
    // pre-effect state a real first paint commits — RTL's `render()` flushes
    // effects inside `act()` and would hide the flash.
    const markup = renderToStaticMarkup(<ReceiptsTable />)
    expect(markup).not.toContain("dt-empty")
    expect(markup).not.toContain("No rows")
    expect(markup).toContain("dt-skeleton-row")
  })

  it.each<FetchTiming>(["optimistic", "deferred"])(
    "never commits the empty state before the first page arrives (%s host)",
    async (timing) => {
      const commits: string[] = []
      // The live document, not `render()`'s return value: the probe runs
      // during the first commit, before `render()` has returned anything.
      const record = () => commits.push(document.body.innerHTML)

      await act(async () => {
        render(<ReceiptsTable timing={timing} onCommit={record} />)
      })

      expect(commits.length).toBeGreaterThan(1)
      expect(commits.filter((html) => html.includes("dt-empty"))).toEqual([])
      expect(commits[0]).toContain("dt-skeleton-row")
      expect(screen.getByText("KR-1")).toBeInTheDocument()
    },
  )

  it("shows the empty state once the server answers with no rows", async () => {
    await act(async () => {
      render(<ReceiptsTable page={noRowsPage} />)
    })
    expect(screen.getByText("No rows")).toBeInTheDocument()
  })

  it("keeps the skeleton for a server host that reports nothing at all", () => {
    /*
     * The deliberate other side of the guarantee, pinned so it is changed on
     * purpose rather than by accident: no rows, no `rowCount`, no `error` and
     * no `loading` is a host that has said nothing about the page it was asked
     * for. "Still waiting" is the honest reading of that; claiming the server
     * came back empty would be a guess.
     */
    function Silent() {
      const table = useDataTable<Receipt>({
        id: "silent-server",
        columns,
        mode: "server",
        data: EMPTY,
        getRowId: (row) => row.id,
      })
      return <DataTable instance={table} virtualize={false} />
    }

    const { container } = render(<Silent />)
    expect(container.querySelectorAll("tr.dt-skeleton-row").length).toBeGreaterThan(0)
    expect(screen.queryByText("No rows")).toBeNull()
  })
})
