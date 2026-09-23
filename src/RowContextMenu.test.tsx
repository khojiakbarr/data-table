import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable } from "./useDataTable"

interface Row {
  id: string
  name: string
}

const ROWS: Row[] = [
  { id: "1", name: "Alpha" },
  { id: "2", name: "Beta" },
]

function Harness({ onRowContextMenu }: { onRowContextMenu?: (row: Row, event: React.MouseEvent) => void }) {
  const instance = useDataTable<Row>({
    id: "context-menu",
    data: ROWS,
    columns: [{ accessorKey: "name", header: "Name" }],
    getRowId: (row) => row.id,
  })
  return <DataTable instance={instance} virtualize={false} {...(onRowContextMenu ? { onRowContextMenu } : {})} />
}

describe("onRowContextMenu", () => {
  it("hands the host the row that was right-clicked, and the event", () => {
    const onRowContextMenu = vi.fn((_row: Row, event: React.MouseEvent) => event.preventDefault())
    render(<Harness onRowContextMenu={onRowContextMenu} />)

    const notCancelled = fireEvent.contextMenu(screen.getByText("Beta"))

    expect(onRowContextMenu).toHaveBeenCalledTimes(1)
    expect(onRowContextMenu.mock.calls[0]?.[0]).toEqual(ROWS[1])
    // The host prevented the default, so the browser's own menu stays shut.
    expect(notCancelled).toBe(false)
  })

  it("leaves the browser's menu alone when no handler is given", () => {
    render(<Harness />)
    expect(fireEvent.contextMenu(screen.getByText("Alpha"))).toBe(true)
  })
})
