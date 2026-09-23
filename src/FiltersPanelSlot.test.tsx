import { createColumnHelper } from "@tanstack/react-table"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable, type FiltersPanelSlot } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * A host's own filters, inside the side bar's Filters tab.
 *
 * For a backend whose list endpoint takes fixed parameters — a role id, a
 * status — rather than the column conditions this table publishes: the host
 * draws those fields itself, and they belong where a user looks for filters.
 *
 * And the tab that shows nothing: with no filterable column and no host
 * filters, a Filters tab opens onto an empty note and a disabled button, so
 * it is not offered at all.
 */

interface Row {
  id: string
  name: string
  role: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const data: Row[] = [{ id: "r0", name: "Malika", role: "Admin" }]

const filterable = [
  helper.accessor("name", { header: "Name", size: 100 }),
  helper.accessor("role", { header: "Role", size: 100 }),
]
const unfilterable = [
  helper.accessor("name", { header: "Name", size: 100, meta: { filter: false } }),
  helper.accessor("role", { header: "Role", size: 100, meta: { filter: false } }),
]

function Table({
  columns = filterable,
  filtersPanel,
}: {
  columns?: typeof filterable
  filtersPanel?: FiltersPanelSlot | undefined
}) {
  const instance = useDataTable<Row>({ id: "host-filters", columns, data, getRowId: (row) => row.id })
  return <DataTable instance={instance} virtualize={false} filtersPanel={filtersPanel} />
}

const openFilters = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("tab", { name: /^Filters/ }))

const panelBody = (): HTMLElement => document.querySelector<HTMLElement>(".dt-panel-body")!

beforeEach(() => localStorage.clear())

describe("host filters in the Filters tab", () => {
  it("renders the host's content inside the tab", async () => {
    const user = userEvent.setup()
    render(<Table filtersPanel={{ content: <label>Role <select aria-label="Role picker" /></label> }} />)

    await openFilters(user)

    expect(within(panelBody()).getByLabelText("Role picker")).toBeInTheDocument()
  })

  it("puts the host's content above the column filters, which stay", async () => {
    const user = userEvent.setup()
    render(<Table filtersPanel={{ content: <p>Host fields</p> }} />)

    await openFilters(user)

    const host = within(panelBody()).getByText("Host fields")
    const firstColumn = within(panelBody()).getByRole("button", { name: /Name/ })
    expect(host.compareDocumentPosition(firstColumn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("offers the tab for host filters even when no column can be filtered", async () => {
    const user = userEvent.setup()
    render(<Table columns={unfilterable} filtersPanel={{ content: <p>Host fields</p> }} />)

    await openFilters(user)

    expect(within(panelBody()).getByText("Host fields")).toBeInTheDocument()
  })

  it("draws no empty column-filter section when no column can be filtered", async () => {
    // "No filters set" and a disabled "Clear all filters" beside the host's
    // own fields would describe filters the user cannot make here.
    const user = userEvent.setup()
    render(<Table columns={unfilterable} filtersPanel={{ content: <p>Host fields</p> }} />)

    await openFilters(user)

    expect(within(panelBody()).queryByText("No filters applied")).toBeNull()
    expect(within(panelBody()).queryByRole("button", { name: "Clear all filters" })).toBeNull()
  })

  it("counts the host's active filters on the rail tab, and names the count", () => {
    render(<Table filtersPanel={{ content: <p>Host fields</p>, activeCount: 2 }} />)

    const tab = screen.getByRole("tab", { name: /^Filters/ })
    expect(tab).toHaveTextContent("2")
    expect(tab).toHaveAccessibleName("Filters, 2 active")
  })

  it("shows no count while nothing is active", () => {
    render(<Table filtersPanel={{ content: <p>Host fields</p>, activeCount: 0 }} />)

    expect(screen.getByRole("tab", { name: /^Filters/ })).toHaveAccessibleName("Filters")
  })
})

describe("a Filters tab with nothing to show", () => {
  it("is not offered when no column can be filtered and the host has no filters", () => {
    render(<Table columns={unfilterable} />)

    expect(screen.queryByRole("tab", { name: /^Filters/ })).toBeNull()
    // The Columns tab is unaffected.
    expect(screen.getByRole("tab", { name: "Columns" })).toBeInTheDocument()
  })

  it("is still offered, as before, when a column can be filtered", () => {
    render(<Table />)

    expect(screen.getByRole("tab", { name: "Filters" })).toBeInTheDocument()
  })
})
