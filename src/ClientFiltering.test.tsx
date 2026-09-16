import { createColumnHelper } from "@tanstack/react-table"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
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
