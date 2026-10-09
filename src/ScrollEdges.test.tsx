import { createColumnHelper } from "@tanstack/react-table"
import { render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { MAX_PINNED_SHARE, pinsOverflow } from "./core/pinsScroll"
import { EDGES_BOX_VARS, MORE_AT_END, MORE_AT_START, scrollEdges, watchScrollEdges } from "./core/scrollEdges"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * A table wider than its viewport fades at each edge with more to scroll to,
 * and pinned columns too wide to hold still scroll with the rest (0.16): a
 * Gantt's five pinned columns, 656px, on a 311px phone hid its timeline for good.
 */

/** Gives `element` the box a browser would lay out; jsdom lays out nothing. */
function layOut(element: HTMLElement, box: { clientWidth: number; scrollWidth: number; clientHeight?: number; scrollLeft?: number }): void {
  let scrollLeft = box.scrollLeft ?? 0
  Object.defineProperty(element, "clientWidth", { configurable: true, get: () => box.clientWidth })
  Object.defineProperty(element, "scrollWidth", { configurable: true, get: () => box.scrollWidth })
  Object.defineProperty(element, "clientHeight", { configurable: true, get: () => box.clientHeight ?? 300 })
  Object.defineProperty(element, "scrollLeft", { configurable: true, get: () => scrollLeft, set: (next: number) => (scrollLeft = next) })
}

describe("scrollEdges", () => {
  it("says which end has more out of sight", () => {
    expect(scrollEdges({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400 })).toEqual({ start: false, end: false })
    expect(scrollEdges({ scrollLeft: 0, clientWidth: 311, scrollWidth: 1384 })).toEqual({ start: false, end: true })
    expect(scrollEdges({ scrollLeft: 500, clientWidth: 311, scrollWidth: 1384 })).toEqual({ start: true, end: true })
    expect(scrollEdges({ scrollLeft: 1073, clientWidth: 311, scrollWidth: 1384 })).toEqual({ start: true, end: false })
  })

  it("counts a right-to-left scroll from its start the same way", () => {
    expect(scrollEdges({ scrollLeft: -500, clientWidth: 311, scrollWidth: 1384 })).toEqual({ start: true, end: true })
  })

  it("takes a fractional scroll at either end for the end", () => {
    expect(scrollEdges({ scrollLeft: 0.5, clientWidth: 311, scrollWidth: 1384 }).start).toBe(false)
    expect(scrollEdges({ scrollLeft: 1072.6, clientWidth: 311, scrollWidth: 1384 }).end).toBe(false)
  })
})

describe("watchScrollEdges", () => {
  it("keeps the fades' attributes true to the scroll and their box over what the viewport shows, and clears them when it stops", () => {
    const viewport = document.createElement("div")
    const edges = document.createElement("div")
    layOut(viewport, { clientWidth: 311, scrollWidth: 1384, clientHeight: 420 })
    Object.defineProperty(viewport, "offsetTop", { configurable: true, get: () => 52 })
    Object.defineProperty(viewport, "offsetLeft", { configurable: true, get: () => 0 })
    Object.defineProperty(viewport, "clientTop", { configurable: true, get: () => 1 })
    Object.defineProperty(viewport, "clientLeft", { configurable: true, get: () => 1 })
    const stop = watchScrollEdges(viewport, edges)
    expect(edges.hasAttribute(MORE_AT_START)).toBe(false)
    expect(edges.hasAttribute(MORE_AT_END)).toBe(true)
    // Inside the viewport's border, as wide and tall as what is in view.
    expect(EDGES_BOX_VARS.map((name) => edges.style.getPropertyValue(name))).toEqual(["53px", "1px", "311px", "420px"])

    viewport.scrollLeft = 1073
    viewport.dispatchEvent(new Event("scroll"))
    expect(edges.hasAttribute(MORE_AT_START)).toBe(true)
    expect(edges.hasAttribute(MORE_AT_END)).toBe(false)

    stop()
    expect(edges.hasAttribute(MORE_AT_START)).toBe(false)
    expect(edges.style.getPropertyValue("--dt-edges-height")).toBe("")
  })
})

describe("pinsOverflow", () => {
  it("lets pinned columns hold still up to two thirds of the viewport", () => {
    expect(MAX_PINNED_SHARE).toBeCloseTo(2 / 3)
    expect(pinsOverflow(656, 311)).toBe(true)
    expect(pinsOverflow(656, 1200)).toBe(false)
    expect(pinsOverflow(200, 300)).toBe(false)
    expect(pinsOverflow(201, 300)).toBe(true)
  })
})

interface Row {
  id: string
  name: string
  plan: string
  amount: number
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 300 }),
  helper.accessor("plan", { header: "Plan", size: 300 }),
  helper.accessor("amount", { header: "Amount", size: 600 }),
]

function Gantt() {
  const instance = useDataTable<Row>({
    id: "edges",
    columns,
    data: [{ id: "r1", name: "Sales", plan: "07.10", amount: 1 }],
    getRowId: (row) => row.id,
    initialLayout: { columnPinning: { start: ["name", "plan"], end: [] } },
  })
  return <DataTable instance={instance} virtualize={false} toolbar={false} />
}

/** Every element's layout width, as a browser would give the viewport. */
function withViewportWidth(width: number): void {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width })
}

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth")
})

describe("a table's pinned columns and fades", () => {
  it("lets pinned columns too wide for the viewport scroll with the rest, the start fade at the viewport's own edge", () => {
    withViewportWidth(311)
    const { container } = render(<Gantt />)
    const viewport = container.querySelector<HTMLElement>(".dt-viewport")
    expect(viewport?.hasAttribute("data-dt-pins-scroll")).toBe(true)
    // Right after the viewport, outside it: nothing scrolled moves it.
    const edges = container.querySelector<HTMLElement>(".dt-viewport + .dt-edges")
    expect(edges?.getAttribute("aria-hidden")).toBe("true")
    expect(edges?.style.getPropertyValue("--dt-edge-start-at")).toBe("0px")
  })

  it("holds pinned columns still where they leave room, the start fade past them", () => {
    withViewportWidth(1600)
    const { container } = render(<Gantt />)
    expect(container.querySelector(".dt-viewport")?.hasAttribute("data-dt-pins-scroll")).toBe(false)
    expect(container.querySelector<HTMLElement>(".dt-edges")?.style.getPropertyValue("--dt-edge-start-at")).toBe("600px")
  })
})
