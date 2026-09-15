import { createColumnHelper } from "@tanstack/react-table"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * Expandable rows, in both shapes: a detail panel under a row, and child rows
 * that indent by depth. Both run on the same expansion state, so a table can
 * use either or both.
 */

interface Node {
  name: string
  qty: number
  children?: Node[]
}

const tree: Node[] = [
  {
    name: "Cement",
    qty: 1,
    children: [
      { name: "Clinker", qty: 0.8, children: [{ name: "Limestone", qty: 1.2 }] },
      { name: "Gypsum", qty: 0.05 },
    ],
  },
  { name: "Concrete", qty: 1 },
]

const flat: Node[] = [
  { name: "Row one", qty: 1 },
  { name: "Row two", qty: 2 },
]

const helper = createColumnHelper<DataTableFeatures, Node>()
const columns = [
  helper.accessor("name", { header: "Name", size: 200 }),
  helper.accessor("qty", { header: "Qty", size: 100 }),
]

function Tree() {
  const instance = useDataTable({
    id: "tree",
    data: tree,
    columns,
    getSubRows: (row) => row.children,
  })
  return <DataTable instance={instance} />
}

function WithDetail() {
  const instance = useDataTable({ id: "detail", data: flat, columns })
  return (
    <DataTable
      instance={instance}
      renderDetail={(row) => <div data-testid="detail">Detail for {row.name}</div>}
    />
  )
}

function Plain() {
  const instance = useDataTable({ id: "plain", data: flat, columns })
  return <DataTable instance={instance} />
}

const rowNames = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent?.trim())
    .filter((name) => name !== undefined && name !== "")

describe("expandable rows", () => {
  beforeEach(() => localStorage.clear())

  it("shows no toggle when a table is neither a tree nor has a detail panel", () => {
    render(<Plain />)
    expect(screen.queryByRole("button", { name: /expand row/i })).toBeNull()
  })

  it("opens a detail panel under its row", async () => {
    const user = userEvent.setup()
    render(<WithDetail />)

    expect(screen.queryByTestId("detail")).toBeNull()
    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)

    expect(screen.getByTestId("detail")).toHaveTextContent("Detail for Row one")
  })

  it("closes the panel again", async () => {
    const user = userEvent.setup()
    render(<WithDetail />)

    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)
    await user.click(screen.getByRole("button", { name: /collapse row/i }))

    expect(screen.queryByTestId("detail")).toBeNull()
  })

  it("opens each row's panel independently", async () => {
    const user = userEvent.setup()
    render(<WithDetail />)

    const [first, second] = screen.getAllByRole("button", { name: /expand row/i })
    await user.click(first as HTMLElement)
    await user.click(second as HTMLElement)

    expect(screen.getAllByTestId("detail")).toHaveLength(2)
  })

  it("reports its state to assistive technology", async () => {
    const user = userEvent.setup()
    render(<WithDetail />)

    const toggle = screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement
    expect(toggle).toHaveAttribute("aria-expanded", "false")

    await user.click(toggle)
    expect(screen.getByRole("button", { name: /collapse row/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })

  it("does not open a row when the row itself is clicked", async () => {
    const user = userEvent.setup()
    const clicks: string[] = []

    function Clickable() {
      const instance = useDataTable({ id: "clickable", data: flat, columns })
      return (
        <DataTable
          instance={instance}
          onRowClick={(row) => clicks.push(row.name)}
          renderDetail={(row) => <div data-testid="detail">{row.name}</div>}
        />
      )
    }
    render(<Clickable />)

    // Clicking the toggle opens the row and must not also fire the row click.
    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)
    expect(screen.getByTestId("detail")).toBeInTheDocument()
    expect(clicks).toEqual([])
  })

  it("shows child rows only once their parent is open", async () => {
    const user = userEvent.setup()
    render(<Tree />)

    expect(rowNames()).toEqual(["Cement", "Concrete"])

    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)
    expect(rowNames()).toEqual(["Cement", "Clinker", "Gypsum", "Concrete"])
  })

  it("nests to any depth", async () => {
    const user = userEvent.setup()
    render(<Tree />)

    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)
    // Clinker is now the first still-collapsed row.
    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)

    expect(rowNames()).toEqual(["Cement", "Clinker", "Limestone", "Gypsum", "Concrete"])
  })

  it("indents each level", async () => {
    const user = userEvent.setup()
    render(<Tree />)

    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)
    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)

    const depths = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.getAttribute("data-depth"))

    expect(depths).toEqual(["0", "1", "2", "1", "0"])
  })

  it("gives a leaf row no toggle but keeps it aligned", async () => {
    const user = userEvent.setup()
    const { container } = render(<Tree />)

    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)

    // Gypsum has no children: a spacer holds its place instead of a toggle.
    expect(container.querySelectorAll(".dt-depth-spacer").length).toBeGreaterThan(0)
  })

  it("does not persist which rows were open", async () => {
    const user = userEvent.setup()
    const view = render(<WithDetail />)

    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)
    expect(screen.getByTestId("detail")).toBeInTheDocument()
    view.unmount()

    // Reading position is not an arrangement worth restoring.
    render(<WithDetail />)
    expect(screen.queryByTestId("detail")).toBeNull()
  })
})
