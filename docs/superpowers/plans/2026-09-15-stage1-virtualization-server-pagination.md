# Stage 1 — Virtualisation, Server-Side Model, Pagination, shadcn Preset — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Row-virtualise the table, add a `mode: "server"` contract (`TableQuery` + `onQueryChange`), a pagination footer with a user-changeable page size, loading/error states, and a shadcn token preset — without changing how an existing `<DataTable>` renders.

**Architecture:** `useDataTable` keeps owning state but delegates to three new hooks: `useArrangement` (persisted layout, extracted from the current hook), `usePagination` (transient page index, persisted page size) and, in the shell, `useRowVirtualizer` (a thin wrapper over `@tanstack/react-virtual` that turns TanStack rows plus open detail panels into a display list and two spacer heights). The `<table>` markup, `<colgroup>`, sticky header, pinned cells and filler are untouched: rows stay in normal flow between a top and a bottom spacer `<tr>`. Server mode flips TanStack's `manual*` switches so rows render as received.

**Tech Stack:** React 19, TanStack Table v9.2.4 (`rowPaginationFeature`, `createPaginatedRowModel`, `manualSorting/Filtering/Pagination`), `@tanstack/react-virtual` ^3.14, Vite 8 lib build, vitest + jsdom + Testing Library.

Spec: `docs/superpowers/specs/2026-09-15-stage1-virtualization-server-pagination-design.md`.
Conventions: every exported symbol gets a JSDoc block; no `any`; files stay under ~200 lines; commit after every task on branch `khojiakbar` and push to `origin/khojiakbar`; never merge to `main` without the author's explicit go-ahead.

Before starting: `cd /Users/khojiakbar/Desktop/data-table && git switch khojiakbar && pnpm test` must report 118 passing tests.

---

## File map

| File | Responsibility |
|---|---|
| `package.json` | version 0.4.0, react-virtual peer + dev dep, theme exports, build copies themes |
| `src/vite-env.d.ts` | `import.meta.env` typings for the dev-only warning |
| `src/types.ts` | `TableLayout.pageSize`, new labels |
| `src/core/query.ts` | `TableQuery`, `buildQuery`, `queriesEqual` |
| `src/core/useArrangement.ts` | layout state + persistence + `updateSlice` (moved out of `useDataTable`) |
| `src/core/usePagination.ts` | page index/size state, resets, clamping, `PaginationApi` |
| `src/core/virtualRows.ts` | pure: `buildDisplayList`, `displayItemKey`, `spacerSizes` |
| `src/core/useRowVirtualizer.ts` | react-virtual wrapper returning items + spacer heights |
| `src/useDataTable.ts` | options, TanStack composition, `query`, `pagination` on the instance |
| `src/components/TablePagination.tsx` | footer |
| `src/components/TableStatus.tsx` | progress bar, error banner, skeleton rows |
| `src/components/TableBody.tsx` | spacers + rows + detail rows |
| `src/components/BodyRow.tsx` | one data row (detail row moves to `TableBody`) |
| `src/components/DataTable.tsx` | shell: new props, viewport/head refs, footer |
| `src/styles.css` | footer, spacer, parity striping, status, skeleton |
| `src/themes/shadcn.css`, `src/themes/shadcn-hsl.css` | token presets |
| `src/demo/fakeServer.ts`, `src/demo/Demo.tsx` | server demo, 100k demo |
| `README.md` | docs |

---

### Task 1: Dependency and package metadata

**Files:**
- Modify: `package.json`
- Create: `src/vite-env.d.ts`

- [ ] **Step 1: Install react-virtual as a dev dependency**

Run: `cd /Users/khojiakbar/Desktop/data-table && pnpm add -D @tanstack/react-virtual@^3.14.13`
Expected: `devDependencies` now lists `"@tanstack/react-virtual": "^3.14.13"`.

- [ ] **Step 2: Declare it as a peer, bump the version, export the themes**

Edit `package.json` so these fields read:

```json
"version": "0.4.0",
"peerDependencies": {
  "@tanstack/react-table": "^9.0.0",
  "@tanstack/react-virtual": "^3.14.0",
  "react": "^18.0.0 || ^19.0.0",
  "react-dom": "^18.0.0 || ^19.0.0"
},
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./styles.css": "./dist/styles.css",
  "./themes/shadcn.css": "./dist/themes/shadcn.css",
  "./themes/shadcn-hsl.css": "./dist/themes/shadcn-hsl.css"
},
```

Add `"virtualization", "server-side", "pagination", "shadcn"` to `keywords`.

- [ ] **Step 3: Type `import.meta.env` for a dev-only warning**

Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 4: Verify nothing broke**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean, `Tests 118 passed`.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/vite-env.d.ts
git commit -m "chore: add @tanstack/react-virtual peer, theme exports, bump to 0.4.0"
git push origin khojiakbar
```

---

### Task 2: `TableQuery`

**Files:**
- Create: `src/core/query.ts`
- Test: `src/core/query.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/core/query.test.ts
import { describe, expect, it } from "vitest"
import { buildQuery, queriesEqual } from "./query"

describe("buildQuery", () => {
  it("carries sorting and pagination, and reserves the later fields", () => {
    const query = buildQuery({ sorting: [{ id: "date", desc: true }], pageIndex: 2, pageSize: 50 })

    expect(query).toEqual({
      sorting: [{ id: "date", desc: true }],
      columnFilters: [],
      globalFilter: "",
      grouping: [],
      pagination: { pageIndex: 2, pageSize: 50 },
    })
  })
})

describe("queriesEqual", () => {
  const base = buildQuery({ sorting: [{ id: "date", desc: false }], pageIndex: 0, pageSize: 50 })

  it("is true for structurally equal queries", () => {
    expect(queriesEqual(base, buildQuery({ sorting: [{ id: "date", desc: false }], pageIndex: 0, pageSize: 50 }))).toBe(true)
  })

  it("is false when any field differs", () => {
    expect(queriesEqual(base, { ...base, pagination: { pageIndex: 1, pageSize: 50 } })).toBe(false)
    expect(queriesEqual(base, { ...base, sorting: [{ id: "date", desc: true }] })).toBe(false)
    expect(queriesEqual(base, { ...base, globalFilter: "x" })).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/core/query.test.ts`
Expected: FAIL — `Cannot find module './query'`.

- [ ] **Step 3: Implement**

```ts
// src/core/query.ts
import type { ColumnFiltersState, GroupingState, SortingState } from "@tanstack/react-table"

/**
 * Everything a server needs to produce one page of rows.
 *
 * Built by {@link useDataTable} from the current layout and page state and
 * handed to `onQueryChange`. The filter and grouping fields are reserved for
 * later stages and are always empty for now, so the shape a backend is
 * written against does not change when those stages land.
 */
export interface TableQuery {
  sorting: SortingState
  columnFilters: ColumnFiltersState
  globalFilter: string
  grouping: GroupingState
  pagination: { pageIndex: number; pageSize: number }
}

export interface QueryInputs {
  sorting: SortingState
  pageIndex: number
  pageSize: number
}

/**
 * Assemble a query from the table's state.
 *
 * @param inputs - The state slices that feed the query.
 * @returns A new query object.
 */
export function buildQuery({ sorting, pageIndex, pageSize }: QueryInputs): TableQuery {
  return {
    sorting,
    columnFilters: [],
    globalFilter: "",
    grouping: [],
    pagination: { pageIndex, pageSize },
  }
}

/**
 * Structural equality for queries.
 *
 * Queries are JSON-shaped, so a stringify comparison is exact and cheap at
 * this size; it is what keeps `instance.query` referentially stable between
 * renders that changed nothing.
 */
export function queriesEqual(a: TableQuery, b: TableQuery): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run src/core/query.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/query.ts src/core/query.test.ts
git commit -m "feat(query): TableQuery shape and equality"
```

---

### Task 3: Extract `useArrangement` and persist `pageSize`

**Files:**
- Create: `src/core/useArrangement.ts`
- Modify: `src/types.ts` (add `pageSize`), `src/core/persistence.ts` (keep `pageSize`), `src/useDataTable.ts` (delegate)
- Test: `src/core/persistence.test.ts` (add case), existing suites as regression guard

- [ ] **Step 1: Write the failing persistence test**

Append inside `describe("pruneLayout", ...)` in `src/core/persistence.test.ts`:

```ts
  it("keeps a positive page size and drops anything else", () => {
    expect(pruneLayout({ pageSize: 100 }, ["a"]).pageSize).toBe(100)
    expect(pruneLayout({ pageSize: 0 }, ["a"]).pageSize).toBeUndefined()
    expect(pruneLayout({ pageSize: "x" as unknown as number }, ["a"]).pageSize).toBeUndefined()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/core/persistence.test.ts`
Expected: FAIL — typecheck/`pageSize` not on `TableLayout` and `pruneLayout` ignores it.

- [ ] **Step 3: Add `pageSize` to the layout type and to pruning**

In `src/types.ts`, extend `TableLayout`:

```ts
export interface TableLayout {
  columnOrder: ColumnOrderState
  columnVisibility: ColumnVisibilityState
  columnPinning: ColumnPinningState
  columnSizing: ColumnSizingState
  sorting: SortingState
  /** Rows per page the user chose. Absent until they change it. */
  pageSize?: number
}
```

In `src/core/persistence.ts`, before `return pruned` in `pruneLayout`:

```ts
  if (Number.isFinite(stored.pageSize) && (stored.pageSize as number) > 0) {
    pruned.pageSize = stored.pageSize as number
  }
```

- [ ] **Step 4: Move the arrangement state out of `useDataTable`**

Create `src/core/useArrangement.ts` with the state, `updateSlice`, `resetLayout` and the equality helper that currently live in `src/useDataTable.ts`:

```ts
import { useCallback, useRef, useState } from "react"
import type { Updater } from "@tanstack/react-table"
import { pruneLayout } from "./persistence"
import { useDebouncedSave } from "./useDebouncedSave"
import type { LayoutStorage, TableLayout } from "../types"

export const EMPTY_LAYOUT: TableLayout = {
  columnOrder: [],
  columnVisibility: {},
  columnPinning: { start: [], end: [] },
  columnSizing: {},
  sorting: [],
}

/** The layout plus what the table knows about where it came from. */
interface Arrangement {
  layout: TableLayout
  /** Differs from the declared layout, so a Reset control makes sense. */
  isCustomised: boolean
  /**
   * Changed by the user since mount, so worth writing. A layout read from
   * storage is customised but has nothing new to save.
   */
  hasUnsavedChanges: boolean
}

export interface UseArrangementOptions {
  id: string
  store: LayoutStorage
  initialLayout: Partial<TableLayout> | undefined
  /** Leaf column ids, so a stored layout can be pruned to live columns. */
  columnIds: readonly string[]
}

/** TanStack state setters accept a value or an updater function. */
export function apply<T>(updater: T | ((old: T) => T), current: T): T {
  return typeof updater === "function" ? (updater as (old: T) => T)(current) : updater
}

/**
 * The persisted part of a table's state: what the user has arranged.
 *
 * Read from storage once per table id, written back debounced, and reset on
 * request. Every change goes through {@link UseArrangementResult.updateSlice},
 * which drops changes that leave a slice as it was, so a no-op does not mark
 * the table as customised or trigger a write.
 */
export function useArrangement({ id, store, initialLayout, columnIds }: UseArrangementOptions) {
  const [arrangement, setArrangement] = useState<Arrangement>(() => {
    const stored = store.load(id)
    return {
      layout: { ...EMPTY_LAYOUT, ...initialLayout, ...pruneLayout(stored ?? {}, columnIds) },
      isCustomised: stored !== null,
      hasUnsavedChanges: false,
    }
  })
  const initialRef = useRef(initialLayout)

  useDebouncedSave(store, id, arrangement.layout, arrangement.hasUnsavedChanges)

  const updateSlice = useCallback(
    <TKey extends keyof TableLayout>(
      key: TKey,
      updater: Updater<TableLayout[TKey]>,
      normalise: (slice: TableLayout[TKey]) => TableLayout[TKey] = (slice) => slice,
    ) => {
      setArrangement((previous) => {
        const next = normalise(apply(updater, previous.layout[key]))
        if (layoutSliceEqual(next, previous.layout[key])) return previous
        return {
          layout: { ...previous.layout, [key]: next },
          isCustomised: true,
          hasUnsavedChanges: true,
        }
      })
    },
    [],
  )

  const resetLayout = useCallback(() => {
    store.clear(id)
    setArrangement({
      layout: { ...EMPTY_LAYOUT, ...initialRef.current },
      isCustomised: false,
      hasUnsavedChanges: false,
    })
  }, [store, id])

  return { layout: arrangement.layout, isCustomised: arrangement.isCustomised, updateSlice, resetLayout }
}

export type UseArrangementResult = ReturnType<typeof useArrangement>

/**
 * Structural equality for a layout slice.
 *
 * Slices are JSON-shaped — arrays of ids, maps of primitives, `{ id, desc }`
 * pairs — so a plain recursive comparison is exact, and it is what tells a
 * genuine change from TanStack rebuilding an identical array.
 */
export function layoutSliceEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => layoutSliceEqual(item, b[index]))
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && layoutSliceEqual(a[key], b[key]))
    )
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
```

In `src/useDataTable.ts`: delete `EMPTY_LAYOUT`, the `Arrangement` interface, the `useState<Arrangement>`, `updateSlice`, `resetLayout`, `apply`, `layoutSliceEqual`, `isRecord` and the `useDebouncedSave` call; import `{ apply, useArrangement }` from `./core/useArrangement` and replace them with:

```ts
  const { layout, isCustomised, updateSlice, resetLayout } = useArrangement({
    id,
    store,
    initialLayout,
    columnIds,
  })
```

Keep `normaliseSizing` in `useDataTable.ts` (it needs the table). Remove the now-unused `useRef`/`useState` imports if any remain unused.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm typecheck && pnpm test`
Expected: clean; `Tests 119 passed` (118 + the new persistence case). Every existing test still passes — this task is a pure move.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/core/persistence.ts src/core/persistence.test.ts src/core/useArrangement.ts src/useDataTable.ts
git commit -m "refactor: extract useArrangement; persist pageSize in the layout"
```

---

### Task 4: `usePagination`

**Files:**
- Create: `src/core/usePagination.ts`
- Test: `src/core/usePagination.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/core/usePagination.test.tsx
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { usePagination } from "./usePagination"

const setup = (overrides: Partial<Parameters<typeof usePagination>[0]> = {}) => {
  const onPageSizeChange = vi.fn()
  const props = {
    enabled: true,
    pageSize: 50,
    pageSizeOptions: [20, 50, 100],
    rowCount: 1000 as number | undefined,
    onPageSizeChange,
    ...overrides,
  }
  const hook = renderHook((p: typeof props) => usePagination(p), { initialProps: props })
  return { ...hook, props, onPageSizeChange }
}

describe("usePagination", () => {
  it("derives the page count from the row count", () => {
    const { result } = setup()
    expect(result.current.pageCount).toBe(20)
    expect(result.current.pageIndex).toBe(0)
  })

  it("reports an unknown page count while the row count is unknown", () => {
    const { result } = setup({ rowCount: undefined })
    expect(result.current.pageCount).toBeUndefined()
  })

  it("clamps the page index into range", () => {
    const { result } = setup()
    act(() => result.current.setPageIndex(99))
    expect(result.current.pageIndex).toBe(19)
    act(() => result.current.setPageIndex(-5))
    expect(result.current.pageIndex).toBe(0)
  })

  it("keeps the first visible row when the page size changes", () => {
    const { result, onPageSizeChange } = setup()
    act(() => result.current.setPageIndex(4)) // rows 200–249
    act(() => result.current.setPageSize(100))
    expect(onPageSizeChange).toHaveBeenCalledWith(100)
    // The parent re-renders with the new size; the index was recomputed to 2 (rows 200–299).
    expect(result.current.pageIndex).toBe(2)
  })

  it("adds a page size that is not among the options", () => {
    const { result } = setup({ pageSize: 30 })
    expect(result.current.pageSizeOptions).toEqual([20, 30, 50, 100])
  })

  it("goes back to the first page on resetPage", () => {
    const { result } = setup()
    act(() => result.current.setPageIndex(3))
    act(() => result.current.resetPage())
    expect(result.current.pageIndex).toBe(0)
  })

  it("moves to the last page when the row count shrinks below the current page", () => {
    const { result, rerender, props } = setup()
    act(() => result.current.setPageIndex(19))
    rerender({ ...props, rowCount: 120 })
    expect(result.current.pageIndex).toBe(2)
  })

  it("is inert when disabled", () => {
    const { result } = setup({ enabled: false, rowCount: 1000 })
    expect(result.current.pageCount).toBe(1)
    act(() => result.current.setPageIndex(5))
    expect(result.current.pageIndex).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/core/usePagination.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/usePagination.ts
import { useCallback, useEffect, useMemo, useState } from "react"

export interface UsePaginationOptions {
  enabled: boolean
  /** Rows per page, owned by the layout so it persists. */
  pageSize: number
  pageSizeOptions: readonly number[]
  /** Total rows, or undefined while a server has not said yet. */
  rowCount: number | undefined
  /** Persist a new page size; the hook re-renders with it as `pageSize`. */
  onPageSizeChange: (pageSize: number) => void
}

/** What the footer, the shell and TanStack read and drive. */
export interface PaginationApi {
  enabled: boolean
  pageIndex: number
  pageSize: number
  pageSizeOptions: readonly number[]
  /** Undefined while the row count is unknown. */
  pageCount: number | undefined
  rowCount: number | undefined
  setPageIndex: (pageIndex: number) => void
  setPageSize: (pageSize: number) => void
  /** Back to the first page — called when sorting, filters or grouping change. */
  resetPage: () => void
}

/**
 * Page state.
 *
 * The page index is transient — a reading position, like which rows are
 * expanded — while the page size is a preference that lives in the layout.
 * Nothing here resets on a data change: in server mode every fetch is a new
 * `data` array, and resetting would send the user back to page one on
 * every response. Callers reset explicitly when the query's other inputs
 * change.
 */
export function usePagination({
  enabled,
  pageSize,
  pageSizeOptions,
  rowCount,
  onPageSizeChange,
}: UsePaginationOptions): PaginationApi {
  const [pageIndex, setPageIndexState] = useState(0)

  const pageCount = useMemo(() => {
    if (!enabled) return 1
    if (rowCount === undefined) return undefined
    return Math.max(1, Math.ceil(rowCount / pageSize))
  }, [enabled, rowCount, pageSize])

  const clamp = useCallback(
    (index: number) => {
      const last = pageCount === undefined ? Number.MAX_SAFE_INTEGER : pageCount - 1
      return Math.max(0, Math.min(index, last))
    },
    [pageCount],
  )

  const setPageIndex = useCallback(
    (index: number) => {
      if (!enabled) return
      setPageIndexState(clamp(index))
    },
    [enabled, clamp],
  )

  const setPageSize = useCallback(
    (next: number) => {
      const size = Math.max(1, Math.floor(next))
      // Keep the row at the top of the page in view under the new size.
      setPageIndexState((index) => Math.floor((index * pageSize) / size))
      onPageSizeChange(size)
    },
    [pageSize, onPageSizeChange],
  )

  const resetPage = useCallback(() => setPageIndexState(0), [])

  // A server that now reports fewer rows can leave the page past the end.
  useEffect(() => {
    if (pageCount !== undefined && pageIndex > pageCount - 1) setPageIndexState(pageCount - 1)
  }, [pageCount, pageIndex])

  const options = useMemo(
    () => (pageSizeOptions.includes(pageSize)
      ? pageSizeOptions
      : [...pageSizeOptions, pageSize].sort((a, b) => a - b)),
    [pageSizeOptions, pageSize],
  )

  return {
    enabled,
    pageIndex,
    pageSize,
    pageSizeOptions: options,
    pageCount,
    rowCount,
    setPageIndex,
    setPageSize,
    resetPage,
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/core/usePagination.test.tsx`
Expected: PASS (8 tests). The "keeps the first visible row" case passes because `renderHook` does not re-render with the new `pageSize` — the index is computed from the *old* size inside `setPageSize`, which is the intended arithmetic; the parent supplies the new size on its next render.

- [ ] **Step 5: Commit**

```bash
git add src/core/usePagination.ts src/core/usePagination.test.tsx
git commit -m "feat(pagination): page state hook with clamping and size changes"
```

---

### Task 5: Wire mode, pagination and the query into `useDataTable`

**Files:**
- Modify: `src/useDataTable.ts`
- Test: `src/ServerMode.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/ServerMode.test.tsx
import { createColumnHelper } from "@tanstack/react-table"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { localStorageLayout } from "./core/persistence"
import type { TableQuery } from "./core/query"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * Server mode: the table describes what it wants (a query) and renders what
 * it is given. Nothing is sorted or sliced locally.
 */

interface Row {
  id: string
  name: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 100 })]
const page = (from: number, count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: `r${from + i}`, name: `Row ${from + i}` }))

describe("server mode", () => {
  it("reports the initial query on mount, with the persisted page size", () => {
    localStorage.clear()
    localStorageLayout().save("srv", {
      columnOrder: [], columnVisibility: {}, columnPinning: { start: [], end: [] },
      columnSizing: {}, sorting: [{ id: "name", desc: true }], pageSize: 100,
    })
    const onQueryChange = vi.fn<(query: TableQuery) => void>()

    renderHook(() =>
      useDataTable<Row>({
        id: "srv", columns, data: [], mode: "server", rowCount: 0,
        storage: localStorageLayout(), getRowId: (row) => row.id, onQueryChange,
      }),
    )

    expect(onQueryChange).toHaveBeenCalledTimes(1)
    expect(onQueryChange.mock.calls[0]?.[0]).toEqual({
      sorting: [{ id: "name", desc: true }], columnFilters: [], globalFilter: "", grouping: [],
      pagination: { pageIndex: 0, pageSize: 100 },
    })
  })

  it("renders rows as given, unsorted and unsliced", () => {
    const rows = [...page(0, 3)].reverse()
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "srv2", columns, data: rows, mode: "server", rowCount: 500,
        getRowId: (row) => row.id, initialLayout: { sorting: [{ id: "name", desc: false }] },
      }),
    )
    expect(result.current.table.getRowModel().rows.map((r) => r.id)).toEqual(["r2", "r1", "r0"])
    expect(result.current.pagination.pageCount).toBe(10)
  })

  it("goes back to page one when sorting changes, but not when data changes", () => {
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) =>
        useDataTable<Row>({
          id: "srv3", columns, data, mode: "server", rowCount: 500,
          getRowId: (row) => row.id, onQueryChange,
        }),
      { initialProps: { data: page(0, 50) } },
    )

    act(() => result.current.pagination.setPageIndex(3))
    expect(result.current.query.pagination.pageIndex).toBe(3)

    rerender({ data: page(150, 50) }) // a fresh array, as every fetch produces
    expect(result.current.query.pagination.pageIndex).toBe(3)

    act(() => result.current.table.getColumn("name")!.toggleSorting(false))
    expect(result.current.query.pagination.pageIndex).toBe(0)
    expect(result.current.query.sorting).toEqual([{ id: "name", desc: false }])
    expect(onQueryChange).toHaveBeenLastCalledWith(result.current.query)
  })

  it("keeps the query referentially stable across unrelated renders", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) =>
        useDataTable<Row>({ id: "srv4", columns, data, mode: "server", rowCount: 10, getRowId: (r) => r.id }),
      { initialProps: { data: page(0, 10) } },
    )
    const first = result.current.query
    rerender({ data: page(0, 10) })
    expect(result.current.query).toBe(first)
  })

  it("uses the row id for expansion state", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) =>
        useDataTable<Row>({ id: "srv5", columns, data, mode: "server", rowCount: 10, getRowId: (r) => r.id }),
      { initialProps: { data: page(0, 2) } },
    )
    act(() => result.current.table.getRow("r1").toggleExpanded())
    rerender({ data: [...page(0, 2)].reverse() })
    expect(result.current.table.getRow("r1").getIsExpanded()).toBe(true)
    expect(result.current.table.getRow("r0").getIsExpanded()).toBe(false)
  })
})

describe("client mode pagination", () => {
  it("is off by default and slices when turned on", () => {
    const data = page(0, 120)
    const off = renderHook(() => useDataTable<Row>({ id: "c1", columns, data }))
    expect(off.result.current.table.getRowModel().rows).toHaveLength(120)
    expect(off.result.current.pagination.enabled).toBe(false)

    const on = renderHook(() => useDataTable<Row>({ id: "c2", columns, data, pagination: { pageSize: 50 } }))
    expect(on.result.current.table.getRowModel().rows).toHaveLength(50)
    expect(on.result.current.pagination.pageCount).toBe(3)
    act(() => on.result.current.pagination.setPageIndex(2))
    expect(on.result.current.table.getRowModel().rows).toHaveLength(20)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ServerMode.test.tsx`
Expected: FAIL — `mode`, `rowCount`, `onQueryChange`, `pagination`, `query` do not exist.

- [ ] **Step 3: Implement in `src/useDataTable.ts`**

Add imports:

```ts
import {
  // …existing…
  createPaginatedRowModel,
  rowPaginationFeature,
  type ColumnSizingState,
  type PaginationState,
  type Row,
  type RowData,
  type Updater,
} from "@tanstack/react-table"
import { useEffect, useMemo, useRef } from "react"
import { buildQuery, queriesEqual, type TableQuery } from "./core/query"
import { usePagination } from "./core/usePagination"
import { apply, useArrangement } from "./core/useArrangement"
```

Add to `FEATURES`:

```ts
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
```

Add constants and option types:

```ts
const DEFAULT_PAGE_SIZE = 50
const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [20, 50, 100, 200]

export interface PaginationOptions {
  /** Rows per page on first visit; the user's later choice is persisted. Default 50. */
  pageSize?: number
  /** Choices offered in the footer. Default [20, 50, 100, 200]. */
  pageSizeOptions?: readonly number[]
}

export type TableMode = "client" | "server"
```

Extend `UseDataTableOptions`:

```ts
  /**
   * Where rows are sorted and paged.
   *
   * `"client"` (default): the table sorts and pages `data` itself.
   * `"server"`: `data` is one page already sorted; the table only describes
   * what it wants through `onQueryChange` / `query`.
   */
  mode?: TableMode
  /** Total rows across all pages. Server mode only; undefined until known. */
  rowCount?: number
  /**
   * Page the rows. Off by default in client mode, on in server mode. Pass
   * `true` for the defaults or an object to set the page size and choices.
   */
  pagination?: boolean | PaginationOptions
  /**
   * Stable identity for a row.
   *
   * In server mode rows come and go between pages; without an id, expansion
   * state belongs to positions instead of records.
   */
  getRowId?: (row: TData, index: number, parent?: Row<DataTableFeatures, TData>) => string
  /** Called with the initial query on mount and after every change to it. */
  onQueryChange?: (query: TableQuery) => void
  /** Pixel height of a data row. Default 40; also sets `--dt-row-height`. */
  rowHeight?: number
  /** Height for particular rows, known ahead of render. */
  getRowHeight?: (row: TData) => number
```

Inside the hook body, after `bounds` and before `useArrangement`, resolve the mode and pagination options:

```ts
  const isServer = mode === "server"
  const paginationOptions: PaginationOptions | null =
    pagination === false || (pagination === undefined && !isServer)
      ? null
      : pagination === true || pagination === undefined
        ? {}
        : pagination
```

After `useArrangement` add the pagination hook and the query:

```ts
  const pageState = usePagination({
    enabled: paginationOptions !== null,
    pageSize: layout.pageSize ?? paginationOptions?.pageSize ?? DEFAULT_PAGE_SIZE,
    pageSizeOptions: paginationOptions?.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS,
    rowCount: isServer ? rowCount : undefined,
    onPageSizeChange: (size) => updateSlice("pageSize", size),
  })
```

Client mode needs the pre-paginated count for the footer; compute it after the table is built (see below). Sorting must reset the page:

```ts
  const { resetPage } = pageState
  const updateSorting = useCallback(
    (updater: Updater<TableLayout["sorting"]>) => {
      updateSlice("sorting", updater)
      resetPage()
    },
    [updateSlice, resetPage],
  )
```

Pass to `useTable`:

```ts
    state: {
      columnOrder: layout.columnOrder,
      columnVisibility: layout.columnVisibility,
      columnPinning: layout.columnPinning,
      columnSizing: layout.columnSizing,
      sorting: layout.sorting,
      pagination: { pageIndex: pageState.pageIndex, pageSize: pageState.pageSize },
      expanded,
    },
    ...(getRowId ? { getRowId } : {}),
    manualSorting: isServer,
    manualFiltering: isServer,
    manualPagination: isServer || paginationOptions === null,
    ...(isServer && rowCount !== undefined ? { rowCount } : {}),
    autoResetPageIndex: false,
    onPaginationChange: (updater: Updater<PaginationState>) => {
      const next = apply(updater, { pageIndex: pageState.pageIndex, pageSize: pageState.pageSize })
      if (next.pageSize !== pageState.pageSize) pageState.setPageSize(next.pageSize)
      if (next.pageIndex !== pageState.pageIndex) pageState.setPageIndex(next.pageIndex)
    },
    onSortingChange: updateSorting,
```

(Replace the previous `onSortingChange` line; the other `on*Change` lines stay.)

After `useTable`, derive the client row count, the final pagination object and the query:

```ts
  const clientRowCount = paginationOptions !== null && !isServer
    ? table.getPrePaginatedRowModel().rows.length
    : undefined
  const paginationApi = useMemo(
    () => ({
      ...pageState,
      rowCount: isServer ? rowCount : clientRowCount,
      pageCount: isServer
        ? pageState.pageCount
        : clientRowCount === undefined
          ? 1
          : Math.max(1, Math.ceil(clientRowCount / pageState.pageSize)),
    }),
    [pageState, isServer, rowCount, clientRowCount],
  )

  const queryInputs = { sorting: layout.sorting, pageIndex: pageState.pageIndex, pageSize: pageState.pageSize }
  const queryRef = useRef<TableQuery>(buildQuery(queryInputs))
  const candidate = buildQuery(queryInputs)
  if (!queriesEqual(candidate, queryRef.current)) queryRef.current = candidate
  const query = queryRef.current

  const onQueryChangeRef = useRef(onQueryChange)
  onQueryChangeRef.current = onQueryChange
  useEffect(() => {
    onQueryChangeRef.current?.(query)
  }, [query])

  if (import.meta.env.DEV && isServer && !getRowId) {
    warnOnce(`useDataTable("${id}"): mode "server" without getRowId keys rows by position; expansion will not follow records across pages.`)
  }

  return {
    table, id, flags, bounds, resetLayout, isCustomised, expanded,
    mode: mode ?? "client", query, pagination: paginationApi,
    rowHeight, getRowHeight,
  }
```

Add the option defaults to the destructuring: `mode = "client"`, `rowCount`, `pagination`, `getRowId`, `onQueryChange`, `rowHeight = 40`, `getRowHeight`. Add the helper at module scope:

```ts
const warned = new Set<string>()
function warnOnce(message: string): void {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(message)
}
```

- [ ] **Step 4: Run the whole suite**

Run: `pnpm typecheck && pnpm test`
Expected: clean; `Tests 125 passed` (119 + 6). If `table.getRow("r1")` is typed as possibly throwing, that is fine — it throws only for unknown ids.

- [ ] **Step 5: Commit**

```bash
git add src/useDataTable.ts src/ServerMode.test.tsx
git commit -m "feat(hook): server mode, TableQuery, pagination state on the instance"
git push origin khojiakbar
```

---

### Task 6: Labels

**Files:**
- Modify: `src/types.ts`, `src/components/DataTable.tsx` (`defaultLabels`)

- [ ] **Step 1: Extend the label contract**

In `src/types.ts`, add to `DataTableLabels`:

```ts
  /** Footer: total rows. */
  rows: string
  rowsPerPage: string
  /** "1–50 of 1 000"; `total` is undefined while a server has not answered. */
  range: (from: number, to: number, total: number | undefined) => string
  /** "Page 3 of 20"; `count` is undefined while unknown. */
  page: (page: number, count: number | undefined) => string
  pageNumber: string
  firstPage: string
  previousPage: string
  nextPage: string
  lastPage: string
  loading: string
  loadFailed: string
  retry: string
```

- [ ] **Step 2: Provide English defaults**

In `src/components/DataTable.tsx`, append to `defaultLabels`:

```ts
  rows: "Rows",
  rowsPerPage: "Rows per page",
  range: (from, to, total) => `${from}–${to} of ${total ?? "…"}`,
  page: (page, count) => `Page ${page} of ${count ?? "…"}`,
  pageNumber: "Page number",
  firstPage: "First page",
  previousPage: "Previous page",
  nextPage: "Next page",
  lastPage: "Last page",
  loading: "Loading",
  loadFailed: "Could not load rows",
  retry: "Retry",
```

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm typecheck && pnpm test` — expected clean, 125 passing.

```bash
git add src/types.ts src/components/DataTable.tsx
git commit -m "feat(labels): footer and loading strings"
```

---

### Task 7: `TablePagination` footer

**Files:**
- Create: `src/components/TablePagination.tsx`
- Modify: `src/styles.css`, `src/components/DataTable.tsx` (render it), `src/index.ts` (export)
- Test: `src/TablePagination.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/TablePagination.test.tsx
import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures, type DataTableInstance } from "./useDataTable"

interface Row { id: string; name: string }
const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 100 })]
const rows = (count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }))

let latest: DataTableInstance<Row> | null = null

function Table({ count = 1000, pageSize = 50 }: { count?: number; pageSize?: number }) {
  const instance = useDataTable<Row>({
    id: "pg", columns, data: rows(count), pagination: { pageSize }, getRowId: (r) => r.id,
  })
  latest = instance
  return <DataTable instance={instance} virtualize={false} />
}

describe("pagination footer", () => {
  beforeEach(() => localStorage.clear())

  it("shows the range, the page and the total", () => {
    render(<Table />)
    expect(screen.getByText(/^Rows:/).textContent).toBe("Rows: 1\u202f000")
    expect(screen.getByText("1–50 of 1000")).toBeInTheDocument()
    expect(screen.getByText("Page 1 of 20")).toBeInTheDocument()
  })

  it("navigates with the buttons and disables them at the edges", async () => {
    const user = userEvent.setup()
    render(<Table />)

    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: /next page/i }))
    expect(screen.getByText("51–100 of 1000")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /last page/i }))
    expect(screen.getByText("951–1000 of 1000")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: /first page/i }))
    expect(screen.getByText("1–50 of 1000")).toBeInTheDocument()
  })

  it("changes the page size and keeps the top row in view", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(screen.getByRole("button", { name: /next page/i })) // rows 51–100
    await user.selectOptions(screen.getByRole("combobox", { name: /rows per page/i }), "20")
    expect(screen.getByText("41–60 of 1000")).toBeInTheDocument()
    expect(latest?.pagination.pageSize).toBe(20)
  })

  it("jumps to a typed page and clamps out-of-range input", () => {
    render(<Table />)
    const input = screen.getByRole("spinbutton", { name: /page number/i })
    fireEvent.change(input, { target: { value: "7" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(screen.getByText("301–350 of 1000")).toBeInTheDocument()
    fireEvent.change(input, { target: { value: "99" } })
    fireEvent.blur(input)
    expect(screen.getByText("951–1000 of 1000")).toBeInTheDocument()
  })

  it("renders no footer when pagination is off", () => {
    function Plain() {
      const instance = useDataTable<Row>({ id: "plain", columns, data: rows(3) })
      return <DataTable instance={instance} virtualize={false} />
    }
    const { container } = render(<Plain />)
    expect(container.querySelector(".dt-footer")).toBeNull()
  })
})
```

Note: the `virtualize` prop does not exist until Task 10; until then TypeScript will reject it. Add `virtualize?: boolean` to `DataTableProps` now (unused, documented "Render every row instead of a window. Default true.") so this test file compiles; Task 10 makes it do something.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/TablePagination.test.tsx`
Expected: FAIL — no footer rendered.

- [ ] **Step 3: Implement the footer**

```tsx
// src/components/TablePagination.tsx
import type { RowData } from "@tanstack/react-table"
import { useEffect, useState, type KeyboardEvent } from "react"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

interface TablePaginationProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
}

/**
 * The footer: total rows, rows per page, the current range, and page
 * navigation — in AG Grid's order. Rendered outside the scrolling viewport.
 *
 * Exported for shells of their own: it reads everything from `instance.pagination`.
 */
export function TablePagination<TData extends RowData>({ instance, labels }: TablePaginationProps<TData>) {
  const { enabled, pageIndex, pageSize, pageSizeOptions, pageCount, rowCount, setPageIndex, setPageSize } =
    instance.pagination
  if (!enabled) return null

  const from = rowCount === 0 ? 0 : pageIndex * pageSize + 1
  const to = rowCount === undefined ? (pageIndex + 1) * pageSize : Math.min(rowCount, (pageIndex + 1) * pageSize)
  const canPrevious = pageIndex > 0
  const canNext = pageCount === undefined || pageIndex < pageCount - 1
  const lastIndex = pageCount === undefined ? pageIndex : pageCount - 1

  return (
    <div className="dt-footer">
      <span className="dt-footer-rows">
        {labels.rows}: {formatCount(rowCount)}
      </span>
      <span className="dt-spacer" />
      <label className="dt-footer-size">
        {labels.rowsPerPage}
        <select
          className="dt-select"
          value={pageSize}
          onChange={(event) => setPageSize(Number(event.target.value))}
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <span className="dt-footer-range">{labels.range(from, to, rowCount)}</span>
      <nav className="dt-footer-nav" aria-label={labels.page(pageIndex + 1, pageCount)}>
        <NavButton label={labels.firstPage} disabled={!canPrevious} onClick={() => setPageIndex(0)} glyph="«" />
        <NavButton label={labels.previousPage} disabled={!canPrevious} onClick={() => setPageIndex(pageIndex - 1)} glyph="‹" />
        <PageInput pageIndex={pageIndex} lastIndex={lastIndex} label={labels.pageNumber} onCommit={setPageIndex} />
        <span className="dt-footer-page">{labels.page(pageIndex + 1, pageCount)}</span>
        <NavButton label={labels.nextPage} disabled={!canNext} onClick={() => setPageIndex(pageIndex + 1)} glyph="›" />
        <NavButton label={labels.lastPage} disabled={!canNext || pageCount === undefined} onClick={() => setPageIndex(lastIndex)} glyph="»" />
      </nav>
    </div>
  )
}

function NavButton({ label, disabled, onClick, glyph }: { label: string; disabled: boolean; onClick: () => void; glyph: string }) {
  return (
    <button type="button" className="dt-icon-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {glyph}
    </button>
  )
}

/** A page number the user can type; commits on Enter or blur, clamped. */
function PageInput({
  pageIndex, lastIndex, label, onCommit,
}: { pageIndex: number; lastIndex: number; label: string; onCommit: (index: number) => void }) {
  const [draft, setDraft] = useState(String(pageIndex + 1))
  useEffect(() => setDraft(String(pageIndex + 1)), [pageIndex])

  const commit = () => {
    const page = Number.parseInt(draft, 10)
    if (Number.isFinite(page)) onCommit(Math.max(0, Math.min(page - 1, lastIndex)))
    else setDraft(String(pageIndex + 1))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      commit()
    }
  }

  return (
    <input
      type="number"
      className="dt-page-input"
      aria-label={label}
      min={1}
      max={lastIndex + 1}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}

/** "1 000" with a thin non-breaking space; "…" while unknown. */
function formatCount(count: number | undefined): string {
  if (count === undefined) return "…"
  return count.toLocaleString("en-US").replace(/,/g, " ")
}
```

CSS, appended to `src/styles.css`:

```css
/* ---------- footer ---------- */

.dt-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  flex: none;
  padding: 6px 10px;
  border-top: 1px solid var(--dt-border);
  background: var(--dt-bg);
  font-size: 13px;
  color: var(--dt-muted-fg);
  border-radius: inherit;
  border-start-start-radius: 0;
  border-start-end-radius: 0;
}

.dt-footer-size {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.dt-select,
.dt-page-input {
  height: 28px;
  padding-inline: 6px;
  border: 1px solid var(--dt-border);
  border-radius: 6px;
  background: var(--dt-bg);
  color: var(--dt-fg);
  font: inherit;
  font-size: 13px;
}

.dt-page-input {
  width: 4em;
  text-align: center;
}

.dt-footer-nav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dt-icon-button {
  width: 28px;
  height: 28px;
  border: 1px solid var(--dt-border);
  border-radius: 6px;
  background: var(--dt-bg);
  color: var(--dt-fg);
  font: inherit;
  cursor: pointer;
}

.dt-icon-button:hover:not(:disabled) {
  background: var(--dt-row-hover);
}

.dt-icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.dt-select:focus-visible,
.dt-page-input:focus-visible,
.dt-icon-button:focus-visible {
  outline: 2px solid var(--dt-focus-ring);
  outline-offset: -2px;
}
```

Because the footer is now the last child, the viewport's bottom corners must not be rounded when it is present. Replace the `.dt-toolbar ~ .dt-viewport` rule block with:

```css
.dt-toolbar ~ .dt-viewport {
  border-start-start-radius: 0;
  border-start-end-radius: 0;
}

.dt-viewport:has(~ .dt-footer) {
  border-end-start-radius: 0;
  border-end-end-radius: 0;
}
```

In `src/components/DataTable.tsx`: add `footer?: boolean` (default `true`) and `virtualize?: boolean` (default `true`) to the props, import `TablePagination`, and render `{footer ? <TablePagination instance={instance} labels={labels} /> : null}` after the `.dt-viewport` div. In `src/index.ts` add `export { TablePagination } from "./components/TablePagination"`.

- [ ] **Step 4: Run the tests**

Run: `pnpm typecheck && pnpm vitest run src/TablePagination.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/TablePagination.tsx src/components/DataTable.tsx src/styles.css src/index.ts src/TablePagination.test.tsx
git commit -m "feat(footer): pagination footer with page size, range and navigation"
git push origin khojiakbar
```

---

### Task 8: Pure virtual-row helpers

**Files:**
- Create: `src/core/virtualRows.ts`
- Test: `src/core/virtualRows.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/core/virtualRows.test.ts
import { describe, expect, it } from "vitest"
import { buildDisplayList, displayItemKey, spacerSizes } from "./virtualRows"

const row = (id: string) => ({ id })

describe("buildDisplayList", () => {
  it("lists rows, with a detail item after each open row", () => {
    const rows = [row("a"), row("b"), row("c")]
    const list = buildDisplayList(rows, (r) => r.id === "b")

    expect(list.map((item) => `${item.kind}:${item.row.id}`)).toEqual(["row:a", "row:b", "detail:b", "row:c"])
    expect(list.map((item) => item.position)).toEqual([0, 1, 1, 2])
  })

  it("gives every item a key that cannot collide", () => {
    const list = buildDisplayList([row("a")], () => true)
    expect(list.map(displayItemKey)).toEqual(["a", "a:detail"])
  })
})

describe("spacerSizes", () => {
  it("is zero at both ends when nothing is virtualised", () => {
    expect(spacerSizes(undefined, undefined, 0, 0)).toEqual({ top: 0, bottom: 0 })
  })

  it("subtracts the header offset from item coordinates", () => {
    // Header is 38px; items start after it. Visible window: items at 400..840 of a 4000px body.
    expect(spacerSizes({ start: 438 }, { end: 878 }, 4000, 38)).toEqual({ top: 400, bottom: 3160 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/core/virtualRows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/virtualRows.ts
/**
 * The list the virtualiser sees.
 *
 * A table row and its open detail panel are separate items: they have
 * different heights, and only the panel needs measuring. Keeping them apart
 * lets a data row's height be known without touching the DOM.
 */

export interface DisplayItem<TRow> {
  kind: "row" | "detail"
  row: TRow
  /** The row's position among rows (not items), for striping. */
  position: number
}

/**
 * Interleave rows with a detail item after each open one.
 *
 * @param rows - Rows in render order.
 * @param isDetailOpen - Whether a row's detail panel is showing.
 * @returns A new list; `rows` is not modified.
 */
export function buildDisplayList<TRow>(
  rows: readonly TRow[],
  isDetailOpen: (row: TRow) => boolean,
): DisplayItem<TRow>[] {
  return rows.flatMap((row, position) =>
    isDetailOpen(row)
      ? [{ kind: "row" as const, row, position }, { kind: "detail" as const, row, position }]
      : [{ kind: "row" as const, row, position }],
  )
}

/** A key that is stable across pages and distinct for a row and its panel. */
export function displayItemKey<TRow extends { id: string }>(item: DisplayItem<TRow>): string {
  return item.kind === "detail" ? `${item.row.id}:detail` : item.row.id
}

export interface SpacerSizes {
  top: number
  bottom: number
}

/**
 * Heights of the two spacer rows around the rendered window.
 *
 * Item coordinates from the virtualiser include `scrollMargin` (the header's
 * height, which sits before the rows in the same scroll box) while the total
 * size does not, so the margin is removed from both ends.
 *
 * @param first - The first rendered item, or undefined when none.
 * @param last - The last rendered item.
 * @param totalSize - `virtualizer.getTotalSize()`.
 * @param scrollMargin - The header's height.
 */
export function spacerSizes(
  first: { start: number } | undefined,
  last: { end: number } | undefined,
  totalSize: number,
  scrollMargin: number,
): SpacerSizes {
  if (!first || !last) return { top: 0, bottom: 0 }
  return {
    top: Math.max(0, first.start - scrollMargin),
    bottom: Math.max(0, totalSize - (last.end - scrollMargin)),
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/core/virtualRows.test.ts` — expected PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/virtualRows.ts src/core/virtualRows.test.ts
git commit -m "feat(virtual): display list and spacer arithmetic"
```

---

### Task 9: `useRowVirtualizer`

**Files:**
- Create: `src/core/useRowVirtualizer.ts`
- Modify: `src/index.ts` (export)

No isolated test: the hook is exercised through `TableBody` in Task 10, where a scroll element with a size exists.

- [ ] **Step 1: Implement**

```ts
// src/core/useRowVirtualizer.ts
import { useVirtualizer } from "@tanstack/react-virtual"
import { useCallback, useLayoutEffect, useMemo, useState, type RefObject } from "react"
import { buildDisplayList, displayItemKey, spacerSizes, type DisplayItem } from "./virtualRows"

/** A guess for a detail panel until it is measured. */
const DETAIL_ESTIMATE_PX = 160
const DEFAULT_OVERSCAN = 8

export interface RowVirtualizerOptions<TRow extends { id: string; original: unknown }> {
  rows: readonly TRow[]
  /** The scrolling element. */
  viewportRef: RefObject<HTMLElement | null>
  /** The `<thead>`, whose height offsets every row inside the same scroll box. */
  headRef: RefObject<HTMLElement | null>
  rowHeight: number
  getRowHeight?: ((row: TRow["original"]) => number) | undefined
  isDetailOpen: (row: TRow) => boolean
  /** False renders everything, with no spacers. */
  enabled: boolean
  overscan?: number
}

export interface RenderedItem<TRow> {
  item: DisplayItem<TRow>
  /** Index in the display list; detail rows need it for measurement. */
  index: number
}

export interface RowVirtualizerResult<TRow> {
  items: RenderedItem<TRow>[]
  top: number
  bottom: number
  /** Attach to detail rows (with `data-index`) so their height is measured. */
  measureElement: (element: HTMLElement | null) => void
}

/**
 * Which rows to render, and how much empty space to leave around them.
 *
 * Data rows are never measured: their height is `rowHeight` or
 * `getRowHeight(row)`, so the scrollbar is exact by construction. Detail
 * panels are the exception and are measured on mount and on resize.
 *
 * @example
 * const { items, top, bottom, measureElement } = useRowVirtualizer({ ... })
 */
export function useRowVirtualizer<TRow extends { id: string; original: unknown }>({
  rows,
  viewportRef,
  headRef,
  rowHeight,
  getRowHeight,
  isDetailOpen,
  enabled,
  overscan = DEFAULT_OVERSCAN,
}: RowVirtualizerOptions<TRow>): RowVirtualizerResult<TRow> {
  const items = useMemo(() => buildDisplayList(rows, isDetailOpen), [rows, isDetailOpen])
  const scrollMargin = useElementHeight(headRef)

  const estimateSize = useCallback(
    (index: number) => {
      const item = items[index]
      if (!item) return rowHeight
      if (item.kind === "detail") return DETAIL_ESTIMATE_PX
      return getRowHeight?.(item.row.original) ?? rowHeight
    },
    [items, rowHeight, getRowHeight],
  )
  const getItemKey = useCallback((index: number) => displayItemKey(items[index]!), [items])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    estimateSize,
    getItemKey,
    overscan,
    scrollMargin,
    enabled,
  })

  if (!enabled) {
    return {
      items: items.map((item, index) => ({ item, index })),
      top: 0,
      bottom: 0,
      measureElement: () => undefined,
    }
  }

  const virtualItems = virtualizer.getVirtualItems()
  const { top, bottom } = spacerSizes(
    virtualItems[0],
    virtualItems[virtualItems.length - 1],
    virtualizer.getTotalSize(),
    scrollMargin,
  )
  return {
    items: virtualItems.map((virtualItem) => ({ item: items[virtualItem.index]!, index: virtualItem.index })),
    top,
    bottom,
    measureElement: virtualizer.measureElement,
  }
}

/** The rendered height of an element, kept current with a ResizeObserver when one exists. */
function useElementHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setHeight(element.offsetHeight)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return height
}
```

Export from `src/index.ts`:

```ts
export { useRowVirtualizer } from "./core/useRowVirtualizer"
export type { RowVirtualizerOptions, RowVirtualizerResult, RenderedItem } from "./core/useRowVirtualizer"
export { buildDisplayList, displayItemKey, spacerSizes } from "./core/virtualRows"
export type { DisplayItem } from "./core/virtualRows"
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck` — expected clean. If `enabled` is rejected by the installed react-virtual types, check `node_modules/@tanstack/virtual-core/dist/esm/index.d.ts` for `enabled?: boolean` in `VirtualizerOptions`; it is present from 3.5 on.

- [ ] **Step 3: Commit**

```bash
git add src/core/useRowVirtualizer.ts src/index.ts
git commit -m "feat(virtual): useRowVirtualizer wrapper over react-virtual"
```

---

### Task 10: `TableBody` with spacers, parity striping, `virtualize` prop

**Files:**
- Create: `src/components/TableBody.tsx`
- Modify: `src/components/BodyRow.tsx` (data row only, parity, row height), `src/components/DataTable.tsx` (refs, use `TableBody`), `src/styles.css` (spacer, parity striping)
- Test: `src/Virtualization.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/Virtualization.test.tsx
import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * jsdom lays nothing out, so the viewport is given a size by stubbing its
 * bounding box, and scrolling is simulated by setting scrollTop and firing
 * a scroll event — exactly the two inputs the virtualiser reads.
 */

interface Row { id: string; name: string }
const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 200 })]
const rows = (count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }))

const VIEWPORT_PX = 300
const ROW_PX = 40

function stubViewportSize() {
  const original = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains("dt-viewport")) {
      return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: VIEWPORT_PX, width: 800, height: VIEWPORT_PX, toJSON: () => ({}) } as DOMRect
    }
    return original.call(this)
  }
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original
  }
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function Table({ count = 1000, virtualize = true, detail = false }: { count?: number; virtualize?: boolean; detail?: boolean }) {
  const instance = useDataTable<Row>({ id: "virt", columns, data: rows(count), getRowId: (r) => r.id, rowHeight: ROW_PX })
  return (
    <DataTable
      instance={instance}
      height={VIEWPORT_PX}
      virtualize={virtualize}
      renderDetail={detail ? (row) => <div data-testid="detail">Detail {row.id}</div> : undefined}
    />
  )
}

const renderedRows = () => screen.getAllByRole("row").filter((r) => r.classList.contains("dt-tr"))
/** Spacer heights by position: a spacer is "top" when a data row follows it, "bottom" otherwise. */
const spacers = (container: HTMLElement) => {
  const result = { top: 0, bottom: 0 }
  for (const tr of container.querySelectorAll<HTMLElement>("tr.dt-spacer")) {
    const height = Number.parseFloat(tr.style.height)
    if (tr.nextElementSibling?.classList.contains("dt-tr")) result.top = height
    else result.bottom = height
  }
  return result
}
/** jsdom lays nothing out: scrolling is the two inputs the virtualiser reads, a scrollTop and a scroll event. */
const scrollTo = (viewport: HTMLElement, top: number) => {
  Object.defineProperty(viewport, "scrollTop", { value: top, writable: true, configurable: true })
  fireEvent.scroll(viewport)
}

describe("row virtualisation", () => {
  let restore: () => void
  beforeEach(() => {
    localStorage.clear()
    restore = stubViewportSize()
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
  })
  afterEach(() => {
    restore()
    vi.unstubAllGlobals()
  })

  it("renders a window of rows and spacers that add up to the full height", () => {
    const { container } = render(<Table />)
    const visible = renderedRows()
    // 300px / 40px = 8 rows in view, plus overscan below; far fewer than 1000.
    expect(visible.length).toBeGreaterThanOrEqual(8)
    expect(visible.length).toBeLessThan(40)
    expect(visible[0]).toHaveTextContent("Row 0")

    const { top, bottom } = spacers(container)
    expect(top).toBe(0) // nothing above the first row: no top spacer
    expect(bottom).toBe(1000 * ROW_PX - visible.length * ROW_PX)
  })

  it("moves the window when the viewport scrolls", () => {
    const { container } = render(<Table />)
    const viewport = container.querySelector(".dt-viewport") as HTMLElement
    scrollTo(viewport, 20_000) // row 500

    const visible = renderedRows()
    expect(visible.some((r) => r.textContent?.includes("Row 500"))).toBe(true)
    expect(visible.some((r) => r.textContent?.includes("Row 0 "))).toBe(false)
    const { top, bottom } = spacers(container)
    expect(top + bottom + visible.length * ROW_PX).toBe(1000 * ROW_PX)
  })

  it("renders every row when virtualisation is off", () => {
    const { container } = render(<Table count={50} virtualize={false} />)
    expect(renderedRows()).toHaveLength(50)
    expect(container.querySelector("tr.dt-spacer")).toBeNull()
  })

  it("keeps stripe parity by row position, not DOM position", () => {
    const { container } = render(<Table />)
    const viewport = container.querySelector(".dt-viewport") as HTMLElement
    scrollTo(viewport, 20_000)
    const row501 = renderedRows().find((r) => r.textContent?.includes("Row 501")) as HTMLElement
    expect(row501.dataset.parity).toBe("odd")
  })

  it("gives an open detail panel its own measured item", async () => {
    const user = userEvent.setup()
    const { container } = render(<Table count={20} detail />)
    await user.click(screen.getAllByRole("button", { name: /expand row/i })[0] as HTMLElement)

    const detailRow = container.querySelector("tr.dt-detail-row") as HTMLElement
    expect(detailRow.dataset.index).toBe("1")
    expect(screen.getByTestId("detail")).toHaveTextContent("Detail r0")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/Virtualization.test.tsx`
Expected: FAIL — all 1000 rows render, no spacers, `virtualize` ignored.

- [ ] **Step 3: Slim `BodyRow` to one data row**

Rewrite `src/components/BodyRow.tsx` so it renders only the `<tr class="dt-tr">` (the detail row moves to `TableBody`), takes `position` for parity and an optional explicit height:

```tsx
import { flexRender, type Row, type RowData } from "@tanstack/react-table"
import { classNames, insertAt } from "../core/classNames"
import { pinnedStyle } from "../core/pinning"
import type { DataTableFeatures } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { DepthSpacer, ExpandToggle } from "./ExpandToggle"

interface BodyRowProps<TData extends RowData> {
  row: Row<DataTableFeatures, TData>
  /** Position among rows in render order; drives striping. */
  position: number
  /** Explicit height when the table has `getRowHeight`. */
  height?: number | undefined
  /** Where the filler cell goes among the visible cells; see `fillerIndex`. */
  fillerAt: number
  labels: DataTableLabels
  /** Whether a detail panel can open under this row. */
  hasDetail: boolean
  onRowClick?: ((row: TData) => void) | undefined
}

/**
 * One data row.
 *
 * The lead cell holds the expand toggle (or an indent spacer) beside the
 * value, in a flex wrapper INSIDE the cell: a `<td>` that is itself a flex
 * container cannot truncate its text with an ellipsis.
 *
 * Striping is keyed on `data-parity`, not `:nth-child`: with virtualisation
 * the DOM position of a row says nothing about its position in the data.
 */
export function BodyRow<TData extends RowData>({
  row,
  position,
  height,
  fillerAt,
  labels,
  hasDetail,
  onRowClick,
}: BodyRowProps<TData>) {
  const cells = row.getVisibleCells()
  const expandable = row.subRows.length > 0 || hasDetail
  const isExpanded = expandable && row.getIsExpanded()

  const rendered = cells.map((cell, index) => {
    const value = flexRender(cell.column.columnDef.cell, cell.getContext())
    return (
      <td
        key={cell.id}
        className={classNames("dt-td", cell.column.getIsPinned() && "dt-pinned", index === 0 && "dt-td-lead")}
        style={pinnedStyle(cell.column)}
        data-column-id={cell.column.id}
      >
        {index === 0 ? (
          <div className="dt-lead">
            {expandable ? (
              <ExpandToggle
                expanded={isExpanded}
                depth={row.depth}
                label={isExpanded ? labels.collapseRow : labels.expandRow}
                onToggle={() => row.toggleExpanded()}
              />
            ) : (
              <DepthSpacer depth={row.depth} />
            )}
            <span className="dt-td-value">{value}</span>
          </div>
        ) : (
          value
        )}
      </td>
    )
  })

  return (
    <tr
      className={isExpanded ? "dt-tr dt-tr-expanded" : "dt-tr"}
      data-depth={row.depth}
      data-parity={position % 2 === 0 ? "even" : "odd"}
      style={height === undefined ? undefined : { height }}
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
    >
      {insertAt(rendered, fillerAt, <td key="filler" className="dt-td dt-td-filler" role="presentation" />)}
    </tr>
  )
}
```

- [ ] **Step 4: Create `TableBody`**

```tsx
// src/components/TableBody.tsx
import type { Row, RowData } from "@tanstack/react-table"
import { useCallback, type ReactNode, type RefObject } from "react"
import { useRowVirtualizer } from "../core/useRowVirtualizer"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { BodyRow } from "./BodyRow"

interface TableBodyProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  rows: Row<DataTableFeatures, TData>[]
  viewportRef: RefObject<HTMLElement | null>
  headRef: RefObject<HTMLTableSectionElement | null>
  /** Where the filler cell goes among the visible cells. */
  fillerAt: number
  /** Visible leaf columns plus the filler, for the spacer's colSpan. */
  columnCount: number
  labels: DataTableLabels
  virtualize: boolean
  renderDetail?: ((row: TData) => ReactNode) | undefined
  onRowClick?: ((row: TData) => void) | undefined
}

/**
 * The rows, windowed.
 *
 * A top spacer, the rendered window (data rows and open detail panels), and
 * a bottom spacer. Rows stay in normal table flow, so sticky headers, pinned
 * cells and the colgroup behave as they do without virtualisation.
 */
export function TableBody<TData extends RowData>({
  instance,
  rows,
  viewportRef,
  headRef,
  fillerAt,
  columnCount,
  labels,
  virtualize,
  renderDetail,
  onRowClick,
}: TableBodyProps<TData>) {
  const { rowHeight, getRowHeight } = instance
  const hasDetail = renderDetail !== undefined
  const isDetailOpen = useCallback(
    (row: Row<DataTableFeatures, TData>) => hasDetail && row.getIsExpanded(),
    [hasDetail],
  )

  const { items, top, bottom, measureElement } = useRowVirtualizer({
    rows,
    viewportRef,
    headRef,
    rowHeight,
    getRowHeight,
    isDetailOpen,
    enabled: virtualize,
  })

  return (
    <tbody>
      {top > 0 ? <SpacerRow height={top} span={columnCount} /> : null}
      {items.map(({ item, index }) =>
        item.kind === "row" ? (
          <BodyRow
            key={item.row.id}
            row={item.row}
            position={item.position}
            height={getRowHeight?.(item.row.original)}
            fillerAt={fillerAt}
            labels={labels}
            hasDetail={hasDetail}
            onRowClick={onRowClick}
          />
        ) : (
          <tr
            key={`${item.row.id}:detail`}
            className="dt-detail-row"
            data-depth={item.row.depth}
            data-index={index}
            ref={measureElement}
          >
            <td className="dt-detail-cell" colSpan={columnCount}>
              <div
                className="dt-detail"
                style={
                  item.row.depth > 0
                    ? { marginInlineStart: `calc(var(--dt-indent) * ${item.row.depth + 1})` }
                    : undefined
                }
              >
                {renderDetail?.(item.row.original)}
              </div>
            </td>
          </tr>
        ),
      )}
      {bottom > 0 ? <SpacerRow height={bottom} span={columnCount} /> : null}
    </tbody>
  )
}

/** Empty space standing in for rows that are not rendered. */
function SpacerRow({ height, span }: { height: number; span: number }) {
  return (
    <tr className="dt-spacer" aria-hidden="true" style={{ height }}>
      <td colSpan={span} />
    </tr>
  )
}
```

- [ ] **Step 5: Use it from `DataTable`**

In `src/components/DataTable.tsx`:
- add `const viewportRef = useRef<HTMLDivElement>(null)` and `const headRef = useRef<HTMLTableSectionElement>(null)`;
- put `ref={viewportRef}` on the `.dt-viewport` div and `ref={headRef}` on `<thead>`;
- set the row-height token on the root: `style={{ ...rootStyle, "--dt-row-height": `${instance.rowHeight}px` } as CSSProperties}`;
- replace the whole `<tbody>…</tbody>` block with:

```tsx
          <TableBody
            instance={instance}
            rows={rows}
            viewportRef={viewportRef}
            headRef={headRef}
            fillerAt={fillerAt}
            columnCount={leafColumns.length + 1}
            labels={labels}
            virtualize={virtualize}
            renderDetail={renderDetail}
            onRowClick={onRowClick}
          />
```

- remove the now-unused `BodyRow` import; `virtualize = true` is destructured from props.

CSS in `src/styles.css`: replace the `.dt-striped .dt-tr:nth-child(even) .dt-td` rule with

```css
.dt-striped .dt-tr[data-parity="odd"] .dt-td {
  background: var(--dt-row-stripe);
}
```

and add

```css
/* Empty rows standing in for the ones outside the rendered window. */
.dt-spacer > td {
  padding: 0;
  border: 0;
}
```

- [ ] **Step 6: Run everything**

Run: `pnpm typecheck && pnpm test`
Expected: clean; `Tests 134 passed` (125 + 5 virtualisation + 4 from Task 8… count whatever vitest prints; the point is zero failures). Tests that count body rows in other files still pass: they render ≤ 8 rows, all inside the overscan window even with a 0-height jsdom viewport.

If `Expanding.test.tsx` fails on `getAllByRole("row")` counts because the detail row now carries `data-index`, that is expected only if a test asserted the exact attribute set — none does.

- [ ] **Step 7: Commit**

```bash
git add src/components/TableBody.tsx src/components/BodyRow.tsx src/components/DataTable.tsx src/styles.css src/Virtualization.test.tsx
git commit -m "feat(virtual): windowed rows with spacer rows; parity striping; virtualize prop"
git push origin khojiakbar
```

---

### Task 11: Loading, error and skeleton states

**Files:**
- Create: `src/components/TableStatus.tsx`
- Modify: `src/components/DataTable.tsx` (props `loading`, `error`, `onRetry`), `src/styles.css`
- Test: `src/LoadingStates.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/LoadingStates.test.tsx
import { createColumnHelper } from "@tanstack/react-table"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

interface Row { id: string; name: string }
const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 100 }), helper.accessor("id", { header: "Id", size: 80 })]
const rows: Row[] = [{ id: "a", name: "Alpha" }]

function Table(props: { data?: Row[]; loading?: boolean; error?: unknown; onRetry?: () => void }) {
  const instance = useDataTable<Row>({ id: "st", columns, data: props.data ?? [], mode: "server", rowCount: props.data?.length ?? 0, getRowId: (r) => r.id })
  return <DataTable instance={instance} loading={props.loading} error={props.error} onRetry={props.onRetry} virtualize={false} />
}

describe("loading states", () => {
  it("shows skeleton rows on first load", () => {
    const { container } = render(<Table loading />)
    expect(container.querySelectorAll("tr.dt-skeleton-row").length).toBeGreaterThan(0)
    expect(screen.queryByText("No rows")).toBeNull()
  })

  it("keeps rows visible and shows a progress bar while refetching", () => {
    const { container } = render(<Table data={rows} loading />)
    expect(screen.getByText("Alpha")).toBeInTheDocument()
    expect(container.querySelector(".dt-progress")).not.toBeNull()
    expect(container.querySelector(".dt-viewport")?.classList.contains("dt-loading")).toBe(true)
  })

  it("shows the error with a retry action, above any stale rows", async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<Table data={rows} error={new Error("Boom")} onRetry={onRetry} />)
    expect(screen.getByRole("alert")).toHaveTextContent("Boom")
    expect(screen.getByText("Alpha")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("shows the empty state only when idle with no rows", () => {
    render(<Table />)
    expect(screen.getByText("No rows")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/LoadingStates.test.tsx` — expected FAIL (props unknown).

- [ ] **Step 3: Implement the status pieces**

```tsx
// src/components/TableStatus.tsx
import type { DataTableLabels } from "../types"

interface TableStatusProps {
  loading: boolean
  error: unknown
  onRetry?: (() => void) | undefined
  labels: DataTableLabels
}

/**
 * What sits at the top of the viewport while rows are on their way or failed.
 *
 * Error beats loading, loading beats empty — the same precedence AG Grid uses.
 */
export function TableStatus({ loading, error, onRetry, labels }: TableStatusProps) {
  if (error !== undefined && error !== null) {
    return (
      <div className="dt-error" role="alert">
        <span>{labels.loadFailed}: {errorMessage(error)}</span>
        {onRetry ? (
          <button type="button" className="dt-menu-button" onClick={onRetry}>
            {labels.retry}
          </button>
        ) : null}
      </div>
    )
  }
  if (loading) return <div className="dt-progress" role="progressbar" aria-label={labels.loading} />
  return null
}

interface SkeletonRowsProps {
  /** Rendered column widths, in order, filler included. */
  widths: number[]
  count: number
}

/** Placeholder rows while the first page loads. */
export function SkeletonRows({ widths, count }: SkeletonRowsProps) {
  return (
    <tbody>
      {Array.from({ length: count }, (_, rowIndex) => (
        <tr key={rowIndex} className="dt-skeleton-row" aria-hidden="true">
          {widths.map((width, cellIndex) => (
            <td key={cellIndex} className="dt-td">
              {width > 0 ? <span className="dt-skeleton" style={{ width: `${40 + ((rowIndex * 7 + cellIndex * 13) % 45)}%` }} /> : null}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return String(error)
}
```

In `src/components/DataTable.tsx`:
- props: `loading?: boolean` (default `false`), `error?: unknown`, `onRetry?: () => void`;
- compute `const showSkeleton = loading && rows.length === 0 && (error === undefined || error === null)` and `const showEmpty = !loading && (error === undefined || error === null) && rows.length === 0`;
- add `classNames("dt-viewport", loading && "dt-loading")` on the viewport and render `<TableStatus loading={loading} error={error} onRetry={onRetry} labels={labels} />` as the first child of the viewport;
- render `showSkeleton ? <SkeletonRows widths={insertAt(leafColumns.map((c) => c.getSize()), fillerAt, 0)} count={Math.min(instance.pagination.pageSize, 8)} /> : <TableBody … />`;
- change the empty-state condition to `showEmpty`.

CSS appended to `src/styles.css`:

```css
/* ---------- status ---------- */

.dt-progress {
  position: sticky;
  top: 0;
  z-index: 5;
  height: 2px;
  margin-bottom: -2px;
  background: linear-gradient(90deg, transparent, var(--dt-accent), transparent);
  background-size: 40% 100%;
  animation: dt-progress 1s linear infinite;
}

@keyframes dt-progress {
  from { background-position: -40% 0; }
  to { background-position: 140% 0; }
}

.dt-loading tbody {
  opacity: 0.6;
  transition: opacity 200ms ease;
}

.dt-error {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dt-border);
  background: var(--dt-bg);
  color: var(--dt-fg);
  font-size: 13px;
}

.dt-skeleton {
  display: inline-block;
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--dt-row-hover) 25%, var(--dt-border) 50%, var(--dt-row-hover) 75%);
  background-size: 200% 100%;
  animation: dt-shimmer 1.2s ease-in-out infinite;
}

@keyframes dt-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .dt-progress,
  .dt-skeleton {
    animation: none;
  }
}
```

- [ ] **Step 4: Run everything**

Run: `pnpm typecheck && pnpm test` — expected clean, all passing (+4).

- [ ] **Step 5: Commit**

```bash
git add src/components/TableStatus.tsx src/components/DataTable.tsx src/styles.css src/LoadingStates.test.tsx
git commit -m "feat(states): skeleton on first load, progress bar on refetch, error with retry"
git push origin khojiakbar
```

---

### Task 12: shadcn token presets

**Files:**
- Create: `src/themes/shadcn.css`, `src/themes/shadcn-hsl.css`
- Modify: `package.json` (build copies themes)
- Test: `src/themes/themes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/themes/themes.test.ts
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const read = (file: string) => readFileSync(resolve(__dirname, file), "utf8")

/** Every token the base sheet defines on .dt-root. */
const baseTokens = [...read("../styles.css").matchAll(/^\s*(--dt-[a-z-]+):/gm)].map((m) => m[1] as string)

describe("shadcn presets", () => {
  for (const file of ["shadcn.css", "shadcn-hsl.css"]) {
    it(`${file} maps every base token`, () => {
      const preset = read(file)
      const missing = [...new Set(baseTokens)].filter((token) => !preset.includes(`${token}:`))
      expect(missing).toEqual([])
    })
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/themes/themes.test.ts` — expected FAIL (files missing).

- [ ] **Step 3: Write the presets**

`src/themes/shadcn.css` (complete-colour variables, Tailwind v4 / oklch era):

```css
/*
 * shadcn/ui preset — for hosts whose shadcn variables hold complete colours
 * (Tailwind v4 / oklch). Import AFTER the base stylesheet:
 *
 *   import "@hojiakbar_dev/data-table/styles.css"
 *   import "@hojiakbar_dev/data-table/themes/shadcn.css"
 *
 * Dark mode is the host's: shadcn swaps its variables on `.dark`, and these
 * rules follow under every table theme state. The selectors match or exceed
 * the base sheet's dark-mode specificity so load order is all that matters.
 */

.dt-root,
.dt-root:not([data-dt-theme="light"]):not([data-dt-theme="dark"]),
.dt-root[data-dt-theme="light"],
.dt-root[data-dt-theme="dark"] {
  --dt-bg: var(--background);
  --dt-fg: var(--foreground);
  --dt-muted-fg: var(--muted-foreground);
  --dt-border: var(--border);
  --dt-radius: var(--radius);

  --dt-header-bg: var(--muted);
  --dt-header-fg: var(--muted-foreground);
  --dt-header-height: 38px;

  --dt-row-hover: var(--accent);
  --dt-row-stripe: color-mix(in oklab, var(--muted) 50%, transparent);
  --dt-row-height: 40px;

  --dt-accent: var(--primary);
  --dt-resize-handle: var(--border);
  --dt-resize-handle-active: var(--primary);
  --dt-drop-indicator: var(--primary);
  --dt-focus-ring: var(--ring);

  --dt-pin-shadow-start: 6px 0 6px -6px color-mix(in oklab, var(--foreground) 25%, transparent);
  --dt-pin-shadow-end: -6px 0 6px -6px color-mix(in oklab, var(--foreground) 25%, transparent);

  --dt-indent: 18px;
  --dt-detail-bg: color-mix(in oklab, var(--muted) 50%, transparent);

  --dt-font: var(--font-sans, inherit);
  --dt-font-size: 14px;
}
```

`src/themes/shadcn-hsl.css` (channel-triplet variables, the pre-Tailwind-v4 format): same selectors, with every colour wrapped: `--dt-bg: hsl(var(--background));`, `--dt-fg: hsl(var(--foreground));`, `--dt-muted-fg: hsl(var(--muted-foreground));`, `--dt-border: hsl(var(--border));`, `--dt-header-bg: hsl(var(--muted));`, `--dt-header-fg: hsl(var(--muted-foreground));`, `--dt-row-hover: hsl(var(--accent));`, `--dt-row-stripe: hsl(var(--muted) / 0.5);`, `--dt-accent: hsl(var(--primary));`, `--dt-resize-handle: hsl(var(--border));`, `--dt-resize-handle-active: hsl(var(--primary));`, `--dt-drop-indicator: hsl(var(--primary));`, `--dt-focus-ring: hsl(var(--ring));`, `--dt-pin-shadow-start: 6px 0 6px -6px hsl(var(--foreground) / 0.25);`, `--dt-pin-shadow-end: -6px 0 6px -6px hsl(var(--foreground) / 0.25);`, `--dt-detail-bg: hsl(var(--muted) / 0.5);`. Non-colour tokens (`--dt-radius`, heights, indent, font, font-size) are identical to the oklch file. Write the header comment with `hsl(var(--x))` in the example.

Note: `--dt-row-height` is set on the root inline by `<DataTable>` (Task 10), which overrides the preset's value — the preset entry exists only so the token test stays honest and headless shells get a default.

- [ ] **Step 4: Copy themes into `dist` on build**

In `package.json`, change the build script to:

```json
"build": "tsc -b && vite build && mkdir -p dist/themes && cp src/themes/*.css dist/themes/",
```

- [ ] **Step 5: Run the test and the build**

Run: `pnpm vitest run src/themes/themes.test.ts && pnpm build && ls dist/themes`
Expected: PASS (2 tests); `shadcn-hsl.css shadcn.css` listed.

- [ ] **Step 6: Commit**

```bash
git add src/themes package.json
git commit -m "feat(theme): shadcn token presets (oklch and hsl)"
git push origin khojiakbar
```

---

### Task 13: Demo — server-side table and 100 000 rows

**Files:**
- Create: `src/demo/fakeServer.ts`, `src/demo/ServerDemo.tsx`
- Modify: `src/demo/Demo.tsx`, `src/demo/demo.css`

- [ ] **Step 1: A fake API**

```ts
// src/demo/fakeServer.ts
import type { TableQuery } from "../core/query"

export interface ServerReceipt {
  id: string
  code: string
  partner: string
  amount: number
  status: string
  date: string
}

const PARTNERS = ["Oʻzbekiston Temir Yoʻllari", "Gʻallaorol Agro MChJ", "ООО «Северный Путь»", "Toshkent Kimyo Zavodi"]
const STATUSES = ["open", "in_process", "received", "closed"]

/** 10 000 rows, generated once. */
const ALL: ServerReceipt[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: `rc-${index}`,
  code: `KR-${10_000 + index}`,
  partner: PARTNERS[index % PARTNERS.length] as string,
  amount: ((index * 918_233) % 210_000_000) + 310_000,
  status: STATUSES[index % STATUSES.length] as string,
  date: `2026-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
}))

export interface ServerPage {
  rows: ServerReceipt[]
  total: number
}

/** Sort, slice and reply after a delay — the way a real endpoint would. */
export function fetchReceipts(query: TableQuery, options: { fail?: boolean; delayMs?: number } = {}): Promise<ServerPage> {
  const { fail = false, delayMs = 300 } = options
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (fail) {
        reject(new Error("Simulated network failure"))
        return
      }
      const sorted = [...ALL]
      const [sort] = query.sorting
      if (sort) {
        const key = sort.id as keyof ServerReceipt
        sorted.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (sort.desc ? -1 : 1))
      }
      const { pageIndex, pageSize } = query.pagination
      resolve({ rows: sorted.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize), total: ALL.length })
    }, delayMs)
  })
}
```

- [ ] **Step 2: The server demo component**

```tsx
// src/demo/ServerDemo.tsx
import { createColumnHelper } from "@tanstack/react-table"
import { useCallback, useEffect, useState } from "react"
import { DataTable } from "../components/DataTable"
import type { TableQuery } from "../core/query"
import { localStorageLayout } from "../core/persistence"
import { useDataTable, type DataTableFeatures } from "../useDataTable"
import { fetchReceipts, type ServerPage, type ServerReceipt } from "./fakeServer"

const storage = localStorageLayout()
const columnHelper = createColumnHelper<DataTableFeatures, ServerReceipt>()
const columns = [
  columnHelper.accessor("code", { header: "Kod", size: 120 }),
  columnHelper.accessor("partner", { header: "Kontragent", size: 260 }),
  columnHelper.accessor("amount", { header: "Summa", size: 160, cell: (info) => <span className="num">{info.getValue().toLocaleString("ru-RU")}</span> }),
  columnHelper.accessor("status", { header: "Holat", size: 130 }),
  columnHelper.accessor("date", { header: "Sana", size: 120 }),
]
const EMPTY: ServerReceipt[] = []

/**
 * Server mode against a fake endpoint: every sort or page change becomes a
 * query, the "server" answers after 300 ms, and a checkbox makes the next
 * request fail so the error state can be seen.
 */
export function ServerDemo() {
  const [query, setQuery] = useState<TableQuery>()
  const [page, setPage] = useState<ServerPage>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [failNext, setFailNext] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!query) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchReceipts(query, { fail: failNext })
      .then((result) => {
        if (cancelled) return
        setPage(result)
        setFailNext(false)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // failNext is read when the request starts; a retry bumps `attempt`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  const table = useDataTable({
    id: "demo-server",
    columns,
    data: page?.rows ?? EMPTY,
    mode: "server",
    rowCount: page?.total,
    getRowId: (row) => row.id,
    onQueryChange: setQuery,
    storage,
  })

  return (
    <>
      <label className="hint">
        <input type="checkbox" checked={failNext} onChange={(event) => setFailNext(event.target.checked)} /> Keyingi so'rov
        xato bilan qaytsin
      </label>
      <DataTable instance={table} height={420} striped loading={loading} error={error} onRetry={retry} />
    </>
  )
}
```

- [ ] **Step 3: Wire into `Demo.tsx`**

Add a 100 000-row client table and the server demo. In `src/demo/Demo.tsx` add near the other data:

```ts
const hugeReceipts: Receipt[] = Array.from({ length: 100_000 }, (_, index) => ({
  ...receipts[index % receipts.length]!,
  code: `KR-${100_000 + index}`,
}))
```

Import `ServerDemo`, add a hook call in `Demo()`:

```ts
  const hugeTable = useDataTable({ id: "demo-huge", data: hugeReceipts, columns: receiptColumns, storage })
```

and two sections before the accordion section:

```tsx
      <h2>Server-side — 10 000 qator, 300 ms kechikish</h2>
      <ServerDemo />
      <p className="hint">Sort yoki sahifa o'zgarganda so'rov ketadi; javob kelguncha eski qatorlar xira turadi.</p>

      <h2>100 000 qator — client mode, virtualizatsiya</h2>
      <DataTable instance={hugeTable} height={400} striped />
      <p className="hint">DOM'da faqat ko'ringan qatorlar; scroll bar aniq.</p>
```

- [ ] **Step 4: Check in the browser**

Run the dev server (`pnpm dev --port 5199`), open http://localhost:5199 and confirm:
- the 100 000-row table scrolls smoothly, `document.querySelectorAll("tr.dt-tr").length` stays under 40, the scrollbar thumb reaches the last row `KR-199999`;
- the server table shows a skeleton first, then rows; Next dims the rows and shows the progress bar for ~300 ms; sorting by Kod returns to page 1; the failure checkbox produces the error banner and Retry recovers;
- changing rows-per-page to 100 persists after a reload.

- [ ] **Step 5: Commit**

```bash
git add src/demo
git commit -m "demo: server-side table with fake API, 100k-row virtualised table"
git push origin khojiakbar
```

---

### Task 14: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the new surface**

Add, after the "Column widths" section, two sections:

```markdown
## Large data

Rows are virtualised: only the rows in view (plus a few either side) are in
the DOM, whatever the row count. Data rows have a known height —
`rowHeight` (default 40) or `getRowHeight(row)` — so the scrollbar is exact
without measuring anything; only open detail panels are measured. Pass
`virtualize={false}` to render every row (printing, very small tables).

## Server-side data

Set `mode: "server"` and the table stops sorting and paging: `data` is one
page, already sorted, and the table tells you what it wants through a
`TableQuery` — sorting, pagination, and (reserved for later) filters and
grouping. With TanStack Query:

```tsx
const [query, setQuery] = useState<TableQuery>()
const { data, isFetching, error, refetch } = useQuery({
  queryKey: ["receipts", query],
  queryFn: () => api.receipts(query!),
  enabled: query !== undefined,
  placeholderData: keepPreviousData,
})
const table = useDataTable({
  id: "receipts", columns, mode: "server",
  data: data?.rows ?? EMPTY, rowCount: data?.total,
  getRowId: (row) => row.id, onQueryChange: setQuery,
})
<DataTable instance={table} loading={isFetching} error={error} onRetry={refetch} />
```

`onQueryChange` fires once on mount with the persisted sorting and page size,
then on every change. Sorting resets the page to the first; a new `data`
array does not. Give rows a stable `getRowId` so expansion follows records
across pages. `instance.query` holds the same object and only changes
identity when its contents change.

**Pagination** is on by default in server mode and off in client mode; pass
`pagination: { pageSize: 100, pageSizeOptions: [50, 100, 500] }` to change
either. The footer shows the total, a page-size select, the current range and
first/previous/next/last controls with a page number box. The chosen page
size is persisted with the rest of the layout.

**States.** `loading` with no rows shows skeleton rows; with rows it shows a
progress bar and dims them. `error` shows a banner with a Retry button that
calls `onRetry`; rows already on screen stay put.
```

Add to the Styling section:

```markdown
### shadcn/ui

Two presets map the tokens onto shadcn's variables. Import one after the
base stylesheet and the table follows the host's palette, radius, font and
dark mode:

```tsx
import "@hojiakbar_dev/data-table/styles.css"
import "@hojiakbar_dev/data-table/themes/shadcn.css"      // Tailwind v4 / oklch variables
// or
import "@hojiakbar_dev/data-table/themes/shadcn-hsl.css"  // hsl(var(--x)) variables
```
```

Update the API tables: hook options `mode`, `rowCount`, `pagination`, `getRowId`, `onQueryChange`, `rowHeight`, `getRowHeight`; returns `{ table, id, flags, bounds, resetLayout, isCustomised, expanded, mode, query, pagination, rowHeight, getRowHeight }`; `<DataTable>` props `loading`, `error`, `onRetry`, `footer`, `virtualize`. Add `useRowVirtualizer` and `TablePagination` to the Headless section. Add `@tanstack/react-virtual` to Requirements.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: large data, server mode, pagination, shadcn presets"
git push origin khojiakbar
```

---

### Task 15: Verification and review

- [ ] **Step 1: Full checks**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all clean; `dist/themes/` present; `dist/index.js` imports `@tanstack/react-virtual` as an external (grep the file for `from "@tanstack/react-virtual"`).

- [ ] **Step 2: Browser pass on the demo**

With the dev server up, at a 1400px viewport and again at 700px:
1. 100 000 rows: scroll to the end and back, jump via the scrollbar, expand nothing — no blank flashes; pinned `Kod` stays put; header sticks; `tr.dt-tr` count < 40.
2. Receipts (60 rows, detail panels off): behaviour unchanged from before this stage — resize, pin, reorder, sort, menu.
3. Accordion: open two panels, scroll — panels keep their measured height, no overlap; close one — rows below move up.
4. Server: page through, change page size, sort, break a request, retry; reload — page size and sorting persist, page index starts at 1.
5. shadcn: temporarily add `<html class="dark">` with shadcn's variables to `index.html`, import the preset in `main.tsx`, confirm colours follow; revert the demo change (or keep behind a toggle).

- [ ] **Step 3: Independent review**

Run a review workflow over the diff since `0aa177c` with lenses: correctness (opus), React (sonnet), CSS/layout (sonnet), tests (sonnet), docs (haiku); verify each finding with a sonnet skeptic; fix confirmed findings; re-run the suite; commit `fix:` for each group of findings.

- [ ] **Step 4: Hand-off**

Report to the author with: test count, what was verified in the browser, anything deferred. Ask whether to merge `khojiakbar` into `main`; do not merge without a yes.
