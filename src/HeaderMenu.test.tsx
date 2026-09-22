import { createColumnHelper } from "@tanstack/react-table"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * The per-column menu, and the sticky-header switch.
 *
 * Everything that acts on a single column lives in this menu, which is why the
 * Columns panel no longer carries pin arrows: two places to pin a column means
 * two places to keep in step.
 */

interface Row {
  a: string
  b: string
}

const rows: Row[] = [
  { a: "2", b: "y" },
  { a: "1", b: "x" },
]

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("a", { header: "Alpha", size: 100 }),
  helper.accessor("b", { header: "Beta", size: 100 }),
]

function Table({
  sticky,
  grouped = false,
}: {
  sticky?: boolean
  grouped?: boolean
}) {
  const instance = useDataTable({
    id: "menu",
    data: rows,
    columns: grouped
      ? [helper.group({ id: "g", header: "Group", columns: helper.columns(columns) })]
      : columns,
  })
  return <DataTable instance={instance} {...(sticky === undefined ? {} : { stickyHeader: sticky })} />
}

const openMenuFor = async (name: RegExp) => {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name }))
  return user
}

describe("header menu", () => {
  beforeEach(() => localStorage.clear())

  it("opens from the column's button", async () => {
    render(<Table />)
    await openMenuFor(/alpha: column actions/i)
    expect(screen.getByRole("menu")).toBeInTheDocument()
  })

  it("opens on right-click and suppresses the browser menu", () => {
    render(<Table />)
    const header = screen.getByRole("columnheader", { name: /alpha/i })

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    fireEvent(header, event)

    expect(screen.getByRole("menu")).toBeInTheDocument()
    expect(event.defaultPrevented).toBe(true)
  })

  it("sorts from the menu", async () => {
    render(<Table />)
    const user = await openMenuFor(/alpha: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /sort ascending/i }))

    const first = within(screen.getAllByRole("row")[1] as HTMLElement).getAllByRole("cell")
    expect(first[0]).toHaveTextContent("1")
  })

  it("pins from the menu", async () => {
    render(<Table />)
    const user = await openMenuFor(/beta: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /pin to end/i }))

    expect(screen.getByRole("columnheader", { name: /beta/i }).style.insetInlineEnd).toBe(
      "0px",
    )
  })

  it("offers to unpin only a pinned column", async () => {
    render(<Table />)
    let user = await openMenuFor(/beta: column actions/i)
    expect(screen.queryByRole("menuitem", { name: /^unpin$/i })).toBeNull()

    await user.click(screen.getByRole("menuitem", { name: /pin to end/i }))
    user = await openMenuFor(/beta: column actions/i)
    expect(screen.getByRole("menuitem", { name: /^unpin$/i })).toBeInTheDocument()
  })

  it("hides from the menu", async () => {
    render(<Table />)
    const user = await openMenuFor(/beta: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /^hide$/i }))

    expect(screen.queryByRole("columnheader", { name: /beta/i })).toBeNull()
  })

  it("closes on Escape", async () => {
    render(<Table />)
    const user = await openMenuFor(/alpha: column actions/i)
    await user.keyboard("{Escape}")

    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("closes after an action is chosen", async () => {
    render(<Table />)
    const user = await openMenuFor(/alpha: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /sort ascending/i }))

    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("gives a group header no menu", () => {
    render(<Table grouped />)
    expect(screen.queryByRole("button", { name: /group: column actions/i })).toBeNull()
  })
})

/**
 * `useMenuSurface`'s ARIA-menu contract, exercised through `HeaderMenu`
 * because it is the caller with enough items (sort, pin, resize, hide) to
 * prove wrapping actually wraps rather than only ever landing on item 1 or 2.
 * `CellMenu`'s own suite, unedited by this change, is what proves the same
 * hook stays sane at n=1.
 */
describe("header menu keyboard navigation", () => {
  beforeEach(() => localStorage.clear())

  it("opens with the first item as the only tab stop", async () => {
    render(<Table />)
    await openMenuFor(/alpha: column actions/i)
    const items = screen.getAllByRole("menuitem")

    expect(items[0]).toHaveFocus()
    expect(items[0]).toHaveAttribute("tabindex", "0")
    for (const item of items.slice(1)) {
      expect(item).toHaveAttribute("tabindex", "-1")
    }
  })

  it("moves the roving focus down with ArrowDown and wraps past the last item", async () => {
    render(<Table />)
    const user = await openMenuFor(/alpha: column actions/i)
    const items = screen.getAllByRole("menuitem")

    for (let step = 0; step < items.length - 1; step += 1) {
      await user.keyboard("{ArrowDown}")
    }
    expect(items[items.length - 1]).toHaveFocus()

    await user.keyboard("{ArrowDown}")
    expect(items[0]).toHaveFocus()
  })

  it("moves the roving focus up with ArrowUp and wraps before the first item", async () => {
    render(<Table />)
    const user = await openMenuFor(/alpha: column actions/i)
    const items = screen.getAllByRole("menuitem")

    await user.keyboard("{ArrowUp}")
    expect(items[items.length - 1]).toHaveFocus()
  })

  it("jumps to the last item with End and back to the first with Home", async () => {
    render(<Table />)
    const user = await openMenuFor(/alpha: column actions/i)
    const items = screen.getAllByRole("menuitem")

    await user.keyboard("{ArrowDown}")
    await user.keyboard("{End}")
    expect(items[items.length - 1]).toHaveFocus()

    await user.keyboard("{Home}")
    expect(items[0]).toHaveFocus()
  })

  it("closes when Tab carries the focus out past the last item", async () => {
    render(<Table />)
    const user = await openMenuFor(/alpha: column actions/i)
    await user.keyboard("{End}")

    await user.tab()
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("closes the instant focus is moved to something outside it, even without a pointer press", async () => {
    render(
      <>
        <Table />
        <button type="button">Elsewhere</button>
      </>,
    )
    await openMenuFor(/alpha: column actions/i)

    // A plain `.focus()` call, not a click: it exercises the focus-out
    // dismissal on its own, apart from the pre-existing outside-pointerdown
    // path this menu already had.
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus())
    expect(screen.queryByRole("menu")).toBeNull()
  })
})

describe("sticky header", () => {
  beforeEach(() => localStorage.clear())

  it("offsets the header rows by default", () => {
    render(<Table />)
    expect(screen.getByRole("columnheader", { name: /alpha/i }).style.top).toBe(
      "calc(var(--dt-header-height) * 0)",
    )
  })

  it("leaves the header to scroll away when turned off", () => {
    render(<Table sticky={false} />)
    expect(screen.getByRole("columnheader", { name: /alpha/i }).style.top).toBe("")
  })

  it("keeps pinned columns sticky even when the header is not", async () => {
    render(<Table sticky={false} />)
    const user = await openMenuFor(/alpha: column actions/i)
    await user.click(screen.getByRole("menuitem", { name: /pin to start/i }))

    // Horizontal pinning is independent of the vertical sticky header.
    const header = screen.getByRole("columnheader", { name: /alpha/i })
    expect(header.style.insetInlineStart).toBe("0px")
    expect(header.style.top).toBe("")
  })
})
