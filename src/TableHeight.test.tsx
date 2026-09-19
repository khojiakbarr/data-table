import { createColumnHelper } from "@tanstack/react-table"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { localStorageLayout, pruneLayout } from "./core/persistence"
import { useDataTable, type DataTableFeatures, type DataTableInstance } from "./useDataTable"

/**
 * The grip that resizes the table's height.
 *
 * jsdom has no layout, so nothing here measures a rendered box. What is
 * checked is the decision: where a drag of N pixels lands, that the minimum
 * holds, how far one arrow press moves, that the value survives a round trip
 * through storage, and that `resetLayout` puts the `height` prop back.
 *
 * The one reading that does come from the DOM is the root's own rectangle,
 * which is where a drag starts when the user has not set a height yet. jsdom
 * answers 0 for every rect, so the tests that need a starting height stub it.
 */

interface Row {
  id: string
  name: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 120 })]
const data: Row[] = [
  { id: "r0", name: "Alpha" },
  { id: "r1", name: "Beta" },
]

/** `minTableHeight(40)`: 130px of chrome plus two default rows. */
const MIN_HEIGHT = 210

type Options = Partial<Parameters<typeof useDataTable<Row>>[0]>
type Props = Partial<Parameters<typeof DataTable<Row>>[0]>

let latest: DataTableInstance<Row> | null = null

function Table({ options = {}, props = {} }: { options?: Options; props?: Props }) {
  const instance = useDataTable<Row>({
    id: "height",
    columns,
    data,
    getRowId: (row) => row.id,
    ...options,
  })
  latest = instance
  return <DataTable instance={instance} virtualize={false} {...props} />
}

const grip = (): HTMLElement => screen.getByRole("button", { name: /Resize table height/ })
const root = (): HTMLElement => document.querySelector<HTMLElement>(".dt-root")!
const rootHeight = (): string => root().style.height

/**
 * Give `.dt-root` a rendered height, which is what a first drag starts from.
 *
 * Only the root: everything else keeps jsdom's all-zero rectangle, so a test
 * that reads a box it did not stub fails loudly instead of quietly measuring 0.
 */
function stubRootHeight(height: number): () => void {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function getRect(this: Element) {
    const rect = original.call(this)
    if (!this.classList.contains("dt-root")) return rect
    return { ...rect, height, toJSON: rect.toJSON } as DOMRect
  }
  return () => {
    Element.prototype.getBoundingClientRect = original
  }
}

/** One pointer gesture: press on the grip, move to `to`, release. */
function dragTo(from: number, to: number): void {
  fireEvent.mouseDown(grip(), { button: 0, clientY: from })
  fireEvent.mouseMove(document, { clientY: to })
  fireEvent.mouseUp(document)
}

let restoreRect: (() => void) | null = null

beforeEach(() => {
  localStorage.clear()
  latest = null
})
afterEach(() => {
  restoreRect?.()
  restoreRect = null
})

describe("dragging the grip", () => {
  it("resolves a drag of N pixels to the height it started at plus N", () => {
    restoreRect = stubRootHeight(400)
    render(<Table />)

    dragTo(500, 620)
    expect(rootHeight()).toBe("520px")
  })

  it("keeps following the pointer after the first move, from where the drag began", () => {
    // The gesture's baseline is the height at mousedown, not the height as of
    // the previous move: adding each delta to the current height would make a
    // drag accelerate away from the pointer.
    restoreRect = stubRootHeight(400)
    render(<Table />)

    fireEvent.mouseDown(grip(), { button: 0, clientY: 500 })
    fireEvent.mouseMove(document, { clientY: 560 })
    fireEvent.mouseMove(document, { clientY: 620 })
    fireEvent.mouseUp(document)
    expect(rootHeight()).toBe("520px")
  })

  it("holds at the minimum however far past it the pointer is dragged", () => {
    restoreRect = stubRootHeight(400)
    render(<Table />)

    dragTo(500, -2000)
    expect(rootHeight()).toBe(`${MIN_HEIGHT}px`)
  })

  it("stops resizing once the button is released", () => {
    restoreRect = stubRootHeight(400)
    render(<Table />)

    dragTo(500, 620)
    fireEvent.mouseMove(document, { clientY: 1200 })
    expect(rootHeight()).toBe("520px")
  })

  it("ignores a press of anything but the primary button", () => {
    restoreRect = stubRootHeight(400)
    render(<Table props={{ height: 400 }} />)

    fireEvent.mouseDown(grip(), { button: 2, clientY: 500 })
    fireEvent.mouseMove(document, { clientY: 900 })
    expect(rootHeight()).toBe("400px")
  })
})

describe("the keyboard path", () => {
  it("moves one row per arrow press and five with Shift held", () => {
    restoreRect = stubRootHeight(400)
    render(<Table />)

    // The first press starts from the rendered box, since nothing has been
    // stored yet; every later one starts from the stored value.
    fireEvent.keyDown(grip(), { key: "ArrowDown" })
    expect(rootHeight()).toBe("440px")

    fireEvent.keyDown(grip(), { key: "ArrowDown" })
    expect(rootHeight()).toBe("480px")

    fireEvent.keyDown(grip(), { key: "ArrowUp" })
    expect(rootHeight()).toBe("440px")

    fireEvent.keyDown(grip(), { key: "ArrowDown", shiftKey: true })
    expect(rootHeight()).toBe("640px")
  })

  it("steps by the table's own row height, not a fixed number of pixels", () => {
    restoreRect = stubRootHeight(400)
    render(<Table options={{ rowHeight: 64 }} />)

    fireEvent.keyDown(grip(), { key: "ArrowDown" })
    expect(rootHeight()).toBe("464px")
  })

  it("will not step below the minimum", () => {
    restoreRect = stubRootHeight(MIN_HEIGHT + 10)
    render(<Table />)

    fireEvent.keyDown(grip(), { key: "ArrowUp" })
    expect(rootHeight()).toBe(`${MIN_HEIGHT}px`)
  })

  it("announces the height it arrived at, politely", () => {
    restoreRect = stubRootHeight(400)
    const { container } = render(<Table />)
    const status = container.querySelector(".dt-grip ~ [role='status']")
    expect(status).toHaveAttribute("aria-live", "polite")
    // Empty until something happens: a live region has to be on the page
    // before its text changes, or the change is not announced at all.
    expect(status).toHaveTextContent("")

    fireEvent.keyDown(grip(), { key: "ArrowDown" })
    expect(status).toHaveTextContent("Table height 440 pixels")
  })

  it("leaves other keys to the browser", () => {
    restoreRect = stubRootHeight(400)
    render(<Table props={{ height: 400 }} />)

    fireEvent.keyDown(grip(), { key: "ArrowLeft" })
    fireEvent.keyDown(grip(), { key: "Enter" })
    expect(rootHeight()).toBe("400px")
  })
})

describe("the height prop and the grip", () => {
  it("renders the prop until the grip has moved, and the grip's height after", () => {
    render(<Table props={{ height: 500 }} />)
    expect(rootHeight()).toBe("500px")
    expect(latest?.tableHeight.value).toBeUndefined()

    fireEvent.keyDown(grip(), { key: "ArrowDown" })
    // Started from the prop's own rendered box, which jsdom measures as 0, so
    // the step lands on the minimum. What matters is that the prop no longer
    // decides: the override is what is on the root.
    expect(latest?.tableHeight.value).toBe(MIN_HEIGHT)
    expect(rootHeight()).toBe(`${MIN_HEIGHT}px`)
  })

  it("puts the prop back when the layout is reset", () => {
    restoreRect = stubRootHeight(400)
    render(<Table props={{ height: 500 }} />)

    fireEvent.keyDown(grip(), { key: "ArrowDown" })
    expect(rootHeight()).toBe("440px")

    act(() => latest!.resetLayout())
    expect(latest?.tableHeight.value).toBeUndefined()
    expect(rootHeight()).toBe("500px")
  })

  it("leaves the root unsized when neither the prop nor the grip has a height", () => {
    render(<Table />)
    expect(rootHeight()).toBe("")
  })

  it("offers no grip at all with the feature flag off", () => {
    render(<Table options={{ features: { heightGrip: false } }} props={{ height: 500 }} />)
    expect(screen.queryByRole("button", { name: /Resize table height/ })).not.toBeInTheDocument()
    expect(rootHeight()).toBe("500px")
  })
})

describe("the height in the saved layout", () => {
  it("survives a remount, the way a column width does", () => {
    restoreRect = stubRootHeight(400)
    const storage = localStorageLayout()
    const view = render(<Table options={{ storage }} props={{ height: 500 }} />)

    fireEvent.keyDown(grip(), { key: "ArrowDown", shiftKey: true })
    expect(rootHeight()).toBe("600px")

    view.unmount()
    render(<Table options={{ storage }} props={{ height: 500 }} />)
    expect(rootHeight()).toBe("600px")
  })

  it("makes the table customised, so a Reset control has something to undo", () => {
    restoreRect = stubRootHeight(400)
    render(<Table />)
    expect(latest?.isCustomised).toBe(false)

    fireEvent.keyDown(grip(), { key: "ArrowDown" })
    expect(latest?.isCustomised).toBe(true)
  })

  it("keeps a sane stored height and drops a malformed one", () => {
    // `pruneLayout` rebuilds from recognised keys, so `height` has to be one
    // of them or it would never come back from storage at all.
    expect(pruneLayout({ height: 640 }, ["name"]).height).toBe(640)
    for (const bad of [0, -1, Number.NaN, "tall" as unknown as number]) {
      expect(pruneLayout({ height: bad }, ["name"]).height).toBeUndefined()
    }
  })

  it("clamps a stored height that is under this table's minimum", () => {
    // Survives the prune — it is a positive finite number — but a table whose
    // rows are 64px tall cannot honour 120px. The clamp is applied where the
    // row height is known, not in the prune.
    const storage = localStorageLayout()
    storage.save("height", {
      ...emptyStoredLayout(),
      height: 120,
    })
    render(<Table options={{ storage, rowHeight: 64 }} />)
    // 130 + 2 * 64.
    expect(rootHeight()).toBe("258px")
  })
})

/** A layout with nothing in it, so a test can save one slice without the rest. */
function emptyStoredLayout() {
  return {
    columnOrder: [],
    columnVisibility: {},
    columnPinning: { start: [], end: [] },
    columnSizing: {},
    sorting: [],
    filters: [],
    search: "",
  }
}
