import { createColumnHelper } from "@tanstack/react-table"
import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * Nested column groups.
 *
 * Three things go wrong here and none of them are obvious from a screenshot:
 * a leaf column that sits above its natural depth is rendered by a *placeholder*
 * header and is easily drawn once per header row; `table-layout: fixed` takes
 * widths from the first row, which under grouped headers is a row of spanning
 * cells; and the order of `getVisibleLeafColumns()` is not the order the cells
 * are rendered in once anything is pinned.
 */

interface Row {
  code: string
  partner: string
  city: string
  amount: number
  currency: string
  status: string
}

const rows: Row[] = [
  { code: "KR-1", partner: "Alpha", city: "Toshkent", amount: 10, currency: "UZS", status: "open" },
  { code: "KR-2", partner: "Beta", city: "Andijon", amount: 20, currency: "UZS", status: "closed" },
]

const helper = createColumnHelper<DataTableFeatures, Row>()

const columns = [
  helper.accessor("code", { header: "Code", size: 100 }),
  helper.group({
    id: "document",
    header: "Document",
    columns: helper.columns([
      helper.accessor("partner", { header: "Partner", size: 240 }),
      helper.accessor("city", { header: "City", size: 170 }),
    ]),
  }),
  helper.group({
    id: "totals",
    header: "Totals",
    columns: helper.columns([
      helper.group({
        id: "money",
        header: "Money",
        columns: helper.columns([
          helper.accessor("amount", { header: "Amount", size: 130 }),
          helper.accessor("currency", { header: "Currency", size: 90 }),
        ]),
      }),
    ]),
  }),
  helper.accessor("status", { header: "Status", size: 120 }),
]

function Grouped({ pinned = false }: { pinned?: boolean }) {
  const instance = useDataTable({
    id: "grouped",
    data: rows,
    columns,
    ...(pinned
      ? { initialLayout: { columnPinning: { start: ["code"], end: ["status"] } } }
      : {}),
  })
  return <DataTable instance={instance} />
}

const headerRows = () => screen.getAllByRole("row").slice(0, 3)

describe("grouped headers", () => {
  beforeEach(() => localStorage.clear())

  it("builds one header row per level", () => {
    render(<Grouped />)
    // Three header rows plus one per data row.
    expect(screen.getAllByRole("row")).toHaveLength(3 + rows.length)
  })

  it("renders each label exactly once", () => {
    render(<Grouped />)
    for (const label of ["Code", "Document", "Partner", "City", "Totals", "Money", "Amount", "Currency", "Status"]) {
      expect(screen.getAllByRole("columnheader", { name: new RegExp(`^${label}`) })).toHaveLength(1)
    }
  })

  it("spans a shallow leaf column down through the header rows", () => {
    render(<Grouped />)
    const code = screen.getByRole("columnheader", { name: /^Code/ })
    expect(code).toHaveAttribute("rowspan", "3")

    const partner = screen.getByRole("columnheader", { name: /^Partner/ })
    expect(partner).toHaveAttribute("rowspan", "2")
  })

  it("spans a group across the columns beneath it", () => {
    render(<Grouped />)
    expect(screen.getByRole("columnheader", { name: "Document" })).toHaveAttribute(
      "colspan",
      "2",
    )
    expect(screen.getByRole("columnheader", { name: "Money" })).toHaveAttribute(
      "colspan",
      "2",
    )
  })

  it("gives leaf columns a sort control and group headers none", () => {
    render(<Grouped />)

    const leaf = screen.getByRole("columnheader", { name: /^Code/ })
    expect(within(leaf).queryByRole("button", { name: /sort/i })).toBeInTheDocument()

    const group = screen.getByRole("columnheader", { name: "Document" })
    expect(within(group).queryByRole("button", { name: /sort/i })).toBeNull()
  })

  it("declares column widths in the order the cells are rendered", () => {
    const { container } = render(<Grouped />)
    const widths = [...container.querySelectorAll("colgroup col")].map(
      (col) => (col as HTMLElement).style.width,
    )
    expect(widths).toEqual(["100px", "240px", "170px", "130px", "90px", "120px"])
  })

  it("keeps widths in render order when columns are pinned", () => {
    // `getVisibleLeafColumns()` puts pinned columns first; the DOM does not.
    // If the colgroup followed that order, Partner would take Status's width.
    const { container } = render(<Grouped pinned />)
    const widths = [...container.querySelectorAll("colgroup col")].map(
      (col) => (col as HTMLElement).style.width,
    )
    expect(widths).toEqual(["100px", "240px", "170px", "130px", "90px", "120px"])
  })

  it("stacks each header row below the one above it", () => {
    render(<Grouped />)
    const [first, second, third] = headerRows()
    const topOf = (row: HTMLElement) =>
      (within(row).getAllByRole("columnheader")[0] as HTMLElement).style.top

    expect(topOf(first as HTMLElement)).toBe("calc(var(--dt-header-height) * 0)")
    expect(topOf(second as HTMLElement)).toBe("calc(var(--dt-header-height) * 1)")
    expect(topOf(third as HTMLElement)).toBe("calc(var(--dt-header-height) * 2)")
  })

  it("pins a grouped table's edge columns", () => {
    render(<Grouped pinned />)
    expect(screen.getByRole("columnheader", { name: /^Code/ }).style.insetInlineStart).toBe(
      "0px",
    )
    expect(screen.getByRole("columnheader", { name: /^Status/ }).style.insetInlineEnd).toBe(
      "0px",
    )
  })
})
