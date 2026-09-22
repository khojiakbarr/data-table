import { createColumnHelper } from "@tanstack/react-table"
import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable, defaultLabels } from "./components/DataTable"
import type { GroupRow } from "./core/grouping"
import { useDataTable, type DataTableFeatures } from "./useDataTable"
import type { LayoutStorage, TableLayout } from "./types"

/**
 * The totals footer.
 *
 * The one property every case here comes back to is alignment: a `<tfoot>`
 * cell exists for every rendered column — chrome columns and the group column
 * included — in the same order the header draws them, whether or not the
 * host gave that particular column a total. A missing cell, an extra cell, or
 * one under the wrong column is the failure every test below is written to
 * catch, mirroring `RowSelection.test.tsx`'s own
 * "keeps a group page's cells lined up with the header".
 */

interface Row {
  id: string
  name: string
  amount: number
  currency: string
  status: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 120 }),
  helper.accessor("amount", { header: "Amount", size: 100 }),
  helper.accessor("currency", { header: "Currency", size: 90 }),
  helper.accessor("status", { header: "Status", size: 100 }),
]

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `r${index}`,
    name: `Row ${index}`,
    amount: index * 10,
    currency: "UZS",
    status: "open",
  }))

const groupRow = (path: string[], count: number): GroupRow => ({ kind: "group", path, count })

interface HarnessProps {
  id?: string
  data?: (Row | GroupRow)[]
  server?: boolean
  rowNumbers?: boolean
  selection?: boolean
  totals?: Record<string, string>
  initialLayout?: Partial<TableLayout>
  storage?: LayoutStorage
}

function Harness({
  id = "totals",
  data = rows(3),
  server = false,
  rowNumbers = false,
  selection = false,
  totals,
  initialLayout,
  storage,
}: HarnessProps) {
  const instance = useDataTable<Row>({
    id,
    columns,
    data,
    features: { rowNumbers, selection },
    getRowId: (row) => row.id,
    ...(server ? { mode: "server" as const, rowCount: data.length } : {}),
    ...(initialLayout === undefined ? {} : { initialLayout }),
    ...(storage === undefined ? {} : { storage }),
  })
  return <DataTable instance={instance} virtualize={false} {...(totals ? { totals } : {})} />
}

/** The header's leaf column ids, in render order — the alignment a `<tfoot>` row must match. */
const headerColumnIds = (): (string | null)[] =>
  [...document.querySelectorAll("thead tr:first-child th[data-column-id]")].map((th) =>
    th.getAttribute("data-column-id"),
  )

/** The totals row's own cells, in render order. */
const footerCells = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>("tfoot td[data-column-id]"),
]

const footerRow = (): HTMLElement | null => document.querySelector("tfoot tr")

beforeEach(() => {
  localStorage.clear()
})

describe("presence", () => {
  it("renders no <tfoot> at all when totals is absent", () => {
    render(<Harness />)
    expect(document.querySelector("tfoot")).toBeNull()
  })

  it("renders the row for an empty totals object, rather than nothing", () => {
    // Deliberate: a host computing an asynchronous total passes {} the moment
    // the feature is turned on, and fills it in once the server answers. If
    // {} rendered nothing, the row would pop into existence on that answer
    // and shift the body by a row's height at an arbitrary moment.
    render(<Harness totals={{}} />)
    const row = footerRow()
    expect(row).not.toBeNull()
    expect(row).toHaveAttribute("aria-label", defaultLabels.totalsRow)
    // No total was given for any column, so only the caption shows.
    expect(row?.textContent?.trim()).toBe(defaultLabels.totalsRow)
  })
})

describe("alignment", () => {
  it("has exactly one cell per rendered column, in header order", () => {
    render(<Harness totals={{ amount: "300" }} />)
    expect(footerCells().map((cell) => cell.getAttribute("data-column-id"))).toEqual(headerColumnIds())
  })

  it("puts the host's content under the right column, and the label in the leading cell", () => {
    render(<Harness totals={{ amount: "300", currency: "UZS" }} />)
    const cells = footerCells()
    const byId = new Map(cells.map((cell) => [cell.getAttribute("data-column-id"), cell]))
    // The leading (first, non-chrome) column carries the caption.
    expect(byId.get("name")?.textContent).toContain(defaultLabels.totalsRow)
    expect(byId.get("amount")?.textContent).toContain("300")
    expect(byId.get("currency")?.textContent).toContain("UZS")
    // Nothing was given for `status`; its cell is present but empty.
    expect(byId.get("status")?.textContent).toBe("")
  })

  it("ignores a totals key naming a column that does not exist", () => {
    render(<Harness totals={{ ghost: "should never render", amount: "300" }} />)
    expect(footerCells().map((cell) => cell.getAttribute("data-column-id"))).toEqual(headerColumnIds())
    expect(document.querySelector("tfoot")?.textContent).not.toContain("should never render")
  })

  it("ignores a totals key naming a column that is hidden, without shifting the row", () => {
    render(
      <Harness
        totals={{ currency: "should never render", amount: "300" }}
        initialLayout={{ columnVisibility: { currency: false } }}
      />,
    )
    // The hidden column has no header cell and must have no footer cell either.
    expect(headerColumnIds()).not.toContain("currency")
    expect(footerCells().map((cell) => cell.getAttribute("data-column-id"))).toEqual(headerColumnIds())
    expect(document.querySelector("tfoot")?.textContent).not.toContain("should never render")
    // The visible column's total is unaffected by the one that was dropped.
    expect(document.querySelector("tfoot")?.textContent).toContain("300")
  })

  it("keeps row numbers, selection and the group column aligned together", () => {
    render(
      <Harness
        server
        rowNumbers
        selection
        totals={{ amount: "300" }}
        data={[groupRow(["open"], 3), ...rows(3)]}
        initialLayout={{ grouping: ["status"] }}
      />,
    )
    expect(footerCells().map((cell) => cell.getAttribute("data-column-id"))).toEqual(headerColumnIds())
    // Three chrome-or-group columns lead: selection, row numbers, then the
    // group column (status, in this case) — see `useDataTable`'s own pinning.
    expect(headerColumnIds().slice(0, 2)).toEqual(["__dt_selection", "__dt_row_number"])
  })

  it("stays aligned after a column has been resized", () => {
    render(<Harness totals={{ amount: "300" }} initialLayout={{ columnSizing: { amount: 260 } }} />)
    expect(footerCells().map((cell) => cell.getAttribute("data-column-id"))).toEqual(headerColumnIds())
    const amountCol = document.querySelector<HTMLElement>('colgroup col[data-column-id="amount"]')
    expect(amountCol?.style.width).toBe("260px")
  })
})

describe("pinning", () => {
  it("sticks a pinned column's total at the same offset the body cell gets", () => {
    render(
      <Harness
        totals={{ name: "start total", status: "end total" }}
        initialLayout={{ columnPinning: { start: ["name"], end: ["status"] } }}
      />,
    )
    const footerStart = document.querySelector<HTMLElement>('tfoot td[data-column-id="name"]')
    const bodyStart = document.querySelector<HTMLElement>('tbody td[data-column-id="name"]')
    const footerEnd = document.querySelector<HTMLElement>('tfoot td[data-column-id="status"]')
    const bodyEnd = document.querySelector<HTMLElement>('tbody td[data-column-id="status"]')

    expect(footerStart).not.toBeNull()
    expect(footerStart?.className).toContain("dt-pinned")
    // Same offset `column.getStart()`/`getAfter()` computes for the body —
    // `pinnedStyle` is the one function both read it through.
    expect(footerStart?.style.insetInlineStart).toBe(bodyStart?.style.insetInlineStart)
    expect(footerEnd?.className).toContain("dt-pinned")
    expect(footerEnd?.style.insetInlineEnd).toBe(bodyEnd?.style.insetInlineEnd)

    // A total under a column that is NOT pinned carries no pinning class or offset.
    const footerScrolling = document.querySelector<HTMLElement>('tfoot td[data-column-id="amount"]')
    expect(footerScrolling?.className).not.toContain("dt-pinned")
    expect(footerScrolling?.style.insetInlineStart).toBe("")
  })

  it("keeps every cell aligned with pinning at both edges together", () => {
    render(
      <Harness
        totals={{ name: "300", amount: "1", status: "2" }}
        initialLayout={{ columnPinning: { start: ["name"], end: ["status"] } }}
      />,
    )
    expect(footerCells().map((cell) => cell.getAttribute("data-column-id"))).toEqual(headerColumnIds())
  })
})

describe("accessibility", () => {
  it("names the row for a screen reader instead of leaving it to read as a data row", () => {
    render(<Harness totals={{ amount: "300" }} />)
    expect(footerRow()).toHaveAttribute("aria-label", defaultLabels.totalsRow)
  })
})
