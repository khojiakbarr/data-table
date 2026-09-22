import { createColumnHelper } from "@tanstack/react-table"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import type { FilterValue } from "./core/filters"
import { formatCount } from "./core/formatCount"
import type { GroupRow } from "./core/grouping"
import type { TableQuery } from "./core/query"
import { SELECTION_COLUMN_ID } from "./core/selection"
import type { SelectionChange } from "./core/useSelection"
import { useDataTable, type DataTableFeatures, type DataTableInstance } from "./useDataTable"
import type { LayoutStorage, TableLayout } from "./types"

/**
 * Row selection, as a user drives it.
 *
 * The three cases this file exists for are the three the design said would go
 * wrong, and each one is a different way of being quietly wrong rather than
 * visibly broken:
 *
 * 1. The query changes and the selection does not — so "everything matching"
 *    comes to mean a different set of rows with no gesture from the user, and
 *    a bulk action then runs on them. **Asserted against what the HOST is
 *    told**, not against what the checkbox looks like: a model only the table
 *    knows it has dropped is the same defect one layer up.
 * 2. `all-matching` prints a count it cannot know, before the server has said
 *    how many rows there are.
 * 3. The two modes convert into one another, so fifty clicks silently discard
 *    a selection of twenty-five thousand — or grant one.
 */

interface Row {
  id: string
  name: string
  amount: number
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 120 }),
  helper.accessor("amount", { header: "Amount", size: 100 }),
]

const rows = (count: number, from = 0): Row[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `r${from + index}`,
    name: `Row ${from + index}`,
    amount: from + index,
  }))

const groupRow = (path: FilterValue[], count: number): GroupRow => ({ kind: "group", path, count })

interface HarnessProps {
  id?: string
  data?: (Row | GroupRow)[]
  server?: boolean
  selection?: boolean
  rowNumbers?: boolean
  /** Left out on purpose by the one case that checks the dev warning. */
  withRowId?: boolean
  /** `null` is the server that has not answered yet; `undefined` takes the default. */
  rowCount?: number | null
  /** The host's own count of RECORDS, when it differs from `rowCount`. */
  selectableRowCount?: number
  initialLayout?: Partial<TableLayout>
  storage?: LayoutStorage
  onSelectionChange?: (selection: SelectionChange) => void
  /** Renders the bulk-action bar; omitted, the table has no bar at all. */
  actions?: boolean
}

let latest: DataTableInstance<Row> | null = null
/** Every selection the host has been told about, oldest first. */
let announced: SelectionChange[] = []

function Harness({
  id = "sel",
  data = rows(3),
  server = true,
  selection = true,
  rowNumbers = false,
  withRowId = true,
  rowCount = 100_000,
  selectableRowCount,
  initialLayout,
  storage,
  onSelectionChange,
  actions = false,
}: HarnessProps) {
  const instance = useDataTable<Row>({
    id,
    columns,
    data,
    features: { selection, rowNumbers },
    ...(withRowId ? { getRowId: (row: Row) => row.id } : {}),
    ...(server ? { mode: "server" as const } : {}),
    ...(rowCount === null ? {} : { rowCount }),
    ...(selectableRowCount === undefined ? {} : { selectableRowCount }),
    ...(initialLayout === undefined ? {} : { initialLayout }),
    ...(storage === undefined ? {} : { storage }),
    onSelectionChange: (change) => {
      announced.push(change)
      onSelectionChange?.(change)
    },
  })
  latest = instance
  return (
    <DataTable
      instance={instance}
      virtualize={false}
      {...(actions
        ? {
            renderSelectionActions: (summary) => (
              <>
                <span data-testid="bar-count">{summary.count ?? "…"}</span>
                <span data-testid="bar-mode">{summary.mode}</span>
                <span data-testid="bar-filters">{summary.query.filters.length}</span>
                <button type="button" onClick={summary.clear}>
                  Cancel
                </button>
              </>
            ),
          }
        : {})}
    />
  )
}

/** The header's all-matching checkbox. */
const headerBox = (): HTMLInputElement => {
  const box = document.querySelector<HTMLInputElement>(
    `th[data-column-id="${SELECTION_COLUMN_ID}"] input[type="checkbox"]`,
  )
  if (!box) throw new Error("no header checkbox")
  return box
}

/** Every row checkbox the body is rendering, in row order. */
const rowBoxes = (): HTMLInputElement[] => [
  ...document.querySelectorAll<HTMLInputElement>("tbody .dt-selection-cell input[type='checkbox']"),
]

/** The last selection the host was told about. */
const lastAnnounced = (): SelectionChange | undefined => announced[announced.length - 1]

beforeEach(() => {
  localStorage.clear()
  latest = null
  announced = []
})

afterEach(() => cleanup())

describe("the selection column", () => {
  it("leads the table, before the row numbers and the host's own columns", () => {
    render(<Harness rowNumbers />)
    const ids = [...document.querySelectorAll("colgroup col[data-column-id]")].map((col) =>
      col.getAttribute("data-column-id"),
    )
    // The order the spec asks for, read off the one flat list of leaf columns
    // the table actually draws.
    expect(ids.slice(0, 2)).toEqual([SELECTION_COLUMN_ID, "__dt_row_number"])
  })

  it("is not offered in the Columns panel, and cannot be dragged", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("tab", { name: "Columns" }))
    expect(
      document.querySelector(`ul.dt-panel-list [data-column-id="${SELECTION_COLUMN_ID}"]`),
    ).toBeNull()
    const header = document.querySelector(`th[data-column-id="${SELECTION_COLUMN_ID}"]`)
    expect(header).not.toBeNull()
    // Alone in its drop region, so `isMovableRegion` refuses the grab itself.
    expect(header?.getAttribute("draggable")).toBe("false")
    // No kebab either: every item such a menu holds is already refused.
    expect(header?.querySelector(".dt-kebab")).toBeNull()
  })

  it("is absent entirely with the flag off", () => {
    render(<Harness selection={false} />)
    expect(document.querySelector(`th[data-column-id="${SELECTION_COLUMN_ID}"]`)).toBeNull()
    expect(rowBoxes()).toHaveLength(0)
  })

  it("names every checkbox, and leaves them all reachable from the keyboard", () => {
    render(<Harness />)
    // A row's box says which row — otherwise every box in the column is
    // announced identically.
    expect(rowBoxes().map((box) => box.getAttribute("aria-label"))).toEqual([
      "Select row 1",
      "Select row 2",
      "Select row 3",
    ])
    // And the header's says what it takes and how many that is.
    expect(headerBox().getAttribute("aria-label")).toBe(
      `Select all ${formatCount(100_000)} rows`,
    )
    // A native checkbox with no negative tabindex: Tab reaches it and Space
    // toggles it, with no handler of ours in the way.
    for (const box of [headerBox(), ...rowBoxes()]) {
      expect(box.tagName).toBe("INPUT")
      expect(box.getAttribute("tabindex")).toBeNull()
      expect(box.disabled).toBe(false)
    }
  })

  it("leaves a group row's checkbox cell empty", () => {
    // A group stands for children the browser does not hold, so a tick on one
    // could not honestly mean anything yet.
    render(<Harness data={[groupRow(["open"], 25_000), ...rows(2)]} />)
    const groupCell = document.querySelector("tr.dt-group-row .dt-selection-cell")
    expect(groupCell).not.toBeNull()
    expect(groupCell?.querySelector("input")).toBeNull()
    // The cell is still THERE: the column's gutter runs the whole body, and a
    // missing cell would shift the row one place left of every other.
    expect(rowBoxes()).toHaveLength(2)
  })
})

describe("what the header checkbox means", () => {
  it("takes everything the query matches, not the rows on screen", () => {
    render(<Harness data={rows(3)} rowCount={100_000} />)
    fireEvent.click(headerBox())
    expect(latest?.selection.model).toEqual({ mode: "all-matching", excluded: [] })
    // Three rows are on screen; a hundred thousand are selected.
    expect(latest?.selection.count).toBe(100_000)
    expect(rowBoxes().every((box) => box.checked)).toBe(true)
  })

  it("counts `rowCount` minus the rows taken back out", () => {
    render(<Harness data={rows(3)} rowCount={100_000} />)
    fireEvent.click(headerBox())
    fireEvent.click(rowBoxes()[0] as HTMLInputElement)
    fireEvent.click(rowBoxes()[1] as HTMLInputElement)
    expect(latest?.selection.count).toBe(99_998)
    expect(latest?.selection.model).toEqual({ mode: "all-matching", excluded: ["r0", "r1"] })
  })

  it("says no number at all until the server has answered", () => {
    // The window decision #2 asks about: `rowCount` is undefined, so the count
    // is undefined and the control is named after what it does rather than
    // after a number nobody can stand behind.
    const { rerender } = render(<Harness data={[]} rowCount={null} />)
    expect(headerBox().getAttribute("aria-label")).toBe("Select all rows")
    fireEvent.click(headerBox())
    expect(latest?.selection.count).toBeUndefined()
    // Not "NaN", not "0", and not a stale number from somewhere else.
    expect(headerBox().getAttribute("aria-label")).not.toMatch(/NaN|undefined|\d/)

    rerender(<Harness data={rows(3)} rowCount={100_000} />)
    expect(headerBox().getAttribute("aria-label")).toBe(
      `Select all ${formatCount(100_000)} rows`,
    )
    expect(latest?.selection.count).toBe(100_000)
  })

  it("is indeterminate for a partial selection, through the DOM property", () => {
    render(<Harness />)
    expect(headerBox().indeterminate).toBe(false)

    // Some rows, picked one at a time.
    fireEvent.click(rowBoxes()[0] as HTMLInputElement)
    expect(headerBox().checked).toBe(false)
    expect(headerBox().indeterminate).toBe(true)

    // Everything.
    fireEvent.click(headerBox())
    expect(headerBox().checked).toBe(true)
    expect(headerBox().indeterminate).toBe(false)

    // Everything except one — the half a mode-blind check misses.
    fireEvent.click(rowBoxes()[0] as HTMLInputElement)
    expect(headerBox().checked).toBe(false)
    expect(headerBox().indeterminate).toBe(true)

    // `indeterminate` has no attribute behind it: reading it off the markup
    // would pass while the box on screen showed a plain empty square.
    expect(headerBox().getAttribute("indeterminate")).toBeNull()
  })
})

describe("the two modes never silently convert", () => {
  it("unticking every visible row in `all-matching` leaves everything except them", () => {
    render(<Harness data={rows(3)} rowCount={100_000} />)
    fireEvent.click(headerBox())
    for (const box of rowBoxes()) fireEvent.click(box)

    expect(latest?.selection.model).toEqual({
      mode: "all-matching",
      excluded: ["r0", "r1", "r2"],
    })
    expect(latest?.selection.isEmpty).toBe(false)
    expect(latest?.selection.count).toBe(99_997)
  })

  it("ticking every visible row one at a time never becomes `all-matching`", () => {
    render(<Harness data={rows(3)} rowCount={100_000} />)
    for (const box of rowBoxes()) fireEvent.click(box)

    expect(latest?.selection.model).toEqual({ mode: "ids", ids: ["r0", "r1", "r2"] })
    // Three, not a hundred thousand: the user never said "everything".
    expect(latest?.selection.count).toBe(3)
    expect(headerBox().checked).toBe(false)
  })
})

describe("a change to the query clears the selection", () => {
  /** Type into the toolbar's quick search and let the debounce settle. */
  const search = (text: string) => {
    fireEvent.change(screen.getByRole("searchbox", { name: "Search rows" }), {
      target: { value: text },
    })
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("clears on a filter change, and TELLS THE HOST it has", () => {
    render(<Harness data={rows(3)} rowCount={100_000} />)
    fireEvent.click(headerBox())
    expect(lastAnnounced()?.mode).toBe("all-matching")
    const before = announced.length

    act(() =>
      latest?.filtering.setCondition({
        kind: "text",
        field: "name",
        op: "contains",
        value: "Row 1",
      }),
    )

    // Not merely an empty checkbox: the host is the only party that can act on
    // a selection, so the clear has to reach it.
    expect(announced.length).toBeGreaterThan(before)
    expect(lastAnnounced()).toMatchObject({ mode: "ids", ids: [], count: 0 })
    // And the query it is relative to is the NEW one, so a host that stored
    // the announcement is not holding a model against a query that is gone.
    expect(lastAnnounced()?.query.filters).toHaveLength(1)
    expect(latest?.selection.isEmpty).toBe(true)
    expect(headerBox().checked).toBe(false)
    expect(headerBox().indeterminate).toBe(false)
  })

  it("clears on a search change", () => {
    render(<Harness data={rows(3)} rowCount={100_000} />)
    fireEvent.click(rowBoxes()[0] as HTMLInputElement)
    expect(latest?.selection.isEmpty).toBe(false)

    act(() => search("agro"))
    // The selection survives the keystroke and goes when the QUERY goes —
    // which is the moment "everything matching" starts meaning something else.
    act(() => vi.advanceTimersByTime(400))
    expect(latest?.selection.isEmpty).toBe(true)
    expect(lastAnnounced()).toMatchObject({ mode: "ids", ids: [] })
  })

  it("clears on a grouping change", () => {
    render(<Harness data={rows(3)} rowCount={100_000} />)
    fireEvent.click(headerBox())
    expect(latest?.selection.isEmpty).toBe(false)

    act(() => latest?.grouping.add("name"))
    expect(latest?.selection.isEmpty).toBe(true)
    expect(lastAnnounced()).toMatchObject({ mode: "ids", ids: [] })
  })

  it("does NOT clear on a sort change", () => {
    render(<Harness data={rows(3)} rowCount={100_000} />)
    fireEvent.click(headerBox())

    fireEvent.click(screen.getByRole("button", { name: "Name: Sort ascending" }))

    // Sorting changes no row's membership, only the order — clearing here
    // would make the feature useless for the case it exists for.
    expect(latest?.selection.model).toEqual({ mode: "all-matching", excluded: [] })
    expect(latest?.selection.count).toBe(100_000)
  })

  it("does NOT clear on a page change", () => {
    render(<Harness data={rows(3)} rowCount={100_000} />)
    fireEvent.click(rowBoxes()[0] as HTMLInputElement)

    act(() => latest?.pagination.setPageIndex(4))

    expect(latest?.selection.model).toEqual({ mode: "ids", ids: ["r0"] })
    // And the announcement that follows carries the new page's query, so the
    // host's copy stays current.
    expect(lastAnnounced()?.query.pagination.pageIndex).toBe(4)
  })
})

describe("a selection is not layout", () => {
  it("is never written to storage, and does not come back from it", () => {
    const saved: TableLayout[] = []
    const storage: LayoutStorage = {
      load: () => saved[saved.length - 1] ?? null,
      save: (_id, layout) => void saved.push(layout),
      clear: () => undefined,
    }

    render(<Harness storage={storage} />)
    fireEvent.click(headerBox())
    // Move something that IS layout, so a save actually happens.
    act(() => latest?.table.getColumn("name")?.pin("start"))
    fireEvent(window, new Event("pagehide"))

    const layout = saved[saved.length - 1]
    expect(layout).toBeDefined()
    // `pruneLayout` rebuilds from recognised keys, so anything not on its
    // whitelist can never survive a round trip. Asserted over the whole
    // object rather than one key, so a slice added later is caught too.
    expect(JSON.stringify(layout)).not.toContain("selection")
    expect(JSON.stringify(layout)).not.toContain("all-matching")
    expect(JSON.stringify(layout)).not.toContain(SELECTION_COLUMN_ID)

    // And a fresh mount against that same storage starts with nothing ticked.
    cleanup()
    announced = []
    render(<Harness storage={storage} />)
    expect(latest?.selection.isEmpty).toBe(true)
    expect(headerBox().checked).toBe(false)
    expect(rowBoxes().some((box) => box.checked)).toBe(false)
  })
})

describe("the bulk-action slot", () => {
  it("appears only while something is selected, and is handed the way out", () => {
    render(<Harness actions data={rows(3)} rowCount={100_000} />)
    expect(document.querySelector(".dt-selection-bar")).toBeNull()

    fireEvent.click(headerBox())
    expect(document.querySelector(".dt-selection-bar")).not.toBeNull()
    expect(screen.getByTestId("bar-count").textContent).toBe("100000")
    expect(screen.getByTestId("bar-mode").textContent).toBe("all-matching")
    // The query rides along, because a host cannot translate the model without it.
    expect(screen.getByTestId("bar-filters").textContent).toBe("0")

    // `clear` comes with the summary so a Cancel button does not have to reach
    // back into the instance.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(document.querySelector(".dt-selection-bar")).toBeNull()
    expect(latest?.selection.isEmpty).toBe(true)
  })

  it("shows no count at all while the server has not answered", () => {
    render(<Harness actions data={[]} rowCount={null} />)
    fireEvent.click(headerBox())
    expect(screen.getByTestId("bar-count").textContent).toBe("…")
  })

  it("is not rendered at all without the prop", () => {
    render(<Harness data={rows(3)} />)
    fireEvent.click(headerBox())
    expect(document.querySelector(".dt-selection-bar")).toBeNull()
  })
})

describe("what the host is told", () => {
  it("says nothing on mount", () => {
    render(<Harness />)
    // Nothing is selected, and `onQueryChange` has already announced the
    // query; an opening report of "nothing" is noise a host would filter out.
    expect(announced).toEqual([])
  })

  it("publishes the model, the query and the count together", () => {
    render(<Harness data={rows(3)} rowCount={100_000} />)
    fireEvent.click(rowBoxes()[1] as HTMLInputElement)

    const change = lastAnnounced()
    expect(change).toMatchObject({ mode: "ids", ids: ["r1"], count: 1 })
    // The query is NOT optional: `all-matching` names no row on its own, so a
    // host handed a model without one has nothing to translate.
    expect(change?.query).toBeDefined()
    expect((change?.query as TableQuery).pagination.pageSize).toBeGreaterThan(0)
  })

  it("warns once when rows have no stable id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    render(<Harness id="sel-no-row-id" withRowId={false} />)
    // Server mode warns about the same missing option for expansion's sake, so
    // this reads only the selection's own — which says what goes WRONG rather
    // than that something is missing.
    const mine = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((said) => said.includes("features.selection without getRowId"))
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatch(/follows the row's slot rather than the record/)
    warn.mockRestore()
  })
})

describe("a headless host reads the same answers", () => {
  it("exposes the model, the count and the mutators on the instance", () => {
    render(<Harness data={rows(3)} rowCount={100_000} />)
    const selection = latest?.selection
    expect(selection?.enabled).toBe(true)
    expect(selection?.rowsMatching).toBe(100_000)

    act(() => selection?.toggleRow("r2", true))
    expect(latest?.selection.model).toEqual({ mode: "ids", ids: ["r2"] })
    expect(latest?.selection.isRowSelected("r2")).toBe(true)

    act(() => latest?.selection.clear())
    expect(latest?.selection.isEmpty).toBe(true)
  })

  it("reports an empty selection while the flag is off, whatever is asked of it", () => {
    render(<Harness selection={false} />)
    expect(latest?.selection.enabled).toBe(false)
    expect(latest?.selection.isEmpty).toBe(true)
    expect(latest?.selection.count).toBe(0)
  })
})

describe("the count a grouped table is willing to speak", () => {
  /*
   * `rowCount` in a grouped server table is the length of the FLATTENED list,
   * group headers included. Speaking it as a selection count would say "select
   * all 84 rows" about 84 group headers — a number nobody is about to act on,
   * attached to a model that is nonetheless correct. So the count goes quiet
   * instead, and `labels.selectAllRows` falls back to the no-number wording it
   * already has for the window before a server answers.
   */
  it("says nothing numeric while grouped, rather than counting group headers", () => {
    render(
      <Harness
        data={[groupRow(["open"], 25_000), ...rows(2)]}
        rowCount={84}
        initialLayout={{ grouping: ["name"] }}
      />,
    )
    expect(latest?.selection.rowsMatching).toBeUndefined()

    act(() => latest?.selection.toggleAll(true))
    expect(latest?.selection.model).toEqual({ mode: "all-matching", excluded: [] })
    expect(latest?.selection.count).toBeUndefined()
  })

  it("speaks the host's own record count when it is given one", () => {
    render(
      <Harness
        data={[groupRow(["open"], 25_000), ...rows(2)]}
        rowCount={84}
        selectableRowCount={25_000}
        initialLayout={{ grouping: ["name"] }}
      />,
    )
    expect(latest?.selection.rowsMatching).toBe(25_000)

    act(() => latest?.selection.toggleAll(true))
    expect(latest?.selection.count).toBe(25_000)
    act(() => latest?.selection.toggleRow("r1", false))
    expect(latest?.selection.count).toBe(24_999)
  })

  /*
   * The pager measures the list it actually shows, so it must keep reading
   * `rowCount` — this is the assertion that stops someone "simplifying" the
   * two counts into one and quietly taking 499 pages away from the user.
   */
  it("keeps paging on the flattened count, not the record count", () => {
    render(
      <Harness
        data={[groupRow(["open"], 25_000), ...rows(2)]}
        rowCount={84}
        selectableRowCount={25_000}
        initialLayout={{ grouping: ["name"], pageSize: 10 }}
      />,
    )
    expect(latest?.pagination.pageCount).toBe(9)
  })
})

describe("the selection column inside the built-in shell", () => {
  it("keeps a group page's cells lined up with the header", () => {
    render(
      <Harness
        rowNumbers
        data={[groupRow(["open"], 25_000), ...rows(2)]}
        initialLayout={{ grouping: ["name"] }}
      />,
    )
    const headerCells = [...document.querySelectorAll("thead tr:first-child th[data-column-id]")]
    const firstBodyRow = document.querySelector("tbody tr.dt-tr")
    const bodyCells = [...(firstBodyRow?.querySelectorAll("td[data-column-id]") ?? [])]
    // Every header has a cell under it, in the same order — the check a
    // missing chrome cell on a group row would fail.
    expect(bodyCells.map((cell) => cell.getAttribute("data-column-id"))).toEqual(
      headerCells.map((cell) => cell.getAttribute("data-column-id")),
    )
  })

  it("does not open a row while a checkbox is being ticked", () => {
    const onRowClick = vi.fn()
    function Clickable() {
      const instance = useDataTable<Row>({
        id: "sel-click",
        columns,
        data: rows(2),
        features: { selection: true },
        getRowId: (row) => row.id,
      })
      latest = instance
      return <DataTable instance={instance} virtualize={false} onRowClick={onRowClick} />
    }
    render(<Clickable />)

    fireEvent.click(rowBoxes()[0] as HTMLInputElement)
    expect(latest?.selection.model).toEqual({ mode: "ids", ids: ["r0"] })
    // A tick that also opened the row would make the box unusable for the one
    // thing it is there for.
    expect(onRowClick).not.toHaveBeenCalled()

    // The row itself still opens when clicked anywhere else.
    const nameCell = within(document.querySelector("tbody tr.dt-tr") as HTMLElement).getByText(
      "Row 0",
    )
    fireEvent.click(nameCell)
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })
})
