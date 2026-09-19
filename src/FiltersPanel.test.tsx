import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable, defaultLabels } from "./components/DataTable"
import { TablePanel } from "./components/TablePanel"
import type { FilterCondition } from "./core/filters"
import { useDataTable, type DataTableFeatures } from "./useDataTable"
import type { TableLayout } from "./types"

/**
 * The side panel with two tabs: the Columns list it always had, and the
 * Filters tab beside it — which lists every filterable column, hidden ones
 * included, because a hidden column's filter has no header to show it.
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
  { id: "r2", name: "Kimyo", amount: 900 },
]

const over100: FilterCondition = { kind: "number", field: "amount", op: "gt", value: 100 }

function Table({ initialLayout }: { initialLayout?: Partial<TableLayout> }) {
  const instance = useDataTable<Row>({
    id: "panel",
    columns,
    data,
    getRowId: (row) => row.id,
    ...(initialLayout === undefined ? {} : { initialLayout }),
  })
  return <DataTable instance={instance} virtualize={false} />
}

/** The panel rendered directly, the way a shell of its own would. */
function LonePanel({ focusColumnId }: { focusColumnId?: string }) {
  const instance = useDataTable<Row>({ id: "lone-panel", columns, data, getRowId: (row) => row.id })
  return (
    <TablePanel
      instance={instance}
      labels={defaultLabels}
      onReorder={() => undefined}
      onClose={() => undefined}
      tab="filters"
      onTabChange={() => undefined}
      focusColumnId={focusColumnId}
    />
  )
}

const shown = () => screen.getAllByRole("row").filter((row) => row.classList.contains("dt-tr"))
/*
 * Matched by class, not by role: the shell docks the panel in its side bar,
 * where it is the rail's `tabpanel`, while `LonePanel` below renders the same
 * component floating, where it is a `dialog`. Both are the same panel and
 * these cases are about what is inside it.
 */
const panel = (): HTMLElement => document.querySelector<HTMLElement>(".dt-panel")!
const entries = () => within(panel()).getAllByRole("listitem").map((item) => item.textContent ?? "")

/** Open the panel and switch to its Filters tab. */
const openFilters = async () => {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: "Columns" }))
  await user.click(screen.getByRole("tab", { name: "Filters" }))
  return user
}

/** Filter Name through the header menu's popover, the way Task 16's own suite does. */
const filterNameFromHeader = async () => {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: "Name: Column actions" }))
  await user.click(screen.getByRole("menuitem", { name: "Filter…" }))
  fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })
  await user.click(screen.getByRole("button", { name: "Apply" }))
}

beforeEach(() => localStorage.clear())

describe("the side panel's tabs", () => {
  it("opens on the Columns tab, with Show all inside it", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(screen.getByRole("button", { name: "Columns" }))

    expect(screen.getByRole("tab", { name: "Columns" })).toHaveAttribute("aria-selected", "true")
    expect(within(panel()).getByRole("button", { name: "Show all" })).toBeInTheDocument()
    expect(within(panel()).getByLabelText("Name")).toBeInTheDocument()
  })

  it("keeps the floating panel's tab strip out of its scrolling box", () => {
    // Only the body scrolls, so the tabs cannot scroll away from under the
    // user's pointer. The strip belongs to the FLOATING presentation now —
    // docked, the side bar's rail is the tablist and lives outside the panel
    // altogether (SideBar.test.tsx asserts that).
    render(<LonePanel />)

    const body = panel().querySelector(".dt-panel-body")!
    expect(body.contains(screen.getByRole("tab", { name: "Filters" }))).toBe(false)
  })

  it("lists every filterable column on the Filters tab", async () => {
    render(<Table />)
    await openFilters()

    expect(entries()).toHaveLength(2)
    expect(entries().join(" ")).toContain("Name")
    // `meta: { filter: false }` keeps a column out of the list entirely.
    expect(entries().join(" ")).not.toContain("Id")
  })

  it("lists a hidden column that still carries a filter, and marks it hidden", async () => {
    render(<Table initialLayout={{ filters: [over100], columnVisibility: { amount: false } }} />)
    await openFilters()

    // TanStack goes on applying a hidden column's filter and the header is
    // gone, so this list is the only surface that filter has.
    expect(entries()[0]).toContain("Amount")
    expect(entries()[0]).toContain("Hidden")
    expect(shown()).toHaveLength(2)
  })

  it("puts a filtered column first and says what its filter does", async () => {
    render(<Table initialLayout={{ filters: [over100] }} />)
    await openFilters()

    expect(entries()[0]).toContain("Amount")
    expect(entries()[0]).toContain("Greater than 100")
    expect(entries()[1]).toContain("Name")
  })

  it("keeps an expanded entry in place across a commit made from its own editor", async () => {
    render(<Table />)
    const user = await openFilters()

    expect(entries()[0]).toContain("Name")
    expect(entries()[1]).toContain("Amount")

    await user.click(within(panel()).getByRole("button", { name: /^Amount/ }))

    /*
     * `handleOperator` commits at once. Without freezing the order, "filtered
     * columns sort first" would move this very entry to the top the instant
     * its own filter committed — with its editor still expanded.
     */
    fireEvent.change(screen.getByLabelText("Amount: Operator"), { target: { value: "blank" } })

    expect(entries()[0]).toContain("Name")
    expect(entries()[1]).toContain("Amount")
    expect(screen.getByLabelText("Amount: Operator")).toBeInTheDocument()

    // Closing the entry releases the freeze: the now-filtered column takes
    // its place at the top, exactly as the spec's own rule asks for.
    await user.click(within(panel()).getByRole("button", { name: /^Amount/ }))
    expect(entries()[0]).toContain("Amount")
    expect(entries()[1]).toContain("Name")
  })

  it("commits from an entry's own editor", async () => {
    render(<Table />)
    const user = await openFilters()

    await user.click(within(panel()).getByRole("button", { name: /^Name/ }))
    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })
    fireEvent.blur(screen.getByLabelText("Name: Value"))

    expect(shown()).toHaveLength(1)
  })

  it("clears every filter from the foot of the tab", async () => {
    render(<Table initialLayout={{ filters: [over100] }} />)
    const user = await openFilters()
    expect(shown()).toHaveLength(2)

    await user.click(within(panel()).getByRole("button", { name: "Clear all filters" }))

    expect(shown()).toHaveLength(3)
    expect(within(panel()).getByText("No filters applied")).toBeInTheDocument()
  })

  it("clears filters from the foot of the tab without touching the quick search", async () => {
    render(<Table initialLayout={{ filters: [over100] }} />)
    const user = await openFilters()
    fireEvent.change(screen.getByLabelText("Search rows"), { target: { value: "500" } })
    expect(within(panel()).getByRole("button", { name: "Clear all filters" })).toBeEnabled()

    await user.click(within(panel()).getByRole("button", { name: "Clear all filters" }))

    /*
     * The column filter is gone — the button disables again, on the same
     * `hasFilters` signal `clearAll` used to — but the search this tab
     * neither shows nor names must survive: this is `filtering.clearAll`'s
     * own bug, wiping `updateSearch("")` alongside the filters it was asked
     * to clear.
     */
    expect(within(panel()).getByText("No filters applied")).toBeInTheDocument()
    expect(within(panel()).getByRole("button", { name: "Clear all filters" })).toBeDisabled()
    expect(screen.getByLabelText("Search rows")).toHaveValue("500")
  })

  it("gates its note and Clear all filters on column filters, not on the quick search", async () => {
    render(<Table />)
    const user = await openFilters()

    // The quick search alone makes `filtering.isFiltered` true, but this tab
    // shows column filters only. Its note must still say there are none, and
    // its one action — labelled "filters", nothing else — must not be armed
    // to quietly empty text the user typed somewhere else.
    fireEvent.change(screen.getByLabelText("Search rows"), { target: { value: "temir" } })

    expect(within(panel()).getByText("No filters applied")).toBeInTheDocument()
    expect(within(panel()).getByRole("button", { name: "Clear all filters" })).toBeDisabled()

    // A column filter alongside the search re-enables it, on its own signal.
    await user.click(within(panel()).getByRole("button", { name: /^Name/ }))
    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })
    fireEvent.blur(screen.getByLabelText("Name: Value"))

    expect(within(panel()).queryByText("No filters applied")).toBeNull()
    expect(within(panel()).getByRole("button", { name: "Clear all filters" })).toBeEnabled()
  })

  it("resets the column arrangement without touching the filters", async () => {
    render(<Table />)
    const user = await openFilters()

    /*
     * The filter is set through the tab rather than through `initialLayout`:
     * `resetLayout` restores `{ ...EMPTY_LAYOUT, ...initialLayout }`, so a
     * filter that came from `initialLayout` would survive a reset by itself
     * and this case would prove nothing.
     */
    await user.click(within(panel()).getByRole("button", { name: /^Amount/ }))
    fireEvent.change(screen.getByLabelText("Amount: Operator"), { target: { value: "gt" } })
    fireEvent.change(screen.getByLabelText("Amount: Value"), { target: { value: "100" } })
    fireEvent.blur(screen.getByLabelText("Amount: Value"))
    expect(shown()).toHaveLength(2)

    await user.click(screen.getByRole("tab", { name: "Columns" }))
    await user.click(within(panel()).getByLabelText("Name"))
    expect(screen.queryByRole("columnheader", { name: /name/i })).toBeNull()

    await user.click(within(panel()).getByRole("button", { name: "Reset" }))

    // The column is back and the filter is still on: `resetLayout` blanks
    // every slice, filters included, so the tab takes the model out and puts
    // it back.
    expect(screen.getByRole("columnheader", { name: /name/i })).toBeInTheDocument()
    expect(shown()).toHaveLength(2)
  })

  it("opens one column's editor, focused, when a shell asks it to", () => {
    render(<LonePanel focusColumnId="name" />)

    expect(screen.getByLabelText("Name: Value")).toBe(document.activeElement)
  })

  it("follows a new focusColumnId from a shell that passes no nonce", () => {
    const { rerender } = render(<LonePanel focusColumnId="name" />)
    expect(screen.getByLabelText("Name: Value")).toBe(document.activeElement)

    rerender(<LonePanel focusColumnId="amount" />)

    /*
     * `focusNonce` is optional on both exported prop types, and `TablePanel`
     * is exported precisely so a shell can drive the panel itself — such a
     * shell passes no nonce on any render. Gating the honour check on the
     * nonce ALONE made the comparison `undefined !== undefined`, always
     * false, so `focusColumnId` was a dead prop from mount onwards: naming a
     * different column did nothing at all.
     */
    expect(screen.getByLabelText("Amount: Value")).toBeInTheDocument()
    expect(screen.queryByLabelText("Name: Value")).toBeNull()
    expect(screen.getByLabelText("Amount: Value")).toBe(document.activeElement)
  })

  it("opens on one column's editor from the header menu's second filter item", async () => {
    const user = userEvent.setup()
    render(<Table />)

    await user.click(screen.getByRole("button", { name: "Amount: Column actions" }))
    await user.click(screen.getByRole("menuitem", { name: "Filter in panel…" }))

    // §8.3's `focusColumnId` route, wired end to end: the menu closes, the
    // panel opens on the Filters tab, and that column's editor is expanded and
    // holds the focus.
    expect(screen.queryByRole("menu")).toBeNull()
    expect(screen.getByRole("tab", { name: "Filters" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByLabelText("Amount: Value")).toBe(document.activeElement)
  })

  it("follows a second focusColumnId request while the Filters tab stays mounted", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await openFilters()

    /*
     * Keyboard activation only, and no `user.click` anywhere in this case: a
     * real Tab-then-Enter path fires no `pointerdown`, so nothing closes and
     * remounts the panel before `onOpenFilterInPanel` runs — the menu route
     * has to reach a FiltersTab that is already mounted on this tab.
     */
    screen.getByRole("button", { name: "Amount: Column actions" }).focus()
    await user.keyboard("{Enter}")
    await user.tab()
    expect(screen.getByRole("menuitem", { name: "Filter in panel…" })).toBe(document.activeElement)
    await user.keyboard("{Enter}")

    // The menu closes and the request still reaches the mounted tab: the
    // Amount editor opens, focused, exactly as the first request would have.
    expect(screen.queryByRole("menu")).toBeNull()
    expect(screen.getByRole("tab", { name: "Filters" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByLabelText("Amount: Value")).toBe(document.activeElement)
  })

  /*
   * Open Amount's editor through the header menu's "Filter in panel…" item,
   * by keyboard only — no `user.click` anywhere in it. A pointer click on the
   * header button lands OUTSIDE `.dt-panel`, and `TablePanel`'s
   * outside-pointerdown handler closes and remounts the panel on it, which
   * would reset `FiltersTab`'s own state and mask the very bug these cases
   * exist to catch (the same reason `openFilters`'s and this helper's own
   * sibling case above go by keyboard).
   */
  const openAmountFromMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    screen.getByRole("button", { name: "Amount: Column actions" }).focus()
    await user.keyboard("{Enter}")
    await user.tab()
    expect(screen.getByRole("menuitem", { name: "Filter in panel…" })).toBe(document.activeElement)
    await user.keyboard("{Enter}")
  }

  it("follows a repeat focusColumnId request for the column already open", async () => {
    const user = userEvent.setup()
    render(<Table />)

    await openAmountFromMenu(user)
    expect(screen.getByLabelText("Amount: Value")).toBe(document.activeElement)

    // Collapsed from the list — a click inside the panel, which the
    // outside-pointerdown handler leaves alone — so `focusColumnId` stays
    // "amount" in the shell's own state and only `openId` changed.
    await user.click(within(panel()).getByRole("button", { name: /^Amount/ }))
    expect(screen.queryByLabelText("Amount: Value")).toBeNull()

    // The menu asks for Amount again. A comparison against the last
    // `focusColumnId` honoured would see the identical string and do
    // nothing — this is the bug the nonce exists to prevent.
    await openAmountFromMenu(user)
    expect(screen.getByLabelText("Amount: Value")).toBe(document.activeElement)
  })

  it("follows a repeat focusColumnId request for a column whose editor never closed", async () => {
    const user = userEvent.setup()
    render(<Table />)

    await openAmountFromMenu(user)
    expect(screen.getByLabelText("Amount: Value")).toBe(document.activeElement)

    /*
     * The untested half of the nonce bug. Nothing is collapsed in between, so
     * the honoured request writes the `openId` the tab already holds: React
     * bails out of an identical `useState` write, `FilterEditor` never
     * remounts, and its one-shot `autoFocus` latch — set at mount and cleared
     * by the effect beside it — never fires again. The menu unmounts on
     * activation without restoring focus anywhere, so focus falls to `<body>`
     * and a keyboard user's next Tab restarts from the top of the document
     * (WCAG 2.4.3). Only an honoured request driving the editor's own
     * identity re-arms the latch.
     */
    await openAmountFromMenu(user)

    expect(screen.getByLabelText("Amount: Value")).toBe(document.activeElement)
  })

  it("follows a repeat focusColumnId request after a different entry opened in between", async () => {
    const user = userEvent.setup()
    render(<Table />)

    await openAmountFromMenu(user)
    expect(screen.getByLabelText("Amount: Value")).toBe(document.activeElement)

    // A different entry opened from the list (inside the panel, so still no
    // remount): its editor expands, but a manual click never autofocuses
    // into it the way the menu's own route does.
    await user.click(within(panel()).getByRole("button", { name: /^Name/ }))
    expect(screen.getByLabelText("Name: Value")).toBeInTheDocument()
    expect(screen.queryByLabelText("Amount: Value")).toBeNull()

    // Asked for Amount again: it reopens, focused, and Name closes with it.
    await openAmountFromMenu(user)
    expect(screen.getByLabelText("Amount: Value")).toBe(document.activeElement)
    expect(screen.queryByLabelText("Name: Value")).toBeNull()
  })

  it("shows in the tab the condition the header popover set", async () => {
    render(<Table />)
    await filterNameFromHeader()
    expect(shown()).toHaveLength(1)

    const user = await openFilters()

    // Both surfaces are views of one model, which is §8.3's whole
    // architectural claim: the tab says what the popover set, and the tab's
    // own editor opens on exactly that condition.
    expect(entries()[0]).toContain("Name")
    expect(entries()[0]).toContain("Contains temir")
    await user.click(within(panel()).getByRole("button", { name: /^Name/ }))
    expect(screen.getByLabelText("Name: Operator")).toHaveValue("contains")
    expect(screen.getByLabelText("Name: Value")).toHaveValue("temir")
  })

  it("clears from the tab what the header popover set, in both surfaces", async () => {
    render(<Table />)
    await filterNameFromHeader()
    expect(screen.getByRole("img", { name: "Filtered" })).toBeInTheDocument()

    const user = await openFilters()
    await user.click(within(panel()).getByRole("button", { name: /^Name/ }))
    await user.click(within(panel()).getByRole("button", { name: "Clear filter" }))

    // And the other direction: clearing in the tab un-marks the header the
    // popover marked, because there is one model and not two.
    expect(screen.queryByRole("img", { name: "Filtered" })).toBeNull()
    expect(shown()).toHaveLength(3)
  })
})
