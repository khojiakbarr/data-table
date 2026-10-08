import { createColumnHelper } from "@tanstack/react-table"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import { useInCard } from "./core/cardContext"
import { useDataTable, type DataTableFeatures } from "./useDataTable"
import type { RowsLayout } from "./types"

/**
 * Cards (`layout="cards"` / `"auto"`): a row drawn as a card, laid out from
 * its columns' `meta.card`. What is asserted is where each value lands, that a
 * blank value draws nothing, and that the card keeps the row's behaviour —
 * opening, selecting, a detail panel, the totals.
 */

interface Doc {
  id: string
  code: string
  partner: string | null
  total: string
  base: string | null
  status: string
  note: string | null
}

const helper = createColumnHelper<DataTableFeatures, Doc>()
const columns = [
  helper.accessor("code", { header: "Code", meta: { card: "code" } }),
  helper.accessor("partner", { header: "Partner", meta: { card: "title" } }),
  helper.accessor("total", { header: "Total", meta: { card: "amount" } }),
  helper.accessor("base", { header: "Total, UZS", meta: { card: "amountNote" } }),
  helper.accessor("status", { header: "Status", meta: { card: "status" } }),
  helper.accessor("note", { header: "Note" }),
  helper.display({ id: "actions", header: "Actions", cell: () => <button type="button">Menu</button>, meta: { card: "actions" } }),
]

const DOCS: Doc[] = [
  { id: "d1", code: "PU-1", partner: "Apple China", total: "1 468.40 USD", base: "18 575 200 UZS", status: "Confirmed", note: "Urgent" },
  { id: "d2", code: "PU-2", partner: null, total: "0 UZS", base: null, status: "Draft", note: "" },
]

interface HarnessProps {
  layout?: RowsLayout
  selection?: boolean
  onRowClick?: (row: Doc) => void
  renderDetail?: (row: Doc) => string
  totals?: Record<string, string>
}

function Harness({ layout = "cards", selection = false, onRowClick, renderDetail, totals }: HarnessProps) {
  const instance = useDataTable<Doc>({ id: "cards", columns, data: DOCS, features: { selection }, getRowId: (row) => row.id })
  return (
    <DataTable
      instance={instance}
      layout={layout}
      virtualize={false}
      {...(onRowClick ? { onRowClick } : {})}
      renderDetail={renderDetail}
      {...(totals ? { totals } : {})}
    />
  )
}

const cards = (): HTMLElement[] => within(screen.getByRole("list")).getAllByRole("listitem")
const place = (card: HTMLElement, className: string): string => card.querySelector(`.${className}`)?.textContent ?? ""

beforeEach(() => {
  localStorage.clear()
})

describe("cards", () => {
  it("draws a card per row and no table, each value in the place its column asks for", () => {
    render(<Harness />)
    expect(document.querySelector("table")).toBeNull()
    expect(document.querySelector(".dt-root")).toHaveAttribute("data-dt-layout", "cards")
    const [first] = cards()
    expect(cards()).toHaveLength(2)
    expect(place(first!, "dt-card-code")).toBe("PU-1")
    expect(place(first!, "dt-card-title")).toBe("Apple China")
    expect(place(first!, "dt-card-amount")).toBe("1 468.40 USD")
    expect(place(first!, "dt-card-note")).toBe("18 575 200 UZS")
    expect(place(first!, "dt-card-status")).toBe("Confirmed")
    expect(within(first!).getByRole("button", { name: "Menu" })).toBeInTheDocument()
    // A column with no place is a field: its label beside its value.
    expect(place(first!, "dt-card-fields")).toBe("NoteUrgent")
  })

  it("draws nothing for a blank value — no line, no dash", () => {
    render(<Harness />)
    const second = cards()[1]!
    expect(second.querySelector(".dt-card-title")).toBeNull()
    expect(second.querySelector(".dt-card-note")).toBeNull()
    expect(second.querySelector(".dt-card-fields")).toBeNull()
    expect(second.textContent).not.toContain("—")
  })

  it("opens the row on a click, but not from a control inside the card, and is no Tab stop of its own", () => {
    const onRowClick = vi.fn()
    render(<Harness onRowClick={onRowClick} />)
    const first = cards()[0]!
    fireEvent.click(first.querySelector(".dt-card-title")!)
    expect(onRowClick).toHaveBeenLastCalledWith(DOCS[0])
    fireEvent.click(within(first).getByRole("button", { name: "Menu" }))
    expect(onRowClick).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveAttribute("tabindex")
  })

  it("opens nothing from inside an open detail", () => {
    const onRowClick = vi.fn()
    render(<Harness onRowClick={onRowClick} renderDetail={(row) => `Lots of ${row.code}`} />)
    const first = cards()[0]!
    fireEvent.click(within(first).getByRole("button", { name: /1$/ }))
    fireEvent.click(first.querySelector(".dt-card-detail")!)
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it("leads each card with its checkbox when rows are selected, and marks the selected card", () => {
    render(<Harness selection />)
    const first = cards()[0]!
    const box = within(first).getByRole("checkbox")
    fireEvent.click(box)
    expect(box).toBeChecked()
    expect(first).toHaveAttribute("data-selected")
    expect(cards()[1]).not.toHaveAttribute("data-selected")
  })

  it("heads the list with a box that selects every row", () => {
    render(<Harness selection />)
    const all = screen.getAllByRole("checkbox")[0]!
    expect(all.closest(".dt-cards-head")).not.toBeNull()
    fireEvent.click(all)
    for (const card of cards()) expect(card).toHaveAttribute("data-selected")
  })

  it("opens a row's detail inside its card", () => {
    render(<Harness renderDetail={(row) => `Lots of ${row.code}`} />)
    const first = cards()[0]!
    expect(first.querySelector(".dt-card-detail")).toBeNull()
    fireEvent.click(within(first).getByRole("button", { name: /1$/ }))
    expect(place(first, "dt-card-detail")).toBe("Lots of PU-1")
  })

  it("draws the totals as a card of their own, each under its column's name", () => {
    render(<Harness totals={{ total: "1 468.40", base: "18 575 200" }} />)
    const totals = screen.getByRole("group", { name: "Total" })
    expect(place(totals, "dt-card-fields")).toBe("Total1 468.40Total, UZS18 575 200")
  })
})

describe("skeleton cards", () => {
  function Loading({ shown = columns }: { shown?: typeof columns }) {
    const instance = useDataTable<Doc>({ id: "cards-loading", columns: shown, data: [], getRowId: (row) => row.id })
    return <DataTable instance={instance} layout="cards" virtualize={false} loading />
  }

  it("take the cards' shape while the first page is on its way: a bar in each place a column fills", () => {
    render(<Loading />)
    const skeletons = document.querySelectorAll(".dt-card-skeleton")
    expect(skeletons.length).toBeGreaterThan(0)
    const first = skeletons[0]!
    for (const placed of ["dt-card-code", "dt-card-status", "dt-card-actions", "dt-card-title", "dt-card-amount", "dt-card-note"]) {
      expect(first.querySelector(`.${placed} .dt-card-bar`), placed).not.toBeNull()
    }
    // The one column with no place is a field: its label and value are bars too.
    expect(first.querySelectorAll(".dt-card-field")).toHaveLength(1)
    // No column is the subtitle, the chips or the trailing mark: no bar stands for them.
    expect(first.querySelector(".dt-card-subtitle")).toBeNull()
    expect(first.querySelector(".dt-card-foot")).toBeNull()
    expect(first).toHaveAttribute("aria-hidden", "true")
  })

  it("draw no top row for a table that places nothing there", () => {
    // The partner (the title) and the total (the amount) alone.
    render(<Loading shown={[columns[1]!, columns[2]!]} />)
    const first = document.querySelector(".dt-card-skeleton")!
    expect(first.querySelector(".dt-card-top")).toBeNull()
    expect(first.querySelector(".dt-card-title .dt-card-bar")).not.toBeNull()
    expect(first.querySelector(".dt-card-amount .dt-card-bar")).not.toBeNull()
  })
})

describe("cards that scroll on", () => {
  interface Item {
    id: string
    name: string
  }
  const itemHelper = createColumnHelper<DataTableFeatures, Item>()
  const itemColumns = [itemHelper.accessor("name", { header: "Name", meta: { card: "title" } })]
  const ALL: Item[] = Array.from({ length: 5 }, (_, index) => ({ id: `r${index}`, name: `Row ${index}` }))

  /** A server host that answers each page asked for, as a list screen does — with no `loading` of its own. */
  function ServerCards() {
    const [page, setPage] = useState(0)
    const instance = useDataTable<Item>({
      id: "infinite",
      columns: itemColumns,
      data: ALL.slice(page * 2, page * 2 + 2),
      mode: "server",
      rowCount: ALL.length,
      getRowId: (row) => row.id,
      pagination: { pageSize: 2 },
      onQueryChange: (query) => setPage(query.pagination.pageIndex),
    })
    return <DataTable instance={instance} layout="cards" virtualize={false} />
  }

  // jsdom has no IntersectionObserver: this one is told by the test when the mark after the last card is in view.
  let watchers: { callback: IntersectionObserverCallback; target: Element | null }[] = []
  beforeEach(() => {
    watchers = []
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        private readonly watcher: { callback: IntersectionObserverCallback; target: Element | null }
        constructor(callback: IntersectionObserverCallback) {
          this.watcher = { callback, target: null }
          watchers.push(this.watcher)
        }
        observe(target: Element) {
          this.watcher.target = target
        }
        disconnect() {
          watchers = watchers.filter((watcher) => watcher !== this.watcher)
        }
        unobserve() {}
        takeRecords() {
          return []
        }
      },
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  const reachTheEnd = () =>
    act(() => {
      for (const watcher of [...watchers]) {
        watcher.callback([{ isIntersecting: true, target: watcher.target } as IntersectionObserverEntry], {} as IntersectionObserver)
      }
    })
  const titles = () => [...document.querySelectorAll(".dt-card:not(.dt-card-skeleton) .dt-card-title")].map((title) => title.textContent)
  const count = () => document.querySelector(".dt-sidebar-shown [aria-hidden]")?.textContent

  it("draws the next page under the last as the last card comes into view, and counts what it draws", () => {
    render(<ServerCards />)
    expect(titles()).toEqual(["Row 0", "Row 1"])
    expect(count()).toBe("2/5")
    expect(screen.getByText("Showing 2 of 5")).toBeInTheDocument()

    reachTheEnd()
    expect(titles()).toEqual(["Row 0", "Row 1", "Row 2", "Row 3"])
    expect(count()).toBe("4/5")

    reachTheEnd()
    expect(titles()).toEqual(["Row 0", "Row 1", "Row 2", "Row 3", "Row 4"])
    expect(count()).toBe("5/5")
    // Every row is drawn: nothing is left to ask for.
    expect(document.querySelector(".dt-cards-more")).toBeNull()
  })

  it("draws no pager and offers no Columns tab over cards", () => {
    render(<ServerCards />)
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull()
    expect(screen.queryByRole("tab", { name: /Columns/ })).toBeNull()
  })

  it("starts over from the first page when the search changes", async () => {
    const user = userEvent.setup()
    render(<ServerCards />)
    reachTheEnd()
    expect(titles()).toHaveLength(4)
    await user.type(screen.getByRole("searchbox"), "R")
    await vi.waitFor(() => expect(titles()).toEqual(["Row 0", "Row 1"]))
  })
})

describe("auto", () => {
  it("draws cards below the breakpoint and the table above it, by the table's own width", () => {
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get")
    width.mockReturnValue(400)
    const { unmount } = render(<Harness layout="auto" />)
    expect(document.querySelector("table")).toBeNull()
    unmount()
    width.mockReturnValue(1024)
    render(<Harness layout="auto" />)
    expect(document.querySelector("table")).not.toBeNull()
    width.mockRestore()
  })

  it("keeps the table by default", () => {
    function Plain() {
      const instance = useDataTable<Doc>({ id: "plain", columns, data: DOCS, getRowId: (row) => row.id })
      return <DataTable instance={instance} virtualize={false} />
    }
    render(<Plain />)
    expect(document.querySelector("table")).not.toBeNull()
    expect(document.querySelector(".dt-root")).not.toHaveAttribute("data-dt-layout")
  })
})

describe("useInCard", () => {
  function Where() {
    return <>{useInCard() ? "card" : "table"}</>
  }
  const placed = [helper.accessor("code", { header: "Code", cell: () => <Where />, meta: { card: "title" } })]

  it("tells a cell it is on a card, and in the table that it is not", () => {
    function Both({ layout }: { layout: RowsLayout }) {
      const instance = useDataTable<Doc>({ id: `where-${layout}`, columns: placed, data: DOCS.slice(0, 1), getRowId: (row) => row.id })
      return <DataTable instance={instance} layout={layout} virtualize={false} />
    }
    const { unmount } = render(<Both layout="cards" />)
    expect(document.querySelector(".dt-card-title")?.textContent).toBe("card")
    unmount()
    render(<Both layout="table" />)
    expect(document.querySelector("tbody td[data-column-id='code']")?.textContent).toBe("table")
  })
})
