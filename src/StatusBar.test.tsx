import { createColumnHelper } from "@tanstack/react-table"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { textCondition } from "./core/filters"
import { useDataTable, type DataTableFeatures, type DataTableInstance } from "./useDataTable"
import type { DataTableFeatureFlags, TableLayout } from "./types"

/**
 * The status bar: the band under the table stating what the result set
 * contains, and its one hand-off with the footer — the row count moves out
 * of `<TablePagination>` and into this band the moment it is on.
 *
 * Every case here is one the spec called out by name: `rowCount` still
 * unknown, `unfilteredTotal` absent/equal/larger, search alone, a column
 * filter alone, both together, grouped-and-filtered together, the bar and
 * the footer in every combination of on and off, and a host's own `ReactNode`
 * in place of a bare `true`.
 */

interface Row {
  id: string
  name: string
  status: string
  amount: number
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 120 }),
  helper.accessor("status", { header: "Status", size: 100 }),
  helper.accessor("amount", { header: "Amount", size: 100 }),
]

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `r${index}`,
    name: `Row ${index}`,
    status: index % 2 === 0 ? "open" : "closed",
    amount: index,
  }))

let latest: DataTableInstance<Row> | null = null

interface HarnessProps {
  data?: Row[]
  server?: boolean
  statusBar?: DataTableFeatureFlags["statusBar"]
  footer?: boolean
  rowCount?: number | undefined
  unfilteredTotal?: number | undefined
  initialLayout?: Partial<TableLayout>
}

function Harness({
  data = rows(3),
  server = true,
  statusBar = true,
  footer = true,
  rowCount,
  unfilteredTotal,
  initialLayout,
}: HarnessProps) {
  const instance = useDataTable<Row>({
    id: "status-bar",
    columns,
    data,
    features: { statusBar },
    getRowId: (row) => row.id,
    ...(server ? { mode: "server" as const } : {}),
    ...(rowCount === undefined ? {} : { rowCount }),
    ...(unfilteredTotal === undefined ? {} : { unfilteredTotal }),
    ...(initialLayout === undefined ? {} : { initialLayout }),
  })
  latest = instance
  return <DataTable instance={instance} virtualize={false} footer={footer} />
}

const bar = (): HTMLElement | null => document.querySelector(".dt-status-bar")
const rowsText = (): string => document.querySelector(".dt-status-bar-rows")?.textContent ?? ""
const groupedText = (): string | null =>
  document.querySelector(".dt-status-bar-grouped")?.textContent ?? null
const footerRows = (): HTMLElement | null => document.querySelector(".dt-footer-rows")

const statusFilter = textCondition({ kind: "text", field: "status", op: "contains", value: "open" })
if (!statusFilter) throw new Error("fixture condition failed to build")

beforeEach(() => {
  localStorage.clear()
  latest = null
})

describe("the flag", () => {
  it("renders nothing by default", () => {
    render(<Harness statusBar={false} />)
    expect(bar()).toBeNull()
  })

  it("is a role=status, aria-live=polite region while on", () => {
    render(<Harness />)
    const region = bar()
    expect(region).not.toBeNull()
    expect(region).toHaveAttribute("role", "status")
    expect(region).toHaveAttribute("aria-live", "polite")
  })
})

describe("the footer hand-off", () => {
  it("keeps the footer exactly as it always was with the bar off", () => {
    render(<Harness statusBar={false} rowCount={100} />)
    expect(bar()).toBeNull()
    expect(footerRows()).not.toBeNull()
    expect(footerRows()?.textContent).toContain("Rows:")
  })

  it("drops the footer's own row count the moment the bar is on", () => {
    render(<Harness statusBar rowCount={100} />)
    expect(bar()).not.toBeNull()
    expect(footerRows()).toBeNull()
    // The footer's other parts survive: page size, range, page controls.
    expect(screen.getByRole("navigation", { name: /pagination/i })).toBeInTheDocument()
  })

  it("shows the bar together with the footer off, with no duplication either way", () => {
    render(<Harness statusBar footer={false} rowCount={100} />)
    expect(bar()).not.toBeNull()
    expect(document.querySelector(".dt-footer")).toBeNull()
  })
})

describe("the total-rows count", () => {
  it("renders the loading case before a server has answered", () => {
    render(<Harness rowCount={undefined} />)
    expect(latest?.pagination.rowCount).toBeUndefined()
    // Never crashes, and never silently prints "undefined" or "NaN".
    expect(rowsText()).not.toContain("undefined")
    expect(rowsText()).not.toContain("NaN")
    expect(rowsText()).toContain("…")
  })

  it("states the total, formatted the same way the footer prints it", () => {
    render(<Harness statusBar={false} rowCount={1000} />)
    // The footer's own formatting, captured with the bar off.
    expect(footerRows()?.textContent).toBe("Rows: 1 000")

    render(<Harness rowCount={1000} />)
    expect(rowsText()).toContain("1 000")
  })
})

describe("unfilteredTotal", () => {
  const withFilter: Partial<TableLayout> = { filters: [statusFilter] }

  it("states only the matched count while unfilteredTotal is absent", () => {
    render(<Harness rowCount={5} initialLayout={withFilter} />)
    expect(latest?.pagination.unfilteredTotal).toBeUndefined()
    expect(rowsText()).toContain("5")
    expect(rowsText()).not.toContain("undefined")
  })

  it("states X of Y once unfilteredTotal equals the total", () => {
    render(<Harness rowCount={5} unfilteredTotal={5} initialLayout={withFilter} />)
    expect(rowsText()).toContain("5")
  })

  it("states X of Y once unfilteredTotal is larger than the total", () => {
    render(<Harness rowCount={5} unfilteredTotal={200} initialLayout={withFilter} />)
    expect(rowsText()).toContain("5")
    expect(rowsText()).toContain("200")
  })

  it("is data.length in client mode, with no host input at all", () => {
    render(<Harness server={false} data={rows(7)} />)
    expect(latest?.pagination.unfilteredTotal).toBe(7)
  })
})

describe("filtered vs total labelling", () => {
  it("labels the count as filtered for a column filter alone", () => {
    render(<Harness rowCount={2} initialLayout={{ filters: [statusFilter] }} />)
    expect(latest?.filtering.isFiltered).toBe(true)
    // The English default names the state explicitly.
    expect(rowsText()).toContain("Filtered")
  })

  it("labels the count as filtered for the quick search alone", () => {
    render(<Harness rowCount={2} initialLayout={{ search: "row 1" }} />)
    expect(latest?.filtering.isFiltered).toBe(true)
    expect(rowsText()).toContain("Filtered")
  })

  it("labels the count as filtered with both a column filter and a search active", () => {
    render(<Harness rowCount={1} initialLayout={{ filters: [statusFilter], search: "row 1" }} />)
    expect(latest?.filtering.isFiltered).toBe(true)
    expect(rowsText()).toContain("Filtered")
  })

  it("states the plain total with neither a filter nor a search", () => {
    render(<Harness rowCount={3} />)
    expect(latest?.filtering.isFiltered).toBe(false)
    expect(rowsText()).not.toContain("Filtered")
  })
})

describe("grouped by", () => {
  it("says nothing about grouping while ungrouped", () => {
    render(<Harness rowCount={3} />)
    expect(groupedText()).toBeNull()
  })

  it("names the grouped columns, outermost first", () => {
    render(<Harness rowCount={3} initialLayout={{ grouping: ["status", "name"] }} />)
    expect(latest?.grouping.isGrouped).toBe(true)
    const text = groupedText()
    expect(text).not.toBeNull()
    expect(text).toContain("Status")
    expect(text).toContain("Name")
    expect(text?.indexOf("Status")).toBeLessThan(text?.indexOf("Name") ?? -1)
  })

  it("is grouped and filtered together, both parts present at once", () => {
    render(
      <Harness
        rowCount={2}
        initialLayout={{ grouping: ["status"], filters: [statusFilter] }}
      />,
    )
    expect(latest?.grouping.isGrouped).toBe(true)
    expect(latest?.filtering.isFiltered).toBe(true)
    expect(rowsText()).toContain("Filtered")
    expect(groupedText()).toContain("Status")
  })
})

describe("the host slot", () => {
  it("renders nothing extra for a bare true", () => {
    render(<Harness statusBar rowCount={3} />)
    expect(document.querySelector(".dt-status-bar-content")).toBeNull()
  })

  it("renders a host's own ReactNode at the end of the band", () => {
    render(<Harness statusBar={<em data-testid="host-content">custom</em>} rowCount={3} />)
    const slot = document.querySelector(".dt-status-bar-content")
    expect(slot).not.toBeNull()
    expect(screen.getByTestId("host-content")).toBeInTheDocument()
    // Still the total-rows part too — the host's content is an addition, not
    // a replacement.
    expect(rowsText()).toContain("3")
  })
})
