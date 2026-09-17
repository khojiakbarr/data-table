import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable, defaultLabels } from "./components/DataTable"
import { canFilterColumn, FilterEditor } from "./components/FilterEditor"
import type { FilterCondition } from "./core/filters"
import { useDataTable, type DataTableFeatures } from "./useDataTable"
import type { TableLayout } from "./types"

/**
 * The editor both filter surfaces are built from, rendered on its own beside
 * the table it filters. Every case reads the result off the rows, which is
 * what a user would look at.
 */

interface Row {
  id: string
  name: string
  amount: number
  when: string
  tag: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 100 }),
  helper.accessor("amount", { header: "Amount", size: 100 }),
  helper.accessor("when", { header: "When", size: 100, meta: { filter: "date" } }),
  helper.accessor("tag", { header: "Tag", size: 100, meta: { filter: "list" } }),
  helper.accessor("id", { header: "Id", size: 100, meta: { filter: false } }),
]
const data: Row[] = [
  { id: "r0", name: "Agro Ltd", amount: 15, when: "2026-03-30", tag: "open" },
  { id: "r1", name: "Temir", amount: 500, when: "2026-03-31", tag: "closed" },
  { id: "r2", name: "", amount: 900, when: "2026-04-01", tag: "open" },
]

interface TableProps {
  columnId: string
  initialLayout?: Partial<TableLayout>
  onCommit?: () => void
  autoFocus?: boolean
}

function Table({ columnId, initialLayout, onCommit, autoFocus = false }: TableProps) {
  const instance = useDataTable<Row>({
    id: "editor",
    columns,
    data,
    getRowId: (row) => row.id,
    ...(initialLayout === undefined ? {} : { initialLayout }),
  })
  return (
    <>
      <FilterEditor
        instance={instance}
        column={instance.table.getColumn(columnId)!}
        labels={defaultLabels}
        onCommit={onCommit}
        autoFocus={autoFocus}
      />
      <DataTable instance={instance} virtualize={false} />
    </>
  )
}

/** The row names on screen, in order. */
const shown = () =>
  screen
    .getAllByRole("row")
    .filter((row) => row.classList.contains("dt-tr"))
    .map((row) => row.textContent)

beforeEach(() => localStorage.clear())

describe("the filter editor", () => {
  it("commits a typed value when the field is left, not on the keystroke", () => {
    render(<Table columnId="name" />)
    const field = screen.getByLabelText("Name: Value")

    fireEvent.change(field, { target: { value: "temir" } })
    // A keystroke is not a decision, and a column filter is never debounced:
    // nothing has been applied yet.
    expect(shown()).toHaveLength(3)

    fireEvent.blur(field)
    expect(shown()).toHaveLength(1)
  })

  it("commits on Apply, and tells its caller it has", () => {
    const onCommit = vi.fn()
    render(<Table columnId="name" onCommit={onCommit} />)

    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "agro" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))

    expect(shown()).toHaveLength(1)
    // The popover in Task 16 closes on this, so Apply without it would leave
    // the editor open over a table that has already changed underneath it.
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it("commits on Enter from the value field", () => {
    const onCommit = vi.fn()
    render(<Table columnId="name" onCommit={onCommit} />)
    const field = screen.getByLabelText("Name: Value")

    fireEvent.change(field, { target: { value: "temir" } })
    fireEvent.keyDown(field, { key: "Enter" })

    expect(shown()).toHaveLength(1)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it("applies an operator choice at once", () => {
    render(<Table columnId="name" />)

    fireEvent.change(screen.getByLabelText("Name: Operator"), { target: { value: "blank" } })

    // Blankness is an operator on every kind: the row whose name is "" is the
    // only one left, and no Apply was needed.
    expect(shown()).toHaveLength(1)
  })

  it("hides the value field for an operator that carries no value", () => {
    render(<Table columnId="name" />)

    fireEvent.change(screen.getByLabelText("Name: Operator"), { target: { value: "notBlank" } })

    expect(screen.queryByLabelText("Name: Value")).toBeNull()
  })

  it("turns a picked day into a half-open range of one day", () => {
    render(<Table columnId="when" />)

    fireEvent.change(screen.getByLabelText("When: Value"), { target: { value: "2026-03-31" } })

    // 31 Mar is `[2026-03-31, 2026-04-01)`: the row on 1 Apr is outside it.
    expect(shown()).toHaveLength(1)
    expect(shown()[0]).toContain("Temir")
  })

  it("takes two bounds for a range, and swaps them when they are reversed", () => {
    render(<Table columnId="amount" />)

    fireEvent.change(screen.getByLabelText("Amount: Operator"), { target: { value: "between" } })
    fireEvent.change(screen.getByLabelText("Amount: To"), { target: { value: "10" } })
    fireEvent.change(screen.getByLabelText("Amount: From"), { target: { value: "600" } })
    fireEvent.blur(screen.getByLabelText("Amount: From"))

    // 600–10 is published as 10–600, so the two middle rows survive.
    expect(shown()).toHaveLength(2)
  })

  it("waits for blur on a typed number too, not for the keystroke", () => {
    render(<Table columnId="amount" />)
    const field = screen.getByLabelText("Amount: Value")

    fireEvent.change(field, { target: { value: "500" } })
    expect(shown()).toHaveLength(3)

    fireEvent.blur(field)
    expect(shown()).toHaveLength(1)
  })

  it("clears the column from the editor", () => {
    render(<Table columnId="name" />)
    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })
    fireEvent.blur(screen.getByLabelText("Name: Value"))
    expect(shown()).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }))

    expect(shown()).toHaveLength(3)
  })

  it("empties its own draft when it clears, and tells its caller", () => {
    const onCommit = vi.fn()
    render(<Table columnId="name" onCommit={onCommit} />)
    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })
    fireEvent.blur(screen.getByLabelText("Name: Value"))

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }))

    // The draft is seeded once and never synced, so Clear has to empty it
    // itself — otherwise the next blur re-applies the filter just removed.
    expect(screen.getByLabelText("Name: Value")).toHaveValue("")
    expect(onCommit).toHaveBeenCalledTimes(1)
    fireEvent.blur(screen.getByLabelText("Name: Value"))
    expect(shown()).toHaveLength(3)
  })

  it("opens showing the condition the column already carries", () => {
    const contains: FilterCondition = { kind: "text", field: "name", op: "contains", value: "temir" }
    render(<Table columnId="name" initialLayout={{ filters: [contains] }} />)

    expect(screen.getByLabelText("Name: Operator")).toHaveValue("contains")
    expect(screen.getByLabelText("Name: Value")).toHaveValue("temir")
  })

  it("says a list column has no choices yet rather than showing an empty list", () => {
    render(<Table columnId="tag" />)

    // Task 18 brings the real values list. Until then §5.3's rule holds: an
    // empty checkbox list reads as "there is no data".
    expect(screen.getByText(defaultLabels.noValues)).toBeInTheDocument()
    expect(screen.queryByLabelText("Tag: Value")).toBeNull()
  })

  it("renders nothing for a column whose host turned filtering off", () => {
    const { container } = render(<Table columnId="id" />)

    // `meta: { filter: false }`. TanStack's own `getCanFilter()` knows nothing
    // about it, so the editor has to check the resolved kind as well.
    expect(container.querySelector(".dt-filter-editor")).toBeNull()
  })

  it("renders nothing for a column whose kind has not resolved yet, rather than seeding a wrong draft", () => {
    const restored: FilterCondition = { kind: "number", field: "amount", op: "gte", value: 500 }
    let filters: readonly FilterCondition[] = []
    function ResolvingTable() {
      const [rows, setRows] = useState<Row[]>([])
      const instance = useDataTable<Row>({
        id: "editor-resolving",
        columns,
        data: rows,
        getRowId: (row) => row.id,
        initialLayout: { filters: [restored] },
      })
      filters = instance.filtering.conditions
      return (
        <>
          <button type="button" onClick={() => setRows(data)}>
            Load rows
          </button>
          <FilterEditor instance={instance} column={instance.table.getColumn("amount")!} labels={defaultLabels} />
        </>
      )
    }
    render(<ResolvingTable />)

    // No rows yet: "amount" declares no `meta.filter` and has no sample to
    // infer from, so its kind is unresolved — the editor must render nothing
    // rather than seed a "text" draft that a later remount cannot correct.
    expect(screen.queryByLabelText("Amount: Value")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Load rows" }))

    // The kind now resolves to "number": the editor mounts fresh, seeded
    // from the restored condition rather than an empty "text" draft.
    const field = screen.getByLabelText("Amount: Value")
    expect(field).toHaveAttribute("type", "number")
    expect(field).toHaveDisplayValue("500")

    fireEvent.blur(field)

    // Before the fix, the remount key was `column.id` alone, so the body
    // never remounted once the kind resolved: it kept the empty "text" draft
    // seeded on the first (kind-unresolved) render, and this untouched blur
    // committed that empty draft as `null`, silently deleting the restored
    // filter.
    expect(filters).toEqual([restored])
  })

  it("renders no editor for a column canFilterColumn refuses through getCanFilter, even though its kind resolves", () => {
    const restrictedColumns = [
      helper.accessor("name", { header: "Name", size: 100, enableColumnFilter: false }),
      helper.display({ id: "actions", header: "Actions", size: 60, meta: { filter: "text" } }),
    ]
    function RestrictedTable({ columnId }: { columnId: string }) {
      const instance = useDataTable<Row>({
        id: "editor-restricted",
        columns: restrictedColumns,
        data,
        getRowId: (row) => row.id,
      })
      return <FilterEditor instance={instance} column={instance.table.getColumn(columnId)!} labels={defaultLabels} />
    }

    // `enableColumnFilter: false`: TanStack's own `getCanFilter()` refuses it,
    // even though its kind resolves to "text" from the sample data — the
    // editor's own gate has to agree, not just accept a resolved kind.
    const disabled = render(<RestrictedTable columnId="name" />)
    expect(disabled.container.querySelector(".dt-filter-editor")).toBeNull()
    disabled.unmount()

    // A display column: `getCanFilter()` refuses it for having no accessor,
    // even though `meta: { filter: "text" }` resolves a kind on its own.
    const display = render(<RestrictedTable columnId="actions" />)
    expect(display.container.querySelector(".dt-filter-editor")).toBeNull()
  })

  it("takes the focus on mount when its caller asks for it", () => {
    render(<Table columnId="name" autoFocus />)

    expect(screen.getByLabelText("Name: Value")).toHaveFocus()
  })

  it("focuses the operator select when the operator leaves no field to type in", () => {
    const blank: FilterCondition = { kind: "text", field: "name", op: "blank" }
    render(<Table columnId="name" initialLayout={{ filters: [blank] }} autoFocus />)

    expect(screen.getByLabelText("Name: Operator")).toHaveFocus()
  })

  it("focuses the operator select for a list column, whose fields offer nothing focusable", () => {
    // A list draft's default operator is "in", not "blank": `DraftFields`
    // renders the `noValues` note for it (Task 18 brings the real values
    // list), and a note is not focusable. Without the fallback this leaves
    // focus on `<body>`.
    render(<Table columnId="tag" autoFocus />)

    expect(screen.getByLabelText("Tag: Operator")).toHaveFocus()
  })

  it("lets Enter on the Clear button clear the filter, rather than re-applying it", async () => {
    // `user.keyboard` models the browser's own activation behaviour, where a
    // button's keydown default action IS its click — `fireEvent.keyDown`
    // alone does not fire that click, so it would not catch this regression.
    const user = userEvent.setup()
    const contains: FilterCondition = { kind: "text", field: "name", op: "contains", value: "temir" }
    render(<Table columnId="name" initialLayout={{ filters: [contains] }} />)
    expect(shown()).toHaveLength(1)

    screen.getByRole("button", { name: "Clear filter" }).focus()
    await user.keyboard("{Enter}")

    // Before the fix, the wrapper's own keydown handler ran `commit(draft)`
    // ahead of the button's click, so the seeded "contains temir" draft was
    // re-applied instead of the column being cleared.
    expect(shown()).toHaveLength(3)
  })

  it("ignores an Enter that is still composing an IME candidate", () => {
    const onCommit = vi.fn()
    render(<Table columnId="name" onCommit={onCommit} />)
    const field = screen.getByLabelText("Name: Value")

    fireEvent.change(field, { target: { value: "te" } })
    fireEvent.keyDown(field, { key: "Enter", isComposing: true })

    // A composing Enter confirms the IME candidate, not the filter: the
    // half-typed text must not commit, and the popover must not be told to
    // close mid-word.
    expect(shown()).toHaveLength(3)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("does not reset the page when a blur or a Clear changes nothing", () => {
    const pagedData: Row[] = Array.from({ length: 25 }, (_, index) => ({
      id: `p${index}`,
      name: `Row ${index}`,
      amount: index,
      when: "2026-03-30",
      tag: "open",
    }))
    let pageIndex = -1
    function PagedTable() {
      const instance = useDataTable<Row>({
        id: "editor-paged",
        columns,
        data: pagedData,
        getRowId: (row) => row.id,
        pagination: { pageSize: 10 },
      })
      pageIndex = instance.pagination.pageIndex
      return (
        <>
          <button type="button" onClick={() => instance.pagination.setPageIndex(2)}>
            Go to page 3
          </button>
          <FilterEditor instance={instance} column={instance.table.getColumn("name")!} labels={defaultLabels} />
        </>
      )
    }
    render(<PagedTable />)

    fireEvent.click(screen.getByRole("button", { name: "Go to page 3" }))
    expect(pageIndex).toBe(2)

    // Untouched and empty: the built condition is null and the column
    // carries none either, so this blur is a genuine no-op.
    fireEvent.blur(screen.getByLabelText("Name: Value"))
    expect(pageIndex).toBe(2)

    // Same column, still no condition: Clear has nothing to clear either.
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }))
    expect(pageIndex).toBe(2)
  })

  it("reseeds the draft when the column prop changes without a remount", () => {
    function SwappableTable() {
      const instance = useDataTable<Row>({ id: "editor-swap", columns, data, getRowId: (row) => row.id })
      const [columnId, setColumnId] = useState("name")
      return (
        <>
          <button type="button" onClick={() => setColumnId("amount")}>
            Switch to Amount
          </button>
          <FilterEditor instance={instance} column={instance.table.getColumn(columnId)!} labels={defaultLabels} />
        </>
      )
    }
    render(<SwappableTable />)

    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "agro" } })
    fireEvent.click(screen.getByRole("button", { name: "Switch to Amount" }))

    // Before the fix, nothing keyed the editor on the column, so the text
    // draft ("agro") survived under the new column's label and rendered as a
    // `type="text"` field even though Amount is a number column. `toHaveValue`
    // treats an empty number input specially, so the display value is what's
    // asserted here.
    const value = screen.getByLabelText("Amount: Value")
    expect(value).toHaveDisplayValue("")
    expect(value).toHaveAttribute("type", "number")
  })
})

describe("canFilterColumn", () => {
  it("refuses a column whose host turned filtering off, and allows the rest", () => {
    let answers: { id: boolean; name: boolean } | null = null
    function Probe() {
      const instance = useDataTable<Row>({ id: "can-filter", columns, data, getRowId: (row) => row.id })
      answers = {
        id: canFilterColumn(instance, instance.table.getColumn("id")!),
        name: canFilterColumn(instance, instance.table.getColumn("name")!),
      }
      return null
    }
    render(<Probe />)

    expect(answers).toEqual({ id: false, name: true })
  })

  it("refuses every column when the host turned filtering off for the whole table", () => {
    // `filterKinds` is resolved from the column definitions regardless of
    // `filteringEnabled`, so an ordinary column (unlike `id`, above) still
    // has a resolved kind — the gate has to read `filtering.enabled` itself.
    let answer: boolean | null = null
    function Probe() {
      const instance = useDataTable<Row>({
        id: "can-filter-off",
        columns,
        data,
        getRowId: (row) => row.id,
        filtering: false,
      })
      answer = canFilterColumn(instance, instance.table.getColumn("name")!)
      return null
    }
    render(<Probe />)

    expect(answer).toBe(false)
  })
})

describe("a table with filtering turned off", () => {
  it("renders no editor, even for a column that would otherwise get one", () => {
    function OffTable() {
      const instance = useDataTable<Row>({
        id: "editor-off",
        columns,
        data,
        getRowId: (row) => row.id,
        filtering: false,
      })
      return <FilterEditor instance={instance} column={instance.table.getColumn("name")!} labels={defaultLabels} />
    }
    const { container } = render(<OffTable />)

    // Before the fix this rendered a fully interactive editor whose Apply
    // and Clear silently did nothing, because `updateFilters` swallows every
    // write when `filtering: false` — a field that accepts input but drops
    // it is worse than no field.
    expect(container.querySelector(".dt-filter-editor")).toBeNull()
  })
})
