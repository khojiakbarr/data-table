import { createColumnHelper } from "@tanstack/react-table"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures, type DataTableInstance } from "./useDataTable"
import type { LayoutStorage, TableLayout } from "./types"

/**
 * One table component kept mounted for the next record — a route param in
 * its `id`, `stock-${warehouseId}` — is a different table each time: its own
 * stored layout, its own first page, nothing selected, and the last table's
 * change still on its way saved under the last table's id.
 */

interface Item {
  id: string
  name: string
  code: string
}

const helper = createColumnHelper<DataTableFeatures, Item>()
const columns = [helper.accessor("name", { header: "Name" }), helper.accessor("code", { header: "Code" })]
const ITEMS: Item[] = Array.from({ length: 30 }, (_, index) => ({ id: `i${index}`, name: `Item ${index}`, code: `C-${index}` }))

/** A storage that keeps every layout in memory, and every save it was asked for. */
function memoryStorage(seed: Record<string, TableLayout>) {
  const layouts = new Map(Object.entries(seed))
  const saves: { id: string; layout: TableLayout }[] = []
  const storage: LayoutStorage = {
    load: (id) => layouts.get(id) ?? null,
    save: (id, layout) => {
      saves.push({ id, layout })
      layouts.set(id, layout)
    },
    clear: (id) => {
      layouts.delete(id)
    },
  }
  return { storage, saves }
}

let latest: DataTableInstance<Item> | null = null

function Stock({ warehouseId, storage }: { warehouseId: string; storage: LayoutStorage }) {
  const instance = useDataTable<Item>({
    id: `stock-${warehouseId}`,
    columns,
    data: ITEMS,
    getRowId: (row) => row.id,
    storage,
    pagination: { pageSize: 10 },
    features: { selection: true },
  })
  latest = instance
  return <DataTable instance={instance} virtualize={false} />
}

const table = (): DataTableInstance<Item> => {
  if (latest === null) throw new Error("no table")
  return latest
}

describe("a table kept mounted under a new id", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    latest = null
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("reads the new table's stored layout, and saves the last one's change under the last one's id", () => {
    const stored = { columnVisibility: { name: false } } as unknown as TableLayout
    const { storage, saves } = memoryStorage({ "stock-2": stored })
    const { rerender } = render(<Stock warehouseId="1" storage={storage} />)
    expect(table().table.getColumn("name")?.getIsVisible()).toBe(true)

    // A change to the first table, still waiting for its debounced save when the record changes.
    act(() => table().table.getColumn("code")?.toggleVisibility(false))
    rerender(<Stock warehouseId="2" storage={storage} />)

    expect(table().id).toBe("stock-2")
    expect(table().table.getColumn("name")?.getIsVisible()).toBe(false)
    expect(table().table.getColumn("code")?.getIsVisible()).toBe(true)
    expect(table().isCustomised).toBe(true)
    act(() => vi.runAllTimers())
    expect(saves.map((save) => save.id)).toEqual(["stock-1"])
    expect(saves[0]?.layout.columnVisibility).toEqual({ code: false })
  })

  it("starts the new table on its first page with nothing selected", () => {
    const { storage } = memoryStorage({})
    const { rerender } = render(<Stock warehouseId="1" storage={storage} />)
    act(() => table().pagination.setPageIndex(2))
    act(() => table().selection.toggleRow("i25", true))
    expect(table().pagination.pageIndex).toBe(2)
    expect(table().selection.count).toBe(1)

    rerender(<Stock warehouseId="2" storage={storage} />)
    expect(table().pagination.pageIndex).toBe(0)
    expect(table().selection.isEmpty).toBe(true)
  })
})
