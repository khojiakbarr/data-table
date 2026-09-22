import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures, type DataTableInstance } from "./useDataTable"

interface Row { id: string; name: string }
const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 100 })]
const rows = (count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }))

let latest: DataTableInstance<Row> | null = null

function Table({
  count = 1000, pageSize = 50, statusBar = false,
}: { count?: number; pageSize?: number; statusBar?: boolean }) {
  const instance = useDataTable<Row>({
    id: "pg", columns, data: rows(count), pagination: { pageSize }, getRowId: (r) => r.id,
    features: { statusBar },
  })
  latest = instance
  return <DataTable instance={instance} virtualize={false} />
}

describe("pagination footer", () => {
  beforeEach(() => localStorage.clear())

  it("shows the range, the page and the total", () => {
    render(<Table />)
    expect(screen.getByText(/^Rows:/).textContent).toBe("Rows: 1\u202f000")
    // Grouped the same way "Rows" is above — the two used to disagree.
    expect(screen.getByText("1–50 of 1 000")).toBeInTheDocument()
    expect(screen.getByText("Page 1 of 20")).toBeInTheDocument()
  })

  it("navigates with the buttons and disables them at the edges", async () => {
    const user = userEvent.setup()
    render(<Table />)

    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: /next page/i }))
    expect(screen.getByText("51–100 of 1 000")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /last page/i }))
    expect(screen.getByText("951–1 000 of 1 000")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: /first page/i }))
    expect(screen.getByText("1–50 of 1 000")).toBeInTheDocument()
  })

  it("reaches the real last page after the data grows", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Table count={100} />)
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument()

    // A filter cleared, a fetch resolved, "load more": the same table, more rows.
    rerender(<Table count={500} />)
    expect(screen.getByText("Page 1 of 10")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /last page/i }))
    expect(screen.getByText("Page 10 of 10")).toBeInTheDocument()
    expect(screen.getByText("451–500 of 500")).toBeInTheDocument()
  })

  it("keeps Next moving after the data grows under the last page", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Table count={100} />)
    await user.click(screen.getByRole("button", { name: /next page/i })) // page 2 of 2

    rerender(<Table count={500} />)
    await user.click(screen.getByRole("button", { name: /next page/i }))
    expect(screen.getByText("Page 3 of 10")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /next page/i }))
    expect(screen.getByText("Page 4 of 10")).toBeInTheDocument()
  })

  it("changes the page size and keeps the top row in view", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(screen.getByRole("button", { name: /next page/i })) // rows 51–100
    await user.selectOptions(screen.getByRole("combobox", { name: /rows per page/i }), "20")
    expect(screen.getByText("41–60 of 1 000")).toBeInTheDocument()
    expect(latest?.pagination.pageSize).toBe(20)
  })

  it("jumps to a typed page and clamps out-of-range input", () => {
    render(<Table />)
    const input = screen.getByRole("spinbutton", { name: /page number/i })
    fireEvent.change(input, { target: { value: "7" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(screen.getByText("301–350 of 1 000")).toBeInTheDocument()
    fireEvent.change(input, { target: { value: "99" } })
    fireEvent.blur(input)
    expect(screen.getByText("951–1 000 of 1 000")).toBeInTheDocument()
  })

  it("renders no footer when pagination is off", () => {
    function Plain() {
      const instance = useDataTable<Row>({ id: "plain", columns, data: rows(3) })
      return <DataTable instance={instance} virtualize={false} />
    }
    const { container } = render(<Plain />)
    expect(container.querySelector(".dt-footer")).toBeNull()
  })

  it("lets the user type a page while the total is still unknown", () => {
    function ServerTable() {
      const instance = useDataTable<Row>({
        id: "pg-server", columns, data: rows(50), mode: "server",
        getRowId: (r) => r.id,
      })
      latest = instance
      return <DataTable instance={instance} virtualize={false} />
    }
    render(<ServerTable />)

    const input = screen.getByRole("spinbutton", { name: /page number/i })
    fireEvent.change(input, { target: { value: "7" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(latest?.pagination.pageIndex).toBe(6)
    expect(screen.getByRole("button", { name: /next page/i })).toBeEnabled()
    expect(screen.getByRole("button", { name: /last page/i })).toBeDisabled()
    expect(screen.getByText(/^Rows:/).textContent).toBe("Rows: …")
  })

  it("resyncs the typed page after a clamp that lands on the current page", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(screen.getByRole("button", { name: /last page/i })) // page 20

    const input = screen.getByRole("spinbutton", { name: /page number/i })
    fireEvent.change(input, { target: { value: "99" } })
    fireEvent.blur(input)

    expect(input).toHaveValue(20)
  })

  it("hides the footer when footer is false even with paging on", () => {
    function NoFooter() {
      const instance = useDataTable<Row>({
        id: "pg-no-footer", columns, data: rows(3), pagination: true, getRowId: (r) => r.id,
      })
      return <DataTable instance={instance} virtualize={false} footer={false} />
    }
    const { container } = render(<NoFooter />)
    expect(container.querySelector(".dt-footer")).toBeNull()
  })
})

/**
 * `aria-rowcount` / `aria-rowindex` describe the whole table to a screen
 * reader, not the page in the DOM — the same contract virtualisation already
 * had to honour. See DataTable.tsx's `totalRowCount` / `rowIndexOffset`.
 */
describe("pagination and row-count accessibility", () => {
  beforeEach(() => localStorage.clear())

  const dataRows = () => screen.getAllByRole("row").filter((r) => r.classList.contains("dt-tr"))

  it("reports the true total, not the page size, and keeps it across pages", async () => {
    const user = userEvent.setup()
    const { container } = render(<Table count={1000} pageSize={50} />)
    const table = container.querySelector("table.dt-table") as HTMLElement
    // 1000 rows plus the one header row.
    expect(table.getAttribute("aria-rowcount")).toBe("1001")

    await user.click(screen.getByRole("button", { name: /next page/i }))
    // The total does not shrink to the page size on page 2.
    expect(table.getAttribute("aria-rowcount")).toBe("1001")
  })

  it("continues aria-rowindex from the page offset instead of restarting at 1", async () => {
    const user = userEvent.setup()
    render(<Table count={1000} pageSize={50} />)
    expect(dataRows()[0]?.getAttribute("aria-rowindex")).toBe("2") // header + row 0

    await user.click(screen.getByRole("button", { name: /next page/i })) // page 2: rows 50-99
    // Row "Row 50" is the 51st data row: 50 (offset) + 1 (header) + 1 = 52.
    expect(dataRows()[0]?.getAttribute("aria-rowindex")).toBe("52")
    expect(dataRows()[0]).toHaveTextContent("Row 50")
  })

  it("reports -1 (unknown) in server mode before the row count has arrived", () => {
    function ServerTable() {
      const instance = useDataTable<Row>({
        id: "pg-server-unknown", columns, data: rows(50), mode: "server", getRowId: (r) => r.id,
      })
      return <DataTable instance={instance} virtualize={false} />
    }
    const { container } = render(<ServerTable />)
    const table = container.querySelector("table.dt-table") as HTMLElement
    expect(table.getAttribute("aria-rowcount")).toBe("-1")
  })

  it("offsets aria-rowindex by the page in server mode once the total is known", async () => {
    const user = userEvent.setup()
    const all = rows(500)
    // A minimal stand-in for the README's TanStack Query recipe: `data`
    // follows the announced query's page, the way a real fetch would.
    function ServerTable() {
      const [page, setPage] = useState(0)
      const instance = useDataTable<Row>({
        id: "pg-server-known", columns, data: all.slice(page * 50, page * 50 + 50),
        mode: "server", rowCount: 500, getRowId: (r) => r.id,
        onQueryChange: (query) => setPage(query.pagination.pageIndex),
      })
      return <DataTable instance={instance} virtualize={false} />
    }
    const { container } = render(<ServerTable />)
    const table = container.querySelector("table.dt-table") as HTMLElement
    expect(table.getAttribute("aria-rowcount")).toBe("501")

    await user.click(screen.getByRole("button", { name: /next page/i }))
    await user.click(screen.getByRole("button", { name: /next page/i })) // page index 2
    // Page index 2, page size 50: offset 100, plus header, plus 1-based index.
    expect(dataRows()[0]?.getAttribute("aria-rowindex")).toBe("102")
    expect(dataRows()[0]).toHaveTextContent("Row 100")
  })
})

describe("the status-bar hand-off", () => {
  beforeEach(() => localStorage.clear())

  it("prints the row count itself with the status bar off — today's shape, unchanged", () => {
    render(<Table statusBar={false} />)
    expect(screen.getByText(/^Rows:/).textContent).toBe("Rows: 1 000")
  })

  it("drops the row count once the status bar is on, keeping the rest of the footer", () => {
    render(<Table statusBar />)
    expect(screen.queryByText(/^Rows:/)).toBeNull()
    // The page-size selector, the range and the page controls all survive.
    expect(screen.getByText("1–50 of 1 000")).toBeInTheDocument()
    expect(screen.getByText("Page 1 of 20")).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: /pagination/i })).toBeInTheDocument()
  })
})
