import { createColumnHelper } from "@tanstack/react-table"
import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { filterFn_dt } from "./core/filterFn"
import type { FilterCondition } from "./core/filters"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * The TanStack composition: the filtering features, the registered `dt` filter
 * function, the `layout.filters` → `columnFilters` projection, and the
 * `onColumnFiltersChange` bridge. No UI — every case drives the instance API.
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
  helper.accessor("tag", { header: "Tag", size: 100, meta: { filter: "list" } }),
]
const data: Row[] = [
  { id: "r0", name: "Agro Ltd", amount: 100, tag: "open" },
  { id: "r1", name: "Temir", amount: 500, tag: "closed" },
  { id: "r2", name: "KR-102", amount: 900, tag: "open" },
]

const contains: FilterCondition = { kind: "text", field: "name", op: "contains", value: "temir" }

const setup = (id: string, mode: "client" | "server" = "client") =>
  renderHook(() =>
    useDataTable<Row>({
      id,
      columns,
      data,
      mode,
      getRowId: (row) => row.id,
      ...(mode === "server" ? { rowCount: 3 } : {}),
    }),
  )

interface SecretRow {
  id: string
  name: string
  secret: string
}
const secretHelper = createColumnHelper<DataTableFeatures, SecretRow>()
const secretColumns = [
  secretHelper.accessor("name", { header: "Name", size: 100 }),
  secretHelper.accessor("secret", { header: "Secret", size: 100, meta: { filter: false } }),
]
const secretData: SecretRow[] = [
  { id: "r0", name: "Agro", secret: "alpha" },
  { id: "r1", name: "Temir", secret: "beta" },
]

interface Node {
  id: string
  name: string
  children?: Node[]
}
const treeHelper = createColumnHelper<DataTableFeatures, Node>()
const treeColumns = [treeHelper.accessor("name", { header: "Name", size: 100 })]
const tree: Node[] = [
  { id: "p", name: "Parent", children: [{ id: "c", name: "Needle child" }] },
  { id: "q", name: "Other" },
]

afterEach(() => vi.useRealTimers())

describe("client-side filtering", () => {
  it("narrows rows from a condition set through the instance API", () => {
    const { result } = setup("c1")
    act(() => result.current.filtering.setCondition({ kind: "text", field: "name", op: "contains", value: "agro" }))

    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r0"])
    expect(result.current.table.getColumn("name")!.getIsFiltered()).toBe(true)
  })

  it("gives a column that declares no filterFn the registered dt one", () => {
    // `columnFilteringFeature` defaults every column to `filterFn: "auto"`,
    // which resolves a built-in *name* through the registry narrowed to
    // `{ dt }`. Every lookup would miss, `column_getFilterFn` would return
    // undefined, and `createFilteredRowModel` would skip that filter entirely —
    // every row passing, with one dev warning and nothing else.
    const { result } = setup("c2")
    expect(result.current.table.getColumn("amount")!.getFilterFn()).toBe(filterFn_dt)
  })

  it("type-checks columnDef.meta against DataTableColumnMeta", () => {
    /*
     * The `columnMeta` slot is what makes `meta` checked at all. Without it
     * `meta` resolves to TanStack's EMPTY global `ColumnMeta` interface, which
     * accepts any object literal — TypeScript runs no excess-property check
     * against a target type that declares no properties — so a typo here would
     * compile and silently do nothing.
     */
    // @ts-expect-error `filtre` is not a member of DataTableColumnMeta
    const typo = [helper.accessor("tag", { header: "Tag", size: 100, meta: { filtre: "list" } })]
    expect(typo).toHaveLength(1)
  })

  it("keeps the columnFilters projection identity across an unrelated re-render", () => {
    const { result, rerender } = setup("c3")
    act(() => result.current.filtering.setCondition({ kind: "number", field: "amount", op: "gt", value: 200 }))
    const before = result.current.table.state.columnFilters

    rerender()

    // `createFilteredRowModel` compares its memo deps by reference: a fresh
    // array per render would re-filter every row on every host re-render.
    expect(result.current.table.state.columnFilters).toBe(before)
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r1", "r2"])
  })

  it("keeps the filter state, but not the filtering, in server mode", () => {
    const { result } = setup("c4", "server")
    act(() => result.current.filtering.setCondition({ kind: "text", field: "name", op: "contains", value: "zzz" }))

    // `manualFiltering` turns off the filtered row model, not the state:
    // `getIsFiltered()` is what marks a filtered header in server mode.
    expect(result.current.table.getColumn("name")!.getIsFiltered()).toBe(true)
    expect(result.current.table.getRowModel().rows).toHaveLength(3)
  })

  it("routes column.setFilterValue back through the layout", () => {
    const { result } = setup("c5")
    act(() => result.current.table.getColumn("name")!.setFilterValue(contains))

    // Unwired, TanStack's default updater would write to an atom that the
    // controlled `state.columnFilters` overrides, and this would do nothing.
    expect(result.current.filtering.conditions).toEqual([contains])
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r1"])
  })

  it("clears a column through TanStack's own API", () => {
    const { result } = setup("c6")
    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.table.getColumn("name")!.setFilterValue(undefined))

    expect(result.current.filtering.conditions).toEqual([])
  })

  it("facets a column's distinct values with their counts", () => {
    const { result } = setup("c7")
    expect(result.current.table.getColumn("tag")!.getFacetedUniqueValues()).toEqual(
      new Map([["open", 2], ["closed", 1]]),
    )
  })

  it("keeps the columnFilters projection identity when searchFields is a fresh literal each render", () => {
    // The natural call form `filtering: { searchFields: [...] }` hands the
    // hook a fresh options object, and a fresh `searchFields` array inside it,
    // on every render — the inline literal below re-runs on every call of
    // this hook body, exactly like a host's own JSX. `resolvedSearchFields`
    // must not let that identity churn reach `columnFilters`, which
    // `createFilteredRowModel` compares by reference.
    const { result, rerender } = renderHook(() =>
      useDataTable<Row>({
        id: "c9",
        columns,
        data,
        getRowId: (row) => row.id,
        filtering: { searchFields: ["name", "tag"] },
      }),
    )
    act(() =>
      result.current.filtering.setCondition({ kind: "number", field: "amount", op: "gt", value: 200 }),
    )
    const beforeFilters = result.current.table.state.columnFilters
    const beforeRows = result.current.table.getRowModel().rows

    rerender()

    expect(result.current.table.state.columnFilters).toBe(beforeFilters)
    expect(result.current.table.getRowModel().rows).toBe(beforeRows)
  })

  it("recomputes the filtered rows when the column a global filter matched is hidden", () => {
    // This is the behaviour `resolvedSearchFields` being a dependency of
    // `columnFilters` exists for: hiding the only column a global filter
    // matched changes which columns are searched, and the row model must
    // recompute even though `columnFilters` and `globalFilter` themselves did
    // not change.
    //
    // The timers are faked because what the row model reads is the *published*
    // search: `setGlobalFilter` writes `layout.search` on the keystroke and
    // `state.globalFilter` follows a debounce later, so there is nothing to
    // recompute until the wait is over.
    vi.useFakeTimers()
    const { result } = setup("c10")
    act(() => result.current.table.setGlobalFilter("temir"))
    act(() => vi.advanceTimersByTime(300))
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r1"])

    act(() => result.current.table.getColumn("name")!.toggleVisibility(false))

    expect(result.current.table.getColumn("name")!.getCanGlobalFilter()).toBe(false)
    expect(result.current.table.getRowModel().rows).toEqual([])
  })

  it("rejects a wrong-kind condition identically through setCondition and column.setFilterValue", () => {
    // "amount" resolves to the "number" kind by sampling; a "text" condition
    // on it must be rejected by both entry points, not just the dedicated one.
    const wrongKind: FilterCondition = { kind: "text", field: "amount", op: "contains", value: "1" }

    const viaSetCondition = setup("c11")
    act(() => viaSetCondition.result.current.filtering.setCondition(wrongKind))
    expect(viaSetCondition.result.current.filtering.conditions).toEqual([])

    const viaColumn = setup("c12")
    act(() => viaColumn.result.current.table.getColumn("amount")!.setFilterValue(wrongKind))
    expect(viaColumn.result.current.filtering.conditions).toEqual([])
    expect(viaColumn.result.current.table.state.columnFilters).toEqual([])
  })

  it("rejects a condition on a column declared meta: { filter: false } through column.setFilterValue", () => {
    // The stranded-filter case `pruneFilters` exists to prevent: unwired, this
    // would narrow the client rows, land in `filtering.conditions` and
    // `query.filters`, and only be dropped on the next mount by
    // `pruneLayout`/`pruneFilters` — a filter the library declares impossible
    // working until reload.
    const { result } = renderHook(() =>
      useDataTable<SecretRow>({
        id: "c13",
        columns: secretColumns,
        data: secretData,
        getRowId: (row) => row.id,
      }),
    )
    const condition: FilterCondition = { kind: "text", field: "secret", op: "contains", value: "alpha" }

    act(() => result.current.table.getColumn("secret")!.setFilterValue(condition))

    expect(result.current.filtering.conditions).toEqual([])
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r0", "r1"])
  })

  it("agrees with setCondition when writing an unrelated column while a stored condition's kind has drifted", () => {
    /*
     * "amount" declares no `meta.filter`, so on an empty first render (async
     * data, or a layout just restored from storage) its kind is unresolved
     * and `pruneFilters` skips the kind check — the "text" condition below
     * survives even though "amount" will infer to "number" once real data
     * arrives. Writing a different column afterwards must not re-judge it:
     * `column.setFilterValue` used to run the WHOLE filter list back through
     * `pruneFilters` on every write, so the now-mismatched "amount" condition
     * was silently dropped the moment "name" was touched — while
     * `filtering.setCondition` kept it, because it only ever validates the
     * one entry being written. The two documented ways to write a condition
     * must agree.
     */
    const staleAmount: FilterCondition = { kind: "text", field: "amount", op: "contains", value: "0" }

    const build = () =>
      renderHook(
        (props: { rows: Row[] }) =>
          useDataTable<Row>({ id: "drift", columns, data: props.rows, getRowId: (row) => row.id }),
        { initialProps: { rows: [] as Row[] } },
      )

    const viaColumn = build()
    act(() => viaColumn.result.current.filtering.setCondition(staleAmount))
    viaColumn.rerender({ rows: data })
    act(() => viaColumn.result.current.table.getColumn("name")!.setFilterValue(contains))

    const viaSetCondition = build()
    act(() => viaSetCondition.result.current.filtering.setCondition(staleAmount))
    viaSetCondition.rerender({ rows: data })
    act(() => viaSetCondition.result.current.filtering.setCondition(contains))

    expect(viaColumn.result.current.filtering.conditions).toEqual(
      viaSetCondition.result.current.filtering.conditions,
    )
    expect(viaColumn.result.current.filtering.conditions).toEqual(
      expect.arrayContaining([staleAmount, contains]),
    )
    expect(viaColumn.result.current.filtering.conditions).toHaveLength(2)
  })

  it("keeps a parent whose only match is a descendant, and its expansion", () => {
    const { result } = renderHook(() =>
      useDataTable<Node>({
        id: "c8",
        columns: treeColumns,
        data: tree,
        getRowId: (row) => row.id,
        getSubRows: (row) => row.children,
      }),
    )
    act(() => result.current.table.getRow("p").toggleExpanded(true))
    act(() => result.current.filtering.setCondition({ kind: "text", field: "name", op: "contains", value: "needle" }))

    // `filterFromLeafRows` defaults to false, which hides a matching child
    // whenever its parent fails the filter.
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["p", "c"])
    expect(result.current.table.getRow("p").getIsExpanded()).toBe(true)
  })
})
