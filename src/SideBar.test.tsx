import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * The docked side bar: a rail of vertical tabs on the table's inline-end edge,
 * always there, and the panel one of them opens beside the table rather than
 * over it.
 *
 * What is new or changed here, and therefore what this file is for: the rail's
 * tab semantics, the open/close/switch toggle, Escape only from inside the
 * panel, and — the behaviour that was deliberately removed — an outside click
 * NOT closing it. What is inside each tab is unchanged and stays in
 * `FiltersPanel.test.tsx` and `PanelReordering.test.tsx`.
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
]
const data: Row[] = [
  { id: "r0", name: "Agro Ltd", amount: 15 },
  { id: "r1", name: "Temir", amount: 500 },
]

function Table() {
  const instance = useDataTable<Row>({ id: "sidebar", columns, data, getRowId: (row) => row.id })
  return <DataTable instance={instance} virtualize={false} />
}

/** The docked panel, or `null` while the bar is closed. */
const panel = (): HTMLElement | null => document.querySelector<HTMLElement>(".dt-panel-docked")
const rail = (): HTMLElement => document.querySelector<HTMLElement>(".dt-sidebar-rail")!
const railTab = (name: "Columns" | "Filters"): HTMLElement => screen.getByRole("tab", { name })

beforeEach(() => localStorage.clear())

describe("the rail", () => {
  it("is there whether or not a panel is open", async () => {
    const user = userEvent.setup()
    render(<Table />)

    // Closed: the rail is furniture, not something the panel brings with it.
    expect(rail()).toBeInTheDocument()
    expect(panel()).toBeNull()

    await user.click(railTab("Columns"))
    expect(rail()).toBeInTheDocument()
    expect(panel()).not.toBeNull()
  })

  it("is a vertical tablist with a name of its own", () => {
    render(<Table />)

    const tablist = screen.getByRole("tablist", { name: "Table side bar" })
    expect(tablist).toBe(rail())
    expect(tablist).toHaveAttribute("aria-orientation", "vertical")
  })

  it("labels each tab with real selectable text, not one letter per line", () => {
    render(<Table />)

    /*
     * The label is rotated by `writing-mode` in the stylesheet, which leaves
     * it a single text node: a screen reader reads "Columns", find-in-page
     * matches it, and a pointer can select it. Drawing it as seven separate
     * lines would produce seven text nodes and an accessible name full of
     * spaces, which is exactly what this asserts against.
     */
    const text = railTab("Columns").querySelector(".dt-sidebar-tab-text")
    expect(text?.childNodes).toHaveLength(1)
    expect(text?.textContent).toBe("Columns")
  })

  it("comes before the panel it controls, and holds no part of it", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(railTab("Columns"))

    // The tablist precedes its tabpanel, so Tab reaches the tabs first — and
    // the rail is outside the panel, so nothing in it scrolls away with the
    // column list.
    const sidebar = document.querySelector(".dt-sidebar")!
    expect(sidebar.firstElementChild).toBe(rail())
    expect(rail().contains(panel())).toBe(false)
    expect(panel()!.querySelector("[role='tab']")).toBeNull()
  })

  it("states both aria-selected and aria-expanded, and both are false while closed", async () => {
    const user = userEvent.setup()
    render(<Table />)

    for (const name of ["Columns", "Filters"] as const) {
      expect(railTab(name)).toHaveAttribute("aria-selected", "false")
      expect(railTab(name)).toHaveAttribute("aria-expanded", "false")
    }

    await user.click(railTab("Filters"))

    expect(railTab("Filters")).toHaveAttribute("aria-selected", "true")
    expect(railTab("Filters")).toHaveAttribute("aria-expanded", "true")
    expect(railTab("Columns")).toHaveAttribute("aria-selected", "false")
    expect(railTab("Columns")).toHaveAttribute("aria-expanded", "false")
  })

  it("points the open tab at the panel, which is labelled back by that tab", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(railTab("Filters"))

    const open = railTab("Filters")
    expect(panel()).toHaveAttribute("role", "tabpanel")
    expect(open.getAttribute("aria-controls")).toBe(panel()!.id)
    expect(panel()!.getAttribute("aria-labelledby")).toBe(open.id)

    // The closed tab controls nothing: there is no second panel for it to
    // name, and a dangling `aria-controls` is a broken reference.
    expect(railTab("Columns")).not.toHaveAttribute("aria-controls")
  })

  it("keeps exactly one tab in the Tab order, open or closed", async () => {
    const user = userEvent.setup()
    render(<Table />)

    const inOrder = () =>
      screen.getAllByRole("tab").filter((tab) => tab.getAttribute("tabindex") === "0")
    expect(inOrder()).toHaveLength(1)

    await user.click(railTab("Filters"))
    expect(inOrder()).toEqual([railTab("Filters")])
  })
})

describe("opening, switching and closing", () => {
  it("opens on the tab that was clicked", async () => {
    const user = userEvent.setup()
    render(<Table />)

    await user.click(railTab("Filters"))

    expect(panel()).not.toBeNull()
    expect(screen.getByRole("button", { name: "Clear all filters" })).toBeInTheDocument()
  })

  it("switches to another tab without closing", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(railTab("Columns"))

    await user.click(railTab("Filters"))

    expect(panel()).not.toBeNull()
    expect(railTab("Filters")).toHaveAttribute("aria-expanded", "true")
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull()
  })

  it("closes when the tab that is already showing is clicked again", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(railTab("Columns"))
    expect(panel()).not.toBeNull()

    await user.click(railTab("Columns"))

    expect(panel()).toBeNull()
    expect(railTab("Columns")).toHaveAttribute("aria-expanded", "false")
  })

  it("remembers the tab it was closed from", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(railTab("Filters"))
    await user.click(railTab("Filters"))

    /*
     * Closed, but still ON Filters: the roving tabIndex is where the rail
     * keeps that, so Tab returns the user to the tab they were last using
     * rather than to the top of the rail.
     */
    expect(panel()).toBeNull()
    expect(railTab("Filters")).toHaveAttribute("tabindex", "0")
    expect(railTab("Columns")).toHaveAttribute("tabindex", "-1")

    await user.click(railTab("Filters"))
    expect(railTab("Filters")).toHaveAttribute("aria-expanded", "true")
  })

  it("moves along the rail with the arrows without opening or closing it", async () => {
    const user = userEvent.setup()
    render(<Table />)

    railTab("Columns").focus()
    await user.keyboard("{ArrowDown}")

    // Focus and the current tab moved; the panel stayed shut. A drawer that
    // flies open under the caret is not what arrowing past a rail asks for.
    expect(railTab("Filters")).toBe(document.activeElement)
    expect(railTab("Filters")).toHaveAttribute("tabindex", "0")
    expect(panel()).toBeNull()

    // Open from there: the arrow decided which tab Enter would open.
    await user.keyboard("{Enter}")
    expect(railTab("Filters")).toHaveAttribute("aria-expanded", "true")
  })

  it("is the only way in: the toolbar offers no Columns button any more", async () => {
    const user = userEvent.setup()
    render(<Table />)

    /*
     * The button was redundant once the rail existed — two controls for one
     * panel, one of them duplicating a tab standing right beside it. The rail
     * tab has to carry everything it used to: the toggle, and a state a
     * screen reader is told about.
     */
    expect(screen.queryByRole("button", { name: "Columns" })).toBeNull()
    expect(document.querySelector(".dt-toolbar .dt-menu-button")).toBeNull()

    const tab = railTab("Columns")
    expect(tab).toHaveAttribute("aria-expanded", "false")
    await user.click(tab)
    expect(tab).toHaveAttribute("aria-expanded", "true")
    expect(tab.getAttribute("aria-controls")).toBe(panel()!.id)

    await user.click(tab)
    expect(panel()).toBeNull()
  })
})

describe("dismissal, which a docked bar does differently", () => {
  it("does NOT close on a click outside it", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(railTab("Columns"))

    await user.click(screen.getByRole("columnheader", { name: /name/i }))
    expect(panel()).not.toBeNull()

    // Not even on a bare pointerdown on the document, which is what the
    // floating panel listened for and what this presentation deliberately
    // does not: the bar is furniture beside the table, and using the table is
    // not a request to dismiss it.
    fireEvent.pointerDown(document.body)
    expect(panel()).not.toBeNull()
  })

  it("closes on Escape from inside the panel, and gives the focus back to its tab", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(railTab("Columns"))

    const checkbox = screen.getByLabelText("Name")
    checkbox.focus()
    await user.keyboard("{Escape}")

    expect(panel()).toBeNull()
    /*
     * The focus was inside the subtree React just removed, and React does not
     * relocate focus out of one — without the handover it would be on <body>
     * and a keyboard user would be back at the top of the document (WCAG
     * 2.4.3).
     */
    expect(railTab("Columns")).toBe(document.activeElement)
  })

  it("does NOT close on Escape from the rail tab, which is outside the panel", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(railTab("Columns"))

    railTab("Columns").focus()
    await user.keyboard("{Escape}")

    expect(panel()).not.toBeNull()
  })

  it("does NOT close on Escape from the table beside it", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(railTab("Columns"))

    // The old panel listened on `document`, so an Escape meant for anything
    // else on the page took the panel with it.
    fireEvent.keyDown(document, { key: "Escape" })
    expect(panel()).not.toBeNull()

    screen.getByRole("columnheader", { name: /name/i }).focus()
    await user.keyboard("{Escape}")
    expect(panel()).not.toBeNull()
  })
})

/**
 * Defect D: with pinning and hiding both off, the Columns tab has nothing to
 * arrange and used to take the whole rail down with it — Filters included,
 * even though filtering itself was still on. The header menu's own "Filter in
 * panel…" item never knew that, so it stayed enabled and, once clicked, opened
 * a panel that was not there to receive it.
 */
function TableWithoutPinningOrHiding() {
  const instance = useDataTable<Row>({
    id: "sidebar-no-pin-no-hide",
    columns,
    data,
    getRowId: (row) => row.id,
    features: { pinning: false, hiding: false },
  })
  return <DataTable instance={instance} virtualize={false} />
}

describe("the filters tab with pinning and hiding both off", () => {
  beforeEach(() => localStorage.clear())

  it("still gets a rail, offering Filters and not Columns", () => {
    render(<TableWithoutPinningOrHiding />)

    expect(rail()).toBeInTheDocument()
    expect(railTab("Filters")).toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "Columns" })).toBeNull()
  })

  it("is where the header menu's Filter in panel… item actually lands", async () => {
    const user = userEvent.setup()
    render(<TableWithoutPinningOrHiding />)

    await user.click(screen.getByRole("button", { name: /name: column actions/i }))
    await user.click(screen.getByRole("menuitem", { name: "Filter in panel…" }))

    expect(panel()).not.toBeNull()
    expect(railTab("Filters")).toHaveAttribute("aria-selected", "true")
  })
})
