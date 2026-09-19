import { createColumnHelper } from "@tanstack/react-table"
import { createEvent, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import type { TableQuery } from "./core/query"
import { useDataTable, type DataTableFeatures } from "./useDataTable"
import type { TableLayout } from "./types"

/**
 * The Row Groups zone: dropping a column in it groups by that column.
 *
 * Behaviour and not markup. Every case here is something a user does — drag a
 * column in, nest a second, renest them, take one out, do the whole thing from
 * the keyboard — and what is asserted is what the table then asks the server
 * for and what it then shows. The one property that IS about the drop preview
 * — "the chip lands where the slot was" — lives in `ReorderInvariant.test.tsx`
 * beside the same promise for the two column surfaces.
 */

interface Row {
  id: string
  name: string
  status: string
  partner: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 120 }),
  helper.accessor("status", { header: "Status", size: 90 }),
  helper.accessor("partner", { header: "Partner", size: 120 }),
]

const rows: Row[] = [{ id: "r0", name: "Row 0", status: "open", partner: "Acme" }]

interface HarnessProps {
  mode?: "client" | "server"
  onQueryChange?: (query: TableQuery) => void
  /** A layout to start from, for the cases about where a column sits. */
  initialLayout?: Partial<TableLayout>
}

function Harness({ mode = "server", onQueryChange, initialLayout }: HarnessProps) {
  const instance = useDataTable<Row>({
    id: "zone",
    columns,
    data: rows,
    mode,
    rowCount: 1,
    getRowId: (row) => row.id,
    ...(onQueryChange === undefined ? {} : { onQueryChange }),
    ...(initialLayout === undefined ? {} : { initialLayout }),
  })
  return <DataTable instance={instance} virtualize={false} />
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

const HEIGHT = 24

/** jsdom measures everything as zero, so the element is given one size here. */
function pointAt(
  type: "dragOver" | "drop",
  element: HTMLElement,
  side: "start" | "end",
  dataTransfer: DataTransferStub,
) {
  element.getBoundingClientRect = () =>
    ({ left: 0, width: 100, right: 100, top: 0, height: HEIGHT, bottom: HEIGHT, x: 0, y: 0 }) as DOMRect
  const event = createEvent[type](element, { dataTransfer })
  Object.defineProperty(event, "clientY", { value: side === "end" ? HEIGHT * 0.75 : HEIGHT * 0.25 })
  fireEvent(element, event)
}

const openPanel = () => fireEvent.click(screen.getByRole("button", { name: "Columns" }))

const zone = (): HTMLElement | null => document.querySelector("ul.dt-rowgroups-list")

const chipIds = (): string[] =>
  [...document.querySelectorAll("li.dt-group-chip")].map(
    (chip) => chip.getAttribute("data-column-id") ?? "",
  )

const chip = (columnId: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`li.dt-group-chip[data-column-id="${columnId}"]`)
  if (!found) throw new Error(`no chip for ${columnId}`)
  return found
}

const chipGrip = (columnId: string): HTMLElement => {
  const grip = chip(columnId).querySelector<HTMLElement>(".dt-drag-handle")
  if (!grip) throw new Error(`no grip on the ${columnId} chip`)
  return grip
}

const panelHandle = (columnId: string): HTMLElement => {
  const handle = document.querySelector<HTMLElement>(
    `li[data-column-id="${columnId}"] .dt-drag-handle`,
  )
  if (!handle) throw new Error(`no panel handle for ${columnId}`)
  return handle
}

/**
 * The zone's own remove button for a level.
 *
 * Scoped, because the Columns tab's per-row toggle answers to the same name
 * while that column is grouped — deliberately: they are two ways to say one
 * thing, and a screen-reader user should hear the same words for both.
 */
const removeChip = (name: string): HTMLElement =>
  within(document.querySelector<HTMLElement>("section.dt-rowgroups") as HTMLElement).getByRole(
    "button",
    { name: `Remove ${name} from row groups` },
  )

/** The per-column group toggle on a row of the Columns tab. */
const listToggle = (label: string): HTMLElement =>
  within(document.querySelector<HTMLElement>("ul.dt-panel-list") as HTMLElement).getByRole(
    "button",
    { name: label },
  )

const headerIds = (): string[] =>
  [...document.querySelectorAll("th[data-column-id]")].map(
    (th) => th.getAttribute("data-column-id") ?? "",
  )

/**
 * Drag a column out of the Columns list and drop it on the zone.
 *
 * `target` is the chip the pointer is released on; omitted, the drop lands on
 * the zone's own area, which stands for the innermost level.
 */
function dragColumnIntoZone(
  columnId: string,
  target?: { chip: string; side: "start" | "end" },
) {
  const dataTransfer = makeDataTransfer()
  fireEvent.dragStart(panelHandle(columnId), { dataTransfer })
  const element = target ? chip(target.chip) : (zone() as HTMLElement)
  const side = target?.side ?? "end"
  pointAt("dragOver", element, side, dataTransfer)
  pointAt("drop", target ? chip(target.chip) : (zone() as HTMLElement), side, dataTransfer)
  fireEvent.dragEnd(panelHandle(columnId))
}

/** The current grouping, as the table last published it on the query. */
const publishedGrouping = (onQueryChange: ReturnType<typeof vi.fn>): string[] =>
  (onQueryChange.mock.lastCall?.[0] as TableQuery | undefined)?.grouping ?? []

beforeEach(() => localStorage.clear())

describe("dropping a column into the zone", () => {
  it("groups by it, and says so on the wire", () => {
    const onQueryChange = vi.fn()
    render(<Harness onQueryChange={onQueryChange} />)
    openPanel()

    expect(chipIds()).toEqual([])
    dragColumnIntoZone("status")

    expect(chipIds()).toEqual(["status"])
    expect(publishedGrouping(onQueryChange)).toEqual(["status"])
  })

  it("nests a second column inside the first", () => {
    const onQueryChange = vi.fn()
    render(<Harness onQueryChange={onQueryChange} />)
    openPanel()

    dragColumnIntoZone("status")
    dragColumnIntoZone("partner")

    // Outermost first, which is the order the chips are listed in.
    expect(chipIds()).toEqual(["status", "partner"])
    expect(publishedGrouping(onQueryChange)).toEqual(["status", "partner"])
  })

  it("drops a column ahead of an existing level when released on its leading edge", () => {
    const onQueryChange = vi.fn()
    render(<Harness onQueryChange={onQueryChange} />)
    openPanel()

    dragColumnIntoZone("status")
    dragColumnIntoZone("partner", { chip: "status", side: "start" })

    expect(chipIds()).toEqual(["partner", "status"])
    expect(publishedGrouping(onQueryChange)).toEqual(["partner", "status"])
  })

  it("draws a slot for a grouped column dragged back in from the column list", () => {
    // The tree still lists a grouped column and its handle still drags, so
    // dragging it here is a renest — and it has to show the same promise as
    // any other drop, or the zone would move something it never outlined.
    render(<Harness />)
    openPanel()
    dragColumnIntoZone("status")
    dragColumnIntoZone("partner")

    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(panelHandle("status"), { dataTransfer })
    pointAt("dragOver", chip("partner"), "end", dataTransfer)
    expect(chip("partner").className).toContain("dt-drop-slot")
    fireEvent.dragEnd(panelHandle("status"))
  })

  it("moves a column already grouped rather than repeating it", () => {
    const onQueryChange = vi.fn()
    render(<Harness onQueryChange={onQueryChange} />)
    openPanel()

    dragColumnIntoZone("status")
    dragColumnIntoZone("partner")
    // The Columns list still offers `status`; dragging it in again is a renest.
    dragColumnIntoZone("status")

    expect(chipIds()).toEqual(["partner", "status"])
    expect(publishedGrouping(onQueryChange)).toEqual(["partner", "status"])
  })
})

describe("the chips", () => {
  it("reorders by dragging, and the nesting follows", () => {
    const onQueryChange = vi.fn()
    render(<Harness onQueryChange={onQueryChange} />)
    openPanel()

    dragColumnIntoZone("status")
    dragColumnIntoZone("partner")

    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(chipGrip("partner"), { dataTransfer })
    pointAt("dragOver", chip("status"), "start", dataTransfer)
    pointAt("drop", chip("status"), "start", dataTransfer)

    expect(chipIds()).toEqual(["partner", "status"])
    expect(publishedGrouping(onQueryChange)).toEqual(["partner", "status"])
  })

  it("removes one level and leaves the rest", () => {
    const onQueryChange = vi.fn()
    render(<Harness onQueryChange={onQueryChange} />)
    openPanel()

    dragColumnIntoZone("status")
    dragColumnIntoZone("partner")

    fireEvent.click(removeChip("Status"))

    expect(chipIds()).toEqual(["partner"])
    expect(publishedGrouping(onQueryChange)).toEqual(["partner"])
  })

  it("puts every column back when the last one goes", () => {
    render(<Harness />)
    openPanel()
    const before = headerIds()
    expect(before).toEqual(["name", "status", "partner"])

    dragColumnIntoZone("status")
    dragColumnIntoZone("partner")
    // A grouped column that is not the group slot leaves the body, and the
    // one that holds the values has moved to the front — so this is a real
    // restoration and not a table that never moved.
    expect(headerIds()).toEqual(["status", "name"])

    fireEvent.click(removeChip("Status"))
    fireEvent.click(removeChip("Partner"))

    expect(chipIds()).toEqual([])
    expect(headerIds()).toEqual(before)
  })

  it("clears the whole grouping from the zone's own head", () => {
    const onQueryChange = vi.fn()
    render(<Harness onQueryChange={onQueryChange} />)
    openPanel()

    dragColumnIntoZone("status")
    dragColumnIntoZone("partner")
    fireEvent.click(screen.getByRole("button", { name: "Clear grouping" }))

    expect(chipIds()).toEqual([])
    expect(publishedGrouping(onQueryChange)).toEqual([])
  })
})

describe("without a pointer", () => {
  it("groups and ungroups a column from its row in the Columns tab", () => {
    const onQueryChange = vi.fn()
    render(<Harness onQueryChange={onQueryChange} />)
    openPanel()

    fireEvent.click(listToggle("Group rows by Status"))
    expect(chipIds()).toEqual(["status"])
    expect(publishedGrouping(onQueryChange)).toEqual(["status"])
    // The control states which half of the toggle it is on, so a screen
    // reader announces "grouped" rather than leaving it to be inferred.
    expect(listToggle("Remove Status from row groups")).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(listToggle("Remove Status from row groups"))
    expect(chipIds()).toEqual([])
    expect(publishedGrouping(onQueryChange)).toEqual([])
  })

  it("renests the levels with Space and the arrows", () => {
    const onQueryChange = vi.fn()
    render(<Harness onQueryChange={onQueryChange} />)
    openPanel()

    fireEvent.click(listToggle("Group rows by Status"))
    fireEvent.click(listToggle("Group rows by Partner"))
    expect(chipIds()).toEqual(["status", "partner"])

    fireEvent.keyDown(chipGrip("partner"), { key: " " })
    fireEvent.keyDown(chipGrip("partner"), { key: "ArrowUp" })
    fireEvent.keyDown(chipGrip("partner"), { key: " " })

    expect(chipIds()).toEqual(["partner", "status"])
    expect(publishedGrouping(onQueryChange)).toEqual(["partner", "status"])
  })

  it("says where the held chip is, at every step", () => {
    render(<Harness />)
    openPanel()
    fireEvent.click(listToggle("Group rows by Status"))
    fireEvent.click(listToggle("Group rows by Partner"))

    const announced = () =>
      document.querySelector(".dt-rowgroups .dt-sr-only")?.textContent ?? ""

    fireEvent.keyDown(chipGrip("partner"), { key: " " })
    expect(announced()).toBe("Partner: group level 2 of 2")
    fireEvent.keyDown(chipGrip("partner"), { key: "ArrowUp" })
    expect(announced()).toBe("Partner: group level 1 of 2")
  })

  it("leaves the nesting alone when a grab is cancelled with Escape", () => {
    render(<Harness />)
    openPanel()
    fireEvent.click(listToggle("Group rows by Status"))
    fireEvent.click(listToggle("Group rows by Partner"))

    fireEvent.keyDown(chipGrip("partner"), { key: " " })
    fireEvent.keyDown(chipGrip("partner"), { key: "ArrowUp" })
    fireEvent.keyDown(chipGrip("partner"), { key: "Escape" })
    fireEvent.keyDown(chipGrip("partner"), { key: " " })

    // The Escape cancelled the move; the Space that follows starts a new grab
    // rather than committing the one that was given up.
    expect(chipIds()).toEqual(["status", "partner"])
  })
})

describe("a zone that could not honour a drop", () => {
  it("is not offered at all on a client table, where grouping is impossible", () => {
    render(<Harness mode="client" />)
    openPanel()

    expect(zone()).toBeNull()
    expect(screen.queryByRole("button", { name: "Group rows by Status" })).toBeNull()
    // The column list is still there — only the zone is missing.
    expect(panelHandle("status")).toBeInTheDocument()
  })

  it("refuses a drop carrying something that is not one of its columns", () => {
    const onQueryChange = vi.fn()
    render(<Harness onQueryChange={onQueryChange} />)
    openPanel()
    dragColumnIntoZone("status")

    const dataTransfer = makeDataTransfer()
    dataTransfer.setData("text/plain", "not-a-column")
    pointAt("drop", zone() as HTMLElement, "end", dataTransfer)

    expect(chipIds()).toEqual(["status"])
    expect(publishedGrouping(onQueryChange)).toEqual(["status"])
  })
})

describe("the group column's width", () => {
  it("floors the group column rather than inheriting a narrow one", () => {
    render(<Harness />)
    openPanel()

    const widthOf = (columnId: string): number => {
      const index = headerIds().indexOf(columnId)
      const col = document.querySelectorAll("colgroup col:not(.dt-col-filler)")[index]
      return Number.parseFloat((col as HTMLElement | undefined)?.style.width ?? "0")
    }

    // Status is declared at 90px — too narrow for a chevron, a value and a
    // count together.
    expect(widthOf("status")).toBe(90)
    dragColumnIntoZone("status")
    expect(widthOf("status")).toBe(200)

    // A second level indents the chevron one step further, so the floor moves.
    dragColumnIntoZone("partner")
    expect(widthOf("status")).toBe(218)

    // And the column is exactly as it was once the grouping goes.
    fireEvent.click(screen.getByRole("button", { name: "Clear grouping" }))
    expect(widthOf("status")).toBe(90)
  })

  it("lets the resizer take the group column back under the floor", () => {
    render(<Harness />)
    openPanel()
    dragColumnIntoZone("status")

    const handle = document.querySelector<HTMLElement>(
      'th[data-column-id="status"] .dt-resizer',
    )
    expect(handle).not.toBeNull()
    fireEvent.mouseDown(handle as HTMLElement, { clientX: 200 })
    fireEvent.mouseMove(document, { clientX: 120 })
    fireEvent.mouseUp(document, { clientX: 120 })

    const index = headerIds().indexOf("status")
    const col = document.querySelectorAll("colgroup col:not(.dt-col-filler)")[index]
    const width = Number.parseFloat((col as HTMLElement).style.width)
    // The user's own width stands: the floor applies only where nothing was said.
    expect(width).toBeLessThan(200)
  })
})

describe("where the group column sits", () => {
  it("leads the table, so the tree reads from the left edge", () => {
    render(<Harness />)
    openPanel()
    expect(headerIds()).toEqual(["name", "status", "partner"])

    dragColumnIntoZone("status")

    // Status is declared third. Grouped, it is first: the chevron, the value
    // and the count are at the left edge rather than floating in the middle
    // with two empty columns to their left.
    expect(headerIds()).toEqual(["status", "name", "partner"])
    expect(headerIds()[0]).toBe("status")
  })

  it("keeps leading when a second level is nested inside the first", () => {
    render(<Harness />)
    openPanel()

    dragColumnIntoZone("status")
    dragColumnIntoZone("partner")

    // The outermost level still holds the values, still first; the inner
    // level's column has left the body, as it does at any position.
    expect(headerIds()).toEqual(["status", "name"])
  })

  it("still sorts its own level from the header it kept", () => {
    render(<Harness />)
    openPanel()
    dragColumnIntoZone("status")

    // The point of moving the grouped column rather than replacing it with a
    // column of the table's own: the header travels with it.
    const header = screen.getByRole("columnheader", { name: /Status/ })
    expect(within(header).getByRole("img", { name: "Grouped" })).toBeInTheDocument()
    expect(within(header).getByRole("button", { name: /Sort ascending/ })).toBeInTheDocument()
  })

  it("leads the scrolling columns, not the pinned ones", () => {
    render(<Harness initialLayout={{ columnPinning: { start: ["name"], end: [] } }} />)
    openPanel()
    expect(headerIds()).toEqual(["name", "status", "partner"])

    dragColumnIntoZone("status")

    // A pinned column is frozen at the edge because the user asked for it to
    // be. The group column leads the section it is in, which is the scrolling
    // one — it does not pin itself on the way past.
    expect(headerIds()).toEqual(["name", "status", "partner"])
    expect(chipIds()).toEqual(["status"])
  })

  it("leads its own pinned section when the grouped column was pinned", () => {
    render(
      <Harness
        initialLayout={{
          columnPinning: { start: ["name", "partner"], end: [] },
          grouping: ["partner"],
        }}
      />,
    )
    // Partner is pinned second. Grouped, it leads the frozen block — and so
    // leads the table — without being unpinned.
    expect(headerIds()).toEqual(["partner", "name", "status"])
  })

  it("is not the user's to move or to hide while it is the group column", () => {
    render(<Harness />)
    openPanel()
    dragColumnIntoZone("status")

    // No handle: its position is derived from the grouping, so a drag could
    // only promise a move the next render would undo. The way to move it is
    // to take it out of the Row Groups zone.
    expect(
      document.querySelector('ul.dt-panel-list li[data-column-id="status"] .dt-drag-handle'),
    ).toBeNull()
    expect(document.querySelector('th[data-column-id="status"]')).not.toHaveAttribute(
      "draggable",
      "true",
    )
    // And the tick is offered but fixed: the group values need a slot.
    const checkbox = document.querySelector<HTMLInputElement>('#zone-col-status')
    expect(checkbox?.checked).toBe(true)
    expect(checkbox?.disabled).toBe(true)
  })
})
