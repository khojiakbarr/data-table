import { createColumnHelper } from "@tanstack/react-table"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * `toggleGroup` — DEFECT C: expanding a group on a later page must not throw
 * the user back to page 1. Collapsing still resets the page, belt-and-braces
 * (see the comment on `toggleGroup` in useDataTable.ts for why expand and
 * collapse are no longer treated alike).
 *
 * Server mode only, since grouping is server-side; `pagination.pageCount` is
 * derived straight from `rowCount` there, so the page state can be driven and
 * inspected with no rendered DOM.
 */

interface Row {
  id: string
  status: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("status", { header: "Status", size: 100 })]

describe("useDataTable grouping.toggle", () => {
  it("keeps the current page when expanding a group", () => {
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "toggle-expand",
        data: [],
        columns,
        mode: "server",
        rowCount: 1000,
        initialLayout: {
          pageSize: 10,
          grouping: ["status"],
          expanded: [],
        },
      }),
    )

    act(() => result.current.pagination.setPageIndex(4))
    expect(result.current.pagination.pageIndex).toBe(4)

    // "open" is not in `expanded`, so this is an EXPAND.
    act(() => result.current.grouping.toggle(["open"]))

    expect(result.current.grouping.isExpanded(["open"])).toBe(true)
    expect(result.current.pagination.pageIndex).toBe(4)
  })

  it("lands somewhere valid, never past the end, when collapsing a group", () => {
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "toggle-collapse",
        data: [],
        columns,
        mode: "server",
        rowCount: 1000,
        initialLayout: {
          pageSize: 10,
          grouping: ["status"],
          // Already open, so toggling it is a COLLAPSE.
          expanded: [["open"]],
        },
      }),
    )

    act(() => result.current.pagination.setPageIndex(9))
    expect(result.current.pagination.pageIndex).toBe(9)

    act(() => result.current.grouping.toggle(["open"]))

    expect(result.current.grouping.isExpanded(["open"])).toBe(false)
    expect(result.current.pagination.pageIndex).toBe(0)
    expect(result.current.pagination.pageIndex).toBeLessThan(
      result.current.pagination.pageCount ?? Number.POSITIVE_INFINITY,
    )
  })

  it("does nothing when grouping is disabled (client mode)", () => {
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "toggle-disabled",
        data: [],
        columns,
        // Default "client" mode: grouping is server-only, so toggling must
        // be inert rather than throw or silently corrupt page state.
      }),
    )

    act(() => result.current.pagination.setPageIndex(0))
    act(() => result.current.grouping.toggle(["open"]))
    expect(result.current.grouping.isExpanded(["open"])).toBe(false)
  })
})
