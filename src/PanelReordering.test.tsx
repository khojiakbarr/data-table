import { createColumnHelper } from "@tanstack/react-table"
import { createEvent, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * Reordering from the side panel's Columns tab.
 *
 * This is the second of the two drag surfaces, and — since the drag handle
 * joined the Tab order — the only one a user who cannot drag can reach. Both
 * paths are covered here: the pointer drag, and the keyboard grab that shows
 * the same slot, announces where it is, and can be given up on.
 *
 * jsdom has no layout, so what is asserted is the decision, not the pixels:
 * which row the slot resolves to, and what order the drop produces.
 */

interface Row {
  a: string
  b: string
  c: string
  d: string
}

const rows: Row[] = [{ a: "1", b: "2", c: "3", d: "4" }]
const helper = createColumnHelper<DataTableFeatures, Row>()

const columns = [
  helper.accessor("a", { header: "A", size: 100 }),
  helper.accessor("b", { header: "B", size: 100 }),
  helper.accessor("c", { header: "C", size: 100 }),
  helper.accessor("d", { header: "D", size: 100 }),
]

/**
 * @param pinned - Pin D to the start, so there is a boundary to refuse at.
 * @param pinnedPair - Pin C and D to the start, so the pinned section has
 *   somewhere to move WITHIN it.
 */
function Table({
  pinned = false,
  pinnedPair = false,
}: {
  pinned?: boolean
  pinnedPair?: boolean
}) {
  const start = pinnedPair ? ["c", "d"] : pinned ? ["d"] : null
  const instance = useDataTable({
    id: "panel-reorder",
    data: rows,
    columns,
    ...(start ? { initialLayout: { columnPinning: { start, end: [] } } } : {}),
  })
  return <DataTable instance={instance} />
}

/** Open the side panel, which starts on its Columns tab. */
async function openPanel() {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: "Columns" }))
}

/**
 * The drag handle of one column, which is also its keyboard control.
 *
 * Scoped to the panel: the header carries buttons named for the same column —
 * sort, resize, the kebab — and every one of them starts with its name.
 */
const handleFor = (name: string): HTMLElement =>
  within(screen.getByRole("dialog")).getByRole("button", {
    name: new RegExp(`^${name}: Drag`),
  })

const panelOrder = (): string[] =>
  Array.from(document.querySelectorAll("li.dt-panel-item")).map(
    (item) => item.querySelector(".dt-panel-label")?.textContent ?? "",
  )

/** The label of the row currently wearing the drop slot, if any. */
const slotRow = (): string | null => {
  const slot = document.querySelector("li.dt-drop-slot")
  return slot === null ? null : (slot.querySelector(".dt-panel-label")?.textContent ?? null)
}

/** What the panel's live region is saying. */
const announced = (): string =>
  document.querySelector(".dt-panel .dt-sr-only")?.textContent ?? ""

/** A dataTransfer good enough for jsdom, which ships none. */
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

type DataTransferStub = ReturnType<typeof makeDataTransfer>

/** Every row is 24px tall, which is the only way jsdom has of being one. */
const HEIGHT = 24

/**
 * Hold the pointer over a row, or let go of it there.
 *
 * A list runs vertically, so it is `clientY` the component reads — and jsdom
 * supplies neither that nor a box to measure it against.
 */
function pointAtRow(
  type: "dragOver" | "drop",
  row: Element,
  side: "start" | "end",
  dataTransfer: DataTransferStub,
) {
  row.getBoundingClientRect = () =>
    ({ left: 0, width: 200, right: 200, top: 0, height: HEIGHT, bottom: HEIGHT, x: 0, y: 0 }) as DOMRect

  const event = createEvent[type](row, { dataTransfer })
  Object.defineProperty(event, "clientY", {
    value: side === "end" ? HEIGHT * 0.75 : HEIGHT * 0.25,
  })
  fireEvent(row, event)
}

/** The `<li>` a column is listed in. */
const rowFor = (name: string): Element => {
  const row = Array.from(document.querySelectorAll("li.dt-panel-item")).find(
    (item) => item.querySelector(".dt-panel-label")?.textContent === name,
  )
  if (!row) throw new Error(`no panel row for ${name}`)
  return row
}

describe("reordering with the pointer in the Columns tab", () => {
  beforeEach(() => localStorage.clear())

  it("marks the row the dragged column will land on", async () => {
    render(<Table />)
    await openPanel()

    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(handleFor("A"), { dataTransfer })
    pointAtRow("dragOver", rowFor("C"), "end", dataTransfer)

    // A after C is [B, C, A, D]: index 2, where C is listed today.
    expect(slotRow()).toBe("C")
  })

  it("lands the column exactly where the slot promised", async () => {
    render(<Table />)
    await openPanel()

    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(handleFor("A"), { dataTransfer })
    const target = rowFor("C")
    pointAtRow("dragOver", target, "end", dataTransfer)
    pointAtRow("drop", target, "end", dataTransfer)

    expect(panelOrder()).toEqual(["B", "C", "A", "D"])
    expect(slotRow()).toBeNull()
  })

  it("shows no slot across a pinned boundary", async () => {
    // D is pinned to the start, so the panel lists D A B C.
    render(<Table pinned />)
    await openPanel()
    expect(panelOrder()).toEqual(["D", "A", "B", "C"])

    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(handleFor("A"), { dataTransfer })
    pointAtRow("dragOver", rowFor("D"), "end", dataTransfer)

    // A pinned column keeps its section however the order changes, so a slot
    // there would promise a move the table would not make.
    expect(slotRow()).toBeNull()
  })

  it("takes the slot away when the drag is abandoned", async () => {
    render(<Table />)
    await openPanel()

    const dataTransfer = makeDataTransfer()
    const handle = handleFor("A")
    fireEvent.dragStart(handle, { dataTransfer })
    pointAtRow("dragOver", rowFor("C"), "end", dataTransfer)
    expect(slotRow()).toBe("C")

    fireEvent.dragEnd(handle)
    expect(slotRow()).toBeNull()
    expect(panelOrder()).toEqual(["A", "B", "C", "D"])
  })
})

describe("reordering from the keyboard in the Columns tab", () => {
  beforeEach(() => localStorage.clear())

  it("picks a column up, moves the slot, and puts it down", async () => {
    render(<Table />)
    await openPanel()
    const handle = handleFor("A")

    fireEvent.keyDown(handle, { key: " " })
    expect(handle).toHaveAttribute("aria-pressed", "true")
    // Held, and not asked to go anywhere yet: its own place is the answer.
    expect(slotRow()).toBe("A")
    expect(announced()).toBe("A: position 1 of 4")

    fireEvent.keyDown(handle, { key: "ArrowDown" })
    expect(slotRow()).toBe("B")
    // The column being carried is named, not the one it is displacing.
    expect(announced()).toBe("A: position 2 of 4")

    fireEvent.keyDown(handle, { key: " " })
    expect(panelOrder()).toEqual(["B", "A", "C", "D"])
    expect(slotRow()).toBeNull()
    expect(handle).toHaveAttribute("aria-pressed", "false")
  })

  it("keeps focus on the handle that was just used", async () => {
    render(<Table />)
    await openPanel()
    handleFor("A").focus()

    fireEvent.keyDown(handleFor("A"), { key: " " })
    fireEvent.keyDown(handleFor("A"), { key: "ArrowDown" })

    /*
     * The blur stands in for the browser's: committing re-inserts the `<li>`
     * at its new place, and moving a focused node drops the focus onto
     * <body>. jsdom does not model that, so without blurring by hand the
     * handle stays focused whether or not anything put it back — and the
     * layout effect this test exists for could be deleted with the suite
     * green, shipping a WCAG 2.4.3 failure. Only the restoration can undo
     * this.
     */
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)

    fireEvent.keyDown(handleFor("A"), { key: " " })
    expect(panelOrder()).toEqual(["B", "A", "C", "D"])

    // Looked up again rather than captured: what is asserted is where focus
    // sits in the list as it now stands, which is also what catches a
    // restoration that puts it on the displaced column's handle instead.
    expect(document.activeElement).toBe(handleFor("A"))
  })

  it("moves the slot all the way to the end and no further", async () => {
    render(<Table />)
    await openPanel()
    const handle = handleFor("A")

    fireEvent.keyDown(handle, { key: " " })
    for (let press = 0; press < 5; press += 1) {
      fireEvent.keyDown(handle, { key: "ArrowDown" })
    }

    expect(slotRow()).toBe("D")
    expect(announced()).toBe("A: position 4 of 4")

    fireEvent.keyDown(handle, { key: " " })
    expect(panelOrder()).toEqual(["B", "C", "D", "A"])
  })

  it("gives the column back on Escape, and says where it is", async () => {
    render(<Table />)
    await openPanel()
    const handle = handleFor("A")

    fireEvent.keyDown(handle, { key: " " })
    fireEvent.keyDown(handle, { key: "ArrowDown" })
    fireEvent.keyDown(handle, { key: "Escape" })

    expect(panelOrder()).toEqual(["A", "B", "C", "D"])
    expect(slotRow()).toBeNull()
    // A silent cancel would leave the last announced position standing as the
    // listener's idea of where the column now is.
    expect(announced()).toBe("A: position 1 of 4")
  })

  it("spends the cancelling Escape rather than closing the panel with it", async () => {
    render(<Table />)
    await openPanel()
    const handle = handleFor("A")

    fireEvent.keyDown(handle, { key: " " })
    fireEvent.keyDown(handle, { key: "Escape" })

    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("really moves a pinned column within its own section", async () => {
    /*
     * The complement of the test below, and the defect it was written for:
     * the slot and the announcement were already right here, but the rendered
     * order never followed. TanStack renders a pinned section in
     * `columnPinning.start` order, so a move that rewrote only `columnOrder`
     * promised something the screen could not show — and left storage holding
     * an order that would spring into effect on the next unpin.
     */
    render(<Table pinnedPair />)
    await openPanel()
    expect(panelOrder()).toEqual(["C", "D", "A", "B"])

    const handle = handleFor("C")
    fireEvent.keyDown(handle, { key: " " })
    fireEvent.keyDown(handle, { key: "ArrowDown" })
    expect(slotRow()).toBe("D")
    expect(announced()).toBe("C: position 2 of 4")

    fireEvent.keyDown(handle, { key: " " })
    expect(panelOrder()).toEqual(["D", "C", "A", "B"])
    // The header, not only the panel: the panel lists the rendered order, and
    // the rendered order is the thing that used to stay put.
    expect(
      screen.getAllByRole("columnheader").map((th) => th.getAttribute("data-column-id")),
    ).toEqual(["d", "c", "a", "b"])
  })

  it("stops the slot at a pinned boundary", async () => {
    // D is pinned to the start, so the panel lists D A B C and A cannot
    // reach position 1.
    render(<Table pinned />)
    await openPanel()
    const handle = handleFor("A")

    fireEvent.keyDown(handle, { key: " " })
    expect(announced()).toBe("A: position 2 of 4")

    fireEvent.keyDown(handle, { key: "ArrowUp" })
    expect(slotRow()).toBe("A")
    expect(announced()).toBe("A: position 2 of 4")

    fireEvent.keyDown(handle, { key: "ArrowDown" })
    expect(slotRow()).toBe("B")
  })
})
