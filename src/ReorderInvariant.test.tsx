import { createColumnHelper } from "@tanstack/react-table"
import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"
import type { LayoutStorage, TableLayout } from "./types"

/**
 * The one promise both drag surfaces make, checked exhaustively.
 *
 * A drop preview is a promise about what the drop will do, and there are only
 * two ways to break it:
 *
 * 1. A slot appears and the column does not land in it.
 * 2. No slot appears and something moves anyway.
 *
 * Hand-written cases cover the moves someone thought of. This covers every
 * move there is — each column dragged onto every column, on both of its edges,
 * across four fixtures and both surfaces — because the defect that prompted
 * this file was in none of the cases anyone had thought of: with two columns
 * pinned to the same edge, the Columns panel drew a slot, announced the new
 * position, and the header did not move, because TanStack renders a pinned
 * section in `columnPinning` order while the drop only rewrote `columnOrder`.
 *
 * The check is deliberately relative — "the column is where the slot was" —
 * rather than a table of expected orders. An expected-order table has to be
 * rewritten whenever a fixture changes and is, itself, a second implementation
 * of the move that is free to be wrong in the same way the first one is.
 */

interface Row {
  a: string
  b: string
  c: string
  d: string
  e: string
  f: string
}

const rows: Row[] = [{ a: "1", b: "2", c: "3", d: "4", e: "5", f: "6" }]
const helper = createColumnHelper<DataTableFeatures, Row>()

/** Leaf ids, each labelled with its own letter so a failure reads as one. */
const LEAF_IDS = ["a", "b", "c", "d", "e", "f"] as const
/** The same ids, widened, for the DOM reads that produce plain strings. */
const LEAF_ID_SET: ReadonlySet<string> = new Set(LEAF_IDS)

/** The header a column is labelled with. Its id upper-cased, and no surprises. */
const label = (columnId: string): string => columnId.toUpperCase()

const flatColumns = LEAF_IDS.map((id) =>
  helper.accessor(id, { header: label(id), size: 100 }),
)

const groupedColumns = [
  helper.group({
    id: "left",
    header: "Left",
    columns: helper.columns(flatColumns.slice(0, 3)),
  }),
  helper.group({
    id: "right",
    header: "Right",
    columns: helper.columns(flatColumns.slice(3)),
  }),
]

/** A table shape, and the order it renders in before anything is dragged. */
interface Fixture {
  name: string
  grouped: boolean
  pinning: { start: string[]; end: string[] }
  /** Asserted once per fixture, so a fixture that quietly changes shape is caught. */
  baseline: string[]
}

const FIXTURES: Fixture[] = [
  {
    name: "a flat table",
    grouped: false,
    pinning: { start: [], end: [] },
    baseline: ["a", "b", "c", "d", "e", "f"],
  },
  {
    // The finding: two columns pinned to the SAME edge, which is the only way
    // a pinned column has anywhere to move to.
    name: "two columns pinned to the start",
    grouped: false,
    pinning: { start: ["e", "f"], end: [] },
    baseline: ["e", "f", "a", "b", "c", "d"],
  },
  {
    name: "columns pinned to both edges",
    grouped: false,
    pinning: { start: ["c", "d"], end: ["e", "f"] },
    baseline: ["c", "d", "a", "b", "e", "f"],
  },
  {
    name: "two column groups",
    grouped: true,
    pinning: { start: [], end: [] },
    baseline: ["a", "b", "c", "d", "e", "f"],
  },
]

const SIDES = ["start", "end"] as const
type Side = (typeof SIDES)[number]

function Table({ fixture, storage }: { fixture: Fixture; storage?: LayoutStorage }) {
  const instance = useDataTable({
    id: "reorder-invariant",
    data: rows,
    columns: fixture.grouped ? groupedColumns : flatColumns,
    initialLayout: { columnPinning: fixture.pinning },
    ...(storage ? { storage } : {}),
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

/** jsdom measures everything as zero, so every element is given one size here. */
const WIDTH = 100
const HEIGHT = 24

/**
 * One of the two places a column can be dragged.
 *
 * Both are driven through the DOM rather than through the hook: the defect
 * lived in the gap between what a surface drew and what the shell then did,
 * and only the rendered result can tell the two apart.
 */
interface Surface {
  name: string
  /** The element a drag is started from. Looked up fresh: the list reorders. */
  grip: (columnId: string) => HTMLElement
  /** The element the pointer is held over and released on. */
  target: (columnId: string) => HTMLElement
  /** The column currently wearing the slot, by id. */
  slot: () => string | null
  /** A header runs across, a list runs down — which is the coordinate read. */
  axis: "clientX" | "clientY"
}

const headerCell = (columnId: string): HTMLElement => {
  const cell = document.querySelector<HTMLElement>(`th[data-column-id="${columnId}"]`)
  if (!cell) throw new Error(`no header for ${columnId}`)
  return cell
}

const panelRow = (columnId: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`li[data-column-id="${columnId}"]`)
  if (!row) throw new Error(`no panel row for ${columnId}`)
  return row
}

const panelHandle = (columnId: string): HTMLElement => {
  const handle = panelRow(columnId).querySelector<HTMLElement>(".dt-drag-handle")
  if (!handle) throw new Error(`no drag handle for ${columnId}`)
  return handle
}

const slotAttribute = (selector: string): string | null =>
  document.querySelector(selector)?.getAttribute("data-column-id") ?? null

const SURFACES: Surface[] = [
  {
    name: "the header",
    grip: headerCell,
    target: headerCell,
    slot: () => slotAttribute("th.dt-drop-slot"),
    axis: "clientX",
  },
  {
    name: "the Columns panel",
    grip: panelHandle,
    target: panelRow,
    slot: () => slotAttribute("li.dt-drop-slot"),
    axis: "clientY",
  },
]

/**
 * Hold the pointer over an element, or let go of it there.
 *
 * jsdom implements neither DragEvent nor layout: drag events arrive with no
 * coordinates and every element measures zero. Both are supplied so the
 * component reads what a browser would.
 */
function pointAt(
  surface: Surface,
  type: "dragOver" | "drop",
  element: HTMLElement,
  side: Side,
  dataTransfer: DataTransferStub,
) {
  element.getBoundingClientRect = () =>
    ({
      left: 0,
      width: WIDTH,
      right: WIDTH,
      top: 0,
      height: HEIGHT,
      bottom: HEIGHT,
      x: 0,
      y: 0,
    }) as DOMRect

  const event = createEvent[type](element, { dataTransfer })
  const span = surface.axis === "clientX" ? WIDTH : HEIGHT
  Object.defineProperty(event, surface.axis, { value: side === "end" ? span * 0.75 : span * 0.25 })
  fireEvent(element, event)
}

/**
 * The order the table is rendering in.
 *
 * Read from the headers, which is the thing a user is looking at, and filtered
 * to leaves — a group header carries its group's id in the same attribute.
 */
const renderedOrder = (): string[] =>
  Array.from(document.querySelectorAll("th[data-column-id]"))
    .map((th) => th.getAttribute("data-column-id") ?? "")
    .filter((id) => LEAF_ID_SET.has(id))

/** The order the Columns panel is listing in. */
const panelOrder = (): string[] =>
  Array.from(document.querySelectorAll("li.dt-panel-item")).map(
    (item) => item.getAttribute("data-column-id") ?? "",
  )

/** What the panel's live region last said. */
const announced = (): string =>
  document.querySelector(".dt-panel .dt-sr-only")?.textContent ?? ""

/** Open the side panel, which starts on its Columns tab. */
const openPanel = () => fireEvent.click(screen.getByRole("button", { name: "Columns" }))

/**
 * Put the fixture back, so the next case starts where the last one did.
 *
 * The panel's own Reset restores the declared layout — which is the fixture —
 * and is only rendered once something has actually changed, so its absence is
 * itself the signal that nothing did.
 */
function resetToBaseline() {
  const reset = within(screen.getByRole("dialog")).queryByRole("button", { name: "Reset" })
  if (reset) fireEvent.click(reset)
}

/** A readable name for one case, for a failure that has to be acted on. */
const caseName = (draggedId: string, targetId: string, side: Side) =>
  `${label(draggedId)} onto ${label(targetId)}'s ${side}`

describe.each(FIXTURES)("the drop keeps the slot's promise in $name", (fixture) => {
  beforeEach(() => {
    localStorage.clear()
    render(<Table fixture={fixture} />)
    openPanel()
  })

  it("renders the fixture the tests below assume", () => {
    expect(renderedOrder()).toEqual(fixture.baseline)
    // The panel lists what the table renders; every case below reads the two
    // interchangeably, and a disagreement here would make all of them lie.
    expect(panelOrder()).toEqual(fixture.baseline)
  })

  it.each(SURFACES)("dragging on $name", (surface) => {
    const violations: string[] = []

    for (const draggedId of LEAF_IDS) {
      for (const targetId of LEAF_IDS) {
        for (const side of SIDES) {
          const before = renderedOrder()
          const dataTransfer = makeDataTransfer()

          fireEvent.dragStart(surface.grip(draggedId), { dataTransfer })
          const target = surface.target(targetId)
          pointAt(surface, "dragOver", target, side, dataTransfer)
          const slot = surface.slot()
          pointAt(surface, "drop", target, side, dataTransfer)
          fireEvent.dragEnd(surface.grip(draggedId))

          const after = renderedOrder()
          const where = caseName(draggedId, targetId, side)

          if (slot === null) {
            if (after.join(" ") !== before.join(" ")) {
              violations.push(`${where}: no slot, yet the order became ${after.join(" ")}`)
            }
          } else {
            const promised = before.indexOf(slot)
            const landed = after.indexOf(draggedId)
            if (landed !== promised) {
              violations.push(
                `${where}: the slot was at ${promised} (on ${label(slot)}), ` +
                  `the column landed at ${landed} — ${after.join(" ")}`,
              )
            }
          }

          resetToBaseline()
          // Guards the harness as much as the component: a Reset that stopped
          // restoring the fixture would leave every later case measuring a
          // drifting order, and they would all still pass.
          if (renderedOrder().join(" ") !== fixture.baseline.join(" ")) {
            violations.push(`${where}: Reset left ${renderedOrder().join(" ")}`)
          }
        }
      }
    }

    expect(violations).toEqual([])
  })

  it("lands where it announced on the keyboard path", () => {
    const violations: string[] = []
    const total = LEAF_IDS.length

    for (const draggedId of LEAF_IDS) {
      for (let index = 0; index < total; index += 1) {
        const before = renderedOrder()
        const from = before.indexOf(draggedId)
        const key = index > from ? "ArrowDown" : "ArrowUp"

        fireEvent.keyDown(panelHandle(draggedId), { key: " " })
        for (let press = 0; press < Math.abs(index - from); press += 1) {
          fireEvent.keyDown(panelHandle(draggedId), { key })
        }
        // A keyboard grab always has a slot — it starts at the column's own
        // place — and the arrows stop at the edge of the run it may move in.
        const slot = document.querySelector("li.dt-drop-slot")?.getAttribute("data-column-id")
        fireEvent.keyDown(panelHandle(draggedId), { key: " " })

        const after = renderedOrder()
        const where = `${label(draggedId)} towards position ${index + 1}`

        if (slot === undefined || slot === null) {
          violations.push(`${where}: a held column showed no slot at all`)
        } else {
          const promised = before.indexOf(slot)
          const landed = after.indexOf(draggedId)
          if (landed !== promised) {
            violations.push(
              `${where}: the slot was at ${promised}, the column landed at ${landed}`,
            )
          }
          // The position a screen-reader user is told is the position they
          // get: the whole point of announcing it.
          const expected = `${label(draggedId)}: position ${promised + 1} of ${total}`
          if (announced() !== expected) {
            violations.push(`${where}: announced "${announced()}", expected "${expected}"`)
          }
        }

        resetToBaseline()
        if (renderedOrder().join(" ") !== fixture.baseline.join(" ")) {
          violations.push(`${where}: Reset left ${renderedOrder().join(" ")}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})

/**
 * What is written down, as against what is shown.
 *
 * The screen and the saved layout are two accounts of the same arrangement,
 * and the finding was that they could disagree in silence — the disagreement
 * only surfacing later, when a column was unpinned and jumped somewhere the
 * user had never put it.
 */
describe("what a pinned move records", () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => cleanup())

  it("saves an order the screen is showing", () => {
    const saved: TableLayout[] = []
    const storage: LayoutStorage = {
      load: () => null,
      save: (_id, layout) => void saved.push(layout),
      clear: () => undefined,
    }
    const fixture = FIXTURES[1] as Fixture
    render(<Table fixture={fixture} storage={storage} />)
    openPanel()

    // E and F are pinned to the start, in that order. Move F ahead of E.
    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(panelHandle("f"), { dataTransfer })
    const target = panelRow("e")
    pointAt(SURFACES[1] as Surface, "dragOver", target, "start", dataTransfer)
    pointAt(SURFACES[1] as Surface, "drop", target, "start", dataTransfer)

    expect(renderedOrder()).toEqual(["f", "e", "a", "b", "c", "d"])

    // Unmounting flushes the pending save, which is the layout a returning
    // visit would be restored from.
    cleanup()
    const layout = saved[saved.length - 1]
    expect(layout).toBeDefined()
    // The pinned section renders from this, so this is what moved the header.
    expect(layout?.columnPinning.start).toEqual(["f", "e"])
    // And the flat order agrees about the pair, so unpinning them later does
    // not silently undo the move the user just watched happen.
    const order = layout?.columnOrder ?? []
    expect(order.indexOf("f")).toBeLessThan(order.indexOf("e"))
  })
})
