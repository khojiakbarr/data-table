import { createColumnHelper } from "@tanstack/react-table"
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import type { FilterCondition, FilterValue } from "./core/filters"
import { groupRowId, type GroupRow } from "./core/grouping"
import { localStorageLayout } from "./core/persistence"
import type { TableQuery } from "./core/query"
import { useDataTable, type DataTableFeatures } from "./useDataTable"
import type { TableLayout } from "./types"

/**
 * Server-side row grouping, end to end: the wire, the layout slices, and what
 * a grouped page renders as.
 *
 * Every case here is one of the things section 4 of the design said would go
 * wrong. They are each a real interaction rather than a unit of an internal —
 * the units are in `core/grouping.test.ts` — because what makes grouping
 * awkward is how it composes with paging, loading, virtualisation and the
 * empty state, none of which a pure function can show.
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

const leaf = (index: number, status = "open"): Row => ({
  id: `r${index}`,
  name: `Row ${index}`,
  status,
})
const groupRow = (path: FilterValue[], count: number): GroupRow => ({ kind: "group", path, count })

/** A flattened page: one open group, its two leaves, and a closed sibling. */
const flattened = [groupRow(["open"], 2), leaf(0), leaf(1), groupRow(["closed"], 5)]

interface HarnessProps {
  data?: (Row | GroupRow)[]
  initialLayout?: Partial<TableLayout>
  rowCount?: number
  loading?: boolean
  startPath?: FilterValue[]
  onQueryChange?: (query: TableQuery) => void
  getRowHeight?: (row: Row) => number
  storage?: ReturnType<typeof localStorageLayout>
  id?: string
}

function useHarness({
  data = flattened,
  initialLayout,
  rowCount = 4,
  startPath,
  onQueryChange,
  getRowHeight,
  storage,
  id = "grp",
}: HarnessProps) {
  return useDataTable<Row>({
    id,
    columns,
    data,
    mode: "server",
    rowCount,
    getRowId: (row) => row.id,
    ...(initialLayout === undefined ? {} : { initialLayout }),
    ...(startPath === undefined ? {} : { startPath }),
    ...(onQueryChange === undefined ? {} : { onQueryChange }),
    ...(getRowHeight === undefined ? {} : { getRowHeight }),
    ...(storage === undefined ? {} : { storage }),
  })
}

function Harness(props: HarnessProps) {
  const instance = useHarness(props)
  return <DataTable instance={instance} virtualize={false} loading={props.loading ?? false} />
}

/** Every rendered body row, spacers and the continuation header excluded. */
const bodyRows = () =>
  screen.queryAllByRole("row").filter((row) => row.classList.contains("dt-tr"))

const cellText = (row: HTMLElement, columnId: string) =>
  row.querySelector(`[data-column-id="${columnId}"]`)?.textContent ?? ""

beforeEach(() => localStorage.clear())

describe("the wire", () => {
  it("carries grouping and expanded, and canonicalises the open paths", () => {
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result } = renderHook(() => useHarness({ onQueryChange }))

    act(() => result.current.grouping.set(["status"]))
    act(() => result.current.grouping.toggle(["open"]))
    act(() => result.current.grouping.toggle(["closed"]))

    expect(result.current.query.grouping).toEqual(["status"])
    // Sorted, not insertion-ordered: `queriesEqual` stringifies the query, so
    // opening `open` then `closed` must produce the same array as the reverse.
    expect(result.current.query.expanded).toEqual([["closed"], ["open"]])
    expect(onQueryChange).toHaveBeenLastCalledWith(result.current.query)
  })

  it("publishes no open paths once the grouping is gone", () => {
    const { result } = renderHook(() => useHarness({}))
    act(() => result.current.grouping.set(["status"]))
    act(() => result.current.grouping.toggle(["open"]))
    act(() => result.current.grouping.clear())
    expect(result.current.query.grouping).toEqual([])
    expect(result.current.query.expanded).toEqual([])
  })

  it("keeps the query identity stable across a render that changed nothing", () => {
    const { result, rerender } = renderHook(() => useHarness({}))
    act(() => result.current.grouping.set(["status"]))
    const first = result.current.query
    rerender()
    expect(result.current.query).toBe(first)
  })

  it("refuses a group on a column the table does not define", () => {
    const { result } = renderHook(() => useHarness({}))
    act(() => result.current.grouping.set(["status", "ghost"]))
    expect(result.current.query.grouping).toEqual(["status"])
  })

  it("groups nothing in client mode, where one page is all the table holds", () => {
    const { result } = renderHook(() =>
      useDataTable<Row>({ id: "client", columns, data: [leaf(0)], getRowId: (row) => row.id }),
    )
    expect(result.current.grouping.enabled).toBe(false)
    act(() => result.current.grouping.set(["status"]))
    expect(result.current.query.grouping).toEqual([])
  })
})

describe("the page resets", () => {
  it("goes back to page one when the grouping changes", () => {
    const { result } = renderHook(() => useHarness({ rowCount: 500 }))
    act(() => result.current.pagination.setPageIndex(3))
    act(() => result.current.grouping.set(["status"]))
    expect(result.current.query.pagination.pageIndex).toBe(0)
  })

  it("keeps the page when a group is opened", () => {
    // Opening a group can only LENGTHEN the flattened list, so the page the
    // user is on still exists — resetting it would throw a page-3 user back
    // to page 1 for opening a group they could already see. See the comment
    // on `toggleGroup` in useDataTable.ts for why only a collapse resets.
    const { result } = renderHook(() => useHarness({ rowCount: 500 }))
    act(() => result.current.grouping.set(["status"]))
    act(() => result.current.pagination.setPageIndex(3))
    act(() => result.current.grouping.toggle(["open"]))
    expect(result.current.query.pagination.pageIndex).toBe(3)
  })

  it("goes back to page one when an open group is closed", () => {
    // Closing a group can SHORTEN the flattened list, so an un-reset page can
    // point past its new end.
    const { result } = renderHook(() => useHarness({ rowCount: 500 }))
    act(() => result.current.grouping.set(["status"]))
    act(() => result.current.grouping.toggle(["open"]))
    act(() => result.current.pagination.setPageIndex(3))
    act(() => result.current.grouping.toggle(["open"]))
    expect(result.current.query.pagination.pageIndex).toBe(0)
  })

  it("clears the open paths when the grouping changes, since their keys are positional", () => {
    const { result } = renderHook(() => useHarness({}))
    act(() => result.current.grouping.set(["status"]))
    act(() => result.current.grouping.toggle(["open"]))
    act(() => result.current.grouping.add("name"))
    expect(result.current.query.expanded).toEqual([])
  })
})

describe("a grouped table renders", () => {
  it("takes the grouped column out of the body and puts the group there", () => {
    render(<Harness initialLayout={{ grouping: ["status"], expanded: [["open"]] }} />)

    const rows = bodyRows()
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveClass("dt-group-row")
    // The group header's value and count, in the grouped column's own slot.
    expect(cellText(rows[0]!, "status")).toContain("open")
    expect(cellText(rows[0]!, "status")).toContain("(2)")
    // A record shows nothing there: its status is on the header above it.
    expect(cellText(rows[1]!, "status")).toBe("")
    expect(cellText(rows[1]!, "name")).toContain("Row 0")
  })

  it("gives a group row its key path, joined, as its id", () => {
    const { result } = renderHook(() =>
      useHarness({ initialLayout: { grouping: ["status"], expanded: [["open"]] } }),
    )
    const ids = result.current.table.getRowModel().rows.map((row) => row.id)
    expect(ids).toEqual([groupRowId(["open"]), "r0", "r1", groupRowId(["closed"])])
  })

  it("opens and closes a group through the chevron the table already has", () => {
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    render(<Harness initialLayout={{ grouping: ["status"] }} onQueryChange={onQueryChange} />)

    const toggle = screen.getAllByRole("button", { name: /open, 2 rows/ })[0]!
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(toggle)

    expect(onQueryChange.mock.lastCall?.[0].expanded).toEqual([["open"]])
  })

  it("names the blank group rather than rendering an empty cell", () => {
    render(
      <Harness
        data={[groupRow([""], 3)]}
        rowCount={1}
        initialLayout={{ grouping: ["status"] }}
      />,
    )
    expect(cellText(bodyRows()[0]!, "status")).toContain("(Blanks)")
  })

  it("marks the grouped column's header, which still sorts its own level", () => {
    render(<Harness initialLayout={{ grouping: ["status"] }} />)
    const header = screen.getByRole("columnheader", { name: /Status/ })
    expect(within(header).getByRole("img", { name: "Grouped" })).toBeInTheDocument()
    // Still a sort control: a sort on a grouped column reorders that level's
    // headers, which is the whole reason the column keeps its header.
    expect(within(header).getByRole("button", { name: /Sort ascending/ })).toBeInTheDocument()
  })

  it("still groups by a column the user has hidden, and keeps one slot for the values", () => {
    const { result } = renderHook(() =>
      useHarness({
        initialLayout: { grouping: ["status"], columnVisibility: { status: false } },
      }),
    )
    // Hiding is a view concern: the grouping still travels.
    expect(result.current.query.grouping).toEqual(["status"])
    // And the values still have somewhere to render.
    expect(result.current.grouping.columnId).toBe("status")
    expect(result.current.table.getColumn("status")!.getIsVisible()).toBe(true)
  })

  it("hides every grouped column but the one holding the values", () => {
    const { result } = renderHook(() =>
      useHarness({ initialLayout: { grouping: ["status", "name"] } }),
    )
    expect(result.current.grouping.columnId).toBe("status")
    expect(result.current.table.getColumn("name")!.getIsVisible()).toBe(false)
    // The user's own visibility slice is untouched, which is what makes
    // removing the grouping put every column back exactly where it was.
    expect(result.current.table.getColumn("name")!.columnDef.header).toBe("Name")
    act(() => result.current.grouping.clear())
    expect(result.current.table.getColumn("name")!.getIsVisible()).toBe(true)
  })

  /**
   * The header menu's Hide, on the column the rows are grouped by.
   *
   * It used to be enabled and to do nothing visible: the derived visibility
   * keeps the group column on screen whatever the layout says, so the click
   * looked like a no-op while `columnVisibility: { status: false }` went into
   * storage all the same — and sprang the moment the grouping came off, in
   * this session or a later one, with no nearby gesture to explain it.
   */
  it("refuses Hide on the grouped column rather than storing a flag that springs later", () => {
    render(<Harness initialLayout={{ grouping: ["status"] }} />)

    fireEvent.click(screen.getByRole("button", { name: /Status: column actions/i }))
    const hide = screen.getByRole("menuitem", { name: /Hide/ })
    // Offered, so the menu keeps its shape — and refused out loud, with the
    // reason in the item's own accessible name rather than in a tooltip.
    expect(hide).toHaveAttribute("aria-disabled", "true")
    expect(hide).toHaveTextContent("Rows are grouped by this column")

    fireEvent.click(hide)
    // Not even the close a taken action would have done: nothing happened.
    expect(screen.getByRole("menu")).toBeInTheDocument()

    // And the proof it wrote nothing: take the grouping off and Status is
    // still there, which is exactly what used to fail.
    fireEvent.click(screen.getByRole("tab", { name: "Columns" }))
    const panel = document.querySelector<HTMLElement>(".dt-panel") as HTMLElement
    fireEvent.click(within(panel).getByRole("button", { name: "Clear grouping" }))
    expect(screen.getByRole("columnheader", { name: /Status/ })).toBeInTheDocument()
  })

  it("still hides a column the rows are not grouped by", () => {
    render(<Harness initialLayout={{ grouping: ["status"] }} />)

    fireEvent.click(screen.getByRole("button", { name: /Name: column actions/i }))
    const hide = screen.getByRole("menuitem", { name: /Hide/ })
    expect(hide).not.toHaveAttribute("aria-disabled")

    fireEvent.click(hide)
    expect(screen.queryByRole("columnheader", { name: /Name/ })).toBeNull()
  })

  it("draws a continued header when the page starts inside an open group", () => {
    // The ugly case the wire's `startPath` exists for: three records, no group
    // header, and nothing on a leaf saying which group it belongs to.
    render(
      <Harness
        data={[leaf(2), leaf(3), leaf(4)]}
        rowCount={40}
        startPath={["open"]}
        initialLayout={{ grouping: ["status"], expanded: [["open"]] }}
      />,
    )
    expect(screen.getByText("open (continued)")).toBeInTheDocument()
  })

  it("draws no continued header when the page opens with a group of its own", () => {
    render(
      <Harness startPath={[]} initialLayout={{ grouping: ["status"], expanded: [["open"]] }} />,
    )
    expect(screen.queryByText(/continued/)).not.toBeInTheDocument()
  })
})

describe("a column's own group formatter", () => {
  // The raw server enum, mapped the way a host's `meta.groupLabel` would.
  const statusLabel = (value: FilterValue): string => {
    if (value === "closed") return "Closed"
    if (value === "open") return "Open"
    return "Unassigned"
  }
  const formattedColumns = [
    helper.accessor("name", { header: "Name", size: 120 }),
    helper.accessor("status", { header: "Status", size: 120, meta: { groupLabel: statusLabel } }),
  ]

  function FormattedHarness({
    data = flattened,
    initialLayout,
    rowCount = 4,
    startPath,
  }: HarnessProps) {
    const instance = useDataTable<Row>({
      id: "grp-fmt",
      columns: formattedColumns,
      data,
      mode: "server",
      rowCount,
      getRowId: (row) => row.id,
      ...(initialLayout === undefined ? {} : { initialLayout }),
      ...(startPath === undefined ? {} : { startPath }),
    })
    return <DataTable instance={instance} virtualize={false} />
  }

  it("renders the group row's value through the column's formatter, not the raw key", () => {
    render(<FormattedHarness initialLayout={{ grouping: ["status"], expanded: [["open"]] }} />)

    const cell = cellText(bodyRows()[0]!, "status")
    expect(cell).toContain("Open")
    expect(cell).not.toContain("open (")
    // The count still comes from the group, untouched by the formatter.
    expect(cell).toContain("(2)")
  })

  it("puts the formatted value in the row's accessible name too", () => {
    render(<FormattedHarness initialLayout={{ grouping: ["status"], expanded: [["open"]] }} />)
    expect(screen.getByRole("button", { name: /Open, 2 rows/ })).toBeInTheDocument()
  })

  it("still asks the formatter about a blank group, rather than pre-empting it with '(Blanks)'", () => {
    render(
      <FormattedHarness
        data={[groupRow([""], 3)]}
        rowCount={1}
        initialLayout={{ grouping: ["status"] }}
      />,
    )
    expect(cellText(bodyRows()[0]!, "status")).toContain("Unassigned")
  })

  it("runs the continuation header through the exact same formatter", () => {
    // §B: one function for both, so the group row and the "continued" header
    // can never say something different about the same key.
    render(
      <FormattedHarness
        data={[leaf(2), leaf(3)]}
        rowCount={40}
        startPath={["open"]}
        initialLayout={{ grouping: ["status"], expanded: [["open"]] }}
      />,
    )
    expect(screen.getByText("Open (continued)")).toBeInTheDocument()
  })
})

describe("the traps", () => {
  it("keeps the rows and shows the progress bar while an expand refetches", () => {
    // NOT the skeleton: expanding is a refetch of a page the user is already
    // looking at, and throwing it away to show placeholders reads as the table
    // reloading from nothing.
    const { rerender } = render(
      <Harness initialLayout={{ grouping: ["status"] }} loading={false} />,
    )
    rerender(<Harness initialLayout={{ grouping: ["status"] }} loading />)

    expect(bodyRows().length).toBeGreaterThan(0)
    expect(document.querySelector(".dt-skeleton-row")).toBeNull()
    expect(screen.getByRole("progressbar")).toBeInTheDocument()
  })

  it("never asks the host's getRowHeight about a group header", () => {
    // A group is not one of the host's records; a policy written against
    // `row.name` would read `undefined` off one.
    const getRowHeight = vi.fn((row: Row) => (row.name.length > 0 ? 64 : 40))
    render(<Harness initialLayout={{ grouping: ["status"], expanded: [["open"]] }} getRowHeight={getRowHeight} />)

    for (const [row] of getRowHeight.mock.calls) expect(row).toHaveProperty("name")
    const rows = bodyRows()
    // Two heights in one flat list, which is what the virtualiser has to
    // budget for: a record at the host's height, a group at the table's.
    expect(rows[1]).toHaveStyle({ height: "64px" })
    expect(rows[0]!.style.height).toBe("")
  })

  it("windows a mixed list of two heights without losing a row", () => {
    /*
     * Virtualisation now sees group headers and records as one flat list of
     * different heights. The spacers are summed from the same policy the rows
     * render at, so a group row measuring differently from a record must not
     * put the window out.
     */
    const long: (Row | GroupRow)[] = []
    for (let index = 0; index < 20; index++) {
      long.push(groupRow([`g${index}`], 2), leaf(index * 2), leaf(index * 2 + 1))
    }
    const instance = renderHook(() =>
      useHarness({
        data: long,
        rowCount: long.length,
        getRowHeight: () => 64,
        initialLayout: { grouping: ["status"] },
      }),
    )
    render(<DataTable instance={instance.result.current} virtualize loading={false} />)

    // jsdom lays nothing out, so the virtualiser renders its leading window —
    // the page size, since a page is a whole thing — and spaces out the rest.
    const rows = bodyRows()
    expect(rows.length).toBe(50)
    // Each kind at its own height: the host's policy for a record, the
    // table's `rowHeight` for a header it was never asked about.
    expect(rows[0]).toHaveClass("dt-group-row")
    expect(rows[0]!.style.height).toBe("")
    expect(rows[1]).toHaveStyle({ height: "64px" })

    /*
     * The ten rows left out are three headers and seven records, and the
     * spacer has to be the sum of BOTH heights: 3 × 40 + 7 × 64. A virtualiser
     * that estimated every row at one height would put the scrollbar out by
     * 168px over ten rows, and by a page over a page.
     */
    const spacer = document.querySelector<HTMLElement>(".dt-spacer-row")
    expect(spacer?.style.height).toBe("568px")
  })

  it("filters before it groups, so both travel on the same query", () => {
    const condition: FilterCondition = {
      kind: "text",
      field: "status",
      op: "contains",
      value: "ope",
    }
    const { result } = renderHook(() =>
      useHarness({ initialLayout: { grouping: ["status"], filters: [condition] } }),
    )
    expect(result.current.query.grouping).toEqual(["status"])
    expect(result.current.query.filters).toEqual([condition])
  })

  it("offers a way out of a grouped table with no matches", () => {
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    render(
      <Harness
        data={[]}
        rowCount={0}
        initialLayout={{ grouping: ["status"] }}
        onQueryChange={onQueryChange}
      />,
    )
    expect(screen.getByText("No rows match the current filters")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Clear grouping" }))
    expect(onQueryChange.mock.lastCall?.[0].grouping).toEqual([])
  })
})

describe("the saved layout", () => {
  it("keeps the grouping and its open branches, beside sorting", () => {
    const storage = localStorageLayout()
    const { result, unmount } = renderHook(() => useHarness({ storage, id: "saved" }))
    act(() => result.current.grouping.set(["status"]))
    act(() => result.current.grouping.toggle(["open"]))
    act(() => vi.runOnlyPendingTimers())
    unmount()

    const stored = storage.load("saved")
    expect(stored?.grouping).toEqual(["status"])
    expect(stored?.expanded).toEqual([["open"]])
  })

  it("restores them on the next visit", () => {
    const storage = localStorageLayout()
    storage.save("restored", {
      columnOrder: [],
      columnVisibility: {},
      columnPinning: { start: [], end: [] },
      columnSizing: {},
      sorting: [],
      grouping: ["status"],
      expanded: [["open"]],
      filters: [],
      search: "",
    })
    const { result } = renderHook(() => useHarness({ storage, id: "restored" }))
    expect(result.current.query.grouping).toEqual(["status"])
    expect(result.current.query.expanded).toEqual([["open"]])
  })

  it("is dropped by resetLayout, which puts every column back", () => {
    const { result } = renderHook(() => useHarness({}))
    act(() => result.current.grouping.set(["status"]))
    expect(result.current.isCustomised).toBe(true)
    act(() => result.current.resetLayout())
    expect(result.current.query.grouping).toEqual([])
  })
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  return () => vi.useRealTimers()
})
