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
    if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height)
    if (width) Object.defineProperty(HTMLElement.prototype, "offsetWidth", width)
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
  for (const tr of container.querySelectorAll<HTMLElement>("tr.dt-spacer")) {
    const height = Number.parseFloat(tr.style.height)
    if (tr.nextElementSibling?.classList.contains("dt-tr")) result.top = height
    else result.bottom = height
  }
  return result
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
    expect(container.querySelector("tr.dt-spacer")).toBeNull()
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
})
