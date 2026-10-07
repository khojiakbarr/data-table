import { createColumnHelper } from "@tanstack/react-table"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import type { GroupRow } from "./core/grouping"
import { ROW_NUMBER_COLUMN_ID } from "./core/rowNumbers"
import { SELECTION_COLUMN_ID } from "./core/selection"
import { TIMELINE_COLUMN_ID, type TimelineItem, type TimelineMarker, type TimelineOptions } from "./core/timeline"
import { useDataTable, type DataTableFeatures } from "./useDataTable"
import type { DataTableFeatureFlags, LayoutStorage, RowTone, TableLayout } from "./types"

/**
 * The timeline pane, end to end: what the header prints, where each row's
 * items land, which interactions the column refuses, and that it stays out of
 * everything the host's own columns are part of.
 *
 * The scale is the prototype's: 31.08.2026 (a Monday) to 07.12.2026, 99 days.
 * At the week zoom a day is 14px, so an item's `left` is its day's offset × 14.
 */

interface Stage {
  id: string
  label: string
  items: TimelineItem[]
  tone?: RowTone
  children?: Stage[]
}

const plan = (start: string, end: string): TimelineItem => ({ kind: "bar", variant: "plan", start, end, title: `Plan ${start}` })
const actual = (start: string, end: string, progress: number, thick = false): TimelineItem => ({
  kind: "bar",
  variant: "actual",
  start,
  end,
  progress,
  tone: progress >= 100 ? "success" : "primary",
  size: thick ? "thick" : "regular",
})

const STAGES: Stage[] = [
  {
    id: "g-wh",
    label: "Склад",
    tone: "strong",
    items: [plan("2026-09-24", "2026-11-10"), actual("2026-09-24", "2026-09-29", 50, true)],
    children: [
      {
        id: "s-receipt",
        label: "Поступление",
        tone: "soft",
        // Listed overrun first: it is still drawn over the bar it overruns.
        items: [
          { kind: "bar", variant: "overrun", start: "2026-09-28", end: "2026-09-29" },
          plan("2026-09-24", "2026-09-27"),
          actual("2026-09-24", "2026-09-29", 100),
        ],
        children: [
          {
            id: "d-rc",
            label: "RC10005",
            items: [actual("2026-09-24", "2026-09-29", 100), { kind: "point", shape: "tick", date: "2026-09-27", title: "Срок 27.09" }],
          },
        ],
      },
    ],
  },
  {
    id: "g-acc",
    label: "Бухгалтерия",
    items: [
      // Starts before the pane and ends after it: cut on both sides, not lost.
      { kind: "bar", variant: "plan", start: "2026-08-01", end: "2027-01-31" },
      { kind: "point", shape: "dot", date: "2026-09-18", title: "Оплата 18.09" },
      // Wholly before the pane: nothing to draw.
      actual("2026-07-01", "2026-07-10", 100),
    ],
  },
]

const MARKERS: TimelineMarker[] = [
  { date: "2026-09-29", label: "Сегодня 29.09", tone: "danger", at: "middle" },
  { date: "2026-11-30", label: "Срок проекта 30.11", tone: "neutral", dashed: true, at: "end" },
]

const helper = createColumnHelper<DataTableFeatures, Stage>()
const columns = [helper.accessor("label", { header: "Stage", size: 200 })]

interface HarnessProps {
  zoom?: TimelineOptions<Stage>["zoom"]
  start?: string
  onItemClick?: TimelineOptions<Stage>["onItemClick"]
  onRowClick?: (row: Stage) => void
  storage?: LayoutStorage
  scrollTo?: string
  withTimeline?: boolean
  pinStage?: boolean
  getItems?: (row: Stage) => readonly TimelineItem[]
  features?: DataTableFeatureFlags
}

function Harness({
  zoom = "week",
  start = "2026-08-31",
  onItemClick,
  onRowClick,
  storage,
  scrollTo,
  withTimeline = true,
  pinStage = false,
  getItems = (row) => row.items,
  features,
}: HarnessProps) {
  const instance = useDataTable<Stage>({
    id: "timeline",
    columns,
    data: STAGES,
    getRowId: (row) => row.id,
    getSubRows: (row) => row.children,
    ...(storage ? { storage } : {}),
    ...(features ? { features } : {}),
    ...(pinStage ? { initialLayout: { columnPinning: { start: ["label"], end: [] } } } : {}),
    timeline: withTimeline
      ? {
          start,
          end: "2026-12-07",
          zoom,
          getItems,
          markers: MARKERS,
          ...(scrollTo ? { scrollTo } : {}),
          ...(onItemClick ? { onItemClick } : {}),
        }
      : undefined,
  })
  // Every row open, so each depth draws.
  if (!instance.table.getIsAllRowsExpanded()) instance.table.toggleAllRowsExpanded(true)
  return (
    <DataTable
      instance={instance}
      height={600}
      virtualize={false}
      getRowTone={(row) => row.tone}
      {...(onRowClick ? { onRowClick } : {})}
    />
  )
}

/** The timeline cell of the row whose Stage column reads `label`. */
const timelineRowOf = (label: string): HTMLElement => {
  const row = screen.getByText(label).closest("tr")
  if (!row) throw new Error(`no row ${label}`)
  const cell = row.querySelector<HTMLElement>(`td[data-column-id="${TIMELINE_COLUMN_ID}"] .dt-timeline-row`)
  if (!cell) throw new Error(`no timeline cell in ${label}`)
  return cell
}

const pane = (): HTMLTableCellElement => {
  const th = document.querySelector<HTMLTableCellElement>(`th[data-column-id="${TIMELINE_COLUMN_ID}"]`)
  if (!th) throw new Error("no timeline header")
  return th
}

type ObserverCallback = (entries: ResizeObserverEntry[]) => void

/** A ResizeObserver whose callbacks the test fires by hand. */
class ResizeObserverStub {
  static callbacks = new Set<ObserverCallback>()
  static fire() {
    for (const callback of ResizeObserverStub.callbacks) callback([])
  }
  private readonly callback: ObserverCallback
  constructor(callback: ObserverCallback) {
    this.callback = callback
  }
  observe() {
    ResizeObserverStub.callbacks.add(this.callback)
  }
  unobserve() {
    ResizeObserverStub.callbacks.delete(this.callback)
  }
  disconnect() {
    ResizeObserverStub.callbacks.delete(this.callback)
  }
}

afterEach(() => {
  ResizeObserverStub.callbacks.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("the timeline column", () => {
  it("trails the host's columns, as wide as its days × the day width", () => {
    const { rerender } = render(<Harness />)
    const cols = [...document.querySelectorAll("col[data-column-id]")]
    expect(cols.at(-1)?.getAttribute("data-column-id")).toBe(TIMELINE_COLUMN_ID)
    expect((cols.at(-1) as HTMLElement).style.width).toBe("1386px")

    rerender(<Harness zoom="day" />)
    expect(document.querySelector<HTMLElement>(`col[data-column-id="${TIMELINE_COLUMN_ID}"]`)?.style.width).toBe(`${99 * 30}px`)
  })

  it("stays after the checkbox and number columns, and a month's name clears them as they stay put", () => {
    render(<Harness features={{ selection: true, rowNumbers: true }} />)
    const cols = [...document.querySelectorAll<HTMLElement>("col[data-column-id]")]
    expect(cols.map((col) => col.getAttribute("data-column-id"))).toEqual([
      SELECTION_COLUMN_ID,
      ROW_NUMBER_COLUMN_ID,
      "label",
      TIMELINE_COLUMN_ID,
    ])
    const pinned = cols.slice(0, 2).reduce((sum, col) => sum + Number.parseFloat(col.style.width), 0)
    expect(pinned).toBeGreaterThan(0)
    expect(pane().querySelector<HTMLElement>(".dt-timeline-month-label")?.style.insetInlineStart).toBe(`${pinned}px`)
    // The row's chevron belongs to its first real column, never to the pane.
    expect(screen.getByText("Склад").closest("td")?.querySelector(".dt-expand")).not.toBeNull()
    expect(timelineRowOf("Склад").closest("td")?.querySelector(".dt-expand")).toBeNull()
  })

  it("is not drawn for a range it cannot read, and says so in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    render(<Harness start="2026-12-31" />)
    expect(document.querySelector(`col[data-column-id="${TIMELINE_COLUMN_ID}"]`)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("was not drawn"))
  })

  it("is none of the host's: no menu, no drag, no resize, and absent from the Columns panel", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const th = pane()
    expect(th.querySelector(".dt-kebab, .dt-resizer, .dt-sortable")).toBeNull()
    expect(th).not.toHaveAttribute("draggable", "true")

    await user.click(screen.getByRole("tab", { name: "Columns" }))
    const listed = [...document.querySelectorAll("li.dt-panel-item[data-column-id]")].map((item) => item.getAttribute("data-column-id"))
    expect(listed).toEqual(["label"])
  })

  it("never reaches the stored layout", async () => {
    const saved: TableLayout[] = []
    const storage: LayoutStorage = { load: () => null, save: (_id, layout) => void saved.push(layout), clear: () => undefined }
    render(<Harness storage={storage} />)
    // Any change saves the whole layout: widen the host's column from the keyboard.
    fireEvent.keyDown(screen.getByRole("button", { name: /Stage: resize column/ }), { key: "ArrowRight" })
    // Saves are debounced: wait for the one this change makes.
    await vi.waitFor(() => expect(saved.length).toBeGreaterThan(0))
    expect(saved.at(-1)?.columnSizing).toEqual({ label: 210 })
    expect(JSON.stringify(saved.at(-1))).not.toContain(TIMELINE_COLUMN_ID)
  })
})

describe("the scale", () => {
  it("names the months and the Mondays at the week zoom", () => {
    render(<Harness />)
    const scale = pane()
    expect(within(scale).getByText("Sep 2026")).toBeInTheDocument()
    expect(within(scale).getByText("Dec 2026")).toBeInTheDocument()
    const mondays = [...scale.querySelectorAll(".dt-timeline-day")].map((day) => day.textContent)
    expect(mondays.slice(0, 3)).toEqual(["31.08", "07.09", "14.09"])
    expect(mondays).toHaveLength(15)
  })

  it("numbers every day and marks the weekends at the day zoom, and draws only months at the month zoom", () => {
    const { rerender } = render(<Harness zoom="day" />)
    const days = [...pane().querySelectorAll(".dt-timeline-day")]
    expect(days).toHaveLength(99)
    expect(days[5]).toHaveClass("dt-timeline-weekend")
    expect(days[0]).not.toHaveClass("dt-timeline-weekend")

    rerender(<Harness zoom="month" />)
    expect(pane().querySelectorAll(".dt-timeline-day")).toHaveLength(0)
    expect(pane().querySelectorAll(".dt-timeline-month")).toHaveLength(5)
  })

  it("puts each marker's chip at its day and reads the markers in the column's name", () => {
    render(<Harness />)
    const today = within(pane()).getByText("Сегодня 29.09")
    expect(today.style.left).toBe(`${29 * 14 + 7}px`)
    expect(today).toHaveClass("dt-timeline-tone-danger")
    expect(within(pane()).getByText("Срок проекта 30.11").style.left).toBe(`${92 * 14}px`)
    expect(pane().querySelector(".dt-sr-only")).toHaveTextContent("Timeline: Сегодня 29.09, Срок проекта 30.11")
  })

  it("hides the date a marker's chip lies over, and only that one", () => {
    // jsdom lays nothing out: a date is as wide as 30px, a chip 80px, each where its style puts it.
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      return Number.parseFloat(this.style.left) || 0
    })
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("dt-timeline-chip") ? 80 : this.classList.contains("dt-timeline-day") ? 30 : 0
    })
    render(<Harness />)
    const covered = [...pane().querySelectorAll(".dt-timeline-day-covered")].map((day) => day.textContent)
    // «Сегодня 29.09» stands at 413px over 28.09 (392–422); «Срок проекта 30.11» at 1288px over 30.11 (1288–1318).
    expect(covered).toEqual(["28.09", "30.11"])
    expect(within(pane()).getByText("21.09")).not.toHaveClass("dt-timeline-day-covered")
  })

  it("hides a month's name while too little of its month is on screen to hold it", async () => {
    // jsdom lays nothing out: a month's name is 64px, the viewport 300px, and the pane moves with the scroll.
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("dt-timeline-month-label") ? 64 : 0
    })
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
      return this.classList.contains("dt-viewport") ? 300 : 0
    })
    const rect = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (!this.classList.contains("dt-timeline-scale")) return rect.call(this)
      const viewport = this.closest(".dt-viewport")
      return new DOMRect(-(viewport?.scrollLeft ?? 0), 0, 0, 0)
    })
    render(<Harness />)
    const name = (month: string) => within(pane()).getByText(month)
    // 31.08 is the range's one day of August: 14px, never room for its name. September has all of its 420px.
    expect(name("Aug 2026")).toHaveAttribute("data-dt-cut")
    expect(name("Sep 2026")).not.toHaveAttribute("data-dt-cut")

    // Scrolled until 40px of September is left on screen: its name goes, October's stays.
    const viewport = document.querySelector<HTMLElement>(".dt-viewport")!
    viewport.scrollLeft = 394
    fireEvent.scroll(viewport)
    await vi.waitFor(() => expect(name("Sep 2026")).toHaveAttribute("data-dt-cut"))
    expect(name("Oct 2026")).not.toHaveAttribute("data-dt-cut")
  })

  it("keeps a month's name past the pinned columns while its month scrolls under them", () => {
    render(<Harness pinStage />)
    const label = pane().querySelector<HTMLElement>(".dt-timeline-month-label")
    expect(label?.style.insetInlineStart).toBe("200px")
  })
})

describe("a row on the timeline", () => {
  it("draws a plan, the work done filled to its progress, and a thick bar for a row that sums others", () => {
    render(<Harness />)
    const row = timelineRowOf("Склад")
    const [planBar, actual] = [...row.querySelectorAll<HTMLElement>(".dt-timeline-bar")]
    expect(planBar).toHaveClass("dt-timeline-plan")
    expect(planBar?.style.left).toBe(`${24 * 14}px`)
    expect(planBar?.style.width).toBe(`${48 * 14}px`)
    expect(actual).toHaveClass("dt-timeline-actual", "dt-timeline-thick", "dt-timeline-tone-primary")
    expect(actual?.querySelector<HTMLElement>(".dt-timeline-progress")?.style.width).toBe("50%")
  })

  it("draws done work whole, and the overrun over it whatever order the host listed them in", () => {
    render(<Harness />)
    const bars = [...timelineRowOf("Поступление").querySelectorAll(".dt-timeline-bar")]
    expect(bars.map((bar) => [...bar.classList].find((name) => /^dt-timeline-(plan|actual|overrun)$/.test(name)))).toEqual([
      "dt-timeline-plan",
      "dt-timeline-actual",
      "dt-timeline-overrun",
    ])
    expect(bars[1]).toHaveClass("dt-timeline-tone-success")
    expect(bars[1]?.querySelector(".dt-timeline-progress")).toBeNull()
  })

  it("cuts a bar at the pane's edges, places a dot mid-day and a tick at day's end, and drops what is off the pane", () => {
    render(<Harness />)
    const accounting = timelineRowOf("Бухгалтерия")
    const cut = accounting.querySelector<HTMLElement>(".dt-timeline-plan")
    expect(cut).toHaveClass("dt-timeline-clip-start", "dt-timeline-clip-end")
    expect([cut?.style.left, cut?.style.width]).toEqual(["0px", "1386px"])
    expect(accounting.querySelectorAll(".dt-timeline-actual")).toHaveLength(0)
    expect(accounting.querySelector<HTMLElement>(".dt-timeline-dot")?.style.left).toBe(`${18 * 14 + 7}px`)
    expect(timelineRowOf("RC10005").querySelector<HTMLElement>(".dt-timeline-tick")?.style.left).toBe(`${28 * 14}px`)
  })

  it("says, once in development, an item whose days are not days — and nothing of one that is merely off the pane", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const broken: TimelineItem[] = [
      { kind: "bar", variant: "plan", start: "29.09.2026", end: "2026-10-01" },
      { kind: "bar", variant: "actual", start: "2026-10-05", end: "2026-10-01" },
      { kind: "point", shape: "dot", date: "2026-02-30" },
    ]
    render(<Harness getItems={(row) => (row.id === "g-acc" ? [...row.items, ...broken] : row.items)} />)
    const said = warn.mock.calls.map(([message]) => String(message))
    expect(said.filter((message) => message.includes("is not drawn"))).toEqual([
      expect.stringContaining('"29.09.2026" – "2026-10-01"'),
      expect.stringContaining('"2026-10-05" – "2026-10-01"'),
      expect.stringContaining('"2026-02-30"'),
    ])
    // Бухгалтерия's July bar lies wholly before the pane: not drawn, and not a mistake.
    expect(said.join(" ")).not.toContain("2026-07-01")
    expect(timelineRowOf("Бухгалтерия").querySelectorAll(".dt-timeline-item")).toHaveLength(2)
  })

  it("draws each marker's line on every row, dashed for a limit", () => {
    render(<Harness />)
    for (const label of ["Склад", "Поступление", "RC10005", "Бухгалтерия"]) {
      const lines = [...timelineRowOf(label).querySelectorAll<HTMLElement>(".dt-timeline-marker")]
      expect(lines.map((line) => line.style.left)).toEqual([`${29 * 14 + 7}px`, `${92 * 14}px`])
      expect(lines[1]).toHaveClass("dt-timeline-marker-dashed", "dt-timeline-tone-neutral")
    }
  })

  it("is one picture named by its items' titles, or hidden when they have none", () => {
    render(<Harness />)
    expect(timelineRowOf("RC10005")).toHaveAttribute("role", "img")
    expect(timelineRowOf("RC10005")).toHaveAttribute("aria-label", "Срок 27.09")
    expect(timelineRowOf("Склад")).toHaveAttribute("aria-label", "Plan 2026-09-24")
    expect(screen.queryAllByRole("button", { name: /Plan|Срок|Оплата/ })).toHaveLength(0)
  })

  it("makes every item a button with onItemClick, and the click is the item's, not the row's", async () => {
    // The untitled-button warning is asserted here rather than in a test of its
    // own: `warnOnce` is process-wide, so a second mount with `onItemClick` in
    // this file would find it already said and assert on nothing.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const user = userEvent.setup()
    const onItemClick = vi.fn()
    const onRowClick = vi.fn()
    render(<Harness onItemClick={onItemClick} onRowClick={onRowClick} />)
    expect(timelineRowOf("RC10005")).not.toHaveAttribute("role")
    // The actual bars carry no title, so each is a button with no name — said once.
    expect(warn.mock.calls.filter(([message]) => String(message).includes("a button with no name"))).toHaveLength(1)

    await user.click(screen.getByRole("button", { name: "Оплата 18.09" }))
    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ kind: "point", date: "2026-09-18" }), STAGES[1])
    expect(onRowClick).not.toHaveBeenCalled()
  })
})

describe("row tones", () => {
  it("marks each record's row with the tone the host gives it", () => {
    render(<Harness />)
    expect(screen.getByText("Склад").closest("tr")).toHaveAttribute("data-dt-tone", "strong")
    expect(screen.getByText("Поступление").closest("tr")).toHaveAttribute("data-dt-tone", "soft")
    expect(screen.getByText("RC10005").closest("tr")).not.toHaveAttribute("data-dt-tone")
  })
})

describe("scrollTo", () => {
  it("brings the day into view when the pane appears, and not again on an ordinary render", () => {
    const { rerender } = render(<Harness scrollTo="2026-09-29" />)
    const viewport = document.querySelector<HTMLElement>(".dt-viewport")
    if (!viewport) throw new Error("no viewport")
    // jsdom lays nothing out, so the pane starts at 0 and nothing is pinned: the day's own x.
    expect(viewport.scrollLeft).toBe(29 * 14 + 7)

    viewport.scrollLeft = 5
    rerender(<Harness scrollTo="2026-09-29" />)
    expect(viewport.scrollLeft).toBe(5)

    // Back to 0 first: in jsdom a rect does not move with the scroll, so the pane would read as 5px further in.
    viewport.scrollLeft = 0
    rerender(<Harness scrollTo="2026-09-29" zoom="day" />)
    expect(viewport.scrollLeft).toBe(29 * 30 + 15)
  })

  it("waits for the viewport's first width, scrolls once it has one, then stops listening", () => {
    let width = 0
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
      return this.classList.contains("dt-viewport") ? width : 0
    })
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    render(<Harness scrollTo="2026-09-29" />)
    const viewport = document.querySelector<HTMLElement>(".dt-viewport")
    if (!viewport) throw new Error("no viewport")
    // No width yet: the day would land at the pane's very edge, so nothing moves.
    expect(viewport.scrollLeft).toBe(0)
    act(() => ResizeObserverStub.fire())
    expect(viewport.scrollLeft).toBe(0)

    width = 600
    act(() => ResizeObserverStub.fire())
    // A third of the way into 600px of visible pane: 413 − 200.
    expect(viewport.scrollLeft).toBe(29 * 14 + 7 - 600 / 3)

    // Done: a later resize leaves the user's own scroll alone.
    viewport.scrollLeft = 50
    width = 900
    act(() => ResizeObserverStub.fire())
    expect(viewport.scrollLeft).toBe(50)
  })
})

interface Leaf {
  id: string
  name: string
  status: string
}

const leafHelper = createColumnHelper<DataTableFeatures, Leaf>()
const leafColumns = [
  leafHelper.accessor("name", { header: "Name", size: 120 }),
  leafHelper.accessor("status", { header: "Status", size: 120 }),
]
const groupOf = (status: string, count: number): GroupRow => ({ kind: "group", path: [status], count })
const leafOf = (index: number): Leaf => ({ id: `r${index}`, name: `Row ${index}`, status: "open" })

/** A server-grouped page — one open group, its two records, a closed sibling — on the pane. */
function GroupedHarness({ getItems }: { getItems: (row: Leaf) => readonly TimelineItem[] }) {
  const instance = useDataTable<Leaf>({
    id: "timeline-grouped",
    columns: leafColumns,
    data: [groupOf("open", 2), leafOf(0), leafOf(1), groupOf("closed", 5)],
    mode: "server",
    rowCount: 4,
    getRowId: (row) => row.id,
    initialLayout: { grouping: ["status"], expanded: [["open"]] },
    timeline: { start: "2026-08-31", end: "2026-12-07", zoom: "week", getItems, markers: MARKERS },
  })
  return <DataTable instance={instance} virtualize={false} />
}

describe("a server-grouped page on the timeline", () => {
  it("keeps the grid and the markers across a group's header, and asks for items only for records", () => {
    const getItems = vi.fn((row: Leaf): readonly TimelineItem[] => [plan("2026-09-01", "2026-09-05"), { ...plan("2026-09-07", "2026-09-07"), title: row.name }])
    render(<GroupedHarness getItems={getItems} />)
    const rows = [...document.querySelectorAll<HTMLTableRowElement>("tbody tr.dt-tr")]
    const drawingOf = (row: HTMLTableRowElement) => row.querySelector<HTMLElement>(`td[data-column-id="${TIMELINE_COLUMN_ID}"] .dt-timeline-row`)

    const [open, first, , closed] = rows
    for (const group of [open, closed]) {
      expect(group).toHaveClass("dt-group-row")
      const drawing = drawingOf(group!)
      expect(drawing).toHaveAttribute("aria-hidden", "true")
      expect(drawing?.querySelectorAll(".dt-timeline-marker")).toHaveLength(2)
      expect(drawing?.querySelectorAll(".dt-timeline-item")).toHaveLength(0)
    }
    expect(drawingOf(first!)?.querySelectorAll(".dt-timeline-item")).toHaveLength(2)
    expect(getItems.mock.calls.map(([row]) => row.id)).not.toContain(undefined)
    expect(new Set(getItems.mock.calls.map(([row]) => row.id))).toEqual(new Set(["r0", "r1"]))
  })
})
