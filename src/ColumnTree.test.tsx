import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * The Columns tab as a tree.
 *
 * A flat list of leaves throws away the one thing grouped headers add, and
 * with it the only way to act on a group at all: with four columns under
 * "Totals" a user had four ticks to undo and no single answer to "is this
 * group showing". What is checked here is that behaviour — a group speaking
 * for its leaves, a half-shown group saying so, a group folding away, and a
 * group surviving the moment every column under it is hidden — rather than
 * which element carries which class.
 */

interface Row {
  code: string
  partner: string
  city: string
  amount: number
  currency: string
  status: string
}

const rows: Row[] = [
  { code: "KR-1", partner: "Alpha", city: "Toshkent", amount: 10, currency: "UZS", status: "open" },
  { code: "KR-2", partner: "Beta", city: "Andijon", amount: 20, currency: "UZS", status: "closed" },
]

const helper = createColumnHelper<DataTableFeatures, Row>()

/**
 * Three levels of nesting, on purpose.
 *
 * "Totals" holds nothing but another group, so anything that assumes one
 * level of grouping — a parent lookup instead of an ancestor walk, an indent
 * that is a boolean — fails here rather than in a host's application.
 */
const columns = [
  helper.accessor("code", { header: "Code", size: 100 }),
  helper.group({
    id: "document",
    header: "Document",
    columns: helper.columns([
      helper.accessor("partner", { header: "Partner", size: 240 }),
      helper.accessor("city", { header: "City", size: 170 }),
    ]),
  }),
  helper.group({
    id: "totals",
    header: "Totals",
    columns: helper.columns([
      helper.group({
        id: "money",
        header: "Money",
        columns: helper.columns([
          helper.accessor("amount", { header: "Amount", size: 130 }),
          helper.accessor("currency", { header: "Currency", size: 90 }),
        ]),
      }),
    ]),
  }),
  helper.accessor("status", { header: "Status", size: 120 }),
]

function Grouped() {
  const instance = useDataTable({ id: "column-tree", data: rows, columns })
  return <DataTable instance={instance} />
}

/** Render the table and open the side bar, which starts on its Columns tab. */
const openPanel = async () => {
  const user = userEvent.setup()
  render(<Grouped />)
  await user.click(screen.getByRole("tab", { name: "Columns" }))
  return user
}

const panel = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>(".dt-panel")
  if (!element) throw new Error("the panel is not open")
  return element
}

/** A group's own checkbox, found by the name only it carries. */
const groupBox = (name: string): HTMLInputElement =>
  within(panel()).getByRole("checkbox", { name: `${name} column group` }) as HTMLInputElement

/** A leaf column's checkbox, labelled by the column's header. */
const leafBox = (name: string): HTMLInputElement =>
  within(panel()).getByRole("checkbox", { name }) as HTMLInputElement

const toggleFor = (name: string): HTMLElement =>
  within(panel()).getByRole("button", { name: new RegExp(`^${name}: (Collapse|Expand) group$`) })

/** Which leaf columns the TABLE is currently showing. */
const shownColumns = (): string[] =>
  screen
    .getAllByRole("columnheader")
    .map((cell) => cell.textContent ?? "")
    .map((text) => text.replace(/Sort .*|Column actions.*|resize column/g, "").trim())

/** The panel row a group's name sits on, with everything nested under it. */
const groupRow = (groupId: string): HTMLElement => {
  const row = panel().querySelector<HTMLElement>(`li[data-group-id="${groupId}"]`)
  if (!row) throw new Error(`no panel row for the group ${groupId}`)
  return row
}

describe("the Columns tab shows the column tree", () => {
  beforeEach(() => localStorage.clear())

  it("nests a group's children under it, to whatever depth they go", async () => {
    await openPanel()

    // Money is inside Totals, which is not a claim any flat list could make.
    expect(groupRow("totals").contains(groupRow("money"))).toBe(true)
    expect(within(groupRow("money")).getByRole("checkbox", { name: "Amount" })).toBeInTheDocument()
    // …and Amount is inside Money, not merely somewhere below Totals.
    expect(groupRow("document").contains(groupRow("money"))).toBe(false)
  })

  it("lists a leaf that belongs to no group at the top level", async () => {
    await openPanel()
    const code = within(panel()).getByRole("checkbox", { name: "Code" })
    expect(groupRow("document").contains(code)).toBe(false)
    expect(groupRow("totals").contains(code)).toBe(false)
  })

  it("keeps the table's order, not the declaration's", async () => {
    await openPanel()
    const listed = Array.from(panel().querySelectorAll("li.dt-panel-item")).map((item) =>
      item.getAttribute("data-column-id"),
    )
    expect(listed).toEqual(["code", "partner", "city", "amount", "currency", "status"])
  })
})

describe("a group's checkbox speaks for every leaf under it", () => {
  beforeEach(() => localStorage.clear())

  it("hides all of them at once, and shows them all again", async () => {
    const user = await openPanel()
    expect(shownColumns()).toContain("Partner")

    await user.click(groupBox("Document"))
    expect(shownColumns()).not.toContain("Partner")
    expect(shownColumns()).not.toContain("City")
    // The columns it does not speak for are untouched.
    expect(shownColumns()).toContain("Code")

    await user.click(groupBox("Document"))
    expect(shownColumns()).toContain("Partner")
    expect(shownColumns()).toContain("City")
  })

  it("reaches through a group that only holds another group", async () => {
    const user = await openPanel()

    await user.click(groupBox("Totals"))
    expect(shownColumns()).not.toContain("Amount")
    expect(shownColumns()).not.toContain("Currency")
    // The inner group agrees with the outer one it was never clicked on.
    expect(groupBox("Money").checked).toBe(false)
  })

  it("leaves the group's header out of the table once nothing is under it", async () => {
    const user = await openPanel()
    expect(screen.getByRole("columnheader", { name: "Document" })).toBeInTheDocument()

    await user.click(groupBox("Document"))

    expect(screen.queryByRole("columnheader", { name: "Document" })).toBeNull()
    // The table is still a table: the surviving columns and every row.
    // Sorted, because the header cells are read row by row rather than left
    // to right — a spanning group sits on a row of its own.
    expect(shownColumns().sort()).toEqual(
      ["Amount", "Code", "Currency", "Money", "Status", "Totals"],
    )
    expect(screen.getByText("KR-1")).toBeInTheDocument()
  })

  it("keeps the group's row in the panel when every child is hidden", async () => {
    const user = await openPanel()
    await user.click(groupBox("Document"))

    // The row is the only way back. Its children stay listed too, for the
    // same reason: a hidden column with no row is a column with no way back.
    expect(groupBox("Document")).toBeInTheDocument()
    expect(leafBox("Partner").checked).toBe(false)

    await user.click(leafBox("Partner"))
    expect(shownColumns()).toContain("Partner")
    expect(shownColumns()).not.toContain("City")
  })
})

describe("a partly shown group says so", () => {
  beforeEach(() => localStorage.clear())

  it("turns indeterminate when only some of its leaves are visible", async () => {
    const user = await openPanel()
    expect(groupBox("Document").indeterminate).toBe(false)
    expect(groupBox("Document").checked).toBe(true)

    await user.click(leafBox("City"))

    expect(groupBox("Document").indeterminate).toBe(true)
    expect(groupBox("Document").checked).toBe(false)
  })

  it("clears it again when the last hidden leaf comes back", async () => {
    const user = await openPanel()
    await user.click(leafBox("City"))
    await user.click(leafBox("City"))

    expect(groupBox("Document").indeterminate).toBe(false)
    expect(groupBox("Document").checked).toBe(true)
  })

  it("is not indeterminate when every leaf is hidden — it is simply off", async () => {
    const user = await openPanel()
    await user.click(leafBox("City"))
    await user.click(leafBox("Partner"))

    expect(groupBox("Document").indeterminate).toBe(false)
    expect(groupBox("Document").checked).toBe(false)
  })

  it("carries a half-shown inner group up to the outer one", async () => {
    const user = await openPanel()
    await user.click(leafBox("Currency"))

    for (const name of ["Money", "Totals"]) {
      expect(groupBox(name).indeterminate, `${name} should be mixed`).toBe(true)
      expect(groupBox(name).checked).toBe(false)
    }
  })

  it("shows every leaf when a half-shown group is ticked", async () => {
    const user = await openPanel()
    await user.click(leafBox("City"))

    // The click on a mixed checkbox means "all", never "none" — which would
    // take away the very column the user had left showing.
    await user.click(groupBox("Document"))
    expect(shownColumns()).toContain("City")
    expect(shownColumns()).toContain("Partner")
  })
})

describe("a group collapses", () => {
  beforeEach(() => localStorage.clear())

  it("folds its children away and brings them back", async () => {
    const user = await openPanel()
    expect(toggleFor("Document")).toHaveAttribute("aria-expanded", "true")

    await user.click(toggleFor("Document"))

    expect(toggleFor("Document")).toHaveAttribute("aria-expanded", "false")
    expect(within(panel()).queryByRole("checkbox", { name: "Partner" })).toBeNull()

    await user.click(toggleFor("Document"))
    expect(within(panel()).getByRole("checkbox", { name: "Partner" })).toBeInTheDocument()
  })

  it("keeps the state per group", async () => {
    const user = await openPanel()
    await user.click(toggleFor("Document"))

    expect(toggleFor("Totals")).toHaveAttribute("aria-expanded", "true")
    expect(within(panel()).getByRole("checkbox", { name: "Amount" })).toBeInTheDocument()
  })

  it("collapses an inner group without folding the one around it", async () => {
    const user = await openPanel()
    await user.click(toggleFor("Money"))

    expect(toggleFor("Totals")).toHaveAttribute("aria-expanded", "true")
    expect(groupBox("Money")).toBeInTheDocument()
    expect(within(panel()).queryByRole("checkbox", { name: "Amount" })).toBeNull()
  })

  it("shows and hides columns while collapsed, from the group's own row", async () => {
    const user = await openPanel()
    await user.click(toggleFor("Document"))
    await user.click(groupBox("Document"))

    // Folding away a group must not take its control away with it.
    expect(shownColumns()).not.toContain("Partner")
  })

  it("changes nothing about what the table shows", async () => {
    const user = await openPanel()
    const before = shownColumns()
    await user.click(toggleFor("Document"))
    expect(shownColumns()).toEqual(before)
  })
})

describe("a group split by pinning", () => {
  beforeEach(() => localStorage.clear())

  /**
   * Pinning one leaf of a group splits it: TanStack draws the header twice,
   * once over the pinned part and once over the rest. The panel has to say
   * the same thing, and each half has to answer for its own run — a half that
   * spoke for the whole group would hide columns in a section the user was
   * not looking at.
   */
  it("is listed once per run, and each run speaks only for itself", async () => {
    const user = await openPanel()
    await user.click(screen.getByRole("button", { name: /city: column actions/i }))
    await user.click(screen.getByRole("menuitem", { name: /pin to start/i }))

    const boxes = within(panel()).getAllByRole("checkbox", { name: "Document column group" })
    expect(boxes).toHaveLength(2)

    // The first run is the pinned one — City alone, now ahead of everything.
    await user.click(boxes[0] as HTMLElement)
    expect(shownColumns()).not.toContain("City")
    expect(shownColumns()).toContain("Partner")
  })
})

describe("dragging inside the tree", () => {
  beforeEach(() => localStorage.clear())

  /** The column currently wearing the drop slot. */
  const slot = (): string | null =>
    panel().querySelector("li.dt-drop-slot")?.getAttribute("data-column-id") ?? null

  const handle = (columnId: string): HTMLElement => {
    const grip = panel().querySelector<HTMLElement>(
      `li[data-column-id="${columnId}"] .dt-drag-handle`,
    )
    if (!grip) throw new Error(`no drag handle for ${columnId}`)
    return grip
  }

  it("will not carry a leaf out of its group, however far the arrow is pressed", async () => {
    await openPanel()

    fireEvent.keyDown(handle("partner"), { key: " " })
    for (let press = 0; press < 5; press += 1) {
      fireEvent.keyDown(handle("partner"), { key: "ArrowUp" })
    }
    // Code sits above Partner and outside Document; the slot stops at City's
    // group, which is the rule `dropRegionOf` owns and this only observes.
    expect(slot()).toBe("partner")

    for (let press = 0; press < 5; press += 1) {
      fireEvent.keyDown(handle("partner"), { key: "ArrowDown" })
    }
    expect(slot()).toBe("city")
  })

  it("gives no group its own drag handle", async () => {
    await openPanel()
    // One handle per leaf column and not one more. A group is moved by moving
    // its columns; a handle on a group row would promise a move that
    // `reorderColumn` has no flat order to carry out. Three groups are listed,
    // so a handle on each would make this nine.
    expect(panel().querySelectorAll(".dt-drag-handle")).toHaveLength(6)
  })
})
