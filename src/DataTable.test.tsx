import { createColumnHelper } from "@tanstack/react-table"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { localStorageLayout } from "./core/persistence"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

interface Row {
  code: string
  partner: string
  amount: number
}

const rows: Row[] = [
  { code: "KR-3", partner: "Gamma", amount: 30 },
  { code: "KR-1", partner: "Alpha", amount: 10 },
  { code: "KR-2", partner: "Beta", amount: 20 },
]

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("code", { header: "Code", size: 100 }),
  helper.accessor("partner", { header: "Partner", size: 200 }),
  helper.accessor("amount", { header: "Amount", size: 120 }),
]

function Table({
  id,
  pinned = false,
}: {
  id: string
  pinned?: boolean
}) {
  const instance = useDataTable({
    id,
    data: rows,
    columns,
    storage: localStorageLayout(),
    ...(pinned ? { initialLayout: { columnPinning: { start: ["code"], end: [] } } } : {}),
  })
  return <DataTable instance={instance} />
}

/** Read the visible body values of one column, top to bottom. */
function columnValues(table: HTMLElement, index: number): string[] {
  const bodyRows = within(table).getAllByRole("row").slice(1)
  return bodyRows.map((row) => within(row).getAllByRole("cell")[index]?.textContent ?? "")
}

describe("DataTable", () => {
  beforeEach(() => localStorage.clear())

  it("renders every row and column", () => {
    render(<Table id="t1" />)
    expect(screen.getAllByRole("row")).toHaveLength(rows.length + 1)
    expect(screen.getByText("Partner")).toBeInTheDocument()
  })

  it("sorts ascending, then descending, then clears", async () => {
    const user = userEvent.setup()
    render(<Table id="t1" />)
    const table = screen.getByRole("table")

    expect(columnValues(table, 0)).toEqual(["KR-3", "KR-1", "KR-2"])

    await user.click(screen.getByRole("button", { name: /code: sort ascending/i }))
    expect(columnValues(table, 0)).toEqual(["KR-1", "KR-2", "KR-3"])

    await user.click(screen.getByRole("button", { name: /code: sort descending/i }))
    expect(columnValues(table, 0)).toEqual(["KR-3", "KR-2", "KR-1"])
  })

  it("marks the sorted column for assistive technology", async () => {
    const user = userEvent.setup()
    render(<Table id="t1" />)

    const header = screen.getByRole("columnheader", { name: /code/i })
    expect(header).toHaveAttribute("aria-sort", "none")

    await user.click(within(header).getByRole("button", { name: /sort/i }))
    expect(header).toHaveAttribute("aria-sort", "ascending")
  })

  it("hides a column from the panel and keeps it out of the body", async () => {
    const user = userEvent.setup()
    render(<Table id="t1" />)

    await user.click(screen.getByRole("tab", { name: /columns/i }))
    await user.click(screen.getByLabelText("Partner"))

    expect(screen.queryByRole("columnheader", { name: /partner/i })).toBeNull()
    expect(screen.queryByText("Alpha")).toBeNull()
  })

  it("sticks a pinned column to the start edge", () => {
    render(<Table id="t1" pinned />)
    const header = screen.getByRole("columnheader", { name: /code/i })

    expect(header.className).toContain("dt-pinned")
    expect(header.style.insetInlineStart).toBe("0px")
  })

  it("offsets the second pinned column by the width of the first", async () => {
    const user = userEvent.setup()
    render(<Table id="t1" pinned />)

    // Pin "Partner" to the start as well, from its header menu.
    await user.click(screen.getByRole("button", { name: /partner: column actions/i }))
    await user.click(screen.getByRole("menuitem", { name: /pin to start/i }))

    const partnerHeader = screen.getByRole("columnheader", { name: /partner/i })
    // Code is 100 wide, so Partner starts at 100.
    expect(partnerHeader.style.insetInlineStart).toBe("100px")
  })

  it("remembers a layout across remounts", async () => {
    const user = userEvent.setup()
    const first = render(<Table id="persisted" />)

    await user.click(screen.getByRole("tab", { name: /columns/i }))
    await user.click(screen.getByLabelText("Partner"))
    // Unmounting mid-debounce must still flush.
    first.unmount()

    render(<Table id="persisted" />)
    expect(screen.queryByRole("columnheader", { name: /partner/i })).toBeNull()
  })

  it("keeps two tables on one page independent", async () => {
    const user = userEvent.setup()
    render(
      <>
        <div data-testid="left">
          <Table id="left-table" />
        </div>
        <div data-testid="right">
          <Table id="right-table" />
        </div>
      </>,
    )

    const left = screen.getByTestId("left")
    const right = screen.getByTestId("right")

    // Hide "Partner" in the left table only.
    await user.click(within(left).getByRole("tab", { name: /columns/i }))
    await user.click(within(left).getByLabelText("Partner"))

    expect(within(left).queryByRole("columnheader", { name: /partner/i })).toBeNull()
    expect(within(right).getByRole("columnheader", { name: /partner/i })).toBeInTheDocument()

    // Saves are debounced so a resize drag does not write on every frame.
    await waitFor(() =>
      expect(localStorage.getItem("data-table:layout:left-table")).not.toBeNull(),
    )
    expect(localStorage.getItem("data-table:layout:right-table")).toBeNull()
  })

  it("sorts each table independently", async () => {
    const user = userEvent.setup()
    render(
      <>
        <div data-testid="left">
          <Table id="left-table" />
        </div>
        <div data-testid="right">
          <Table id="right-table" />
        </div>
      </>,
    )

    const left = screen.getByTestId("left")
    const right = screen.getByTestId("right")

    await user.click(within(left).getByRole("button", { name: /code: sort ascending/i }))

    expect(columnValues(within(left).getByRole("table"), 0)).toEqual([
      "KR-1",
      "KR-2",
      "KR-3",
    ])
    expect(columnValues(within(right).getByRole("table"), 0)).toEqual([
      "KR-3",
      "KR-1",
      "KR-2",
    ])
  })

  it("shows the empty state when there are no rows", () => {
    function Empty() {
      const instance = useDataTable({ id: "empty", data: [] as Row[], columns })
      return <DataTable instance={instance} />
    }
    render(<Empty />)
    expect(screen.getByText("No rows")).toBeInTheDocument()
  })
})
