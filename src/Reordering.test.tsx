import { createColumnHelper } from "@tanstack/react-table"
import { createEvent, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * Drag-and-drop reordering, driven through the DOM.
 *
 * The arithmetic is covered in `core/reorder.test.ts`; these tests cover the
 * wiring around it — which edge the caret was on, what the order falls back to
 * before anything has been reordered, and whether a leaf can escape its group.
 */

interface Row {
  a: string
  b: string
  c: string
  d: string
}

const rows: Row[] = [{ a: "1", b: "2", c: "3", d: "4" }]
const helper = createColumnHelper<DataTableFeatures, Row>()

const flatColumns = [
  helper.accessor("a", { header: "A", size: 100 }),
  helper.accessor("b", { header: "B", size: 100 }),
  helper.accessor("c", { header: "C", size: 100 }),
  helper.accessor("d", { header: "D", size: 100 }),
]

const groupedColumns = [
  helper.group({
    id: "left",
    header: "Left",
    columns: helper.columns([
      helper.accessor("a", { header: "A", size: 100 }),
      helper.accessor("b", { header: "B", size: 100 }),
    ]),
  }),
  helper.group({
    id: "right",
    header: "Right",
    columns: helper.columns([
      helper.accessor("c", { header: "C", size: 100 }),
      helper.accessor("d", { header: "D", size: 100 }),
    ]),
  }),
]

function Table({
  grouped = false,
  pinned = false,
}: {
  grouped?: boolean
  pinned?: boolean
}) {
  const instance = useDataTable({
    id: "reorder",
    data: rows,
    columns: grouped ? groupedColumns : flatColumns,
    ...(pinned ? { initialLayout: { columnPinning: { start: ["d"], end: [] } } } : {}),
  })
  return <DataTable instance={instance} />
}

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

/** Every header is 100px wide, which is the only way jsdom has of being one. */
const WIDTH = 100

/** Pick a header up. The returned transfer carries its id the way a browser would. */
function startDrag(from: HTMLElement): DataTransferStub {
  const dataTransfer = makeDataTransfer()
  fireEvent.dragStart(from, { dataTransfer })
  return dataTransfer
}

/**
 * Hold the pointer over a header, or let go of it there.
 *
 * jsdom implements neither DragEvent nor layout: drag events arrive without
 * `clientX`, and every element measures zero. Both are supplied here so the
 * component sees what a browser would.
 *
 * @param side - Which half of the target the pointer is over.
 */
function pointAt(
  type: "dragOver" | "drop",
  to: HTMLElement,
  side: "start" | "end",
  dataTransfer: DataTransferStub,
) {
  to.getBoundingClientRect = () =>
    ({ left: 0, width: WIDTH, right: WIDTH, top: 0, height: 20, bottom: 20, x: 0, y: 0 }) as DOMRect

  const event = createEvent[type](to, { dataTransfer })
  Object.defineProperty(event, "clientX", {
    value: side === "end" ? WIDTH * 0.75 : WIDTH * 0.25,
  })
  fireEvent(to, event)
}

/**
 * Take the pointer out of an element, into `into` or out of the table.
 *
 * `relatedTarget` is defined by hand: jsdom has no DragEvent constructor, so
 * RTL falls back to a plain `Event`, which drops everything MouseEvent's init
 * dictionary would have carried.
 */
function dragLeave(from: HTMLElement, into: Element | null = null) {
  const event = createEvent.dragLeave(from)
  Object.defineProperty(event, "relatedTarget", { value: into })
  fireEvent(from, event)
}

/** Drag one header onto another, all the way to the drop. */
function dragHeader(from: HTMLElement, to: HTMLElement, side: "start" | "end") {
  const dataTransfer = startDrag(from)
  pointAt("dragOver", to, side, dataTransfer)
  pointAt("drop", to, side, dataTransfer)
}

/** The label of the header currently wearing the drop slot, if any. */
const slotLabel = (): string | null => {
  const slot = document.querySelector<HTMLElement>("th.dt-drop-slot")
  return slot === null ? null : (within(slot).queryByText(/^[A-D]$/)?.textContent ?? null)
}

const headerOrder = () =>
  screen
    .getAllByRole("columnheader")
    .map((th) => within(th).queryByText(/^[A-D]$/)?.textContent)
    .filter(Boolean)

const bodyOrder = () =>
  screen
    .getAllByRole("cell")
    .map((td) => td.textContent)

describe("column reordering", () => {
  beforeEach(() => localStorage.clear())

  it("starts in declaration order", () => {
    render(<Table />)
    expect(headerOrder()).toEqual(["A", "B", "C", "D"])
  })

  it("drops a column after the target's trailing edge", () => {
    render(<Table />)
    const [a, , c] = screen.getAllByRole("columnheader")
    dragHeader(a as HTMLElement, c as HTMLElement, "end")

    expect(headerOrder()).toEqual(["B", "C", "A", "D"])
    expect(bodyOrder()).toEqual(["2", "3", "1", "4"])
  })

  it("drops a column before the target's leading edge", () => {
    render(<Table />)
    const [a, , c] = screen.getAllByRole("columnheader")
    dragHeader(a as HTMLElement, c as HTMLElement, "start")

    expect(headerOrder()).toEqual(["B", "A", "C", "D"])
  })

  it("keeps the body in step with the header", () => {
    render(<Table />)
    const headers = screen.getAllByRole("columnheader")
    dragHeader(headers[3] as HTMLElement, headers[0] as HTMLElement, "start")

    expect(headerOrder()).toEqual(["D", "A", "B", "C"])
    expect(bodyOrder()).toEqual(["4", "1", "2", "3"])
  })

  it("does not scramble the order on the first drag of a pinned table", () => {
    // Pinning D to the start puts it first — that is what pinning means.
    // The bug was in the FALLBACK order used on the first drag: it came from
    // getAllLeafColumns(), which lists start- and end-pinned columns together
    // ahead of the rest, so the first drag reshuffled everything else.
    render(<Table pinned />)
    expect(headerOrder()).toEqual(["D", "A", "B", "C"])

    // A is pinned-free; drop it after B. Only A and B may swap.
    const a = screen.getByRole("columnheader", { name: /^A/ })
    const b = screen.getByRole("columnheader", { name: /^B/ })
    dragHeader(a, b, "end")

    expect(headerOrder()).toEqual(["D", "B", "A", "C"])
  })

  it("reorders within a group", () => {
    render(<Table grouped />)
    const a = screen.getByRole("columnheader", { name: /^A/ })
    const b = screen.getByRole("columnheader", { name: /^B/ })
    dragHeader(a, b, "end")

    expect(headerOrder()).toEqual(["B", "A", "C", "D"])
  })

  it("refuses to move a column out of its group", () => {
    render(<Table grouped />)
    const a = screen.getByRole("columnheader", { name: /^A/ })
    const c = screen.getByRole("columnheader", { name: /^C/ })
    dragHeader(a, c, "end")

    expect(headerOrder()).toEqual(["A", "B", "C", "D"])
  })

  it("does not make group headers draggable", () => {
    render(<Table grouped />)
    expect(screen.getByRole("columnheader", { name: "Left" })).not.toHaveAttribute(
      "draggable",
      "true",
    )
  })

  it("does not make pinned columns draggable", () => {
    render(<Table pinned />)
    expect(screen.getByRole("columnheader", { name: /^D/ })).not.toHaveAttribute(
      "draggable",
      "true",
    )
  })
})


/**
 * The affordance itself: not a caret on the seam the column falls through,
 * but the slot it will land in — worn by whatever stands at the destination
 * while nothing has moved yet.
 *
 * jsdom has no layout, so there are no pixels to assert. What can be asserted
 * is the decision: given a pointer position and an order, which index does the
 * drop resolve to, and is that the element carrying the class.
 */
describe("the drop slot", () => {
  beforeEach(() => localStorage.clear())

  it("marks the column standing where the dragged one will land", () => {
    render(<Table />)
    const [a, , c] = screen.getAllByRole("columnheader")
    const transfer = startDrag(a as HTMLElement)
    pointAt("dragOver", c as HTMLElement, "end", transfer)

    // A after C is [B, C, A, D]: index 2, where C stands today.
    expect(slotLabel()).toBe("C")
  })

  it("marks the last column when the pointer is dragged past the end", () => {
    render(<Table />)
    const [a, , , d] = screen.getAllByRole("columnheader")
    const transfer = startDrag(a as HTMLElement)
    pointAt("dragOver", d as HTMLElement, "end", transfer)

    expect(slotLabel()).toBe("D")
  })

  it("marks the dragged column itself when the pointer is over it", () => {
    render(<Table />)
    const [a] = screen.getAllByRole("columnheader")
    const transfer = startDrag(a as HTMLElement)
    pointAt("dragOver", a as HTMLElement, "start", transfer)

    // "No move" still has an answer, and it is the column's own place.
    expect(slotLabel()).toBe("A")
  })

  it("lands the column exactly where the slot promised", () => {
    render(<Table />)
    const [a, , c] = screen.getAllByRole("columnheader")
    const transfer = startDrag(a as HTMLElement)
    pointAt("dragOver", c as HTMLElement, "end", transfer)
    expect(slotLabel()).toBe("C")

    // C was the third header; A is the third header now.
    pointAt("drop", c as HTMLElement, "end", transfer)
    expect(headerOrder()[2]).toBe("A")
  })

  it("shows no slot over a pinned column, which is its own drop region", () => {
    // D is pinned to the start, so the rendered order is D A B C.
    render(<Table pinned />)
    const a = screen.getByRole("columnheader", { name: /^A/ })
    const b = screen.getByRole("columnheader", { name: /^B/ })
    const pinned = screen.getByRole("columnheader", { name: /^D/ })

    const transfer = startDrag(a)
    pointAt("dragOver", b, "end", transfer)
    expect(slotLabel()).toBe("B")

    dragLeave(b)
    pointAt("dragOver", pinned, "start", transfer)
    // A pinned column refuses the drop, so promising one there would be a lie.
    expect(slotLabel()).toBeNull()
  })

  it("shows no slot over the filler column", () => {
    render(<Table />)
    const [a, , c] = screen.getAllByRole("columnheader")
    const filler = document.querySelector<HTMLElement>("th.dt-th-filler")
    expect(filler).not.toBeNull()

    const transfer = startDrag(a as HTMLElement)
    pointAt("dragOver", c as HTMLElement, "end", transfer)
    dragLeave(c as HTMLElement)
    if (filler) fireEvent.dragOver(filler, { dataTransfer: transfer })

    expect(slotLabel()).toBeNull()
  })

  it("dims the column in flight", () => {
    render(<Table />)
    const [a] = screen.getAllByRole("columnheader")
    startDrag(a as HTMLElement)
    expect(a).toHaveClass("dt-dragging")
  })

  it("takes the slot away once the column is dropped", () => {
    render(<Table />)
    const [a, , c] = screen.getAllByRole("columnheader")
    dragHeader(a as HTMLElement, c as HTMLElement, "end")
    expect(slotLabel()).toBeNull()
  })

  it("takes the slot away when the drag is abandoned", () => {
    render(<Table />)
    const [a, , c] = screen.getAllByRole("columnheader")
    const transfer = startDrag(a as HTMLElement)
    pointAt("dragOver", c as HTMLElement, "end", transfer)
    expect(slotLabel()).toBe("C")

    // Escape, and the pointer released outside the window, both end here.
    fireEvent.dragEnd(a as HTMLElement)
    expect(slotLabel()).toBeNull()
    expect(a).not.toHaveClass("dt-dragging")
  })

  it("takes the slot away when the pointer leaves the header", () => {
    render(<Table />)
    const [a, , c] = screen.getAllByRole("columnheader")
    const transfer = startDrag(a as HTMLElement)
    pointAt("dragOver", c as HTMLElement, "end", transfer)

    dragLeave(c as HTMLElement)
    expect(slotLabel()).toBeNull()
  })

  it("keeps the slot while the pointer crosses between a header's own parts", () => {
    // `dragleave` bubbles from descendants; acting on those would blink the
    // slot — and replay its opening animation — several times per column.
    render(<Table />)
    const [a, , c] = screen.getAllByRole("columnheader")
    const transfer = startDrag(a as HTMLElement)
    pointAt("dragOver", c as HTMLElement, "end", transfer)

    const inner = (c as HTMLElement).querySelector(".dt-th-inner")
    dragLeave(c as HTMLElement, inner)
    expect(slotLabel()).toBe("C")
  })
})
