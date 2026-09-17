import { createColumnHelper } from "@tanstack/react-table"
import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DataTable, defaultLabels } from "./components/DataTable"
import { QuickSearch } from "./components/QuickSearch"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/** The toolbar's search box: what it renders, what it announces, what it clears. */

interface Row {
  id: string
  name: string
  tag: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 100 }),
  helper.accessor("tag", { header: "Tag", size: 100 }),
]
const data: Row[] = [
  { id: "r0", name: "Agro Ltd", tag: "open" },
  { id: "r1", name: "Temir", tag: "closed" },
]

function Table({ filtering, toolbar = true }: { filtering?: boolean; toolbar?: boolean }) {
  const instance = useDataTable<Row>({
    id: "qs",
    columns,
    data,
    getRowId: (row) => row.id,
    ...(filtering === undefined ? {} : { filtering }),
  })
  return (
    <>
      {toolbar ? null : <QuickSearch instance={instance} labels={defaultLabels} />}
      <DataTable instance={instance} toolbar={toolbar} virtualize={false} />
    </>
  )
}

afterEach(() => vi.useRealTimers())

describe("quick search box", () => {
  it("narrows the rows and announces the count politely", () => {
    vi.useFakeTimers()
    render(<Table />)
    const box = screen.getByRole("searchbox", { name: "Search rows" })

    fireEvent.change(box, { target: { value: "temir" } })
    expect(box).toHaveValue("temir")
    expect(screen.getByText("Agro Ltd")).toBeInTheDocument()
    // Before the debounce settles, nothing is announced yet — in particular
    // not the unfiltered total, which is what `table.getRowModel()` still
    // holds at this instant because `globalFilter` itself is debounced.
    expect(screen.getByRole("status")).toHaveTextContent("")

    act(() => vi.advanceTimersByTime(300))
    expect(screen.queryByText("Agro Ltd")).not.toBeInTheDocument()
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("1 matching rows")
    expect(status).toHaveAttribute("aria-live", "polite")
  })

  it("announces the full match count across pages, not just the page's own rows", () => {
    // 12 matches spread across more than one 10-row page: a count read from
    // the paginated (or expanded) row model would report the page's slice,
    // not the true total.
    vi.useFakeTimers()
    const matching = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: `Match ${i}`, tag: "open" }))
    const rest = Array.from({ length: 18 }, (_, i) => ({ id: `o${i}`, name: `Other ${i}`, tag: "closed" }))

    function Paged() {
      const instance = useDataTable<Row>({
        id: "qs-paged",
        columns,
        data: [...matching, ...rest],
        getRowId: (row) => row.id,
        pagination: { pageSize: 10 },
      })
      return <DataTable instance={instance} virtualize={false} />
    }
    render(<Paged />)

    fireEvent.change(screen.getByRole("searchbox", { name: "Search rows" }), { target: { value: "match" } })
    act(() => vi.advanceTimersByTime(300))

    expect(screen.getByRole("status")).toHaveTextContent("12 matching rows")
  })

  it("does not change its announcement when a matching row's children are expanded", () => {
    // `getFilteredRowModel()` — not `getRowModel()` / `pagination.rowCount`,
    // both of which alias `getExpandedRowModel()` — is what the count must
    // come from: only the filtered model stays put while the tree opens and
    // closes underneath it.
    vi.useFakeTimers()
    interface Node {
      id: string
      name: string
      children?: Node[]
    }
    const treeHelper = createColumnHelper<DataTableFeatures, Node>()
    const treeColumns = [treeHelper.accessor("name", { header: "Name", size: 200 })]
    const tree: Node[] = [
      {
        id: "p",
        name: "Alpha",
        children: [
          { id: "c1", name: "Alpha Jr" },
          { id: "c2", name: "Alpha III" },
        ],
      },
      { id: "q", name: "Beta" },
    ]

    function Tree() {
      const instance = useDataTable<Node>({
        id: "qs-tree",
        columns: treeColumns,
        data: tree,
        getRowId: (row) => row.id,
        getSubRows: (row) => row.children,
      })
      return <DataTable instance={instance} virtualize={false} />
    }
    render(<Tree />)

    fireEvent.change(screen.getByRole("searchbox", { name: "Search rows" }), { target: { value: "alpha" } })
    act(() => vi.advanceTimersByTime(300))
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("1 matching rows")

    fireEvent.click(screen.getByRole("button", { name: /expand row/i }))
    expect(screen.getByText("Alpha Jr")).toBeInTheDocument()
    expect(status).toHaveTextContent("1 matching rows")

    fireEvent.click(screen.getByRole("button", { name: /collapse row/i }))
    expect(status).toHaveTextContent("1 matching rows")
  })

  it("sits before the spacer, so it is left of the Columns button", () => {
    const { container } = render(<Table />)
    const toolbar = container.querySelector(".dt-toolbar")!
    const classes = Array.from(toolbar.children).map((child) => child.className)

    // Presence first: `indexOf` returns -1 for an absent element, and -1 is
    // "less than" the spacer's index too, so an ordering assertion alone is
    // satisfied by the search box having been removed entirely.
    expect(classes).toContain("dt-search-box")
    expect(classes).toContain("dt-spacer")
    expect(classes.indexOf("dt-search-box")).toBeLessThan(classes.indexOf("dt-spacer"))
  })

  it("offers a clear affordance only while it holds text", async () => {
    const user = userEvent.setup()
    render(<Table />)
    const box = screen.getByRole("searchbox", { name: "Search rows" })
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument()

    await user.type(box, "temir")
    await user.click(screen.getByRole("button", { name: "Clear search" }))

    expect(box).toHaveValue("")
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument()
  })

  it("never steals focus", () => {
    render(<Table />)
    expect(document.activeElement).toBe(document.body)
  })

  it("returns focus to the search box when the clear button, which unmounts, is used", async () => {
    const user = userEvent.setup()
    render(<Table />)
    const box = screen.getByRole("searchbox", { name: "Search rows" })

    await user.type(box, "temir")
    const clearButton = screen.getByRole("button", { name: "Clear search" })
    clearButton.focus()
    expect(document.activeElement).toBe(clearButton)

    await user.click(clearButton)

    // The button that was just focused has now unmounted (it only renders
    // while there is text to clear) — without an explicit handoff, React
    // does not relocate focus and it falls back to `<body>`.
    expect(document.activeElement).toBe(box)
  })

  it("renders no search box when filtering is off", () => {
    render(<Table filtering={false} />)
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
  })

  it("self-gates: the standalone component renders nothing against a filtering:false instance", () => {
    function StandaloneOff() {
      const instance = useDataTable<Row>({
        id: "qs-standalone-off",
        columns,
        data,
        getRowId: (row) => row.id,
        filtering: false,
      })
      // Rendered directly, bypassing `<DataTable>`'s own gate entirely — this
      // is what a host following the README's `toolbar={false}` recipe does.
      return <QuickSearch instance={instance} labels={defaultLabels} />
    }
    render(<StandaloneOff />)
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
  })

  it("is exported for a shell of its own", () => {
    vi.useFakeTimers()
    render(<Table toolbar={false} />)
    expect(document.querySelector(".dt-toolbar")).toBeNull()

    fireEvent.change(screen.getByRole("searchbox", { name: "Search rows" }), { target: { value: "agro" } })
    act(() => vi.advanceTimersByTime(300))
    expect(screen.queryByText("Temir")).not.toBeInTheDocument()
  })
})
