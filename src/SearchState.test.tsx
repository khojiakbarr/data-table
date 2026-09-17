import { createColumnHelper } from "@tanstack/react-table"
import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { deriveColumnId } from "./core/columnIds"
import type { FilterCondition } from "./core/filters"
import type { TableQuery } from "./core/query"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * Quick search between the layout slice and the wire: what is debounced, what
 * is trimmed, and which columns the search covers.
 */

interface Row {
  id: string
  name: string
  amount: number
  tag: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 100 }),
  helper.accessor("amount", { header: "Amount", size: 100 }),
  helper.accessor("tag", { header: "Tag", size: 100 }),
]
const data: Row[] = [
  { id: "r0", name: "Agro Ltd", amount: 100, tag: "open" },
  { id: "r1", name: "Temir", amount: 500, tag: "closed" },
  { id: "r2", name: "KR-102", amount: 900, tag: "open" },
]

const server = (id: string, onQueryChange: (query: TableQuery) => void) =>
  renderHook(() =>
    useDataTable<Row>({
      id,
      columns,
      data,
      mode: "server",
      rowCount: 3,
      getRowId: (row) => row.id,
      onQueryChange,
    }),
  )

const client = (id: string) =>
  renderHook(() => useDataTable<Row>({ id, columns, data, getRowId: (row) => row.id }))

afterEach(() => vi.useRealTimers())

describe("quick search", () => {
  it("coalesces a burst of keystrokes into one query", () => {
    vi.useFakeTimers()
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result } = server("q1", onQueryChange)
    onQueryChange.mockClear()

    act(() => result.current.filtering.setSearch("t"))
    act(() => result.current.filtering.setSearch("te"))
    act(() => result.current.filtering.setSearch("tem"))
    expect(onQueryChange).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(300))
    expect(onQueryChange).toHaveBeenCalledTimes(1)
    expect(onQueryChange.mock.calls[0]![0].search).toEqual({
      text: "tem",
      fields: ["amount", "name", "tag"],
    })
  })

  it("keeps the input responsive while the published value waits", () => {
    vi.useFakeTimers()
    const { result } = client("q2")
    act(() => result.current.filtering.setSearch("temir "))

    // The raw text is in state on the keystroke, trailing space and all; only
    // what is downstream of it waits.
    expect(result.current.filtering.search).toBe("temir ")
    expect(result.current.table.getRowModel().rows).toHaveLength(3)

    act(() => vi.advanceTimersByTime(300))
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r1"])
  })

  it("matches tokens across different columns", () => {
    vi.useFakeTimers()
    const { result } = client("q3")
    act(() => result.current.filtering.setSearch("temir closed"))
    act(() => vi.advanceTimersByTime(300))

    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r1"])
  })

  it("counts a whitespace-only search as no search on the wire", () => {
    vi.useFakeTimers()
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result } = server("q4", onQueryChange)
    act(() => result.current.filtering.setSearch("   "))
    act(() => vi.advanceTimersByTime(300))

    // `createFilteredRowModel` treats " " as a live global filter and would
    // search for a space, while a wire carrying null returns everything.
    expect(result.current.query.search).toBeNull()
    expect(result.current.filtering.search).toBe("   ")
  })

  it("narrows the searched fields when a column is hidden", () => {
    vi.useFakeTimers()
    const { result } = client("q5")
    act(() => result.current.table.getColumn("tag")!.toggleVisibility(false))
    act(() => result.current.filtering.setSearch("closed"))
    act(() => vi.advanceTimersByTime(300))

    // Hiding a column narrows search, and the wire says exactly which columns
    // the client searched.
    expect(result.current.query.search).toEqual({ text: "closed", fields: ["amount", "name"] })
    expect(result.current.table.getRowModel().rows).toHaveLength(0)
  })

  it("narrows them the other way round too, when the column is hidden after the search", () => {
    vi.useFakeTimers()
    const { result } = client("q5b")
    act(() => result.current.filtering.setSearch("closed"))
    act(() => vi.advanceTimersByTime(300))
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r1"])

    act(() => result.current.table.getColumn("tag")!.toggleVisibility(false))

    /*
     * This is the order that can actually go wrong. `createFilteredRowModel`
     * memoises on the core row model, `columnFilters` and `globalFilter`, and
     * hiding a column changes none of the three — so without the projection's
     * dependency on `resolvedSearchFields` the client would go on matching
     * `tag` while the wire had already dropped it, which is precisely the
     * divergence the predicate exists to prevent.
     */
    expect(result.current.query.search).toEqual({ text: "closed", fields: ["amount", "name"] })
    expect(result.current.table.getRowModel().rows).toHaveLength(0)
  })

  it("honours searchFields over the default predicate", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "q6",
        columns,
        data,
        getRowId: (row) => row.id,
        filtering: { searchFields: ["tag"], debounceMs: 50 },
      }),
    )
    act(() => result.current.filtering.setSearch("agro"))
    act(() => vi.advanceTimersByTime(50))

    expect(result.current.query.search).toEqual({ text: "agro", fields: ["tag"] })
    expect(result.current.table.getRowModel().rows).toHaveLength(0)
  })

  it("routes table.setGlobalFilter back through the layout", () => {
    const { result } = client("q7")
    act(() => result.current.table.setGlobalFilter("temir"))

    // `state.globalFilter` is controlled, so the default updater would write to
    // an atom the controlled value overrides and this would do nothing.
    expect(result.current.filtering.search).toBe("temir")
  })

  it("does not reopen a search field a previous page already resolved, even once a later page samples it as all-null", () => {
    /*
     * Reproduces the Task 10 review finding: `search` depends on
     * `resolvedSearchFields`, which is derived from `data`, and `data` is the
     * host's own response to `search` on the wire — a feedback loop. A column
     * with no declared `meta.searchable` whose non-null values are not a
     * string or a number (`closedAt: Date | null` here) is `unresolved`
     * before any page has arrived, so it starts on the wire; the first real
     * page proves it unsearchable and narrows `fields`. Without a cache
     * remembering that, a later, narrower page's own sample can land on
     * all-null, `collectSearchFields` reports the column `unresolved` again,
     * and folding `unresolved` back into `fields` unconditionally reopens the
     * question the first page already settled — forever, against a backend
     * whose response depends on `fields`.
     */
    interface ClosableRow {
      id: string
      name: string
      closedAt: Date | null
    }
    const closableHelper = createColumnHelper<DataTableFeatures, ClosableRow>()
    const closableColumns = [
      closableHelper.accessor("name", { header: "Name", size: 100 }),
      closableHelper.accessor("closedAt", { header: "Closed", size: 100 }),
    ]
    const beforeFirstPage: ClosableRow[] = []
    const pageWithClosedAt: ClosableRow[] = [
      { id: "r0", name: "Agro Ltd", closedAt: new Date(2026, 0, 1) },
      { id: "r1", name: "Agro Group", closedAt: new Date(2026, 0, 2) },
    ]
    // The host honoured the narrowed `fields: ["name"]` and this page's
    // matched rows all happen to have `closedAt` null.
    const pageWithoutClosedAtSample: ClosableRow[] = [
      { id: "r2", name: "Agro Traders", closedAt: null },
      { id: "r3", name: "Agro Imports", closedAt: null },
    ]

    vi.useFakeTimers()
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result, rerender } = renderHook(
      (props: { data: ClosableRow[] }) =>
        useDataTable<ClosableRow>({
          id: "q9",
          columns: closableColumns,
          data: props.data,
          mode: "server",
          rowCount: 4,
          getRowId: (row) => row.id,
          onQueryChange,
        }),
      { initialProps: { data: beforeFirstPage } },
    )
    onQueryChange.mockClear() // drop the mount announcement (search: null)

    act(() => result.current.filtering.setSearch("agro"))
    act(() => vi.advanceTimersByTime(300))

    // Nothing sampled yet: both columns are unresolved and stay on the wire.
    expect(result.current.query.search).toEqual({ text: "agro", fields: ["closedAt", "name"] })
    expect(onQueryChange).toHaveBeenCalledTimes(1)

    // The first real page proves `closedAt` unsearchable (a Date sample) and
    // narrows `fields` — one extra, expected announcement.
    act(() => rerender({ data: pageWithClosedAt }))
    expect(result.current.query.search).toEqual({ text: "agro", fields: ["name"] })
    expect(onQueryChange).toHaveBeenCalledTimes(2)

    // Toggling between a page that samples `closedAt` as null and one that
    // doesn't must not reopen a question the first page already answered —
    // no further announcement, whichever way the sample swings.
    act(() => rerender({ data: pageWithoutClosedAtSample }))
    act(() => rerender({ data: pageWithClosedAt }))
    act(() => rerender({ data: pageWithoutClosedAtSample }))

    expect(result.current.query.search).toEqual({ text: "agro", fields: ["name"] })
    expect(onQueryChange).toHaveBeenCalledTimes(2)
  })

  it("publishes nothing to search when no column is searchable", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "q8",
        columns,
        data,
        getRowId: (row) => row.id,
        filtering: { searchFields: [] },
      }),
    )
    act(() => result.current.filtering.setSearch("agro"))
    act(() => vi.advanceTimersByTime(300))

    // An empty field list means search is off: the client has nothing to match
    // against, so the wire carries null rather than a term no backend could honour.
    expect(result.current.query.search).toBeNull()
    expect(result.current.table.getRowModel().rows).toHaveLength(3)
  })

  /**
   * A `note` column whose `meta.searchable` is exercised across renders, for
   * the two review-finding regressions below. Kept out of the shared `Row`
   * fixture so the column can carry an explicit `meta.searchable` from the
   * very first render.
   */
  interface NoteRow {
    id: string
    name: string
    note: string
  }
  const noteHelper = createColumnHelper<DataTableFeatures, NoteRow>()
  const noteData: NoteRow[] = [
    { id: "r0", name: "Agro Ltd", note: "flagged" },
    { id: "r1", name: "Temir", note: "clean" },
  ]

  it("widens the searched fields immediately when a declared meta.searchable flips from false to true", () => {
    /*
     * Reproduces the Task 10 round-2 review finding: the monotonic
     * search-field cache recorded the *first* verdict `collectSearchFields`
     * ever resolved for an id and never revisited it — including for a
     * column whose searchability was *declared*, not inferred. A `note`
     * column declared `meta: { searchable: false }` at mount, then flipped to
     * `true` by a host state change (an async permission check, a "search
     * this column" toggle), stayed excluded forever, because `false` had
     * already been cached.
     */
    vi.useFakeTimers()
    const columnsFor = (searchable: boolean) => [
      noteHelper.accessor("name", { header: "Name", size: 100 }),
      noteHelper.accessor("note", { header: "Note", size: 100, meta: { searchable } }),
    ]
    const { result, rerender } = renderHook(
      (props: { searchable: boolean }) =>
        useDataTable<NoteRow>({
          id: "q10-declared-widen",
          columns: columnsFor(props.searchable),
          data: noteData,
          getRowId: (row) => row.id,
        }),
      { initialProps: { searchable: false } },
    )

    act(() => result.current.filtering.setSearch("flagged"))
    act(() => vi.advanceTimersByTime(300))
    expect(result.current.query.search).toEqual({ text: "flagged", fields: ["name"] })
    expect(result.current.table.getRowModel().rows).toHaveLength(0)

    act(() => rerender({ searchable: true }))
    expect(result.current.query.search).toEqual({ text: "flagged", fields: ["name", "note"] })
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r0"])
  })

  it("narrows the searched fields immediately when a column newly declares meta.searchable: false", () => {
    /*
     * The other direction of the same regression: `note` starts with nothing
     * declared, so its string sample infers it searchable and *that*
     * inferred verdict is cached. The host then declares `meta: { searchable:
     * false }`. README:405 tells hosts to do exactly this for "anything
     * unindexed or sensitive" — the cache must not go on matching a column
     * the host just opted out of, on the wire or client-side.
     */
    vi.useFakeTimers()
    const columnsFor = (excluded: boolean) => [
      noteHelper.accessor("name", { header: "Name", size: 100 }),
      noteHelper.accessor("note", {
        header: "Note",
        size: 100,
        ...(excluded ? { meta: { searchable: false } } : {}),
      }),
    ]
    const { result, rerender } = renderHook(
      (props: { excluded: boolean }) =>
        useDataTable<NoteRow>({
          id: "q10-declared-narrow",
          columns: columnsFor(props.excluded),
          data: noteData,
          getRowId: (row) => row.id,
        }),
      { initialProps: { excluded: false } },
    )

    act(() => result.current.filtering.setSearch("flagged"))
    act(() => vi.advanceTimersByTime(300))
    expect(result.current.query.search).toEqual({ text: "flagged", fields: ["name", "note"] })
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r0"])

    act(() => rerender({ excluded: true }))
    expect(result.current.query.search).toEqual({ text: "flagged", fields: ["name"] })
    expect(result.current.table.getRowModel().rows).toHaveLength(0)
  })

  it("keeps search.fields in agreement with columnDef.enableGlobalFilter", () => {
    /*
     * Reproduces the other Task 10 review finding: `resolvedSearchFields`
     * never read `columnDef.enableGlobalFilter`, but TanStack's own
     * `column_getCanGlobalFilter` ANDs `columnDef.enableGlobalFilter ?? true`
     * into whether the client actually searches a column. A `note` column
     * opting out that way was still published in `search.fields` on the
     * wire while the client silently refused to match it — a server
     * honouring `fields` would return a row that the very same table, given
     * the same data in client mode, shows none of.
     */
    vi.useFakeTimers()
    const noOptOutColumns = [
      noteHelper.accessor("name", { header: "Name", size: 100 }),
      noteHelper.accessor("note", { header: "Note", size: 100, enableGlobalFilter: false }),
    ]
    const { result } = renderHook(() =>
      useDataTable<NoteRow>({ id: "q10-enable-global-filter", columns: noOptOutColumns, data: noteData, getRowId: (row) => row.id }),
    )

    act(() => result.current.filtering.setSearch("flagged"))
    act(() => vi.advanceTimersByTime(300))

    // Only `note` contains "flagged"; with it opted out, neither the wire nor
    // the client may claim a match.
    expect(result.current.query.search).toEqual({ text: "flagged", fields: ["name"] })
    expect(result.current.table.getRowModel().rows).toHaveLength(0)
  })

  /**
   * A row shape whose columns cover every way a `searchFields` entry can name
   * something quick search cannot actually cover: a column that opted out with
   * `enableGlobalFilter: false`, a display column with no accessor, a nested
   * `accessorKey` whose live id is not its dotted spelling, and an id that
   * matches no column at all.
   */
  interface PartnerRow {
    id: string
    name: string
    note: string
    partner: { name: string }
  }
  const partnerHelper = createColumnHelper<DataTableFeatures, PartnerRow>()
  const partnerColumns = [
    partnerHelper.accessor("name", { header: "Name", size: 100 }),
    partnerHelper.accessor("note", { header: "Note", size: 100, enableGlobalFilter: false }),
    partnerHelper.accessor("partner.name", { header: "Partner", size: 100 }),
    partnerHelper.display({ id: "actions", header: "Actions", size: 60 }),
  ]
  const partnerData: PartnerRow[] = [
    { id: "r0", name: "Agro Ltd", note: "flagged", partner: { name: "Temir" } },
    { id: "r1", name: "Beta Ltd", note: "clean", partner: { name: "Olma" } },
  ]
  /** The live id of the nested column, derived the one way this library derives ids. */
  const partnerNameId = deriveColumnId({ accessorKey: "partner.name" }, 2)

  it("drops searchFields entries the client could never match, and names them once", () => {
    /*
     * Reproduces the Task 10 review finding: `filtering.searchFields` was
     * returned verbatim, with none of the validation the default path runs, so
     * `search.fields` on the wire named columns the client silently refuses to
     * match. TanStack's `column_getCanGlobalFilter` ANDs `columnDef.
     * enableGlobalFilter ?? true` and `!!column.accessorFn` into its own
     * verdict and neither is overridable from here, so a backend honouring
     * those ids would return rows the same table, in client mode, shows none
     * of — exactly the divergence the shared predicate exists to prevent.
     */
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { result } = renderHook(() =>
      useDataTable<PartnerRow>({
        id: "q11-prune",
        columns: partnerColumns,
        data: partnerData,
        getRowId: (row) => row.id,
        filtering: {
          // "partner.name" is the dotted spelling, not the live id: the
          // typo this warning exists to surface. "partner_name" beside it is
          // the same column named correctly, and must survive.
          searchFields: ["note", "partner.name", partnerNameId, "ghost", "actions", "name"],
        },
      }),
    )

    act(() => result.current.filtering.setSearch("temir"))
    act(() => vi.advanceTimersByTime(300))

    expect(result.current.query.search).toEqual({ text: "temir", fields: ["name", partnerNameId] })
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r0"])
    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]![0])
    for (const dropped of ["actions", "ghost", "note", "partner.name"]) {
      expect(message).toContain(dropped)
    }
    // The ids that survived are not slandered in the warning.
    expect(message).not.toContain('"name"')
    warn.mockRestore()
  })

  it("turns search off when every searchFields entry is unmatchable, rather than publishing a term the client ignores", () => {
    /*
     * Case (a) of the same finding, and the round-2 review finding it left
     * open: with `note` the only listed id and `note` opted out with
     * `enableGlobalFilter: false`, the table has no globally-filterable column
     * at all, so `createFilteredRowModel` skips the global filter entirely and
     * the client returns every row — while the wire told the server to narrow
     * to `["note"]`.
     */
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { result } = renderHook(() =>
      useDataTable<PartnerRow>({
        id: "q11-all-dropped",
        columns: partnerColumns,
        data: partnerData,
        getRowId: (row) => row.id,
        filtering: { searchFields: ["note"] },
      }),
    )

    act(() => result.current.filtering.setSearch("flagged"))
    act(() => vi.advanceTimersByTime(300))

    // Nothing searchable is survived honestly: `search` is null, the same as
    // `searchFields: []`, and both sides return everything.
    expect(result.current.query.search).toBeNull()
    expect(result.current.table.getRowModel().rows).toHaveLength(2)
    warn.mockRestore()
  })

  it("keeps searching a hidden column that searchFields names explicitly", () => {
    /*
     * The gate is existence and accessor, never visibility: README documents
     * `searchFields` as overriding the hidden-column narrowing outright, and
     * TanStack's own `getCanGlobalFilter` never consults visibility either, so
     * a hidden column named here is matched by both sides and must stay that
     * way.
     */
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "q11-hidden",
        columns,
        data,
        getRowId: (row) => row.id,
        filtering: { searchFields: ["tag"] },
      }),
    )
    act(() => result.current.table.getColumn("tag")!.toggleVisibility(false))
    act(() => result.current.filtering.setSearch("closed"))
    act(() => vi.advanceTimersByTime(300))

    expect(result.current.query.search).toEqual({ text: "closed", fields: ["tag"] })
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r1"])
  })

  it("clears filters and search in one query, with no intermediate announcement", () => {
    /*
     * Reproduces the Task 10 review finding: `clearAll` writes `layout.filters`
     * synchronously and `layout.search` through the debounce, so a host wired
     * to `onQueryChange` saw `{filters: [], search: "temir"}` immediately and
     * `{filters: [], search: null}` 300 ms later — one wasted round-trip and a
     * two-step settle on every "Clear all" click.
     */
    vi.useFakeTimers()
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result } = server("q12-clear-all", onQueryChange)
    act(() =>
      result.current.filtering.setCondition({ kind: "text", field: "tag", op: "contains", value: "open" }),
    )
    act(() => result.current.filtering.setSearch("temir"))
    act(() => vi.advanceTimersByTime(300))
    onQueryChange.mockClear()

    act(() => result.current.filtering.clearAll())
    act(() => vi.advanceTimersByTime(300))

    expect(onQueryChange).toHaveBeenCalledTimes(1)
    expect(onQueryChange.mock.calls[0]![0].filters).toEqual([])
    expect(onQueryChange.mock.calls[0]![0].search).toBeNull()
  })

  it("applies setModel in one query, with no intermediate announcement", () => {
    /*
     * The same finding through the API the README recommends for URL
     * round-trips: the filters landed immediately and the search 300 ms later,
     * so restoring a shared link fired two queries and showed two states.
     */
    vi.useFakeTimers()
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result } = server("q12-set-model", onQueryChange)
    onQueryChange.mockClear()

    const condition: FilterCondition = { kind: "text", field: "tag", op: "contains", value: "open" }
    act(() => result.current.filtering.setModel({ filters: [condition], search: "temir" }))
    act(() => vi.advanceTimersByTime(300))

    expect(onQueryChange).toHaveBeenCalledTimes(1)
    expect(onQueryChange.mock.calls[0]![0].filters).toEqual([condition])
    expect(onQueryChange.mock.calls[0]![0].search).toEqual({
      text: "temir",
      fields: ["amount", "name", "tag"],
    })
  })

  it("still debounces a keystroke after a programmatic write has published at once", () => {
    // The settle-now path must not leak into typing: `setSearch` is the
    // keystroke path and has to go on waiting out `debounceMs`.
    vi.useFakeTimers()
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result } = server("q12-still-debounced", onQueryChange)
    act(() => result.current.filtering.setModel({ filters: [], search: "temir" }))
    act(() => vi.advanceTimersByTime(300))
    onQueryChange.mockClear()

    act(() => result.current.filtering.setSearch("t"))
    act(() => result.current.filtering.setSearch("te"))
    expect(onQueryChange).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(300))
    expect(onQueryChange).toHaveBeenCalledTimes(1)
    expect(onQueryChange.mock.calls[0]![0].search).toEqual({
      text: "te",
      fields: ["amount", "name", "tag"],
    })
  })
})
