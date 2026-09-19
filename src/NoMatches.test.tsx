import { createColumnHelper } from "@tanstack/react-table"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import type { FilterCondition } from "./core/filters"
import { useDataTable, type DataTableFeatures } from "./useDataTable"
import type { TableLayout } from "./types"

/**
 * "No rows" and "no rows match" are different situations, and only one of them
 * has a way out.
 */

interface Row {
  id: string
  name: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 100 })]
const data: Row[] = [
  { id: "r0", name: "Agro Ltd" },
  { id: "r1", name: "Temir" },
]
const matchesNothing: FilterCondition = {
  kind: "text",
  field: "name",
  op: "contains",
  value: "zzzz",
}

function Table({
  rows = data,
  initialLayout,
  custom = false,
  toolbar = true,
}: {
  rows?: Row[]
  initialLayout?: Partial<TableLayout>
  custom?: boolean
  toolbar?: boolean
}) {
  const instance = useDataTable<Row>({
    id: "empty",
    columns,
    data: rows,
    getRowId: (row) => row.id,
    ...(initialLayout === undefined ? {} : { initialLayout }),
  })
  return (
    <DataTable
      instance={instance}
      virtualize={false}
      toolbar={toolbar}
      {...(custom ? { emptyState: <p>Nothing here</p> } : {})}
    />
  )
}

const shown = () => screen.queryAllByRole("row").filter((row) => row.classList.contains("dt-tr"))

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

describe("the filtered-empty state", () => {
  it("says a filter excluded everything, and offers a way out", () => {
    render(<Table initialLayout={{ filters: [matchesNothing] }} />)

    expect(shown()).toHaveLength(0)
    expect(screen.getByText("No rows match the current filters")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument()
  })

  it("brings the rows back from the empty state itself", () => {
    vi.useFakeTimers()
    render(<Table initialLayout={{ filters: [matchesNothing], search: "zzzz" }} />)

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    /*
     * The search goes with the filters — an exit that left one of them on
     * would still show an empty table — but it reaches the row model on the
     * same debounce every other search change does, so the timers have to run
     * before the rows can be counted.
     */
    act(() => vi.advanceTimersByTime(300))

    expect(shown()).toHaveLength(2)
    expect(screen.queryByText("No rows match the current filters")).toBeNull()
  })

  it("still says no rows when the table simply has none", () => {
    render(<Table rows={[]} />)

    expect(screen.getByText("No rows")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull()
  })

  it("leaves a host's own empty state alone in both cases", () => {
    render(<Table rows={[]} custom />)
    expect(screen.getByText("Nothing here")).toBeInTheDocument()

    render(<Table initialLayout={{ filters: [matchesNothing] }} custom />)
    expect(screen.getAllByText("Nothing here")).toHaveLength(2)
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull()
  })

  it("returns focus to the search box when the clear-filters button, which unmounts, is used", () => {
    vi.useFakeTimers()
    render(<Table initialLayout={{ filters: [matchesNothing] }} />)

    const clearButton = screen.getByRole("button", { name: "Clear filters" })
    clearButton.focus()
    expect(document.activeElement).toBe(clearButton)

    fireEvent.click(clearButton)
    // Clearing brings the rows back, which unmounts this button along with
    // the rest of the empty state — see the focus handoff below.
    act(() => vi.advanceTimersByTime(300))

    // The button that was just focused has now unmounted — without an
    // explicit handoff, React does not relocate focus and it falls back to
    // `<body>`, the same defect `QuickSearch`'s own clear button avoids.
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search rows" }))
  })

  it("falls back to the viewport when toolbar={false} leaves no search box to hand focus to", () => {
    vi.useFakeTimers()
    const { container } = render(<Table initialLayout={{ filters: [matchesNothing] }} toolbar={false} />)

    const clearButton = screen.getByRole("button", { name: "Clear filters" })
    clearButton.focus()

    fireEvent.click(clearButton)
    act(() => vi.advanceTimersByTime(300))

    expect(document.activeElement).toBe(container.querySelector(".dt-viewport"))
  })
})
