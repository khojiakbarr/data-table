import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable, defaultLabels } from "./components/DataTable"
import { FilterEditor } from "./components/FilterEditor"
import type { FilterCondition, FilterValueOption } from "./core/filters"
import { useDataTable, type DataTableFeatures, type DataTableInstance } from "./useDataTable"

/**
 * The values list: where its choices come from, in which order of preference,
 * and what it does when there is no source at all.
 */

interface Row {
  id: string
  name: string
  tag: string
  size: string
  when: Date
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 100 }),
  helper.accessor("tag", { header: "Tag", size: 100, meta: { filter: "list" } }),
  helper.accessor("size", {
    header: "Size",
    size: 100,
    meta: {
      filter: "list",
      values: [
        { value: "s", label: "Small" },
        { value: "m", label: "Medium" },
      ],
    },
  }),
  // Dates are not JSON primitives, so they can never become a condition.
  helper.accessor("when", { header: "When", size: 100, meta: { filter: "list" } }),
]
const data: Row[] = [
  { id: "r0", name: "Agro Ltd", tag: "open", size: "s", when: new Date(2026, 2, 30) },
  { id: "r1", name: "Temir", tag: "open", size: "m", when: new Date(2026, 2, 31) },
  { id: "r2", name: "Kimyo", tag: "closed", size: "s", when: new Date(2026, 3, 1) },
  { id: "r3", name: "Nur", tag: "", size: "m", when: new Date(2026, 3, 2) },
]

/**
 * The conditions the table has actually committed, rendered beside the editor.
 *
 * In server mode no row ever leaves the table, so the rendered rows cannot say
 * whether a click changed the model — and "changed nothing" is exactly what
 * the blank-operator cases below have to prove.
 */
function ConditionsProbe({ instance }: { instance: DataTableInstance<Row> }) {
  return <span data-testid="conditions">{JSON.stringify(instance.filtering.conditions)}</span>
}

function Table({
  columnId,
  server = false,
  loadValues,
}: {
  columnId: string
  server?: boolean
  loadValues?: (columnId: string, options: { search: string; signal: AbortSignal }) => Promise<FilterValueOption[]>
}) {
  const instance = useDataTable<Row>({
    id: "values",
    columns,
    data,
    getRowId: (row) => row.id,
    ...(server ? { mode: "server" as const, rowCount: data.length } : {}),
    ...(loadValues === undefined ? {} : { filtering: { loadValues } }),
  })
  return (
    <>
      <FilterEditor
        instance={instance}
        column={instance.table.getColumn(columnId)!}
        labels={defaultLabels}
      />
      <ConditionsProbe instance={instance} />
      <DataTable instance={instance} virtualize={false} />
    </>
  )
}

/** Two editors open at once, so one column's filter can narrow another's facets. */
function TwoFilterTable() {
  const instance = useDataTable<Row>({
    id: "values-two-filters",
    columns,
    data,
    getRowId: (row) => row.id,
  })
  return (
    <>
      <FilterEditor
        instance={instance}
        column={instance.table.getColumn("tag")!}
        labels={defaultLabels}
      />
      <FilterEditor
        instance={instance}
        column={instance.table.getColumn("name")!}
        labels={defaultLabels}
      />
      <DataTable instance={instance} virtualize={false} />
    </>
  )
}

/** A client-mode column with no rows yet — the ordinary first render of async client data. */
function EmptyDataTable() {
  const instance = useDataTable<Row>({
    id: "values-empty-data",
    columns,
    data: [],
    getRowId: (row) => row.id,
  })
  return (
    <FilterEditor
      instance={instance}
      column={instance.table.getColumn("tag")!}
      labels={defaultLabels}
    />
  )
}

/** Every row blank on the filtered column: faceting runs, but finds no real value. */
function BlanksOnlyTable() {
  const rows: Row[] = [
    { id: "b0", name: "A", tag: "", size: "s", when: new Date(2026, 0, 1) },
    { id: "b1", name: "B", tag: "", size: "m", when: new Date(2026, 0, 2) },
  ]
  const instance = useDataTable<Row>({
    id: "values-blanks-only",
    columns,
    data: rows,
    getRowId: (row) => row.id,
  })
  return (
    <FilterEditor
      instance={instance}
      column={instance.table.getColumn("tag")!}
      labels={defaultLabels}
    />
  )
}

/**
 * A host that re-renders with a fresh `loadValues` arrow every time, the shape
 * `filtering={{ loadValues: (id, o) => api.facets(id, o) }}` produces and the
 * one a host wired to TanStack Query hands down on every `isFetching` flip.
 */
function LiveCallbackTable({ spy }: { spy: (columnId: string, options: { search: string }) => void }) {
  const [, forceRerender] = useState(0)
  const instance = useDataTable<Row>({
    id: "values-live-callback",
    columns,
    data,
    getRowId: (row) => row.id,
    mode: "server",
    rowCount: data.length,
    filtering: {
      loadValues: async (columnId, options) => {
        spy(columnId, { search: options.search })
        return [{ value: "open", count: 7 }]
      },
    },
  })
  return (
    <>
      <FilterEditor
        instance={instance}
        column={instance.table.getColumn("tag")!}
        labels={defaultLabels}
      />
      <button type="button" onClick={() => forceRerender((count) => count + 1)}>
        Re-render host
      </button>
    </>
  )
}

const shown = () => screen.getAllByRole("row").filter((row) => row.classList.contains("dt-tr"))
/** The list item one checkbox sits in, so its count can be read beside it. */
const itemFor = (name: string) => screen.getByLabelText(name).closest("li") as HTMLElement
/** What {@link ConditionsProbe} reports the table is currently filtering by. */
const conditions = (): FilterCondition[] =>
  JSON.parse(screen.getByTestId("conditions").textContent ?? "[]") as FilterCondition[]
/** A `loadValues` that never settles, so the request stays in flight. */
const neverSettles = () => new Promise<FilterValueOption[]>(() => undefined)

beforeEach(() => localStorage.clear())

describe("a values filter", () => {
  it("lists a column's distinct values with their counts, client-side", () => {
    render(<Table columnId="tag" />)

    expect(within(itemFor("closed")).getByText("1")).toBeInTheDocument()
    expect(within(itemFor("open")).getByText("2")).toBeInTheDocument()
    // The blank row is counted, not listed: blankness is an operator.
    expect(within(itemFor("(Blanks)")).getByText("1")).toBeInTheDocument()
  })

  it("ticks values into an in condition", async () => {
    const user = userEvent.setup()
    render(<Table columnId="tag" />)

    await user.click(screen.getByLabelText("open"))

    expect(shown()).toHaveLength(2)
  })

  it("emits a blank condition for (Blanks) rather than a null member", async () => {
    const user = userEvent.setup()
    render(<Table columnId="tag" />)

    await user.click(screen.getByLabelText("(Blanks)"))

    // `{ op: "in", values: [null] }` would match here and return nothing from a
    // backend, because `NULL = ANY(ARRAY[NULL])` is NULL and never true.
    expect(shown()).toHaveLength(1)
    expect(screen.getByLabelText("Tag: Operator")).toHaveValue("blank")
  })

  it("prefers meta.values over faceting, and then shows no counts", () => {
    render(<Table columnId="size" />)

    expect(screen.getByLabelText("Small")).toBeInTheDocument()
    // The host supplied labels rather than data, so there is nothing to count.
    expect(within(itemFor("Small")).queryByText("2")).toBeNull()
  })

  it("refuses facets that could never become a condition", () => {
    render(<Table columnId="when" />)

    // Two Dates are structurally equal to `layoutSliceEqual`, so ticking a
    // different one would be dropped as a no-op. No list at all is honest.
    expect(screen.getByText("No values to choose from")).toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("asks the host in server mode, and lists what it answers", async () => {
    const loadValues = vi.fn().mockResolvedValue([
      { value: "open", count: 7 },
      { value: "closed", count: 3 },
    ])
    render(<Table columnId="tag" server loadValues={loadValues} />)

    expect(await screen.findByLabelText("open")).toBeInTheDocument()
    expect(within(itemFor("open")).getByText("7")).toBeInTheDocument()
    expect(loadValues).toHaveBeenCalledWith("tag", expect.objectContaining({ search: "" }))
  })

  it("shows a failure line with a retry when loadValues rejects", async () => {
    const loadValues = vi
      .fn()
      .mockRejectedValueOnce(new Error("no"))
      .mockResolvedValue([{ value: "open", count: 7 }])
    const user = userEvent.setup()
    render(<Table columnId="tag" server loadValues={loadValues} />)

    expect(await screen.findByText("Could not load values")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Retry" }))

    expect(await screen.findByLabelText("open")).toBeInTheDocument()
    expect(screen.queryByText("Could not load values")).toBeNull()
  })

  it("keeps the last answer on screen, marked busy, while a new one is in flight", async () => {
    let release: ((options: FilterValueOption[]) => void) | undefined
    const loadValues = vi
      .fn()
      .mockResolvedValueOnce([{ value: "open", count: 7 }])
      .mockImplementationOnce(
        () => new Promise<FilterValueOption[]>((resolve) => { release = resolve }),
      )
    const user = userEvent.setup()
    render(<Table columnId="tag" server loadValues={loadValues} />)
    expect(await screen.findByLabelText("open")).toBeInTheDocument()

    await user.type(screen.getByLabelText("Tag: Search values"), "op")
    await waitFor(() => expect(loadValues).toHaveBeenCalledTimes(2))

    // The fourth state this surface owes. The first answer is still readable
    // while the second request is out — going blank would be the same "there
    // is no data" lie an empty list tells — and the list says it is stale
    // rather than pretending to be current.
    expect(screen.getByLabelText("open")).toBeInTheDocument()
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true")

    release?.([{ value: "open", count: 2 }])
    await waitFor(() => expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "false"))
    expect(within(itemFor("open")).getByText("2")).toBeInTheDocument()
  })

  it("is disabled with a label in server mode when nothing can supply values", () => {
    render(<Table columnId="tag" server />)

    // Faceting is off in server mode — it could only compute a confidently
    // wrong list from the one page in hand — and there is no callback.
    expect(screen.getByText("No values to choose from")).toBeInTheDocument()
  })

  it("keeps a ticked value listed and checked once another filter narrows it out of the facets", async () => {
    const user = userEvent.setup()
    render(<TwoFilterTable />)

    await user.click(screen.getByLabelText("open"))
    expect(shown()).toHaveLength(2)

    await user.type(screen.getByLabelText("Name: Value"), "Kimyo")
    await user.tab()

    // The Name filter now excludes every "open" row, so `tag`'s facets —
    // narrowed by every OTHER column's filter — no longer contain "open" at
    // all. The condition still does, and the list must say so: an unticked
    // "open" here would contradict the very filter hiding every row.
    expect(shown()).toHaveLength(0)
    expect(screen.getByLabelText("open")).toBeChecked()
  })

  it("keeps a hidden selection when Select all is ticked under a search", async () => {
    const user = userEvent.setup()
    render(<Table columnId="tag" />)

    await user.click(screen.getByLabelText("open"))
    expect(shown()).toHaveLength(2)

    await user.type(screen.getByLabelText("Tag: Search values"), "cl")
    await user.click(screen.getByLabelText("Select all"))

    // Select all must union the visible slice into the existing selection,
    // not replace it: "open" was ticked before the search and is not shown
    // under "cl", so it must survive.
    expect(screen.getByLabelText("Tag: Operator")).toHaveValue("in")
    expect(shown()).toHaveLength(3)
  })

  it("keeps a hidden selection when Select all is unticked under a search", async () => {
    const user = userEvent.setup()
    render(<Table columnId="tag" />)

    await user.click(screen.getByLabelText("open"))
    await user.click(screen.getByLabelText("closed"))
    expect(shown()).toHaveLength(3)

    await user.type(screen.getByLabelText("Tag: Search values"), "cl")
    expect(screen.getByLabelText("Select all")).toBeChecked()
    await user.click(screen.getByLabelText("Select all"))

    // Unticking Select all under a search must only drop the visible member
    // ("closed"): "open" was never shown under "cl" and the user never acted
    // on it, so the condition must still carry it.
    expect(shown()).toHaveLength(2)
    expect(screen.getByLabelText("Tag: Operator")).toHaveValue("in")
  })

  it("shows a note instead of a bare checkbox list when a search matches nothing", async () => {
    const user = userEvent.setup()
    render(<Table columnId="tag" />)

    await user.type(screen.getByLabelText("Tag: Search values"), "zzz")

    // A source that exists but produced nothing is still the no-choices case:
    // an empty `<ul>` here reads as "there is no data", and a live Select All
    // left over it would write `values: []` on a stray click, which
    // `draftToCondition` turns into null and silently clears the filter.
    expect(screen.getByText("No values to choose from")).toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("shows a note rather than an empty checkbox list for a column with no rows yet", () => {
    render(<EmptyDataTable />)

    // The ordinary first render of async client data: a source (faceting)
    // exists, but it has nothing to offer yet. Byte-identical to the "no
    // matches" case above, and the same lie either way if left unhandled.
    expect(screen.getByText("No values to choose from")).toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("does not refetch when the host hands down a fresh loadValues on every render", async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    render(<LiveCallbackTable spy={spy} />)

    expect(await screen.findByLabelText("open")).toBeInTheDocument()
    expect(spy).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: "Re-render host" }))
    await user.click(screen.getByRole("button", { name: "Re-render host" }))

    // `loadValues` is held in a ref, the same contract `useTableQuery`'s
    // `onQueryChange` documents: an inline arrow's new identity on every host
    // render must not refire the effect, or a host that re-renders faster
    // than the backend answers would re-issue and abort the request forever.
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("keeps the (Blanks) row when faceting counts blank rows but finds no other value", () => {
    render(<BlanksOnlyTable />)

    // Blankness is an operator, not a member of the values list: a note that
    // there is nothing to *pick* must not also hide the one control that lets
    // the user filter for blankness — which is exactly what is left to filter
    // on here (facets = { options: [], blanks: 2 }).
    expect(screen.getByText("No values to choose from")).toBeInTheDocument()
    expect(screen.getByLabelText("(Blanks)")).toBeInTheDocument()
    expect(screen.queryByLabelText("Select all")).toBeNull()
  })

  it("keeps a ticked (Blanks) visible and checked under a search that does not match it", async () => {
    const user = userEvent.setup()
    render(<Table columnId="tag" />)

    await user.click(screen.getByLabelText("(Blanks)"))
    expect(screen.getByLabelText("(Blanks)")).toBeChecked()

    await user.type(screen.getByLabelText("Tag: Search values"), "zzz")

    // Without this, a user who ticks (Blanks) and then types anything that
    // does not literally match "(Blanks)" loses the only control that could
    // untick it, short of clearing the search first.
    expect(screen.getByLabelText("(Blanks)")).toBeInTheDocument()
    expect(screen.getByLabelText("(Blanks)")).toBeChecked()
  })

  it("trusts the host's answer instead of re-filtering it by a literal substring match", async () => {
    // A backend that matches more broadly than a literal substring — the
    // common Postgres unaccent/ILIKE case, or any transliterating search —
    // can resolve a label that does not itself contain the typed needle.
    const loadValues = vi.fn().mockResolvedValue([{ value: "José" }])
    const user = userEvent.setup()
    render(<Table columnId="tag" server loadValues={loadValues} />)
    expect(await screen.findByLabelText("José")).toBeInTheDocument()

    await user.type(screen.getByLabelText("Tag: Search values"), "jose")
    await waitFor(() =>
      expect(loadValues).toHaveBeenCalledWith("tag", expect.objectContaining({ search: "jose" })),
    )

    // "josé" does not contain "jose": a local `.includes()` re-filter would
    // drop the server's own answer and show the "no data" lie in its place.
    expect(screen.getByLabelText("José")).toBeInTheDocument()
    expect(screen.queryByText("No values to choose from")).toBeNull()
  })

  it("keeps a stale server answer listed while a new one is in flight, even when it does not match what was typed", async () => {
    let release: ((options: FilterValueOption[]) => void) | undefined
    const loadValues = vi
      .fn()
      .mockResolvedValueOnce([
        { value: "INV-1001", count: 1 },
        { value: "INV-1002", count: 1 },
      ])
      .mockImplementationOnce(
        () => new Promise<FilterValueOption[]>((resolve) => { release = resolve }),
      )
    const user = userEvent.setup()
    render(<Table columnId="tag" server loadValues={loadValues} />)
    expect(await screen.findByLabelText("INV-1001")).toBeInTheDocument()

    await user.type(screen.getByLabelText("Tag: Search values"), "2024")
    await waitFor(() => expect(loadValues).toHaveBeenCalledTimes(2))

    // Neither stale label contains "2024": narrowing them locally against the
    // immediate needle — rather than trusting the request already out for it
    // — would clear the list and flip to the "no data" note before the server
    // has even answered for what was typed.
    expect(screen.getByLabelText("INV-1001")).toBeInTheDocument()
    expect(screen.queryByText("No values to choose from")).toBeNull()
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true")

    release?.([{ value: "INV-2024", count: 3 }])
    await waitFor(() => expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "false"))
    expect(await screen.findByLabelText("INV-2024")).toBeInTheDocument()
  })

  it("does not show the no-values note alongside a first-load failure", async () => {
    const loadValues = vi.fn().mockRejectedValue(new Error("no"))
    render(<Table columnId="tag" server loadValues={loadValues} />)

    expect(await screen.findByText("Could not load values")).toBeInTheDocument()
    // The failure already explains the empty list and offers Retry; the
    // "no data" note beside it would repeat that and undercut Retry.
    expect(screen.queryByText("No values to choose from")).toBeNull()
  })

  it("drops the ticked values when the operator select moves to blankness", async () => {
    const user = userEvent.setup()
    render(<Table columnId="tag" />)

    await user.click(screen.getByLabelText("open"))
    expect(shown()).toHaveLength(2)

    fireEvent.change(screen.getByLabelText("Tag: Operator"), { target: { value: "blank" } })

    /*
     * "A list condition carries a value set OR blankness, never both" is the
     * rule the (Blanks) checkbox already enforces on its own path; the
     * operator select went around it and left `values` populated. The
     * published condition carries no values at all, so a still-ticked "open"
     * has the list contradicting the query that is filtering the rows.
     */
    expect(conditions()).toEqual([{ kind: "list", field: "tag", op: "blank" }])
    expect(shown()).toHaveLength(1)
    expect(screen.getByLabelText("open")).not.toBeChecked()
    expect(screen.getByLabelText("(Blanks)")).toBeChecked()
  })

  it("does not destroy the filter when a value is ticked after moving to blankness", async () => {
    const user = userEvent.setup()
    render(<Table columnId="tag" />)

    await user.click(screen.getByLabelText("open"))
    fireEvent.change(screen.getByLabelText("Tag: Operator"), { target: { value: "blank" } })
    expect(shown()).toHaveLength(1)

    await user.click(screen.getByLabelText("open"))

    /*
     * With the stale tick left in place this click *unticks* it: `values`
     * goes empty, `draftToCondition` returns null and `commit` clears the
     * column — the user removes a filter they never asked to remove. Ticking
     * it now means what it says.
     */
    expect(conditions()).toEqual([{ kind: "list", field: "tag", op: "in", values: ["open"] }])
    expect(shown()).toHaveLength(2)
    expect(screen.getByLabelText("Tag: Operator")).toHaveValue("in")
  })

  it("offers nothing to click over a values list that is still loading", async () => {
    const loadValues = vi.fn().mockImplementation(neverSettles)
    render(<Table columnId="tag" server loadValues={loadValues} />)

    fireEvent.change(screen.getByLabelText("Tag: Operator"), { target: { value: "blank" } })
    expect(conditions()).toEqual([{ kind: "list", field: "tag", op: "blank" }])

    /*
     * The list is guaranteed empty while the first request is out, and a live
     * Select all over zero options can only call `toggleAll(true)` with
     * nothing to add: `values` stays `[]` with the operator forced back to
     * "in", `draftToCondition` returns null, and `commit` clears the filter
     * just set. The busy list says why it is empty; (Blanks) is an operator
     * rather than a member and keeps working throughout.
     */
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true")
    expect(screen.queryByLabelText("Select all")).toBeNull()
    // `aria-busy` alone leaves a sighted user an empty box, so the state says
    // itself in words too — `labels.loading`, the one that already names it.
    expect(screen.getByText("Loading")).toBeInTheDocument()
    expect(screen.queryByText("No values to choose from")).toBeNull()
    expect(screen.getByLabelText("(Blanks)")).toBeChecked()
    expect(conditions()).toEqual([{ kind: "list", field: "tag", op: "blank" }])
  })

  it("offers nothing to click over a values list whose request failed", async () => {
    const loadValues = vi.fn().mockRejectedValue(new Error("no"))
    render(<Table columnId="tag" server loadValues={loadValues} />)
    expect(await screen.findByText("Could not load values")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Tag: Operator"), { target: { value: "notBlank" } })

    // A rejection is persistent, not a race: this state lasts until a Retry
    // succeeds. The failure line and its Retry already explain the empty list
    // — the note would repeat them, and a Select all beside them would clear
    // the filter on a click that could not mean anything else.
    expect(screen.queryByLabelText("Select all")).toBeNull()
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
    expect(screen.queryByText("No values to choose from")).toBeNull()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
    expect(conditions()).toEqual([{ kind: "list", field: "tag", op: "notBlank" }])
  })

  it("commits the busy list, not the no-values note, on a server column's first render", () => {
    // `renderToStaticMarkup` runs no effects at all, which is exactly the
    // pre-effect state a real first paint commits — RTL's `render()` flushes
    // effects inside `act()` and would hide the flash.
    const markup = renderToStaticMarkup(
      <Table columnId="tag" server loadValues={neverSettles} />,
    )

    // Seeded `loading: false`, the very first commit of a server-mode list
    // column paints "there is nothing to choose from" about a request nobody
    // has issued yet.
    expect(markup).not.toContain("No values to choose from")
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain("Loading")
  })

  it("announces a values load failure to assistive technology", async () => {
    const loadValues = vi.fn().mockRejectedValue(new Error("no"))
    render(<Table columnId="tag" server loadValues={loadValues} />)

    // Matches `TableStatus`'s own `.dt-error` treatment: without `role="alert"`
    // a screen-reader user who searched and hit a rejected request hears
    // nothing and keeps reading a stale, silently-dimmed list.
    const failure = await screen.findByRole("alert")
    expect(failure).toHaveTextContent("Could not load values")
  })
})
