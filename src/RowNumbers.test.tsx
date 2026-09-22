import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import type { FilterValue } from "./core/filters"
import type { GroupRow } from "./core/grouping"
import { ROW_NUMBER_COLUMN_ID, rowNumberColumnWidth } from "./core/rowNumbers"
import { useDataTable, type DataTableFeatures, type DataTableInstance } from "./useDataTable"
import type { LayoutStorage, TableLayout } from "./types"

/**
 * The leading column that numbers the rows.
 *
 * The cases are the ones the design said would go wrong, and they are all
 * about the same quantity being derived in two places: the number a row
 * prints and the position it announces. Every case below reads both, because
 * a table that printed 51 while telling a screen reader 1 would be wrong in
 * the one way nobody looking at it could see.
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
  rowNumbers?: boolean
  /** `features.pinning`, for the one case that turns the host's own off. */
  pinning?: boolean
  rowCount?: number | undefined
  pagination?: boolean | { pageSize: number }
  initialLayout?: Partial<TableLayout>
  startPath?: FilterValue[]
  storage?: LayoutStorage
}

let latest: DataTableInstance<Row> | null = null

function Harness({
  id = "rn",
  data = rows(3),
  server = false,
  rowNumbers = true,
  pinning = true,
  rowCount,
  pagination,
  initialLayout,
  startPath,
  storage,
}: HarnessProps) {
  const instance = useDataTable<Row>({
    id,
    columns,
    data,
    features: { rowNumbers, pinning },
    getRowId: (row) => row.id,
    ...(server ? { mode: "server" as const } : {}),
    ...(rowCount === undefined ? {} : { rowCount }),
    ...(pagination === undefined ? {} : { pagination }),
    ...(initialLayout === undefined ? {} : { initialLayout }),
    ...(startPath === undefined ? {} : { startPath }),
    ...(storage === undefined ? {} : { storage }),
  })
  latest = instance
  return <DataTable instance={instance} virtualize={false} />
}

/**
 * Every body row the table renders, in order.
 *
 * Spacers are excluded by the class, and so is the "continued" group header:
 * it is `role="presentation"` precisely because it is not one of the table's
 * rows, and counting it here would be the very off-by-one the empty number
 * cell exists to prevent.
 */
const bodyRows = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>("tbody tr.dt-tr")].filter(
    (row) => !row.classList.contains("dt-group-continued"),
  )

/** What each row prints in its number cell, in render order. */
const numbers = (): string[] =>
  bodyRows().map((row) => row.querySelector(".dt-row-number")?.textContent ?? "")

/**
 * The position each row ANNOUNCES, with the header rows taken back off.
 *
 * The other half of every case here: `aria-rowindex` counts the header rows
 * too, so a screen reader's "row 52 of 200" and a printed 51 are the same
 * claim — and the two are only the same claim while this subtraction holds.
 */
const announcedNumbers = (): string[] => {
  const headerRows = document.querySelectorAll("thead tr").length
  return bodyRows().map((row) => {
    const index = Number(row.getAttribute("aria-rowindex"))
    return String(index - headerRows)
  })
}

/** The rendered leaf order, read off the `<colgroup>` the way the table draws it. */
const renderedOrder = (): string[] =>
  [...document.querySelectorAll("colgroup col[data-column-id]")].map(
    (col) => col.getAttribute("data-column-id") ?? "",
  )

const colWidths = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("colgroup col:not(.dt-col-filler)")].map(
    (col) => col.style.width,
  )

const numberHeader = (): HTMLElement => {
  const cell = document.querySelector<HTMLElement>(`th[data-column-id="${ROW_NUMBER_COLUMN_ID}"]`)
  if (!cell) throw new Error("no row-number header")
  return cell
}

beforeEach(() => {
  localStorage.clear()
  latest = null
})

describe("the flag", () => {
  it("adds no column at all by default", () => {
    render(<Harness rowNumbers={false} />)
    expect(renderedOrder()).toEqual(["name", "amount"])
    expect(document.querySelector(".dt-row-number")).toBeNull()
  })

  it("leads the table with the numbers when it is on", () => {
    render(<Harness />)
    expect(renderedOrder()).toEqual([ROW_NUMBER_COLUMN_ID, "name", "amount"])
    expect(numbers()).toEqual(["1", "2", "3"])
    expect(announcedNumbers()).toEqual(numbers())
  })

  it("names the header for a screen reader and draws nothing in it", () => {
    render(<Harness />)
    // The name is the whole of what the header carries: the sr-only span is
    // the only text in it, so this passes only while both halves hold.
    const header = screen.getByRole("columnheader", { name: "Row number" })
    expect(header).toBe(numberHeader())
    expect(header.querySelector(".dt-sr-only")?.textContent).toBe("Row number")
    expect(header.textContent).toBe("Row number")
    expect(header.querySelector(".dt-th-label")?.textContent ?? "").toBe("")
  })

  it("keeps the expand toggle beside the first real column, not beside the number", () => {
    render(
      <Harness
        data={rows(2)}
        // A detail renderer is what makes a row expandable; `DataTable` owns
        // that prop, so the toggle only appears through the shell.
      />,
    )
    // With no detail panel there is no toggle at all; the lead cell is still
    // the first column of data rather than the number.
    const [first] = bodyRows()
    expect(first?.querySelector(".dt-td-lead")?.getAttribute("data-column-id")).toBe("name")
  })
})

describe("what the number means", () => {
  it("counts from the whole result set, not from the page", () => {
    render(<Harness server data={rows(50)} rowCount={200} pagination={{ pageSize: 50 }} />)
    expect(numbers()[0]).toBe("1")

    fireEvent.click(screen.getByRole("button", { name: /next page/i }))
    expect(numbers()).toEqual(Array.from({ length: 50 }, (_, index) => String(index + 51)))
    expect(announcedNumbers()).toEqual(numbers())
  })

  it("takes the offset from the page the rows are on, never from a stale one", () => {
    /*
     * A server answer that has not caught up: the user clicks Next, and the
     * host is still holding the previous page's rows when the table
     * re-renders. The number must describe the page the table is showing —
     * which is the page state, read on the render that draws the row — and
     * must not be a value captured when the rows were fetched, which is how
     * page 2 would go on printing 1…50 after the answer landed.
     */
    const { rerender } = render(
      <Harness server data={rows(50)} rowCount={200} pagination={{ pageSize: 50 }} />,
    )
    fireEvent.click(screen.getByRole("button", { name: /next page/i }))
    // Still the stale rows, already the new page's numbers — and the two
    // readings agree with each other, which is the part that matters.
    expect(numbers()[0]).toBe("51")
    expect(announcedNumbers()).toEqual(numbers())

    rerender(<Harness server data={rows(50, 50)} rowCount={200} pagination={{ pageSize: 50 }} />)
    expect(numbers()[0]).toBe("51")
    expect(numbers()[49]).toBe("100")
    expect(announcedNumbers()).toEqual(numbers())
  })

  it("numbers a server table whose first page has not been counted yet", () => {
    // `rowCount` undefined: the total is unknown, the offset is not. Numbers
    // are a property of the page, so they do not wait for a count.
    render(<Harness server data={rows(3)} />)
    expect(numbers()).toEqual(["1", "2", "3"])
    expect(latest?.pagination.rowCount).toBeUndefined()
    // And the column is declared at its unknown-count width rather than
    // collapsing to nothing.
    expect(colWidths()[0]).toBe(`${rowNumberColumnWidth(undefined)}px`)
  })

  it("numbers a client table's later page from the client's own offset", () => {
    render(<Harness data={rows(120)} pagination={{ pageSize: 50 }} />)
    expect(numbers()[0]).toBe("1")

    fireEvent.click(screen.getByRole("button", { name: /next page/i }))
    expect(numbers()[0]).toBe("51")
    expect(announcedNumbers()).toEqual(numbers())
  })

  it("numbers an unpaginated client table from one, with no offset to add", () => {
    render(<Harness data={rows(4)} pagination={false} />)
    expect(latest?.pagination.enabled).toBe(false)
    expect(numbers()).toEqual(["1", "2", "3", "4"])
    expect(announcedNumbers()).toEqual(numbers())
  })

  it("widens itself for the largest number the count can produce", () => {
    // Three digits assumed before an answer, six once a hundred thousand rows
    // are known — the column must not clip the last row's number.
    expect(rowNumberColumnWidth(100_000)).toBeGreaterThan(rowNumberColumnWidth(undefined))
    render(<Harness server data={rows(2)} rowCount={100_000} pagination={{ pageSize: 50 }} />)
    expect(colWidths()[0]).toBe(`${rowNumberColumnWidth(100_000)}px`)
  })
})

describe("a grouped page", () => {
  const grouped: (Row | GroupRow)[] = [groupRow(["open"], 2), ...rows(2), groupRow(["closed"], 5)]

  it("numbers every flattened row, group headers included", () => {
    render(
      <Harness
        server
        data={grouped}
        rowCount={4}
        initialLayout={{ grouping: ["name"], expanded: [["open"]] }}
      />,
    )
    // Four rows, four numbers: a group header is a row of the list being
    // looked at, and skipping it would need a count no page carries.
    expect(numbers()).toEqual(["1", "2", "3", "4"])
    expect(announcedNumbers()).toEqual(numbers())
  })

  it("gives the continued header an empty number cell rather than a number", () => {
    /*
     * The page begins with leaves and no header of its own: the "continued"
     * row is drawn by the client from `startPath`, so a number on it would
     * put every row after a page boundary one out.
     */
    render(
      <Harness
        server
        data={rows(3, 50)}
        rowCount={200}
        pagination={{ pageSize: 50 }}
        startPath={["open"]}
        initialLayout={{ grouping: ["name"], expanded: [["open"]] }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /next page/i }))
    const continued = document.querySelector<HTMLElement>(".dt-group-continued")
    expect(continued).not.toBeNull()
    expect(within(continued as HTMLElement).getByText("open (continued)")).toBeInTheDocument()
    // The cell is there — the gutter runs the whole height of the body — and
    // it says nothing.
    expect(continued?.querySelector(".dt-row-number")?.textContent).toBe("")
    // The rows under it go on counting from the page's own offset, with
    // nothing consumed by the header the client drew.
    expect(numbers()).toEqual(["51", "52", "53"])
    expect(announcedNumbers()).toEqual(numbers())
  })

  it("leads even the group column", () => {
    render(
      <Harness
        server
        data={grouped}
        rowCount={4}
        initialLayout={{ grouping: ["amount"], expanded: [] }}
      />,
    )
    // `amount` is the group column, which the grouping lifts to the front of
    // its section; the number column still stands before it.
    expect(latest?.grouping.columnId).toBe("amount")
    expect(renderedOrder()).toEqual([ROW_NUMBER_COLUMN_ID, "amount", "name"])
  })
})

describe("the column is chrome, not data", () => {
  it("is absent from the Columns panel", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("tab", { name: "Columns" }))
    const panel = document.querySelector<HTMLElement>(".dt-panel") as HTMLElement
    expect(panel.querySelector(`li[data-column-id="${ROW_NUMBER_COLUMN_ID}"]`)).toBeNull()
    // And the columns that ARE listed are exactly the host's.
    expect(
      [...panel.querySelectorAll("li.dt-panel-item")].map((item) =>
        item.getAttribute("data-column-id"),
      ),
    ).toEqual(["name", "amount"])
  })

  it("offers no drag handle, no menu, and refuses every drop", () => {
    render(<Harness />)
    const header = numberHeader()
    expect(header.getAttribute("draggable")).toBe("false")
    expect(header.querySelector(".dt-kebab")).toBeNull()

    // A column dragged onto it draws no slot and does not move: its region is
    // a solitary one, so nothing shares it. See `dropRegionOf`.
    const before = renderedOrder()
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: () => undefined,
      getData: () => "amount",
      setDragImage: () => undefined,
    }
    fireEvent.dragStart(
      document.querySelector('th[data-column-id="amount"]') as HTMLElement,
      { dataTransfer },
    )
    fireEvent.dragOver(header, { dataTransfer })
    expect(document.querySelector("th.dt-drop-slot")).toBeNull()
    fireEvent.drop(header, { dataTransfer })
    expect(renderedOrder()).toEqual(before)
  })

  it("cannot be sorted, filtered, hidden or unpinned", () => {
    render(<Harness />)
    const column = latest?.table.getColumn(ROW_NUMBER_COLUMN_ID)
    expect(column).toBeDefined()
    expect(column?.getCanSort()).toBe(false)
    expect(column?.getCanFilter()).toBe(false)
    expect(column?.getCanHide()).toBe(false)
    expect(column?.getCanPin()).toBe(false)
    expect(column?.getIsPinned()).toBe("start")
    // It stays pinned however hard a host pushes: the pinning it renders from
    // is derived, and `layout.columnPinning` is never written.
    expect(latest?.table.state.columnPinning?.start?.[0]).toBe(ROW_NUMBER_COLUMN_ID)
  })

  it("stays frozen at the start even where the host turned pinning off", () => {
    // `features: { pinning: false }` is about what the USER may freeze. The
    // number column is not the user's to place at all, so the flag that
    // withdraws the control must not also withdraw the column's own footing.
    render(<Harness pinning={false} />)
    expect(renderedOrder()[0]).toBe(ROW_NUMBER_COLUMN_ID)
    expect(latest?.table.getColumn(ROW_NUMBER_COLUMN_ID)?.getIsPinned()).toBe("start")
  })

  it("shows the user's own pinned columns their correct sticky offsets", () => {
    render(<Harness initialLayout={{ columnPinning: { start: ["amount"], end: [] } }} />)
    const width = rowNumberColumnWidth(3)
    // The number column is a real column, so `getStart()` counts its width:
    // an extra cell drawn beside the table would leave every pinned offset
    // after it short by exactly this much.
    expect(latest?.table.getColumn(ROW_NUMBER_COLUMN_ID)?.getStart("start")).toBe(0)
    expect(latest?.table.getColumn("amount")?.getStart("start")).toBe(width)
    expect(renderedOrder()).toEqual([ROW_NUMBER_COLUMN_ID, "amount", "name"])
  })
})

describe("its width", () => {
  it("is resizable, and the width the user sets is saved", () => {
    const saved: TableLayout[] = []
    const storage: LayoutStorage = {
      load: () => null,
      save: (_id, layout) => void saved.push(layout),
      clear: () => undefined,
    }
    render(<Harness storage={storage} />)
    const handle = within(numberHeader()).getByRole("button", { name: /Row number: resize column/i })

    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true })
    expect(colWidths()[0]).toBe(`${rowNumberColumnWidth(3) + 50}px`)

    fireEvent(window, new Event("pagehide"))
    expect(saved[saved.length - 1]?.columnSizing[ROW_NUMBER_COLUMN_ID]).toBe(
      rowNumberColumnWidth(3) + 50,
    )
  })

  it("survives a reload, where an unknown column's width would be pruned away", () => {
    const stored: Partial<TableLayout> = { columnSizing: { [ROW_NUMBER_COLUMN_ID]: 140 } }
    const storage: LayoutStorage = {
      load: () => stored,
      save: () => undefined,
      clear: () => undefined,
    }
    render(<Harness storage={storage} />)
    expect(colWidths()[0]).toBe("140px")
  })
})
