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

/**
 * Drag one header onto another.
 *
 * jsdom implements neither DragEvent nor layout: drag events arrive without
 * `clientX`, and every element measures zero. Both are supplied here so the
 * component sees what a browser would.
 *
 * @param side - Which half of the target to release over.
 */
function dragHeader(from: HTMLElement, to: HTMLElement, side: "start" | "end") {
  const dataTransfer = makeDataTransfer()
  const WIDTH = 100

  to.getBoundingClientRect = () =>
    ({ left: 0, width: WIDTH, right: WIDTH, top: 0, height: 20, bottom: 20, x: 0, y: 0 }) as DOMRect

  const clientX = side === "end" ? WIDTH * 0.75 : WIDTH * 0.25

  fireEvent.dragStart(from, { dataTransfer })

  for (const type of ["dragOver", "drop"] as const) {
    const event = createEvent[type](to, { dataTransfer })
    Object.defineProperty(event, "clientX", { value: clientX })
    fireEvent(to, event)
  }
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
