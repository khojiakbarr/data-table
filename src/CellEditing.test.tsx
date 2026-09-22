import { createColumnHelper } from "@tanstack/react-table"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import type { CellEdit } from "./core/cellEditing"
import type { FilterValue } from "./core/filters"
import type { GroupRow } from "./core/grouping"
import type { TableLayout } from "./types"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * Editing a cell from its context menu, end to end.
 *
 * Every case here is one of the things section 4 of the design said would go
 * wrong, and each is a real interaction rather than a unit of an internal —
 * the units are in `core/cellEditing.test.ts`. What makes editing awkward is
 * how it composes with grouping, virtualisation, filtering and a host that
 * answers slowly or not at all, and none of that is visible to a pure
 * function.
 */

interface Row {
  id: string
  code: string
  amount: number | null
  status: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("code", { header: "Code", size: 120, meta: { editable: "text" } }),
  helper.accessor("amount", {
    header: "Amount",
    size: 120,
    // The predicate form: the column offers an editor, and a closed row takes
    // it away. No `meta.filter`, so the kind is inferred as it is for a filter.
    meta: { editable: (row: Row) => row.status !== "closed" },
    // Formatted, so an optimistic value that skipped the column's own renderer
    // would be visible as a raw number where a formatted one belongs.
    cell: (info) => {
      const amount: number | null = info.getValue()
      return amount === null ? "—" : `$${amount}`
    },
  }),
  helper.accessor("status", { header: "Status", size: 120 }),
]

/** The same columns, with nothing editable at all. */
const plainColumns = [
  helper.accessor("code", { header: "Code", size: 120 }),
  helper.accessor("status", { header: "Status", size: 120 }),
]

const rows: Row[] = [
  { id: "r0", code: "KR-0", amount: 100, status: "open" },
  { id: "r1", code: "KR-1", amount: 200, status: "closed" },
  { id: "r2", code: "KR-2", amount: 300, status: "open" },
]

const groupRow = (path: FilterValue[], count: number): GroupRow => ({ kind: "group", path, count })

interface HarnessProps {
  data?: (Row | GroupRow)[]
  onCellEdit?: ((edit: CellEdit<Row>) => void | Promise<void>) | undefined
  editable?: boolean
  initialLayout?: Partial<TableLayout>
  virtualize?: boolean
}

function Harness({
  data = rows,
  onCellEdit,
  editable = true,
  initialLayout,
  virtualize = false,
}: HarnessProps) {
  const instance = useDataTable<Row>({
    id: "edit",
    columns: editable ? columns : plainColumns,
    data,
    mode: "server",
    rowCount: data.length,
    getRowId: (row) => row.id,
    ...(initialLayout === undefined ? {} : { initialLayout }),
  })
  return <DataTable instance={instance} virtualize={virtualize} onCellEdit={onCellEdit} />
}

/** Every rendered body row, spacers excluded. */
const bodyRows = (): HTMLElement[] =>
  screen.queryAllByRole("row").filter((row) => row.classList.contains("dt-tr"))

function cellAt(rowIndex: number, columnId: string): HTMLElement {
  const cell = bodyRows()[rowIndex]?.querySelector<HTMLElement>(`[data-column-id="${columnId}"]`)
  if (!cell) throw new Error(`no ${columnId} cell in row ${rowIndex}`)
  return cell
}

/** Right-click one cell. Returns false when the browser's own menu was suppressed. */
function rightClick(cell: HTMLElement): boolean {
  return fireEvent.contextMenu(cell, { clientX: 120, clientY: 40 })
}

const editItem = (): HTMLElement => screen.getByRole("menuitem", { name: /edit/i })

/**
 * The edit notice strip.
 *
 * Found by its own class rather than by role: a table has other live regions —
 * quick search announces its result count into one — and "the polite region"
 * is not a unique description of this strip.
 */
async function findNotice(): Promise<HTMLElement> {
  return await waitFor(() => {
    const notice = document.querySelector<HTMLElement>(".dt-edit-notice")
    if (!notice) throw new Error("no edit notice")
    return notice
  })
}

/** Open the menu on one cell and choose Edit. */
async function openEditor(rowIndex: number, columnId: string): Promise<HTMLElement> {
  rightClick(cellAt(rowIndex, columnId))
  fireEvent.click(editItem())
  return await screen.findByRole("textbox", { name: /value/i })
}

/** A promise the test resolves or rejects when it chooses to. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (why: unknown) => void } {
  let resolve = (): void => undefined
  let reject = (_why: unknown): void => undefined
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => localStorage.clear())

describe("the cell menu", () => {
  it("opens at the pointer, with Edit offered", () => {
    render(<Harness onCellEdit={vi.fn()} />)
    expect(rightClick(cellAt(0, "code"))).toBe(false)

    const menu = screen.getByRole("menu", { name: "Cell actions" })
    expect(menu.style.left).toBe("120px")
    expect(menu.style.top).toBe("40px")
    expect(editItem()).not.toHaveAttribute("aria-disabled")
  })

  it("still opens on a cell that cannot be edited, with the reason on Edit", () => {
    // §2: a menu that sometimes fails to appear teaches the user that the
    // feature is broken.
    render(<Harness onCellEdit={vi.fn()} />)
    rightClick(cellAt(0, "status"))

    expect(editItem()).toHaveAttribute("aria-disabled", "true")
    expect(editItem()).toHaveTextContent("This column cannot be edited")
  })

  it("blames the ROW when a predicate refused it, not the column", () => {
    render(<Harness onCellEdit={vi.fn()} />)
    // r1 is closed, and `amount` is editable everywhere else.
    rightClick(cellAt(1, "amount"))
    expect(editItem()).toHaveTextContent("This row cannot be edited")

    fireEvent.keyDown(document, { key: "Escape" })
    rightClick(cellAt(0, "amount"))
    expect(editItem()).not.toHaveAttribute("aria-disabled")
  })

  it("leaves the browser's own menu alone over a table nothing made editable", () => {
    render(<Harness editable={false} onCellEdit={vi.fn()} />)
    // Not prevented, so the browser opens its own — §2 forbids suppressing it
    // globally over a table with nothing to offer.
    expect(rightClick(cellAt(0, "code"))).toBe(true)
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("does not open while a column is being dragged", () => {
    // §4: a right-click during a drag is how a user gets out of the drag.
    render(<Harness onCellEdit={vi.fn()} />)
    const header = screen.getByRole("columnheader", { name: /code/i })
    // jsdom ships no DataTransfer, and the header's own handler writes to one.
    const store = new Map<string, string>()
    fireEvent.dragStart(header, {
      dataTransfer: {
        effectAllowed: "",
        dropEffect: "",
        setData: (format: string, value: string) => void store.set(format, value),
        getData: (format: string) => store.get(format) ?? "",
        setDragImage: () => undefined,
        types: [],
      },
    })

    expect(rightClick(cellAt(0, "code"))).toBe(true)
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("opens over a pinned cell, which sits in its own stacking context", () => {
    render(<Harness onCellEdit={vi.fn()} initialLayout={{ columnPinning: { start: ["code"], end: [] } }} />)
    const cell = cellAt(0, "code")
    expect(cell.classList.contains("dt-pinned")).toBe(true)

    rightClick(cell)
    expect(screen.getByRole("menu")).toBeInTheDocument()
  })

  it("gives the focus back to the cell it opened on", async () => {
    const user = userEvent.setup()
    render(<Harness onCellEdit={vi.fn()} />)
    const cell = cellAt(0, "code")
    rightClick(cell)
    expect(editItem()).toHaveFocus()

    await user.keyboard("{Escape}")
    await waitFor(() => expect(cell).toHaveFocus())
  })
})

describe("a group row and the group column", () => {
  const grouped = [groupRow(["open"], 2), rows[0]!, rows[2]!]

  it("offers the menu on a group row with nothing to edit", () => {
    render(
      <Harness
        data={grouped}
        onCellEdit={vi.fn()}
        initialLayout={{ grouping: ["status"], expanded: [["open"]] }}
      />,
    )
    const group = bodyRows()[0]
    expect(group?.classList.contains("dt-group-row")).toBe(true)

    rightClick(group!.querySelector<HTMLElement>('[data-column-id="code"]')!)
    expect(editItem()).toHaveAttribute("aria-disabled", "true")
    expect(editItem()).toHaveTextContent("A group row cannot be edited")
  })

  it("has nothing to edit in the grouped column on a record either", () => {
    // The grouped column left the body: its cell on a record carries the
    // record's indent and no value at all, whatever the column declared.
    render(
      <Harness
        data={grouped}
        onCellEdit={vi.fn()}
        initialLayout={{ grouping: ["code"], expanded: [["KR-0"]] }}
      />,
    )
    rightClick(cellAt(1, "code"))
    expect(editItem()).toHaveAttribute("aria-disabled", "true")
    expect(editItem()).toHaveTextContent("This column cannot be edited")
  })
})

describe("a table with no onCellEdit", () => {
  afterEach(() => vi.restoreAllMocks())

  it("disables Edit, says editing is unavailable, and warns once in development", () => {
    // One test rather than two: `warnOnce` is process-wide, so a second mount
    // in this file would find the warning already said and assert on nothing.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    render(<Harness />)
    rightClick(cellAt(0, "code"))

    expect(editItem()).toHaveAttribute("aria-disabled", "true")
    expect(editItem()).toHaveTextContent("Editing is not available")
    expect(warn.mock.calls.flat().join(" ")).toContain("onCellEdit")
  })
})

describe("committing an edit", () => {
  it("hands the host the row, the column, the new value and the previous one", async () => {
    const user = userEvent.setup()
    const onCellEdit = vi.fn<(edit: CellEdit<Row>) => void>()
    render(<Harness onCellEdit={onCellEdit} />)

    const field = await openEditor(0, "code")
    expect(field).toHaveValue("KR-0")
    await user.clear(field)
    await user.type(field, "KR-999{Enter}")

    expect(onCellEdit).toHaveBeenCalledTimes(1)
    expect(onCellEdit.mock.calls[0]?.[0]).toEqual({
      row: rows[0],
      columnId: "code",
      value: "KR-999",
      previous: "KR-0",
    })
  })

  it("restores the value and writes nothing when Escape cancels", async () => {
    const user = userEvent.setup()
    const onCellEdit = vi.fn()
    render(<Harness onCellEdit={onCellEdit} />)

    const field = await openEditor(0, "code")
    await user.clear(field)
    await user.type(field, "KR-999{Escape}")

    expect(onCellEdit).not.toHaveBeenCalled()
    expect(cellAt(0, "code")).toHaveTextContent("KR-0")
  })

  it("gives the focus back to the cell when Escape cancels the edit", async () => {
    // Without this the editor's own field is gone and the focus drops onto
    // `<body>`, restarting the next Tab at the top of the document.
    const user = userEvent.setup()
    render(<Harness onCellEdit={vi.fn()} />)

    const field = await openEditor(0, "code")
    await user.type(field, "{Escape}")

    await waitFor(() => expect(cellAt(0, "code")).toHaveFocus())
  })

  it("gives the focus back to the cell once Enter commits it", async () => {
    const user = userEvent.setup()
    const onCellEdit = vi.fn<(edit: CellEdit<Row>) => void>()
    render(<Harness onCellEdit={onCellEdit} />)

    const field = await openEditor(0, "code")
    await user.clear(field)
    await user.type(field, "KR-999{Enter}")

    expect(onCellEdit).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(cellAt(0, "code")).toHaveFocus())
  })

  it("never sends a commit that changed nothing", async () => {
    const user = userEvent.setup()
    const onCellEdit = vi.fn()
    render(<Harness onCellEdit={onCellEdit} />)

    const field = await openEditor(0, "code")
    await user.type(field, "{Enter}")

    // In a server-first table `onCellEdit` is a request, and a user who opened
    // an editor and touched nothing has not edited a row.
    expect(onCellEdit).not.toHaveBeenCalled()
  })

  it("keeps the editor open, and says why, for a value it cannot parse", async () => {
    const user = userEvent.setup()
    const onCellEdit = vi.fn()
    render(<Harness onCellEdit={onCellEdit} />)

    const field = await openEditor(0, "amount")
    await user.clear(field)
    await user.type(field, "twelve{Enter}")

    expect(onCellEdit).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number")
    expect(field).toBeInTheDocument()
  })

  it("captures `previous` when the editor opened, not when it committed", async () => {
    // §4: a refetch between the two must not rewrite what the edit was "from".
    const user = userEvent.setup()
    const onCellEdit = vi.fn<(edit: CellEdit<Row>) => void>()
    const { rerender } = render(<Harness onCellEdit={onCellEdit} />)

    const field = await openEditor(0, "amount")
    rerender(
      <Harness
        onCellEdit={onCellEdit}
        data={[{ ...rows[0]!, amount: 999 }, rows[1]!, rows[2]!]}
      />,
    )

    await user.clear(field)
    await user.type(field, "555{Enter}")
    expect(onCellEdit.mock.calls[0]?.[0].previous).toBe(100)
  })
})

describe("optimism and failure", () => {
  it("shows the new value while the write is in flight, marked pending", async () => {
    const user = userEvent.setup()
    const inFlight = deferred()
    render(<Harness onCellEdit={() => inFlight.promise} />)

    const field = await openEditor(0, "amount")
    await user.clear(field)
    await user.type(field, "555{Enter}")

    const cell = cellAt(0, "amount")
    // Through the column's OWN renderer: a raw 555 here would mean the
    // optimistic value skipped it and the cell changed how it reads.
    expect(cell).toHaveTextContent("$555")
    expect(cell).toHaveAttribute("data-dt-pending")
    expect(cell).toHaveTextContent("Saving")

    await act(async () => {
      inFlight.resolve()
      await inFlight.promise
    })
    expect(cellAt(0, "amount")).not.toHaveAttribute("data-dt-pending")
    expect(cellAt(0, "amount")).toHaveTextContent("$555")
  })

  it("reverts and says why when the host refuses the write", async () => {
    const user = userEvent.setup()
    const inFlight = deferred()
    render(<Harness onCellEdit={() => inFlight.promise} />)

    const field = await openEditor(0, "amount")
    await user.clear(field)
    await user.type(field, "-5{Enter}")
    expect(cellAt(0, "amount")).toHaveTextContent("$-5")

    await act(async () => {
      inFlight.reject(new Error("An amount cannot be negative"))
      await inFlight.promise.catch(() => undefined)
    })

    expect(cellAt(0, "amount")).toHaveTextContent("$100")
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Could not save Amount")
    expect(alert).toHaveTextContent("An amount cannot be negative")
  })

  it("gives the focus back to the cell on a commit the host rejects", async () => {
    // The editor closes the moment Enter is pressed — settle() runs
    // synchronously, before the host's promise settles — so the focus
    // returns to the cell right away and the later revert must not steal it.
    const user = userEvent.setup()
    const inFlight = deferred()
    render(<Harness onCellEdit={() => inFlight.promise} />)

    const field = await openEditor(0, "amount")
    await user.clear(field)
    await user.type(field, "-5{Enter}")
    await waitFor(() => expect(cellAt(0, "amount")).toHaveFocus())

    await act(async () => {
      inFlight.reject(new Error("An amount cannot be negative"))
      await inFlight.promise.catch(() => undefined)
    })

    expect(cellAt(0, "amount")).toHaveFocus()
  })

  it("keeps the failure on screen until it is dismissed — no timer", async () => {
    const user = userEvent.setup()
    render(<Harness onCellEdit={() => Promise.reject(new Error("nope"))} />)

    const field = await openEditor(0, "code")
    await user.clear(field)
    await user.type(field, "KR-9{Enter}")
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Could not save Code")

    // A notice that removes itself removes itself while somebody is reading.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByRole("alert")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("reverts a handler that threw without ever returning a promise", async () => {
    const user = userEvent.setup()
    render(
      <Harness
        onCellEdit={() => {
          throw new Error("refused outright")
        }}
      />,
    )

    const field = await openEditor(0, "code")
    await user.clear(field)
    await user.type(field, "KR-9{Enter}")

    expect(cellAt(0, "code")).toHaveTextContent("KR-0")
    expect(screen.getByRole("alert")).toHaveTextContent("refused outright")
  })

  it("steps aside for the host's refetch, even when the server answered differently", async () => {
    // §3: in server mode the host refetches after a successful edit, and the
    // optimistic value must not fight the answer that replaces it.
    const user = userEvent.setup()
    const { rerender } = render(<Harness onCellEdit={() => Promise.resolve()} />)

    const field = await openEditor(0, "amount")
    await user.clear(field)
    await user.type(field, "555{Enter}")
    await act(async () => {
      await Promise.resolve()
    })
    // Still ours: the host has not answered yet, and reverting here would show
    // the old value back for as long as the round trip takes.
    expect(cellAt(0, "amount")).toHaveTextContent("$555")

    // The server rounded it. Its answer wins outright.
    rerender(
      <Harness
        onCellEdit={() => Promise.resolve()}
        data={[{ ...rows[0]!, amount: 560 }, rows[1]!, rows[2]!]}
      />,
    )
    await waitFor(() => expect(cellAt(0, "amount")).toHaveTextContent("$560"))
  })

  it("says so when a saved edit moved its row out of what the filters match", async () => {
    // §4: correct behaviour that looks exactly like a row disappearing for no
    // reason, unless something says otherwise.
    const user = userEvent.setup()
    const { rerender } = render(
      <Harness onCellEdit={() => Promise.resolve()} initialLayout={{ search: "KR" }} />,
    )

    const field = await openEditor(0, "code")
    await user.clear(field)
    await user.type(field, "ZZ-9{Enter}")
    await act(async () => {
      await Promise.resolve()
    })

    rerender(
      <Harness
        onCellEdit={() => Promise.resolve()}
        initialLayout={{ search: "KR" }}
        data={[rows[1]!, rows[2]!]}
      />,
    )
    const notice = await findNotice()
    expect(notice).toHaveTextContent("Code was saved")
    expect(notice).toHaveTextContent("no longer matches the filters")
  })
})

describe("Tab through the editable cells", () => {
  it("commits and opens the next editable cell in the row", async () => {
    const user = userEvent.setup()
    const onCellEdit = vi.fn<(edit: CellEdit<Row>) => void>()
    render(<Harness onCellEdit={onCellEdit} />)

    const field = await openEditor(0, "code")
    await user.clear(field)
    await user.type(field, "KR-7")
    await user.tab()

    expect(onCellEdit.mock.calls[0]?.[0]).toMatchObject({ columnId: "code", value: "KR-7" })
    // The next editable cell in the SAME row is Amount; Status declares nothing.
    const next = await screen.findByRole("textbox", { name: /value/i })
    expect(cellAt(0, "amount").contains(next)).toBe(true)
  })

  it("wraps past the row's last editable cell into the next row", async () => {
    const user = userEvent.setup()
    render(<Harness onCellEdit={vi.fn()} />)

    await openEditor(0, "amount")
    await user.tab()

    // r1 is closed, so its Amount is not editable and its Code is the next
    // cell the walk finds.
    const next = await screen.findByRole("textbox", { name: /value/i })
    expect(cellAt(1, "code").contains(next)).toBe(true)
  })

  it("does not move on from a value the editor refused", async () => {
    // §3: an invalid value does not commit, so Tab must not carry the focus
    // away from the field that is explaining why.
    const user = userEvent.setup()
    const onCellEdit = vi.fn()
    render(<Harness onCellEdit={onCellEdit} />)

    const field = await openEditor(0, "amount")
    await user.clear(field)
    await user.type(field, "twelve")
    await user.tab()

    expect(onCellEdit).not.toHaveBeenCalled()
    expect(field).toHaveFocus()
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number")
  })
})

describe("an editor whose row leaves the page", () => {
  it("cancels the edit and says so rather than losing it in silence", async () => {
    // §4: the row was refetched away underneath an open editor. The same
    // signal a virtualised scroll produces — the row stops being rendered.
    const { rerender } = render(<Harness onCellEdit={vi.fn()} />)
    await openEditor(0, "code")

    rerender(<Harness onCellEdit={vi.fn()} data={[rows[1]!, rows[2]!]} />)

    await waitFor(() => expect(screen.queryByRole("textbox", { name: /value/i })).toBeNull())
    const notice = await findNotice()
    expect(notice).toHaveTextContent("The edit to Code was cancelled")
    expect(notice).toHaveTextContent("the row left the page")
  })
})

describe("a virtualised row scrolled out from under its editor", () => {
  const many: Row[] = Array.from({ length: 60 }, (_, index) => ({
    id: `v${index}`,
    code: `KR-${index}`,
    amount: index,
    status: "open",
  }))

  let restoreSize: () => void

  beforeEach(() => {
    // jsdom lays nothing out: the virtualiser sizes its scroller from
    // offsetHeight, and scrolling is a scrollTop plus a scroll event.
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains("dt-viewport") ? 200 : 0
      },
    })
    restoreSize = () => {
      if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height)
      else delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight
    }
  })
  afterEach(() => restoreSize())

  it("abandons the edit out loud when the row is windowed out", async () => {
    render(<Harness data={many} onCellEdit={vi.fn()} virtualize />)
    await openEditor(0, "code")

    const viewport = document.querySelector<HTMLElement>(".dt-viewport")!
    await act(async () => {
      viewport.scrollTop = 2000
      fireEvent.scroll(viewport)
    })

    await waitFor(() => expect(screen.queryByRole("textbox", { name: /value/i })).toBeNull())
    expect(await findNotice()).toHaveTextContent("was cancelled")
  })
})
