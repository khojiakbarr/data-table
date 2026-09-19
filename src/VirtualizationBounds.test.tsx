import { createColumnHelper } from "@tanstack/react-table"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * Whether a table is bounded is a layout fact, and jsdom lays nothing out, so
 * the readings the detection is made of are stubbed for `.dt-viewport`: equal
 * when the box has grown to fit its rows (nothing to scroll), far apart when
 * somebody gave it a height.
 */

interface Row {
  id: string
  name: string
}
const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 200 })]
const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }))

/** Sizes of the stubbed scroll box, in pixels. */
interface BoxSizes {
  client: number
  scroll: number
}
/** A stubbed scroll box: resizable, like the real one, and restorable. */
interface ScrollBox {
  resize: (next: BoxSizes) => void
  restore: () => void
}
const SIZED = ["clientHeight", "scrollHeight", "offsetHeight"] as const

/**
 * Size `.dt-viewport`'s scroll box; everything else stays 0 as in jsdom.
 *
 * `offsetHeight` is the box itself, which is what the virtualiser measures,
 * and it goes with `clientHeight`: a box that grew to its rows measures as
 * tall as its rows, which is the whole defect.
 */
function stubScrollBox(initial: BoxSizes): ScrollBox {
  const saved = SIZED.map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  )
  let sizes = initial
  const value = { clientHeight: () => sizes.client, scrollHeight: () => sizes.scroll, offsetHeight: () => sizes.client }
  for (const name of SIZED) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains("dt-viewport") ? value[name]() : 0
      },
    })
  }
  return {
    resize: (next) => {
      sizes = next
    },
    restore: () => {
      for (const [name, descriptor] of saved) {
        // Deleting matters: jsdom may not define these at all, and a stub left
        // on the prototype would size every later suite's elements.
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
        else delete (HTMLElement.prototype as Partial<Record<typeof name, unknown>>)[name]
      }
    },
  }
}

/**
 * A ResizeObserver whose callbacks the test fires by hand.
 *
 * Fired with no entries, which is what the virtualiser's own observer treats
 * as "ask the element itself" — the stubbed box sizes above.
 */
type ObserverCallback = (entries: ResizeObserverEntry[]) => void
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

function Table({
  count,
  virtualize = true,
  height,
}: {
  count: number
  virtualize?: boolean
  height?: number
}) {
  const instance = useDataTable<Row>({
    id: "bounds",
    columns,
    data: rows(count),
    getRowId: (r) => r.id,
  })
  return (
    <DataTable instance={instance} virtualize={virtualize} {...(height === undefined ? {} : { height })} />
  )
}

const bounded = (container: HTMLElement) =>
  container.querySelector(".dt-viewport[data-dt-unbounded]") !== null
const renderedRows = () => screen.getAllByRole("row").filter((r) => r.classList.contains("dt-tr"))

describe("a viewport nobody gave a height", () => {
  let box: ScrollBox | null = null
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    localStorage.clear()
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  })
  afterEach(() => {
    box?.restore()
    box = null
    ResizeObserverStub.callbacks.clear()
    vi.unstubAllGlobals()
    warn.mockRestore()
  })

  it("asks for the fallback bound, once, and says so", () => {
    // A box as tall as its 1000 rows: `overflow: auto` has nothing to clip.
    box = stubScrollBox({ client: 40_000, scroll: 40_000 })
    const { container, rerender } = render(<Table count={1000} />)

    /*
     * The defect itself: with nothing to clip, the measured viewport is as
     * tall as the list and the "window" is every row. jsdom applies no
     * stylesheet, so the attribute below is as far as the correction can be
     * followed here — in a browser it is what gives the box a height, and the
     * window then covers the height instead of the list.
     */
    expect(renderedRows()).toHaveLength(1000)
    expect(bounded(container)).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/no height of its own/)

    // The bound is what makes the viewport scroll, so it has to stick.
    rerender(<Table count={1000} />)
    expect(bounded(container)).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("leaves a table that already scrolls alone", () => {
    box = stubScrollBox({ client: 300, scroll: 40_000 })
    const { container } = render(<Table count={1000} />)
    expect(renderedRows().length).toBeLessThan(40)
    expect(bounded(container)).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it("leaves a short table in a tall box alone", () => {
    // Nothing to scroll here either, but 20 rows in the DOM is the point of a
    // table that size, not a runaway.
    box = stubScrollBox({ client: 4000, scroll: 4000 })
    const { container } = render(<Table count={20} />)
    expect(bounded(container)).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it("leaves a table alone that asked for every row", () => {
    box = stubScrollBox({ client: 40_000, scroll: 40_000 })
    const { container } = render(<Table count={1000} virtualize={false} />)
    expect(bounded(container)).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it("leaves a table nothing has laid out alone", () => {
    // Every reading is 0, as under a `display: none` ancestor. There is no
    // height to be missing yet.
    box = stubScrollBox({ client: 0, scroll: 0 })
    const { container } = render(<Table count={1000} />)
    expect(bounded(container)).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it("leaves a table the height prop already bounds alone", () => {
    // The readings say "nothing scrolls", but a height was given: the rescue
    // is for a table nobody bounded, and clipping this one to 70vh would
    // override the host's own layout.
    box = stubScrollBox({ client: 40_000, scroll: 40_000 })
    const { container } = render(<Table count={1000} height={600} />)
    expect(bounded(container)).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it("gives up the fallback bound once the grip has given the table a height", () => {
    /*
     * The misfire the grip could cause. This table really was unbounded, so
     * the rescue latched — and the latch never clears. Dragging the grip then
     * makes the table short, which is a height like any other: leaving
     * `--dt-viewport-max-height` on top of it would clip the viewport to 70vh
     * while the root stood at whatever the user dragged, and the rows would
     * stop short of the bottom edge.
     */
    box = stubScrollBox({ client: 40_000, scroll: 40_000 })
    const { container } = render(<Table count={1000} />)
    expect(bounded(container)).toBe(true)

    fireEvent.keyDown(screen.getByRole("button", { name: /Resize table height/ }), {
      key: "ArrowDown",
    })
    expect(container.querySelector<HTMLElement>(".dt-root")?.style.height).not.toBe("")
    expect(bounded(container)).toBe(false)
  })

  it("notices one revealed later, which gets no render of its own", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    box = stubScrollBox({ client: 0, scroll: 0 })
    const { container } = render(<Table count={1000} />)
    expect(bounded(container)).toBe(false)

    box.resize({ client: 40_000, scroll: 40_000 })
    act(() => ResizeObserverStub.fire())
    expect(bounded(container)).toBe(true)
  })
})
