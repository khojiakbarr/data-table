import { createColumnHelper } from "@tanstack/react-table"
import { createEvent, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { useDataTable, type DataTableFeatures } from "../useDataTable"
import { DataTable } from "./DataTable"

/**
 * DEFECT D, end to end: dragging a column's handle from the Columns tab into
 * the Row Groups zone applies the grouping AND leaves no trace of the drag.
 *
 * The grouping itself hides the source row's drag handle — see
 * `ColumnsTab.renderLeaf`, which renders no handle for `column.id ===
 * groupColumnId` — the moment `grouping.add` commits, which is exactly the
 * repro: the element `drop.start()` was called on is gone before the browser
 * would otherwise fire `dragend` on it. Without the fix in `useDropSlot.ts`
 * this leaves `.dt-panel-dragging` on record forever, clearing only on some
 * later, unrelated drag.
 */

interface Row {
  a: string
  b: string
}

const rows: Row[] = [{ a: "1", b: "2" }]
const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("a", { header: "A", size: 100 }),
  helper.accessor("b", { header: "B", size: 100 }),
]

function Table() {
  const instance = useDataTable({
    id: "columnstab-drop",
    data: rows,
    columns,
    mode: "server",
    rowCount: rows.length,
  })
  return <DataTable instance={instance} />
}

async function openPanel() {
  const user = userEvent.setup()
  await user.click(screen.getByRole("tab", { name: "Columns" }))
}

const handleFor = (name: string): HTMLElement =>
  within(document.querySelector<HTMLElement>(".dt-panel")!).getByRole("button", {
    name: new RegExp(`^${name}: Drag`),
  })

/** A dataTransfer good enough for jsdom, which ships none. Same stub PanelReordering.test.tsx uses. */
function makeDataTransfer() {
  const store = new Map<string, string>()
  return {
    effectAllowed: "",
    dropEffect: "",
    setData: (format: string, value: string) => void store.set(format, value),
    getData: (format: string) => store.get(format) ?? "",
    setDragImage: () => undefined,
  }
}

/** Any element still wearing a drag-in-progress marker, anywhere in the document. */
const draggingElements = (): Element[] =>
  Array.from(document.querySelectorAll(".dt-panel-dragging, .dt-dragging, .dt-drop-slot"))

describe("dragging a column from the Columns tab into the Row Groups zone", () => {
  beforeEach(() => localStorage.clear())

  it("leaves no dragging class behind once the source row is unmounted by the grouping it caused", async () => {
    render(<Table />)
    await openPanel()

    const dataTransfer = makeDataTransfer()
    const handle = handleFor("A")
    fireEvent.dragStart(handle, { dataTransfer })
    expect(draggingElements().length).toBeGreaterThan(0)

    const zone = document.querySelector<HTMLElement>(".dt-rowgroups-list")
    if (!zone) throw new Error("Row Groups zone not rendered")

    // The zone's own padding is a drop target for "no particular chip", which
    // is what an empty zone's drop always is — see `handleZoneDragOver` /
    // `handleZoneDrop`, both gated on `event.target === event.currentTarget`.
    const dragOver = createEvent.dragOver(zone, { dataTransfer })
    fireEvent(zone, dragOver)
    const drop = createEvent.drop(zone, { dataTransfer })
    fireEvent(zone, drop)

    // The grouping applied: "A" is now the sole level.
    expect(await screen.findByText("A", { selector: ".dt-group-chip-name" })).toBeInTheDocument()
    // "A" no longer has a drag handle — it is the group column now — which is
    // what makes `dragend` unreachable and is the whole point of this test.
    expect(
      within(document.querySelector<HTMLElement>(".dt-panel")!).queryByRole("button", {
        name: /^A: Drag/,
      }),
    ).toBeNull()

    // No element anywhere still claims to be mid-drag.
    expect(draggingElements()).toEqual([])
  })
})
