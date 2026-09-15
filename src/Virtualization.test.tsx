import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * jsdom lays nothing out. The virtualiser sizes its scroll element from
 * offsetWidth/offsetHeight, so those are stubbed for the viewport; scrolling
 * is the two inputs it reads — a scrollTop and a scroll event.
 */

interface Row {
  id: string
  name: string
}
const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 200 })]
const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }))

const VIEWPORT_PX = 300
const ROW_PX = 40

/** Give `.dt-viewport` a size; everything else stays 0 as in jsdom. */
function stubViewportSize() {
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains("dt-viewport") ? VIEWPORT_PX : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains("dt-viewport") ? 800 : 0
    },
  })
  return () => {
    // Deleting matters: jsdom may not define these at all, and a stub left on
    // the prototype would size every later suite's elements.
    if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height)
    else delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight
    if (width) Object.defineProperty(HTMLElement.prototype, "offsetWidth", width)
    else delete (HTMLElement.prototype as { offsetWidth?: unknown }).offsetWidth
  }
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function Table({
  count = 1000,
  virtualize = true,
  detail = false,
}: {
  count?: number
  virtualize?: boolean
  detail?: boolean
}) {
  const instance = useDataTable<Row>({
    id: "virt",
    columns,
    data: rows(count),
    getRowId: (r) => r.id,
    rowHeight: ROW_PX,
  })
  return (
    <DataTable
      instance={instance}
      height={VIEWPORT_PX}
      virtualize={virtualize}
      renderDetail={detail ? (row) => <div data-testid="detail">Detail {row.id}</div> : undefined}
    />
  )
}

const renderedRows = () => screen.getAllByRole("row").filter((r) => r.classList.contains("dt-tr"))
/** Spacer heights by position: a spacer is "top" when a data row follows it, "bottom" otherwise. */
const spacers = (container: HTMLElement) => {
  const result = { top: 0, bottom: 0 }
  for (const tr of container.querySelectorAll<HTMLElement>("tr.dt-spacer-row")) {
    const height = Number.parseFloat(tr.style.height)
    if (tr.nextElementSibling?.classList.contains("dt-tr")) result.top = height
    else result.bottom = height
  }
  return result
}
/**
 * The height the table claims the whole list has: both spacers plus the rows
 * in the DOM. It is the scrollbar, in other words — the only place an
 * off-screen row's height is observable.
 */
const totalHeight = (container: HTMLElement) => {
  const { top, bottom } = spacers(container)
  return renderedRows().reduce((sum, r) => sum + Number.parseFloat(r.style.height), top + bottom)
}
const scrollTo = (viewport: HTMLElement, top: number) => {
  Object.defineProperty(viewport, "scrollTop", { value: top, writable: true, configurable: true })
  fireEvent.scroll(viewport)
}

describe("row virtualisation", () => {
  let restore: () => void
  beforeEach(() => {
    localStorage.clear()
    restore = stubViewportSize()
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
  })
  afterEach(() => {
    restore()
    vi.unstubAllGlobals()
  })

  it("renders a window of rows and spacers that add up to the full height", () => {
    const { container } = render(<Table />)
    const visible = renderedRows()
    // 300px / 40px = 8 rows in view plus overscan; far fewer than 1000.
    expect(visible.length).toBeGreaterThanOrEqual(8)
    expect(visible.length).toBeLessThan(40)
    expect(visible[0]).toHaveTextContent("Row 0")

    const { top, bottom } = spacers(container)
    expect(top).toBe(0)
    expect(bottom).toBe(1000 * ROW_PX - visible.length * ROW_PX)
  })

  it("moves the window when the viewport scrolls", () => {
    const { container } = render(<Table />)
    const viewport = container.querySelector(".dt-viewport") as HTMLElement
    scrollTo(viewport, 20_000) // row 500

    const visible = renderedRows()
    expect(visible.some((r) => r.textContent?.includes("Row 500"))).toBe(true)
    expect(visible.some((r) => r.textContent?.includes("Row 0 "))).toBe(false)
    const { top, bottom } = spacers(container)
    expect(top + bottom + visible.length * ROW_PX).toBe(1000 * ROW_PX)
  })

  it("renders every row when virtualisation is off", () => {
    const { container } = render(<Table count={50} virtualize={false} />)
    expect(renderedRows()).toHaveLength(50)
    expect(container.querySelector("tr.dt-spacer-row")).toBeNull()
  })

  it("keeps stripe parity by row position, not DOM position", () => {
    const { container } = render(<Table />)
    const viewport = container.querySelector(".dt-viewport") as HTMLElement
    scrollTo(viewport, 20_000)
    const row501 = renderedRows().find((r) => r.textContent?.includes("Row 501")) as HTMLElement
    expect(row501.dataset.parity).toBe("odd")
  })

  it("gives an open detail panel its own measured item", async () => {
    const user = userEvent.setup()
    const { container } = render(<Table count={20} detail />)
    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)

    const detailRow = container.querySelector("tr.dt-detail-row") as HTMLElement
    expect(detailRow.dataset.index).toBe("1")
    expect(screen.getByTestId("detail")).toHaveTextContent("Detail r0")
  })

  it("renders the last row with no negative spacer at the very end", () => {
    const { container } = render(<Table />)
    const viewport = container.querySelector(".dt-viewport") as HTMLElement
    scrollTo(viewport, 1000 * ROW_PX)

    const visible = renderedRows()
    expect(visible.some((r) => r.textContent?.includes("Row 999"))).toBe(true)
    const { top, bottom } = spacers(container)
    expect(bottom).toBe(0)
    expect(top + visible.length * ROW_PX).toBe(1000 * ROW_PX)
  })

  it("estimates per-row heights from getRowHeight", () => {
    // Even ids are tall, odd ones short: 50 * 60 + 50 * 20 = 4000px in all.
    const getRowHeight = (row: Row) => (Number(row.id.slice(1)) % 2 ? 20 : 60)
    function Varied() {
      const instance = useDataTable<Row>({
        id: "vh",
        columns,
        data: rows(100),
        getRowId: (r) => r.id,
        rowHeight: ROW_PX,
        getRowHeight,
      })
      return <DataTable instance={instance} height={VIEWPORT_PX} />
    }
    const { container } = render(<Varied />)

    const visible = renderedRows()
    const heights = visible.map((r) => Number.parseFloat(r.style.height))
    expect(heights).not.toContain(Number.NaN)
    expect(new Set(heights)).toEqual(new Set([60, 20]))

    const { top, bottom } = spacers(container)
    const rendered = heights.reduce((sum, height) => sum + height, 0)
    expect(top + bottom + rendered).toBe(4000)
  })

  it("reports the full row count to assistive technology", () => {
    const { container } = render(<Table />)
    const table = container.querySelector("table.dt-table") as HTMLElement
    // 1000 rows plus the one header row; `aria-rowindex` counts both.
    expect(table.getAttribute("aria-rowcount")).toBe("1001")
    expect(renderedRows()[0]?.getAttribute("aria-rowindex")).toBe("2")

    const viewport = container.querySelector(".dt-viewport") as HTMLElement
    scrollTo(viewport, 20_000)
    const row500 = renderedRows().find((r) => r.textContent?.includes("Row 500"))
    expect(row500?.getAttribute("aria-rowindex")).toBe("502")
  })

  it("keeps the row-height function's identity out of the measurement pass", () => {
    /*
     * An inline arrow — the form the README shows — is a new function on every
     * host render. If that identity reaches the virtualiser's `getItemKey`,
     * every one of the 1000 rows is re-keyed and re-estimated for a render
     * that changed nothing about the rows.
     */
    const asked = (count: number) => {
      const data = rows(count)
      const measure = vi.fn((row: Row) => (Number(row.id.slice(1)) % 2 ? 20 : 60))
      function Host({ tick }: { tick: number }) {
        const instance = useDataTable<Row>({
          id: `churn${count}`,
          columns,
          data,
          getRowId: (r) => r.id,
          rowHeight: ROW_PX,
          getRowHeight: (row) => measure(row),
        })
        return (
          <>
            <span data-testid="tick">{tick}</span>
            <DataTable instance={instance} height={VIEWPORT_PX} />
          </>
        )
      }
      const { rerender } = render(<Host tick={0} />)
      measure.mockClear()
      rerender(<Host tick={1} />)
      rerender(<Host tick={2} />)
      return measure.mock.calls.length
    }
    // Only the rendered window may be consulted; a sweep would be 1000 a render.
    expect(asked(1000)).toBeLessThan(100)
    /*
     * The window plus the bounded sample, and nothing else: twenty times the
     * rows must cost exactly the same, which is the property a sweep breaks
     * and an absolute bound can only hint at.
     */
    expect(asked(20_000)).toBe(asked(1000))
  })

  it("re-estimates when the row-height function starts answering differently", () => {
    // The identity is no longer the signal, so a swapped height policy has to
    // be noticed from the rows on screen: same data, same `rowHeight`.
    const data = rows(100)
    const tall = (row: Row) => (row.id ? 60 : 60)
    const short = (row: Row) => (row.id ? 20 : 20)
    function Density({ compact }: { compact: boolean }) {
      const instance = useDataTable<Row>({
        id: "density",
        columns,
        data,
        getRowId: (r) => r.id,
        rowHeight: ROW_PX,
        getRowHeight: compact ? short : tall,
      })
      return <DataTable instance={instance} height={VIEWPORT_PX} />
    }
    const { container, rerender } = render(<Density compact={false} />)
    expect(totalHeight(container)).toBe(100 * 60)
    rerender(<Density compact />)
    expect(totalHeight(container)).toBe(100 * 20)
  })

  it("notices a height change that only affects rows off screen", () => {
    /*
     * The regression this pins: a 300px viewport shows rows 0..15, and the
     * policy below leaves every one of them at 40px. Only rows 50+ grow, so
     * the rendered window agrees with itself and the drift check that reads
     * only that window sees nothing — the scrollbar stayed at 4000px while
     * the truth was 6000px until the user scrolled into the changed region.
     *
     * Written inline, which is the form the README shows and the hard case:
     * a new arrow every render, so the height function's identity carries no
     * information and the bounded sample is the only thing that can notice.
     */
    const data = rows(100)
    function Region({ tall }: { tall: boolean }) {
      const instance = useDataTable<Row>({
        id: "offscreen",
        columns,
        data,
        getRowId: (r) => r.id,
        rowHeight: ROW_PX,
        getRowHeight: (row) => (tall && Number(row.id.slice(1)) >= 50 ? 80 : ROW_PX),
      })
      return <DataTable instance={instance} height={VIEWPORT_PX} />
    }
    const { container, rerender } = render(<Region tall={false} />)
    expect(totalHeight(container)).toBe(100 * ROW_PX)
    // Nothing on screen changed; the last 50 rows doubled.
    rerender(<Region tall />)
    expect(renderedRows().every((r) => Number.parseFloat(r.style.height) === ROW_PX)).toBe(true)
    expect(totalHeight(container)).toBe(50 * ROW_PX + 50 * 80)
  })

  it("leaves a change too narrow for the sample to the host's heightVersion", () => {
    /*
     * The documented edge of the sample, pinned so it cannot quietly become a
     * sweep: one row, off screen, between probes. Row 70 is neither among the
     * 16 evenly spaced probes over 100 items nor anywhere near the ~15 rows a
     * 300px viewport shows, so nothing the table does by itself can see it
     * grow — which is the whole reason `heightVersion` exists.
     */
    const data = rows(100)
    function Outlier({ big, version }: { big: boolean; version: number }) {
      const instance = useDataTable<Row>({
        id: "outlier",
        columns,
        data,
        getRowId: (r) => r.id,
        rowHeight: ROW_PX,
        getRowHeight: (row) => (big && row.id === "r70" ? 200 : ROW_PX),
        heightVersion: version,
      })
      return <DataTable instance={instance} height={VIEWPORT_PX} />
    }
    const { container, rerender } = render(<Outlier big={false} version={0} />)
    expect(totalHeight(container)).toBe(100 * ROW_PX)

    rerender(<Outlier big version={0} />)
    expect(totalHeight(container)).toBe(100 * ROW_PX)

    rerender(<Outlier big version={1} />)
    expect(totalHeight(container)).toBe(99 * ROW_PX + 200)
  })

  it("re-estimates when the row height changes", () => {
    function Resizable({ rowHeight }: { rowHeight: number }) {
      const instance = useDataTable<Row>({
        id: "rh",
        columns,
        data: rows(100),
        getRowId: (r) => r.id,
        rowHeight,
      })
      return <DataTable instance={instance} height={VIEWPORT_PX} />
    }
    const { container, rerender } = render(<Resizable rowHeight={40} />)
    const before = spacers(container).bottom + renderedRows().length * 40
    expect(before).toBe(4000)
    rerender(<Resizable rowHeight={20} />)
    expect(spacers(container).bottom + renderedRows().length * 20).toBe(2000)
  })
})

describe("before the viewport is measured", () => {
  beforeEach(() => localStorage.clear())

  it("renders a leading window instead of nothing", () => {
    // No size stub: offsetHeight is 0, as for a table mounted in a hidden container.
    const { container } = render(<Table count={1000} />)
    const visible = renderedRows()
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThanOrEqual(40)
    expect(visible[0]).toHaveTextContent("Row 0")
    expect(spacers(container).bottom).toBe((1000 - visible.length) * ROW_PX)
  })

  it("notices a height change with no rendered window to compare", () => {
    /*
     * The other half of the same blind spot. With no size there is no range,
     * so the check that read only the rendered items had nothing at all to
     * read: a table under a `display: none` ancestor, or a server render,
     * reported the old total for ever. The sample does not need a window.
     */
    const data = rows(100)
    function Region({ tall }: { tall: boolean }) {
      const instance = useDataTable<Row>({
        id: "hidden",
        columns,
        data,
        getRowId: (r) => r.id,
        rowHeight: ROW_PX,
        getRowHeight: (row) => (tall && Number(row.id.slice(1)) >= 50 ? 80 : ROW_PX),
      })
      return <DataTable instance={instance} height={VIEWPORT_PX} />
    }
    const { container, rerender } = render(<Region tall={false} />)
    expect(totalHeight(container)).toBe(100 * ROW_PX)
    rerender(<Region tall />)
    expect(totalHeight(container)).toBe(50 * ROW_PX + 50 * 80)
  })

  it("covers the whole page when the page is larger than the default window", () => {
    // Server-rendered HTML for a 50-row page must carry all 50 rows, not the
    // first 40: nothing has measured the viewport before hydration.
    function Paged() {
      const instance = useDataTable<Row>({
        id: "paged",
        columns,
        data: rows(1000),
        getRowId: (r) => r.id,
        rowHeight: ROW_PX,
        pagination: true,
      })
      return <DataTable instance={instance} height={VIEWPORT_PX} />
    }
    render(<Paged />)
    expect(renderedRows()).toHaveLength(50)
  })
})
