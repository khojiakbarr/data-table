import { createColumnHelper } from "@tanstack/react-table"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import { ruLabels } from "./labels/ru"
import { useDataTable, type DataTableFeatures } from "./useDataTable"
import type { TableQuery } from "./core/query"
import type { RowsLayout } from "./types"

/**
 * The sort control cards draw in the rail (0.17.0): cards have no header to
 * sort by, so the rail offers the sort. What is asserted is where it is drawn
 * and where not, that it writes the table's own sorting (the state a header
 * click writes, so a server host hears it), that it says the sort in force,
 * and that the keyboard reaches all of it.
 */

interface Lot {
  id: string
  code: string
  expiry: string
  left: number
}

const helper = createColumnHelper<DataTableFeatures, Lot>()
const COLUMNS = [
  helper.accessor("code", { header: "Code", meta: { card: "code" } }),
  helper.accessor("expiry", { header: "Expiry", meta: { card: "title" } }),
  helper.accessor("left", { header: () => <span>#</span>, meta: { card: "amount", label: "Left" } }),
  helper.display({ id: "actions", header: "Actions", cell: () => null, meta: { card: "actions" } }),
]

const LOTS: Lot[] = [
  { id: "l1", code: "L-1", expiry: "2026-12-01", left: 5 },
  { id: "l2", code: "L-2", expiry: "2026-11-01", left: 9 },
]

interface HarnessProps {
  layout?: RowsLayout
  sorting?: boolean
  columns?: typeof COLUMNS
  onQueryChange?: (query: TableQuery) => void
  russian?: boolean
  filtering?: boolean
}

function Harness({ layout = "cards", sorting = true, columns = COLUMNS, onQueryChange, russian = false, filtering = true }: HarnessProps) {
  const instance = useDataTable<Lot>({
    id: "lots",
    columns,
    data: LOTS,
    mode: onQueryChange ? "server" : "client",
    ...(onQueryChange ? { onQueryChange, rowCount: LOTS.length } : {}),
    features: { sorting },
    filtering,
    getRowId: (row) => row.id,
  })
  return <DataTable instance={instance} layout={layout} virtualize={false} {...(russian ? { labels: ruLabels } : {})} />
}

const sortButton = () => screen.queryByRole("button", { name: /^Sort/ })
const titles = () => [...document.querySelectorAll(".dt-card-title")].map((title) => title.textContent)

beforeEach(() => {
  localStorage.clear()
})

describe("the cards' sort control", () => {
  it("is drawn in the rail over cards, and named «Sort» while nothing is sorted", () => {
    render(<Harness />)
    const button = sortButton()!
    expect(button).toHaveTextContent("Sort")
    expect(button).toHaveAttribute("aria-haspopup", "menu")
    expect(button).toHaveAttribute("aria-expanded", "false")
    expect(button.closest(".dt-sidebar-head")).not.toBeNull()
    // Outside the tablist, which holds tabs only.
    expect(button.closest("[role='tablist']")).toBeNull()
  })

  it("stands beside the Filters tab, and alone in the rail when there is no tab", () => {
    const { unmount } = render(<Harness />)
    expect(screen.getByRole("tab", { name: /Filters/ })).toBeInTheDocument()
    expect(sortButton()).toBeInTheDocument()
    unmount()
    render(<Harness filtering={false} />)
    expect(screen.queryByRole("tablist")).toBeNull()
    expect(sortButton()?.closest(".dt-sidebar")).not.toBeNull()
  })

  it("is not drawn over a table, which has its headers", () => {
    render(<Harness layout="table" />)
    expect(sortButton()).toBeNull()
  })

  it("is not drawn when sorting is off", () => {
    render(<Harness sorting={false} />)
    expect(sortButton()).toBeNull()
  })

  it("is not drawn when no column can sort", () => {
    const unsortable = COLUMNS.map((column) => ({ ...column, enableSorting: false })) as unknown as typeof COLUMNS
    render(<Harness columns={unsortable} />)
    expect(sortButton()).toBeNull()
  })

  it("offers each column that can sort by its name, and nothing to clear while nothing is sorted", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(sortButton()!)
    const menu = screen.getByRole("menu", { name: "Sort" })
    expect(within(menu).getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual(["Code", "Expiry", "Left"])
    expect(within(menu).queryByRole("menuitem", { name: "No sorting" })).toBeNull()
    expect(within(menu).queryByRole("menuitemradio", { name: "Descending" })).toBeNull()
  })

  it("sorts by the column chosen, ascending, and names it on the button", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(titles()).toEqual(["2026-12-01", "2026-11-01"])
    await user.click(sortButton()!)
    await user.click(screen.getByRole("menuitemradio", { name: "Expiry" }))
    expect(screen.queryByRole("menu")).toBeNull()
    expect(titles()).toEqual(["2026-11-01", "2026-12-01"])
    const button = sortButton()!
    expect(button).toHaveAccessibleName("Sort: Expiry, Ascending")
    expect(button.querySelector(".dt-card-sort-label")).toHaveTextContent("Expiry")
    expect(button).toHaveAttribute("data-dt-sorted")
  })

  it("marks the sort in force and turns its direction", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(sortButton()!)
    await user.click(screen.getByRole("menuitemradio", { name: "Expiry" }))
    await user.click(sortButton()!)
    expect(screen.getByRole("menuitemradio", { name: "Expiry" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("menuitemradio", { name: "Code" })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("menuitemradio", { name: "Ascending" })).toHaveAttribute("aria-checked", "true")
    await user.click(screen.getByRole("menuitemradio", { name: "Descending" }))
    expect(titles()).toEqual(["2026-12-01", "2026-11-01"])
    expect(sortButton()).toHaveAccessibleName("Sort: Expiry, Descending")
  })

  it("clears the sort", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(sortButton()!)
    await user.click(screen.getByRole("menuitemradio", { name: "Left" }))
    await user.click(sortButton()!)
    await user.click(screen.getByRole("menuitem", { name: "No sorting" }))
    expect(sortButton()).toHaveAccessibleName("Sort")
    expect(sortButton()).not.toHaveAttribute("data-dt-sorted")
  })

  it("writes the table's own sorting: a server host hears it in its query", async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    render(<Harness onQueryChange={onQueryChange} />)
    await user.click(sortButton()!)
    await user.click(screen.getByRole("menuitemradio", { name: "Expiry" }))
    await vi.waitFor(() =>
      expect(onQueryChange.mock.lastCall?.[0].sorting).toEqual([{ id: "expiry", desc: false }]),
    )
    expect(onQueryChange.mock.lastCall?.[0].pagination.pageIndex).toBe(0)
  })

  it("leaves the sort to the header once the table is drawn again, its arrow on the same column", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness />)
    await user.click(sortButton()!)
    await user.click(screen.getByRole("menuitemradio", { name: "Left" }))
    await user.click(sortButton()!)
    await user.click(screen.getByRole("menuitemradio", { name: "Descending" }))
    rerender(<Harness layout="table" />)
    expect(sortButton()).toBeNull()
    expect(screen.getByRole("columnheader", { name: /Left|#/ })).toHaveAttribute("aria-sort", "descending")
  })

  it("is worked from the keyboard, and hands the focus back to its button", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const button = sortButton()!
    button.focus()
    await user.keyboard("{Enter}")
    expect(screen.getByRole("menuitemradio", { name: "Code" })).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(screen.getByRole("menuitemradio", { name: "Expiry" })).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(screen.queryByRole("menu")).toBeNull()
    expect(button).toHaveFocus()
    expect(button).toHaveAccessibleName("Sort: Expiry, Ascending")

    await user.keyboard("{Enter}")
    expect(screen.getByRole("menu")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("menu")).toBeNull()
    expect(button).toHaveFocus()
  })

  it("closes from its own button", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(sortButton()!)
    expect(sortButton()).toHaveAttribute("aria-expanded", "true")
    await user.click(sortButton()!)
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("speaks the host's language", async () => {
    const user = userEvent.setup()
    render(<Harness russian />)
    const button = screen.getByRole("button", { name: "Сортировка" })
    await user.click(button)
    await user.click(screen.getByRole("menuitemradio", { name: "Expiry" }))
    await user.click(button)
    expect(screen.getByRole("menuitemradio", { name: "По возрастанию" })).toBeInTheDocument()
    expect(screen.getByRole("menuitemradio", { name: "По убыванию" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Без сортировки" })).toBeInTheDocument()
  })
})
