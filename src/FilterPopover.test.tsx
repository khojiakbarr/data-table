import { createColumnHelper } from "@tanstack/react-table"
import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable, defaultLabels } from "./components/DataTable"
import { FilterPopover } from "./components/FilterPopover"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * The header menu's "Filter…" item and the popover it opens.
 *
 * The menu is left a real `role="menu"` with no form controls in it — see
 * §8.2 — so everything below goes through the item, not through the menu.
 */

interface Row {
  id: string
  name: string
  amount: number
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 100 }),
  helper.accessor("amount", { header: "Amount", size: 100 }),
  helper.accessor("id", { header: "Id", size: 100, meta: { filter: false } }),
]
const data: Row[] = [
  { id: "r0", name: "Agro Ltd", amount: 15 },
  { id: "r1", name: "Temir", amount: 500 },
]

function Table() {
  const instance = useDataTable<Row>({ id: "popover", columns, data, getRowId: (row) => row.id })
  return <DataTable instance={instance} virtualize={false} />
}

/** The same table with filtering turned off table-wide. */
function Unfiltered() {
  const instance = useDataTable<Row>({
    id: "unfiltered",
    columns,
    data,
    getRowId: (row) => row.id,
    filtering: false,
  })
  return <DataTable instance={instance} virtualize={false} />
}

const shown = () => screen.getAllByRole("row").filter((row) => row.classList.contains("dt-tr"))

/** Open a column's menu and choose its Filter… item. */
const openFilter = async (columnName: string) => {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: `${columnName}: Column actions` }))
  await user.click(screen.getByRole("menuitem", { name: "Filter…" }))
  return user
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

function LonePopover({ measure }: { measure: () => DOMRect }) {
  const instance = useDataTable<Row>({ id: "lone", columns, data, getRowId: (row) => row.id })
  return (
    <FilterPopover
      instance={instance}
      column={instance.table.getColumn("name")!}
      position={{ x: 120, y: 700 }}
      labels={defaultLabels}
      onClose={() => undefined}
      measure={measure}
    />
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  ResizeObserverStub.callbacks.clear()
  vi.unstubAllGlobals()
})

describe("the column filter popover", () => {
  it("opens from the menu, closes the menu, and renders beside it under .dt-root", async () => {
    const { container } = render(<Table />)
    await openFilter("Name")

    expect(screen.queryByRole("menu")).toBeNull()
    const popover = screen.getByRole("dialog", { name: "Filter Name" })
    // A direct child of `.dt-root`, like the panel and the menu: that is what
    // the `:has()` z-index lift selects on.
    expect(popover.parentElement).toBe(container.querySelector(".dt-root"))
    expect(popover.className).toBe("dt-filter-popover")
  })

  it("commits on Apply and closes", async () => {
    render(<Table />)
    const user = await openFilter("Name")

    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(shown()).toHaveLength(1)
  })

  it("discards the draft on Escape and gives focus back to the column's button", async () => {
    render(<Table />)
    await openFilter("Name")
    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })

    fireEvent.keyDown(document, { key: "Escape" })

    expect(screen.queryByRole("dialog")).toBeNull()
    // Nothing was committed: a draft is discarded or applied, never synced.
    expect(shown()).toHaveLength(2)
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Name: Column actions" }),
    )
  })

  it("keeps Tab inside itself", async () => {
    render(<Table />)
    await openFilter("Name")

    const apply = screen.getByRole("button", { name: "Apply" })
    apply.focus()
    fireEvent.keyDown(apply, { key: "Tab" })

    expect(document.activeElement).toBe(screen.getByLabelText("Name: Operator"))
  })

  it("re-clamps when its own content resizes it", () => {
    // Switching operator changes the popover's height, long after the clamp's
    // layout effect has run. jsdom reports every rect as zeros, so the height
    // is injected rather than laid out.
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    let tall = false
    const rect = (height: number): DOMRect => new DOMRect(0, 0, 200, height)
    render(<LonePopover measure={() => rect(tall ? 400 : 100)} />)

    const popover = screen.getByRole("dialog", { name: "Filter Name" })
    expect(popover.style.top).toBe("660px")

    tall = true
    act(() => ResizeObserverStub.fire())

    expect(popover.style.top).toBe("360px")
  })

  it("marks a filtered column in its header", async () => {
    render(<Table />)
    const user = await openFilter("Name")
    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })
    await user.click(screen.getByRole("button", { name: "Apply" }))

    const marker = screen.getByRole("img", { name: "Filtered" })
    expect(marker.closest("th")).toBe(screen.getByRole("columnheader", { name: /name/i }))
  })

  it("offers no Filter… item for a column whose host turned filtering off", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(screen.getByRole("button", { name: "Id: Column actions" }))

    expect(screen.queryByRole("menuitem", { name: "Filter…" })).toBeNull()
  })

  it("offers no Filter… item at all on a table with filtering off", async () => {
    // The table-wide gate, which the per-column one above says nothing about:
    // `canFilterColumn` reads `instance.filtering.enabled` too, and the menu
    // must not offer a route to an editor that would refuse to render.
    const user = userEvent.setup()
    render(<Unfiltered />)
    await user.click(screen.getByRole("button", { name: "Name: Column actions" }))

    expect(screen.queryByRole("menuitem", { name: "Filter…" })).toBeNull()
  })

  it("does not offer the panel route until a shell passes one", async () => {
    // `onOpenFilterInPanel` is declared and rendered by HeaderMenu, but
    // nothing hands it in until Task 17 teaches the panel about tabs. An item
    // that opened a tab which does not exist yet would be a dead end.
    const user = userEvent.setup()
    render(<Table />)
    await user.click(screen.getByRole("button", { name: "Name: Column actions" }))

    expect(screen.queryByRole("menuitem", { name: "Filter in panel…" })).toBeNull()
  })

  it("is what the menu's own autofocus lands on", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(screen.getByRole("button", { name: "Name: Column actions" }))

    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Filter…" }))
  })

  it("wraps Shift+Tab round to its last control", async () => {
    render(<Table />)
    await openFilter("Name")

    const operator = screen.getByLabelText("Name: Operator")
    operator.focus()
    fireEvent.keyDown(operator, { key: "Tab", shiftKey: true })

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apply" }))
  })

  it("closes when the pointer goes down outside it", async () => {
    render(<Table />)
    await openFilter("Name")

    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("clears the column from the popover, closing it and dropping the header's mark", async () => {
    render(<Table />)
    const user = await openFilter("Name")
    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })
    await user.click(screen.getByRole("button", { name: "Apply" }))
    expect(shown()).toHaveLength(1)

    await openFilter("Name")
    await user.click(screen.getByRole("button", { name: "Clear filter" }))

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("img", { name: "Filtered" })).toBeNull()
    expect(shown()).toHaveLength(2)
  })
})
