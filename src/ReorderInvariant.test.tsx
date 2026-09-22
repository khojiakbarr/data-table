import { createColumnHelper } from "@tanstack/react-table"
import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { ROW_NUMBER_COLUMN_ID } from "./core/rowNumbers"
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

/**
 * A leaf standing at the top level beside two groups.
 *
 * The shape a group drag can go wrong in that the other two cannot: the
 * things being moved past one another are different WIDTHS, so any
 * arithmetic that counts in leaves rather than in siblings lands one of them
 * somewhere else.
 */
const mixedColumns = [
  flatColumns[0]!,
  helper.group({
    id: "left",
    header: "Left",
    columns: helper.columns(flatColumns.slice(1, 3)),
  }),
  helper.group({
    id: "right",
    header: "Right",
    columns: helper.columns(flatColumns.slice(3)),
  }),
]

/** The three table shapes the fixtures below are built from. */
const SHAPES = {
  flat: flatColumns,
  grouped: groupedColumns,
  mixed: mixedColumns,
} as const

type Shape = keyof typeof SHAPES

/** A table shape, and the order it renders in before anything is dragged. */
interface Fixture {
  name: string
  shape: Shape
  pinning: { start: string[]; end: string[] }
  /**
   * Columns the ROWS are grouped by — which is a different thing from
   * `grouped`, the column-header kind. A row grouping derives a column order
   * on top of the user's: the column holding the group values is lifted to the
   * front of its section, and is the one column with no place of its own to
   * drag. Server mode, because that is the only mode that groups.
   */
  rowGrouping?: string[]
  /**
   * Whether the leading row-number column is on.
   *
   * A third derivation on top of the user's order, and the one with the
   * strongest claim: it leads every section, before even the group column.
   * It is never in `baseline` — `renderedOrder` reads leaves the fixtures
   * declare, and this column is not one of the host's declarations — so what
   * these fixtures actually check is that a column the user cannot touch,
   * standing in front of everything, changes none of the promises below.
   */
  rowNumbers?: boolean
  /** Asserted once per fixture, so a fixture that quietly changes shape is caught. */
  baseline: string[]
}

const FIXTURES: Fixture[] = [
  {
    name: "a flat table",
    shape: "flat",
    pinning: { start: [], end: [] },
    baseline: ["a", "b", "c", "d", "e", "f"],
  },
  {
    // The finding: two columns pinned to the SAME edge, which is the only way
    // a pinned column has anywhere to move to.
    name: "two columns pinned to the start",
    shape: "flat",
    pinning: { start: ["e", "f"], end: [] },
    baseline: ["e", "f", "a", "b", "c", "d"],
  },
  {
    name: "columns pinned to both edges",
    shape: "flat",
    pinning: { start: ["c", "d"], end: ["e", "f"] },
    baseline: ["c", "d", "a", "b", "e", "f"],
  },
  {
    name: "two column groups",
    shape: "grouped",
    pinning: { start: [], end: [] },
    baseline: ["a", "b", "c", "d", "e", "f"],
  },
  {
    // The derived order the row grouping puts on top of the user's, which is
    // exactly the kind of thing this property exists to catch: D is declared
    // fourth and renders first.
    name: "a table grouped by its fourth column",
    shape: "flat",
    pinning: { start: [], end: [] },
    rowGrouping: ["d"],
    baseline: ["d", "a", "b", "c", "e", "f"],
  },
  {
    // Two derivations at once: the group column leads the SCROLLING columns,
    // and the pinned pair still owns the left edge.
    name: "a grouped table with two columns pinned to the start",
    shape: "flat",
    pinning: { start: ["e", "f"], end: [] },
    rowGrouping: ["d"],
    baseline: ["e", "f", "d", "a", "b", "c"],
  },
  {
    // The group column is hoisted OUT of the Right group to lead the table, so
    // the runs a drop may move within are not the ones the definitions declare.
    name: "two column groups, grouped by one of the right-hand columns",
    shape: "grouped",
    pinning: { start: [], end: [] },
    rowGrouping: ["e"],
    baseline: ["e", "a", "b", "c", "d", "f"],
  },
  {
    // A single column beside two groups, so the siblings a drag steps past
    // are one, three and three columns wide.
    name: "a leaf standing beside two column groups",
    shape: "mixed",
    pinning: { start: [], end: [] },
    baseline: ["a", "b", "c", "d", "e", "f"],
  },
  {
    // The row-number column in front of a pinned pair: it is pinned to the
    // start itself, so without a region of its own it would share one with
    // E and F and be offered as a swap partner for both.
    name: "a table with row numbers and two columns pinned to the start",
    shape: "flat",
    pinning: { start: ["e", "f"], end: [] },
    rowNumbers: true,
    baseline: ["e", "f", "a", "b", "c", "d"],
  },
  {
    // Every derivation at once: the row-number column leads, the group column
    // is hoisted out of the Right group to lead the scrolling section, and
    // the declared groups still have to survive a drop.
    name: "a table with row numbers, grouped by one of the right-hand columns",
    shape: "grouped",
    pinning: { start: [], end: [] },
    rowGrouping: ["e"],
    rowNumbers: true,
    baseline: ["e", "a", "b", "c", "d", "f"],
  },
  {
    // A group straddling the pinning boundary: B is frozen at the start while
    // its siblings A and C scroll, so TanStack draws Left twice and neither
    // header is the group. There is no honest place for it to go, so the
    // panel must offer no grip on either half — the same refusal the header
    // makes, which is `isMovableRegion` in both.
    name: "a column group split across the pinning boundary",
    shape: "grouped",
    pinning: { start: ["b"], end: [] },
    baseline: ["b", "a", "c", "d", "e", "f"],
  },
  {
    // The shape the torn group was found in: the column the rows are grouped
    // by is the LAST leaf of a declared group, so hoisting it out leaves a
    // hole at that group's trailing edge. A drop on that edge resolved against
    // the rendered tree lands INSIDE the group in the stored order — invisible
    // until the grouping comes off. See the stored-order suite at the bottom.
    name: "a leaf beside two groups, grouped by the last column of the first",
    shape: "mixed",
    pinning: { start: [], end: [] },
    rowGrouping: ["c"],
    baseline: ["c", "a", "b", "d", "e", "f"],
  },
]

/**
 * Which leaves each declared column GROUP stands over, per shape.
 *
 * The host's own reading, written out rather than read back off the live
 * columns: while rows are grouped the table is built from a HOISTED tree, in
 * which the grouped column has left its group — so asking the table what a
 * group contains gives exactly the answer that tore the group in the first
 * place. A fixture that quietly changed shape is caught here instead.
 */
const DECLARED_GROUPS: Record<Shape, Readonly<Record<string, readonly string[]>>> = {
  flat: {},
  grouped: { left: ["a", "b", "c"], right: ["d", "e", "f"] },
  mixed: { left: ["b", "c"], right: ["d", "e", "f"] },
}

/**
 * The declared groups an order has torn apart.
 *
 * A group's leaves are a RUN — whatever else moves, they stay side by side —
 * because TanStack draws one header per run of adjacent leaves sharing a
 * parent: split them and the group's name appears twice with a foreign column
 * wedged between the halves.
 *
 * @param shape - Which fixture shape the order belongs to.
 * @param order - A flat leaf order, usually the STORED one.
 * @returns The ids of the groups whose leaves are no longer adjacent.
 */
const tornGroups = (shape: Shape, order: readonly string[]): string[] =>
  Object.entries(DECLARED_GROUPS[shape])
    .filter(([, leaves]) => {
      const at = leaves.map((id) => order.indexOf(id)).filter((index) => index !== -1)
      return at.length > 1 && Math.max(...at) - Math.min(...at) !== at.length - 1
    })
    .map(([group]) => group)

/**
 * The declared groups a fixture's PINNING has split in two.
 *
 * TanStack draws such a group twice, once over the frozen leaves and once over
 * the rest, and neither header is the group: moving it would have to carry
 * leaves out of the section the user froze them in. So neither surface offers
 * a grip on it — `dropRegionOf` puts it alone in a region and
 * `isMovableRegion` answers no.
 *
 * Read off the fixture's own declarations rather than the live columns, for
 * the same reason {@link tornGroups} is: the live tree is a derivation.
 *
 * @param fixture - The fixture to read.
 * @returns The ids of the groups whose leaves do not share a pinning section.
 */
const splitGroups = (fixture: Fixture): string[] => {
  const sectionOf = (id: string): string =>
    fixture.pinning.start.includes(id)
      ? "start"
      : fixture.pinning.end.includes(id)
        ? "end"
        : "center"
  return Object.entries(DECLARED_GROUPS[fixture.shape])
    .filter(([, leaves]) => new Set(leaves.map(sectionOf)).size > 1)
    .map(([group]) => group)
}

/**
 * The columns a fixture lets a user pick up.
 *
 * Every column but the one holding the group values: its place is derived from
 * the grouping, so it has no drag handle at all and a `grip()` on it would
 * throw rather than fail. It stays in the TARGET loops, where the promise is
 * that no slot appears on it and nothing moves.
 */
const draggableIn = (fixture: Fixture): readonly string[] =>
  LEAF_IDS.filter((id) => id !== fixture.rowGrouping?.[0])

const SIDES = ["start", "end"] as const
type Side = (typeof SIDES)[number]

function Table({ fixture, storage }: { fixture: Fixture; storage?: LayoutStorage }) {
  const instance = useDataTable({
    id: "reorder-invariant",
    data: rows,
    columns: SHAPES[fixture.shape],
    initialLayout: {
      columnPinning: fixture.pinning,
      ...(fixture.rowGrouping ? { grouping: [...fixture.rowGrouping] } : {}),
    },
    ...(fixture.rowNumbers ? { features: { rowNumbers: true } } : {}),
    // Grouping is server-side: a client table refuses one, and the fixture
    // would then be an ordinary table wearing a grouped name.
    ...(fixture.rowGrouping
      ? { mode: "server" as const, rowCount: rows.length, getRowId: (row: Row) => row.a }
      : {}),
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

/**
 * The element the Columns panel identifies one row by, and drags it from.
 *
 * A leaf's is its `<li>`. A GROUP's is the row inside its `<li>`, because the
 * `<li>` holds the nested child list as well — a `dragover` on a child would
 * bubble into it, and the enclosing group would draw a slot for a drop it is
 * about to refuse. Both carry `data-column-id`, which is the one attribute
 * every drag surface in this library keys off; a group row answers to it
 * because a group is a column in every sense a drag cares about.
 */
const panelRow = (columnId: string): HTMLElement => {
  // Scoped to the column list: the Row Groups zone below it keys its chips by
  // the same attribute, and a grouped fixture has both on screen at once.
  const row = document.querySelector<HTMLElement>(
    `ul.dt-panel-list [data-column-id="${columnId}"]`,
  )
  if (!row) throw new Error(`no panel row for ${columnId}`)
  return row
}

const panelHandle = (columnId: string): HTMLElement => {
  const handle = panelRow(columnId).querySelector<HTMLElement>(":scope > .dt-drag-handle")
  if (!handle) throw new Error(`no drag handle for ${columnId}`)
  return handle
}

/** The id one `<li>` of the panel stands for: a leaf's own, or its group's. */
const panelRowId = (item: Element): string =>
  item.getAttribute("data-column-id") ??
  item.querySelector(":scope > [data-column-id]")?.getAttribute("data-column-id") ??
  ""

/**
 * The ids standing at one panel row's OWN level, left to right.
 *
 * A drag is a move among siblings, so this is the order every slot and every
 * announced position is measured in. Read back off the rendered list rather
 * than recomputed, so the assertion cannot repeat a mistake the component
 * made in the same arithmetic.
 */
const panelLevelOf = (columnId: string): string[] => {
  const list = panelRow(columnId).closest("li")?.parentElement
  if (!list) throw new Error(`no level for ${columnId}`)
  return [...list.children].map(panelRowId)
}

/** Every row the panel offers a grip on, in list order — leaves and groups. */
const panelDraggable = (): string[] =>
  [...document.querySelectorAll("ul.dt-panel-list [data-column-id]")]
    .filter((row) => row.querySelector(":scope > .dt-drag-handle") !== null)
    .map((row) => row.getAttribute("data-column-id") ?? "")

/** Every row the panel lists, groups included: the full set of drop targets. */
const panelRowIds = (): string[] =>
  [...document.querySelectorAll("ul.dt-panel-list [data-column-id]")].map(
    (row) => row.getAttribute("data-column-id") ?? "",
  )

/** The header a column GROUP is labelled with, for the names spoken aloud. */
const GROUP_HEADERS: Readonly<Record<string, string>> = { left: "Left", right: "Right" }

/**
 * How the panel names a row when it speaks: a leaf by its header, a group by
 * the same "… column group" phrase its own checkbox uses.
 */
const spokenName = (columnId: string): string =>
  LEAF_ID_SET.has(columnId)
    ? label(columnId)
    : `${GROUP_HEADERS[columnId] ?? columnId} column group`

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
    // Not `li.dt-drop-slot`: a group wears the band on its own row, which is
    // a div inside the `<li>` rather than the `<li>` itself.
    slot: () => slotAttribute("ul.dt-panel-list .dt-drop-slot"),
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
 * Read from the `<colgroup>`, which is the one flat list of leaf columns the
 * table draws — and the list every width, every pinned offset and every cell
 * is lined up against, so it IS the rendered order.
 *
 * Not from the headers. Those are two-dimensional: a leaf that belongs to no
 * group is rendered in the TOP row, spanning down, so reading `th`s in
 * document order puts it before every leaf that sits under a group no matter
 * where it actually is. That reading was right only as long as no fixture
 * mixed the two depths, which the mixed fixture does.
 */
const renderedOrder = (): string[] =>
  Array.from(document.querySelectorAll("colgroup col[data-column-id]"))
    .map((col) => col.getAttribute("data-column-id") ?? "")
    .filter((id) => LEAF_ID_SET.has(id))

/** Every header there is, the leaves under the groups included. */
const everyHeaderId = (): string[] =>
  [...document.querySelectorAll("th[data-column-id]")].map(
    (th) => th.getAttribute("data-column-id") ?? "",
  )

/**
 * One complete header drag, start to finish.
 *
 * For the cases that read the OUTCOME rather than the slot — the loops above
 * have to stop between `dragover` and `drop` to see what was promised, and
 * cannot use this.
 */
const dragHeader = (draggedId: string, targetId: string, side: Side) => {
  const surface = SURFACES[0] as Surface
  const dataTransfer = makeDataTransfer()
  fireEvent.dragStart(headerCell(draggedId), { dataTransfer })
  pointAt(surface, "dragOver", headerCell(targetId), side, dataTransfer)
  pointAt(surface, "drop", headerCell(targetId), side, dataTransfer)
  fireEvent.dragEnd(headerCell(draggedId))
}

/**
 * One complete Columns-panel drag, start to finish.
 *
 * The panel's counterpart to {@link dragHeader}, for the cases that compare
 * the two surfaces' OUTCOMES rather than watching either one mid-drag.
 */
const dragPanel = (draggedId: string, targetId: string, side: Side) => {
  const surface = SURFACES[1] as Surface
  const dataTransfer = makeDataTransfer()
  fireEvent.dragStart(panelHandle(draggedId), { dataTransfer })
  pointAt(surface, "dragOver", panelRow(targetId), side, dataTransfer)
  pointAt(surface, "drop", panelRow(targetId), side, dataTransfer)
  fireEvent.dragEnd(panelHandle(draggedId))
}

/** The order the Columns panel is listing in. */
const panelOrder = (): string[] =>
  Array.from(document.querySelectorAll("li.dt-panel-item")).map(
    (item) => item.getAttribute("data-column-id") ?? "",
  )

/** What the panel's live region last said. */
const announced = (): string =>
  document.querySelector(".dt-panel .dt-sr-only")?.textContent ?? ""

/** Open the side panel, which starts on its Columns tab. */
const openPanel = () => fireEvent.click(screen.getByRole("tab", { name: "Columns" }))

/**
 * Put the fixture back, so the next case starts where the last one did.
 *
 * The panel's own Reset restores the declared layout — which is the fixture —
 * and is only rendered once something has actually changed, so its absence is
 * itself the signal that nothing did.
 */
function resetToBaseline() {
  const reset = within(document.querySelector<HTMLElement>(".dt-panel")!).queryByRole("button", { name: "Reset" })
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
    // And the group column, where there is one, offers nothing to pick up —
    // which is why the loops below leave it out of the dragged set.
    for (const id of LEAF_IDS) {
      const handle = panelRow(id).querySelector(":scope > .dt-drag-handle")
      expect(handle === null).toBe(id === fixture.rowGrouping?.[0])
    }
    /*
     * The panel offers a grip on exactly the rows the drop regions allow —
     * which is the whole affordance rule, asked of the rendered DOM. A group
     * split across the pinning boundary is alone in its region and must offer
     * none; every other group must offer one, because the header does.
     */
    expect(panelDraggable().sort()).toEqual(
      panelRowIds()
        .filter((id) => id !== fixture.rowGrouping?.[0] && !splitGroups(fixture).includes(id))
        .sort(),
    )
    // The row-number column is there or it is not, and when it is it is in
    // neither list: no header to grab, and no row in the panel at all — so
    // there is nothing in the panel to grip it by either.
    const numberHeader = document.querySelector(`th[data-column-id="${ROW_NUMBER_COLUMN_ID}"]`)
    expect(numberHeader !== null).toBe(fixture.rowNumbers === true)
    expect(numberHeader?.getAttribute("draggable") ?? "false").toBe("false")
    expect(
      document.querySelector(`ul.dt-panel-list [data-column-id="${ROW_NUMBER_COLUMN_ID}"]`),
    ).toBeNull()
    expect(panelDraggable()).not.toContain(ROW_NUMBER_COLUMN_ID)
  })


  it.each(SURFACES)("dragging on $name", (surface) => {
    const violations: string[] = []
    /*
     * How many of these cases actually moved something. Asserted at the end
     * because every check below is conditional on a slot appearing, so a
     * surface that stopped offering slots at all would pass in silence — and
     * that is exactly the shape a regression in the derived order would take.
     */
    let moves = 0

    for (const draggedId of draggableIn(fixture)) {
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
          if (after.join(" ") !== before.join(" ")) moves += 1

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
    expect(moves).toBeGreaterThan(0)
  })

  /**
   * Every row the panel offers a grip on — leaves AND groups — moved to every
   * position of its own level.
   *
   * Measured at that level and not in leaves, because a group is not one leaf
   * wide: move it past a group of three and it travels three places, which is
   * right and would read as a broken promise to an assertion counting columns.
   * For a flat table the two readings are the same list, so nothing is lost
   * where there are no groups.
   */
  it("lands where it announced on the keyboard path", () => {
    const violations: string[] = []
    let moves = 0

    for (const draggedId of panelDraggable()) {
      const level = panelLevelOf(draggedId)
      for (let index = 0; index < level.length; index += 1) {
        const beforeLevel = panelLevelOf(draggedId)
        const beforeLeaves = renderedOrder()
        const from = beforeLevel.indexOf(draggedId)
        const key = index > from ? "ArrowDown" : "ArrowUp"

        fireEvent.keyDown(panelHandle(draggedId), { key: " " })
        for (let press = 0; press < Math.abs(index - from); press += 1) {
          fireEvent.keyDown(panelHandle(draggedId), { key })
        }
        // A keyboard grab always has a slot — it starts at the row's own
        // place — and the arrows stop at the edge of the run it may move in.
        const slot = slotAttribute("ul.dt-panel-list .dt-drop-slot")
        fireEvent.keyDown(panelHandle(draggedId), { key: " " })

        const afterLevel = panelLevelOf(draggedId)
        const where = `${draggedId} towards position ${index + 1}`
        if (renderedOrder().join(" ") !== beforeLeaves.join(" ")) moves += 1

        if (slot === null) {
          violations.push(`${where}: a held row showed no slot at all`)
        } else {
          const promised = beforeLevel.indexOf(slot)
          const landed = afterLevel.indexOf(draggedId)
          if (landed !== promised) {
            violations.push(`${where}: the slot was at ${promised}, the row landed at ${landed}`)
          }
          // The position a screen-reader user is told is the position they
          // get: the whole point of announcing it. Both numbers are the
          // LEVEL's, which is the only run the arrows can reach.
          const expected = `${spokenName(draggedId)}: position ${promised + 1} of ${level.length}`
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
    // A panel that stopped offering grips, or stopped committing the move,
    // would pass every check above in silence.
    expect(moves).toBeGreaterThan(0)
  })
})

/**
 * The half of the promise the loops above cannot reach: the row-number column
 * as a TARGET.
 *
 * Those loops only ever point at the fixtures' own columns, so a drop onto
 * the numbers themselves is never attempted there — and it is the one place
 * this column could break the property, because it sits in the start section
 * beside columns a user really can rearrange. Its region is solitary, so the
 * answer must be the second form of the promise: no slot, and nothing moves.
 */
describe.each(FIXTURES.filter((fixture) => fixture.rowNumbers))(
  "the row-number column takes no drop in $name",
  (fixture) => {
    beforeEach(() => {
      localStorage.clear()
      render(<Table fixture={fixture} />)
      openPanel()
    })

    it("offers no slot, and leaves the order alone", () => {
      const violations: string[] = []
      const surface = SURFACES[0] as Surface

      for (const draggedId of draggableIn(fixture)) {
        for (const side of SIDES) {
          const before = renderedOrder()
          const dataTransfer = makeDataTransfer()
          const target = headerCell(ROW_NUMBER_COLUMN_ID)

          fireEvent.dragStart(surface.grip(draggedId), { dataTransfer })
          pointAt(surface, "dragOver", target, side, dataTransfer)
          const slot = surface.slot()
          pointAt(surface, "drop", target, side, dataTransfer)
          fireEvent.dragEnd(surface.grip(draggedId))

          const after = renderedOrder()
          const where = `${label(draggedId)} onto the row numbers' ${side}`
          if (slot !== null) violations.push(`${where}: a slot appeared, on ${label(slot)}`)
          if (after.join(" ") !== before.join(" ")) {
            violations.push(`${where}: the order became ${after.join(" ")}`)
          }
          resetToBaseline()
        }
      }

      expect(violations).toEqual([])
    })
  },
)

/**
 * The same promise, made by a header that stands for several columns.
 *
 * A column group is dragged too, and it carries every leaf under it. That
 * makes the promise one level up: the slot appears on a SIBLING — another
 * group, or a leaf that belongs to none — and what it promises is that the
 * dragged group will stand where that sibling stands now.
 *
 * Checked at that level and not in leaves, because leaves are the one reading
 * a group drag cannot be measured in: move a single column past a group of
 * three and it travels three places, which is right and would look like a
 * broken promise to an assertion counting columns. The fixture with a leaf
 * beside two groups exists to keep that case in the loop.
 *
 * The second half of the promise is that the group arrives INTACT — the same
 * leaves, in the same order, still under one header. A move that scattered
 * them would satisfy the first half and be the worse defect.
 */
describe.each(
  FIXTURES.filter(
    (fixture) =>
      fixture.shape !== "flat" &&
      /*
       * A fixture whose only group is split by pinning has no group move to
       * make — neither half is the group, and the unpinned siblings are in
       * other regions — so it belongs in the suites that check the REFUSAL,
       * not here. Its header is also drawn one row per pinning section, which
       * `leavesUnderTopLevel` below cannot read as one run.
       */
      splitGroups(fixture).length === 0,
  ),
)("a column group keeps the slot's promise in $name", (fixture) => {
    /**
     * The header's top row: the groups, and any leaf that belongs to none.
     *
     * The row-number column is left out. It stands at the top level like any
     * ungrouped leaf, but it is not a sibling anything can move among — it is
     * alone in its drop region — so counting it here would shift every
     * promised index by one for a column that never takes part.
     */
    const topLevelOrder = (): string[] =>
      [...document.querySelectorAll("thead tr:first-child th[data-column-id]")]
        .map((th) => th.getAttribute("data-column-id") ?? "")
        .filter((id) => id !== ROW_NUMBER_COLUMN_ID)

    /**
     * Which leaves each top-level header stands over, read the way a user
     * reads it: a cell's `colspan` is how many leaf columns it sits above,
     * and the top row runs left to right over the same leaf order.
     *
     * The filler is skipped without advancing — it has a cell but no column.
     */
    const leavesUnderTopLevel = (): Map<string, string[]> => {
      const leaves = renderedOrder()
      const under = new Map<string, string[]>()
      let at = 0
      for (const th of document.querySelectorAll("thead tr:first-child th")) {
        const id = th.getAttribute("data-column-id")
        if (id === null) continue
        // Skipped WITHOUT advancing, exactly as the filler is: `renderedOrder`
        // reads the fixtures' own leaves, and the row-number column is not
        // one of them, so it occupies no place in the list being sliced.
        if (id === ROW_NUMBER_COLUMN_ID) continue
        const span = Number(th.getAttribute("colspan") ?? "1")
        under.set(id, leaves.slice(at, at + span))
        at += span
      }
      return under
    }

    const surface = SURFACES[0] as Surface

    beforeEach(() => {
      localStorage.clear()
      render(<Table fixture={fixture} />)
      openPanel()
    })

    it("draws a header row the cases below can read", () => {
      // Every leaf is accounted for exactly once, under one top-level header:
      // the reading the whole property rests on.
      const under = leavesUnderTopLevel()
      expect([...under.values()].flat()).toEqual(fixture.baseline)
      expect(new Set(topLevelOrder()).size).toBe(topLevelOrder().length)
    })

    it("lands the whole group where the slot promised", () => {
      const violations: string[] = []
      let moves = 0
      // The group column has no place of its own to drag, exactly as its leaf
      // counterpart has none — it stays in the target loop.
      const draggable = topLevelOrder().filter((id) => id !== fixture.rowGrouping?.[0])
      const targets = everyHeaderId()

      for (const draggedId of draggable) {
        for (const targetId of targets) {
          for (const side of SIDES) {
            const beforeNodes = topLevelOrder()
            const beforeLeaves = renderedOrder()
            const carried = leavesUnderTopLevel().get(draggedId) ?? []
            const dataTransfer = makeDataTransfer()

            fireEvent.dragStart(headerCell(draggedId), { dataTransfer })
            const target = headerCell(targetId)
            pointAt(surface, "dragOver", target, side, dataTransfer)
            const slot = surface.slot()
            pointAt(surface, "drop", target, side, dataTransfer)
            fireEvent.dragEnd(headerCell(draggedId))

            const afterNodes = topLevelOrder()
            const afterLeaves = renderedOrder()
            const where = `${draggedId} onto ${targetId}'s ${side}`
            if (afterLeaves.join(" ") !== beforeLeaves.join(" ")) moves += 1

            if (slot === null) {
              if (afterLeaves.join(" ") !== beforeLeaves.join(" ")) {
                violations.push(`${where}: no slot, yet the order became ${afterLeaves.join(" ")}`)
              }
            } else {
              const promised = beforeNodes.indexOf(slot)
              const landed = afterNodes.indexOf(draggedId)
              if (landed !== promised) {
                violations.push(
                  `${where}: the slot was at ${promised} (on ${slot}), ` +
                    `the header landed at ${landed} — ${afterNodes.join(" ")}`,
                )
              }
              const arrived = leavesUnderTopLevel().get(draggedId) ?? []
              if (arrived.join(" ") !== carried.join(" ")) {
                violations.push(
                  `${where}: it set out with ${carried.join(" ")} and arrived with ` +
                    `${arrived.join(" ")}`,
                )
              }
              if (afterNodes.length !== beforeNodes.length) {
                violations.push(`${where}: the header row became ${afterNodes.join(" ")}`)
              }
            }

            resetToBaseline()
            if (renderedOrder().join(" ") !== fixture.baseline.join(" ")) {
              violations.push(`${where}: Reset left ${renderedOrder().join(" ")}`)
            }
          }
        }
      }

      expect(violations).toEqual([])
      // A fixture whose groups stopped offering slots would pass every check
      // above in silence, which is the shape this regression would take.
      expect(moves).toBeGreaterThan(0)
    })
})

/** The fixtures a GROUP can actually be moved in, on either surface. */
const MOVABLE_GROUP_FIXTURES = FIXTURES.filter(
  (fixture) => fixture.shape !== "flat" && splitGroups(fixture).length === 0,
)

/**
 * The same promise, made by the SIDE PANEL for a header that stands for
 * several columns.
 *
 * The defect: the header could pick a group up and the panel could not, so
 * the one surface a user who cannot drag can reach offered no way to move a
 * group at all. Now it does, and it owes the same two things the header does
 * — the group lands where the slot was, and it arrives intact.
 *
 * Read at the group's own LEVEL, as the header's counterpart is, and with one
 * extra account that only the panel can break cheaply: the stored order, which
 * is where a torn group hides until the grouping comes off.
 */
describe.each(MOVABLE_GROUP_FIXTURES)(
  "a column group keeps the slot's promise in the Columns panel in $name",
  (fixture) => {
    const saved: TableLayout[] = []
    const storage: LayoutStorage = {
      load: () => null,
      save: (_id, layout) => void saved.push(layout),
      clear: () => undefined,
    }
    const surface = SURFACES[1] as Surface

    /** The leaves the panel lists under one group row, in order. */
    const leavesUnder = (groupId: string): string[] =>
      [...document.querySelectorAll(`li[data-group-id="${groupId}"] li.dt-panel-item`)].map(
        (item) => item.getAttribute("data-column-id") ?? "",
      )

    /** The group rows the panel offers a grip on. */
    const draggableGroups = (): string[] =>
      panelDraggable().filter((id) => !LEAF_ID_SET.has(id))

    beforeEach(() => {
      localStorage.clear()
      saved.length = 0
      render(<Table fixture={fixture} storage={storage} />)
      openPanel()
    })

    afterEach(() => cleanup())

    it("offers a grip on exactly the groups the header does", () => {
      const headerGroups = [
        ...new Set(
          [...document.querySelectorAll("th.dt-th-group[data-column-id]")]
            .map((th) => th.getAttribute("data-column-id") ?? "")
            .filter((id) => headerCell(id).getAttribute("draggable") === "true"),
        ),
      ]
      expect(draggableGroups().sort()).toEqual(headerGroups.sort())
      expect(draggableGroups().length).toBeGreaterThan(0)
    })

    it("lands the whole group where the slot promised, and tears none", () => {
      const violations: string[] = []
      let moves = 0
      let refusals = 0

      for (const draggedId of draggableGroups()) {
        // Every row the panel lists, not only the group's own level: a group
        // dropped on a LEAF inside another group has to be refused, and the
        // refusal is only visible if the case is attempted.
        for (const targetId of panelRowIds()) {
          for (const side of SIDES) {
            const beforeLevel = panelLevelOf(draggedId)
            const beforeLeaves = renderedOrder()
            const carried = leavesUnder(draggedId)
            const writes = saved.length
            const dataTransfer = makeDataTransfer()

            fireEvent.dragStart(panelHandle(draggedId), { dataTransfer })
            const target = panelRow(targetId)
            pointAt(surface, "dragOver", target, side, dataTransfer)
            const slot = surface.slot()
            pointAt(surface, "drop", target, side, dataTransfer)
            fireEvent.dragEnd(panelHandle(draggedId))

            const afterLeaves = renderedOrder()
            const where = `${draggedId} onto ${targetId}'s ${side}`
            if (afterLeaves.join(" ") !== beforeLeaves.join(" ")) moves += 1

            if (slot === null) {
              refusals += 1
              if (afterLeaves.join(" ") !== beforeLeaves.join(" ")) {
                violations.push(`${where}: no slot, yet the order became ${afterLeaves.join(" ")}`)
              }
            } else {
              const promised = beforeLevel.indexOf(slot)
              const landed = panelLevelOf(draggedId).indexOf(draggedId)
              if (landed !== promised) {
                violations.push(
                  `${where}: the slot was at ${promised} (on ${slot}), ` +
                    `the group landed at ${landed} — ${panelLevelOf(draggedId).join(" ")}`,
                )
              }
              const arrived = leavesUnder(draggedId)
              if (arrived.join(" ") !== carried.join(" ")) {
                violations.push(
                  `${where}: it set out with ${carried.join(" ")} and arrived with ` +
                    `${arrived.join(" ")}`,
                )
              }
            }

            // Whatever happened on screen, what was WRITTEN DOWN keeps every
            // declared group's leaves in one run.
            fireEvent(window, new Event("pagehide"))
            if (saved.length > writes) {
              const order = saved[saved.length - 1]?.columnOrder ?? []
              const torn = tornGroups(fixture.shape, order)
              if (torn.length > 0) {
                violations.push(`${where}: ${torn.join(", ")} torn apart — ${order.join(" ")}`)
              }
            }

            resetToBaseline()
            if (renderedOrder().join(" ") !== fixture.baseline.join(" ")) {
              violations.push(`${where}: Reset left ${renderedOrder().join(" ")}`)
            }
          }
        }
      }

      expect(violations).toEqual([])
      expect(moves).toBeGreaterThan(0)
      // A group dropped on a leaf inside another group is one of these: the
      // two are never in one region, so there is nothing to paint and nothing
      // to do. Counted so the refusal half cannot go untested in silence.
      expect(refusals).toBeGreaterThan(0)
    })
  },
)

/**
 * The two surfaces, asked to do the same thing.
 *
 * They are separate code paths — one drags a `<th>`, the other a row of a
 * list — and every defect this file has caught lived in the gap between them.
 * So the last property is the plainest one: the same gesture, on either
 * surface, leaves the same arrangement on screen AND the same order in
 * storage.
 *
 * Over UNPINNED siblings only. The header declines to pick up a pinned column
 * at all, while the panel moves one within its own frozen section — a
 * deliberate difference, not a disagreement about a move both offer.
 */
describe.each(MOVABLE_GROUP_FIXTURES)(
  "the header and the Columns panel make the same move in $name",
  (fixture) => {
    const saved: TableLayout[] = []
    const storage: LayoutStorage = {
      load: () => null,
      save: (_id, layout) => void saved.push(layout),
      clear: () => undefined,
    }

    /**
     * The order a returning visit would be restored from.
     *
     * Emptied before each gesture, so "nothing was written" reads as an empty
     * order on both surfaces rather than as the previous case's leftovers.
     */
    const storedOrder = (): string[] => {
      fireEvent(window, new Event("pagehide"))
      return saved[saved.length - 1]?.columnOrder ?? []
    }

    beforeEach(() => {
      localStorage.clear()
      saved.length = 0
      render(<Table fixture={fixture} storage={storage} />)
      openPanel()
    })

    afterEach(() => cleanup())

    it("agrees about where a group lands, on screen and in storage", () => {
      const violations: string[] = []
      let compared = 0

      for (const draggedId of panelDraggable().filter((id) => !LEAF_ID_SET.has(id))) {
        for (const targetId of panelLevelOf(draggedId)) {
          if (targetId === draggedId) continue
          for (const side of SIDES) {
            saved.length = 0
            dragHeader(draggedId, targetId, side)
            const headerRendered = renderedOrder().join(" ")
            const headerStored = storedOrder().join(" ")
            resetToBaseline()

            saved.length = 0
            dragPanel(draggedId, targetId, side)
            const panelRendered = renderedOrder().join(" ")
            const panelStored = storedOrder().join(" ")
            resetToBaseline()

            compared += 1
            const where = `${draggedId} onto ${targetId}'s ${side}`
            if (headerRendered !== panelRendered) {
              violations.push(
                `${where}: the header showed ${headerRendered}, the panel ${panelRendered}`,
              )
            }
            if (headerStored !== panelStored) {
              violations.push(
                `${where}: the header stored ${headerStored}, the panel ${panelStored}`,
              )
            }
          }
        }
      }

      expect(violations).toEqual([])
      expect(compared).toBeGreaterThan(0)
    })
  },
)

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

/**
 * The same promise, made by a third drop target.
 *
 * The Row Groups zone is not reordering columns — it is building a grouping —
 * but the affordance is the same one: a chip is outlined where the dragged
 * column will land. So it makes the same promise and can break it the same two
 * ways, and it is checked the same way: every column dragged onto every chip,
 * on both of its edges, with the landing read back off the grouping.
 *
 * The rendered order is read DURING the drag rather than before it, because
 * the zone mints a ghost chip for a column that is not a level yet — the slot
 * may be on a chip that did not exist a moment earlier, and that chip's place
 * is exactly the promise being checked.
 */
describe("the drop keeps the slot's promise in the Row Groups zone", () => {
  /** Two levels to start with, so a drop has somewhere to go on either side. */
  const SEED = ["a", "b"] as const

  function GroupedTable() {
    const instance = useDataTable({
      id: "reorder-invariant-zone",
      data: rows,
      columns: flatColumns,
      mode: "server",
      rowCount: rows.length,
      getRowId: (row) => row.a,
    })
    return <DataTable instance={instance} virtualize={false} />
  }

  /** The chips as the zone is drawing them, ghost included. */
  const chipOrder = (): string[] =>
    [...document.querySelectorAll("li.dt-group-chip")].map(
      (chip) => chip.getAttribute("data-column-id") ?? "",
    )

  const chipAt = (columnId: string): HTMLElement => {
    const chip = document.querySelector<HTMLElement>(
      `li.dt-group-chip[data-column-id="${columnId}"]`,
    )
    if (!chip) throw new Error(`no chip for ${columnId}`)
    return chip
  }

  /**
   * The element a drag of `columnId` starts from: its chip's grip while it is
   * a level, its row's handle in the Columns list while it is not.
   */
  const source = (columnId: string): HTMLElement => {
    const grip = document
      .querySelector(`li.dt-group-chip[data-column-id="${columnId}"]`)
      ?.querySelector<HTMLElement>(".dt-drag-handle")
    return grip ?? panelHandle(columnId)
  }

  const zoneSurface = (): Surface => ({
    name: "the Row Groups zone",
    grip: source,
    target: chipAt,
    slot: () => slotAttribute("li.dt-group-chip.dt-drop-slot"),
    axis: "clientY",
  })

  /** Put the seeded grouping back, by the controls a user would use. */
  const reseed = () => {
    const panel = document.querySelector<HTMLElement>(".dt-panel") as HTMLElement
    const clear = within(panel).queryByRole("button", { name: "Clear grouping" })
    if (clear) fireEvent.click(clear)
    const list = document.querySelector<HTMLElement>("ul.dt-panel-list") as HTMLElement
    for (const columnId of SEED) {
      fireEvent.click(
        within(list).getByRole("button", { name: `Group rows by ${label(columnId)}` }),
      )
    }
  }

  beforeEach(() => {
    localStorage.clear()
    render(<GroupedTable />)
    openPanel()
    reseed()
  })

  it("renders the seed the cases below assume", () => {
    expect(chipOrder()).toEqual([...SEED])
  })

  it("lands every column where the chip was outlined", () => {
    const violations: string[] = []
    const surface = zoneSurface()

    for (const draggedId of LEAF_IDS) {
      for (const targetId of SEED) {
        for (const side of SIDES) {
          const dataTransfer = makeDataTransfer()
          fireEvent.dragStart(surface.grip(draggedId), { dataTransfer })
          pointAt(surface, "dragOver", chipAt(targetId), side, dataTransfer)
          // Read after the slot is drawn: a column arriving from the Columns
          // list has a ghost chip by now, and that chip is part of the order.
          const promisedOrder = chipOrder()
          const slot = surface.slot()
          pointAt(surface, "drop", chipAt(targetId), side, dataTransfer)
          fireEvent.dragEnd(surface.grip(draggedId))

          const after = chipOrder()
          const where = `${label(draggedId)} onto ${label(targetId)}'s ${side}`

          if (slot === null) {
            if (after.join(" ") !== SEED.join(" ")) {
              violations.push(`${where}: no slot, yet the grouping became ${after.join(" ")}`)
            }
          } else {
            const promised = promisedOrder.indexOf(slot)
            const landed = after.indexOf(draggedId)
            if (landed !== promised) {
              violations.push(
                `${where}: the slot was at ${promised} (on ${label(slot)}), ` +
                  `the column landed at ${landed} — ${after.join(" ")}`,
              )
            }
          }

          reseed()
          if (chipOrder().join(" ") !== SEED.join(" ")) {
            violations.push(`${where}: reseeding left ${chipOrder().join(" ")}`)
          }
        }
      }
    }

    expect(violations).toEqual([])
  })

  it("lands where it announced on the keyboard path", () => {
    const violations: string[] = []

    for (const draggedId of SEED) {
      for (let index = 0; index < SEED.length; index += 1) {
        const before = chipOrder()
        const from = before.indexOf(draggedId)
        const key = index > from ? "ArrowDown" : "ArrowUp"
        const grip = () => source(draggedId)

        fireEvent.keyDown(grip(), { key: " " })
        for (let press = 0; press < Math.abs(index - from); press += 1) {
          fireEvent.keyDown(grip(), { key })
        }
        const slot = slotAttribute("li.dt-group-chip.dt-drop-slot")
        fireEvent.keyDown(grip(), { key: " " })

        const after = chipOrder()
        const where = `${label(draggedId)} towards level ${index + 1}`

        if (slot === null) {
          violations.push(`${where}: a held chip showed no slot at all`)
        } else {
          const promised = before.indexOf(slot)
          const landed = after.indexOf(draggedId)
          if (landed !== promised) {
            violations.push(
              `${where}: the slot was at ${promised}, the chip landed at ${landed}`,
            )
          }
          const expected = `${label(draggedId)}: group level ${promised + 1} of ${SEED.length}`
          const said = document.querySelector(".dt-rowgroups .dt-sr-only")?.textContent ?? ""
          if (said !== expected) {
            violations.push(`${where}: announced "${said}", expected "${expected}"`)
          }
        }

        reseed()
      }
    }

    expect(violations).toEqual([])
  })
})

/**
 * The third account of the arrangement: what is WRITTEN DOWN while the rows
 * are grouped.
 *
 * A grouped table is not built from the columns the host declared. The column
 * holding the group values is hoisted out of its column group so it can lead
 * the table with a full-height header of its own, which means the live
 * `Left` group stands over one leaf where the host declared two. Resolve a
 * drop against that tree and carry it out against the stored order, and the
 * dragged column lands in the hole the hoisted leaf left — splitting the group
 * in storage.
 *
 * Nothing on screen says so. The group column leads the table either way, so
 * the drop slot is kept and the two accounts agree; the disagreement is with
 * the DEFINITIONS, and it surfaces one gesture later, when the grouping comes
 * off and the group's header is suddenly drawn twice with a foreign column
 * between the halves. That is why this suite reads the stored layout rather
 * than the screen, and why every case below ends by taking the grouping off.
 */
describe("a drag made while rows are grouped keeps the declared groups whole", () => {
  const fixture = FIXTURES.find((entry) => entry.rowGrouping?.[0] === "c") as Fixture

  /**
   * The layout a returning visit would be restored from.
   *
   * `pagehide` is the flush `useDebouncedSave` installs for a navigation that
   * gives no unmount, and it writes synchronously — which is what makes the
   * stored order readable BETWEEN two gestures rather than only after a
   * teardown.
   */
  function layoutSpy() {
    const saved: TableLayout[] = []
    const storage: LayoutStorage = {
      load: () => null,
      save: (_id, layout) => void saved.push(layout),
      clear: () => undefined,
    }
    return {
      storage,
      /** Write any pending layout, then hand back the newest one. */
      flush: (): TableLayout | undefined => {
        fireEvent(window, new Event("pagehide"))
        return saved[saved.length - 1]
      },
      /** How many layouts have been written, to tell "unchanged" from "stale". */
      count: () => saved.length,
    }
  }

  /** Take the grouping off, by the control a user would use. */
  const ungroup = () => {
    const panel = document.querySelector<HTMLElement>(".dt-panel") as HTMLElement
    fireEvent.click(within(panel).getByRole("button", { name: "Clear grouping" }))
  }

  let spy: ReturnType<typeof layoutSpy>

  beforeEach(() => {
    localStorage.clear()
    spy = layoutSpy()
    render(<Table fixture={fixture} storage={spy.storage} />)
    openPanel()
  })

  afterEach(() => cleanup())

  it("renders the three-gesture reproduction's starting point", () => {
    // Grouped by C, which the host declared as the second leaf of Left. The
    // hoist has taken it out, so Left now stands over B alone.
    expect(renderedOrder()).toEqual(fixture.baseline)
    expect(headerCell("left").getAttribute("colspan")).toBe("1")
  })

  it("puts a leaf after the WHOLE declared group, not into the hole the hoist left", () => {
    // Gesture 2: A onto the Left group header's right half.
    dragHeader("a", "left", "end")

    // The slot stays truthful: the group column still leads, so A is exactly
    // where the slot was painted — immediately right of B.
    expect(renderedOrder()).toEqual(["c", "b", "a", "d", "e", "f"])

    const order = spy.flush()?.columnOrder ?? []
    expect(order).toEqual(["b", "c", "a", "d", "e", "f"])
    expect(tornGroups(fixture.shape, order)).toEqual([])

    // Gesture 3: and the group is still one group, with A beside it.
    ungroup()
    expect(renderedOrder()).toEqual(["b", "c", "a", "d", "e", "f"])
    expect(headerCell("left").getAttribute("colspan")).toBe("2")
  })

  it("carries a dragged group's hoisted leaf along with the rest of it", () => {
    // The second route to the same torn state: the group header itself is
    // dragged, and the leaf the hoist took out of it must travel too.
    dragHeader("left", "right", "end")

    const order = spy.flush()?.columnOrder ?? []
    expect(order).toEqual(["a", "d", "e", "f", "b", "c"])
    expect(tornGroups(fixture.shape, order)).toEqual([])

    ungroup()
    expect(renderedOrder()).toEqual(["a", "d", "e", "f", "b", "c"])
    expect(headerCell("left").getAttribute("colspan")).toBe("2")
  })

  it("offers no move at all on the group column's own header", () => {
    /*
     * Its place is derived — it leads the table while grouped and returns to
     * its declaring group the moment the grouping comes off — so a drag of it
     * could not mean anything durable. `dropRegionOf` puts it alone in a
     * region, which is what refuses the grab, the slot and the write in one
     * answer rather than three.
     */
    expect(headerCell("c")).toHaveAttribute("draggable", "false")

    const before = renderedOrder()
    const surface = SURFACES[0] as Surface
    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(headerCell("c"), { dataTransfer })
    pointAt(surface, "dragOver", headerCell("a"), "end", dataTransfer)
    expect(surface.slot()).toBeNull()
    pointAt(surface, "drop", headerCell("a"), "end", dataTransfer)
    fireEvent.dragEnd(headerCell("c"))

    expect(renderedOrder()).toEqual(before)
    expect(spy.flush()?.columnOrder ?? []).toEqual([])
  })
})

/**
 * The same rule as a property: no accepted drop, anywhere, tears a group.
 *
 * The two cases above are the routes someone found. This is every route there
 * is on the fixtures a hoist actually changes the shape of — each header
 * dragged onto every header, on both edges — checked against the stored order
 * rather than the screen, because while the rows are grouped the screen cannot
 * tell the tear from the hoist.
 */
describe.each(
  FIXTURES.filter((fixture) => fixture.rowGrouping !== undefined && fixture.shape !== "flat"),
)("no accepted drop tears a declared group in $name", (fixture) => {
  const saved: TableLayout[] = []
  const storage: LayoutStorage = {
    load: () => null,
    save: (_id, layout) => void saved.push(layout),
    clear: () => undefined,
  }

  beforeEach(() => {
    localStorage.clear()
    saved.length = 0
    render(<Table fixture={fixture} storage={storage} />)
    openPanel()
  })

  afterEach(() => cleanup())

  it("leaves every declared group's leaves in one run", () => {
    const violations: string[] = []
    const ids = everyHeaderId()
    let writes = 0

    for (const draggedId of ids) {
      for (const targetId of ids) {
        for (const side of SIDES) {
          const before = saved.length
          dragHeader(draggedId, targetId, side)
          fireEvent(window, new Event("pagehide"))

          // Nothing written means nothing changed; the previous case's layout
          // is still the newest one, and reading it here would be a lie.
          if (saved.length > before) {
            writes += 1
            const order = saved[saved.length - 1]?.columnOrder ?? []
            const torn = tornGroups(fixture.shape, order)
            if (torn.length > 0) {
              violations.push(
                `${draggedId} onto ${targetId}'s ${side}: ${torn.join(", ")} torn apart — ` +
                  order.join(" "),
              )
            }
          }

          resetToBaseline()
          if (renderedOrder().join(" ") !== fixture.baseline.join(" ")) {
            violations.push(`${draggedId} onto ${targetId}'s ${side}: Reset left ${renderedOrder().join(" ")}`)
          }
        }
      }
    }

    expect(violations).toEqual([])
    // A fixture that stopped accepting drops at all would pass in silence,
    // which is the shape a regression in the derived order would take.
    expect(writes).toBeGreaterThan(0)
  })
})
