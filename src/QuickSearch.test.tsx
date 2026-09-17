import { createColumnHelper } from "@tanstack/react-table"
import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DataTable, defaultLabels } from "./components/DataTable"
import { QuickSearch } from "./components/QuickSearch"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/** The toolbar's search box: what it renders, what it announces, what it clears. */

interface Row {
  id: string
  name: string
  tag: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 100 }),
  helper.accessor("tag", { header: "Tag", size: 100 }),
]
const data: Row[] = [
  { id: "r0", name: "Agro Ltd", tag: "open" },
  { id: "r1", name: "Temir", tag: "closed" },
]

function Table({ filtering, toolbar = true }: { filtering?: boolean; toolbar?: boolean }) {
  const instance = useDataTable<Row>({
    id: "qs",
    columns,
    data,
    getRowId: (row) => row.id,
    ...(filtering === undefined ? {} : { filtering }),
  })
  return (
    <>
      {toolbar ? null : <QuickSearch instance={instance} labels={defaultLabels} />}
      <DataTable instance={instance} toolbar={toolbar} virtualize={false} />
    </>
  )
}

afterEach(() => vi.useRealTimers())

describe("quick search box", () => {
  it("narrows the rows and announces the count politely", () => {
    vi.useFakeTimers()
    render(<Table />)
    const box = screen.getByRole("searchbox", { name: "Search rows" })

    fireEvent.change(box, { target: { value: "temir" } })
    expect(box).toHaveValue("temir")
    expect(screen.getByText("Agro Ltd")).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(300))
    expect(screen.queryByText("Agro Ltd")).not.toBeInTheDocument()
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("1 matching rows")
    expect(status).toHaveAttribute("aria-live", "polite")
  })

  it("sits before the spacer, so it is left of the Columns button", () => {
    const { container } = render(<Table />)
    const toolbar = container.querySelector(".dt-toolbar")!
    const classes = Array.from(toolbar.children).map((child) => child.className)

    expect(classes.indexOf("dt-search-box")).toBeLessThan(classes.indexOf("dt-spacer"))
  })

  it("offers a clear affordance only while it holds text", async () => {
    const user = userEvent.setup()
    render(<Table />)
    const box = screen.getByRole("searchbox", { name: "Search rows" })
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument()

    await user.type(box, "temir")
    await user.click(screen.getByRole("button", { name: "Clear search" }))

    expect(box).toHaveValue("")
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument()
  })

  it("never steals focus", () => {
    render(<Table />)
    expect(document.activeElement).toBe(document.body)
  })

  it("renders no search box when filtering is off", () => {
    render(<Table filtering={false} />)
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
  })

  it("is exported for a shell of its own", () => {
    vi.useFakeTimers()
    render(<Table toolbar={false} />)
    expect(document.querySelector(".dt-toolbar")).toBeNull()

    fireEvent.change(screen.getByRole("searchbox", { name: "Search rows" }), { target: { value: "agro" } })
    act(() => vi.advanceTimersByTime(300))
    expect(screen.queryByText("Temir")).not.toBeInTheDocument()
  })
})
