import { createColumnHelper } from "@tanstack/react-table"
import { render, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DataTable } from "../components/DataTable"
import { useDataTable, type DataTableFeatures, type DataTableInstance } from "../useDataTable"
import { columnsToFit, fitBounds } from "./useFitOnLoad"

interface Row {
  code: string
  name: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("code", { header: "Code", size: 100 }), helper.accessor("name", { header: "Name", size: 200 })]
const rows: Row[] = [{ code: "KR-1", name: "Apple" }]

describe("fitBounds", () => {
  it("caps a column at maxGrowth times its declared size", () => {
    expect(fitBounds({ min: 60, max: 800 }, 120, 2)).toEqual({ min: 60, max: 240 })
  })

  it("keeps a lower maxSize and TanStack's 150 for a column with no size", () => {
    expect(fitBounds({ min: 60, max: 180 }, 120, 2)).toEqual({ min: 60, max: 180 })
    expect(fitBounds({ min: 20, max: 800 }, undefined, 2)).toEqual({ min: 20, max: 300 })
  })

  it("never puts the ceiling under the floor", () => {
    expect(fitBounds({ min: 60, max: 800 }, 20, 1)).toEqual({ min: 60, max: 60 })
  })
})

describe("columnsToFit", () => {
  const column = (id: string, canResize = true) => ({ id, getCanResize: () => canResize }) as never

  it("leaves a column the person has sized and one that cannot be resized", () => {
    const picked = columnsToFit([column("code"), column("name"), column("actions", false)], { name: 240 })
    expect(picked.map((c: { id: string }) => c.id)).toEqual(["code"])
  })
})

function renderTable(fit: boolean, stored: Record<string, number> = {}) {
  const seen: { instance: DataTableInstance<Row> | null } = { instance: null }
  function Table() {
    const instance = useDataTable({ id: "fit", columns, data: rows, initialLayout: { columnSizing: stored } })
    seen.instance = instance
    return <DataTable instance={instance} fitColumnsOnLoad={fit} virtualize={false} />
  }
  render(<Table />)
  return () => seen.instance?.table.state.columnSizing ?? {}
}

describe("fitColumnsOnLoad", () => {
  it("fits every unsized column to the first rows drawn", async () => {
    // jsdom measures no text, so a fitted column lands on the table's floor (60): a width was written.
    const sizing = renderTable(true)
    await waitFor(() => expect(sizing()).toEqual({ code: 60, name: 60 }))
  })

  it("keeps a width the person already has", async () => {
    const sizing = renderTable(true, { name: 260 })
    await waitFor(() => expect(sizing()).toEqual({ code: 60, name: 260 }))
  })

  it("does nothing while it is off", async () => {
    const sizing = renderTable(false)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(sizing()).toEqual({})
  })
})
