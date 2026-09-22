import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TableQuery } from "../core/query"
import { isGroupRow, type ServerPage } from "./fakeServer"
import { useReceiptsQuery } from "./useReceiptsQuery"

/**
 * The two halves of the hook's superseded-request handling, which the page
 * test cannot see.
 *
 * They answer different questions and both are load-bearing: the abort signal
 * stops a query the table has moved past from occupying the server at all, and
 * the `cancelled` flag stops whatever that request still resolves with from
 * landing in state. Either one deleted leaves the other covering for it in the
 * happy path, so each needs a case that removes the other's cover — which is
 * what the controllable server below is for.
 */

/** One request the test resolves by hand, so ordering is the thing under test. */
interface PendingRequest {
  query: TableQuery
  signal: AbortSignal | undefined
  resolve: (page: ServerPage) => void
  reject: (reason: unknown) => void
}

let pending: PendingRequest[] = []

vi.mock("./fakeServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fakeServer")>()
  return {
    ...actual,
    fetchReceipts: (query: TableQuery, options: { signal?: AbortSignal } = {}) =>
      new Promise<ServerPage>((resolve, reject) => {
        pending.push({ query, signal: options.signal, resolve, reject })
      }),
  }
})

const queryFor = (pageIndex: number): TableQuery => ({
  sorting: [],
  filters: [],
  search: null,
  grouping: [],
  expanded: [],
  pagination: { pageIndex, pageSize: 50 },
})

const pageOf = (code: string): ServerPage => ({
  rows: [{ id: code, code, partner: null, amount: null, status: "open", date: "2026-01-01", flagged: false }],
  total: 100,
  // Ungrouped, so the first row sits inside no group.
  startPath: [],
  unfilteredTotal: 100,
})

/** The request the hook has open for that page, once its effect has run. */
const requestFor = (pageIndex: number): PendingRequest => {
  const found = pending.find((request) => request.query.pagination.pageIndex === pageIndex)
  if (!found) throw new Error(`no request for page ${pageIndex}`)
  return found
}

beforeEach(() => {
  pending = []
})

describe("useReceiptsQuery", () => {
  it("aborts the request the table has already moved past", async () => {
    const { rerender } = renderHook(({ query }) => useReceiptsQuery(query), {
      initialProps: { query: queryFor(0) },
    })
    await waitFor(() => expect(pending).toHaveLength(1))

    rerender({ query: queryFor(1) })
    await waitFor(() => expect(pending).toHaveLength(2))

    // Without the signal reaching `fetchReceipts`, a superseded query runs to
    // completion against the server and is merely ignored on arrival.
    expect(requestFor(0).signal).toBeDefined()
    expect(requestFor(0).signal?.aborted).toBe(true)
    expect(requestFor(1).signal?.aborted).toBe(false)
  })

  it("ignores a superseded request that answers late", async () => {
    const { result, rerender } = renderHook(({ query }) => useReceiptsQuery(query), {
      initialProps: { query: queryFor(0) },
    })
    await waitFor(() => expect(pending).toHaveLength(1))

    rerender({ query: queryFor(1) })
    await waitFor(() => expect(pending).toHaveLength(2))

    await act(async () => {
      requestFor(1).resolve(pageOf("KR-current"))
    })
    // Page 0's answer arrives after page 1's — a slow query two keystrokes out
    // of date. Only the `cancelled` guard keeps it out of state.
    await act(async () => {
      requestFor(0).resolve(pageOf("KR-stale"))
    })

    const first = result.current.page?.rows[0]
    expect(first !== undefined && !isGroupRow(first) ? first.code : undefined).toBe("KR-current")
  })

  it("keeps a deliberate abort out of the error banner", async () => {
    const { result, rerender } = renderHook(({ query }) => useReceiptsQuery(query), {
      initialProps: { query: queryFor(0) },
    })
    await waitFor(() => expect(pending).toHaveLength(1))

    rerender({ query: queryFor(1) })
    await waitFor(() => expect(pending).toHaveLength(2))

    // Aborting rejects, so the `catch` runs for a request we killed ourselves;
    // an AbortError in the banner would tell the user a healthy table failed.
    await act(async () => {
      requestFor(0).reject(new DOMException("Aborted", "AbortError"))
    })
    await act(async () => {
      requestFor(1).resolve(pageOf("KR-current"))
    })

    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it("arms the failure once, as the request goes out", async () => {
    const { result } = renderHook(({ query }) => useReceiptsQuery(query), {
      initialProps: { query: queryFor(0) },
    })
    await waitFor(() => expect(pending).toHaveLength(1))
    await act(async () => {
      requestFor(0).resolve(pageOf("KR-first"))
    })

    act(() => result.current.setFailNext(true))
    expect(result.current.failNext).toBe(true)

    act(() => result.current.retry())
    // Disarmed by the request that read it, so a retry after a failure is not
    // itself armed to fail.
    await waitFor(() => expect(result.current.failNext).toBe(false))
  })
})
