import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import { localStorageLayout } from "./core/persistence"
import { useDataTable, type DataTableFeatures, type DataTableInstance } from "./useDataTable"

/**
 * Column resizing.
 *
 * jsdom has no layout engine, so nothing here reads a bounding box. What can
 * be asserted is the contract the browser is given: the widths written to the
 * <colgroup>, the table's own width rule, and the DOM shape that keeps a
 * sticky header from sliding under the toolbar. Text measurement for autosize
 * goes through a canvas, which jsdom does not implement; a fake context that
 * charges a fixed width per character makes the arithmetic checkable.
 */

const CHAR_PX = 7

function installFakeCanvas() {
  const original = HTMLCanvasElement.prototype.getContext
  const fake = () => ({
    font: "",
    measureText: (text: string) => ({ width: text.length * CHAR_PX }),
  })
  HTMLCanvasElement.prototype.getContext = fake as unknown as typeof original
  return () => {
    HTMLCanvasElement.prototype.getContext = original
  }
}

interface Row {
  code: string
  partner: string
  amount: number
  children?: Row[]
}

const rows: Row[] = [
  { code: "KR-1", partner: "Alpha", amount: 10 },
  { code: "KR-2", partner: "Beta", amount: 20 },
]

const helper = createColumnHelper<DataTableFeatures, Row>()
const flat = [
  helper.accessor("code", { header: "Code", size: 100 }),
  helper.accessor("partner", { header: "Partner", size: 200 }),
  helper.accessor("amount", { header: "Amount", size: 120 }),
]

const grouped = [
  helper.accessor("code", { header: "Code", size: 100 }),
  helper.group({
    id: "doc",
    header: "Document",
    columns: helper.columns([
      helper.accessor("partner", { header: "Partner", size: 200 }),
      helper.accessor("amount", { header: "Amount", size: 100 }),
    ]),
  }),
]

type Options = Partial<Parameters<typeof useDataTable<Row>>[0]>

let latest: DataTableInstance<Row> | null = null

/** A table whose instance the test can reach. */
function makeTable(options: Options = {}, props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return function Table() {
    const instance = useDataTable<Row>({ id: "r", data: rows, columns: flat, ...options })
    latest = instance
    return <DataTable instance={instance} {...props} />
  }
}

const colWidths = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("colgroup col:not(.dt-col-filler)")].map(
    (col) => col.style.width,
  )

const handleFor = (name: RegExp) => screen.getByRole("button", { name })

/** Drag a resize handle by `delta` pixels, the way TanStack listens for it. */
function drag(handle: HTMLElement, from: number, delta: number) {
  fireEvent.mouseDown(handle, { clientX: from, clientY: 10, button: 0 })
  fireEvent.mouseMove(document, { clientX: from + delta / 2, clientY: 10 })
  fireEvent.mouseMove(document, { clientX: from + delta, clientY: 10 })
  fireEvent.mouseUp(document, { clientX: from + delta, clientY: 10 })
}

describe("resizing", () => {
  beforeEach(() => localStorage.clear())

  it("moves only the dragged column, by the dragged distance", () => {
    const Table = makeTable()
    const { container } = render(<Table />)

    drag(handleFor(/partner: resize column/i), 300, 60)

    expect(colWidths(container)).toEqual(["100px", "260px", "120px"])
  })

  it("never lets the browser stretch columns to fill the container", () => {
    const Table = makeTable()
    const { container } = render(<Table />)
    const table = container.querySelector("table") as HTMLTableElement

    // As wide as the container or as wide as the columns, whichever is larger;
    // the difference is absorbed by a filler column, not shared out.
    expect(table.style.width).toBe("100%")
    expect(table.style.minWidth).toBe("420px")
    expect(container.querySelectorAll("colgroup col")).toHaveLength(4)
    expect(container.querySelector("colgroup col:last-child")?.className).toBe("dt-col-filler")
    expect((container.querySelector("tbody tr") as HTMLElement).children).toHaveLength(4)
  })

  it("puts the filler between the centre and the end-pinned columns", () => {
    const Table = makeTable({
      initialLayout: { columnPinning: { start: ["code"], end: ["amount"] } },
    })
    const { container } = render(<Table />)

    const bodyCells = [...(container.querySelector("tbody tr") as HTMLElement).children]
    expect(bodyCells.map((cell) => cell.classList.contains("dt-td-filler"))).toEqual([
      false,
      false,
      true,
      false,
    ])
    const headerCells = [...(container.querySelector("thead tr") as HTMLElement).children]
    expect(headerCells.map((cell) => cell.classList.contains("dt-th-filler"))).toEqual([
      false,
      false,
      true,
      false,
    ])
  })

  it("keeps the toolbar outside the scrolling viewport", () => {
    const Table = makeTable({}, { height: 200 })
    const { container } = render(<Table />)

    const viewport = container.querySelector(".dt-viewport") as HTMLElement
    expect(viewport.querySelector("table")).not.toBeNull()
    expect(viewport.querySelector(".dt-toolbar")).toBeNull()
    expect((container.querySelector(".dt-root") as HTMLElement).style.height).toBe("200px")
  })

  it("stops the default so a drag cannot select text or start a column drag", () => {
    const Table = makeTable()
    render(<Table />)

    const notPrevented = fireEvent.mouseDown(handleFor(/partner: resize column/i), {
      clientX: 300,
      button: 0,
    })
    expect(notPrevented).toBe(false)
    fireEvent.mouseUp(document, { clientX: 300 })
  })

  it("refuses a header drag that starts on the handle", () => {
    const Table = makeTable()
    render(<Table />)

    const handle = handleFor(/partner: resize column/i)
    const notPrevented = fireEvent.dragStart(handle, { dataTransfer: { setData: () => undefined } })
    expect(notPrevented).toBe(false)
  })

  it("marks the root while a drag is in progress", () => {
    const Table = makeTable()
    const { container } = render(<Table />)
    const root = container.querySelector(".dt-root") as HTMLElement

    fireEvent.mouseDown(handleFor(/partner: resize column/i), { clientX: 300, button: 0 })
    expect(root.className).toContain("dt-is-resizing")
    fireEvent.mouseUp(document, { clientX: 320 })
    expect(root.className).not.toContain("dt-is-resizing")
  })

  it("treats a press-and-release on the handle as nothing", () => {
    vi.useFakeTimers()
    try {
      const Table = makeTable({ storage: localStorageLayout() })
      render(<Table />)

      fireEvent.mouseDown(handleFor(/partner: resize column/i), { clientX: 300, button: 0 })
      fireEvent.mouseUp(document, { clientX: 300 })
      vi.advanceTimersByTime(500)

      expect(latest?.isCustomised).toBe(false)
      expect(localStorage.getItem("data-table:layout:r")).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("saves a settled drag once, and clamped", () => {
    vi.useFakeTimers()
    try {
      const Table = makeTable({ storage: localStorageLayout() })
      render(<Table />)

      // Far past the minimum: TanStack would store 0, the table stores 60.
      drag(handleFor(/partner: resize column/i), 300, -500)
      vi.advanceTimersByTime(500)

      const stored = JSON.parse(localStorage.getItem("data-table:layout:r") ?? "null")
      expect(stored?.layout.columnSizing).toEqual({ partner: 60 })
      expect(latest?.isCustomised).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("moves a pinned neighbour's offset along with the dragged width", () => {
    const Table = makeTable({
      initialLayout: { columnPinning: { start: ["code", "partner"], end: [] } },
    })
    render(<Table />)

    drag(handleFor(/code: resize column/i), 100, 40)

    expect(screen.getByRole("columnheader", { name: /partner/i }).style.insetInlineStart).toBe(
      "140px",
    )
  })

  it("scales every leaf of a group when its handle is dragged", () => {
    const Table = makeTable({ columns: grouped })
    const { container } = render(<Table />)

    // The group is 300 wide; +60 is +20% for each leaf.
    drag(handleFor(/document: resize column/i), 400, 60)

    expect(colWidths(container)).toEqual(["100px", "240px", "120px"])
    // Only leaves have widths; the group's own id must not creep in.
    expect(Object.keys(latest?.table.state.columnSizing ?? {})).toEqual(["partner", "amount"])
  })

  it("widens by a step from the keyboard, and shrinks no further than the minimum", () => {
    const Table = makeTable({ minColumnWidth: 180 })
    const { container } = render(<Table />)
    const handle = handleFor(/partner: resize column/i)

    fireEvent.keyDown(handle, { key: "ArrowRight" })
    expect(colWidths(container)[1]).toBe("210px")
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true })
    expect(colWidths(container)[1]).toBe("260px")
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true })
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true })
    expect(colWidths(container)[1]).toBe("180px")
  })

  it("reads a right-to-left drag in the direction the handle sits", () => {
    const Table = makeTable({ direction: "rtl" })
    const { container } = render(<Table />)

    // In RTL the handle is on the column's left edge: dragging left widens.
    drag(handleFor(/partner: resize column/i), 300, -60)

    expect(colWidths(container)[1]).toBe("260px")
  })

  it("offers no handle and no width actions for a column that opts out", async () => {
    const user = userEvent.setup()
    const Table = makeTable({
      columns: [
        helper.accessor("code", { header: "Code", size: 100, enableResizing: false }),
        flat[1] as (typeof flat)[number],
      ],
    })
    render(<Table />)

    expect(screen.queryByRole("button", { name: /code: resize column/i })).toBeNull()
    expect(screen.getByRole("button", { name: /partner: resize column/i })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /code: column actions/i }))
    expect(screen.queryByRole("menuitem", { name: /fit this column/i })).toBeNull()
    expect(screen.queryByRole("menuitem", { name: /reset width/i })).toBeNull()
  })
})

describe("autosize", () => {
  let restore: () => void
  beforeEach(() => {
    localStorage.clear()
    restore = installFakeCanvas()
  })
  afterEach(() => restore())

  async function fit(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
    await user.click(screen.getByRole("button", { name }))
    await user.click(screen.getByRole("menuitem", { name: /fit this column/i }))
  }

  it("measures the column's own header under grouped headers", async () => {
    const user = userEvent.setup()
    const Table = makeTable({ columns: grouped })
    const { container } = render(<Table />)

    await fit(user, /code: column actions/i)

    // "Code" is 4 characters: 28 + 46 header chrome = 74. The cells "KR-1" are
    // 28 + 28 = 56. Measuring the wrong header ("Amount", 6 chars) gives 88.
    expect(colWidths(container)[0]).toBe("74px")
  })

  it("fits the column on a double-click of its handle", () => {
    const Table = makeTable({ columns: grouped })
    const { container } = render(<Table />)

    fireEvent.doubleClick(handleFor(/code: resize column/i))

    expect(colWidths(container)[0]).toBe("74px")
  })

  it("fits every leaf, and nothing else, on a double-click of a group's handle", () => {
    const Table = makeTable({ columns: grouped })
    const { container } = render(<Table />)

    fireEvent.doubleClick(handleFor(/document: resize column/i))

    // "Partner" 7 chars: 49 + 46 = 95; "Amount" 6 chars: 42 + 46 = 88.
    expect(colWidths(container)).toEqual(["100px", "95px", "88px"])
    expect(Object.keys(latest?.table.state.columnSizing ?? {})).toEqual(["partner", "amount"])
  })

  it("ignores the cells of a table nested in a detail panel", async () => {
    const inner = [helper.accessor("code", { header: "Inner", size: 100 })]
    function Inner() {
      const instance = useDataTable<Row>({
        id: "inner",
        data: [{ code: "X".repeat(60), partner: "", amount: 0 }],
        columns: inner,
      })
      return <DataTable instance={instance} toolbar={false} />
    }
    const user = userEvent.setup()
    const Table = makeTable({}, { renderDetail: () => <Inner /> })
    const { container } = render(<Table />)

    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)
    await fit(user, /code: column actions/i)

    // Header "Code" 74 beats the cells at 56 plus the toggle's 24: 80.
    expect(colWidths(container)[0]).toBe("80px")
  })

  it("leaves room for the toggle and the indent in a tree's lead column", async () => {
    const tree: Row[] = [
      {
        code: "Cement",
        partner: "",
        amount: 1,
        children: [
          { code: "Clinker", partner: "", amount: 1, children: [{ code: "Lime", partner: "", amount: 1 }] },
        ],
      },
    ]
    const user = userEvent.setup()
    const Table = makeTable({ data: tree, getSubRows: (row) => row.children })
    const { container } = render(<Table />)

    await user.click(screen.getByRole("button", { name: /expand row/i }))
    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)
    await fit(user, /code: column actions/i)

    // "Clinker" at depth 1 with a toggle: 49 + 28 + 24 + one 18px indent = 119.
    expect(colWidths(container)[0]).toBe("119px")
  })

  it("clamps to the table's configured maximum width", async () => {
    const user = userEvent.setup()
    const Table = makeTable({
      data: [{ code: "K".repeat(40), partner: "", amount: 0 }],
      maxColumnWidth: 150,
    })
    const { container } = render(<Table />)

    await fit(user, /code: column actions/i)

    expect(colWidths(container)[0]).toBe("150px")
  })

  it("keeps a group label readable when all columns are fitted", async () => {
    const user = userEvent.setup()
    const Table = makeTable({
      columns: [
        helper.group({
          id: "doc",
          header: "A very long document group",
          columns: helper.columns([flat[1]!, flat[2]!]),
        }),
      ],
    })
    const { container } = render(<Table />)

    await user.click(screen.getByRole("button", { name: /partner: column actions/i }))
    await user.click(screen.getByRole("menuitem", { name: /fit all columns/i }))

    // Leaves fit to 95 and 88; the 26-character label needs 228, so the
    // 45px shortfall is split between them.
    expect(colWidths(container)).toEqual(["118px", "111px"])
  })
})
