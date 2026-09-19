import { render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDebouncedSave } from "./useDebouncedSave"
import type { LayoutStorage, TableLayout } from "../types"

/**
 * Persistence must not run on every frame.
 *
 * Column resizing updates state on each pointer move, so a single drag is
 * roughly sixty state changes. Writing through on each one means sixty
 * `JSON.stringify` calls and sixty synchronous `localStorage` writes — enough
 * to make the column judder under the cursor, and far worse when the adapter
 * talks to a server.
 */

const layoutAt = (width: number): TableLayout => ({
  columnOrder: [],
  columnVisibility: {},
  columnPinning: { start: [], end: [] },
  columnSizing: { a: width },
  sorting: [],
  filters: [],
  search: "",
})

function makeStorage() {
  const saves: TableLayout[] = []
  const storage: LayoutStorage = {
    load: () => null,
    save: (_id, layout) => void saves.push(layout),
    clear: () => undefined,
  }
  return { storage, saves }
}

function Harness({
  storage,
  layout,
  enabled = true,
}: {
  storage: LayoutStorage
  layout: TableLayout
  enabled?: boolean
}) {
  useDebouncedSave(storage, "t", layout, enabled)
  return null
}

describe("useDebouncedSave", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("writes nothing while changes keep arriving", () => {
    const { storage, saves } = makeStorage()
    const view = render(<Harness storage={storage} layout={layoutAt(100)} />)

    for (let width = 101; width <= 160; width += 1) {
      view.rerender(<Harness storage={storage} layout={layoutAt(width)} />)
      vi.advanceTimersByTime(16) // one frame
    }

    expect(saves).toHaveLength(0)
  })

  it("writes once the changes stop, with the settled value", () => {
    const { storage, saves } = makeStorage()
    const view = render(<Harness storage={storage} layout={layoutAt(100)} />)

    view.rerender(<Harness storage={storage} layout={layoutAt(180)} />)
    vi.advanceTimersByTime(400)

    expect(saves).toHaveLength(1)
    expect(saves[0]?.columnSizing).toEqual({ a: 180 })
  })

  it("writes nothing while disabled", () => {
    const { storage, saves } = makeStorage()
    render(<Harness storage={storage} layout={layoutAt(100)} enabled={false} />)
    vi.advanceTimersByTime(400)

    expect(saves).toHaveLength(0)
  })

  it("flushes a pending write when the table unmounts", () => {
    const { storage, saves } = makeStorage()
    const view = render(<Harness storage={storage} layout={layoutAt(100)} />)

    view.rerender(<Harness storage={storage} layout={layoutAt(240)} />)
    vi.advanceTimersByTime(50) // still inside the debounce window
    expect(saves).toHaveLength(0)

    view.unmount()
    expect(saves).toHaveLength(1)
    expect(saves[0]?.columnSizing).toEqual({ a: 240 })
  })

  it("keeps waiting through re-renders that only swap the adapter object", () => {
    // The documented usage builds the adapter inline, so every render of the
    // host passes a new object. That must not restart the wait.
    const saves: TableLayout[] = []
    const adapter = (): LayoutStorage => ({
      load: () => null,
      save: (_id, layout) => void saves.push(layout),
      clear: () => undefined,
    })
    const view = render(<Harness storage={adapter()} layout={layoutAt(100)} />)
    const changed = layoutAt(180)

    view.rerender(<Harness storage={adapter()} layout={changed} />)
    for (let tick = 0; tick < 5; tick += 1) {
      vi.advanceTimersByTime(100)
      view.rerender(<Harness storage={adapter()} layout={changed} />)
    }

    expect(saves).toHaveLength(1)
    expect(saves[0]?.columnSizing).toEqual({ a: 180 })
  })

  it("forgets a pending write when it is disabled, instead of flushing it", () => {
    const { storage, saves } = makeStorage()
    const view = render(<Harness storage={storage} layout={layoutAt(100)} />)

    view.rerender(<Harness storage={storage} layout={layoutAt(180)} />)
    // A reset inside the window: the reset layout is not a user change.
    view.rerender(<Harness storage={storage} layout={layoutAt(100)} enabled={false} />)
    vi.advanceTimersByTime(400)
    view.unmount()

    expect(saves).toHaveLength(0)
  })

  it("flushes when the page is hidden", () => {
    const { storage, saves } = makeStorage()
    const view = render(<Harness storage={storage} layout={layoutAt(100)} />)

    view.rerender(<Harness storage={storage} layout={layoutAt(180)} />)
    window.dispatchEvent(new Event("pagehide"))

    expect(saves).toHaveLength(1)
    expect(saves[0]?.columnSizing).toEqual({ a: 180 })
  })

  it("collapses a whole drag into a single write", () => {
    const { storage, saves } = makeStorage()
    const view = render(<Harness storage={storage} layout={layoutAt(100)} />)

    // 60 frames of dragging, then the pointer is released.
    for (let width = 101; width <= 160; width += 1) {
      view.rerender(<Harness storage={storage} layout={layoutAt(width)} />)
      vi.advanceTimersByTime(16)
    }
    vi.advanceTimersByTime(400)

    expect(saves).toHaveLength(1)
    expect(saves[0]?.columnSizing).toEqual({ a: 160 })
  })
})
