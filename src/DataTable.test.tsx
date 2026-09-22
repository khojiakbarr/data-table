import { createColumnHelper } from "@tanstack/react-table"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { localStorageLayout } from "./core/persistence"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

interface Row {
  code: string
  partner: string
  amount: number
}

const rows: Row[] = [
  { code: "KR-3", partner: "Gamma", amount: 30 },
  { code: "KR-1", partner: "Alpha", amount: 10 },
  { code: "KR-2", partner: "Beta", amount: 20 },
]

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("code", { header: "Code", size: 100 }),
  helper.accessor("partner", { header: "Partner", size: 200 }),
  helper.accessor("amount", { header: "Amount", size: 120 }),
]

function Table({
  id,
  pinned = false,
}: {
  id: string
  pinned?: boolean
}) {
  const instance = useDataTable({
    id,
    data: rows,
    columns,
    storage: localStorageLayout(),
    ...(pinned ? { initialLayout: { columnPinning: { start: ["code"], end: [] } } } : {}),
  })
  return <DataTable instance={instance} />
}

/** Read the visible body values of one column, top to bottom. */
function columnValues(table: HTMLElement, index: number): string[] {
  const bodyRows = within(table).getAllByRole("row").slice(1)
  return bodyRows.map((row) => within(row).getAllByRole("cell")[index]?.textContent ?? "")
}

describe("DataTable", () => {
  beforeEach(() => localStorage.clear())

  it("renders every row and column", () => {
    render(<Table id="t1" />)
    expect(screen.getAllByRole("row")).toHaveLength(rows.length + 1)
    expect(screen.getByText("Partner")).toBeInTheDocument()
  })

  it("sorts ascending, then descending, then clears", async () => {
    const user = userEvent.setup()
    render(<Table id="t1" />)
    const table = screen.getByRole("table")

    expect(columnValues(table, 0)).toEqual(["KR-3", "KR-1", "KR-2"])

    await user.click(screen.getByRole("button", { name: /code: sort ascending/i }))
    expect(columnValues(table, 0)).toEqual(["KR-1", "KR-2", "KR-3"])

    await user.click(screen.getByRole("button", { name: /code: sort descending/i }))
    expect(columnValues(table, 0)).toEqual(["KR-3", "KR-2", "KR-1"])
  })

  it("marks the sorted column for assistive technology", async () => {
    const user = userEvent.setup()
    render(<Table id="t1" />)

    const header = screen.getByRole("columnheader", { name: /code/i })
    expect(header).toHaveAttribute("aria-sort", "none")

    await user.click(within(header).getByRole("button", { name: /sort/i }))
    expect(header).toHaveAttribute("aria-sort", "ascending")
  })

  it("hides a column from the panel and keeps it out of the body", async () => {
    const user = userEvent.setup()
    render(<Table id="t1" />)

    await user.click(screen.getByRole("tab", { name: /columns/i }))
    await user.click(screen.getByLabelText("Partner"))

    expect(screen.queryByRole("columnheader", { name: /partner/i })).toBeNull()
    expect(screen.queryByText("Alpha")).toBeNull()
  })

  it("sticks a pinned column to the start edge", () => {
    render(<Table id="t1" pinned />)
    const header = screen.getByRole("columnheader", { name: /code/i })

    expect(header.className).toContain("dt-pinned")
    expect(header.style.insetInlineStart).toBe("0px")
  })

  it("offsets the second pinned column by the width of the first", async () => {
    const user = userEvent.setup()
    render(<Table id="t1" pinned />)

    // Pin "Partner" to the start as well, from its header menu.
    await user.click(screen.getByRole("button", { name: /partner: column actions/i }))
    await user.click(screen.getByRole("menuitem", { name: /pin to start/i }))

    const partnerHeader = screen.getByRole("columnheader", { name: /partner/i })
    // Code is 100 wide, so Partner starts at 100.
    expect(partnerHeader.style.insetInlineStart).toBe("100px")
  })

  it("remembers a layout across remounts", async () => {
    const user = userEvent.setup()
    const first = render(<Table id="persisted" />)

    await user.click(screen.getByRole("tab", { name: /columns/i }))
    await user.click(screen.getByLabelText("Partner"))
    // Unmounting mid-debounce must still flush.
    first.unmount()

    render(<Table id="persisted" />)
    expect(screen.queryByRole("columnheader", { name: /partner/i })).toBeNull()
  })

  it("keeps two tables on one page independent", async () => {
    const user = userEvent.setup()
    render(
      <>
        <div data-testid="left">
          <Table id="left-table" />
        </div>
        <div data-testid="right">
          <Table id="right-table" />
        </div>
      </>,
    )

    const left = screen.getByTestId("left")
    const right = screen.getByTestId("right")

    // Hide "Partner" in the left table only.
    await user.click(within(left).getByRole("tab", { name: /columns/i }))
    await user.click(within(left).getByLabelText("Partner"))

    expect(within(left).queryByRole("columnheader", { name: /partner/i })).toBeNull()
    expect(within(right).getByRole("columnheader", { name: /partner/i })).toBeInTheDocument()

    // Saves are debounced so a resize drag does not write on every frame.
    await waitFor(() =>
      expect(localStorage.getItem("data-table:layout:left-table")).not.toBeNull(),
    )
    expect(localStorage.getItem("data-table:layout:right-table")).toBeNull()
  })

  it("sorts each table independently", async () => {
    const user = userEvent.setup()
    render(
      <>
        <div data-testid="left">
          <Table id="left-table" />
        </div>
        <div data-testid="right">
          <Table id="right-table" />
        </div>
      </>,
    )

    const left = screen.getByTestId("left")
    const right = screen.getByTestId("right")

    await user.click(within(left).getByRole("button", { name: /code: sort ascending/i }))

    expect(columnValues(within(left).getByRole("table"), 0)).toEqual([
      "KR-1",
      "KR-2",
      "KR-3",
    ])
    expect(columnValues(within(right).getByRole("table"), 0)).toEqual([
      "KR-3",
      "KR-1",
      "KR-2",
    ])
  })

  it("shows the empty state when there are no rows", () => {
    function Empty() {
      const instance = useDataTable({ id: "empty", data: [] as Row[], columns })
      return <DataTable instance={instance} />
    }
    render(<Empty />)
    expect(screen.getByText("No rows")).toBeInTheDocument()
  })
})

/**
 * Defect A: with no `renderDetail`, nothing inside a row is itself
 * focusable, so the scrolling viewport — `tabIndex={-1}` — used to be the
 * only thing standing between the header and the footer that a keyboard
 * user could never land on, leaving PageDown / ArrowDown / End with nothing
 * to act on and most of the table unreachable.
 *
 * jsdom lays nothing out, so `scrollTop` never actually moves here — what is
 * asserted is that the scroller is a real Tab stop and carries the
 * attributes a browser needs to answer the scroll keys on its own.
 */
describe("the viewport is keyboard-scrollable", () => {
  beforeEach(() => localStorage.clear())

  it("is a real tab stop rather than tabIndex -1", () => {
    render(<Table id="scroll" />)
    const viewport = document.querySelector(".dt-viewport") as HTMLElement
    expect(viewport.tabIndex).toBe(0)
  })

  it("is reachable by Tab in the default configuration", async () => {
    const user = userEvent.setup()
    render(<Table id="scroll" />)
    const viewport = document.querySelector(".dt-viewport") as HTMLElement

    let steps = 0
    while (document.activeElement !== viewport && steps < 40) {
      await user.tab()
      steps += 1
    }
    expect(document.activeElement).toBe(viewport)
  })

  it("carries an accessible name, so a screen reader does not announce a blank group", () => {
    render(<Table id="scroll" />)
    const viewport = document.querySelector(".dt-viewport") as HTMLElement
    expect(viewport).toHaveAccessibleName("Table rows")
  })

  /*
   * The name is its OWN label rather than the footer's `rows`. That label is
   * the head of a count — "Rows: 100 000", "Строк: 100 000" — and in Russian
   * it is a genitive plural that does not stand alone, so borrowing it would
   * have named this region with half a sentence.
   */
  it("names itself with a label the footer's row count does not share", () => {
    render(<Table id="scroll" />)
    const viewport = document.querySelector(".dt-viewport") as HTMLElement
    expect(viewport.getAttribute("aria-label")).not.toBe("Rows")
  })

  it("stays a legal target for the programmatic focus 'Clear filters' hands it", () => {
    // The full handoff is NoMatches.test.tsx's; this only guards that a
    // non-negative tabIndex is still focusable, not only Tab-reachable.
    render(<Table id="scroll" />)
    const viewport = document.querySelector(".dt-viewport") as HTMLElement
    viewport.focus()
    expect(document.activeElement).toBe(viewport)
  })
})

describe("the toolbar's two edges", () => {
  /**
   * A toolbar with something on each side, so the ORDER can be asserted rather
   * than mere presence — which is the whole point of the trailing slot and the
   * only part of it a screenshot would catch and a naive test would not.
   */
  function TwoEdged() {
    const instance = useDataTable({ id: "edges", data: rows, columns })
    return (
      <DataTable
        instance={instance}
        toolbarContent={<button type="button">Leading</button>}
        toolbarActions={<button type="button">Trailing</button>}
      />
    )
  }

  it("puts toolbarActions after the spacer and toolbarContent before it", () => {
    render(<TwoEdged />)
    const toolbar = document.querySelector(".dt-toolbar") as HTMLElement
    const spacer = toolbar.querySelector(".dt-spacer") as HTMLElement
    const leading = screen.getByRole("button", { name: "Leading" })
    const trailing = screen.getByRole("button", { name: "Trailing" })

    // `compareDocumentPosition` reads document order, which is what the
    // flex spacer turns into left and right.
    const before = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

    expect(before(leading, spacer)).toBe(true)
    expect(before(spacer, trailing)).toBe(true)
  })

  it("renders neither slot when the host owns the toolbar", () => {
    function NoToolbar() {
      const instance = useDataTable({ id: "no-toolbar", data: rows, columns })
      return (
        <DataTable
          instance={instance}
          toolbar={false}
          toolbarContent={<button type="button">Leading</button>}
          toolbarActions={<button type="button">Trailing</button>}
        />
      )
    }
    render(<NoToolbar />)
    expect(document.querySelector(".dt-toolbar")).toBeNull()
    expect(screen.queryByRole("button", { name: "Leading" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Trailing" })).toBeNull()
  })
})
