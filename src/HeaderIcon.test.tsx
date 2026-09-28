import { createColumnHelper } from "@tanstack/react-table"
import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * `meta.icon` — a mark before a column's name, as a warehouse beside each
 * warehouse's column. It decorates the header; the column is still named by
 * its label alone, sortable or not.
 */

interface Row {
  id: string
  name: string
  stock: number
}

const helper = createColumnHelper<DataTableFeatures, Row>()

function WithIcons({ sortable }: { sortable: boolean }) {
  const instance = useDataTable({
    id: "header-icon",
    data: [{ id: "a", name: "Alpha", stock: 5 }],
    columns: [
      helper.accessor("name", { header: "Name" }),
      helper.accessor("stock", { header: "Main warehouse", meta: { icon: <svg data-testid="warehouse-mark" /> }, enableSorting: sortable }),
    ],
    features: { sorting: sortable },
  })
  return <DataTable instance={instance} />
}

describe("a column's header icon", () => {
  beforeEach(() => localStorage.clear())

  it.each([true, false])("sits before the name, hidden from a screen reader (sortable: %s)", (sortable) => {
    render(<WithIcons sortable={sortable} />)
    const header = screen.getByRole("columnheader", { name: /Main warehouse/ })
    const mark = within(header).getByTestId("warehouse-mark")
    const label = within(header).getByText("Main warehouse")

    expect(mark.closest(".dt-th-icon")).toHaveAttribute("aria-hidden", "true")
    expect(mark.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("draws nothing extra for a column without one", () => {
    render(<WithIcons sortable={false} />)
    expect(within(screen.getByRole("columnheader", { name: /^Name/ })).queryByText("", { selector: ".dt-th-icon" })).toBeNull()
  })
})
