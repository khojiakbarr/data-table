import { createColumnHelper } from "@tanstack/react-table"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { hiddenColumnsOnly, localStorageLayout } from "./core/persistence"
import type { TableLayout } from "./types"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * The Columns tab's Reset link must mean "you changed something", and nothing
 * else. Reported from a host: on a table where every column was already
 * visible, clicking "Show all" made "Reset" appear — and saved a layout — for a
 * click that changed nothing on screen.
 */

interface Row {
  id: string
  name: string
  amount: number
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 100 }),
  helper.accessor("amount", { header: "Amount", size: 100 }),
]
const data: Row[] = [{ id: "r0", name: "Agro Ltd", amount: 15 }]

function Table({ initialLayout }: { initialLayout?: Partial<TableLayout> }) {
  const instance = useDataTable<Row>({
    id: "show-all",
    columns,
    data,
    getRowId: (row) => row.id,
    storage: localStorageLayout(),
    ...(initialLayout === undefined ? {} : { initialLayout }),
  })
  return <DataTable instance={instance} virtualize={false} />
}

const reset = () => screen.queryByRole("button", { name: "Reset" })
const openColumns = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("tab", { name: "Columns" }))

beforeEach(() => localStorage.clear())

describe("Show all", () => {
  it("offers no Reset when every column was already visible", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await openColumns(user)
    expect(reset()).toBeNull()

    await user.click(screen.getByRole("button", { name: "Show all" }))
    expect(reset()).toBeNull()
  })

  it("is a customisation when it reveals a column the host hid by default", async () => {
    const user = userEvent.setup()
    render(<Table initialLayout={{ columnVisibility: { amount: false } }} />)
    await openColumns(user)
    expect(reset()).toBeNull()

    await user.click(screen.getByRole("button", { name: "Show all" }))
    expect(screen.getAllByRole("columnheader").some((th) => th.textContent?.includes("Amount"))).toBe(true)
    expect(reset()).not.toBeNull()
  })
})

describe("Reset tracks the arrangement rather than latching on", () => {
  it("goes away again when a hidden column is shown again", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await openColumns(user)

    const amount = screen.getByRole("checkbox", { name: /Amount/ })
    await user.click(amount)
    expect(reset()).not.toBeNull()

    await user.click(amount)
    expect(reset()).toBeNull()
  })
})

describe("hiddenColumnsOnly", () => {
  it("keeps only the entries that hide a column", () => {
    expect(hiddenColumnsOnly({ name: true, amount: false })).toEqual({ amount: false })
    expect(hiddenColumnsOnly({ name: true, amount: true })).toEqual({})
  })

  it("reads a layout saved with explicit trues as uncustomised", async () => {
    // What the old "Show all" wrote. It must not keep a Reset link lit forever.
    // A partial entry, the way an older save looks. The assertion right after
    // it reads the entry back through the real adapter: an entry in the wrong
    // key or envelope would load nothing and pass this test for the wrong
    // reason, which is exactly what the first draft of it did.
    localStorage.setItem(
      "data-table:layout:show-all",
      JSON.stringify({ v: 1, layout: { columnVisibility: { name: true, amount: true } } }),
    )
    expect(localStorageLayout().load("show-all")?.columnVisibility).toEqual({ name: true, amount: true })
    const user = userEvent.setup()
    render(<Table />)
    await openColumns(user)
    expect(reset()).toBeNull()
  })
})
