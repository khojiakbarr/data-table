import { createColumnHelper } from "@tanstack/react-table"
import { act, render, renderHook, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import { localStorageLayout } from "./core/persistence"
import { useDataTable, type DataTableFeatures } from "./useDataTable"
import type { DataTableFeatureFlags, TableLayout } from "./types"

/**
 * `DataTableFeatureFlags.grouping`, end to end: a server host whose backend
 * cannot group turns grouping off, and the table stops claiming it can.
 *
 * Every downstream consumer of grouping reads `useDataTable`'s own
 * `groupingEnabled`, which is `isServer && flags.grouping` — see the comment
 * on that line. These tests exercise the consumers rather than the boolean
 * itself: the Row groups zone, the per-column toggle, the wire, the stored
 * layout, column visibility, the status bar and selection's count.
 */

interface Row {
  id: string
  name: string
  status: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 120 }),
  helper.accessor("status", { header: "Status", size: 120 }),
]

const rows: Row[] = [
  { id: "r0", name: "Row 0", status: "open" },
  { id: "r1", name: "Row 1", status: "closed" },
]

interface HarnessProps {
  id?: string
  data?: Row[]
  grouping?: boolean
  statusBar?: boolean
  initialLayout?: Partial<TableLayout>
  storage?: ReturnType<typeof localStorageLayout>
  features?: DataTableFeatureFlags
}

function useHarness({
  id = "grp-flag",
  data = rows,
  grouping = false,
  statusBar = false,
  initialLayout,
  storage,
  features,
}: HarnessProps) {
  return useDataTable<Row>({
    id,
    columns,
    data,
    mode: "server",
    rowCount: data.length,
    getRowId: (row) => row.id,
    features: features ?? { grouping, statusBar },
    ...(initialLayout === undefined ? {} : { initialLayout }),
    ...(storage === undefined ? {} : { storage }),
  })
}

function Harness(props: HarnessProps) {
  const instance = useHarness(props)
  return <DataTable instance={instance} virtualize={false} />
}

async function openColumnsPanel() {
  const user = userEvent.setup()
  await user.click(screen.getByRole("tab", { name: "Columns" }))
}

beforeEach(() => localStorage.clear())

describe("grouping: false, in server mode", () => {
  it("renders no Row groups zone and no per-column group toggle", async () => {
    render(<Harness />)
    await openColumnsPanel()
    expect(document.querySelector(".dt-rowgroups")).not.toBeInTheDocument()
    expect(document.querySelector(".dt-group-toggle-btn")).not.toBeInTheDocument()
  })

  it("keeps query.grouping and query.expanded at [], and refuses grouping.add with one dev warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { result } = renderHook(() => useHarness({ id: "grp-flag-warn" }))

    expect(result.current.grouping.enabled).toBe(false)
    act(() => result.current.grouping.add("status"))
    act(() => result.current.grouping.toggle(["open"]))

    expect(result.current.query.grouping).toEqual([])
    expect(result.current.query.expanded).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain("grp-flag-warn")
    // The advice has to fit the situation: this host is already in server mode
    // and switched grouping off on purpose, so "pass mode: server" would be a
    // fix that changes nothing.
    expect(warn.mock.calls[0]?.[0]).toContain("features.grouping is false")
    expect(warn.mock.calls[0]?.[0]).not.toContain("client mode")
    warn.mockRestore()
  })

  it("never shows the status bar's grouped-by text", () => {
    render(
      <Harness
        statusBar
        initialLayout={{ grouping: ["status"] }}
      />,
    )
    expect(document.querySelector(".dt-status-bar-grouped")).not.toBeInTheDocument()
  })

  describe("a stored layout carrying grouping", () => {
    const storedLayout: TableLayout = {
      columnOrder: ["status", "name"],
      columnVisibility: { name: false },
      columnPinning: { start: [], end: [] },
      columnSizing: { name: 200, status: 150 },
      sorting: [],
      grouping: ["status"],
      expanded: [["open"]],
      filters: [],
      search: "",
    }

    it("loads as ungrouped while keeping column order, widths and visibility", () => {
      const storage = localStorageLayout()
      storage.save("grp-flag-stored", storedLayout)
      const { result } = renderHook(() => useHarness({ id: "grp-flag-stored", storage }))

      // Ignored: the backend behind this host cannot answer a grouping.
      expect(result.current.query.grouping).toEqual([])
      expect(result.current.query.expanded).toEqual([])

      // Untouched: the rest of the stored arrangement survives intact.
      expect(result.current.table.getAllLeafColumns().map((column) => column.id)).toEqual([
        "status",
        "name",
      ])
      expect(result.current.table.getColumn("name")!.getSize()).toBe(200)
      expect(result.current.table.getColumn("status")!.getSize()).toBe(150)
      // "name" was genuinely hidden by the user, not by the grouping — that
      // choice survives.
      expect(result.current.table.getColumn("name")!.getIsVisible()).toBe(false)
    })

    it("renders the once-grouped column as an ordinary column, not hoisted or hidden", () => {
      const storage = localStorageLayout()
      storage.save("grp-flag-hoist", storedLayout)
      const { result } = renderHook(() => useHarness({ id: "grp-flag-hoist", storage }))

      // No group column is derived while grouping is off: nothing is left
      // hidden or hoisted on account of a grouping no longer in force.
      expect(result.current.grouping.columnId).toBeUndefined()
      expect(result.current.table.getColumn("status")!.getIsVisible()).toBe(true)
    })

    it("does not overwrite the stored grouping, so turning the flag back on restores it", () => {
      const storage = localStorageLayout()
      storage.save("grp-flag-preserve", storedLayout)
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const { result, unmount } = renderHook(() => useHarness({ id: "grp-flag-preserve", storage }))

      // An unrelated arrangement change while grouping is off: a resize.
      act(() => {
        result.current.table.getColumn("status")!.getSize()
        result.current.table.setColumnSizing((current) => ({ ...current, status: 175 }))
      })
      act(() => vi.runOnlyPendingTimers())
      unmount()
      vi.useRealTimers()

      const reloaded = storage.load("grp-flag-preserve")
      // The grouping the flag hid is still on disk, for the host to get back
      // the moment it turns `grouping` on again.
      expect(reloaded?.grouping).toEqual(["status"])
      expect(reloaded?.columnSizing?.status).toBe(175)
    })
  })
})

describe("selection, while grouping is off", () => {
  it("sees an empty grouping and counts the real match total, not group headers", () => {
    const { result } = renderHook(() =>
      useHarness({
        id: "grp-flag-selection",
        features: { grouping: false, selection: true },
        initialLayout: { grouping: ["status"] },
      }),
    )
    // `selection.rowsMatching` reads `grouping.length`: with the flag off that
    // is always 0, so it falls back to the ordinary match count instead of
    // going quiet the way a genuinely grouped table does (see
    // `RowSelection.test.tsx`, "the count a grouped table is willing to speak").
    expect(result.current.grouping.isGrouped).toBe(false)
    expect(result.current.selection.rowsMatching).toBe(rows.length)
  })
})

describe("grouping omitted (default true)", () => {
  it("behaves exactly as before: enabled in server mode", () => {
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "grp-flag-default",
        columns,
        data: rows,
        mode: "server",
        rowCount: rows.length,
        getRowId: (row) => row.id,
      }),
    )
    expect(result.current.flags.grouping).toBe(true)
    expect(result.current.grouping.enabled).toBe(true)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
