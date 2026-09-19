import { createColumnHelper } from "@tanstack/react-table"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable, defaultLabels } from "./components/DataTable"
import { FilterEditor } from "./components/FilterEditor"
import type { FilterValueOption } from "./core/filters"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

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
})
