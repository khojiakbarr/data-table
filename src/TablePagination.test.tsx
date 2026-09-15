import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures, type DataTableInstance } from "./useDataTable"

interface Row { id: string; name: string }
const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 100 })]
const rows = (count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }))

let latest: DataTableInstance<Row> | null = null

function Table({ count = 1000, pageSize = 50 }: { count?: number; pageSize?: number }) {
  const instance = useDataTable<Row>({
    id: "pg", columns, data: rows(count), pagination: { pageSize }, getRowId: (r) => r.id,
  })
  latest = instance
  return <DataTable instance={instance} virtualize={false} />
}

describe("pagination footer", () => {
  beforeEach(() => localStorage.clear())

  it("shows the range, the page and the total", () => {
    render(<Table />)
    expect(screen.getByText(/^Rows:/).textContent).toBe("Rows: 1\u202f000")
    expect(screen.getByText("1–50 of 1000")).toBeInTheDocument()
    expect(screen.getByText("Page 1 of 20")).toBeInTheDocument()
  })

  it("navigates with the buttons and disables them at the edges", async () => {
    const user = userEvent.setup()
    render(<Table />)

    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: /next page/i }))
    expect(screen.getByText("51–100 of 1000")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /last page/i }))
    expect(screen.getByText("951–1000 of 1000")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: /first page/i }))
    expect(screen.getByText("1–50 of 1000")).toBeInTheDocument()
  })

  it("changes the page size and keeps the top row in view", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(screen.getByRole("button", { name: /next page/i })) // rows 51–100
    await user.selectOptions(screen.getByRole("combobox", { name: /rows per page/i }), "20")
    expect(screen.getByText("41–60 of 1000")).toBeInTheDocument()
    expect(latest?.pagination.pageSize).toBe(20)
  })

  it("jumps to a typed page and clamps out-of-range input", () => {
    render(<Table />)
    const input = screen.getByRole("spinbutton", { name: /page number/i })
    fireEvent.change(input, { target: { value: "7" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(screen.getByText("301–350 of 1000")).toBeInTheDocument()
    fireEvent.change(input, { target: { value: "99" } })
    fireEvent.blur(input)
    expect(screen.getByText("951–1000 of 1000")).toBeInTheDocument()
  })

  it("renders no footer when pagination is off", () => {
    function Plain() {
      const instance = useDataTable<Row>({ id: "plain", columns, data: rows(3) })
      return <DataTable instance={instance} virtualize={false} />
    }
    const { container } = render(<Plain />)
    expect(container.querySelector(".dt-footer")).toBeNull()
  })
})
