import { createColumnHelper } from "@tanstack/react-table"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { localStorageLayout } from "./core/persistence"
import type { FilterCondition } from "./core/filters"
import type { TableLayout } from "./types"
import { useDataTable, type DataTableFeatures, type UseDataTableOptions } from "./useDataTable"

/**
 * Filter state: where it lives, what it resets, and what it persists.
 *
 * No UI and no TanStack filtering features yet — this is the layout slices,
 * the mutators and the round-trip, driven through the instance API.
 */

interface Row {
  id: string
  name: string
  amount: number
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [
  helper.accessor("name", { header: "Name", size: 100 }),
  helper.accessor("amount", { header: "Amount", size: 100 }),
]
const data: Row[] = Array.from({ length: 300 }, (_, index) => ({
  id: `r${index}`,
  name: `Row ${index}`,
  amount: index * 10,
}))

const contains: FilterCondition = { kind: "text", field: "name", op: "contains", value: "7" }
const over: FilterCondition = { kind: "number", field: "amount", op: "gt", value: 100 }

interface SetupOptions {
  persist?: boolean
  filtering?: UseDataTableOptions<Row>["filtering"]
  initialLayout?: Partial<TableLayout>
}

const setup = (id: string, options: SetupOptions = {}) =>
  renderHook(() =>
    useDataTable<Row>({
      id,
      columns,
      data,
      pagination: true,
      getRowId: (row) => row.id,
      storage: localStorageLayout(),
      ...(options.persist === undefined ? {} : { filtering: { persist: options.persist } }),
      ...(options.filtering === undefined ? {} : { filtering: options.filtering }),
      ...(options.initialLayout === undefined ? {} : { initialLayout: options.initialLayout }),
    }),
  )

/** The layout as it actually reached storage, so a write can be asserted on. */
const storedLayout = (id: string): Partial<TableLayout> | null => {
  const raw = localStorage.getItem(`data-table:layout:${id}`)
  return raw === null ? null : (JSON.parse(raw) as { layout: Partial<TableLayout> }).layout
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

describe("filter mutators", () => {
  it("setCondition stores the condition and goes back to the first page", () => {
    const { result } = setup("f1")
    act(() => result.current.pagination.setPageIndex(3))

    act(() => result.current.filtering.setCondition(contains))

    expect(result.current.filtering.conditions).toEqual([contains])
    expect(result.current.pagination.pageIndex).toBe(0)
    expect(result.current.filtering.isFiltered).toBe(true)
  })

  it("setCondition replaces the condition on the same column", () => {
    const { result } = setup("f2")
    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.filtering.setCondition({ ...contains, value: "9" }))

    expect(result.current.filtering.conditions).toEqual([{ ...contains, value: "9" }])
  })

  it("setCondition clears the column when the condition constrains nothing", () => {
    const { result } = setup("f3")
    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.filtering.setCondition({ ...contains, value: "" }))

    expect(result.current.filtering.conditions).toEqual([])
  })

  it("clearColumn removes only that column's condition, and resets the page", () => {
    const { result } = setup("f4")
    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.filtering.setCondition(over))
    act(() => result.current.pagination.setPageIndex(2))

    act(() => result.current.filtering.clearColumn("name"))

    expect(result.current.filtering.conditions).toEqual([over])
    expect(result.current.pagination.pageIndex).toBe(0)
  })

  it("setSearch stores the raw text and resets the page", () => {
    const { result } = setup("f5")
    act(() => result.current.pagination.setPageIndex(4))

    act(() => result.current.filtering.setSearch("kr 102 "))

    expect(result.current.filtering.search).toBe("kr 102 ")
    expect(result.current.pagination.pageIndex).toBe(0)
  })

  it("clearAll clears conditions and search together, and resets the page", () => {
    const { result } = setup("f6")
    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.filtering.setSearch("kr"))
    act(() => result.current.pagination.setPageIndex(1))

    act(() => result.current.filtering.clearAll())

    expect(result.current.filtering.conditions).toEqual([])
    expect(result.current.filtering.search).toBe("")
    expect(result.current.filtering.isFiltered).toBe(false)
    expect(result.current.pagination.pageIndex).toBe(0)
  })

  it("counts a whitespace-only search as no search", () => {
    const { result } = setup("f7")
    act(() => result.current.filtering.setSearch("   "))
    expect(result.current.filtering.isFiltered).toBe(false)
  })

  it("setCondition drops a condition on a column the table does not define", () => {
    // Regression: `setCondition` ran only the condition's own constructor, so
    // a field no editor can reach was published on `query.filters` forever —
    // the stranded-filter case `pruneFilters` exists to prevent, arriving
    // through the mutator instead of through storage.
    const { result } = setup("f21")
    const ghost: FilterCondition = { kind: "text", field: "ghost", op: "contains", value: "x" }

    act(() => result.current.filtering.setCondition(ghost))

    expect(result.current.filtering.conditions).toEqual([])
    expect(result.current.query.filters).toEqual([])
  })

  it("setCondition drops a condition whose kind does not match the column", () => {
    // A text condition on a numeric column is `ILIKE` on an integer column at
    // the other end — an error, not a narrower result set.
    const { result } = setup("f22")
    const textOnNumber = { kind: "text", field: "amount", op: "contains", value: "1" } as FilterCondition

    act(() => result.current.filtering.setCondition(textOnNumber))

    expect(result.current.filtering.conditions).toEqual([])
  })

  it("setSearch coerces a non-string to empty instead of breaking every later render", () => {
    // `filtering.isFiltered` calls `.trim()` on the slice; a JS host — or a
    // cast — reaching `setSearch` with a number used to take the whole table
    // down on the very next render.
    const { result } = setup("f24")

    act(() => result.current.filtering.setSearch(7 as unknown as string))

    expect(result.current.filtering.search).toBe("")
    expect(result.current.filtering.isFiltered).toBe(false)
  })
})

describe("the filter model round-trip", () => {
  it("restores a stored model, dropping what it cannot honour, and resets the page", () => {
    const { result } = setup("f8")
    const unknownColumn: FilterCondition = { kind: "text", field: "gone", op: "contains", value: "x" }
    act(() => result.current.pagination.setPageIndex(3))

    act(() =>
      result.current.filtering.setModel({ filters: [contains, unknownColumn], search: "kr" }),
    )

    expect(result.current.filtering.getModel()).toEqual({ filters: [contains], search: "kr" })
    // `setModel` is a mutator like the other four: it goes through
    // `updateFilters` and `updateSearch`, so it resets the page too.
    expect(result.current.pagination.pageIndex).toBe(0)
  })

  it("keeps one condition per column when a stored model carries two", () => {
    const { result } = setup("f8b")
    const later: FilterCondition = { kind: "text", field: "name", op: "equals", value: "Row 7" }

    act(() => result.current.filtering.setModel({ filters: [contains, later], search: "" }))

    // `setModel` runs the same `pruneFilters` a stored layout does, so it
    // inherits the one-condition-per-column guarantee: the projection is the
    // only writer of `ColumnFilter.id` and two entries could not share one.
    expect(result.current.filtering.conditions).toEqual([later])
  })

  it("produces an identical query from a differently-key-ordered condition", () => {
    const { result } = setup("f9")
    const handBuilt = { value: "7", op: "contains", field: "name", kind: "text" } as FilterCondition

    act(() => result.current.filtering.setCondition(contains))
    const canonical = result.current.query
    act(() => result.current.filtering.setModel({ filters: [handBuilt], search: "" }))

    // Same object, not merely an equal one: a re-ordered condition that
    // stringified differently would hand the host a new fetch key.
    expect(result.current.query).toBe(canonical)
  })

  it("publishes filters on the query, sorted by field", () => {
    const { result } = setup("f10")
    act(() => result.current.filtering.setCondition(over))
    act(() => result.current.filtering.setCondition(contains))

    expect(result.current.query.filters.map((condition) => condition.field)).toEqual(["amount", "name"])
  })
})

describe("persistence", () => {
  it("persists filters with the layout and restores them on the next mount", () => {
    vi.useFakeTimers()
    const first = setup("f11")
    act(() => first.result.current.filtering.setCondition(contains))
    act(() => vi.advanceTimersByTime(400))
    first.unmount()
    vi.useRealTimers()

    const second = setup("f11")
    expect(second.result.current.filtering.conditions).toEqual([contains])
  })

  it("persist: false keeps filters out of storage and schedules no write", () => {
    vi.useFakeTimers()
    const first = setup("f12", { persist: false })
    act(() => first.result.current.filtering.setCondition(contains))
    act(() => first.result.current.filtering.setSearch("kr"))
    act(() => vi.advanceTimersByTime(400))
    // Nothing was written at all: for the server-backed adapter `types.ts`
    // recommends, a write per pause is a network request per pause.
    expect(localStorage.getItem("data-table:layout:f12")).toBeNull()
    first.unmount()
    vi.useRealTimers()

    const second = setup("f12", { persist: false })
    expect(second.result.current.filtering.conditions).toEqual([])
    expect(second.result.current.filtering.search).toBe("")
  })

  it("does not mark the layout customised for a filter or a search", () => {
    const { result } = setup("f13")
    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.filtering.setSearch("kr"))

    // The Columns tab's Reset link is about columns; a search has nothing to
    // do with it.
    expect(result.current.isCustomised).toBe(false)
  })

  it("still reads as not customised after a filter-only layout is reloaded from storage", () => {
    // Regression: `isCustomised` used to be `stored !== null` at mount, so a
    // layout whose only saved change was a filter or a search came back
    // customised on the very next load — the Columns tab would then offer a
    // Reset link for a reason that had nothing to do with columns.
    vi.useFakeTimers()
    const first = setup("f13b")
    act(() => first.result.current.filtering.setSearch("kr"))
    act(() => vi.advanceTimersByTime(400))
    first.unmount()
    vi.useRealTimers()

    const second = setup("f13b")
    expect(second.result.current.filtering.search).toBe("kr")
    expect(second.result.current.isCustomised).toBe(false)
  })

  it("persist: false sheds filters that an earlier visit had already stored", () => {
    // Regression: `persist: false` was enforced on the write side only, so a
    // table that already had filters in storage restored them on every mount
    // and could never shed them — the option a host adds in a later release,
    // or wires to a user preference, did nothing for every returning user.
    vi.useFakeTimers()
    const first = setup("f25")
    act(() => first.result.current.filtering.setCondition(contains))
    act(() => first.result.current.filtering.setSearch("kr"))
    act(() => vi.advanceTimersByTime(400))
    first.unmount()
    vi.useRealTimers()

    const second = setup("f25", { persist: false })

    expect(second.result.current.filtering.conditions).toEqual([])
    expect(second.result.current.filtering.search).toBe("")
    expect(second.result.current.query.filters).toEqual([])
  })

  it("counts a stored page size as a customised layout on the next mount", () => {
    // Regression: the mount-time derivation iterated `EMPTY_LAYOUT`'s keys,
    // which have no `pageSize` — so the Reset link was there before a reload
    // and gone after it, for a layout `resetLayout` would still change.
    vi.useFakeTimers()
    const first = setup("f26")
    act(() => first.result.current.pagination.setPageSize(200))
    act(() => vi.advanceTimersByTime(400))
    expect(first.result.current.isCustomised).toBe(true)
    first.unmount()
    vi.useRealTimers()

    const second = setup("f26")

    expect(second.result.current.pagination.pageSize).toBe(200)
    expect(second.result.current.isCustomised).toBe(true)
  })

  it("persist: false writes a column change without the filter state alongside it", () => {
    // The write-boundary half of `persist: false`: a *column* change is worth
    // saving, and the filter slices must not ride along with it.
    vi.useFakeTimers()
    const { result, unmount } = setup("f27", { persist: false })
    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.filtering.setSearch("kr"))
    act(() => result.current.table.getColumn("amount")!.toggleVisibility(false))

    act(() => vi.advanceTimersByTime(400))

    expect(storedLayout("f27")).toMatchObject({
      columnVisibility: { amount: false },
      filters: [],
      search: "",
    })
    unmount()
    vi.useRealTimers()
  })

  it("persist: false does not let a later search cancel a pending column save", () => {
    // `useDebouncedSave` drops the pending layout the moment `enabled` goes
    // false, so a filter change that reset `hasUnsavedChanges` would throw
    // away the column change that was still waiting out its 350 ms.
    vi.useFakeTimers()
    const { result, unmount } = setup("f28", { persist: false })
    act(() => result.current.table.getColumn("amount")!.toggleVisibility(false))
    act(() => vi.advanceTimersByTime(100))

    act(() => result.current.filtering.setSearch("kr"))
    act(() => vi.advanceTimersByTime(400))

    expect(storedLayout("f28")).toMatchObject({ columnVisibility: { amount: false } })
    unmount()
    vi.useRealTimers()
  })

  it("keeps the layout customised when a search follows a column change", () => {
    // Only the arrangement slices set the flag, but none of them may clear it
    // either: a search after a column change used to make the Columns tab's
    // Reset link disappear.
    const { result } = setup("f29")
    act(() => result.current.table.getColumn("amount")!.toggleVisibility(false))
    expect(result.current.isCustomised).toBe(true)

    act(() => result.current.filtering.setSearch("kr"))

    expect(result.current.isCustomised).toBe(true)
  })

  it("is on by default and off when filtering is false", () => {
    const enabled = setup("f14")
    expect(enabled.result.current.filtering.enabled).toBe(true)

    const { result } = renderHook(() =>
      useDataTable<Row>({ id: "f15", columns, data, filtering: false, getRowId: (row) => row.id }),
    )
    expect(result.current.filtering.enabled).toBe(false)
  })

  it("keeps a stored number condition on a server-mode mount before rows have arrived", () => {
    /*
     * Regression: `collectFilterKinds` used to default every undeclared
     * column to "text" whenever there was no data yet to sample from, and
     * `pruneFilters` treats a resolved kind that disagrees with the stored
     * condition's own `kind` as a mismatch. A `number` condition saved while
     * rows were present would then be silently dropped on the very next
     * mount, because `data: []` is exactly what every server-mode mount
     * starts as before its first fetch answers.
     */
    vi.useFakeTimers()
    const first = renderHook(() =>
      useDataTable<Row>({
        id: "f16",
        columns,
        data,
        mode: "server",
        rowCount: data.length,
        getRowId: (row) => row.id,
        storage: localStorageLayout(),
      }),
    )
    act(() => first.result.current.filtering.setCondition(over))
    act(() => vi.advanceTimersByTime(400))
    first.unmount()
    vi.useRealTimers()

    const second = renderHook(() =>
      useDataTable<Row>({
        id: "f16",
        columns,
        data: [],
        mode: "server",
        rowCount: 0,
        getRowId: (row) => row.id,
        storage: localStorageLayout(),
      }),
    )

    expect(second.result.current.filtering.conditions).toEqual([over])
    expect(second.result.current.query.filters).toEqual([over])
  })

  it("publishes each column's resolved filter kind", () => {
    // Every filter surface needs to know which editor a column gets, and the
    // resolution is data-dependent: recomputing it per component would be free
    // to disagree with the map `pruneFilters` used on load.
    const { result } = setup("f16")
    expect(result.current.filtering.kinds.get("name")).toBe("text")
    expect(result.current.filtering.kinds.get("amount")).toBe("number")
    expect(result.current.filtering.kinds.get("gone")).toBeUndefined()
  })
})

describe("filtering: false", () => {
  /*
   * Regression, all four: `filtering: false` used to flip nothing but the
   * `enabled` flag. A host that shipped it to turn the feature off kept
   * sending stale stored filters to its backend forever, with no surface able
   * to clear them.
   */

  it("restores no filter state from storage and publishes none", () => {
    vi.useFakeTimers()
    const first = setup("f30")
    act(() => first.result.current.filtering.setCondition(contains))
    act(() => first.result.current.filtering.setSearch("kr"))
    act(() => vi.advanceTimersByTime(400))
    first.unmount()
    vi.useRealTimers()

    const second = setup("f30", { filtering: false })

    expect(second.result.current.filtering.conditions).toEqual([])
    expect(second.result.current.filtering.search).toBe("")
    expect(second.result.current.filtering.isFiltered).toBe(false)
    expect(second.result.current.query.filters).toEqual([])
  })

  it("ignores filter state in a hand-written initialLayout", () => {
    const { result } = setup("f31", {
      filtering: false,
      initialLayout: { filters: [contains], search: "kr" },
    })

    expect(result.current.filtering.conditions).toEqual([])
    expect(result.current.filtering.search).toBe("")
    expect(result.current.query.filters).toEqual([])
  })

  it("makes every mutator inert rather than writing state no surface can reach", () => {
    const { result } = setup("f32", { filtering: false })

    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.filtering.setSearch("kr"))
    act(() => result.current.filtering.setModel({ filters: [over], search: "kr" }))

    expect(result.current.filtering.conditions).toEqual([])
    expect(result.current.filtering.search).toBe("")
    expect(result.current.query.filters).toEqual([])
  })

  it("keeps filter state out of storage even beside a column change", () => {
    vi.useFakeTimers()
    const { result, unmount } = setup("f33", { filtering: false })
    act(() => result.current.filtering.setCondition(contains))
    act(() => result.current.table.getColumn("amount")!.toggleVisibility(false))

    act(() => vi.advanceTimersByTime(400))

    expect(storedLayout("f33")).toMatchObject({
      columnVisibility: { amount: false },
      filters: [],
      search: "",
    })
    unmount()
    vi.useRealTimers()
  })
})

describe("initialLayout validation", () => {
  it("prunes an unknown-column condition out of a hand-written initialLayout", () => {
    // Regression: `initialLayout.filters` used to reach `query.filters`
    // completely unvalidated — `pruneLayout` only normalises the *stored*
    // half, so a first visit (nothing in storage yet) published a condition
    // on a column the table does not define, forever, with no editor able to
    // reach it.
    const ghost: FilterCondition = { kind: "text", field: "ghost", op: "contains", value: "x" }
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "f17",
        columns,
        data,
        getRowId: (row) => row.id,
        initialLayout: { filters: [contains, ghost] },
      }),
    )

    expect(result.current.filtering.conditions).toEqual([contains])
    expect(result.current.query.filters).toEqual([contains])
  })

  it("publishes an identical query for a differently-key-ordered initialLayout condition", () => {
    // The other half of the same finding: an `initialLayout` condition that
    // was not rebuilt through its constructor would stringify differently
    // from an editor-built one, giving a host a spurious first fetch.
    const handBuilt = { value: "7", op: "contains", field: "name", kind: "text" } as FilterCondition
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "f18",
        columns,
        data,
        getRowId: (row) => row.id,
        initialLayout: { filters: [handBuilt] },
      }),
    )

    expect(result.current.filtering.conditions).toEqual([contains])
    expect(result.current.query.filters).toEqual([contains])
  })

  it("does not crash on a non-string initialLayout.search and treats it as empty", () => {
    // `filtering.isFiltered` calls `.trim()` on `layout.search`; an
    // `initialLayout.search` that is not a string (a caller's typo, or
    // untrusted JSON cast through `as`) must not reach it unchecked.
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "f19",
        columns,
        data,
        getRowId: (row) => row.id,
        initialLayout: { search: 7 as unknown as string },
      }),
    )

    expect(result.current.filtering.search).toBe("")
    expect(result.current.filtering.isFiltered).toBe(false)
  })

  it("re-validates initialLayout.filters again on resetLayout", () => {
    // `resetLayout` rebuilds from the same `initialLayout` and must not
    // re-introduce a condition the mount-time prune had rejected.
    const ghost: FilterCondition = { kind: "text", field: "ghost", op: "contains", value: "x" }
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "f20",
        columns,
        data,
        getRowId: (row) => row.id,
        initialLayout: { filters: [ghost] },
      }),
    )
    act(() => result.current.filtering.setCondition(contains))

    act(() => result.current.resetLayout())

    expect(result.current.filtering.conditions).toEqual([])
  })
})
