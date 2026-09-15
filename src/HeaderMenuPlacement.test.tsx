import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * The column menu opens at the pointer, or under the ⋮ button, and for the
 * last column that is usually within a menu's width of the window edge. It
 * must be moved back on screen. jsdom lays nothing out, so the menu measures
 * 0×0 here and the clamp reduces to "no further than the edge minus the
 * margin" — enough to prove the clamp runs in both axes.
 */

interface Row {
  code: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("code", { header: "Code", size: 100 })]

function Table() {
  const instance = useDataTable({ id: "menu", data: [{ code: "KR-1" }], columns })
  return <DataTable instance={instance} />
}

describe("column menu placement", () => {
  it("stays inside the window when opened near its edge", () => {
    render(<Table />)

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: /code/i }), {
      clientX: window.innerWidth + 500,
      clientY: window.innerHeight + 500,
    })

    const menu = screen.getByRole("menu")
    expect(menu.style.left).toBe(`${window.innerWidth - 8}px`)
    expect(menu.style.top).toBe(`${window.innerHeight - 8}px`)
  })

  it("opens where it was asked to when there is room", () => {
    render(<Table />)

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: /code/i }), {
      clientX: 120,
      clientY: 40,
    })

    const menu = screen.getByRole("menu")
    expect(menu.style.left).toBe("120px")
    expect(menu.style.top).toBe("40px")
  })
})
