import { createColumnHelper } from "@tanstack/react-table"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures, type DataTableInstance } from "./useDataTable"

/**
 * One invariant, checked after every rearrangement: the `<colgroup>` must have
 * exactly one `<col>` per rendered cell, in the same order.
 *
 * Under `table-layout: fixed` the colgroup alone decides column widths, and it
 * is positional — nothing links a `<col>` to a column by name. So the instant
 * the two lists disagree, every width after the first difference lands on the
 * wrong column, and dragging one column's edge visibly resizes another.
 *
 * That is what happened: the order came from flattening the first header group,
 * and a column pinned out of a group appeared twice — once in its pinned slot
 * and once still under its old group header. Eleven `<col>`s for eight cells.
 */

interface Row {
  code: string
  partner: string
  city: string
  date: string
  qty: number
  amount: number
  currency: string
  status: string
}

const rows: Row[] = [
  {
    code: "KR-1",
    partner: "Alpha",
    city: "Toshkent",
    date: "2026-01-01",
    qty: 10,
    amount: 100,
    currency: "UZS",
    status: "open",
  },
]

const helper = createColumnHelper<DataTableFeatures, Row>()

/** Deliberately nested: the duplication only appeared inside a group. */
const columns = [
  helper.accessor("code", { header: "Code", size: 110 }),
  helper.group({
    id: "document",
    header: "Document",
    columns: helper.columns([
      helper.accessor("partner", { header: "Partner", size: 240 }),
      helper.accessor("city", { header: "City", size: 170 }),
      helper.accessor("date", { header: "Date", size: 120 }),
    ]),
  }),
  helper.group({
    id: "totals",
    header: "Totals",
    columns: helper.columns([
      helper.accessor("qty", { header: "Qty", size: 130 }),
      helper.group({
        id: "money",
        header: "Money",
        columns: helper.columns([
          helper.accessor("amount", { header: "Amount", size: 170 }),
          helper.accessor("currency", { header: "Currency", size: 90 }),
        ]),
      }),
    ]),
  }),
  helper.accessor("status", { header: "Status", size: 130 }),
]

let latest: DataTableInstance<Row> | null = null

function Table() {
  const instance = useDataTable({
    id: "alignment",
    data: rows,
    columns,
    initialLayout: { columnPinning: { start: ["code"], end: ["status"] } },
  })
  latest = instance
  return <DataTable instance={instance} />
}

/*
 * The filler column is left out on both sides: it is not a column, carries no
 * width and heads no data.
 */
const colsOf = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>("colgroup col:not(.dt-col-filler)"),
]
const cellsOf = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>("tbody tr td:not(.dt-td-filler)"),
]

/** Column widths as declared, and the cells they are supposed to size. */
function readAlignment(container: HTMLElement) {
  return {
    cols: colsOf(container).map((col) => col.style.width),
    cells: cellsOf(container).map((cell) => cell.textContent?.trim() ?? ""),
  }
}

/**
 * The invariant itself: one `<col>` per cell, the same column in each
 * position, and every `<col>` carrying that column's own width.
 */
function expectAligned(container: HTMLElement) {
  const cols = colsOf(container)
  const cells = cellsOf(container)
  expect(cols, `${cols.length} <col> for ${cells.length} cells`).toHaveLength(cells.length)

  const colIds = cols.map((col) => col.dataset.columnId)
  expect(cells.map((cell) => cell.dataset.columnId)).toEqual(colIds)

  const table = latest!.table
  expect(cols.map((col) => col.style.width)).toEqual(
    colIds.map((id) => `${table.getColumn(id!)!.getSize()}px`),
  )
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.click(screen.getByRole("button", { name }))
}

describe("colgroup stays aligned with the rendered cells", () => {
  beforeEach(() => localStorage.clear())

  it("on first render", () => {
    const { container } = render(<Table />)
    expectAligned(container)
    expect(readAlignment(container).cols).toEqual([
      "110px",
      "240px",
      "170px",
      "120px",
      "130px",
      "170px",
      "90px",
      "130px",
    ])
  })

  it("after pinning a column that lives inside a group", async () => {
    const user = userEvent.setup()
    const { container } = render(<Table />)

    await openMenu(user, /qty: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /pin to start/i }))

    expectAligned(container)
    // Qty has moved to the front, behind the already-pinned Code.
    expect(readAlignment(container).cells.slice(0, 2)).toEqual(["KR-1", "10"])
  })

  it("after pinning a nested column to the end", async () => {
    const user = userEvent.setup()
    const { container } = render(<Table />)

    await openMenu(user, /amount: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /pin to end/i }))

    expectAligned(container)
    expect(readAlignment(container).cells.at(-1)).toBe("100")
  })

  it("after pinning at both edges at once", async () => {
    const user = userEvent.setup()
    const { container } = render(<Table />)

    await openMenu(user, /qty: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /pin to start/i }))
    await openMenu(user, /amount: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /pin to end/i }))

    expectAligned(container)
  })

  it("after hiding a column", async () => {
    const user = userEvent.setup()
    const { container } = render(<Table />)

    await openMenu(user, /city: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /^hide$/i }))

    expectAligned(container)
    expect(readAlignment(container).cells).not.toContain("Toshkent")
  })

  it("after hiding a column that was pinned", async () => {
    const user = userEvent.setup()
    const { container } = render(<Table />)

    await openMenu(user, /qty: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /pin to start/i }))
    await openMenu(user, /qty: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /^hide$/i }))

    expectAligned(container)
  })

  it("after unpinning", async () => {
    const user = userEvent.setup()
    const { container } = render(<Table />)

    await openMenu(user, /qty: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /pin to start/i }))
    await openMenu(user, /qty: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /^unpin$/i }))

    expectAligned(container)
    // Back where it was declared, inside Totals.
    expect(readAlignment(container).cells).toEqual([
      "KR-1",
      "Alpha",
      "Toshkent",
      "2026-01-01",
      "10",
      "100",
      "UZS",
      "open",
    ])
  })

  it("through a long sequence of rearrangements", async () => {
    const user = userEvent.setup()
    const { container } = render(<Table />)

    const steps: [RegExp, RegExp][] = [
      [/qty: column actions/i, /pin to start/i],
      [/amount: column actions/i, /pin to end/i],
      [/city: column actions/i, /^hide$/i],
      [/qty: column actions/i, /^unpin$/i],
      [/currency: column actions/i, /pin to end/i],
      [/partner: column actions/i, /pin to start/i],
      [/amount: column actions/i, /^unpin$/i],
    ]

    for (const [trigger, item] of steps) {
      await openMenu(user, trigger)
      await user.click(screen.getByRole("menuitem", { name: item }))
      expectAligned(container)
    }
  })

  it("keeps every width attached to its own column", async () => {
    const user = userEvent.setup()
    const { container } = render(<Table />)

    await openMenu(user, /qty: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /pin to start/i }))

    // Code 110, Qty 130, then the rest in their declared order.
    expect(readAlignment(container).cols).toEqual([
      "110px",
      "130px",
      "240px",
      "170px",
      "120px",
      "170px",
      "90px",
      "130px",
    ])
  })

  it("keeps header cells in step with the body", async () => {
    const user = userEvent.setup()
    render(<Table />)

    await openMenu(user, /qty: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /pin to start/i }))

    // The deepest header row plus any cell spanning into it must cover every
    // column exactly once — no column may be headed twice.
    const headers = screen.getAllByRole("columnheader")
    const leafNames = headers
      .map((th) => within(th).queryByText(/^(Code|Partner|City|Date|Qty|Amount|Currency|Status)$/))
      .filter(Boolean)
      .map((el) => el?.textContent)

    expect(new Set(leafNames).size).toBe(leafNames.length)
    expect(leafNames).toHaveLength(8)
  })
})
