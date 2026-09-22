# Stage 2 — Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the table a quick-search box, a real filter per column reachable from the column header and from a Filters tab in the side panel, and publish those filters to a server as an explicit operator model.

**Architecture:** One filter model is the single source of truth. A `FilterCondition` is a discriminated union carrying an explicit operator, stored in the saved layout, projected onto TanStack's `columnFilters` for client-side filtering and published on `TableQuery.filters` for server-side filtering. Every surface — the header popover, the Filters tab, the toolbar search — is a view of that one model and holds no committed state of its own. Dates travel as calendar days in a half-open range so no backend can drop the last day of a range.

**Tech Stack:** React 19, TanStack Table v9.2.4 (`columnFilteringFeature`, `globalFilteringFeature`, `columnFacetingFeature`), TypeScript with `exactOptionalPropertyTypes`, Vite library build, vitest + jsdom.

**Design spec:** `docs/superpowers/specs/2026-09-16-stage2-filtering-design.md` — read §3 and §5 before Task 1. Where the spec gives a type, a SQL clause or a semantic rule, it is authoritative and this plan quotes it verbatim.

**Baseline:** 270 tests across 26 files pass at the branch tip before Task 1. Every task states the count it should leave behind.

**Branch:** all work happens on `khojiakbar` and is pushed to `origin/khojiakbar`. Nothing is merged to `main` without the author saying so.

---
# Section A — the model, the wire, and filter state (Tasks 1–6)

Covers §13 order-of-work steps 1, 2 and 3: the filter model and its constructors, `filterFn_dt`, the
`TableQuery` rename with its changelog, and the layout slices, kind resolver, pruning and page-reset
mutators. No TanStack filtering feature is composed here and no UI is built — those are later sections.

All work happens on the existing `khojiakbar` branch. Never check out, commit to, or merge into `main`.

## Modules this section creates

Later sections are written against these names; they are binding.

**`src/core/filters.ts`** (new, Tasks 1, 2, 5)
- types: `IsoDay`, `FilterValue`, `TextCondition`, `NumberCondition`, `DateCondition`,
  `BooleanCondition`, `ListCondition`, `FilterCondition`, `FilterKind`, `FilterModel`,
  `FilterValueOption`, `DayChoice`
- functions: `startOfLocalDay`, `toIsoDay`, `addDays`, `isFilterValue`, `textCondition`,
  `numberCondition`, `dateCondition`, `booleanCondition`, `listCondition`, `rebuildCondition`,
  `dayChoiceToCondition`, `pruneFilters`

**`src/core/filterFn.ts`** (new, Task 3)
- type: `ResolvedCondition`
- functions: `isBlankValue`, `resolveCondition`, `filterFn_dt`

**`src/core/filterKinds.ts`** (new, Task 5)
- types: `FilterKindSource`, `FilterColumnDefShape`
- functions: `resolveFilterKind`, `collectFilterKinds`

**`src/core/query.ts`** (modified, Task 4) — adds `TableSearch`; `TableQuery` loses `columnFilters`
and `globalFilter` and gains `filters` and `search`; `QueryInputs` gains both.

**`src/types.ts`** (modified, Task 5) — `TableLayout` gains `filters` and `search`; new
`DataTableColumnMeta`.

**`src/core/useArrangement.ts`** (modified, Task 6) — `UseArrangementOptions` gains `filterKinds`
and `persistFilters`.

**`src/useDataTable.ts`** (modified, Tasks 4, 6) — new `FilteringOptions`, new `filtering` option,
new `instance.filtering` object (`enabled`, `conditions`, `search`, `isFiltered`, `setCondition`,
`clearColumn`, `clearAll`, `setSearch`, `getModel`, `setModel`).

**`CHANGELOG.md`** (new, Task 4) — opens at 0.5.0.

Not created here, and named so nobody duplicates them: the `tableFeatures` composition and the
`columnMeta` slot (§5.1), the `layout.filters` → `columnFilters` projection, the
`onColumnFiltersChange` bridge, the search debounce and `resolvedSearchFields`, every label, and
every component.

---

### Task 1: Condition types and local-calendar day arithmetic

**Files:**
- Create: `src/core/filters.ts`
- Test: `src/core/filters.test.ts`

This is the whole vocabulary of the stage plus the three day helpers everything else parses days
with. The day helpers are the reason the task exists on its own: a bound built with
`new Date("2026-03-01")` is parsed by ES as **UTC** midnight, which east of Greenwich drops the
first hours of the range's first day and west of it the last hours of its last day. The tests
therefore run under two real timezones. Node re-reads `process.env.TZ` on every `Date` operation, so
setting it inside a test works and is restored in a single **file-scoped** `afterEach` — not one
scoped to `startOfLocalDay` alone, since `addDays`'s DST case below needs the same restore.

That restore is not `process.env.TZ = ORIGINAL_TZ` when `TZ` was unset going in: an env var is
always a string, so assigning `undefined` stores the literal text `"undefined"`, which ICU falls
back to resolving as UTC — a zone with no DST. Left uncaught, every test after the first `afterEach`
would silently run in a DST-free zone, and a millisecond-based `addDays` that is wrong exactly on a
DST boundary (`new Date(start + days * 86_400_000)`, the bug the JSDoc below exists to rule out)
would pass every case here. The restore has to `delete` the key when it started unset, and the last
`addDays` case has to force a real DST-observing zone (`Europe/London`) rather than trust whatever
the environment happens to run under.

- [ ] **Step 1: Write the failing test**

Create `src/core/filters.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest"
import { addDays, startOfLocalDay, toIsoDay } from "./filters"

const ORIGINAL_TZ = process.env.TZ

// File-scoped so every describe below shares one restore, not just
// `startOfLocalDay`'s. `process.env.TZ = undefined` does not unset the
// variable — env vars are always strings, so it stores the literal text
// `"undefined"`, which ICU then resolves to UTC instead of this machine's
// real zone. That silently flattens every later test to a DST-free
// timezone, which is exactly the kind of bug `addDays` exists to catch.
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe("startOfLocalDay", () => {
  it("parses into the local calendar east of Greenwich", () => {
    process.env.TZ = "Asia/Tashkent"
    const start = startOfLocalDay("2026-03-01")
    expect(start).toBe(new Date(2026, 2, 1).getTime())
    // `new Date("2026-03-01")` is UTC midnight, five hours later here, and a
    // bound built that way drops every row recorded in the first hours of the day.
    expect(start).toBeLessThan(Date.parse("2026-03-01"))
  })

  it("parses into the local calendar west of Greenwich", () => {
    process.env.TZ = "America/Los_Angeles"
    const start = startOfLocalDay("2026-04-01")
    expect(start).toBe(new Date(2026, 3, 1).getTime())
    // Here UTC midnight is seven hours *earlier*, so a UTC-parsed exclusive
    // upper bound drops the last hours of the previous day instead.
    expect(start).toBeGreaterThan(Date.parse("2026-04-01"))
  })

  it("rejects anything that is not a calendar day", () => {
    expect(startOfLocalDay("2026-3-1")).toBeNull()
    expect(startOfLocalDay("2026-02-30")).toBeNull()
    expect(startOfLocalDay("2026-13-01")).toBeNull()
    expect(startOfLocalDay("")).toBeNull()
    expect(startOfLocalDay("2026-03-01T00:00:00Z")).toBeNull()
  })
})

describe("toIsoDay", () => {
  it("names the local calendar day, not the UTC one", () => {
    process.env.TZ = "Asia/Tashkent"
    // 01:00 local on 2 March is 20:00Z on the 1st, which `toISOString()` would
    // name wrongly.
    expect(toIsoDay(new Date(2026, 2, 2, 1, 0))).toBe("2026-03-02")
  })

  it("returns null for an Invalid Date instead of a fake day", () => {
    // `String(NaN).padStart(4, "0")` is `"0NaN"` — a plausible-looking but
    // bogus IsoDay that would otherwise flow silently into a filter bound.
    expect(toIsoDay(new Date("nonsense"))).toBeNull()
    expect(toIsoDay(new Date(NaN))).toBeNull()
  })
})

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-03-31", 1)).toBe("2026-04-01")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
  })

  it("crosses a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31")
  })

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29")
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01")
  })

  it("returns null for a day it cannot parse", () => {
    expect(addDays("nonsense", 1)).toBeNull()
  })

  it("returns null instead of a fake day when `days` is not finite", () => {
    expect(addDays("2026-03-01", NaN)).toBeNull()
  })

  it("counts calendar days, not 24-hour blocks, across a DST change", () => {
    process.env.TZ = "Europe/London"
    // 25 October 2026 is 25 hours long in Europe/London (clocks go back at
    // 02:00). A millisecond-based implementation — `new Date(start + days *
    // 86_400_000)` — lands 25 hours later, still inside the 25th, and
    // returns the same day back; calendar arithmetic must cross into the 26th.
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26")
    // 29 March 2026 is the matching 23-hour day (clocks go forward).
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30")
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/core/filters.test.ts
```

The run fails before any test executes: `Failed to resolve import "./filters" from
"src/core/filters.test.ts". Does the file exist?`

- [ ] **Step 3: Implement**

Create `src/core/filters.ts`:

```ts
/**
 * The filter model: the conditions the table publishes and filters with.
 *
 * Every condition is built by one constructor per kind, so its key order is
 * fixed. Key order matters because `queriesEqual` and `layoutSliceEqual` both
 * compare by structure — a reordered-but-identical condition would read as a
 * change, refetch forever and write the layout on every render.
 */

/** A calendar day, `YYYY-MM-DD`. Never a `Date`. */
export type IsoDay = string

/**
 * A value a list filter can select. JSON primitives only, and deliberately not
 * `null`: blankness is an operator, not a value.
 */
export type FilterValue = string | number | boolean

/** Text conditions. All six operators are case-insensitive. */
export type TextCondition =
  | { kind: "text"; field: string; op: "contains" | "notContains" | "equals" | "notEquals" | "startsWith" | "endsWith"; value: string }
  | { kind: "text"; field: string; op: "blank" | "notBlank" }

/** Number conditions. `between` is inclusive on both ends; `null` is unbounded. */
export type NumberCondition =
  | { kind: "number"; field: string; op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte"; value: number }
  | { kind: "number"; field: string; op: "between"; from: number | null; to: number | null }
  | { kind: "number"; field: string; op: "blank" | "notBlank" }

/** Date conditions. One operator, always a half-open `[from, before)` range. */
export type DateCondition =
  | { kind: "date"; field: string; op: "range"; from: IsoDay | null; before: IsoDay | null }
  | { kind: "date"; field: string; op: "blank" | "notBlank" }

export type BooleanCondition =
  | { kind: "boolean"; field: string; op: "is"; value: boolean }
  | { kind: "boolean"; field: string; op: "blank" | "notBlank" }

export type ListCondition =
  | { kind: "list"; field: string; op: "in" | "notIn"; values: FilterValue[] }
  | { kind: "list"; field: string; op: "blank" | "notBlank" }

/** One condition on one column. `field` is the column id. */
export type FilterCondition =
  | TextCondition
  | NumberCondition
  | DateCondition
  | BooleanCondition
  | ListCondition

/** Which editor and which value shape. Also what `meta.filter` selects. */
export type FilterKind = FilterCondition["kind"]

/** The model `filtering.getModel()` returns and `filtering.setModel()` takes. */
export interface FilterModel {
  filters: FilterCondition[]
  /** Raw search text; `""` when off, matching the layout slice. */
  search: string
}

/** One choice in a values list. */
export interface FilterValueOption {
  value: FilterValue
  /** Shown instead of `value`. */
  label?: string
  /** Shown beside the label when the backend can count cheaply. */
  count?: number
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * The first instant of a calendar day, in the viewer's own calendar.
 *
 * Built from the `YYYY-MM-DD` parts rather than `new Date("2026-03-01")`,
 * which ES parses as **UTC** midnight: east of Greenwich a UTC-parsed lower
 * bound drops the first hours of its first day, west of it a UTC-parsed upper
 * bound drops the last hours of its last day, and either way the user watches
 * rows they would call "1 March" go missing.
 *
 * @param day - A calendar day, `YYYY-MM-DD`.
 * @returns The local timestamp of its first instant, or null if it is not a day.
 */
export function startOfLocalDay(day: IsoDay): number | null {
  const parts = ISO_DAY.exec(day)
  if (!parts) return null
  const year = Number(parts[1])
  const month = Number(parts[2])
  const date = Number(parts[3])
  const stamp = new Date(year, month - 1, date)
  // Years under 100 are mapped into the 1900s by the Date constructor.
  if (year < 100) stamp.setFullYear(year)
  // `new Date(2026, 1, 30)` rolls forward to 2 March rather than failing, so a
  // day that does not exist is caught by reading the parts back out.
  if (stamp.getFullYear() !== year || stamp.getMonth() !== month - 1 || stamp.getDate() !== date) {
    return null
  }
  return stamp.getTime()
}

/**
 * A `Date` as the calendar day it falls on, in the viewer's own calendar.
 *
 * Not `toISOString().slice(0, 10)`, which is the UTC day and so names the
 * wrong day for most of the world for part of every day.
 *
 * `date` is typed as "any date" but an Invalid Date (`new Date("nonsense")`,
 * or one built from a `NaN` component) is still a `Date`, and nothing else
 * catches it before this function reads its fields. Without the guard below,
 * `getFullYear()`/`getMonth()`/`getDate()` all return `NaN`, and
 * `String(NaN).padStart(4, "0")` produces `"0NaN"` — a syntactically
 * plausible but fake `IsoDay` (`"0NaN-NaN-NaN"`) that flows silently into a
 * filter bound instead of failing.
 *
 * @param date - Any date; may be an Invalid Date.
 * @returns Its local calendar day, `YYYY-MM-DD`, or null if `date` is invalid.
 */
export function toIsoDay(date: Date): IsoDay | null {
  if (Number.isNaN(date.getTime())) return null
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * Move a calendar day by whole days.
 *
 * Arithmetic on the calendar rather than on a timestamp, so a day that is 23
 * or 25 hours long is still one day.
 *
 * @param day - A calendar day, `YYYY-MM-DD`.
 * @param days - How many days to move; may be negative. A non-finite `days`
 *   (e.g. `NaN`) produces an Invalid Date, guarded below rather than left to
 *   flow into `toIsoDay`'s own guard, so the failure is explicit at the call
 *   that actually introduces it.
 * @returns The moved day, or null if `day` is not a day or `days` is not finite.
 */
export function addDays(day: IsoDay, days: number): IsoDay | null {
  const start = startOfLocalDay(day)
  if (start === null) return null
  const moved = new Date(start)
  moved.setDate(moved.getDate() + days)
  if (Number.isNaN(moved.getTime())) return null
  return toIsoDay(moved)
}

/** Whether a value can be a member of a list condition. */
export function isFilterValue(value: unknown): value is FilterValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/core/filters.test.ts
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must report **281 tests** (270 at HEAD plus 11).

Note: `isFilterValue` is exported but not yet used — that is fine for `noUnusedLocals`, which only
flags unused *locals*. Task 2 uses it.

- [ ] **Step 5: Commit**

```bash
git add src/core/filters.ts src/core/filters.test.ts
git commit -m "feat(filters): condition types and local-calendar day arithmetic"
git push origin khojiakbar
```

---

### Task 2: Condition constructors and their normalisation

**Files:**
- Modify: `src/core/filters.ts`
- Test: `src/core/filters.test.ts`

One constructor per kind, and they are the **only** way to build a condition. Three reasons, each of
which is a real bug otherwise:

- **Key order is fixed** because `queriesEqual` is `JSON.stringify` equality and `layoutSliceEqual`
  decides whether a layout write is a no-op. A condition assembled in a different key order reads as
  a change and refetches — and re-saves — forever.
- **A condition that constrains nothing returns `null`**, so the caller clears the column instead of
  storing it. `contains ""` matches every row on the client while `col ILIKE '%%'` is NULL for a null
  column and drops those rows on the server.
- **Reversed bounds are swapped.** TanStack's `filterFn_inNumberRange` and `filterFn_inDateRange`
  swap reversed endpoints inside their own `resolveFilterValue`, so a client built on them would
  quietly show the swapped range while the backend's
  `created >= '2026-04-01' AND created < '2026-03-01'` matched nothing.

`dayChoiceToCondition` is §3.2's conversion table: the editors offer Is / Before / After / Between
and this turns each into the one wire operator, whose upper bound is **exclusive**.

- [ ] **Step 1: Write the failing test**

Replace the import block at the top of `src/core/filters.test.ts` with:

```ts
import { afterEach, describe, expect, it } from "vitest"
import {
  addDays,
  booleanCondition,
  dateCondition,
  dayChoiceToCondition,
  listCondition,
  numberCondition,
  rebuildCondition,
  startOfLocalDay,
  textCondition,
  toIsoDay,
  type FilterCondition,
} from "./filters"
```

and append these three `describe` blocks to the end of the same file:

```ts
describe("condition constructors", () => {
  it("builds every kind in one fixed key order", () => {
    // Key order is significant to JSON.stringify, which is what queriesEqual
    // compares — a reordered-but-identical condition would refetch forever.
    expect(Object.keys(textCondition({ kind: "text", field: "a", op: "contains", value: "x" }) ?? {}))
      .toEqual(["kind", "field", "op", "value"])
    expect(Object.keys(numberCondition({ kind: "number", field: "a", op: "between", from: 1, to: 2 }) ?? {}))
      .toEqual(["kind", "field", "op", "from", "to"])
    expect(Object.keys(dateCondition({ kind: "date", field: "a", op: "range", from: "2026-03-01", before: null }) ?? {}))
      .toEqual(["kind", "field", "op", "from", "before"])
    expect(Object.keys(booleanCondition({ kind: "boolean", field: "a", op: "is", value: true }) ?? {}))
      .toEqual(["kind", "field", "op", "value"])
    expect(Object.keys(listCondition({ kind: "list", field: "a", op: "in", values: ["x"] }) ?? {}))
      .toEqual(["kind", "field", "op", "values"])
    expect(Object.keys(textCondition({ kind: "text", field: "a", op: "blank" }) ?? {}))
      .toEqual(["kind", "field", "op"])
  })

  it("returns null for a condition that constrains nothing", () => {
    expect(textCondition({ kind: "text", field: "a", op: "contains", value: "" })).toBeNull()
    expect(numberCondition({ kind: "number", field: "a", op: "between", from: null, to: null })).toBeNull()
    expect(dateCondition({ kind: "date", field: "a", op: "range", from: null, before: null })).toBeNull()
    expect(listCondition({ kind: "list", field: "a", op: "in", values: [] })).toBeNull()
  })

  it("returns null for a value its operator cannot carry", () => {
    const badNumber = { kind: "number", field: "a", op: "gt" } as unknown as FilterCondition
    const badBoolean = { kind: "boolean", field: "a", op: "is", value: "yes" } as unknown as FilterCondition
    expect(rebuildCondition(badNumber)).toBeNull()
    expect(rebuildCondition(badBoolean)).toBeNull()
    expect(numberCondition({ kind: "number", field: "a", op: "gt", value: Number.NaN })).toBeNull()
  })

  it("swaps reversed bounds rather than publishing them", () => {
    expect(numberCondition({ kind: "number", field: "a", op: "between", from: 20, to: 10 }))
      .toEqual({ kind: "number", field: "a", op: "between", from: 10, to: 20 })
    expect(dateCondition({ kind: "date", field: "a", op: "range", from: "2026-04-01", before: "2026-03-01" }))
      .toEqual({ kind: "date", field: "a", op: "range", from: "2026-03-01", before: "2026-04-01" })
  })

  it("drops a bound it cannot read, and keeps the other", () => {
    expect(dateCondition({ kind: "date", field: "a", op: "range", from: "nonsense", before: "2026-04-01" }))
      .toEqual({ kind: "date", field: "a", op: "range", from: null, before: "2026-04-01" })
  })

  it("sorts, de-duplicates and drops null from a list's values", () => {
    const messy = ["open", "closed", "open", null, 10, 9, true] as unknown as (string | number | boolean)[]
    expect(listCondition({ kind: "list", field: "a", op: "in", values: messy }))
      .toEqual({ kind: "list", field: "a", op: "in", values: [true, 9, 10, "closed", "open"] })
  })

  it("keeps blank and notBlank on every kind, with no value", () => {
    expect(listCondition({ kind: "list", field: "a", op: "blank" }))
      .toEqual({ kind: "list", field: "a", op: "blank" })
    expect(numberCondition({ kind: "number", field: "a", op: "notBlank" }))
      .toEqual({ kind: "number", field: "a", op: "notBlank" })
  })
})

describe("rebuildCondition", () => {
  it("restores canonical key and value order for a hand-built condition", () => {
    const handBuilt = { op: "in", values: ["open", "closed"], field: "status", kind: "list" } as FilterCondition
    const canonical = listCondition({ kind: "list", field: "status", op: "in", values: ["closed", "open"] })
    expect(JSON.stringify(rebuildCondition(handBuilt))).toBe(JSON.stringify(canonical))
  })

  it("returns null for a kind it does not know", () => {
    expect(rebuildCondition({ kind: "colour", field: "a", op: "is" } as unknown as FilterCondition)).toBeNull()
  })
})

describe("dayChoiceToCondition", () => {
  it("converts each of the four choices into a half-open range", () => {
    expect(dayChoiceToCondition("created", { mode: "is", day: "2026-03-31" }))
      .toEqual({ kind: "date", field: "created", op: "range", from: "2026-03-31", before: "2026-04-01" })
    expect(dayChoiceToCondition("created", { mode: "before", day: "2026-03-31" }))
      .toEqual({ kind: "date", field: "created", op: "range", from: null, before: "2026-03-31" })
    expect(dayChoiceToCondition("created", { mode: "after", day: "2026-03-31" }))
      .toEqual({ kind: "date", field: "created", op: "range", from: "2026-04-01", before: null })
    expect(dayChoiceToCondition("created", { mode: "between", from: "2026-03-01", to: "2026-03-31" }))
      .toEqual({ kind: "date", field: "created", op: "range", from: "2026-03-01", before: "2026-04-01" })
  })

  it("passes blankness straight through", () => {
    expect(dayChoiceToCondition("created", { mode: "blank" }))
      .toEqual({ kind: "date", field: "created", op: "blank" })
  })

  it("returns null when nothing was picked", () => {
    expect(dayChoiceToCondition("created", { mode: "between", from: null, to: null })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/core/filters.test.ts
```

The run fails at import time with `SyntaxError: The requested module './filters' does not provide an
export named 'booleanCondition'` (or another of the new names — the first one the bundler reaches).

- [ ] **Step 3: Implement**

Append to `src/core/filters.ts`, after `isFilterValue`:

```ts
/** A finite number, or null for anything else — including an unbounded end. */
function finiteOrNull(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** A well-formed calendar day, or null for anything else. */
function isoDayOrNull(day: IsoDay | null): IsoDay | null {
  return typeof day === "string" && startOfLocalDay(day) !== null ? day : null
}

/**
 * Bounds in order, lowest first.
 *
 * Reversed bounds are swapped rather than published: TanStack's own range
 * filters swap them inside `resolveFilterValue`, so a client built on them
 * would quietly show the swapped range while the backend's
 * `created >= '2026-04-01' AND created < '2026-03-01'` matched nothing.
 *
 * `YYYY-MM-DD` compares chronologically as a string, so one helper serves
 * both the number and the date range.
 */
function orderedBounds<T extends number | string>(
  from: T | null,
  to: T | null,
): readonly [T | null, T | null] {
  if (from !== null && to !== null && from > to) return [to, from]
  return [from, to]
}

/**
 * A total order over `FilterValue`.
 *
 * Two selections of the same values must produce the same array whatever order
 * the user ticked them in, or unticking and reticking would change the query
 * string. Numbers compare numerically, so 9 sorts before 10.
 */
function compareFilterValues(a: FilterValue, b: FilterValue): number {
  const rank = (value: FilterValue): number =>
    typeof value === "boolean" ? 0 : typeof value === "number" ? 1 : 2
  const byType = rank(a) - rank(b)
  if (byType !== 0) return byType
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

/**
 * Build a text condition.
 *
 * Nothing here trusts the declared type: conditions arrive from storage and
 * from `filtering.setModel`, both of which are untrusted input. That is also
 * why the operator is read off a destructured `op` and each member's own
 * property through an `in` check — narrowing a union whose discriminant is
 * itself a union of literals does not exclude the other member by exclusion
 * alone, and an absent property has to fail rather than be published.
 *
 * @param condition - The condition to normalise.
 * @returns The condition in canonical key order, or null if it constrains nothing.
 */
export function textCondition(condition: TextCondition): TextCondition | null {
  const { field, op } = condition
  if (op === "blank" || op === "notBlank") return { kind: "text", field, op }
  const value = "value" in condition ? condition.value : undefined
  // `contains ""` matches every row on the client while `col ILIKE '%%'` is
  // NULL for a null column and drops those rows on the server.
  if (typeof value !== "string" || value === "") return null
  return { kind: "text", field, op, value }
}

/**
 * Build a number condition.
 *
 * @param condition - The condition to normalise.
 * @returns The condition in canonical key order, or null if it constrains nothing.
 */
export function numberCondition(condition: NumberCondition): NumberCondition | null {
  const { field, op } = condition
  if (op === "blank" || op === "notBlank") return { kind: "number", field, op }
  if (op === "between") {
    const given = "from" in condition ? condition : { from: null, to: null }
    const [from, to] = orderedBounds(finiteOrNull(given.from), finiteOrNull(given.to))
    if (from === null && to === null) return null
    return { kind: "number", field, op: "between", from, to }
  }
  const value = "value" in condition ? condition.value : undefined
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return { kind: "number", field, op, value }
}

/**
 * Build a date condition.
 *
 * @param condition - The condition to normalise.
 * @returns The condition in canonical key order, or null if it constrains nothing.
 */
export function dateCondition(condition: DateCondition): DateCondition | null {
  const { field, op } = condition
  if (op === "blank" || op === "notBlank") return { kind: "date", field, op }
  const given = "from" in condition ? condition : { from: null, before: null }
  const [from, before] = orderedBounds(isoDayOrNull(given.from), isoDayOrNull(given.before))
  if (from === null && before === null) return null
  return { kind: "date", field, op: "range", from, before }
}

/**
 * Build a boolean condition.
 *
 * @param condition - The condition to normalise.
 * @returns The condition in canonical key order, or null if it constrains nothing.
 */
export function booleanCondition(condition: BooleanCondition): BooleanCondition | null {
  const { field, op } = condition
  if (op === "blank" || op === "notBlank") return { kind: "boolean", field, op }
  const value = "value" in condition ? condition.value : undefined
  if (typeof value !== "boolean") return null
  return { kind: "boolean", field, op: "is", value }
}

/**
 * Build a list condition.
 *
 * `null` is dropped rather than kept as a member: it matches nullish rows on
 * the client and returns nothing on the server, because `NULL = ANY(ARRAY[NULL])`
 * is NULL and never true. Ticking "(Blanks)" emits a `blank` condition instead.
 *
 * @param condition - The condition to normalise.
 * @returns The condition in canonical key order, or null if it constrains nothing.
 */
export function listCondition(condition: ListCondition): ListCondition | null {
  const { field, op } = condition
  if (op === "blank" || op === "notBlank") return { kind: "list", field, op }
  const given = "values" in condition && Array.isArray(condition.values) ? condition.values : []
  const values = Array.from(new Set(given)).filter(isFilterValue).sort(compareFilterValues)
  if (values.length === 0) return null
  return { kind: "list", field, op, values }
}

/**
 * Re-run a condition through its own constructor.
 *
 * This is what protects the identity invariant everything else rests on: a
 * condition a host assembled in a different key order, or with `values` in a
 * different order, stringifies differently from an identical one the editors
 * built, and would refetch and re-save forever.
 *
 * @param condition - Any condition, trusted or not.
 * @returns The canonical condition, or null if it is unknown or constrains nothing.
 */
export function rebuildCondition(condition: FilterCondition): FilterCondition | null {
  switch (condition.kind) {
    case "text":
      return textCondition(condition)
    case "number":
      return numberCondition(condition)
    case "date":
      return dateCondition(condition)
    case "boolean":
      return booleanCondition(condition)
    case "list":
      return listCondition(condition)
    default:
      return null
  }
}

/** What a date editor offers, before it is converted to a half-open range. */
export type DayChoice =
  | { mode: "is"; day: IsoDay }
  | { mode: "before"; day: IsoDay }
  | { mode: "after"; day: IsoDay }
  | { mode: "between"; from: IsoDay | null; to: IsoDay | null }
  | { mode: "blank" }
  | { mode: "notBlank" }

/**
 * Convert a date editor's choice into the one date operator on the wire.
 *
 * The upper bound is exclusive, always: an inclusive `<= '2026-03-31'` against
 * a timestamp column silently drops every row recorded during that last day,
 * which is the bug class this operator exists to remove. "Is 31 Mar" therefore
 * becomes `[2026-03-31, 2026-04-01)`, and "between 1 and 31 Mar"
 * `[2026-03-01, 2026-04-01)`.
 *
 * @param field - The column id.
 * @param choice - What the user picked.
 * @returns The condition, or null if it constrains nothing.
 */
export function dayChoiceToCondition(field: string, choice: DayChoice): DateCondition | null {
  switch (choice.mode) {
    case "blank":
    case "notBlank":
      return dateCondition({ kind: "date", field, op: choice.mode })
    case "is": {
      const before = addDays(choice.day, 1)
      if (before === null) return null
      return dateCondition({ kind: "date", field, op: "range", from: choice.day, before })
    }
    case "before":
      return dateCondition({ kind: "date", field, op: "range", from: null, before: choice.day })
    case "after": {
      const from = addDays(choice.day, 1)
      if (from === null) return null
      return dateCondition({ kind: "date", field, op: "range", from, before: null })
    }
    case "between": {
      const before = choice.to === null ? null : addDays(choice.to, 1)
      if (choice.to !== null && before === null) return null
      return dateCondition({ kind: "date", field, op: "range", from: choice.from, before })
    }
    default:
      return null
  }
}
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/core/filters.test.ts
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must report **293 tests** (281 plus 12).

- [ ] **Step 5: Commit**

```bash
git add src/core/filters.ts src/core/filters.test.ts
git commit -m "feat(filters): condition constructors and their normalisation"
git push origin khojiakbar
```

---

### Task 3: One filter function for every operator

**Files:**
- Create: `src/core/filterFn.ts`
- Modify: `src/index.ts`
- Test: `src/core/filterFn.test.ts`

A column's `filterFn` is fixed at definition time in TanStack v9 — there is no runtime operator
concept — so one registered function dispatches on the condition it is handed. `constructFilterFn`
takes a **definition object**, not a callback: its `filter` member receives
`(dataValue, filterValue, row, columnId)`, with the row's value *first* and the **resolved** filter
value second. Three mechanics fail silently if they are got wrong:

- `resolveFilterValue` runs **once per filter**, before any row is tested, and `filter` receives its
  result. All filter-value normalisation belongs there — lower-casing the needle, parsing day bounds,
  building the Set behind `in`.
- `resolveDataValue` is handed the raw value alone, with no condition and no column, so one
  registered function cannot use it to normalise per kind. Per-kind data normalisation stays inside
  `filter`.
- A built-in reached from inside `filter` **does not get its own `resolveFilterValue`** — the table
  only resolves the registered function's value. Its `resolveDataValue` still runs on the row value,
  so `contains "AGRO"` would match nothing unless the needle was lower-cased first. That is what
  `resolveCondition` does, once per filter.

Four families are written here rather than reused, each because the built-in disagrees with the
model:

| Not reused | Why |
|---|---|
| `filterFn_empty` / `filterFn_notEmpty` | They count a whitespace-only string and `[]` (`String([]) === ""`) as empty. `blank` is pinned to nullish or `""`, which is what `(col IS NULL OR col::text = '')` reproduces. |
| `filterFn_inDateRange` | Inclusive at both ends **and** parses bounds through `new Date(value)`, i.e. as UTC — the two bugs the half-open day range exists to remove. It cannot express `[from, before)` at all. |
| `filterFn_greaterThan` and relatives | They coerce a nullish value to `0`, so a null row matches `amount > -5`. A nullish value must fail every comparison, as it does in SQL. |
| `notContains`, `notEquals`, `notIn` | No built-in, and the naive "positive test, negated" includes exactly the blank rows SQL drops. |

What *is* reused: `filterFn_includesString` for `contains`, `filterFn_equalsString` for `equals`
(the case-insensitive spelling — **not** `filterFn_equals`, which is strict `===`),
`filterFn_startsWith`, `filterFn_endsWith`, and `filterFn_inNumberRange` for `between`, whose
inclusive `[min, max]`, null-to-±Infinity endpoints and "a non-number never matches" are already
exactly the contract.

- [ ] **Step 1: Write the failing test**

Create `src/core/filterFn.test.ts`:

```ts
import type { Row } from "@tanstack/react-table"
import { afterEach, describe, expect, it } from "vitest"
import { filterFn_dt, isBlankValue, resolveCondition } from "./filterFn"
import type { DataTableFeatures } from "../useDataTable"
import type { FilterCondition } from "./filters"

/**
 * `filterFn_dt` is a TanStack filter function: it is handed a row and reads the
 * column's value off it, as do the built-ins it delegates to. `getValue` is the
 * only member any of them touches, so a stub with that one method exercises the
 * real code path — and the cast is what saves every test here from constructing
 * a whole `Row` to reach it.
 */
interface TestRow {
  v: unknown
}
const rowWith = (value: unknown): Row<DataTableFeatures, TestRow> =>
  ({ getValue: () => value }) as unknown as Row<DataTableFeatures, TestRow>

/** Call the filter the way TanStack's own docblock prescribes for a direct call. */
const matches = (condition: FilterCondition, value: unknown): boolean =>
  filterFn_dt(rowWith(value), "v", filterFn_dt.resolveFilterValue?.(condition) ?? condition)

const ORIGINAL_TZ = process.env.TZ

describe("isBlankValue", () => {
  it("counts null, undefined and the empty string, and nothing else", () => {
    expect(isBlankValue(null)).toBe(true)
    expect(isBlankValue(undefined)).toBe(true)
    expect(isBlankValue("")).toBe(true)
    // TanStack's own filterFn_empty counts both of these as empty; the backend
    // clause `(col IS NULL OR col::text = '')` does not.
    expect(isBlankValue("   ")).toBe(false)
    expect(isBlankValue([])).toBe(false)
    expect(isBlankValue(0)).toBe(false)
    expect(isBlankValue(false)).toBe(false)
  })
})

describe("filterFn_dt — text", () => {
  it("matches all six operators case-insensitively", () => {
    const field = "v"
    expect(matches({ kind: "text", field, op: "contains", value: "AGRO" }, "Gallaorol agro")).toBe(true)
    expect(matches({ kind: "text", field, op: "equals", value: "Agro" }, "agro")).toBe(true)
    expect(matches({ kind: "text", field, op: "startsWith", value: "GAL" }, "Gallaorol")).toBe(true)
    expect(matches({ kind: "text", field, op: "endsWith", value: "ROL" }, "Gallaorol")).toBe(true)
    expect(matches({ kind: "text", field, op: "notContains", value: "agro" }, "Temir")).toBe(true)
    expect(matches({ kind: "text", field, op: "notEquals", value: "agro" }, "Temir")).toBe(true)
  })

  it("never matches a blank value, negated operators included", () => {
    const field = "v"
    for (const blank of [null, undefined, ""]) {
      expect(matches({ kind: "text", field, op: "contains", value: "a" }, blank)).toBe(false)
      expect(matches({ kind: "text", field, op: "notContains", value: "a" }, blank)).toBe(false)
      expect(matches({ kind: "text", field, op: "notEquals", value: "a" }, blank)).toBe(false)
    }
  })
})

describe("filterFn_dt — blank", () => {
  it("partitions every row between blank and notBlank", () => {
    const values = [null, undefined, "", "x", 0, false]
    for (const value of values) {
      const blank = matches({ kind: "text", field: "v", op: "blank" }, value)
      const notBlank = matches({ kind: "text", field: "v", op: "notBlank" }, value)
      expect(blank).not.toBe(notBlank)
    }
  })

  it("means the same thing for every kind", () => {
    expect(matches({ kind: "number", field: "v", op: "blank" }, null)).toBe(true)
    expect(matches({ kind: "date", field: "v", op: "blank" }, null)).toBe(true)
    expect(matches({ kind: "boolean", field: "v", op: "notBlank" }, false)).toBe(true)
    expect(matches({ kind: "list", field: "v", op: "blank" }, "")).toBe(true)
  })
})

describe("filterFn_dt — number", () => {
  it("compares with every operator", () => {
    const field = "v"
    expect(matches({ kind: "number", field, op: "eq", value: 10 }, 10)).toBe(true)
    expect(matches({ kind: "number", field, op: "ne", value: 10 }, 11)).toBe(true)
    expect(matches({ kind: "number", field, op: "lt", value: 10 }, 9)).toBe(true)
    expect(matches({ kind: "number", field, op: "lte", value: 10 }, 10)).toBe(true)
    expect(matches({ kind: "number", field, op: "gt", value: 10 }, 11)).toBe(true)
    expect(matches({ kind: "number", field, op: "gte", value: 10 }, 10)).toBe(true)
  })

  it("never matches a nullish value with any comparator", () => {
    // TanStack's filterFn_greaterThan coerces a nullish value to 0, so a null
    // row would match `amount > -5`. SQL drops it, and so does this.
    const ops = ["eq", "ne", "lt", "lte", "gt", "gte"] as const
    for (const op of ops) {
      expect(matches({ kind: "number", field: "v", op, value: -5 }, null)).toBe(false)
      expect(matches({ kind: "number", field: "v", op, value: -5 }, undefined)).toBe(false)
    }
  })

  it("treats between as inclusive at both ends, with null unbounded", () => {
    const field = "v"
    expect(matches({ kind: "number", field, op: "between", from: 10, to: 20 }, 10)).toBe(true)
    expect(matches({ kind: "number", field, op: "between", from: 10, to: 20 }, 20)).toBe(true)
    expect(matches({ kind: "number", field, op: "between", from: 10, to: 20 }, 21)).toBe(false)
    expect(matches({ kind: "number", field, op: "between", from: 10, to: null }, 1e9)).toBe(true)
    expect(matches({ kind: "number", field, op: "between", from: null, to: 20 }, -1e9)).toBe(true)
    expect(matches({ kind: "number", field, op: "between", from: 10, to: 20 }, null)).toBe(false)
  })
})

describe("filterFn_dt — date", () => {
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ
  })

  const march: FilterCondition = {
    kind: "date",
    field: "v",
    op: "range",
    from: "2026-03-01",
    before: "2026-04-01",
  }

  it("keeps the first hours of the first day east of Greenwich", () => {
    process.env.TZ = "Asia/Tashkent"
    // 1 March 02:00 local. A UTC-parsed `from` sits five hours later and drops it.
    expect(matches(march, new Date(2026, 2, 1, 2, 0))).toBe(true)
    expect(matches(march, new Date(2026, 1, 28, 23, 59))).toBe(false)
  })

  it("keeps the last hours of the last day west of Greenwich", () => {
    process.env.TZ = "America/Los_Angeles"
    // 31 March 20:00 local. A UTC-parsed `before` sits seven hours earlier and
    // drops it.
    expect(matches(march, new Date(2026, 2, 31, 20, 0))).toBe(true)
    expect(matches(march, new Date(2026, 3, 1, 0, 0))).toBe(false)
  })

  it("is inclusive at from and exclusive at before", () => {
    expect(matches(march, new Date(2026, 2, 1, 0, 0, 0))).toBe(true)
    expect(matches(march, new Date(2026, 3, 1, 0, 0, 0))).toBe(false)
  })

  it("reads a YYYY-MM-DD row value in the local calendar too", () => {
    process.env.TZ = "Asia/Tashkent"
    expect(matches(march, "2026-03-31")).toBe(true)
    expect(matches(march, "2026-04-01")).toBe(false)
  })

  it("never matches a value that is not a date", () => {
    expect(matches(march, null)).toBe(false)
    expect(matches(march, "not a date")).toBe(false)
  })
})

describe("filterFn_dt — boolean and list", () => {
  it("matches a boolean exactly, and never a blank", () => {
    expect(matches({ kind: "boolean", field: "v", op: "is", value: false }, false)).toBe(true)
    expect(matches({ kind: "boolean", field: "v", op: "is", value: false }, null)).toBe(false)
  })

  it("matches in and notIn, and excludes blanks from both", () => {
    const values = ["open", "closed"]
    expect(matches({ kind: "list", field: "v", op: "in", values }, "open")).toBe(true)
    expect(matches({ kind: "list", field: "v", op: "in", values }, "other")).toBe(false)
    expect(matches({ kind: "list", field: "v", op: "notIn", values }, "other")).toBe(true)
    expect(matches({ kind: "list", field: "v", op: "notIn", values }, "open")).toBe(false)
    // `NOT (col = ANY(…))` is NULL for a null column, so the backend drops it.
    expect(matches({ kind: "list", field: "v", op: "notIn", values }, null)).toBe(false)
  })
})

describe("resolveCondition", () => {
  it("lower-cases the needle once per filter, not once per row", () => {
    expect(resolveCondition({ kind: "text", field: "v", op: "contains", value: "AGRO" })).toEqual({
      kind: "text",
      op: "contains",
      needle: "agro",
    })
  })

  it("collapses blank and notBlank across every kind", () => {
    expect(resolveCondition({ kind: "list", field: "v", op: "notBlank" })).toEqual({
      kind: "blank",
      negated: true,
    })
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/core/filterFn.test.ts
```

The run fails before any test executes: `Failed to resolve import "./filterFn" from
"src/core/filterFn.test.ts". Does the file exist?`

- [ ] **Step 3: Implement**

Create `src/core/filterFn.ts`:

```ts
import {
  constructFilterFn,
  filterFn_endsWith,
  filterFn_equalsString,
  filterFn_includesString,
  filterFn_inNumberRange,
  filterFn_startsWith,
  type Row,
  type RowData,
  type TableFeatures,
} from "@tanstack/react-table"
import {
  isFilterValue,
  startOfLocalDay,
  type FilterCondition,
  type FilterValue,
} from "./filters"

/**
 * One registered filter function for every operator.
 *
 * A column's `filterFn` is fixed at definition time in v9 — there is no runtime
 * operator concept — so a single function dispatches on the condition it is
 * handed. The condition object itself is the TanStack `ColumnFilter.value`,
 * which keeps one source of truth: the object the client filters with is the
 * object published to the server.
 */

/**
 * Blankness, as the backend clause defines it.
 *
 * `(col IS NULL OR col::text = '')`, and nothing else — not TanStack's
 * `filterFn_empty`, which also counts a whitespace-only string and `[]`
 * (because `String([]) === ""`) as empty, and so would disagree with the
 * backend about which rows `blank` and `notBlank` partition.
 *
 * @param value - A row's value for the filtered column.
 * @returns Whether the value is blank.
 */
export function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || value === ""
}

/**
 * A condition with its per-filter work already done.
 *
 * The needle is lower-cased, day bounds are parsed into local-calendar
 * timestamps, and `values` is a Set. Internal to the filter function — a
 * resolved condition never reaches the wire, so the JSON-only rule that binds
 * `FilterCondition` does not bind this.
 */
export type ResolvedCondition =
  | { kind: "text"; op: "contains" | "notContains" | "equals" | "notEquals" | "startsWith" | "endsWith"; needle: string }
  | { kind: "number"; op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte"; value: number }
  | { kind: "numberRange"; min: number; max: number }
  | { kind: "date"; from: number | null; before: number | null }
  | { kind: "boolean"; value: boolean }
  | { kind: "list"; negated: boolean; values: ReadonlySet<FilterValue> }
  | { kind: "blank"; negated: boolean }
  | { kind: "always" }

/** `blank` and `notBlank` collapse to one resolved branch across every kind. */
function blankResolved(op: "blank" | "notBlank"): ResolvedCondition {
  return { kind: "blank", negated: op === "notBlank" }
}

/**
 * Hoist a condition's per-filter work out of the per-row loop.
 *
 * The table runs this once per filter, before any row is tested, and hands
 * `filter` the result — not the raw condition.
 *
 * @param condition - The condition stored for a column.
 * @returns The condition with its needle, bounds and value set prepared.
 */
export function resolveCondition(condition: FilterCondition): ResolvedCondition {
  switch (condition.kind) {
    case "text":
      if (!("value" in condition)) return blankResolved(condition.op)
      return { kind: "text", op: condition.op, needle: String(condition.value).toLowerCase() }
    case "number":
      if ("value" in condition) return { kind: "number", op: condition.op, value: condition.value }
      if (!("from" in condition)) return blankResolved(condition.op)
      return {
        kind: "numberRange",
        min: condition.from ?? Number.NEGATIVE_INFINITY,
        max: condition.to ?? Number.POSITIVE_INFINITY,
      }
    case "date":
      if (!("from" in condition)) return blankResolved(condition.op)
      return {
        kind: "date",
        from: condition.from === null ? null : startOfLocalDay(condition.from),
        before: condition.before === null ? null : startOfLocalDay(condition.before),
      }
    case "boolean":
      if (!("value" in condition)) return blankResolved(condition.op)
      return { kind: "boolean", value: condition.value }
    case "list":
      if (!("values" in condition)) return blankResolved(condition.op)
      return { kind: "list", negated: condition.op === "notIn", values: new Set(condition.values) }
    default:
      // Unreachable through the constructors, which are the only way to build a
      // condition. Failing open is the safe direction: a condition nobody can
      // read constrains nothing, rather than blanking the table.
      return { kind: "always" }
  }
}

/**
 * A row value as a timestamp.
 *
 * A bare `YYYY-MM-DD` row value is a calendar day and is read in the local
 * calendar, exactly like the bounds: `Date.parse` would read it as UTC
 * midnight and shift it a whole day either side of Greenwich.
 */
function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const stamp = value.getTime()
    return Number.isNaN(stamp) ? null : stamp
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const day = startOfLocalDay(value)
  if (day !== null) return day
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Test one row's value against a resolved condition.
 *
 * The row and column id are carried through so the TanStack primitives this
 * builds on can be called the way their docblock requires. They apply their own
 * `resolveDataValue` to the value they read off the row, which is why the
 * needle handed to them has to be normalised the way they expect — lower-cased,
 * which `resolveCondition` does once per filter rather than once per row.
 */
function matchesResolved<TFeatures extends TableFeatures, TData extends RowData>(
  dataValue: unknown,
  resolved: ResolvedCondition,
  row: Row<TFeatures, TData>,
  columnId: string,
): boolean {
  switch (resolved.kind) {
    case "always":
      return true
    case "blank":
      return isBlankValue(dataValue) !== resolved.negated
    case "text": {
      // A blank value matches no text operator, negated ones included: SQL
      // drops a NULL from `col ILIKE …` and from `NOT (col ILIKE …)` alike,
      // and "the positive test, negated" would include exactly the rows the
      // backend drops.
      if (isBlankValue(dataValue)) return false
      switch (resolved.op) {
        case "contains":
          return filterFn_includesString(row, columnId, resolved.needle)
        case "notContains":
          return !filterFn_includesString(row, columnId, resolved.needle)
        case "equals":
          return filterFn_equalsString(row, columnId, resolved.needle)
        case "notEquals":
          return !filterFn_equalsString(row, columnId, resolved.needle)
        case "startsWith":
          return filterFn_startsWith(row, columnId, resolved.needle)
        case "endsWith":
          return filterFn_endsWith(row, columnId, resolved.needle)
        default:
          return false
      }
    }
    case "number": {
      // A nullish value fails every comparison, as it does in SQL. TanStack's
      // own `filterFn_greaterThan` coerces it to 0, so a null row would match
      // `amount > -5`.
      if (typeof dataValue !== "number" || Number.isNaN(dataValue)) return false
      switch (resolved.op) {
        case "eq":
          return dataValue === resolved.value
        case "ne":
          return dataValue !== resolved.value
        case "lt":
          return dataValue < resolved.value
        case "lte":
          return dataValue <= resolved.value
        case "gt":
          return dataValue > resolved.value
        case "gte":
          return dataValue >= resolved.value
        default:
          return false
      }
    }
    case "numberRange":
      return filterFn_inNumberRange(row, columnId, [resolved.min, resolved.max])
    case "date": {
      const stamp = toTimestamp(dataValue)
      if (stamp === null) return false
      if (resolved.from !== null && stamp < resolved.from) return false
      if (resolved.before !== null && stamp >= resolved.before) return false
      return true
    }
    case "boolean":
      return dataValue === resolved.value
    case "list": {
      if (isBlankValue(dataValue)) return false
      const present = isFilterValue(dataValue) && resolved.values.has(dataValue)
      return present !== resolved.negated
    }
    default:
      return true
  }
}

/**
 * The library's one filter function, registered as `dt`.
 *
 * Built from a definition object rather than a callback: `filter` is a
 * value-level comparator that receives the row's value first and the
 * **resolved** filter value second.
 *
 * @example
 * // Calling it outside a table, as TanStack's own docblock prescribes:
 * filterFn_dt(row, "amount", filterFn_dt.resolveFilterValue?.(condition) ?? condition)
 */
export const filterFn_dt = constructFilterFn({
  resolveFilterValue: (condition: FilterCondition): ResolvedCondition => resolveCondition(condition),
  filter: (dataValue: unknown, resolved: ResolvedCondition, row, columnId) =>
    matchesResolved(dataValue, resolved, row, columnId),
})
```

Then add the module to the barrel so it is reachable and not stripped as dead code. In
`src/index.ts`, immediately above the existing `/* Helpers worth borrowing rather than rewriting. */`
comment, insert:

```ts
export { filterFn_dt, isBlankValue, resolveCondition } from "./core/filterFn"
export type { ResolvedCondition } from "./core/filterFn"
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/core/filterFn.test.ts
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must report **310 tests** (293 plus 17).

- [ ] **Step 5: Commit**

```bash
git add src/core/filterFn.ts src/core/filterFn.test.ts src/index.ts
git commit -m "feat(filters): one filter function for every operator"
git push origin khojiakbar
```

---

### Task 4: Rename the wire fields and publish sorted arrays

**Files:**
- Modify: `src/core/query.ts`
- Modify: `src/core/useTableQuery.ts`
- Modify: `src/useDataTable.ts`
- Modify: `src/index.ts`
- Modify: `README.md`
- Modify: `package.json`
- Create: `CHANGELOG.md`
- Test: `src/core/query.test.ts`, `src/core/useTableQuery.test.ts`, `src/ServerMode.test.tsx`

`columnFilters` and `globalFilter` are **removed**, not repurposed. They have only ever been `[]` and
`""`, so no host can have read anything meaningful out of them, and a rename makes `tsc` fail loudly
where a silent type change under the same name would not. `query.ts`'s current JSDoc promises this
shape will not change when filters land; that promise is being broken deliberately and the JSDoc has
to be corrected rather than left lying.

`buildQuery` sorts. Array order is as significant to `JSON.stringify` as key order and it is the
reachable half: column order is a layout slice the user drags, and pinning reorders rendered columns
too, so filters emitted in column position order would change the query string, change
`instance.query`'s identity, and make a host refetch an identical result set — with the page reset,
since every filter path resets it.

`search` stays `null` in `useDataTable` for now. The slice does not exist yet (Task 6) and what
reaches the wire is debounced and needs the resolved search fields, which is the quick-search step in
a later section.

- [ ] **Step 1: Write the failing test**

Replace `src/core/query.test.ts` entirely:

```ts
import { describe, expect, it } from "vitest"
import { listCondition, textCondition, type FilterCondition } from "./filters"
import { buildQuery, queriesEqual } from "./query"

const amount: FilterCondition = { kind: "number", field: "amount", op: "gte", value: 1000 }
const partner = textCondition({ kind: "text", field: "partner", op: "contains", value: "agro" })!
const status = listCondition({ kind: "list", field: "status", op: "in", values: ["open", "in_process"] })!

describe("buildQuery", () => {
  it("carries sorting, filters, search and pagination", () => {
    const query = buildQuery({
      sorting: [{ id: "date", desc: true }],
      filters: [partner],
      search: { text: "KR-102", fields: ["code"] },
      pageIndex: 2,
      pageSize: 50,
    })

    expect(query).toEqual({
      sorting: [{ id: "date", desc: true }],
      filters: [partner],
      search: { text: "KR-102", fields: ["code"] },
      grouping: [],
      pagination: { pageIndex: 2, pageSize: 50 },
    })
  })

  it("sorts filters by field, whatever order they were set in", () => {
    // Column order is a layout slice the user drags. Emitting filters in column
    // position order would change the query string — and refetch an identical
    // result set, with the page reset — every time a column moved.
    const query = buildQuery({
      sorting: [],
      filters: [status, partner, amount],
      search: null,
      pageIndex: 0,
      pageSize: 50,
    })
    expect(query.filters.map((condition) => condition.field)).toEqual(["amount", "partner", "status"])
  })

  it("sorts search fields by id, and carries a null search as null", () => {
    const query = buildQuery({
      sorting: [],
      filters: [],
      search: { text: "kr", fields: ["status", "code", "partner"] },
      pageIndex: 0,
      pageSize: 50,
    })
    expect(query.search).toEqual({ text: "kr", fields: ["code", "partner", "status"] })
    expect(buildQuery({ sorting: [], filters: [], search: null, pageIndex: 0, pageSize: 50 }).search).toBeNull()
  })
})

describe("queriesEqual", () => {
  const base = buildQuery({
    sorting: [{ id: "date", desc: false }],
    filters: [],
    search: null,
    pageIndex: 0,
    pageSize: 50,
  })

  it("is true for structurally equal queries", () => {
    const same = buildQuery({
      sorting: [{ id: "date", desc: false }],
      filters: [],
      search: null,
      pageIndex: 0,
      pageSize: 50,
    })
    expect(queriesEqual(base, same)).toBe(true)
  })

  it("is false when any field differs", () => {
    expect(queriesEqual(base, { ...base, pagination: { pageIndex: 1, pageSize: 50 } })).toBe(false)
    expect(queriesEqual(base, { ...base, sorting: [{ id: "date", desc: true }] })).toBe(false)
    expect(queriesEqual(base, { ...base, search: { text: "x", fields: [] } })).toBe(false)
    expect(queriesEqual(base, { ...base, filters: [partner] })).toBe(false)
  })

  it("is true for a reordered-but-identical filters array", () => {
    const inputs = { sorting: [], search: null, pageIndex: 0, pageSize: 50 }
    const oneWay = buildQuery({ ...inputs, filters: [amount, partner, status] })
    const other = buildQuery({ ...inputs, filters: [status, amount, partner] })
    expect(queriesEqual(oneWay, other)).toBe(true)
  })

  it("is true for a reordered-but-identical values list and search fields", () => {
    const reticked = listCondition({ kind: "list", field: "status", op: "in", values: ["in_process", "open"] })!
    const inputs = { sorting: [], pageIndex: 0, pageSize: 50 }
    const oneWay = buildQuery({ ...inputs, filters: [status], search: { text: "a", fields: ["b", "a"] } })
    const other = buildQuery({ ...inputs, filters: [reticked], search: { text: "a", fields: ["a", "b"] } })
    expect(queriesEqual(oneWay, other)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/core/query.test.ts
```

Every test fails. The first one reports that the received object has `columnFilters: []` and
`globalFilter: ""` where the expectation has `filters` and `search`; the sorting tests fail because
`buildQuery` ignores the new inputs entirely and `query.filters` is `undefined`.

- [ ] **Step 3: Implement**

Replace `src/core/query.ts` entirely:

```ts
import type { GroupingState, SortingState } from "@tanstack/react-table"
import type { FilterCondition } from "./filters"

/**
 * What quick search asks for.
 *
 * Its own field rather than a synthetic condition, because it crosses columns
 * and a condition does not. The semantics are the contract, and are identical
 * client-side and server-side: split `text` on whitespace; every token must
 * appear, case-insensitively, in at least one of `fields` on that row; tokens
 * may match different columns.
 */
export interface TableSearch {
  /** The user's text, trimmed. Never empty — the field is `null` instead. */
  text: string
  /** Column ids the search covers, sorted by id. */
  fields: string[]
}

/**
 * Everything a server needs to produce one page of rows.
 *
 * Built by {@link useDataTable} from the current layout and page state and
 * handed to `onQueryChange`. Everything in it is JSON: dates are `YYYY-MM-DD`
 * strings, lists are arrays of JSON primitives, and an absent bound is `null`
 * rather than `undefined`, because {@link queriesEqual} compares by
 * `JSON.stringify` and a `Set`, a `Date` or an `undefined` would make two
 * different queries compare equal.
 *
 * `filters` is a flat array, implicitly ANDed. Cross-column OR, when it
 * arrives, will be a **new optional field** rather than a change to the element
 * type, so a backend written against this shape keeps working.
 */
export interface TableQuery {
  sorting: SortingState
  filters: FilterCondition[]
  search: TableSearch | null
  grouping: GroupingState
  pagination: { pageIndex: number; pageSize: number }
}

export interface QueryInputs {
  sorting: SortingState
  filters: readonly FilterCondition[]
  search: TableSearch | null
  pageIndex: number
  pageSize: number
}

/** Deterministic, locale-independent id order. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Assemble a query from the table's state.
 *
 * `filters` is sorted by `field` and `search.fields` by id, so each array is a
 * function of the filter set alone. Array order is as significant to
 * `JSON.stringify` as key order, and it is the reachable half: column order is
 * a layout slice the user drags, so filters emitted in column position order
 * would change the query string — and make a host refetch an identical result
 * set, with the page reset — every time a column moved.
 *
 * @param inputs - The state slices that feed the query.
 * @returns A new query object.
 */
export function buildQuery({ sorting, filters, search, pageIndex, pageSize }: QueryInputs): TableQuery {
  return {
    sorting,
    filters: [...filters].sort((a, b) => compareIds(a.field, b.field)),
    search: search === null ? null : { text: search.text, fields: [...search.fields].sort(compareIds) },
    grouping: [],
    pagination: { pageIndex, pageSize },
  }
}

/**
 * Structural equality for queries.
 *
 * Queries are JSON-shaped, so a stringify comparison is exact and cheap at
 * this size. {@link useTableQuery} calls this every render to decide whether
 * to keep its previous query object or replace it — which is what actually
 * keeps `instance.query` referentially stable between renders that changed
 * nothing, and, unlike a `useMemo` cache, does not depend on React choosing
 * not to discard one.
 *
 * It is exact only because everything in a query is JSON and every array in it
 * is in a fixed order: `buildQuery` sorts `filters` and `search.fields`, and
 * the condition constructors fix each condition's key order and sort `values`.
 */
export function queriesEqual(a: TableQuery, b: TableQuery): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
```

In `src/core/useTableQuery.ts`, change the import block at the top from

```ts
import type { SortingState } from "@tanstack/react-table"
import { useEffect, useRef } from "react"
import { buildQuery, queriesEqual, type TableQuery } from "./query"
```

to

```ts
import type { SortingState } from "@tanstack/react-table"
import { useEffect, useRef } from "react"
import type { FilterCondition } from "./filters"
import { buildQuery, queriesEqual, type TableQuery, type TableSearch } from "./query"
```

then in `UseTableQueryOptions`, insert the two new members between `sorting` and `pageIndex`:

```ts
  sorting: SortingState
  /**
   * The active conditions, identity-stable for the same reason as `sorting`.
   * `buildQuery` sorts them, so the order they arrive in does not matter.
   */
  filters: readonly FilterCondition[]
  /** What quick search asks for, or null when it is off. */
  search: TableSearch | null
  pageIndex: number
```

update the `@example` line in the hook's JSDoc from

```ts
 * const query = useTableQuery({ sorting, pageIndex, pageSize, onQueryChange })
```

to

```ts
 * const query = useTableQuery({ sorting, filters, search, pageIndex, pageSize, onQueryChange })
```

and change the signature and first statement from

```ts
export function useTableQuery({
  sorting,
  pageIndex,
  pageSize,
  onQueryChange,
}: UseTableQueryOptions): TableQuery {
  const candidate = buildQuery({ sorting, pageIndex, pageSize })
```

to

```ts
export function useTableQuery({
  sorting,
  filters,
  search,
  pageIndex,
  pageSize,
  onQueryChange,
}: UseTableQueryOptions): TableQuery {
  const candidate = buildQuery({ sorting, filters, search, pageIndex, pageSize })
```

In `src/useDataTable.ts`, change the query import from

```ts
import type { TableQuery } from "./core/query"
```

to

```ts
import type { FilterCondition } from "./core/filters"
import type { TableQuery, TableSearch } from "./core/query"
```

add these two module constants immediately after `export type TableMode = "client" | "server"`:

```ts
/**
 * Filter state does not exist yet.
 *
 * Module constants rather than fresh literals per render, because
 * `useTableQuery`'s inputs must be identity-stable or every render produces a
 * new query and a host keyed on it refetches forever. Replaced by the layout
 * slices when they land; quick search waits longer still, because what reaches
 * the wire is debounced and needs the resolved search fields.
 */
const NO_FILTERS: readonly FilterCondition[] = []
const NO_SEARCH: TableSearch | null = null
```

and change the `useTableQuery` call from

```ts
  const query = useTableQuery({
    sorting: layout.sorting,
    pageIndex: pageState.pageIndex,
```

to

```ts
  const query = useTableQuery({
    sorting: layout.sorting,
    filters: NO_FILTERS,
    search: NO_SEARCH,
    pageIndex: pageState.pageIndex,
```

In `src/core/useTableQuery.test.ts`, add `filters: []` and `search: null` to all six option objects.
Four are multi-line and take the two lines after `sorting`; the other two are the inline
`rerender({ sorting: [], … })` calls, which become
`rerender({ sorting: [], filters: [], search: null, pageIndex: 0, pageSize: 50, onQueryChange })` and
`rerender({ sorting: [], filters: [], search: null, pageIndex: 1, pageSize: 50, onQueryChange })`.

In `src/ServerMode.test.tsx`, change

```tsx
      sorting: [{ id: "name", desc: true }], columnFilters: [], globalFilter: "", grouping: [],
```

to

```tsx
      sorting: [{ id: "name", desc: true }], filters: [], search: null, grouping: [],
```

In `src/index.ts`, change

```ts
export type { TableQuery } from "./core/query"
```

to

```ts
export type { TableQuery, TableSearch } from "./core/query"
```

and, immediately above the `export { filterFn_dt, … }` lines added in Task 3, insert the filter model
exports:

```ts
/*
 * The filter model. Conditions are built by these constructors and never by
 * hand: they fix each condition's key order and sort its values, which is what
 * keeps `instance.query` from changing identity for a filter that did not.
 */
export {
  addDays,
  booleanCondition,
  dateCondition,
  dayChoiceToCondition,
  isFilterValue,
  listCondition,
  numberCondition,
  rebuildCondition,
  startOfLocalDay,
  textCondition,
  toIsoDay,
} from "./core/filters"
export type {
  BooleanCondition,
  DateCondition,
  DayChoice,
  FilterCondition,
  FilterKind,
  FilterModel,
  FilterValue,
  FilterValueOption,
  IsoDay,
  ListCondition,
  NumberCondition,
  TextCondition,
} from "./core/filters"
```

Create `CHANGELOG.md`:

```markdown
# Changelog

Notable changes to `@hojiakbar_dev/data-table`. This file starts at 0.5.0; earlier
releases are summarised in one line rather than reconstructed.

## 0.5.0

### Breaking

- **`TableQuery.columnFilters` and `TableQuery.globalFilter` are removed**, and
  replaced by `filters: FilterCondition[]` and `search: TableSearch | null`.
  Both removed fields had only ever been `[]` and `""`, so no host can have read
  anything meaningful out of them — but the rename is a compile error rather
  than a silent behaviour change, which is why it was done as a rename. Update
  any backend adapter that destructures the query.
- `TableQuery.filters` is **sorted by `field`**, and `TableQuery.search.fields`
  by id. A backend must not assume either array is in column order.

### Added

- The filter model: `FilterCondition` and its five kinds (`text`, `number`,
  `date`, `boolean`, `list`), each with an explicit operator, plus the
  constructors that build them — `textCondition`, `numberCondition`,
  `dateCondition`, `booleanCondition`, `listCondition` — and `rebuildCondition`
  for re-running an untrusted one through its constructor.
- `dayChoiceToCondition`, `startOfLocalDay`, `toIsoDay` and `addDays`: a date
  filter is always published as a half-open `[from, before)` range of calendar
  days, and every day is parsed in the viewer's own calendar.
- `filterFn_dt`, the single registered filter function that dispatches on a
  condition, with `resolveCondition` and `isBlankValue` beside it.

## 0.4.0 and earlier

Nested column groups, expandable rows and tree data, column pinning, resizing,
reordering, sorting, per-table persisted layout, row virtualisation, the
server-side data model and pagination.
```

In `package.json`, bump the version and ship the changelog:

```json
  "version": "0.5.0",
```

```json
  "files": [
    "CHANGELOG.md",
    "dist"
  ],
```

In `README.md`, replace

```markdown
`TableQuery` — sorting, pagination, and (reserved for later) filters and
grouping. With TanStack Query:
```

with

```markdown
`TableQuery` — sorting, filters, quick search, pagination, and (reserved for
row grouping) `grouping`. With TanStack Query:
```

and insert this subsection at the end of the **Server-side data** section, immediately before the
`---` that precedes `## Expandable rows`:

````markdown
### Filters on the wire

A filter is not a client-side trick that happens to work remotely: it is a value
you hand to your backend and translate into SQL without interpreting anything.

```json
{
  "sorting": [{ "id": "created", "desc": true }],
  "filters": [
    { "kind": "number", "field": "amount",  "op": "between",  "from": 1000000, "to": null },
    { "kind": "date",   "field": "created", "op": "range",    "from": "2026-03-01", "before": "2026-04-01" },
    { "kind": "text",   "field": "partner", "op": "contains", "value": "agro" },
    { "kind": "list",   "field": "status",  "op": "in",       "values": ["in_process", "open"] }
  ],
  "search": { "text": "KR-102", "fields": ["code", "partner", "status"] },
  "grouping": [],
  "pagination": { "pageIndex": 0, "pageSize": 50 }
}
```

`filters` is a flat array, implicitly ANDed, and **sorted by `field`** — which is
why `amount` comes first here rather than the order the user set the filters in.
Sorting it is what stops a column drag changing the query string and making you
refetch an identical result set. When cross-column OR eventually ships it will
arrive as a **new optional field**, never as a change to the element type, so a
backend written against this shape keeps working.

| Operator | On | Means |
|---|---|---|
| `contains` / `notContains` | text | Substring, **case-insensitive** |
| `equals` / `notEquals` | text | Whole value, **case-insensitive** |
| `startsWith` / `endsWith` | text | **Case-insensitive** |
| `eq` `ne` `lt` `lte` `gt` `gte` | number | |
| `between` | number | **Inclusive on both ends**; `null` is unbounded |
| `range` | date | `from <= value < before`; either bound may be `null` |
| `is` | boolean | |
| `in` / `notIn` | list | |
| `blank` / `notBlank` | every kind | Nullish or empty, and its complement |

A published operator's meaning never changes; new behaviour gets a new name. Four
rules are easy to get wrong, and the table itself follows all four.

**All six text operators are case-insensitive**, `equals` included. A backend
using a case-sensitive collation will return different row counts from client
mode for the same filter, and your users will report that as a data bug.

**`between` is inclusive on both ends.** AG Grid's number `inRange` is exclusive
by default, so a backend ported from it will disagree.

**Negated operators never match a blank value.** `notContains`, `notEquals` and
`notIn` exclude a row whose value is `NULL` or `''`, because that is what
`NOT (col ILIKE …)` does in SQL, where a comparison against NULL is NULL rather
than true. The number comparators do the same: a nullish value satisfies none of
them. `blank` is the operator for reaching those rows, and `blank` / `notBlank`
partition every row between them:

```sql
-- blank
(col IS NULL OR col::text = '')
-- notBlank
(col IS NOT NULL AND col::text <> '')
```

The `IS NOT NULL` guard is not optional — the naive `col <> ''` silently excludes
every NULL through three-valued logic, and then the two operators no longer
partition the table. For a non-text column the `''` half is always false and may
be dropped.

**A date range is half-open**, always: `from` is inclusive, `before` is exclusive.
One clause covers every case, and it is correct whether the column is a `date` or
a `timestamptz`:

```sql
(:from   IS NULL OR created >= :from)
AND (:before IS NULL OR created <  :before)
```

The bug this prevents: an inclusive `<= '2026-03-31'` against a timestamp column
silently drops every row recorded during that last day. The table never emits a
time or a zone — a day is a day in the user's calendar. If you store instants,
converting the day boundary into your own zone is your decision to make and to
document.

**Quick search is AND over tokens, OR over fields.** Split `text` on whitespace;
every token must appear, case-insensitively, in at least one of `fields` on that
row; different tokens may match different columns. The naive `contains: text`
across the fields disagrees with client mode the moment a user types two words.

```ts
const { text, fields } = query.search!
where: {
  AND: [
    { amount:  { gte: 1000000 } },
    { created: { gte: new Date("2026-03-01"), lt: new Date("2026-04-01") } },
    { partner: { contains: "agro", mode: "insensitive" } },
    { status:  { in: ["in_process", "open"] } },
    // Every token must hit some field; different tokens may hit different fields.
    ...text.split(/\s+/).map((token) => ({
      OR: fields.map((f) => ({ [f]: { contains: token, mode: "insensitive" } })),
    })),
  ],
}
```

Every text operator carries `mode: "insensitive"`, `equals` included. The
`new Date("…")` calls are the backend choosing to read a calendar day as UTC
midnight, which is its prerogative and its decision to document.

`fields` is a list of columns your backend should be prepared to search. Quick
search over unindexed text columns is a good way to take down a database with
three characters; mark sensitive or unindexed columns as unsearchable so they
never reach `fields`.

**The operator vocabulary is closed.** The operators in the table above are the
whole list, and a condition carrying anything else is dropped rather than
published — a backend cannot be expected to translate an operator it has never
seen, and minting one locally would produce a filter that works in client mode
and silently does nothing in server mode. A host that needs different *matching*
keeps the vocabulary and changes the client half of it: `columnDef.filterFn`
accepts a function as well as a name, such a function needs no registration, and
it receives the column's own `FilterCondition` as its filter value — so it can
change how `contains` matches without inventing a `matchesRegex`. A host that
needs something the vocabulary cannot express at all turns the built-in filter
off for that column with `meta: { filter: false }` and keeps its own control
beside the table; what reaches `query.filters` is always one of the conditions
documented here.

**`meta.filter` picks the editor; it does not type the value.** A condition's
value is not checked against the column's own `TValue`, because `columns` is
`ColumnDef<…, any>[]` and there is no per-column value type left to check it
against. `meta: { filter: "number" }` on a text column compiles, and the
mismatch turns up at runtime as a filter that matches nothing. Declare the kind
that matches the data; a column that declares nothing has its kind inferred from
its first non-null value — string → text, number → number, boolean → boolean,
anything else → text — which is a convenience and not a contract, and is why a
stored condition is dropped on load when the kind it was built for is no longer
the kind the column resolves to.

**Build conditions with the exported constructors** — `textCondition`,
`numberCondition`, `dateCondition`, `booleanCondition`, `listCondition` — and
never by hand. They fix each condition's key order, sort a list's values and
return `null` for a condition that constrains nothing, and `instance.query`'s
identity depends on all three.
````

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/core/query.test.ts src/core/useTableQuery.test.ts src/ServerMode.test.tsx
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must report **314 tests** (310 plus 4 — `query.test.ts` grows from 3 tests to 7).

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md README.md package.json src/core/query.ts src/core/query.test.ts src/core/useTableQuery.ts src/core/useTableQuery.test.ts src/ServerMode.test.tsx src/useDataTable.ts src/index.ts
git commit -m "feat(query)!: rename the filter fields and publish sorted arrays

TableQuery.columnFilters and TableQuery.globalFilter are removed and replaced
by filters and search. Both were always empty, so the rename costs a host
nothing but a compile error — which is the point: a silent type change under
the same name would not have been noticed.

buildQuery sorts filters by field and search.fields by id, so a column drag
cannot change the query string and provoke an identical refetch.

BREAKING CHANGE: TableQuery.columnFilters and TableQuery.globalFilter are
removed; use TableQuery.filters and TableQuery.search."
git push origin khojiakbar
```

---

### Task 5: Layout slices, the per-column kind resolver, and pruning

> **Shipped, with one correction.** The id derivation written inline below was wrong for a nested
> `accessorKey` and for a header-derived id: TanStack's `constructColumn` computes
> `columnDef.id ?? accessorKey.replaceAll(".", "_") ?? (typeof header === "string" ? header : undefined)`,
> so `"partner.name"` has the live id `"partner_name"` and a lookup by the dotted key silently missed.
> It was extracted to `deriveColumnId` in `src/core/columnIds.ts` (commit `755e157`) and both
> `collectFilterKinds` and `collectLeafIds` now call it. The id derivation in the snippets below has
> been corrected to match; the shipped `src/core/filterKinds.ts` is authoritative for the rest.
> **Anything later in this plan that needs a column id calls `deriveColumnId` — never another inline
> copy.**

**Files:**
- Create: `src/core/filterKinds.ts`
- Modify: `src/types.ts`
- Modify: `src/core/useArrangement.ts`
- Modify: `src/core/persistence.ts`
- Modify: `src/core/filters.ts`
- Modify: `src/core/useDebouncedSave.test.tsx`
- Modify: `src/index.ts`
- Test: `src/core/filterKinds.test.ts`, `src/core/persistence.test.ts`

Filters are two new layout slices, so persistence needs **no format bump**: `pruneLayout` is a
whitelist that rebuilds a fresh object from recognised keys, and bumping `FORMAT_VERSION` would throw
away every user's column widths and pinning for a purely additive change. But a whitelist only
restores what it copies, so both new slices need a branch, and the `filters` branch has to drop more
than unknown columns.

The extra rule is the one worth understanding: a condition is dropped when **its kind disagrees with
the column's currently resolved kind**. A stored `{ kind: "text", op: "contains" }` on a column that
is now a number column passes every other check, and then the number editor says "number" while the
condition says "string value" — the client runs a substring test against a numeric accessor and the
wire sends `ILIKE` for an integer column, which is an error in Postgres. This is reachable with **no
host code change at all**, because a column with no declared `meta.filter` has its kind inferred from
the first non-null value, and a page whose first rows happen to begin with nulls can infer a
different kind on the next visit. A mismatched condition is dropped, never reinterpreted.

The resolver works off the column definitions and the data, not off the table instance: `useArrangement`
prunes the stored layout on the very first render, before `useTable` has been called.

- [ ] **Step 1: Write the failing test**

Create `src/core/filterKinds.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { collectFilterKinds, resolveFilterKind } from "./filterKinds"

interface Receipt {
  code: string
  amount: number | null
  paid: boolean
  partner: { name: string }
}

describe("resolveFilterKind", () => {
  it("takes the declared kind, including false", () => {
    expect(resolveFilterKind({ meta: { filter: "list" }, hasAccessor: true, sampleValue: 5 })).toBe("list")
    expect(resolveFilterKind({ meta: { filter: false }, hasAccessor: true, sampleValue: "x" })).toBe(false)
  })

  it("infers from the first non-null value when nothing is declared", () => {
    expect(resolveFilterKind({ meta: undefined, hasAccessor: true, sampleValue: "x" })).toBe("text")
    expect(resolveFilterKind({ meta: undefined, hasAccessor: true, sampleValue: 5 })).toBe("number")
    expect(resolveFilterKind({ meta: undefined, hasAccessor: true, sampleValue: true })).toBe("boolean")
    // Anything else — a Date, an object — falls back to text rather than
    // guessing at an editor that cannot read it.
    expect(resolveFilterKind({ meta: undefined, hasAccessor: true, sampleValue: new Date() })).toBe("text")
    expect(resolveFilterKind({ meta: undefined, hasAccessor: true, sampleValue: undefined })).toBe("text")
  })

  it("turns filtering off for a display column, which has no value to filter", () => {
    expect(resolveFilterKind({ meta: undefined, hasAccessor: false, sampleValue: undefined })).toBe(false)
  })
})

describe("collectFilterKinds", () => {
  const rows: Receipt[] = [
    { code: "KR-1", amount: null, paid: false, partner: { name: "Agro" } },
    { code: "KR-2", amount: 500, paid: true, partner: { name: "Temir" } },
  ]

  it("walks nested groups and resolves every leaf", () => {
    const kinds = collectFilterKinds<Receipt>(
      [
        {
          id: "money",
          columns: [
            { accessorKey: "amount" },
            { accessorKey: "paid" },
          ],
        },
        { accessorKey: "code" },
        { id: "actions" },
      ],
      rows,
    )

    // `amount` is null on the first row; inference looks past it.
    expect(kinds.get("amount")).toBe("number")
    expect(kinds.get("paid")).toBe("boolean")
    expect(kinds.get("code")).toBe("text")
    expect(kinds.get("actions")).toBe(false)
    // A group carries no filter of its own.
    expect(kinds.has("money")).toBe(false)
  })

  it("keys a dotted accessorKey the way TanStack's constructColumn does, but still reads it as a path", () => {
    // TanStack's `constructColumn` computes a live column's id as
    // `accessorKey.replaceAll(".", "_")`, so `"partner.name"` has live id
    // `"partner_name"` — the map must be keyed the same way, or a stored
    // condition on this column can never be found again.
    const kinds = collectFilterKinds<Receipt>([{ accessorKey: "partner.name" }], rows)
    expect(kinds.get("partner_name")).toBe("text")
    expect(kinds.has("partner.name")).toBe(false)
  })

  it("prefers an accessorFn and an explicit meta over inference", () => {
    const kinds = collectFilterKinds<Receipt>(
      [
        { id: "total", accessorFn: (row) => row.amount ?? 0 },
        { id: "status", accessorFn: (row) => row.code, meta: { filter: "list" } },
      ],
      rows,
    )
    expect(kinds.get("total")).toBe("number")
    expect(kinds.get("status")).toBe("list")
  })
})
```

In `src/core/persistence.test.ts`, change the import block at the top from

```ts
import { beforeEach, describe, expect, it } from "vitest"
import { localStorageLayout, noLayoutStorage, pruneLayout } from "./persistence"
import type { TableLayout } from "../types"
```

to

```ts
import { beforeEach, describe, expect, it } from "vitest"
import type { FilterCondition, FilterKind } from "./filters"
import { localStorageLayout, noLayoutStorage, pruneLayout } from "./persistence"
import type { TableLayout } from "../types"
```

and append this `describe` block to the end of the same file:

```ts
describe("pruneLayout — filters", () => {
  const kinds: ReadonlyMap<string, FilterKind | false> = new Map<string, FilterKind | false>([
    ["a", "text"],
    ["b", "number"],
    ["c", false],
  ])
  const contains: FilterCondition = { kind: "text", field: "a", op: "contains", value: "x" }

  it("keeps a condition on a live column, rebuilt in canonical form", () => {
    // Two columns, not two conditions on one: the model is one condition per
    // column, and the case below is what holds that line.
    const handBuilt = { op: "in", values: ["open", "closed"], field: "b", kind: "list" } as FilterCondition
    const pruned = pruneLayout({ filters: [contains, handBuilt] }, ["a", "b"])
    expect(pruned.filters).toEqual([
      contains,
      { kind: "list", field: "b", op: "in", values: ["closed", "open"] },
    ])
  })

  it("keeps at most one condition per column, and it is the last one", () => {
    // The projection into `state.columnFilters` is the only writer of
    // `ColumnFilter.id`, so two conditions on one field would become two
    // entries sharing an id: the row model applies both while every editor,
    // which looks a column's condition up by `field`, shows only the first.
    const later: FilterCondition = { kind: "text", field: "a", op: "equals", value: "y" }
    expect(pruneLayout({ filters: [contains, later] }, ["a"], kinds).filters).toEqual([later])
  })

  it("drops a condition on a column the table no longer defines", () => {
    expect(pruneLayout({ filters: [contains] }, ["b"], kinds).filters).toEqual([])
  })

  it("drops a condition whose kind disagrees with the column's resolved kind", () => {
    // Reachable with no host code change: a kind inferred from data can differ
    // between visits, and a text condition on a number column would send ILIKE
    // for an integer column, which is an error in Postgres.
    expect(pruneLayout({ filters: [{ ...contains, field: "b" }] }, ["a", "b"], kinds).filters).toEqual([])
    expect(pruneLayout({ filters: [{ ...contains, field: "c" }] }, ["a", "c"], kinds).filters).toEqual([])
  })

  it("drops a condition of an unknown kind or a shape its operator cannot carry", () => {
    const unknownKind = { kind: "colour", field: "a", op: "is" } as unknown as FilterCondition
    const wrongArity = { kind: "text", field: "a", op: "contains" } as unknown as FilterCondition
    expect(pruneLayout({ filters: [unknownKind, wrongArity] }, ["a"], kinds).filters).toEqual([])
  })

  it("keeps a stored search string and ignores anything else", () => {
    expect(pruneLayout({ search: "kr-102" }, ["a"]).search).toBe("kr-102")
    expect(pruneLayout({ search: 5 as unknown as string }, ["a"]).search).toBeUndefined()
    expect(pruneLayout({}, ["a"]).search).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/core/filterKinds.test.ts src/core/persistence.test.ts
```

`filterKinds.test.ts` fails to resolve `./filterKinds` (the file does not exist). Every test in the
new `pruneLayout — filters` block fails: `pruneLayout` copies neither slice, so `pruned.filters` and
`pruned.search` are `undefined` — `expected undefined to deeply equal []`.

- [ ] **Step 3: Implement**

Append `pruneFilters` to the end of `src/core/filters.ts`:

```ts
/**
 * Drop conditions a table can no longer honour, and rebuild the rest.
 *
 * Shared by `pruneLayout` and `filtering.setModel`, which take the same kind of
 * untrusted input: a condition on a column that no longer exists, of an unknown
 * kind, with a shape its operator does not carry, or whose kind disagrees with
 * the column's currently resolved kind. The last of those is reachable with no
 * host code change at all, because a column with no declared `meta.filter` has
 * its kind inferred from data — and a mismatched condition would run a
 * substring test against a numeric accessor and send `ILIKE` for an integer
 * column, which is an error in Postgres.
 *
 * **At most one condition survives per `field`, and it is the last one.** The
 * model is one condition per column, and the projection into
 * `state.columnFilters` is the only writer of `ColumnFilter.id` — so two
 * conditions on one field would become two entries sharing an id, which the
 * filtered row model applies both of while every editor, which looks a column's
 * condition up by `field`, shows only the first. That is the same "40 rows out
 * of 10 000 and no way to find out why" a stranded filter produces, and a
 * duplicate could never round-trip back out of the projection anyway.
 *
 * @param filters - Conditions as they came out of storage or from a host.
 * @param knownColumnIds - Column ids the table currently defines.
 * @param filterKinds - Each column's resolved filter kind; `false` where
 *   filtering is off for it. Omitted, the kind check is skipped.
 * @returns The conditions worth keeping, one per column, each rebuilt in
 *   canonical form.
 */
export function pruneFilters(
  filters: readonly FilterCondition[],
  knownColumnIds: readonly string[],
  filterKinds?: ReadonlyMap<string, FilterKind | false> | undefined,
): FilterCondition[] {
  const known = new Set(knownColumnIds)
  const kept = new Map<string, FilterCondition>()
  for (const condition of filters) {
    if (typeof condition !== "object" || condition === null) continue
    if (!known.has(condition.field)) continue
    const resolved = filterKinds?.get(condition.field)
    if (resolved !== undefined && resolved !== condition.kind) continue
    const rebuilt = rebuildCondition(condition)
    if (rebuilt === null) continue
    // A repeated field overwrites in place, so the result keeps the order the
    // fields first appeared in and is a function of the input alone.
    kept.set(condition.field, rebuilt)
  }
  return [...kept.values()]
}
```

In `src/types.ts`, add the filters import above the TanStack one:

```ts
import type { FilterCondition, FilterValueOption, FilterKind } from "./core/filters"
import type {
  ColumnOrderState,
```

then replace the tail of `TableLayout` — from `sorting` through the closing brace — with:

```ts
  sorting: SortingState
  /** One condition per filtered column, implicitly ANDed. */
  filters: FilterCondition[]
  /** Quick search, raw as the user typed it; `""` when off. */
  search: string
  /** Rows per page the user chose. Absent until they change it. */
  pageSize?: number
}

/**
 * Per-column filter configuration, read from `columnDef.meta`.
 *
 * Every member is written `?: T | undefined` because the repo runs
 * `exactOptionalPropertyTypes` and `meta: { filter: isNumeric ? "number" : undefined }`
 * is the natural call site.
 */
export interface DataTableColumnMeta {
  /** Which editor this column gets. `false` turns filtering off for it. */
  filter?: FilterKind | false | undefined
  /** Whether quick search covers this column. Default true for text-ish columns. */
  searchable?: boolean | undefined
  /** Fixed choices for a list filter; shown without counts. */
  values?: FilterValueOption[] | undefined
}
```

Create `src/core/filterKinds.ts`:

```ts
import type { FilterKind } from "./filters"
import type { DataTableColumnMeta } from "../types"

/**
 * Which filter editor each column gets.
 *
 * Resolved from the column definitions and the data rather than from the table
 * instance, because a stored layout is pruned by `useArrangement` before the
 * table exists — and pruning is where a mismatched kind has to be caught.
 */

/** What {@link resolveFilterKind} needs to know about one column. */
export interface FilterKindSource {
  /** The column's `columnDef.meta`, if it declared one. */
  meta: DataTableColumnMeta | undefined
  /** False for a display column, which has no value to filter. */
  hasAccessor: boolean
  /** The first non-null value the data offers for this column, for inference. */
  sampleValue: unknown
}

/**
 * One column's filter kind.
 *
 * `meta.filter` wins outright, including `false` to turn filtering off. With
 * nothing declared the kind is inferred from the first non-null value:
 * string → text, number → number, boolean → boolean, anything else → text.
 *
 * Inference is a convenience, not a contract — a column that matters declares
 * its kind. It is also *data-dependent*, which is why a stored condition is
 * checked against the resolved kind on load: a page whose first rows happen to
 * begin with nulls can infer a different kind on the next visit.
 *
 * @param source - The column's meta, whether it has an accessor, and a sample value.
 * @returns The kind, or false when the column cannot be filtered.
 */
export function resolveFilterKind(source: FilterKindSource): FilterKind | false {
  const declared = source.meta?.filter
  if (declared !== undefined) return declared
  if (!source.hasAccessor) return false
  if (typeof source.sampleValue === "number") return "number"
  if (typeof source.sampleValue === "boolean") return "boolean"
  return "text"
}

/** The parts of a column definition this module reads. */
export interface FilterColumnDefShape<TData> {
  id?: string
  accessorKey?: unknown
  accessorFn?: (row: TData, index: number) => unknown
  meta?: DataTableColumnMeta | undefined
  columns?: readonly FilterColumnDefShape<TData>[]
}

/**
 * Every leaf column's resolved filter kind.
 *
 * Mirrors `collectLeafIds`' own id resolution (both derive it the way
 * TanStack's `constructColumn` does — see {@link deriveColumnId}) so the map
 * lines up with the ids a stored layout holds. Only the first few rows are
 * sampled: inference needs one non-null value, and walking a 100 000-row array
 * per column on every mount to find one is not worth the accuracy.
 *
 * @param columns - Column definitions, possibly nested.
 * @param rows - The data, or the page of it the table is holding.
 * @returns Leaf column id to resolved kind.
 */
export function collectFilterKinds<TData>(
  columns: readonly FilterColumnDefShape<TData>[],
  rows: readonly TData[],
): Map<string, FilterKind | false> {
  const kinds = new Map<string, FilterKind | false>()
  const walk = (defs: readonly FilterColumnDefShape<TData>[]): void => {
    defs.forEach((def, index) => {
      if (def.columns?.length) {
        walk(def.columns)
        return
      }
      const id = deriveColumnId(def, index)
      const read = valueReader(def)
      kinds.set(id, resolveFilterKind({
        meta: def.meta,
        hasAccessor: read !== null,
        sampleValue: read === null ? undefined : firstNonNull(rows, read),
      }))
    })
  }
  walk(columns)
  return kinds
}

/** How to read one column's value off a row, or null for a display column. */
function valueReader<TData>(def: FilterColumnDefShape<TData>): ((row: TData, index: number) => unknown) | null {
  if (typeof def.accessorFn === "function") return def.accessorFn
  if (typeof def.accessorKey !== "string") return null
  // TanStack reads a dotted `accessorKey` as a path, so this has to as well.
  const path = def.accessorKey.split(".")
  return (row: TData) =>
    path.reduce<unknown>(
      (value, key) => (value === null || typeof value !== "object" ? undefined : (value as Record<string, unknown>)[key]),
      row,
    )
}

/** How many rows to look at before giving up on inferring a kind. */
const SAMPLE_ROWS = 20

function firstNonNull<TData>(rows: readonly TData[], read: (row: TData, index: number) => unknown): unknown {
  const limit = Math.min(rows.length, SAMPLE_ROWS)
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index]
    if (row === undefined) continue
    const value = read(row, index)
    if (value !== null && value !== undefined) return value
  }
  return undefined
}
```

In `src/core/persistence.ts`, change the import line from

```ts
import type { LayoutStorage, TableLayout } from "../types"
```

to

```ts
import { pruneFilters, type FilterKind } from "./filters"
import type { LayoutStorage, TableLayout } from "../types"
```

replace the tail of `pruneLayout`'s JSDoc and its signature — from `@param stored` through the
opening brace — with:

```ts
 * @param stored - Layout as it came out of storage.
 * @param knownColumnIds - Column IDs the table currently defines.
 * @param filterKinds - Each column's resolved filter kind; `false` where
 *   filtering is off for it. Optional because `pruneLayout` is a public export —
 *   omitted, a stored condition is still checked for an unknown column, an
 *   unknown kind and a shape its operator does not carry, but not against the
 *   column's current kind. {@link useDataTable} always passes it.
 * @returns The layout with unknown column references removed.
 */
export function pruneLayout(
  stored: Partial<TableLayout>,
  knownColumnIds: readonly string[],
  filterKinds?: ReadonlyMap<string, FilterKind | false> | undefined,
): Partial<TableLayout> {
```

and insert the two new branches between the `sorting` branch and the `pageSize` branch:

```ts
  if (stored.sorting) {
    pruned.sorting = stored.sorting.filter((entry) => known.has(entry.id))
  }

  // Without this a deleted column's filter stays active forever with no UI able
  // to reach it: 40 rows out of 10 000 and no way to find out why.
  if (stored.filters) {
    pruned.filters = pruneFilters(stored.filters, knownColumnIds, filterKinds)
  }
  // `pruneLayout` rebuilds from recognised keys, so a slice it does not copy is
  // a slice that never comes back from storage.
  if (typeof stored.search === "string") pruned.search = stored.search

  if (typeof stored.pageSize === "number" && Number.isFinite(stored.pageSize) && stored.pageSize > 0) {
```

In `src/core/useArrangement.ts`, add the two slices to `EMPTY_LAYOUT`:

```ts
export const EMPTY_LAYOUT: TableLayout = {
  columnOrder: [],
  columnVisibility: {},
  columnPinning: { start: [], end: [] },
  columnSizing: {},
  sorting: [],
  filters: [],
  // Also what an absent global filter means to TanStack, so the off state is
  // unambiguous.
  search: "",
}
```

Two existing test fixtures now describe an incomplete `TableLayout` and must be completed. In
`src/core/useDebouncedSave.test.tsx`:

```ts
const layoutAt = (width: number): TableLayout => ({
  columnOrder: [],
  columnVisibility: {},
  columnPinning: { start: [], end: [] },
  columnSizing: { a: width },
  sorting: [],
  filters: [],
  search: "",
})
```

and in `src/core/persistence.test.ts`:

```ts
const layout: TableLayout = {
  columnOrder: ["a", "b", "c"],
  columnVisibility: { b: false },
  columnPinning: { start: ["a"], end: ["c"] },
  columnSizing: { a: 120 },
  sorting: [{ id: "b", desc: true }],
  filters: [],
  search: "",
}
```

Finally, in `src/index.ts` add `pruneFilters` to the value export from `./core/filters` (keeping the
list alphabetical, between `numberCondition` and `rebuildCondition`), add the new module's exports
immediately after the `export type { ResolvedCondition } …` line:

```ts
export { collectFilterKinds, resolveFilterKind } from "./core/filterKinds"
export type { FilterColumnDefShape, FilterKindSource } from "./core/filterKinds"
```

and add `DataTableColumnMeta` to the type export from `./types`:

```ts
export type {
  DataTableColumnMeta,
  DataTableFeatureFlags,
  DataTableLabels,
  LayoutStorage,
  TableLayout,
} from "./types"
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/core/filterKinds.test.ts src/core/persistence.test.ts
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must report **326 tests** (314 plus 6 in `filterKinds.test.ts` and 6 in
`persistence.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/core/filterKinds.ts src/core/filterKinds.test.ts src/core/filters.ts src/core/persistence.ts src/core/persistence.test.ts src/core/useArrangement.ts src/core/useDebouncedSave.test.tsx src/types.ts src/index.ts
git commit -m "feat(filters): per-column kind resolver and layout pruning"
git push origin khojiakbar
```

---

### Task 6: Filter state, page reset and the persistence opt-out

**Files:**
- Modify: `src/core/useArrangement.ts`
- Modify: `src/useDataTable.ts`
- Modify: `src/index.ts`
- Modify: `README.md`
- Test: `src/FilterState.test.tsx`

Three things land together because none of them is usable alone.

**Every change to the result set resets the page.** `updateFilters` and `updateSearch` are exact
twins of `updateSorting`: `updateSlice(...)` then `resetPage()`. Every public mutator goes through
one of them, so there is no path that changes the result set without resetting the page. TanStack's
own post-filter reset is unavailable because `autoResetPageIndex: false` is set for good server-mode
reasons, and the fallbacks are not a substitute: in client mode the pre-paint correction pulls the
user to the **last** page of the filtered set, and in server mode the query for page 40 goes out
first and is answered with nothing.

**`persist: false` is enforced on the write side**, because `pruneLayout` runs only on load and
`LayoutStorage.save` is typed to take a complete `TableLayout`. The slices are blanked at the save
boundary rather than narrowed out of the object that also feeds `useTable`, and a change confined to
them does not set `hasUnsavedChanges` — otherwise typing in the search box would schedule one storage
write per pause, which for the server-backed adapter `types.ts` recommends is one network request per
pause for state the host asked not to keep.

**`isCustomised` ignores both slices, always** — not only under `persist: false`. A search must not
make a Reset link appear in the Columns tab for a reason that has nothing to do with columns.

`setModel` takes untrusted input — a URL, a host's own store, a hand-written literal — so it runs the
same validation as a stored layout and **re-runs every surviving condition through its constructor**.
Without the re-run, a condition a host assembled in a different key order would stringify differently
from an identical one the editors built, and the whole no-spurious-refetch story would have a hole in
it reachable through the very API recommended for URL round-trips. It inherits `pruneFilters`'
one-condition-per-column guarantee for free, and it is the only public path a duplicate could arrive
by: a model carrying two conditions on one column keeps the last of them.

- [ ] **Step 1: Write the failing test**

Create `src/FilterState.test.tsx`:

```tsx
import { createColumnHelper } from "@tanstack/react-table"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { localStorageLayout } from "./core/persistence"
import type { FilterCondition } from "./core/filters"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

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

const setup = (id: string, options: { persist?: boolean } = {}) =>
  renderHook(() =>
    useDataTable<Row>({
      id,
      columns,
      data,
      pagination: true,
      getRowId: (row) => row.id,
      storage: localStorageLayout(),
      ...(options.persist === undefined ? {} : { filtering: { persist: options.persist } }),
    }),
  )

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

  it("is on by default and off when filtering is false", () => {
    const enabled = setup("f14")
    expect(enabled.result.current.filtering.enabled).toBe(true)

    const { result } = renderHook(() =>
      useDataTable<Row>({ id: "f15", columns, data, filtering: false, getRowId: (row) => row.id }),
    )
    expect(result.current.filtering.enabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/FilterState.test.tsx
```

All 15 tests fail. The first one reports `TypeError: Cannot read properties of undefined (reading
'setCondition')` — the instance has no `filtering` object.

- [ ] **Step 3: Implement**

In `src/core/useArrangement.ts`, add the `FilterKind` import above `pruneLayout`'s:

```ts
import { useCallback, useRef, useState } from "react"
import type { Updater } from "@tanstack/react-table"
import type { FilterKind } from "./filters"
import { pruneLayout } from "./persistence"
```

add this constant immediately after `EMPTY_LAYOUT`:

```ts
/**
 * The slices that hold filter state rather than column arrangement.
 *
 * They live in the layout so they persist and reset with it, but they are not
 * an *arrangement*: a search term must not light up the Columns tab's Reset
 * link, and with `filtering.persist: false` they must never reach storage.
 */
const FILTER_SLICES = new Set<keyof TableLayout>(["filters", "search"])
```

add the two new options to `UseArrangementOptions`, after `columnIds`:

```ts
  /** Leaf column ids, so a stored layout can be pruned to live columns. */
  columnIds: readonly string[]
  /** Each column's resolved filter kind, so a stored condition can be checked against it. */
  filterKinds?: ReadonlyMap<string, FilterKind | false> | undefined
  /** Keep `filters` and `search` out of storage. Default true. */
  persistFilters?: boolean
}
```

change the hook's signature from

```ts
export function useArrangement({ id, store, initialLayout, columnIds }: UseArrangementOptions) {
```

to

```ts
export function useArrangement({
  id,
  store,
  initialLayout,
  columnIds,
  filterKinds,
  persistFilters = true,
}: UseArrangementOptions) {
```

pass the kinds into the mount-time prune:

```ts
      layout: { ...EMPTY_LAYOUT, ...initialLayout, ...pruneLayout(stored ?? {}, columnIds, filterKinds) },
```

replace the two lines

```ts
  const initialRef = useRef(initialLayout)

  useDebouncedSave(store, id, arrangement.layout, arrangement.hasUnsavedChanges)
```

with

```ts
  const initialRef = useRef(initialLayout)

  // Read through a ref so `updateSlice` below stays stable across renders.
  const persistFiltersRef = useRef(persistFilters)
  persistFiltersRef.current = persistFilters

  /*
   * What actually reaches storage.
   *
   * With `persist: false` the filter slices are blanked here, at the write
   * boundary, rather than narrowed out of the object that also feeds
   * `useTable`: `pruneLayout` runs only on load, and `LayoutStorage.save` is
   * typed to take a complete layout.
   *
   * Held in a ref and compared structurally, the way `useTableQuery` holds its
   * query: `useDebouncedSave` keys its timer on this object's identity, so a
   * fresh-but-equal one per keystroke would re-arm the 350 ms save with
   * identical content — one storage write, or one network request, per pause.
   */
  const candidate = persistFilters
    ? arrangement.layout
    : { ...arrangement.layout, filters: EMPTY_LAYOUT.filters, search: EMPTY_LAYOUT.search }
  const persistedRef = useRef<TableLayout | null>(null)
  if (persistedRef.current === null || !layoutSliceEqual(persistedRef.current, candidate)) {
    persistedRef.current = candidate
  }

  useDebouncedSave(store, id, persistedRef.current, arrangement.hasUnsavedChanges)
```

and replace the body of `updateSlice`'s `setArrangement` call with:

```ts
      setArrangement((previous) => {
        const next = normalise(apply(updater, previous.layout[key]))
        if (layoutSliceEqual(next, previous.layout[key])) return previous
        const isFilterSlice = FILTER_SLICES.has(key)
        return {
          layout: { ...previous.layout, [key]: next },
          // A search does not make a Reset link appear in the Columns tab for
          // a reason that has nothing to do with columns.
          isCustomised: previous.isCustomised || !isFilterSlice,
          hasUnsavedChanges:
            previous.hasUnsavedChanges || !isFilterSlice || persistFiltersRef.current,
        }
      })
```

In `src/useDataTable.ts`, replace the two imports added in Task 4

```ts
import type { FilterCondition } from "./core/filters"
import type { TableQuery, TableSearch } from "./core/query"
```

with

```ts
import { collectFilterKinds } from "./core/filterKinds"
import {
  pruneFilters,
  rebuildCondition,
  type FilterCondition,
  type FilterModel,
  type FilterValueOption,
} from "./core/filters"
import type { TableQuery, TableSearch } from "./core/query"
```

(the `noLayoutStorage` import line stays where it is, between them).

Delete the `NO_FILTERS` constant added in Task 4 — the real slice replaces it — and leave `NO_SEARCH`
in place, narrowing its JSDoc to search alone:

```ts
/**
 * Quick search is not published yet.
 *
 * The slice is written on every keystroke, but what reaches the wire is
 * debounced and needs the resolved search fields, neither of which exists
 * until the quick-search step. A stable constant until then, so the query's
 * identity does not churn.
 */
const NO_SEARCH: TableSearch | null = null
```

Add `FilteringOptions` immediately after `export type TableMode = "client" | "server"`:

```ts
/** How rows are filtered; see {@link UseDataTableOptions.filtering}. */
export interface FilteringOptions {
  /** ms before quick search is published. Default 300. Column filters are never debounced. */
  debounceMs?: number
  /** Keep active filters in the saved layout. Default true. */
  persist?: boolean
  /** Columns quick search covers. Default: every visible searchable column. */
  searchFields?: string[]
  /**
   * Server-mode source of a values filter's choices. Never called in client mode.
   *
   * Written `| undefined` like the hook's other forwarded callbacks, because
   * `exactOptionalPropertyTypes` otherwise rejects passing one through.
   */
  loadValues?:
    | ((columnId: string, options: { search: string; signal: AbortSignal }) => Promise<FilterValueOption[]>)
    | undefined
}
```

Add the option to `UseDataTableOptions`, immediately after `pagination`:

```ts
  pagination?: boolean | PaginationOptions
  /**
   * Filtering: quick search and per-column filters. On by default. Pass
   * `false` to turn it off, or an object to configure it.
   */
  filtering?: boolean | FilteringOptions
```

Add `filtering,` to the destructured parameter list, between `pagination,` and `getRowId,`.

Immediately above the `useArrangement` call, add:

```ts
  const filteringOptions: FilteringOptions | null =
    filtering === false ? null : filtering === true || filtering === undefined ? {} : filtering
  // A boolean rather than the object above, which is a fresh `{}` on every
  // render for the two shorthand forms and would break the memo below.
  const filteringEnabled = filteringOptions !== null

  /*
   * Resolved from the column definitions and the data rather than from the
   * table, which does not exist yet: a stored layout is pruned on the very
   * first render, and pruning is where a condition whose kind no longer
   * matches its column has to be dropped.
   */
  const filterKinds = useMemo(() => collectFilterKinds(columns, data), [columns, data])
```

and pass both into `useArrangement`:

```ts
  } = useArrangement({
    id,
    store,
    initialLayout,
    columnIds,
    filterKinds,
    persistFilters: filteringOptions?.persist ?? true,
  })
```

Immediately after the `resetLayout` callback, add the two mutators:

```ts
  /*
   * Filters and search change the result set exactly as sorting does, so both
   * go back to the first page. Every public mutator goes through one of these
   * two, so there is no path that changes the result set without resetting the
   * page — TanStack's own post-filter reset is unavailable here because
   * `autoResetPageIndex: false` is set for good server-mode reasons, and on
   * page 40 of 100 typing three characters would otherwise land the user on
   * page 3 of 3 of the results.
   */
  const updateFilters = useCallback(
    (updater: Updater<TableLayout["filters"]>) => {
      updateSlice("filters", updater)
      resetPage()
    },
    [updateSlice, resetPage],
  )
  const updateSearch = useCallback(
    (text: string) => {
      updateSlice("search", text)
      resetPage()
    },
    [updateSlice, resetPage],
  )
```

Change the `useTableQuery` call's `filters` line from `filters: NO_FILTERS,` to
`filters: layout.filters,`, and immediately after that call add the public surface:

```ts
  const setCondition = useCallback(
    (condition: FilterCondition) => {
      // An editor that constrains nothing clears the column, because the
      // constructor returns null for it.
      const built = rebuildCondition(condition)
      updateFilters((current) => {
        const rest = current.filter((existing) => existing.field !== condition.field)
        return built === null ? rest : [...rest, built]
      })
    },
    [updateFilters],
  )
  const clearColumn = useCallback(
    (columnId: string) =>
      updateFilters((current) => current.filter((existing) => existing.field !== columnId)),
    [updateFilters],
  )
  const clearAll = useCallback(() => {
    updateFilters([])
    updateSearch("")
  }, [updateFilters, updateSearch])
  const setModel = useCallback(
    (model: FilterModel) => {
      /*
       * Untrusted input — a URL, a host's own store, a hand-written literal —
       * so it is held to the same rules as a stored layout, and every
       * surviving condition is re-run through its constructor. Without the
       * re-run a condition assembled in a different key order would stringify
       * differently from an identical one the editors built, and the
       * no-spurious-refetch story would have a hole in it reachable through
       * the very API recommended for URL round-trips.
       */
      updateFilters(pruneFilters(model.filters ?? [], columnIds, filterKinds))
      updateSearch(typeof model.search === "string" ? model.search : "")
    },
    [updateFilters, updateSearch, columnIds, filterKinds],
  )

  const filteringApi = useMemo(
    () => ({
      enabled: filteringEnabled,
      conditions: layout.filters as readonly FilterCondition[],
      search: layout.search,
      isFiltered: layout.filters.length > 0 || layout.search.trim() !== "",
      setCondition,
      clearColumn,
      clearAll,
      setSearch: updateSearch,
      getModel: (): FilterModel => ({ filters: [...layout.filters], search: layout.search }),
      setModel,
    }),
    [filteringEnabled, layout.filters, layout.search, setCondition, clearColumn, clearAll, updateSearch, setModel],
  )
```

and add it to the returned object, between `pagination` and `rowHeight`:

```ts
    pagination: paginationApi,
    filtering: filteringApi,
    rowHeight,
```

In `src/index.ts`, add `FilteringOptions` to the type export from `./useDataTable`:

```ts
export type {
  DataTableFeatures,
  DataTableInstance,
  FilteringOptions,
  PaginationOptions,
  TableMode,
  UseDataTableOptions,
} from "./useDataTable"
```

In `README.md`, add the `filtering` row to the `useDataTable(options)` table, immediately below the
`pagination` row:

```markdown
| `filtering` | `boolean \| FilteringOptions` | on | `{ debounceMs?, persist?, searchFields?, loadValues? }`. `false` turns filtering off. |
```

update the "Returns" line below that table to

```markdown
Returns `{ table, id, flags, bounds, resetLayout, isCustomised, expanded, mode, query, pagination, filtering, rowHeight, getRowHeight, heightVersion }`.
```

and append this paragraph to the end of the **Persistence** section, after the "Columns that
disappear" paragraph:

```markdown
**Filters persist too**, with the rest of the layout, and a stored condition is
dropped on load when its column is gone, when its shape does not match its
operator, or when the column's filter kind has changed since. Pass
`filtering: { persist: false }` to keep filters and the search box out of
storage entirely, for a table you would rather have every visit start clean;
nothing is then written for a filter change at all, which matters most for a
server-backed adapter, where a write is a network request. A filter or a search
never counts as *customising* the layout either way — the Columns tab's Reset
link is about columns.
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/FilterState.test.tsx
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must report **341 tests** (326 plus 15).

- [ ] **Step 5: Commit**

```bash
git add src/core/useArrangement.ts src/useDataTable.ts src/index.ts src/FilterState.test.tsx README.md
git commit -m "feat(filters): filter state, page reset and the persistence opt-out"
git push origin khojiakbar
```

---

## Where the next section picks up

`instance.filtering` exists and drives real state, but nothing filters rows yet: `filterFn_dt` is
written and exported but not registered, and `layout.filters` is published on the wire without being
projected into `state.columnFilters`. Step 4 of §13 composes `columnFilteringFeature`,
`globalFilteringFeature`, `createFilteredRowModel`, the faceting slots, the `filterFns: { dt: filterFn_dt }`
registry, the `columnMeta` slot as `DataTableColumnMeta & ColumnMeta<any, any, any>`, the
`defaultColumn.filterFn: "dt"` default, `manualFiltering: isServer`, `filterFromLeafRows`, the
memoised `layout.filters` → `columnFilters` projection and the `onColumnFiltersChange` bridge — which
routes back through the `updateFilters` written here. `search` on the wire stays `NO_SEARCH` until
the quick-search step wires `resolvedSearchFields` and the `debounceMs` debounce; `FilteringOptions`
already declares `debounceMs`, `searchFields` and `loadValues` for it.
# Section B — TanStack composition, quick search and the labels batch (Tasks 7–12)

Covers §13 order-of-work steps 4, 5 and 6: §3.3's search-field predicate and `filterFn_dtSearch`,
the whole of §5.1 composed in one go with §6.1's `manualFiltering` and §7.1's projection and
`onColumnFiltersChange` bridge, §6.2's debounced published value, §8.5's labels batch, and §8.1's
toolbar search box and exported `QuickSearch`.

All work happens on the existing `khojiakbar` branch. Never check out, commit to, or merge into `main`.

Section A (Tasks 1–6) is a prerequisite and its names are binding. This section **imports** and never
redefines: `src/core/filters.ts` (`FilterCondition`, `FilterKind`, `FilterModel`, `FilterValue`,
`FilterValueOption`, `rebuildCondition`, `pruneFilters`, …), `src/core/filterFn.ts` (`filterFn_dt`),
`src/core/filterKinds.ts` (`FilterKindSource`, `FilterColumnDefShape`, `resolveFilterKind`,
`collectFilterKinds`), `src/core/query.ts` (`TableQuery`, `TableSearch`, `buildQuery`),
`src/types.ts` (`DataTableColumnMeta`, `TableLayout.filters`, `TableLayout.search`), and
`src/useDataTable.ts` (`FilteringOptions`, `instance.filtering`, `updateFilters`, `updateSearch`).

## Modules this section creates

**`src/core/search.ts`** (new, Tasks 7, 8)
- types: `SearchNeedle`
- functions: `isSearchableColumn`, `collectSearchFields`, `searchNeedle`, `rowMatchesSearch`;
  the registered global filter function `filterFn_dtSearch`

**`src/core/useDebouncedValue.ts`** (new, Task 10) — `useDebouncedValue`

**`src/components/QuickSearch.tsx`** (new, Task 12) — `QuickSearch`

**`src/core/filterKinds.ts`** (modified, Task 7) — gains `collectColumnFacts`, which `collectFilterKinds`
is rewritten on top of, so the search module reuses one column walk instead of forking it.

**`src/useDataTable.ts`** (modified, Tasks 9, 10) — the `tableFeatures` composition, the `columnMeta`
slot, `resolvedSearchFields`, the `columnFilters` projection, `updateFiltersFromTanStack`, the search
debounce, and the new table options.

**`src/types.ts`** / **`src/components/DataTable.tsx`** (modified, Task 11) — 48 new `DataTableLabels`
keys and their English defaults. Steps after this consume these and add none.

**`src/styles.css`** (modified, Task 12) — `.dt-search`, `.dt-search-box`, `.dt-search-clear`,
`.dt-sr-only`. **No new `--dt-*` tokens anywhere in this section**, so `themes.test.ts`'s hard-coded
count of 25 base tokens stays as it is.

Not created here, and named so nobody duplicates them: the column filter popover and its header-menu
item (§8.2), the `TablePanel` shell and the Filters tab (§8.3), the values editors and `loadValues`
(§5.3, §6.3), and the no-matches state (§8.4). Task 11 ships the labels all of those need.

---

### Task 7: Which columns quick search covers

**Files:**
- Create: `src/core/search.ts`
- Modify: `src/core/filterKinds.ts`
- Modify: `src/index.ts`
- Test: `src/core/search.test.ts`

§3.3's predicate, as a pure function, before anything is wired. `fields` is every **visible**,
accessor-backed column whose `meta.searchable` resolves true, where the default for `meta.searchable`
is "the column's first non-null value is a string or a number".

None of that is TanStack's default, and the reasons matter:

- TanStack's `getColumnCanGlobalFilter` applies that same value-type heuristic, but as a gate
  *underneath* the flags rather than as a default a host can override — a host marking a `Date`
  column `searchable: true` would still be excluded by it.
- `column_getCanGlobalFilter` never consults visibility at all, so without our own predicate a hidden
  column goes on being searched client-side while `fields` omits it — the two modes would search
  different columns for the same text.
- A display column (no `accessorFn`) is excluded either way, by TanStack and by us. It has no value
  to search.

`filterKinds.ts` already walks the column definitions to find each leaf's meta, accessor and first
non-null value; that walk is `resolveFilterKind`'s input, and it is exactly this predicate's input
too. It is extracted here as `collectColumnFacts` rather than copied — the second occurrence is where
this repo refactors, not the third — and the facts it returns are Section A's own exported
`FilterKindSource`, which already has precisely the three members both predicates read.

Note what the default predicate does and does not cover: a **number** column is searchable by
default, because that is what §3.3 says and what TanStack's own heuristic does. A host that does not
want an `amount` column scanned by a backend sets `meta: { searchable: false }` on it (§11).

- [ ] **Step 1: Write the failing test**

Create `src/core/search.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { collectSearchFields, isSearchableColumn } from "./search"

interface Receipt {
  code: string
  amount: number
  created: Date
  paid: boolean
  partner: { name: string }
}

const rows: Receipt[] = [
  { code: "KR-1", amount: 100, created: new Date(2026, 2, 1), paid: false, partner: { name: "Agro" } },
  { code: "KR-2", amount: 500, created: new Date(2026, 2, 2), paid: true, partner: { name: "Temir" } },
]

describe("isSearchableColumn", () => {
  it("defaults to a column whose first value is a string or a number", () => {
    expect(isSearchableColumn({ meta: undefined, hasAccessor: true, sampleValue: "KR-1" }, true)).toBe(true)
    expect(isSearchableColumn({ meta: undefined, hasAccessor: true, sampleValue: 100 }, true)).toBe(true)
    expect(isSearchableColumn({ meta: undefined, hasAccessor: true, sampleValue: true }, true)).toBe(false)
    expect(isSearchableColumn({ meta: undefined, hasAccessor: true, sampleValue: new Date() }, true)).toBe(false)
  })

  it("takes meta.searchable over the heuristic, both ways", () => {
    // TanStack's own heuristic is a gate underneath the flags, so a host
    // marking a Date column searchable would still be excluded by it.
    expect(isSearchableColumn({ meta: { searchable: true }, hasAccessor: true, sampleValue: new Date() }, true)).toBe(true)
    expect(isSearchableColumn({ meta: { searchable: false }, hasAccessor: true, sampleValue: "KR-1" }, true)).toBe(false)
  })

  it("excludes a hidden column, and a display column that has no value to search", () => {
    expect(isSearchableColumn({ meta: { searchable: true }, hasAccessor: true, sampleValue: "KR-1" }, false)).toBe(false)
    expect(isSearchableColumn({ meta: { searchable: true }, hasAccessor: false, sampleValue: undefined }, true)).toBe(false)
  })
})

describe("collectSearchFields", () => {
  it("walks nested groups and returns the ids sorted", () => {
    const fields = collectSearchFields<Receipt>(
      [
        { id: "money", columns: [{ accessorKey: "amount" }, { accessorKey: "paid" }] },
        { accessorKey: "code" },
        { accessorKey: "created" },
        { id: "actions" },
      ],
      rows,
      {},
    )
    // `paid` is a boolean, `created` a Date, `actions` a display column, and a
    // group carries no value of its own.
    expect(fields).toEqual(["amount", "code"])
  })

  it("drops a hidden column and derives a dotted accessorKey's id the way TanStack does", () => {
    // `constructColumn` gives `"partner.name"` the live id `"partner_name"`,
    // so that is what `columnVisibility` is keyed by and what `search.fields`
    // has to carry: a list built from the dotted key would silently miss the
    // visibility flag and name a column the table does not have. Only the
    // *value* is read through the dots, by `valueReader`.
    expect(collectSearchFields<Receipt>([{ accessorKey: "partner.name" }, { accessorKey: "code" }], rows, { code: false }))
      .toEqual(["partner_name"])
    expect(collectSearchFields<Receipt>([{ accessorKey: "partner.name" }], rows, { partner_name: false })).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/core/search.test.ts
```

It fails to resolve `./search` — the file does not exist — so all five tests fail at import.

- [ ] **Step 3: Implement**

In `src/core/filterKinds.ts`, replace the whole of `collectFilterKinds` — from its JSDoc through its
closing brace — with a thin version plus the extracted walk. The existing body is the block starting
`export function collectFilterKinds<TData>(` and ending at the `return kinds\n}` before
`/** How to read one column's value off a row, or null for a display column. */`:

> **Correction (found while implementing Task 7):** a review round on Task 5/6 added a regression
> test — `filterKinds.test.ts`'s `"omits an undeclared column when there are no rows yet to infer a
> kind from"` — that pins the exact behaviour this section's original snippet below would have
> deleted: `collectFilterKinds` must *skip* adding an entry when nothing is declared, the column has
> an accessor, and there is no sample to infer from yet, rather than falling through
> `resolveFilterKind` to a guessed `"text"`. A thin `for (const [id, facts] of collectColumnFacts(...))
> kinds.set(id, resolveFilterKind(facts))` loses that skip and breaks the regression test. Keep the
> skip check, moved from the old inline walk onto the facts the extracted `collectColumnFacts` now
> produces:

```ts
/**
 * Every leaf column's resolved filter kind.
 *
 * @param columns - Column definitions, possibly nested.
 * @param rows - The data, or the page of it the table is holding.
 * @returns Leaf column id to resolved kind. A column with no declared
 *   `meta.filter` and no rows yet to sample is omitted rather than guessed at
 *   — `pruneFilters` treats a missing entry as "kind check skipped", which is
 *   the only safe reading before the first row has arrived (server mode, or
 *   client mode with async data): guessing "text" would drop every stored
 *   number/boolean condition on that render.
 */
export function collectFilterKinds<TData>(
  columns: readonly FilterColumnDefShape<TData>[],
  rows: readonly TData[],
): Map<string, FilterKind | false> {
  const kinds = new Map<string, FilterKind | false>()
  for (const [id, facts] of collectColumnFacts(columns, rows)) {
    // Nothing declared and nothing to infer from: the kind is *unknown*, not
    // "text". Recording the guess makes `pruneFilters` delete every stored
    // number/boolean condition on the first render of a table whose rows have
    // not arrived — i.e. on every server-mode mount.
    if (facts.meta?.filter === undefined && facts.hasAccessor && facts.sampleValue === undefined) continue
    kinds.set(id, resolveFilterKind(facts))
  }
  return kinds
}

/**
 * Every leaf column's meta, accessor and sample value, in one walk.
 *
 * Extracted because quick search needs exactly the same three facts about a
 * column that {@link resolveFilterKind} does, and walking the definitions twice
 * — once per consumer — is how the two would drift apart about which id a
 * column has.
 *
 * Ids come from {@link deriveColumnId} — the one place this library derives an
 * id the way TanStack's `constructColumn` does — so the map lines up with the
 * live columns and with the ids a stored layout holds. Only the first few rows
 * are sampled: inference needs one non-null value, and walking a 100 000-row
 * array per column on every mount to find one is not worth the accuracy.
 *
 * @param columns - Column definitions, possibly nested.
 * @param rows - The data, or the page of it the table is holding.
 * @returns Leaf column id to the facts both resolvers read.
 */
export function collectColumnFacts<TData>(
  columns: readonly FilterColumnDefShape<TData>[],
  rows: readonly TData[],
): Map<string, FilterKindSource> {
  const facts = new Map<string, FilterKindSource>()
  const walk = (defs: readonly FilterColumnDefShape<TData>[]): void => {
    defs.forEach((def, index) => {
      if (def.columns?.length) {
        walk(def.columns)
        return
      }
      const id = deriveColumnId(def, index)
      const read = valueReader(def)
      facts.set(id, {
        meta: def.meta,
        hasAccessor: read !== null,
        sampleValue: read === null ? undefined : firstNonNull(rows, read),
      })
    })
  }
  walk(columns)
  return facts
}
```

`valueReader`, `SAMPLE_ROWS` and `firstNonNull` below it are unchanged and stay where they are, and
`deriveColumnId` needs no new import — `filterKinds.ts` already imports it from `./columnIds`.

**Do not re-derive an id here.** `deriveColumnId` (`src/core/columnIds.ts`) is the single place this
library reproduces TanStack's `constructColumn` rule — `columnDef.id ?? accessorKey.replaceAll(".",
"_") ?? (typeof header === "string" ? header : undefined)` — and both earlier copies of that block,
in `collectFilterKinds` and in `collectLeafIds`, were silently wrong for a nested `accessorKey` and
for a header-derived id until they were routed through it. A third copy here would miss the same way
twice over: `collectSearchFields` looks its `visibility` flag up by id, and the ids it returns go
onto the wire as `search.fields` while the client-side predicate reads the live `column.id` — so a
`"partner.name"` column would be searched client-side but named `"partner.name"` to a backend, which
is the one thing §3.3 promises cannot happen.

Create `src/core/search.ts`:

```ts
import { collectColumnFacts, type FilterColumnDefShape, type FilterKindSource } from "./filterKinds"

/**
 * Quick search: which columns it covers, and how a row is matched.
 */

/**
 * Whether quick search covers one column.
 *
 * `meta.searchable` wins outright; with nothing declared the default is "the
 * column's first non-null value is a string or a number". Neither half is
 * TanStack's default: its own heuristic is a gate *underneath* the flags rather
 * than a default a host can override, and it never consults visibility at all —
 * so without this predicate a hidden column would go on being searched
 * client-side while the wire's `fields` omitted it.
 *
 * @param facts - The column's meta, accessor and sample value.
 * @param visible - Whether the column is currently rendered.
 * @returns Whether the column is searched.
 */
export function isSearchableColumn(facts: FilterKindSource, visible: boolean): boolean {
  if (!facts.hasAccessor || !visible) return false
  const declared = facts.meta?.searchable
  if (declared !== undefined) return declared
  return typeof facts.sampleValue === "string" || typeof facts.sampleValue === "number"
}

/**
 * Every column quick search covers, by id, sorted.
 *
 * Sorted here as well as in `buildQuery`, so the list is a function of the
 * searchable set alone: dragging a column into a new position must not change
 * `search.fields` and make a host refetch an identical result set.
 *
 * @param columns - Column definitions, possibly nested.
 * @param rows - The data, or the page of it the table is holding.
 * @param visibility - TanStack's visibility state; an absent id is visible.
 * @returns Leaf column ids, sorted.
 */
export function collectSearchFields<TData>(
  columns: readonly FilterColumnDefShape<TData>[],
  rows: readonly TData[],
  visibility: Record<string, boolean>,
): string[] {
  const fields: string[] = []
  for (const [id, facts] of collectColumnFacts(columns, rows)) {
    if (isSearchableColumn(facts, visibility[id] ?? true)) fields.push(id)
  }
  return fields.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
```

> **Correction (found in review of Task 7):** the snippet above makes `fields` a
> function of *whichever rows happen to be sampled*, not of the searchable set
> alone, and its own JSDoc claimed otherwise. A column with no declared
> `meta.searchable` and no sampled value (`sampleValue === undefined` — no rows
> yet, or every sampled row is null for that column) fell through to `false`
> exactly like a column positively known not to be text — the two are
> indistinguishable in the returned `string[]`. Two host-visible failure modes
> follow once this is wired in Task 9's `resolvedSearchFields`: (1) a
> server-mode table mounted with a restored search term publishes `search:
> null` on its first query, because `data` is `[]` and every column reads as
> unsearchable, then a second query fires once rows land; (2) paging in server
> mode recomputes `fields` from each page's own rows, so a nullable text column
> null across one page's *sampled* rows (only the first `SAMPLE_ROWS = 20`, per
> `filterKinds.ts`) but not another's silently narrows or widens `fields` page
> to page — different columns searched for the same text, so page 2 can repeat
> or drop rows relative to page 1, and `useTableQuery` (Task 9) re-announces on
> every change with nothing to dampen an A/B/A oscillation.
>
> Fixed the way `collectFilterKinds` already handles the identical ambiguity —
> by not guessing. `collectSearchFields` now returns `{ fields: string[],
> unresolved: string[] }`: `unresolved` holds the ids of visible,
> accessor-backed columns with nothing declared and nothing sampled, kept out
> of `fields` without being folded into a `false` that claims certainty. Use
> this shape instead of the bare `string[]` above:
>
> ```ts
> /**
>  * {@link collectSearchFields}'s answer: what it could resolve, and what it could not.
>  */
> export interface SearchFieldsResult {
>   /** Leaf column ids known to be searched, sorted. */
>   fields: string[]
>   /**
>    * Visible, accessor-backed leaf ids with no declared `meta.searchable` and
>    * no sampled value to infer one from, sorted. Neither in `fields` nor
>    * excluded from it — unresolved, not `false`.
>    */
>   unresolved: string[]
> }
>
> export function collectSearchFields<TData>(
>   columns: readonly FilterColumnDefShape<TData>[],
>   rows: readonly TData[],
>   visibility: Record<string, boolean>,
> ): SearchFieldsResult {
>   const fields: string[] = []
>   const unresolved: string[] = []
>   for (const [id, facts] of collectColumnFacts(columns, rows)) {
>     const visible = visibility[id] ?? true
>     if (!facts.hasAccessor || !visible) continue
>     if (facts.meta?.searchable === undefined && facts.sampleValue === undefined) {
>       unresolved.push(id)
>       continue
>     }
>     if (isSearchableColumn(facts, visible)) fields.push(id)
>   }
>   return { fields: fields.sort(compareIds), unresolved: unresolved.sort(compareIds) }
> }
> ```
>
> (`compareIds` is the same `(a, b) => (a < b ? -1 : a > b ? 1 : 0)` inlined
> above, factored out since it is now used twice in the file.) `isSearchableColumn`
> is unchanged — it still returns a plain boolean and still reads an unsampled
> column as `false`, because a single column in isolation has no better answer
> to give; only the aggregate walk can tell "no evidence yet" apart from
> "evidence of not being text", so that is where the distinction has to live.
>
> **Task 9's `resolvedSearchFields` must consume the new shape**, not treat
> `collectSearchFields(...)` as a `string[]`. Replace that memo's inference
> branch with:
>
> ```ts
> const { fields, unresolved } = collectSearchFields(columns, data, layout.columnVisibility)
> return [...fields, ...unresolved].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
> ```
>
> i.e. keep including an id while it stays unresolved, rather than dropping it —
> which is what fixes both failure modes above: an empty first fetch no longer
> excludes every column, and a column merely null within one page's sample
> stays included instead of narrowing that page's search. The cost is the
> opposite, rarer edge: a Date or boolean column can read as included on a page
> where its sample happens to be all-null. A server-mode host that wants a
> field list that never depends on which page is loaded should declare
> `meta.searchable` on the columns it cares about, or pass
> `filtering.searchFields` outright — both already bypass inference entirely.
> Document this in the "Which columns `fields` holds" paragraph Task 10 adds to
> the README.
>
> `search.test.ts` gains four tests pinning this: an empty-`rows` call reports
> its accessor-backed columns as `unresolved` rather than absent from both
> lists; a column null across a 20-row sample (with a real value only past
> `SAMPLE_ROWS`, showing the cap is respected) stays `unresolved`; an explicit
> `meta.searchable: false` stays out of both `fields` and `unresolved`, since it
> is a definite answer, not an ambiguous one; and a hidden column is excluded
> from `unresolved` the same way it already was from `fields`.

In `src/index.ts`, replace the `filterKinds` export line added in Task 5

```ts
export { collectFilterKinds, resolveFilterKind } from "./core/filterKinds"
```

with

```ts
export { collectColumnFacts, collectFilterKinds, resolveFilterKind } from "./core/filterKinds"
```

and immediately after the `export type { FilterColumnDefShape, FilterKindSource } …` line add:

```ts
export { collectSearchFields, isSearchableColumn } from "./core/search"
export type { SearchFieldsResult } from "./core/search"
```

> **Correction (found in review of Task 7):** the `SearchFieldsResult` type
> export is new with the `{ fields, unresolved }` shape above and was not in
> the original snippet — add it alongside the value export, not as a
> replacement of it.

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/core/search.test.ts src/core/filterKinds.test.ts
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must report **5 more tests than the count on `main` before this task** (review rounds on
earlier tasks have already pushed the running total above this plan's original absolute numbers —
treat those as a floor, not an equality, and diff the count before/after this task instead).
`filterKinds.test.ts`'s existing tests (nine, as of the review rounds that added the
"omits an undeclared column…" regression test — see the Step 3 correction above) must still pass
unchanged — the refactor is behaviour-preserving, and that is what proves it.

> **Correction (found in review of Task 7):** a review round on Task 7 itself
> added four more regression tests to `search.test.ts` (see the Step 3
> correction above) pinning the `unresolved` distinction, plus one more to
> `isSearchableColumn`'s own suite documenting that it still answers `false`
> for an unsampled column — the ambiguity is resolved one level up, in
> `collectSearchFields`, not inside the per-column predicate. Treat "5 more
> tests" above as this task's original floor and expect 5 further on top of it
> once these review fixes are applied.

- [ ] **Step 5: Commit**

```bash
git add src/core/search.ts src/core/search.test.ts src/core/filterKinds.ts src/index.ts
git commit -m "feat(filters): resolve which columns quick search covers"
git push origin khojiakbar
```

---

### Task 8: One global filter function, row-level

**Files:**
- Modify: `src/core/search.ts`
- Modify: `src/index.ts`
- Test: `src/core/search.test.ts`

TanStack calls the global filter function **once per globally-filterable column**, with that column's
id, and ORs the results with a `break` on the first `true`. A per-column predicate therefore cannot
express §3.3's contract — "split `text` on whitespace; every token must appear, case-insensitively,
in at least one of `fields` on that row; tokens may match different columns" — because searching
`KR-102 agro` would look for that literal string inside one column at a time and miss the row where
the two tokens live in different columns.

So ours is a **row-level** predicate: it ignores the `columnId` it is handed, reads every searched
field off the row itself, and returns the same verdict for every column, which makes TanStack's own
OR and `break` harmless. Tokenising happens in `resolveFilterValue`, which the table applies ahead of
the row loop — `createFilteredRowModel` resolves it once per globally-filterable column — rather than
once per row.

The one design question the spec leaves open is where the field list comes from, since §5.1 names
`filterFn_dtSearch` as a module-level value rather than something built per render. It is read from
the row's own table — `row.table.getAllLeafColumns()` filtered by `column.getCanGlobalFilter()` —
which is *by construction* the same set `getColumnCanGlobalFilter` answers and the same set TanStack
itself iterates, so the two can never drift. That lookup is cached against the resolved needle, which
the table builds before any row is tested — `createFilteredRowModel` resolves the global filter value
once per globally-filterable column, not once for the whole filter — so the list is computed once per
searchable column per filtering pass rather than once per row.

One cost to know about and not be surprised by: a row that does **not** match is tested once per
searchable column, because TanStack only breaks out of its loop on `true`. That is inherent to a
row-level predicate under TanStack's OR, and it is why the per-row work is kept to reading the fields
and testing substrings.

- [ ] **Step 1: Write the failing test**

Append to `src/core/search.test.ts`, and extend its import line at the top from

```ts
import { collectSearchFields, isSearchableColumn } from "./search"
```

to

```ts
import { collectSearchFields, isSearchableColumn, rowMatchesSearch, searchNeedle } from "./search"
```

```ts
describe("searchNeedle", () => {
  it("lower-cases and splits on whitespace, dropping empties", () => {
    expect(searchNeedle("  KR-102   Agro ")).toEqual({ tokens: ["kr-102", "agro"] })
    expect(searchNeedle("")).toEqual({ tokens: [] })
    expect(searchNeedle(undefined)).toEqual({ tokens: [] })
  })
})

describe("rowMatchesSearch", () => {
  const row = (values: Record<string, unknown>) => ({
    table: {
      getAllLeafColumns: () => [
        { id: "code", getCanGlobalFilter: () => true },
        { id: "partner", getCanGlobalFilter: () => true },
        { id: "secret", getCanGlobalFilter: () => false },
      ],
    },
    getValue: (columnId: string) => values[columnId],
  })

  it("matches every token, and lets different tokens match different columns", () => {
    const subject = row({ code: "KR-102", partner: "Agro Ltd", secret: "zzz" })
    expect(rowMatchesSearch(subject, searchNeedle("kr-102 agro"))).toBe(true)
    expect(rowMatchesSearch(subject, searchNeedle("KR-102 AGRO"))).toBe(true)
    expect(rowMatchesSearch(subject, searchNeedle("kr-102 temir"))).toBe(false)
  })

  it("never reads a column the table is not searching", () => {
    expect(rowMatchesSearch(row({ code: "KR-1", partner: "Agro", secret: "zzz" }), searchNeedle("zzz"))).toBe(false)
  })

  it("matches every row for an empty needle, and treats a nullish value as empty text", () => {
    expect(rowMatchesSearch(row({ code: null, partner: undefined }), searchNeedle("  "))).toBe(true)
    expect(rowMatchesSearch(row({ code: null, partner: undefined }), searchNeedle("a"))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/core/search.test.ts
```

Four new tests fail; the file no longer type-checks either, because `./search` exports neither
`searchNeedle` nor `rowMatchesSearch`. Vitest reports
`SyntaxError: The requested module './search' does not provide an export named 'rowMatchesSearch'`.

- [ ] **Step 3: Implement**

Change `src/core/search.ts`'s first line from

```ts
import { collectColumnFacts, type FilterColumnDefShape, type FilterKindSource } from "./filterKinds"
```

to

```ts
import { constructFilterFn } from "@tanstack/react-table"
import { collectColumnFacts, type FilterColumnDefShape, type FilterKindSource } from "./filterKinds"
```

and append to the end of the file:

```ts
/** The search text with its per-filter work done: lower-cased, split. */
export interface SearchNeedle {
  tokens: string[]
}

/**
 * Split the search text into the tokens a row must satisfy.
 *
 * @param text - Whatever `state.globalFilter` holds.
 * @returns The lower-cased, non-empty tokens.
 */
export function searchNeedle(text: unknown): SearchNeedle {
  return {
    tokens: String(text ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token !== ""),
  }
}

/** One column value as searchable text. */
function valueText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).toLowerCase()
}

/** The leaf columns a table is currently searching. */
interface SearchableTable {
  getAllLeafColumns: () => Array<{ id: string; getCanGlobalFilter: () => boolean }>
}

/** One row plus the table it belongs to: everything the search predicate reads. */
interface SearchableRow {
  table: SearchableTable
  getValue: (columnId: string) => unknown
}

/*
 * The field list, cached against the needle the table resolved it for.
 *
 * Every needle is built before any row is tested — TanStack resolves the
 * filter value up front, once per globally-filterable column — so this
 * computes the list once per searchable column per filtering pass instead of
 * once per row. Keyed on the needle rather than on the table so a stale list
 * can never outlive the pass that built it, and weakly so neither is held
 * alive by the cache.
 */
const fieldsByNeedle = new WeakMap<SearchNeedle, readonly string[]>()

/**
 * Which ids to read off a row.
 *
 * Read from the table rather than closed over, so this list and the table's own
 * `getColumnCanGlobalFilter` can never disagree about which columns are being
 * searched — they are the same answer, asked once.
 */
function searchFieldsFor(needle: SearchNeedle, row: SearchableRow): readonly string[] {
  const cached = fieldsByNeedle.get(needle)
  if (cached !== undefined) return cached
  const fields = row.table
    .getAllLeafColumns()
    .filter((column) => column.getCanGlobalFilter())
    .map((column) => column.id)
  fieldsByNeedle.set(needle, fields)
  return fields
}

/**
 * Whether every token appears somewhere in the searched fields of one row.
 *
 * @param row - The row under test.
 * @param needle - The resolved search text.
 * @returns Whether the row matches.
 */
export function rowMatchesSearch(row: SearchableRow, needle: SearchNeedle): boolean {
  if (needle.tokens.length === 0) return true
  const fields = searchFieldsFor(needle, row)
  const haystack = fields.map((id) => valueText(row.getValue(id)))
  return needle.tokens.every((token) => haystack.some((value) => value.includes(token)))
}

/**
 * The library's global filter function.
 *
 * A **row-level** predicate: the table calls it once per searchable column with
 * that column's id and ORs the results, breaking on the first `true`, so a
 * per-column function could never express "every token must appear somewhere,
 * and different tokens may appear in different columns". This one ignores the
 * column id it is handed and reads every searched field off the row itself,
 * returning the same verdict whichever column it was asked about.
 *
 * Tokenising happens in `resolveFilterValue`, which the table applies ahead of
 * the row loop — once per searchable column — rather than once per row.
 */
export const filterFn_dtSearch = constructFilterFn({
  resolveFilterValue: (text: unknown): SearchNeedle => searchNeedle(text),
  filter: (_dataValue: unknown, needle: SearchNeedle, row) => rowMatchesSearch(row, needle),
})
```

In `src/index.ts`, replace the two search export lines added in Task 7

```ts
export { collectSearchFields, isSearchableColumn } from "./core/search"
export type { SearchFieldsResult } from "./core/search"
```

with

```ts
export {
  collectSearchFields,
  filterFn_dtSearch,
  isSearchableColumn,
  rowMatchesSearch,
  searchNeedle,
} from "./core/search"
export type { SearchFieldsResult, SearchNeedle } from "./core/search"
```

> **Correction (found while implementing Task 8):** `SearchNeedle` joins Task 7's
> existing `export type { SearchFieldsResult } …` line rather than adding a second
> `export type` line for the same module — one value export and one type export per
> module is what the rest of `src/index.ts` does.

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/core/search.test.ts
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must report **350 tests** (346 plus 4).

- [ ] **Step 5: Commit**

```bash
git add src/core/search.ts src/core/search.test.ts src/index.ts
git commit -m "feat(filters): row-level global filter function for quick search"
git push origin khojiakbar
```

---

### Task 9: Compose the filtering features and project the state into them

**Files:**
- Modify: `src/useDataTable.ts`
- Test: `src/ClientFiltering.test.tsx`

The whole of §5.1, §6.1 and §7.1's projection in one commit, because a half-composed table is not a
state worth having: the feature set widens `DataTableFeatures`, which every host column def is
parameterised by, and it should widen **once**. The faceting slots go in now too even though nothing
reads them until the values editors land, for the same reason.

Seven facts each of which is a silent failure rather than a compile error, and which the code below
is arranged around:

1. `globalFilteringFeature` **requires** `columnFilteringFeature` — the compiler says so through
   `FeatureSlotPrereqs`. Quick search cannot ship alone.
2. The bulk `filterFns` export is deprecated for bundle size; one function of ours is registered.
3. Registering `filterFns` narrows the legal `columnDef.filterFn` strings to the keys registered, so
   step 4 below checks that nothing in the repo or the README passes a built-in name.
4. **`columnFilteringFeature` defaults every column to `filterFn: "auto"`**, which resolves a
   built-in *name* through the very registry being narrowed to `{ dt }`. Every lookup would miss,
   `column_getFilterFn` would return `undefined`, and `createFilteredRowModel` would skip that
   filter entirely — every row passing, with one dev-console warning per filtered column and nothing
   else. The fix is `filterFn: "dt"` on the existing `defaultColumn`.
5. **`globalFilterFn` must be stated as our own function** (Task 8), or the `"auto"` default
   short-circuits to a whole-string substring test per column.
6. **`getColumnCanGlobalFilter` must be stated too**, from the same `resolvedSearchFields` that
   becomes `search.fields` on the wire (Task 10), or the client searches hidden and unsearchable
   columns the wire excludes.
7. **`filterFromLeafRows` defaults to `false`**, which for tree data hides a matching child whenever
   its parent fails the filter. This library ships tree data, so it is set from `getSubRows`.
   `maxLeafRowFilterDepth` keeps its default; expansion survives a filter change with no work,
   because it is keyed by row id and `autoResetExpanded: false` is already set.

`state.globalFilter` is deliberately **not** wired here. It has nothing to feed it until Task 10
builds the debounce, and an uncontrolled slice nobody writes stays `undefined`, which is exactly "no
global filter". `enableFilters` / `enableColumnFilters` are deliberately not wired either:
`filtering: false` gates the UI, per Section A, and the mutators stay functional.

- [ ] **Step 1: Write the failing test**

Create `src/ClientFiltering.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/ClientFiltering.test.tsx
pnpm typecheck
```

Vitest reports every test failing, because the instance has none of the APIs the features own:
`TypeError: result.current.table.getColumn(...).getIsFiltered is not a function` on the first case,
and the same shape of error for `getFilterFn`, `getFacetedUniqueValues` and `table.state.columnFilters`.

`pnpm typecheck` reports one error per filtering API the feature set does not have yet. `Column` and
`TableState` are assembled from the composed features, so with `columnFilteringFeature`,
`globalFilteringFeature` and `columnFacetingFeature` still absent, `getIsFiltered`, `getFilterFn`,
`setFilterValue`, `getFacetedUniqueValues` and `table.state.columnFilters` are all "does not exist on
type" — about nine of them, one per call site. Expect that noise, and look past it for the one that
matters:

```
src/ClientFiltering.test.tsx(NN,5): error TS2578: Unused '@ts-expect-error' directive.
```

Step 3 composes the features, and the whole batch of "does not exist" errors goes with it.

**Note what that error is telling you, because the spec gets it slightly wrong.** §7.4 says a
`meta: { filter: … }` with no `columnMeta` slot "is rejected as an unknown property". It is not —
verified against this repo's own tsconfig and TypeScript ~6.0.2: TanStack's global `ColumnMeta` is an
**empty** interface, and TypeScript runs no excess-property check against a target type that declares
no properties, so `meta: { anythingAtAll: 42 }` compiles today and is simply never checked. That
silence is what the slot fixes, and this case is what pins it: after step 3 the directive is used
and the file compiles.

- [ ] **Step 3: Implement**

All in `src/useDataTable.ts`. First the TanStack import block at the top of the file, which becomes:

```ts
import {
  columnFacetingFeature,
  columnFilteringFeature,
  columnOrderingFeature,
  createExpandedRowModel,
  rowExpandingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createCoreRowModel,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnMeta,
  type ColumnSizingState,
  type PaginationState,
  type Row,
  type RowData,
  type Updater,
} from "@tanstack/react-table"
```

Then the local imports. Add `filterFn_dt` above the `collectFilterKinds` line Task 6 left, and the
search module below `./core/query`:

```ts
import { filterFn_dt } from "./core/filterFn"
import { collectFilterKinds } from "./core/filterKinds"
import {
  pruneFilters,
  rebuildCondition,
  type FilterCondition,
  type FilterModel,
  type FilterValueOption,
} from "./core/filters"
import { noLayoutStorage } from "./core/persistence"
import type { TableQuery, TableSearch } from "./core/query"
import { collectSearchFields, filterFn_dtSearch } from "./core/search"
```

and widen the `./types` import from

```ts
import type { DataTableFeatureFlags, LayoutStorage, TableLayout } from "./types"
```

to

```ts
import type {
  DataTableColumnMeta,
  DataTableFeatureFlags,
  LayoutStorage,
  TableLayout,
} from "./types"
```

Now the feature set. In the `tableFeatures({...})` call, insert the three features after
`rowPaginationFeature,`, the three row-model factories after `paginatedRowModel:`, and the two
registries after `sortFns,` — the whole call becomes:

```ts
const FEATURES = tableFeatures({
  columnOrderingFeature,
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  /*
   * `globalFilteringFeature` REQUIRES `columnFilteringFeature` — the compiler
   * says so through `FeatureSlotPrereqs` — so quick search cannot ship alone.
   * The faceting slots are composed here too, though nothing reads them until
   * the values editors land: the feature set is composed once, so
   * `DataTableFeatures` widens once rather than twice.
   */
  columnFilteringFeature,
  globalFilteringFeature,
  columnFacetingFeature,
  coreRowModel: createCoreRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  sortFns,
  /*
   * One registered function, not the deprecated bulk `filterFns` export, which
   * puts every built-in in the bundle. Registering a name also narrows the
   * legal `columnDef.filterFn` strings to the keys here, which is why
   * `defaultColumn` below has to state `filterFn: "dt"`.
   */
  filterFns: { dt: filterFn_dt },
  /*
   * Claims TanStack's per-table `columnMeta` slot, which is what makes
   * `meta: { filter: "number" }` type-checked with no generic reaching the
   * host. The slot REPLACES the global `ColumnMeta` interface rather than
   * extending it, so declaring `DataTableColumnMeta` alone would silently
   * delete the fields of any host who declaration-merges `ColumnMeta` today —
   * their own `meta` key would become an excess-property error. The
   * intersection keeps that merge working.
   *
   * The `any` arguments are deliberate and unavoidable: the slot sits inside
   * the call whose `typeof` *is* `DataTableFeatures`, so naming that type here
   * would be circular.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columnMeta: {} as DataTableColumnMeta & ColumnMeta<any, any, any>,
})
```

Next, three new values in the hook body. They go immediately **after** the `stated` ref block, whose
last two lines are `    totals: isServer,` and `  }`, and immediately **before**
`const table = useTable<DataTableFeatures, TData>({`:

```ts
  /*
   * The one list quick search covers: `searchFields` if the host supplied it,
   * otherwise every visible, searchable, accessor-backed column. It is used
   * twice — as `getColumnCanGlobalFilter` below, and as `search.fields` on the
   * wire — so the client and a backend search the same columns for the same
   * text. `filteringOptions` itself is not a dependency: it is a fresh `{}` per
   * render for the two shorthand forms, and only this member is read.
   */
  const resolvedSearchFields = useMemo(() => {
    if (!filteringEnabled) return []
    const declared = filteringOptions?.searchFields
    if (declared) return [...declared].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const { fields, unresolved } = collectSearchFields(columns, data, layout.columnVisibility)
    // A column with nothing declared and no sampled value yet stays included
    // rather than dropped — see the Task 7 review correction next to
    // `collectSearchFields`'s own definition. Folding `unresolved` into
    // exclusion (treating `collectSearchFields` as returning a bare
    // `string[]`, which is what an earlier draft of this task did) empties
    // `resolvedSearchFields` on a server-mode table's first render, before
    // `data` has arrived, and makes a nullable text column's inclusion depend
    // on which page happens to be loaded.
    return [...fields, ...unresolved].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }, [filteringEnabled, filteringOptions?.searchFields, columns, data, layout.columnVisibility])

  /*
   * `filters` is the first layout slice whose shape is not already TanStack's,
   * so it is the first that cannot be passed straight through.
   *
   * Memoised because `createFilteredRowModel` compares its memo deps by
   * reference and a controlled state slice is read back verbatim: a fresh array
   * per render would re-filter every row on every unrelated host re-render. It
   * runs in server mode too — the filtered row model is inert there, but
   * `column.getIsFiltered()` still reads the slice, and that is what marks a
   * filtered header. `condition.field` is authoritative: this is the only
   * writer of `ColumnFilter.id`, so the two can never disagree.
   *
   * `resolvedSearchFields` is the second dependency, and it is not decoration.
   * `createFilteredRowModel` memoises on exactly three things — the core row
   * model, `columnFilters` and `globalFilter` — while `getColumnCanGlobalFilter`
   * below is a function of the resolved field list. Hiding a column while a
   * search is active changes which columns are searched and changes none of
   * those three, so without this the filtered row model would not recompute:
   * the client would go on matching a hidden column that `search.fields` on the
   * wire had already dropped, which is the exact divergence §3.3 states the
   * predicate to prevent. The list is itself memoised, so an unrelated
   * re-render still gets the same array back and the identity holds.
   */
  const columnFilters = useMemo<ColumnFiltersState>(
    () => layout.filters.map((condition) => ({ id: condition.field, value: condition })),
    [layout.filters, resolvedSearchFields],
  )

  /*
   * `column.setFilterValue(condition)` keeps working for a host driving the
   * table through TanStack's own API: the value *is* the condition, so the
   * entries map straight back to conditions — through `rebuildCondition`, the
   * same validation `setModel` runs, since this input is no more trusted.
   * Left unwired, the default updater would write to an atom that the
   * controlled `state.columnFilters` overrides, and `setFilterValue` would
   * silently do nothing.
   */
  const updateFiltersFromTanStack = useCallback(
    (updater: Updater<ColumnFiltersState>) => {
      updateFilters((current) => {
        const before: ColumnFiltersState = current.map((condition) => ({
          id: condition.field,
          value: condition,
        }))
        return apply(updater, before).flatMap((entry) => {
          const value = entry.value as FilterCondition
          if (typeof value !== "object" || value === null) return []
          const built = rebuildCondition({ ...value, field: entry.id })
          return built === null ? [] : [built]
        })
      })
    },
    [updateFilters],
  )
```

Now the `useTable` options. In `state`, add the projection under `sorting`:

```ts
    state: {
      columnOrder: layout.columnOrder,
      columnVisibility: layout.columnVisibility,
      columnPinning: layout.columnPinning,
      columnSizing: layout.columnSizing,
      sorting: layout.sorting,
      columnFilters,
      pagination: { pageIndex: pageState.pageIndex, pageSize: pageState.pageSize },
      expanded,
    },
```

Replace the single line `manualSorting: isServer,` (the one directly above
`manualPagination: isServer || paginationOptions === null,`) with:

```ts
    manualSorting: isServer,
    /*
     * Written unconditionally on every render, as a plain boolean, so the
     * option merge can never carry a stale value — it needs no `mergeOptions`
     * branch, which exists only for the four options this hook *omits*.
     *
     * It turns off the filtered row model, not the filter state:
     * `column.getIsFiltered()` reads `state.columnFilters` directly and keeps
     * working, which is what drives the header marker in server mode.
     */
    manualFiltering: isServer,
    /*
     * Defaults to false, which for tree data hides a matching child whenever
     * its parent fails the filter — a filtered tree would show nothing for a
     * term only leaves contain. Expansion survives a filter change with no
     * work: it is keyed by row id and `autoResetExpanded: false` is already set.
     */
    filterFromLeafRows: getSubRows !== undefined,
    /*
     * Stated, because the default is `"auto"` — one whole-string substring test
     * applied once per searchable column with that column's id, ORed with a
     * break on the first true. That cannot express "tokens may match different
     * columns": searching `KR-102 agro` would look for the literal string
     * inside one column at a time. Ours is a row-level predicate that ignores
     * the column id it is handed, so TanStack's own OR and break are harmless.
     */
    globalFilterFn: filterFn_dtSearch,
    /*
     * Stated too. TanStack's own default applies a value-type heuristic as a
     * gate *underneath* the flags rather than as a default a host can override,
     * and never consults visibility at all — so without this a hidden column
     * would go on being searched client-side while `search.fields` omitted it,
     * and the two modes would search different columns for the same text.
     */
    getColumnCanGlobalFilter: (column) => resolvedSearchFields.includes(column.id),
```

Add the registered name to `defaultColumn`, which becomes:

```ts
    defaultColumn: {
      size: defaultColumnWidth,
      minSize: minColumnWidth,
      maxSize: maxColumnWidth,
      /*
       * `columnFilteringFeature` defaults every column to `filterFn: "auto"`,
       * which resolves a built-in *name* through the very registry narrowed to
       * `{ dt }` above. Every lookup would miss, `column_getFilterFn` would
       * return undefined, and `createFilteredRowModel` would skip that filter
       * entirely — every row passing, with one dev-console warning and nothing
       * else. TanStack merges the feature default first, then this, then a
       * host's own column def, so this sets the default without taking the
       * escape hatch away.
       */
      filterFn: "dt",
    },
```

and finally, change the last line of the options object from

```ts
    onSortingChange: updateSorting,
  })
```

to

```ts
    onSortingChange: updateSorting,
    onColumnFiltersChange: updateFiltersFromTanStack,
  })
```

- [ ] **Step 4: Run the checks, and audit the filterFn names**

Registering `filterFns: { dt }` narrows the legal `columnDef.filterFn` strings to `"dt"` and `"auto"`
alone. Nothing in this repo passes one today, and this is the moment to be sure of that rather than
to assume it — a built-in name like `filterFn: "includesString"` now fails to compile, and one in the
README would be advice that does not work:

```bash
rg -n "filterFn" src README.md --glob '!src/core/filterFn.ts' --glob '!src/core/search.ts'
```

Every hit must be in `src/useDataTable.ts`, `src/index.ts`, `src/core/filterFn.test.ts` or
`src/ClientFiltering.test.tsx`. If a hit is a built-in name on a column def, change it to `"dt"`; if
it is in the README, rewrite the example.

```bash
pnpm vitest run src/ClientFiltering.test.tsx
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must report **9 more tests than the count at HEAD before this task**. Every earlier test
must still pass: composing the features widens `DataTableFeatures`, and a break there would show up
in `DataTable.test.tsx` and `ServerMode.test.tsx` first.

**Read every absolute total in this plan as a delta, not an equality.** The chain's numbers were
written against the original task chain; the review rounds on Tasks 1-8 added regression tests the
chain never counted, so the real totals run ahead of the printed ones — this task ran 404 → 413
where the plan says 350 → 359, an offset of +54 that every later task inherits. Count before, count
after, and check the difference.

- [ ] **Step 5: Commit**

```bash
git add src/useDataTable.ts src/ClientFiltering.test.tsx
git commit -m "feat(filters): compose the TanStack filtering features and project filter state"
git push origin khojiakbar
```

---

### Task 10: Debounce the published value, not the keystroke

**Files:**
- Create: `src/core/useDebouncedValue.ts`
- Modify: `src/useDataTable.ts`
- Modify: `src/index.ts`
- Modify: `README.md`
- Modify: `src/ClientFiltering.test.tsx` (Task 9's "recomputes the filtered rows when the column a
  global filter matched is hidden" drives the table through `table.setGlobalFilter`, which this task
  routes into `layout.search`; its assertion now has to wait out the debounce)
- Test: `src/SearchState.test.tsx`

`useTableQuery` re-announces in an effect on every committed change to the query object, so a search
box wired straight through would fire one fetch per keystroke.

The debounce goes **downstream of the layout slice, not between the editor and it**. `layout.search`
holds the raw text and is written on every keystroke — cheap, and the input stays a normal controlled
field, trailing space and all. What waits is `state.globalFilter` and `search` on the wire. Ten
keystrokes then produce ten renders that change nothing the row model memoises on, and one query.

That placement is what makes the flush question disappear. A debounce that withheld the text from
state would have to flush on `pagehide`, and its flush is a React state update: `useDebouncedSave`'s
own `pagehide` handler runs in the same tick against the layout it already holds, so the last typed
word could not reach storage however the two listeners were ordered. With the text already in state,
the existing 350 ms save and its `pagehide` flush persist it with no new machinery.

Both `state.globalFilter` and the wire receive `text.trim()`. Without the trim the two modes disagree
about whitespace: `createFilteredRowModel` treats `" "` as a live global filter and would run a
substring search for a space, while a wire carrying `null` would have the server return everything.

Two things to be clear about, because the spec's wording invites a different reading:

- §6.2 lists "the page reset" among the things downstream of the debounce, but §7.3 and Task 6 put it
  in `updateSearch` itself, next to the slice write, and `FilterState.test.tsx` pins it there
  (`setSearch("kr 102 ")` leaves `pageIndex` at 0 immediately). Keep it there. The reset is
  idempotent, so a burst of keystrokes still produces **one** query; only the very first keystroke of
  a burst started away from page 1 produces a second, and paying for that once is better than
  deferring a reset by 300 ms or contradicting a committed test.
- Everything that writes `layout.search` is debounced, `clearAll()` included, so the no-matches
  exit added later takes `debounceMs` to restore the rows. That is a uniform rule rather than a
  special case, and it is what keeps `state.globalFilter` a pure function of the slice.

`state.globalFilter` becomes controlled here, which is exactly when `onGlobalFilterChange` has to be
wired: without it `table.setGlobalFilter()` writes to an atom that the controlled value overrides and
silently does nothing — the same trap §5.1 calls out for `column.setFilterValue()`.

- [ ] **Step 1: Write the failing test**

Create `src/SearchState.test.tsx`:

```tsx
import { createColumnHelper } from "@tanstack/react-table"
import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
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
      id, columns, data, mode: "server", rowCount: 3, getRowId: (row) => row.id, onQueryChange,
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
        id: "q6", columns, data, getRowId: (row) => row.id,
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

  it("publishes nothing to search when no column is searchable", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useDataTable<Row>({
        id: "q8", columns, data, getRowId: (row) => row.id,
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
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/SearchState.test.tsx
```

Seven of the nine fail. The first reports `expected "spy" to be called 1 times, but got 0 times`:
`search` on the wire is still the `NO_SEARCH` placeholder, so no query changes at all. The client
cases report three rows where one was expected, because nothing feeds `state.globalFilter`. The two
that pass — "counts a whitespace-only search as no search on the wire" and "publishes nothing to
search when no column is searchable" — pass for the wrong reason: both assert a `null` `search` and
an unfiltered table, which is what the placeholder gives them for free.

- [ ] **Step 3: Implement**

Create `src/core/useDebouncedValue.ts`:

```ts
import { useEffect, useState } from "react"

/**
 * A value as it settles, rather than as it changes.
 *
 * Used for quick search, where the raw text belongs in state on the keystroke —
 * so the input stays a normal controlled field and the existing layout save
 * persists it — while everything downstream of it waits: `state.globalFilter`
 * and `search` on the wire. That placement is also why this needs no `pagehide`
 * flush of its own: nothing is being withheld from state that could be lost.
 *
 * The first value is published immediately, so a table restored from storage
 * with a search term does not start unfiltered for `delayMs`.
 *
 * @param value - The value to follow.
 * @param delayMs - How long the value must hold still before it is published.
 * @returns The last value that held still for `delayMs`, and the first one immediately.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    // A value that returns to the settled one mid-flight cancels the wait
    // rather than republishing what is already published.
    if (Object.is(value, settled)) return
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, settled, delayMs])

  return settled
}
```

In `src/useDataTable.ts`, add the hook to the local imports, between `useArrangement` and
`useIsomorphicLayoutEffect`:

```ts
import { apply, useArrangement } from "./core/useArrangement"
import { useDebouncedValue } from "./core/useDebouncedValue"
import { useIsomorphicLayoutEffect } from "./core/useIsomorphicLayoutEffect"
```

Delete the `NO_SEARCH` placeholder and its JSDoc that Task 4 added after
`export type TableMode = "client" | "server"`, and put the debounce default in its place:

```ts
/** How long quick search waits before it is published. */
const DEFAULT_SEARCH_DEBOUNCE_MS = 300
```

In the hook body, insert the debounced value and the wire's `search` between `resolvedSearchFields`
and the `columnFilters` projection added in Task 9:

```ts
  /*
   * `layout.search` holds the raw text and is written on every keystroke, which
   * keeps the input a normal controlled field. What is debounced is everything
   * downstream: `state.globalFilter`, and `search` on the wire. Ten keystrokes
   * then produce ten renders that change nothing the row model memoises on, and
   * one query.
   *
   * Both sides get `text.trim()`: `createFilteredRowModel` treats `" "` as a
   * live global filter and would search for a space, while a wire carrying
   * `null` would have the server return everything.
   */
  const searchText = useDebouncedValue(
    layout.search.trim(),
    filteringOptions?.debounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS,
  )
  // An empty field list means search is off: the client has nothing to match
  // against, so the wire carries `null` rather than a term no backend could honour.
  const search = useMemo<TableSearch | null>(
    () =>
      searchText === "" || resolvedSearchFields.length === 0
        ? null
        : { text: searchText, fields: resolvedSearchFields },
    [searchText, resolvedSearchFields],
  )
```

In the `useTable` options' `state`, add the controlled slice under `columnFilters`:

```ts
      sorting: layout.sorting,
      columnFilters,
      globalFilter: searchText,
      pagination: { pageIndex: pageState.pageIndex, pageSize: pageState.pageSize },
```

and at the end of the same options object, after the `onColumnFiltersChange` line Task 9 added:

```ts
    onColumnFiltersChange: updateFiltersFromTanStack,
    /*
     * `state.globalFilter` is controlled from `layout.search`, so TanStack's
     * default updater would write to an atom the controlled value overrides,
     * and `table.setGlobalFilter()` would silently do nothing — the same trap
     * `onColumnFiltersChange` avoids for `column.setFilterValue()`.
     */
    onGlobalFilterChange: (updater: Updater<string>) => updateSearch(apply(updater, layout.search)),
  })
```

Finally, change the `useTableQuery` call's `search` line from `search: NO_SEARCH,` to `search,`:

```ts
  const query = useTableQuery({
    sorting: layout.sorting,
    filters: layout.filters,
    search,
    pageIndex: pageState.pageIndex,
    pageSize: pageState.pageSize,
    onQueryChange,
  })
```

In `src/index.ts`, add the hook beside the other borrowable helpers — immediately after the
`export type { SearchFieldsResult, SearchNeedle } from "./core/search"` line Task 8 left behind:

```ts
export { useDebouncedValue } from "./core/useDebouncedValue"
```

In `README.md`, append this to the end of the **Filters on the wire** subsection Task 4 created,
after its closing paragraph about building conditions with the exported constructors. That subsection
already states the search *semantics* and the unindexed-column risk; what is missing is where
`fields` comes from and when the value is published:

```markdown
**Which columns `fields` holds** is every visible, accessor-backed column whose
`meta.searchable` resolves true. The default for `meta.searchable` is "the
column's first non-null value is a string or a number", so a numeric column is
searched too — mark anything unindexed or sensitive `meta: { searchable: false }`.
Hiding a column narrows the search, which is surprising either way and is why
`filtering.searchFields` overrides the list outright. `search` is `null` when
the box is empty, when it holds only whitespace, and when no column is
searchable at all — the client has nothing to match against either, so both
modes return everything.

**The published value is debounced**, by `filtering.debounceMs` (default
300 ms). The box itself stays responsive: the raw text is in state on the
keystroke, and what waits is the query. Column filters are never debounced —
they commit on Apply, Enter or blur.
```

One test from Task 9 changes meaning here and has to follow. `ClientFiltering.test.tsx`'s
"recomputes the filtered rows when the column a global filter matched is hidden" calls
`table.setGlobalFilter("temir")` and asserts the filtered rows on the very next line. That worked
while `state.globalFilter` was TanStack's own uncontrolled atom; now the call writes `layout.search`
and `state.globalFilter` follows a debounce later, so the row model has nothing to recompute until
the wait is over and the table still holds all three rows. Add `afterEach(() => vi.useRealTimers())`
beside the file's `describe`, import `afterEach` and `vi`, and fake the timers in that one test:

```tsx
    vi.useFakeTimers()
    const { result } = setup("c10")
    act(() => result.current.table.setGlobalFilter("temir"))
    act(() => vi.advanceTimersByTime(300))
    expect(result.current.table.getRowModel().rows.map((row) => row.id)).toEqual(["r1"])
```

The rest of the test is unchanged: hiding the column does not touch `layout.search`, so the
`resolvedSearchFields` dependency still makes the row model recompute in the same tick.

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/SearchState.test.tsx
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must report **nine tests more than it did before this task**, and no file other than
`SearchState.test.tsx` may gain or lose one. The absolute totals written into this plan are stale —
the review rounds after Tasks 1-9 added regression tests the original chain did not count — so take
the count before the task and compare. It was **427 tests across 34 files** when this task landed
(418 across 33 before it).

- [ ] **Step 5: Commit**

```bash
git add src/core/useDebouncedValue.ts src/useDataTable.ts src/index.ts src/SearchState.test.tsx \
  src/ClientFiltering.test.tsx README.md
git commit -m "feat(filters): publish quick search on a debounce"
git push origin khojiakbar
```

---

### Task 11: The labels batch

**Files:**
- Modify: `src/types.ts`
- Modify: `src/components/DataTable.tsx`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Test: `src/PublicExports.test.tsx`

Every new string this stage needs, in one commit, **before** any of the UI that consumes it. New
required keys on `DataTableLabels` are a source break for a host who hand-builds a full labels object
rather than spreading `defaultLabels` — `TablePagination` and `TableStatus` take the whole
`DataTableLabels`, and `PublicExports.test.tsx` pins the `{ ...defaultLabels, ...mine }` recipe. That
break wants to happen once, with one changelog note, not once per UI step.

Tasks 12 and everything in §13 steps 7–10 consume these and add none.

The operator names are **flat keys rather than a nested `operators` object**, which the spec leaves
open. A nested object would make `labels={{ operators: { contains: "…" } }}` either a type error or,
under a `Partial`, a silent drop of the other twenty-two — and the whole library documents exactly
one override recipe. Flat keys keep that recipe uniform.

- [ ] **Step 1: Write the failing test**

Append to `src/PublicExports.test.tsx`:

```tsx
describe("the filtering labels batch", () => {
  it("fills in every new key through the README's `{ ...defaultLabels, ...mine }` recipe", () => {
    // New required keys are a source break for a host that hand-builds a full
    // labels object rather than spreading `defaultLabels`, so the whole batch
    // lands at once and the break happens once.
    const mine = { noMatches: "Mos keladigan qator yo'q" }
    const labels: publicApi.DataTableLabels = { ...publicApi.defaultLabels, ...mine }

    expect(labels.noMatches).toBe("Mos keladigan qator yo'q")
    expect(labels.filterInPanel).toBe("Filter in panel…")
    expect(labels.opNotBlank).toBe("Is not blank")
    expect(labels.opDateBetween).toBe("Between")
    expect(labels.searchResults(3)).toBe("3 matching rows")
    expect(labels.searchResults(undefined)).toBe("Searching")
    expect(labels.filterTitle("Amount")).toBe("Filter Amount")
  })

  it("leaves no default blank", () => {
    for (const [key, value] of Object.entries(publicApi.defaultLabels)) {
      expect(typeof value === "function" || value !== "", `${key} is blank`).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/PublicExports.test.tsx
```

It does not compile: `Property 'noMatches' does not exist on type 'DataTableLabels'`, and the same
for `filterInPanel`, `opNotBlank`, `opDateBetween`, `searchResults` and `filterTitle`.

- [ ] **Step 3: Implement**

In `src/types.ts`, replace the tail of `DataTableLabels` — the three lines

```ts
  loading: string
  loadFailed: string
  retry: string
}
```

with:

```ts
  loading: string
  loadFailed: string
  retry: string

  /* Quick search. */
  /** Placeholder in the toolbar's search box. */
  search: string
  /** Accessible name of the search box; a placeholder is not a label. */
  searchLabel: string
  /** Empties the search box. */
  clearSearch: string
  /** Announced politely once a search settles; `count` is undefined while a server has not answered. */
  searchResults: (count: number | undefined) => string

  /* The column filter editor. */
  /** Header-menu item that opens the filter editor in a popover. */
  filter: string
  /** Header-menu item that opens the side panel's Filters tab on this column. */
  filterInPanel: string
  /** Accessible name of the filter popover, named after its column. */
  filterTitle: (column: string) => string
  /** Badge on an already-filtered column, as a state and not an action. */
  filteredBadge: string
  /** Commits the editor's draft. */
  apply: string
  /** Removes this column's condition. */
  clearFilter: string
  /** Accessible name of the operator select. */
  operator: string
  /** Accessible name of the single value field. */
  filterValue: string
  /** Accessible name of a range's lower end. */
  rangeFrom: string
  /** Accessible name of a range's upper end. */
  rangeTo: string

  /* Operator names. Flat, so `{ ...defaultLabels, ...mine }` overrides one of
     them the same way it overrides every other label. */
  opContains: string
  opNotContains: string
  opEquals: string
  opNotEquals: string
  opStartsWith: string
  opEndsWith: string
  opEq: string
  opNe: string
  opLt: string
  opLte: string
  opGt: string
  opGte: string
  opBetween: string
  /** The date editor's four modes; all four become one half-open range. */
  opDateIs: string
  opDateBefore: string
  opDateAfter: string
  opDateBetween: string
  opIsTrue: string
  opIsFalse: string
  opIn: string
  opNotIn: string
  /** Blankness is an operator on every kind, including a values list. */
  opBlank: string
  opNotBlank: string

  /* Values lists. */
  /** Search box inside a values list. */
  searchValues: string
  /** Ticks or unticks every choice at once. */
  selectAll: string
  /** The choice standing for a blank value, which is an operator and not a value. */
  blanks: string
  /** Shown when a column has no source of choices at all. */
  noValues: string
  /** Shown when a values request failed; its retry reuses `retry`. */
  valuesFailed: string

  /* The side panel's Filters tab. */
  filtersTab: string
  /** Marks a filtered column that is currently hidden. */
  hiddenColumn: string
  /** Shown in the Filters tab while nothing is filtered. */
  noFilters: string
  /** Clears every column filter and the search at once, from the panel. */
  clearAllFilters: string

  /* The filtered-empty state. */
  /** Shown instead of `empty` when a filter excluded every row. */
  noMatches: string
  /** The way out of the filtered-empty state. */
  clearFilters: string
}
```

There is deliberately no `columnsTab`: the Columns tab reuses the existing `columnsTitle`, which is
already "Columns", and `ColumnPanel`'s public props stay intact.

In `src/components/DataTable.tsx`, replace the last two entries of `defaultLabels`

```ts
  loadFailed: "Could not load rows",
  retry: "Retry",
}
```

with:

```ts
  loadFailed: "Could not load rows",
  retry: "Retry",
  search: "Search",
  searchLabel: "Search rows",
  clearSearch: "Clear search",
  searchResults: (count) => (count === undefined ? "Searching" : `${count} matching rows`),
  filter: "Filter…",
  filterInPanel: "Filter in panel…",
  filterTitle: (column) => `Filter ${column}`,
  filteredBadge: "Filtered",
  apply: "Apply",
  clearFilter: "Clear filter",
  operator: "Operator",
  filterValue: "Value",
  rangeFrom: "From",
  rangeTo: "To",
  opContains: "Contains",
  opNotContains: "Does not contain",
  opEquals: "Equals",
  opNotEquals: "Does not equal",
  opStartsWith: "Starts with",
  opEndsWith: "Ends with",
  opEq: "Equals",
  opNe: "Does not equal",
  opLt: "Less than",
  opLte: "Less than or equal",
  opGt: "Greater than",
  opGte: "Greater than or equal",
  opBetween: "Between",
  opDateIs: "Is",
  opDateBefore: "Before",
  opDateAfter: "After",
  opDateBetween: "Between",
  opIsTrue: "True",
  opIsFalse: "False",
  opIn: "Is any of",
  opNotIn: "Is none of",
  opBlank: "Is blank",
  opNotBlank: "Is not blank",
  searchValues: "Search values",
  selectAll: "Select all",
  blanks: "(Blanks)",
  noValues: "No values to choose from",
  valuesFailed: "Could not load values",
  filtersTab: "Filters",
  hiddenColumn: "Hidden",
  noFilters: "No filters applied",
  clearAllFilters: "Clear all filters",
  noMatches: "No rows match the current filters",
  clearFilters: "Clear filters",
}
```

The number operators are spelled out in words rather than as `=`, `≠`, `<`, `≤` — a screen reader
reads a mathematical symbol inconsistently across engines, and these are the accessible names of
`<option>`s.

In `CHANGELOG.md`, add these lines to the existing `## 0.5.0` section's **Breaking** list, below the
`TableQuery` rename note Task 4 wrote — the same section, not a new one:

```markdown
- `DataTableLabels` gains 48 required keys for filtering: the quick-search box,
  the filter editor and its operator names, values lists, the Filters tab and
  the filtered-empty state. Hosts using the documented
  `{ ...defaultLabels, ...mine }` recipe are unaffected; a host hand-building a
  complete labels object has to add them. Operator names are flat keys
  (`opContains`, `opBetween`, …) rather than a nested object, so overriding one
  of them works the same way as overriding any other label.
```

In `README.md`, append to the `<TablePagination instance={instance} labels={…} />` paragraph in the
exported-parts list — the one ending "so spread `defaultLabels`, exported alongside it, over your own
overrides.":

```markdown
Filtering adds a large batch of keys — operator names, editor labels, the
search placeholder, the tab names, the clear actions and the no-matches copy.
Spread `defaultLabels` and override what you need; building the object by hand
means adding every new key on each minor release.
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/PublicExports.test.tsx
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must report **370 tests** (368 plus 2).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/components/DataTable.tsx src/PublicExports.test.tsx CHANGELOG.md README.md
git commit -m "feat(filters): add every filtering label in one batch"
git push origin khojiakbar
```

---

### Task 12: The toolbar search box

**Files:**
- Create: `src/components/QuickSearch.tsx`
- Modify: `src/components/DataTable.tsx`
- Modify: `src/styles.css`
- Modify: `src/index.ts`
- Modify: `README.md`
- Test: `src/QuickSearch.test.tsx`

A single input in the toolbar, immediately **before the existing spacer**, so it sits left of the
Columns button. It gets its own gate — `instance.filtering.enabled`, not the Columns button's
`flags.hiding || flags.pinning` — and is exported as `QuickSearch` for hosts that render
`toolbar={false}` and build their own shell.

It carries a clear affordance while non-empty, announces its result count to assistive technology
politely, and never steals focus. Styling is by adding `.dt-search` to the existing
`.dt-select, .dt-page-input` rules; **no new `--dt-*` tokens**, so `themes.test.ts`'s hard-coded count
of 25 base tokens is untouched.

One CSS trap worth naming, because the fix is invisible once it is right: `.dt-search` shares the
field styling with `.dt-select` and `.dt-page-input`, whose rule sets `padding-inline: 6px`. The
search box needs room at its trailing edge for the clear button, and the two selectors have the same
specificity — so the override must come **after** the shared rule in source order, and must restate
the whole `padding-inline` rather than only its trailing half. This is deliberately not pinned by a
cascade test: jsdom does not expand `padding-inline` into the logical longhands `getComputedStyle`
reports, so such a test passes whichever order the rules are in (verified by writing it, moving the
rule above the shared one, and watching it go on passing).

- [ ] **Step 1: Write the failing test**

Create `src/QuickSearch.test.tsx`:

```tsx
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

    act(() => vi.advanceTimersByTime(300))
    expect(screen.queryByText("Agro Ltd")).not.toBeInTheDocument()
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("1 matching rows")
    expect(status).toHaveAttribute("aria-live", "polite")
  })

  it("sits before the spacer, so it is left of the Columns button", () => {
    const { container } = render(<Table />)
    const toolbar = container.querySelector(".dt-toolbar")!
    const classes = Array.from(toolbar.children).map((child) => child.className)

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

  it("renders no search box when filtering is off", () => {
    render(<Table filtering={false} />)
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
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/QuickSearch.test.tsx
```

It fails to resolve `./components/QuickSearch` — the file does not exist — so every test fails at
import.

- [ ] **Step 3: Implement**

Create `src/components/QuickSearch.tsx`:

```tsx
import type { RowData } from "@tanstack/react-table"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

interface QuickSearchProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
}

/**
 * The toolbar's search box.
 *
 * A plain controlled input over `instance.filtering.search`, which holds the
 * raw text: what is debounced is everything downstream of it, so the field
 * keeps trailing spaces and a half-typed word the way any other input does.
 *
 * Exported for a shell of its own — a host rendering `toolbar={false}` can put
 * it wherever its own controls live.
 */
export function QuickSearch<TData extends RowData>({ instance, labels }: QuickSearchProps<TData>) {
  const { filtering, pagination, table } = instance
  const active = filtering.search.trim() !== ""
  /*
   * The count as the user would count it: every matching row, not the page.
   * `pagination.rowCount` is that total when paging is on (and undefined in
   * server mode until the host answers); with paging off the row model already
   * holds every row that matched.
   */
  const matches = pagination.enabled ? pagination.rowCount : table.getRowModel().rows.length

  return (
    <div className="dt-search-box">
      <input
        type="search"
        className="dt-search"
        value={filtering.search}
        placeholder={labels.search}
        aria-label={labels.searchLabel}
        onChange={(event) => filtering.setSearch(event.target.value)}
      />
      {active ? (
        <button
          type="button"
          className="dt-search-clear"
          aria-label={labels.clearSearch}
          title={labels.clearSearch}
          onClick={() => filtering.setSearch("")}
        >
          ×
        </button>
      ) : null}
      {/*
        Polite, and only while a search is active: the count lands after the
        debounce settles, so a screen reader hears one result count per search
        rather than one per keystroke. It never moves focus.
      */}
      <span className="dt-sr-only" role="status" aria-live="polite">
        {active ? labels.searchResults(matches) : ""}
      </span>
    </div>
  )
}
```

In `src/components/DataTable.tsx`, add the import beneath the `ColumnPanel` one:

```tsx
import { ColumnPanel } from "./ColumnPanel"
import { QuickSearch } from "./QuickSearch"
```

and render it in the toolbar, before the spacer — change

```tsx
        <div className="dt-toolbar">
          {toolbarContent}
          <span className="dt-spacer" />
```

to

```tsx
        <div className="dt-toolbar">
          {toolbarContent}
          {instance.filtering.enabled ? <QuickSearch instance={instance} labels={labels} /> : null}
          <span className="dt-spacer" />
```

In `src/styles.css`, add the box, the clear button and the visually-hidden helper to the toolbar
section — immediately after the existing `.dt-spacer` rule and before `.dt-menu-button`:

```css
.dt-search-box {
  position: relative;
  display: inline-flex;
  align-items: center;
}

/*
 * WebKit renders its own clear affordance inside a `type="search"` field. It
 * is unlabelled and invisible to a screen reader, so it is hidden in favour of
 * the real button beside it rather than shown twice.
 */
.dt-search::-webkit-search-cancel-button {
  appearance: none;
}

.dt-search-clear {
  position: absolute;
  inset-inline-end: 2px;
  /* WCAG 2.2 AA 2.5.8 asks for 24x24 CSS px, which is also what fits inside a
     28px-tall field without crowding its text. */
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--dt-muted-fg);
  font: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.dt-search-clear:hover {
  color: var(--dt-fg);
  background: var(--dt-row-hover);
}

/*
 * Announced but not drawn. Not `display: none` and not `visibility: hidden`,
 * either of which takes the text out of the accessibility tree entirely.
 */
.dt-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

Join the shared field rule further down the file — change

```css
.dt-select,
.dt-page-input {
  height: 28px;
```

to

```css
.dt-select,
.dt-page-input,
.dt-search {
  height: 28px;
```

and add the size override **after** it, immediately below the `.dt-page-input { width: 4em; … }` rule
that follows:

```css
/*
 * After the shared rule above, never before it: the two selectors have the same
 * specificity, so source order decides, and the whole `padding-inline` is
 * restated rather than only its trailing half — a lone `padding-inline-end`
 * here would be a partial override of a shorthand, which is the kind of thing
 * that survives review and then breaks silently when a rule moves.
 *
 * Deliberately not pinned by a cascade test: jsdom does not expand
 * `padding-inline` into the logical longhands `getComputedStyle` reports, so
 * the assertion passes whichever order the rules are in (verified by moving
 * this rule above the shared one and watching the test go on passing).
 */
.dt-search {
  width: 14em;
  /* 6px is the shared rule's own padding; 26px leaves room for the clear button. */
  padding-inline: 6px 26px;
}
```

and add both new controls to the focus-ring rule — change

```css
.dt-select:focus-visible,
.dt-page-input:focus-visible,
.dt-icon-button:focus-visible {
```

to

```css
.dt-select:focus-visible,
.dt-page-input:focus-visible,
.dt-search:focus-visible,
.dt-search-clear:focus-visible,
.dt-icon-button:focus-visible {
```

In `src/index.ts`, add the component beside the other exported shell parts, after the `ColumnPanel`
line:

```ts
export { ColumnPanel } from "./components/ColumnPanel"
export { QuickSearch } from "./components/QuickSearch"
```

In `README.md`, add a paragraph to the exported-parts list, immediately after the
`<TableStatus …>` / `<SkeletonRows …>` paragraph that ends "rather than rebuilding the same
four-state contract against undocumented class names.":

```markdown
`<QuickSearch instance={instance} labels={{ ...defaultLabels, ...myLabels }} />` — the
toolbar's search box on its own, for a shell that renders `toolbar={false}`. Like
the footer it takes the full `DataTableLabels` rather than a `Partial`. It writes
straight to `instance.filtering.setSearch`, so the debounce, the result-count
announcement and the page reset come with it.
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/QuickSearch.test.tsx src/themes/themes.test.ts src/StylesCascade.test.ts
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must report **376 tests** (370 plus 6). `themes.test.ts` must pass untouched — its
"finds the base tokens" case asserts a hard-coded 25 distinct `--dt-*` tokens, and it fails under
that name, with no hint that a new token is the cause, if one was added.

- [ ] **Step 5: Commit**

```bash
git add src/components/QuickSearch.tsx src/components/DataTable.tsx src/styles.css src/index.ts src/QuickSearch.test.tsx README.md
git commit -m "feat(filters): quick search box in the toolbar"
git push origin khojiakbar
```

---

## Where the next section picks up

Filtering works end to end without a single filter editor: conditions set through
`instance.filtering` narrow rows client-side, ride the wire in server mode, mark their headers
through `getIsFiltered()` in both, and quick search runs from the toolbar. What is missing is every
surface that lets a user *build* a condition.

Step 7 of §13 adds the column filter popover and its header-menu item (§8.2) — a `role="menu"` item
labelled with `labels.filter` that opens a **separate** popover, because form controls under
`role="menu"` are invalid ARIA, the menu closes on any item click, Escape would be ambiguous, the
menu autofocuses its first button, and `useClampedPlacement` measures once per open and cannot
correct a menu that grows afterwards. A second item, `labels.filterInPanel`, sits beside it for
§8.3's other route into the same editor; step 8 is what wires it, because it needs a panel that
knows about tabs. Step 8 adds the `TablePanel` shell and the Filters tab (§8.3),
which lists every column where `column.getCanFilter()` is true, **hidden columns included**. Step 9
adds the values editors, which read `getFacetedUniqueValues()` — already composed here, and already
narrowed by the other columns' filters through `getFacetedRowModel()` — coercing each facet key to a
`FilterValue` before it can become a condition, and `loadValues` in server mode. Step 10 adds the
no-matches state (§8.4) on `labels.noMatches` and `labels.clearFilters`.

All four consume the labels Task 11 shipped and add none. None of them needs a new `--dt-*` token
except the popover's own z-index, which is a number in `styles.css` beside the panel's 10 and the
menu's 20, not a token.
## Section C — the filter surfaces: Tasks 13 to 19 (§13 steps 7–11)

> **Labels.** Every string these tasks render comes from the batch Task 11 shipped. Nothing here
> invents a key, and nothing here adds one. Three keys are used for a purpose slightly wider than
> their JSDoc, and each is called out where it happens: `labels.noFilters` also covers "this table
> has no filterable columns at all" (the only honest existing string for it), `labels.noValues`
> covers a list column with no source of choices in either mode, and `labels.columnsTitle` /
> `labels.filtersTab` double as the two tab names *and* as the panel dialog's accessible name. If
> you would rather they were separate keys, add them in Task 11 — not here, where a new required
> key would be a second source break in the same release.
>
> **No new `--dt-*` tokens.** Everything below is drawn with the existing ones. `themes.test.ts`
> asserts a hard-coded 25 distinct tokens, under the name "finds the base tokens", which gives no
> hint that a new token is the cause — so if you find yourself wanting one, stop and re-read §10.
>
> **Branch.** All work happens on the existing `khojiakbar` branch. Never check out, commit to, or
> merge into `main`. Every task below ends in a commit and a push to `origin/khojiakbar`.

---

### Task 13: One clamp, and it re-measures

**Files:**
- Create: `src/core/useClampedPlacement.ts`
- Modify: `src/components/HeaderMenu.tsx`
- Modify: `src/index.ts`
- Test: `src/core/useClampedPlacement.test.tsx`

The filter popover needs the same "keep it inside the window" arithmetic the header menu already
has, and it needs one thing the menu never did: a **re-measure**. `useClampedPlacement` measures
once, in a layout effect, and a popover changes height the moment its operator changes — switching
from "Contains" to "Between" adds a whole field. A menu that grows after its own layout effect has
run is exactly why §8.2 refuses to put form controls inside the `role="menu"` menu; the popover is
allowed to grow *because* this hook learns to notice.

The hook also gains an optional `measure`. That is not gold-plating: jsdom lays nothing out and
reports every rect as zeros, so a re-clamp against a taller element is indistinguishable from no
clamp at all, and the behaviour would ship untested. §8.2 names the parameter for that reason.

- [ ] **Step 1: Write the failing test**

Create `src/core/useClampedPlacement.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { act, useRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useClampedPlacement, type ClampedPoint } from "./useClampedPlacement"

/**
 * The clamp every overlay shares.
 *
 * jsdom lays nothing out, so a real `getBoundingClientRect()` is all zeros and
 * a re-clamp cannot be told from no clamp at all — which is why the hook takes
 * an injectable `measure`. The window is jsdom's default 1024 x 768.
 */

type ObserverCallback = (entries: ResizeObserverEntry[]) => void

/**
 * A ResizeObserver whose callbacks the test fires by hand.
 *
 * Copied rather than imported from `VirtualizationBounds.test.tsx`: importing
 * one test file from another would run that file's suites here too.
 */
class ResizeObserverStub {
  static callbacks = new Set<ObserverCallback>()
  static fire() {
    for (const callback of ResizeObserverStub.callbacks) callback([])
  }
  private readonly callback: ObserverCallback
  constructor(callback: ObserverCallback) {
    this.callback = callback
  }
  observe() {
    ResizeObserverStub.callbacks.add(this.callback)
  }
  unobserve() {
    ResizeObserverStub.callbacks.delete(this.callback)
  }
  disconnect() {
    ResizeObserverStub.callbacks.delete(this.callback)
  }
}

const rect = (width: number, height: number): DOMRect => new DOMRect(0, 0, width, height)

function Overlay({ at, measure }: { at: ClampedPoint; measure?: (() => DOMRect) | undefined }) {
  const ref = useRef<HTMLDivElement>(null)
  const placement = useClampedPlacement(ref, at, measure)
  return (
    <div
      ref={ref}
      data-testid="overlay"
      style={{ position: "fixed", left: placement.x, top: placement.y }}
    />
  )
}

const FAR: ClampedPoint = { x: 2000, y: 2000 }
const NEAR: ClampedPoint = { x: 120, y: 40 }

afterEach(() => {
  ResizeObserverStub.callbacks.clear()
  vi.unstubAllGlobals()
})

describe("useClampedPlacement", () => {
  it("pulls an overlay back inside the window in both axes", () => {
    render(<Overlay at={FAR} measure={() => rect(200, 100)} />)

    const overlay = screen.getByTestId("overlay")
    expect(overlay.style.left).toBe("816px")
    expect(overlay.style.top).toBe("660px")
  })

  it("opens where it was asked to when there is room", () => {
    render(<Overlay at={NEAR} measure={() => rect(200, 100)} />)

    const overlay = screen.getByTestId("overlay")
    expect(overlay.style.left).toBe("120px")
    expect(overlay.style.top).toBe("40px")
  })

  it("measures the element itself when no measure is given", () => {
    render(<Overlay at={FAR} />)

    // Every jsdom rect is zeros, so the clamp reduces to "no further than the
    // edge minus the margin" — enough to prove it ran.
    expect(screen.getByTestId("overlay").style.left).toBe("1016px")
  })

  it("re-clamps when the overlay's own content resizes it", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    let tall = false
    render(<Overlay at={{ x: 120, y: 700 }} measure={() => (tall ? rect(200, 400) : rect(200, 100))} />)

    const overlay = screen.getByTestId("overlay")
    expect(overlay.style.top).toBe("660px")

    // Switching operator makes the popover taller; the layout effect has long
    // since run, so only the observer can notice.
    tall = true
    act(() => ResizeObserverStub.fire())

    expect(overlay.style.top).toBe("360px")
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/core/useClampedPlacement.test.tsx
```

The run fails at import: `Failed to resolve import "./useClampedPlacement"` — the file does not
exist, so all four tests fail before any of them runs.

- [ ] **Step 3: Implement**

Create `src/core/useClampedPlacement.ts`. This is the hook moved out of `HeaderMenu.tsx` verbatim,
plus the `measure` parameter and the observer:

```ts
import { useState, type RefObject } from "react"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

/** Smallest gap kept between an overlay and the edge of the window. */
const VIEWPORT_MARGIN_PX = 8

/** A viewport-relative point, in CSS pixels. */
export interface ClampedPoint {
  x: number
  y: number
}

/**
 * Where to put an overlay so that all of it is on screen.
 *
 * An overlay opens at the pointer or under the control that summoned it, and
 * for the last column that is usually within its own width of the window edge.
 * It is laid out once at the requested spot, measured, and moved before paint.
 *
 * @param ref - The overlay element.
 * @param requested - Where the caller wants its top-left corner. Stable across
 *   renders, or every render re-measures.
 * @param measure - How to measure the overlay. Defaults to its own bounding
 *   rect; injectable because jsdom lays nothing out and reports every rect as
 *   zeros, which makes a re-clamp indistinguishable from no clamp at all.
 * @returns The corner to render at.
 *
 * @example
 * const placement = useClampedPlacement(ref, { x: event.clientX, y: event.clientY })
 */
export function useClampedPlacement(
  ref: RefObject<HTMLElement | null>,
  requested: ClampedPoint,
  measure?: (() => DOMRect) | undefined,
): ClampedPoint {
  const [placement, setPlacement] = useState(requested)

  useIsomorphicLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const clamp = () => {
      const { width, height } = measure ? measure() : element.getBoundingClientRect()
      const x = clampToViewport(requested.x, width, window.innerWidth)
      const y = clampToViewport(requested.y, height, window.innerHeight)
      // Same point, same object: a fresh one re-renders for nothing, and a
      // re-render that resized the element would observe itself forever.
      setPlacement((current) => (current.x === x && current.y === y ? current : { x, y }))
    }
    clamp()
    /*
     * A menu is measured once and never changes size; a filter popover grows
     * and shrinks as its operator changes, long after the layout effect above
     * has run. jsdom implements no ResizeObserver, so this is guarded rather
     * than assumed.
     */
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(clamp)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, requested, measure])

  return placement
}

function clampToViewport(start: number, size: number, viewport: number): number {
  const furthest = viewport - size - VIEWPORT_MARGIN_PX
  return Math.max(VIEWPORT_MARGIN_PX, Math.min(start, furthest))
}
```

In `src/components/HeaderMenu.tsx`, replace the first four import lines

```tsx
import type { Column, RowData } from "@tanstack/react-table"
import { useEffect, useRef, useState } from "react"
import { useIsomorphicLayoutEffect } from "../core/useIsomorphicLayoutEffect"
import type { DataTableFeatures } from "../useDataTable"
```

with

```tsx
import type { Column, RowData } from "@tanstack/react-table"
import { useEffect, useRef } from "react"
import { useClampedPlacement } from "../core/useClampedPlacement"
import type { DataTableFeatures } from "../useDataTable"
```

replace

```tsx
/** Smallest gap kept between the menu and the edge of the window. */
const VIEWPORT_MARGIN_PX = 8

export interface HeaderMenuPosition {
```

with

```tsx
/** Where the menu's top-left corner goes, in viewport pixels. */
export interface HeaderMenuPosition {
```

and **delete everything from** the line

```tsx
/**
 * Where to put the menu so that all of it is on screen.
```

**to the end of the file** — the old `useClampedPlacement` and its `clampToViewport`. The file now
ends with the `}` that closes the `HeaderMenu` component.

In `src/index.ts`, add the hook beside the other borrowable helpers, immediately after the
`export { useAutosize } …` / `export type { AutosizeActions } …` pair:

```ts
export { useClampedPlacement } from "./core/useClampedPlacement"
export type { ClampedPoint } from "./core/useClampedPlacement"
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/core/useClampedPlacement.test.tsx src/HeaderMenu.test.tsx src/HeaderMenuPlacement.test.tsx
pnpm typecheck && pnpm test && pnpm build
```

`HeaderMenuPlacement.test.tsx` must pass **untouched**: it is the regression net for the move, and
its two cases still read `8px` margins out of the same arithmetic.

`pnpm test` must report **380 tests** (376 plus 4).

- [ ] **Step 5: Commit**

```bash
git add src/core/useClampedPlacement.ts src/core/useClampedPlacement.test.tsx src/components/HeaderMenu.tsx src/index.ts
git commit -m "refactor(overlays): share the viewport clamp and let it re-measure"
git push origin khojiakbar
```

---

### Task 14: What an editor holds before it is a condition

**Files:**
- Create: `src/core/filterDraft.ts`
- Modify: `src/useDataTable.ts`
- Modify: `src/index.ts`
- Test: `src/core/filterDraft.test.ts`, `src/FilterState.test.tsx`

Two editors are coming — the header popover (§8.2) and the Filters tab's inline one (§8.3) — and
§8.3 says they "both draft the same way". So the draft is a module of its own, pure and fully
tested, and both editors are then a set of form controls over it.

Three rules the module exists to enforce:

- **A draft is not a condition.** Every field is a string, the way an `<input>` reports it.
  Nothing reaches `layout.filters` without going through `draftToCondition`, which runs the
  constructors in `filters.ts` — so a condition an editor builds is byte-identical to the same
  condition restored from a URL, and `instance.query` does not change identity for a filter that
  did not change (§3.4).
- **A draft that constrains nothing becomes `null`**, and the caller clears the column (§3.5).
- **A date is edited as Is / Before / After / Between and published as one half-open range**
  (§3.2). `conditionToDayChoice` is the inverse, so re-opening an editor on
  `[2026-03-31, 2026-04-01)` shows "Is 31 Mar" rather than a range nobody typed.

This task also publishes **`instance.filtering.kinds`**. Every filter surface needs to know which
editor a column gets, and §7.4's resolution is data-dependent — recomputing it inside a component
would be both a duplicate of `resolveFilterKind` and free to disagree with the map `pruneFilters`
already used on load. It is one new member on the object §9 specifies; the alternative is each
surface re-deriving it per render from `table.options.columns`.

- [ ] **Step 1: Write the failing test**

Create `src/core/filterDraft.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  conditionToDayChoice,
  describeCondition,
  draftFromCondition,
  draftToCondition,
  emptyDraft,
  isBlankOperator,
  isRangeOperator,
  operatorChoices,
  withOperator,
} from "./filterDraft"
import type { DateCondition } from "./filters"
import type { DataTableLabels } from "../types"
import { defaultLabels } from "../components/DataTable"

/**
 * The editors' shared draft: what a set of form controls holds, and what it
 * becomes. Everything here is pure, so the editors themselves stay a thin
 * layer of inputs over it.
 */

const labels: DataTableLabels = defaultLabels

describe("operatorChoices", () => {
  it("offers each kind its own operators, in the order they are listed", () => {
    expect(operatorChoices("text").map((choice) => choice.value)).toEqual([
      "contains",
      "notContains",
      "equals",
      "notEquals",
      "startsWith",
      "endsWith",
      "blank",
      "notBlank",
    ])
    expect(operatorChoices("number").map((choice) => choice.value)).toEqual([
      "eq",
      "ne",
      "lt",
      "lte",
      "gt",
      "gte",
      "between",
      "blank",
      "notBlank",
    ])
    // The date editor offers modes, not operators: all four become one
    // half-open range on the wire.
    expect(operatorChoices("date").map((choice) => choice.value)).toEqual([
      "is",
      "before",
      "after",
      "between",
      "blank",
      "notBlank",
    ])
    expect(operatorChoices("boolean").map((choice) => choice.value)).toEqual([
      "isTrue",
      "isFalse",
      "blank",
      "notBlank",
    ])
    expect(operatorChoices("list").map((choice) => choice.value)).toEqual([
      "in",
      "notIn",
      "blank",
      "notBlank",
    ])
  })

  it("names every operator through a label key that is a plain string", () => {
    for (const kind of ["text", "number", "date", "boolean", "list"] as const) {
      for (const choice of operatorChoices(kind)) {
        expect(typeof labels[choice.labelKey]).toBe("string")
      }
    }
  })
})

describe("empty drafts", () => {
  it("starts each editor on its most useful operator", () => {
    expect(emptyDraft("text")).toEqual({ kind: "text", op: "contains", value: "" })
    expect(emptyDraft("number")).toEqual({ kind: "number", op: "eq", value: "", from: "", to: "" })
    expect(emptyDraft("date")).toEqual({ kind: "date", mode: "is", day: "", from: "", to: "" })
    expect(emptyDraft("boolean")).toEqual({ kind: "boolean", op: "isTrue" })
    expect(emptyDraft("list")).toEqual({ kind: "list", op: "in", values: [] })
  })
})

describe("withOperator", () => {
  it("keeps what is already typed", () => {
    expect(withOperator({ kind: "text", op: "contains", value: "x" }, "notBlank")).toEqual({
      kind: "text",
      op: "notBlank",
      value: "x",
    })
    expect(
      withOperator({ kind: "date", mode: "is", day: "2026-01-01", from: "", to: "" }, "between"),
    ).toEqual({ kind: "date", mode: "between", day: "2026-01-01", from: "", to: "" })
  })

  it("ignores an operator the kind does not offer", () => {
    // The value arrives from a `<select>` as a plain string; a draft is never
    // left holding an operator the constructors would have to reject.
    const draft = { kind: "text", op: "contains", value: "x" } as const
    expect(withOperator(draft, "between")).toBe(draft)
  })

  it("says which operators carry no value, and which carry two", () => {
    expect(isBlankOperator({ kind: "date", mode: "blank", day: "", from: "", to: "" })).toBe(true)
    expect(isBlankOperator({ kind: "text", op: "contains", value: "" })).toBe(false)
    expect(isRangeOperator({ kind: "number", op: "between", value: "", from: "", to: "" })).toBe(true)
    expect(isRangeOperator({ kind: "number", op: "gt", value: "5", from: "", to: "" })).toBe(false)
  })
})

describe("draftFromCondition", () => {
  it("fills an editor from the condition its column carries", () => {
    expect(
      draftFromCondition({ kind: "number", field: "a", op: "between", from: 10, to: null }, "number"),
    ).toEqual({ kind: "number", op: "between", value: "", from: "10", to: "" })
    expect(draftFromCondition({ kind: "boolean", field: "b", op: "is", value: false }, "boolean"))
      .toEqual({ kind: "boolean", op: "isFalse" })
  })

  it("reads a one-day range back as the Is the editor offered", () => {
    expect(
      draftFromCondition({ kind: "date", field: "d", op: "range", from: "2026-03-31", before: "2026-04-01" }, "date"),
    ).toEqual({ kind: "date", mode: "is", day: "2026-03-31", from: "", to: "" })
  })

  it("ignores a condition whose kind is not the column's", () => {
    // The same rule `pruneFilters` applies on load: a text condition on a
    // number column would run a substring test against a numeric accessor.
    expect(draftFromCondition({ kind: "text", field: "a", op: "contains", value: "x" }, "number"))
      .toEqual(emptyDraft("number"))
    expect(draftFromCondition(undefined, "text")).toEqual(emptyDraft("text"))
  })
})

describe("conditionToDayChoice", () => {
  it("is the inverse of the four-way conversion", () => {
    const range = (from: string | null, before: string | null): DateCondition => ({
      kind: "date",
      field: "d",
      op: "range",
      from,
      before,
    })
    expect(conditionToDayChoice(range("2026-03-31", "2026-04-01"))).toEqual({ mode: "is", day: "2026-03-31" })
    expect(conditionToDayChoice(range(null, "2026-03-31"))).toEqual({ mode: "before", day: "2026-03-31" })
    // "After 31 Mar" was published as `from: 1 Apr`; it reads back as 31 Mar.
    expect(conditionToDayChoice(range("2026-04-01", null))).toEqual({ mode: "after", day: "2026-03-31" })
    expect(conditionToDayChoice(range("2026-03-01", "2026-04-01"))).toEqual({
      mode: "between",
      from: "2026-03-01",
      to: "2026-03-31",
    })
  })
})

describe("draftToCondition", () => {
  it("builds through the constructors, so normalisation happens once", () => {
    expect(draftToCondition({ kind: "text", op: "contains", value: "  agro " }, "a")).toEqual({
      kind: "text",
      field: "a",
      op: "contains",
      value: "agro",
    })
    // Reversed bounds are swapped by the constructor, not published.
    expect(draftToCondition({ kind: "number", op: "between", value: "", from: "20", to: "10" }, "a")).toEqual({
      kind: "number",
      field: "a",
      op: "between",
      from: 10,
      to: 20,
    })
  })

  it("converts a between-days draft into a half-open range", () => {
    expect(
      draftToCondition({ kind: "date", mode: "between", day: "", from: "2026-03-01", to: "2026-03-31" }, "d"),
    ).toEqual({ kind: "date", field: "d", op: "range", from: "2026-03-01", before: "2026-04-01" })
  })

  it("returns null for a draft that constrains nothing", () => {
    expect(draftToCondition({ kind: "text", op: "contains", value: "   " }, "a")).toBeNull()
    expect(draftToCondition({ kind: "number", op: "gt", value: "abc", from: "", to: "" }, "a")).toBeNull()
    expect(draftToCondition({ kind: "date", mode: "is", day: "", from: "", to: "" }, "d")).toBeNull()
    expect(draftToCondition({ kind: "list", op: "in", values: [] }, "s")).toBeNull()
  })
})

describe("describeCondition", () => {
  it("says what a filter does, for a collapsed entry in the Filters tab", () => {
    expect(describeCondition({ kind: "text", field: "a", op: "contains", value: "agro" }, labels))
      .toBe("Contains agro")
    expect(describeCondition({ kind: "number", field: "a", op: "between", from: 10, to: null }, labels))
      .toBe("Between 10 – …")
    expect(describeCondition({ kind: "date", field: "d", op: "range", from: "2026-03-31", before: "2026-04-01" }, labels))
      .toBe("Is 2026-03-31")
    expect(describeCondition({ kind: "list", field: "s", op: "in", values: ["closed", "open"] }, labels))
      .toBe("Is any of closed, open")
    expect(describeCondition({ kind: "boolean", field: "b", op: "is", value: false }, labels)).toBe("False")
  })

  it("describes blankness with its operator alone", () => {
    expect(describeCondition({ kind: "text", field: "a", op: "notBlank" }, labels)).toBe("Is not blank")
  })
})
```

Append this case to the end of the `describe("persistence", …)` block in `src/FilterState.test.tsx`:

```tsx
  it("publishes each column's resolved filter kind", () => {
    // Every filter surface needs to know which editor a column gets, and the
    // resolution is data-dependent: recomputing it per component would be free
    // to disagree with the map `pruneFilters` used on load.
    const { result } = setup("f16")
    expect(result.current.filtering.kinds.get("name")).toBe("text")
    expect(result.current.filtering.kinds.get("amount")).toBe("number")
    expect(result.current.filtering.kinds.get("gone")).toBeUndefined()
  })
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/core/filterDraft.test.ts src/FilterState.test.tsx
```

`filterDraft.test.ts` fails at import — `Failed to resolve import "./filterDraft"`. The new
`FilterState` case fails to compile: `Property 'kinds' does not exist on type` the filtering API.

- [ ] **Step 3: Implement**

Create `src/core/filterDraft.ts`:

```ts
import {
  addDays,
  booleanCondition,
  dayChoiceToCondition,
  listCondition,
  numberCondition,
  textCondition,
  type DateCondition,
  type DayChoice,
  type FilterCondition,
  type FilterKind,
  type FilterValue,
  type ListCondition,
  type NumberCondition,
  type TextCondition,
} from "./filters"
import type { DataTableLabels } from "../types"

/**
 * What a filter editor holds while the user is still deciding.
 *
 * A draft is not a condition: it is what a set of form controls contains, so
 * every field is a string, the way an `<input>` reports it. Nothing here
 * reaches `layout.filters` — `draftToCondition` runs it through the
 * constructors in `filters.ts` first, and a draft that constrains nothing
 * becomes `null` and clears the column.
 *
 * There is deliberately no draft in the model and no syncing back into one: a
 * draft is discarded or applied, never kept in step with committed state.
 */

/** The boolean editor's four choices; `is` carries its value in the choice. */
export type BooleanDraftOp = "isTrue" | "isFalse" | "blank" | "notBlank"

export type FilterDraft =
  | { kind: "text"; op: TextCondition["op"]; value: string }
  | { kind: "number"; op: NumberCondition["op"]; value: string; from: string; to: string }
  | { kind: "date"; mode: DayChoice["mode"]; day: string; from: string; to: string }
  | { kind: "boolean"; op: BooleanDraftOp }
  | { kind: "list"; op: ListCondition["op"]; values: FilterValue[] }

/** The list editor's own draft, which a values list reads and rewrites whole. */
export type ListDraft = Extract<FilterDraft, { kind: "list" }>

/**
 * The label keys that name an operator.
 *
 * Spelled out rather than `keyof DataTableLabels`, which also holds the
 * parameterised labels: an operator name is always a plain string, and
 * `labels[key]` has to be one too.
 */
export type OperatorLabelKey =
  | "opContains"
  | "opNotContains"
  | "opEquals"
  | "opNotEquals"
  | "opStartsWith"
  | "opEndsWith"
  | "opEq"
  | "opNe"
  | "opLt"
  | "opLte"
  | "opGt"
  | "opGte"
  | "opBetween"
  | "opDateIs"
  | "opDateBefore"
  | "opDateAfter"
  | "opDateBetween"
  | "opIsTrue"
  | "opIsFalse"
  | "opIn"
  | "opNotIn"
  | "opBlank"
  | "opNotBlank"

/** One entry in an editor's operator select, typed to its own kind. */
export interface KindOperatorChoice<TOp extends string> {
  /** The draft's own operator (or, for a date, its mode). */
  value: TOp
  /** Which label names it. */
  labelKey: OperatorLabelKey
}

/** One entry in an editor's operator select, whatever kind it belongs to. */
export type OperatorChoice = KindOperatorChoice<string>

const TEXT_OPS: readonly KindOperatorChoice<TextCondition["op"]>[] = [
  { value: "contains", labelKey: "opContains" },
  { value: "notContains", labelKey: "opNotContains" },
  { value: "equals", labelKey: "opEquals" },
  { value: "notEquals", labelKey: "opNotEquals" },
  { value: "startsWith", labelKey: "opStartsWith" },
  { value: "endsWith", labelKey: "opEndsWith" },
  { value: "blank", labelKey: "opBlank" },
  { value: "notBlank", labelKey: "opNotBlank" },
]

const NUMBER_OPS: readonly KindOperatorChoice<NumberCondition["op"]>[] = [
  { value: "eq", labelKey: "opEq" },
  { value: "ne", labelKey: "opNe" },
  { value: "lt", labelKey: "opLt" },
  { value: "lte", labelKey: "opLte" },
  { value: "gt", labelKey: "opGt" },
  { value: "gte", labelKey: "opGte" },
  { value: "between", labelKey: "opBetween" },
  { value: "blank", labelKey: "opBlank" },
  { value: "notBlank", labelKey: "opNotBlank" },
]

/*
 * The date editor offers four modes and the wire carries one operator: every
 * one of them becomes a half-open `[from, before)` range (see
 * `dayChoiceToCondition`), which is why these are modes rather than operators.
 */
const DATE_OPS: readonly KindOperatorChoice<DayChoice["mode"]>[] = [
  { value: "is", labelKey: "opDateIs" },
  { value: "before", labelKey: "opDateBefore" },
  { value: "after", labelKey: "opDateAfter" },
  { value: "between", labelKey: "opDateBetween" },
  { value: "blank", labelKey: "opBlank" },
  { value: "notBlank", labelKey: "opNotBlank" },
]

const BOOLEAN_OPS: readonly KindOperatorChoice<BooleanDraftOp>[] = [
  { value: "isTrue", labelKey: "opIsTrue" },
  { value: "isFalse", labelKey: "opIsFalse" },
  { value: "blank", labelKey: "opBlank" },
  { value: "notBlank", labelKey: "opNotBlank" },
]

const LIST_OPS: readonly KindOperatorChoice<ListCondition["op"]>[] = [
  { value: "in", labelKey: "opIn" },
  { value: "notIn", labelKey: "opNotIn" },
  { value: "blank", labelKey: "opBlank" },
  { value: "notBlank", labelKey: "opNotBlank" },
]

/**
 * The operators one kind of editor offers, in the order they are listed.
 *
 * @param kind - The column's resolved filter kind.
 * @returns The choices, each with the label key that names it.
 */
export function operatorChoices(kind: FilterKind): readonly OperatorChoice[] {
  switch (kind) {
    case "text":
      return TEXT_OPS
    case "number":
      return NUMBER_OPS
    case "date":
      return DATE_OPS
    case "boolean":
      return BOOLEAN_OPS
    case "list":
      return LIST_OPS
  }
}

/**
 * The same draft under a different operator, keeping everything already typed.
 *
 * The operator arrives from a `<select>` as a plain string; one the kind does
 * not offer leaves the draft alone rather than producing an operator the
 * constructors would have to reject.
 *
 * @param draft - What the editor holds.
 * @param operator - The chosen operator, or a date editor's mode.
 * @returns The draft under that operator.
 */
export function withOperator(draft: FilterDraft, operator: string): FilterDraft {
  switch (draft.kind) {
    case "text": {
      const op = pickOperator(TEXT_OPS, operator)
      return op === null ? draft : { ...draft, op }
    }
    case "number": {
      const op = pickOperator(NUMBER_OPS, operator)
      return op === null ? draft : { ...draft, op }
    }
    case "date": {
      const mode = pickOperator(DATE_OPS, operator)
      return mode === null ? draft : { ...draft, mode }
    }
    case "boolean": {
      const op = pickOperator(BOOLEAN_OPS, operator)
      return op === null ? draft : { ...draft, op }
    }
    case "list": {
      const op = pickOperator(LIST_OPS, operator)
      return op === null ? draft : { ...draft, op }
    }
  }
}

/** The offered operator equal to `value`, narrowed to its own kind, or null. */
function pickOperator<TOp extends string>(
  offered: readonly KindOperatorChoice<TOp>[],
  value: string,
): TOp | null {
  for (const choice of offered) if (choice.value === value) return choice.value
  return null
}

/**
 * Whether a draft's operator carries no value of its own.
 *
 * @param draft - What the editor holds.
 * @returns True for `blank` and `notBlank`, which are operators on every kind.
 */
export function isBlankOperator(draft: FilterDraft): boolean {
  const operator = draft.kind === "date" ? draft.mode : draft.op
  return operator === "blank" || operator === "notBlank"
}

/**
 * Whether a draft's operator takes two bounds rather than one value.
 *
 * @param draft - What the editor holds.
 * @returns True for a number `between` and a date `between`.
 */
export function isRangeOperator(draft: FilterDraft): boolean {
  if (draft.kind === "number") return draft.op === "between"
  if (draft.kind === "date") return draft.mode === "between"
  return false
}

/**
 * An editor with nothing chosen yet.
 *
 * @param kind - The column's resolved filter kind.
 * @returns A draft on that kind's most useful operator.
 */
export function emptyDraft(kind: FilterKind): FilterDraft {
  switch (kind) {
    case "text":
      return { kind: "text", op: "contains", value: "" }
    case "number":
      return { kind: "number", op: "eq", value: "", from: "", to: "" }
    case "date":
      return { kind: "date", mode: "is", day: "", from: "", to: "" }
    case "boolean":
      return { kind: "boolean", op: "isTrue" }
    case "list":
      return { kind: "list", op: "in", values: [] }
  }
}

/**
 * Read a date condition back as the choice that would have produced it.
 *
 * The wire carries one operator and an exclusive upper bound, so re-opening an
 * editor on `[2026-03-31, 2026-04-01)` has to show "Is 31 Mar" rather than a
 * range nobody typed. The inverse of {@link dayChoiceToCondition}.
 *
 * @param condition - A date condition, as stored.
 * @returns The editor choice it came from.
 */
export function conditionToDayChoice(condition: DateCondition): DayChoice {
  if (condition.op === "blank" || condition.op === "notBlank") return { mode: condition.op }
  /*
   * Narrowing this union by its operator does not exclude the blank member —
   * that member's own `op` is a union of literals — so the bounds are read
   * through an `in` check, the same way the constructors in `filters.ts` read
   * theirs.
   */
  if (!("from" in condition)) return { mode: "is", day: "" }
  const { from, before } = condition
  if (from === null && before === null) return { mode: "is", day: "" }
  if (from === null) return { mode: "before", day: before ?? "" }
  if (before === null) return { mode: "after", day: addDays(from, -1) ?? from }
  // One day wide is the "Is" the editor offered; anything else is a range.
  if (addDays(from, 1) === before) return { mode: "is", day: from }
  return { mode: "between", from, to: addDays(before, -1) }
}

/**
 * Fill an editor from the condition a column already carries.
 *
 * A condition of a different kind than the column now resolves to is ignored
 * rather than reinterpreted — the same rule `pruneFilters` applies on load,
 * for the same reason: a text condition on a number column would run a
 * substring test against a numeric accessor.
 *
 * @param condition - The column's current condition, if it has one.
 * @param kind - The column's resolved filter kind.
 * @returns A draft for that kind.
 */
export function draftFromCondition(
  condition: FilterCondition | undefined,
  kind: FilterKind,
): FilterDraft {
  if (condition === undefined || condition.kind !== kind) return emptyDraft(kind)
  switch (condition.kind) {
    case "text":
      return {
        kind: "text",
        op: condition.op,
        value: "value" in condition ? condition.value : "",
      }
    case "number": {
      if (condition.op === "between") {
        return {
          kind: "number",
          op: "between",
          value: "",
          from: condition.from === null ? "" : String(condition.from),
          to: condition.to === null ? "" : String(condition.to),
        }
      }
      return {
        kind: "number",
        op: condition.op,
        value: "value" in condition ? String(condition.value) : "",
        from: "",
        to: "",
      }
    }
    case "date": {
      const choice = conditionToDayChoice(condition)
      if (choice.mode === "between") {
        return { kind: "date", mode: "between", day: "", from: choice.from ?? "", to: choice.to ?? "" }
      }
      return {
        kind: "date",
        mode: choice.mode,
        day: "day" in choice ? choice.day : "",
        from: "",
        to: "",
      }
    }
    case "boolean": {
      if (condition.op === "blank" || condition.op === "notBlank") {
        return { kind: "boolean", op: condition.op }
      }
      return { kind: "boolean", op: "value" in condition && condition.value ? "isTrue" : "isFalse" }
    }
    case "list":
      return {
        kind: "list",
        op: condition.op === "blank" || condition.op === "notBlank" ? "in" : condition.op,
        values: "values" in condition ? [...condition.values] : [],
      }
  }
}

/** A finite number from what an `<input type="number">` reports, or NaN. */
function draftNumber(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text)
}

/** A bound from a number input: null for "unbounded", which is what blank means. */
function draftBound(text: string): number | null {
  const value = draftNumber(text)
  return Number.isFinite(value) ? value : null
}

/**
 * Turn an editor's draft into the condition it describes.
 *
 * Every draft goes through the constructors in `filters.ts`, which fix key
 * order, sort a list's values and swap reversed bounds — so a condition the
 * editors build is byte-identical to the same condition restored from a URL,
 * and `instance.query` does not change identity for a filter that did not.
 *
 * @param draft - What the editor holds.
 * @param field - The column id the condition is for.
 * @returns The condition, or null when it constrains nothing — in which case
 *   the caller clears the column rather than storing it.
 */
export function draftToCondition(draft: FilterDraft, field: string): FilterCondition | null {
  switch (draft.kind) {
    case "text": {
      const { op } = draft
      if (op === "blank" || op === "notBlank") return textCondition({ kind: "text", field, op })
      return textCondition({ kind: "text", field, op, value: draft.value.trim() })
    }
    case "number": {
      const { op } = draft
      if (op === "blank" || op === "notBlank") return numberCondition({ kind: "number", field, op })
      if (op === "between") {
        return numberCondition({
          kind: "number",
          field,
          op: "between",
          from: draftBound(draft.from),
          to: draftBound(draft.to),
        })
      }
      return numberCondition({ kind: "number", field, op, value: draftNumber(draft.value) })
    }
    case "date": {
      const { mode } = draft
      if (mode === "blank" || mode === "notBlank") return dayChoiceToCondition(field, { mode })
      if (mode === "between") {
        return dayChoiceToCondition(field, {
          mode: "between",
          from: draft.from === "" ? null : draft.from,
          to: draft.to === "" ? null : draft.to,
        })
      }
      return dayChoiceToCondition(field, { mode, day: draft.day })
    }
    case "boolean": {
      const { op } = draft
      if (op === "blank" || op === "notBlank") return booleanCondition({ kind: "boolean", field, op })
      return booleanCondition({ kind: "boolean", field, op: "is", value: op === "isTrue" })
    }
    case "list":
      return listCondition({ kind: "list", field, op: draft.op, values: draft.values })
  }
}

/** The label that names one condition's operator. */
function operatorLabel(condition: FilterCondition, labels: DataTableLabels): string {
  if (condition.op === "blank") return labels.opBlank
  if (condition.op === "notBlank") return labels.opNotBlank
  if (condition.kind === "date") {
    const choice = conditionToDayChoice(condition)
    if (choice.mode === "before") return labels.opDateBefore
    if (choice.mode === "after") return labels.opDateAfter
    if (choice.mode === "between") return labels.opDateBetween
    return labels.opDateIs
  }
  const key = operatorChoices(condition.kind).find((choice) => choice.value === condition.op)
  return key === undefined ? condition.op : labels[key.labelKey]
}

/**
 * One condition in words, for a collapsed entry in the Filters tab.
 *
 * Reads as "Contains agro" or "Between 10 – 20" — the operator's own label
 * followed by its value, so the tab says what a filter does without opening
 * its editor.
 *
 * @param condition - The condition to describe.
 * @param labels - The table's labels.
 * @returns A short phrase naming the operator and its value.
 */
export function describeCondition(condition: FilterCondition, labels: DataTableLabels): string {
  const operator = operatorLabel(condition, labels)
  if (condition.op === "blank" || condition.op === "notBlank") return operator
  switch (condition.kind) {
    case "text":
      return `${operator} ${"value" in condition ? condition.value : ""}`
    case "number":
      if ("from" in condition) return `${operator} ${condition.from ?? "…"} – ${condition.to ?? "…"}`
      return `${operator} ${"value" in condition ? condition.value : ""}`
    case "date": {
      const choice = conditionToDayChoice(condition)
      if (choice.mode === "between") return `${operator} ${choice.from ?? "…"} – ${choice.to ?? "…"}`
      return `${operator} ${"day" in choice ? choice.day : ""}`
    }
    case "boolean":
      return "value" in condition && condition.value ? labels.opIsTrue : labels.opIsFalse
    case "list":
      return `${operator} ${"values" in condition ? condition.values.join(", ") : ""}`
  }
}
```

In `src/useDataTable.ts`, add `type FilterKind` to the `./core/filters` import, which becomes:

```ts
import {
  pruneFilters,
  rebuildCondition,
  type FilterCondition,
  type FilterKind,
  type FilterModel,
  type FilterValueOption,
} from "./core/filters"
```

annotate the `filterKinds` memo so the map is published read-only without a cast — change

```ts
  const filterKinds = useMemo(() => collectFilterKinds(columns, data), [columns, data])
```

to

```ts
  const filterKinds = useMemo<ReadonlyMap<string, FilterKind | false>>(
    () => collectFilterKinds(columns, data),
    [columns, data],
  )
```

and add the map to `filteringApi` — its first two lines become

```ts
      enabled: filteringEnabled,
      /*
       * Which editor each column gets. Published because every filter surface
       * needs it and §7.4's resolution is data-dependent: a component that
       * re-derived it would be free to disagree with the map `pruneFilters`
       * used on load, and a column would then edit as one kind and prune as
       * another.
       */
      kinds: filterKinds,
      conditions: layout.filters as readonly FilterCondition[],
```

with `filterKinds` added to that memo's dependency array, which becomes:

```ts
    [filteringEnabled, filterKinds, layout.filters, layout.search, setCondition, clearColumn, clearAll, updateSearch, setModel],
```

In `src/index.ts`, add the draft module immediately below the
`export type { FilterColumnDefShape, FilterKindSource } from "./core/filterKinds"` line and above the
`export { collectSearchFields, filterFn_dtSearch, … }` block Task 8 left there — Task 7 rewrote the
value export above it to `export { collectColumnFacts, collectFilterKinds, resolveFilterKind } …`, so
that is the line to look for rather than the Task 5 spelling:

```ts
export {
  conditionToDayChoice,
  describeCondition,
  draftFromCondition,
  draftToCondition,
  emptyDraft,
  isBlankOperator,
  isRangeOperator,
  operatorChoices,
  withOperator,
} from "./core/filterDraft"
export type {
  BooleanDraftOp,
  FilterDraft,
  KindOperatorChoice,
  ListDraft,
  OperatorChoice,
  OperatorLabelKey,
} from "./core/filterDraft"
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/core/filterDraft.test.ts src/FilterState.test.tsx
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must report **396 tests** (380 plus 15 in `filterDraft.test.ts` and 1 in
`FilterState.test.tsx`).

- [ ] **Step 5: Commit**

```bash
git add src/core/filterDraft.ts src/core/filterDraft.test.ts src/useDataTable.ts src/FilterState.test.tsx src/index.ts
git commit -m "feat(filters): the editors' shared draft, and each column's resolved kind"
git push origin khojiakbar
```

---

### Task 15: The filter editor itself

**Files:**
- Create: `src/core/columnLabel.ts`
- Create: `src/components/FilterEditor.tsx`
- Modify: `src/components/ColumnPanel.tsx`
- Modify: `src/components/HeaderCell.tsx`
- Modify: `src/styles.css`
- Modify: `src/index.ts`
- Test: `src/FilterEditor.test.tsx`

One editor, used by both surfaces — the header popover in Task 16 and the Filters tab in Task 17.
Writing it once is not a nicety: §8.3 says "both editors draft the same way", and two of them would
drift the first time an operator was added.

Three behaviours are easy to get backwards, and all three come from §6.2:

- **Typing is not a decision.** A keystroke updates the draft and nothing else. The commit happens
  when the field is left, on Enter, or on Apply. Column filters are never debounced — that is the
  quick-search box's trade, and it is wrong here.
- **Choosing is a decision.** An operator choice and a picked day commit at once, because they are
  discrete and deliberate acts and a delay there feels broken.
- **An editor that constrains nothing clears the column**, because `draftToCondition` returns
  `null` for it (§3.5).

`columnLabel` comes out of `ColumnPanel` into `src/core/columnLabel.ts` in the same commit:
`HeaderCell` already had its own copy of the same three lines, and the editor, the popover and the
Filters tab all need it. This is the second occurrence, which is where it gets refactored.

- [ ] **Step 1: Write the failing test**

Create `src/FilterEditor.test.tsx`:

```tsx
import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable, defaultLabels } from "./components/DataTable"
import { FilterEditor } from "./components/FilterEditor"
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

function Table({ columnId, initialLayout }: { columnId: string; initialLayout?: Partial<TableLayout> }) {
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
    render(<Table columnId="name" />)

    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "agro" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))

    expect(shown()).toHaveLength(1)
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

  it("clears the column from the editor", () => {
    render(<Table columnId="name" />)
    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })
    fireEvent.blur(screen.getByLabelText("Name: Value"))
    expect(shown()).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }))

    expect(shown()).toHaveLength(3)
  })

  it("opens showing the condition the column already carries", () => {
    const contains: FilterCondition = { kind: "text", field: "name", op: "contains", value: "temir" }
    render(<Table columnId="name" initialLayout={{ filters: [contains] }} />)

    expect(screen.getByLabelText("Name: Operator")).toHaveValue("contains")
    expect(screen.getByLabelText("Name: Value")).toHaveValue("temir")
  })

  it("renders nothing for a column whose host turned filtering off", () => {
    const { container } = render(<Table columnId="id" />)

    // `meta: { filter: false }`. TanStack's own `getCanFilter()` knows nothing
    // about it, so the editor has to check the resolved kind as well.
    expect(container.querySelector(".dt-filter-editor")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/FilterEditor.test.tsx
```

The run fails at import — `Failed to resolve import "./components/FilterEditor"` — so all nine
cases fail before any of them runs.

- [ ] **Step 3: Implement**

Create `src/core/columnLabel.ts`:

```ts
/**
 * A column's name, as a plain string.
 *
 * A header definition can be a string or a render function, and only a string
 * labels anything — an accessible name, a popover title, a row in the panel.
 * The id is the fallback: not pretty, but stable and unique.
 *
 * @param id - The column id.
 * @param header - Whatever `columnDef.header` holds.
 * @returns The header when it is a non-empty string, otherwise the id.
 *
 * @example
 * columnLabel(column.id, column.columnDef.header) // "Amount"
 */
export function columnLabel(id: string, header: unknown): string {
  return typeof header === "string" && header.length > 0 ? header : String(id)
}
```

Create `src/components/FilterEditor.tsx`:

```tsx
import type { Column, RowData } from "@tanstack/react-table"
import { useState, type ChangeEvent, type KeyboardEvent } from "react"
import { columnLabel } from "../core/columnLabel"
import {
  draftFromCondition,
  draftToCondition,
  emptyDraft,
  isBlankOperator,
  isRangeOperator,
  operatorChoices,
  withOperator,
  type FilterDraft,
} from "../core/filterDraft"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

/**
 * One column's filter, as a set of form controls.
 *
 * Both surfaces render this: the popover a header menu opens (§8.2) and the
 * inline editor in the side panel's Filters tab (§8.3). Neither holds
 * committed state of its own — the draft lives here, and it is discarded or
 * applied, never synced.
 */

export interface FilterEditorProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  column: Column<DataTableFeatures, TData, unknown>
  labels: DataTableLabels
  /** Called after the editor commits or clears, so a popover can close itself. */
  onCommit?: (() => void) | undefined
  /** Take the focus on mount. The popover does; the panel's inline editor does not. */
  autoFocus?: boolean
}

/**
 * Whether a column gets a filter editor at all.
 *
 * Two independent gates, and both matter: TanStack's `getCanFilter()` covers
 * the accessor and the `enableColumnFilter*` flags but knows nothing about
 * `meta.filter`, and `meta: { filter: false }` is how a host turns filtering
 * off for one column.
 *
 * @param instance - The table instance.
 * @param column - The column to test.
 * @returns True when the column has both an accessor and a resolved kind.
 */
export function canFilterColumn<TData extends RowData>(
  instance: DataTableInstance<TData>,
  column: Column<DataTableFeatures, TData, unknown>,
): boolean {
  const kind = instance.filtering.kinds.get(column.id)
  return column.getCanFilter() && kind !== undefined && kind !== false
}

export function FilterEditor<TData extends RowData>({
  instance,
  column,
  labels,
  onCommit,
  autoFocus = false,
}: FilterEditorProps<TData>) {
  const { filtering } = instance
  const kind = filtering.kinds.get(column.id)
  const name = columnLabel(column.id, column.columnDef.header)
  const current = filtering.conditions.find((condition) => condition.field === column.id)
  /*
   * Seeded once and never synced: §8.3 makes a draft something that is
   * discarded or applied, and re-seeding it from `conditions` would wipe out
   * what the user is typing the moment any other surface committed anything.
   */
  const [draft, setDraft] = useState<FilterDraft>(() =>
    draftFromCondition(current, kind === undefined || kind === false ? "text" : kind),
  )

  // After the hook, so hook order never depends on which column this is.
  if (kind === undefined || kind === false) return null

  const commit = (next: FilterDraft) => {
    const built = draftToCondition(next, column.id)
    // An editor that constrains nothing clears the column: the constructor
    // returns null for it, and a condition that means nothing is not a filter.
    if (built === null) filtering.clearColumn(column.id)
    else filtering.setCondition(built)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter commits from anywhere in the editor. There is no <form> here: a
    // filter editor inside a table is not a submission, and a form element
    // would bring a page reload with it.
    if (event.key !== "Enter") return
    event.preventDefault()
    commit(draft)
    onCommit?.()
  }

  const handleOperator = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = withOperator(draft, event.target.value)
    setDraft(next)
    /*
     * Applied at once rather than on Apply: §6.2 counts choosing an operator,
     * ticking a value and picking a day as discrete, deliberate acts, where a
     * delay feels broken. Only typing waits — for blur, Enter or Apply.
     */
    commit(next)
  }

  const handleClear = () => {
    filtering.clearColumn(column.id)
    setDraft(emptyDraft(kind))
    onCommit?.()
  }

  const handleApply = () => {
    commit(draft)
    onCommit?.()
  }

  // The operator select takes the focus only when there is no field to type in.
  const focusSelect = autoFocus && (isBlankOperator(draft) || draft.kind === "boolean")

  return (
    <div className="dt-filter-editor" onKeyDown={handleKeyDown}>
      <select
        className="dt-select"
        aria-label={`${name}: ${labels.operator}`}
        value={draft.kind === "date" ? draft.mode : draft.op}
        onChange={handleOperator}
        autoFocus={focusSelect}
      >
        {operatorChoices(draft.kind).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {labels[choice.labelKey]}
          </option>
        ))}
      </select>

      <DraftFields
        draft={draft}
        name={name}
        labels={labels}
        autoFocus={autoFocus && !focusSelect}
        onDraft={setDraft}
        onCommit={commit}
      />

      <div className="dt-filter-actions">
        <button type="button" className="dt-link" onClick={handleClear}>
          {labels.clearFilter}
        </button>
        <span className="dt-spacer" />
        <button type="button" className="dt-menu-button" onClick={handleApply}>
          {labels.apply}
        </button>
      </div>
    </div>
  )
}

interface DraftFieldsProps {
  draft: FilterDraft
  /** The column's name, so every field says which column it belongs to. */
  name: string
  labels: DataTableLabels
  autoFocus: boolean
  onDraft: (draft: FilterDraft) => void
  onCommit: (draft: FilterDraft) => void
}

/**
 * The value controls one draft needs — which is none for some operators.
 *
 * Typing records and waits; picking a day records and applies. Both rules are
 * §6.2's, and the difference is what keeps a half-typed number out of the
 * query while a chosen date reaches it at once.
 */
function DraftFields({ draft, name, labels, autoFocus, onDraft, onCommit }: DraftFieldsProps) {
  /** A discrete choice: recorded and applied at once. */
  const choose = (next: FilterDraft) => {
    onDraft(next)
    onCommit(next)
  }

  if (draft.kind === "list") {
    /*
     * Task 18 replaces this with the real values list. Until then a list
     * column has no source of choices in either mode, which is exactly what
     * this line says: §5.3 refuses to show an empty checkbox list, because
     * silence there reads as "there is no data".
     */
    return <p className="dt-filter-note">{labels.noValues}</p>
  }
  if (isBlankOperator(draft) || draft.kind === "boolean") return null

  if (draft.kind === "date") {
    if (isRangeOperator(draft)) {
      return (
        <>
          <input
            type="date"
            className="dt-filter-input"
            aria-label={`${name}: ${labels.rangeFrom}`}
            value={draft.from}
            autoFocus={autoFocus}
            onChange={(event) => choose({ ...draft, from: event.target.value })}
          />
          <input
            type="date"
            className="dt-filter-input"
            aria-label={`${name}: ${labels.rangeTo}`}
            value={draft.to}
            onChange={(event) => choose({ ...draft, to: event.target.value })}
          />
        </>
      )
    }
    return (
      <input
        type="date"
        className="dt-filter-input"
        aria-label={`${name}: ${labels.filterValue}`}
        value={draft.day}
        autoFocus={autoFocus}
        onChange={(event) => choose({ ...draft, day: event.target.value })}
      />
    )
  }

  if (draft.kind === "number") {
    if (isRangeOperator(draft)) {
      return (
        <>
          <input
            type="number"
            className="dt-filter-input"
            aria-label={`${name}: ${labels.rangeFrom}`}
            value={draft.from}
            autoFocus={autoFocus}
            onChange={(event) => onDraft({ ...draft, from: event.target.value })}
            onBlur={() => onCommit(draft)}
          />
          <input
            type="number"
            className="dt-filter-input"
            aria-label={`${name}: ${labels.rangeTo}`}
            value={draft.to}
            onChange={(event) => onDraft({ ...draft, to: event.target.value })}
            onBlur={() => onCommit(draft)}
          />
        </>
      )
    }
    return (
      <input
        type="number"
        className="dt-filter-input"
        aria-label={`${name}: ${labels.filterValue}`}
        value={draft.value}
        autoFocus={autoFocus}
        onChange={(event) => onDraft({ ...draft, value: event.target.value })}
        onBlur={() => onCommit(draft)}
      />
    )
  }

  return (
    <input
      type="text"
      className="dt-filter-input"
      aria-label={`${name}: ${labels.filterValue}`}
      value={draft.value}
      autoFocus={autoFocus}
      onChange={(event) => onDraft({ ...draft, value: event.target.value })}
      onBlur={() => onCommit(draft)}
    />
  )
}
```

In `src/components/ColumnPanel.tsx`, add the import above the `renderedLeafColumns` one

```tsx
import { columnLabel } from "../core/columnLabel"
import { renderedLeafColumns } from "../core/pinning"
```

and delete its private copy — the three lines

```tsx
/** Header definitions can be strings or render functions; only strings label well. */
function columnLabel(id: string, header: unknown): string {
  return typeof header === "string" && header.length > 0 ? header : id
}
```

In `src/components/HeaderCell.tsx`, add the import beneath the `classNames` one

```tsx
import { classNames } from "../core/classNames"
import { columnLabel } from "../core/columnLabel"
```

and replace the second occurrence of the same logic — the four lines

```tsx
  const columnName =
    typeof column.columnDef.header === "string" && column.columnDef.header.length > 0
      ? column.columnDef.header
      : String(column.id)
```

with

```tsx
  const columnName = columnLabel(column.id, column.columnDef.header)
```

In `src/styles.css`, join the editor's field to the shared field rule — change

```css
.dt-select,
.dt-page-input,
.dt-search {
  height: 28px;
```

to

```css
.dt-select,
.dt-page-input,
.dt-search,
.dt-filter-input {
  height: 28px;
```

add the editor's own controls to the focus-ring rule — change

```css
.dt-select:focus-visible,
.dt-page-input:focus-visible,
.dt-search:focus-visible,
.dt-search-clear:focus-visible,
.dt-icon-button:focus-visible {
```

to

```css
.dt-select:focus-visible,
.dt-page-input:focus-visible,
.dt-search:focus-visible,
.dt-search-clear:focus-visible,
.dt-filter-input:focus-visible,
.dt-icon-button:focus-visible {
```

and add the editor section at the end of the file, after the `@media (prefers-reduced-motion: reduce)`
block that closes the stylesheet:

```css
/* ---------- filter editor ---------- *
 * Shared by the header popover and the side panel's Filters tab, so it carries
 * no positioning of its own — only the stack of controls.
 */

.dt-filter-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
}

/*
 * (0,2,0), so it beats `.dt-page-input`'s `width: 4em` whatever the source
 * order: both fields share the rule above, and only one of them is 4em wide.
 *
 * The operator select is reached through `.dt-filter-editor .dt-select` rather
 * than through a class of its own: the editor holds exactly one `<select>`, and
 * a `.dt-filter-op` in the markup with no rule anywhere reads as a rule someone
 * deleted.
 */
.dt-filter-editor .dt-select,
.dt-filter-editor .dt-filter-input {
  width: 100%;
}

.dt-filter-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* An editor that cannot offer anything says so, rather than showing nothing. */
.dt-filter-note {
  margin: 0;
  padding: 6px 2px;
  color: var(--dt-muted-fg);
  font-size: 12px;
}
```

In `src/index.ts`, add the editor to the shell's own parts, immediately after the
`export { DepthSpacer, ExpandToggle } …` line:

```ts
export { canFilterColumn, FilterEditor } from "./components/FilterEditor"
export type { FilterEditorProps } from "./components/FilterEditor"
```

and the label helper beside the other borrowable helpers, immediately after the
`export type { HeaderPinning } …` line:

```ts
export { columnLabel } from "./core/columnLabel"
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/FilterEditor.test.tsx src/DataTable.test.tsx src/Reordering.test.tsx
pnpm typecheck && pnpm test && pnpm build
```

`DataTable.test.tsx` and `Reordering.test.tsx` are the net under the `columnLabel` move: both read
column names out of the Columns panel and the header.

`pnpm test` must report **16 more tests than it did before this task**, and no file other than
`FilterEditor.test.tsx` may gain or lose one. The absolute totals in this plan are stale — the
review rounds after the earlier tasks added regression tests the original chain never counted — so
take the count before and compare: it was **504 tests across 38 files** when this task landed (488
across 37 before it).

Sixteen and not the nine printed above: the listing in Step 1 leaves seven behaviours this task
implements uncovered, and they were added to the same file rather than left to a review round. The
harness there grew an `onCommit` spy and an `autoFocus` flag to carry them, and the extra cases are
Enter committing from the value field, `onCommit` firing on Apply and on Clear, Clear emptying the
draft it left behind, a typed *number* waiting for blur the way typed text does, the list column's
`noValues` note standing in for Task 18's values list, `autoFocus` landing on the value field and —
when the operator leaves no field to type in — on the operator select, and `canFilterColumn`
refusing a `meta: { filter: false }` column while allowing an ordinary one.

- [ ] **Step 5: Commit**

```bash
git add src/core/columnLabel.ts src/components/FilterEditor.tsx src/components/ColumnPanel.tsx src/components/HeaderCell.tsx src/styles.css src/index.ts src/FilterEditor.test.tsx
git commit -m "feat(filters): the per-column filter editor"
git push origin khojiakbar
```

---

### Task 16: The popover the header menu opens

**Files:**
- Create: `src/components/FilterPopover.tsx`
- Modify: `src/components/HeaderMenu.tsx`
- Modify: `src/components/HeaderCell.tsx`
- Modify: `src/components/DataTable.tsx`
- Modify: `src/styles.css`
- Modify: `src/index.ts`
- Test: `src/FilterPopover.test.tsx`, `src/StylesCascade.test.ts`

**The menu stays a real `role="menu"` and gains two items**, both of which open a surface elsewhere:
`labels.filter` opens the popover this task builds, and `labels.filterInPanel` opens the side panel's
Filters tab on that column (§8.3's `focusColumnId` route). The second item's prop is declared and
rendered here and passed in Task 17, which is where the panel learns about tabs at all; until then
nothing hands it in and the item is not offered.

Do not put the editor inside the menu. §8.2
lists five reasons and every one of them is a bug an implementer would otherwise meet separately:
inputs under `role="menu"` are invalid ARIA; the menu closes on any item click, so the first
keystroke would dismiss the editor; Escape would be ambiguous between the field and the menu; the
menu autofocuses its first button, which would steal focus from the field; and the menu's clamp
measures once per open, so a menu that grew when its operator changed would hang off the screen.

The popover instead:

- renders **as a direct child of `.dt-root`**, beside the panel and the menu, and its class joins
  the `:has()` z-index lift — otherwise a later sibling table wins the tie by DOM order and paints
  over it. There is a matching case in `StylesCascade.test.ts` for exactly that;
- takes **its own z-index inside `.dt-root`'s single stacking context**. The lift only orders this
  table against the page. Without a number of its own the popover paints under the sticky header
  (3), the pinned header cells (4), the drag indicator (5) and the progress bar (6) it is anchored
  above;
- **re-measures its clamp** through Task 13's hook, because switching operator changes its height;
- traps Tab, closes on Escape **discarding the draft**, and puts focus back where the user was.

One deviation from §8.2's wording, and it is forced: "restores focus to the menu item on close"
cannot be done literally, because the menu closed as the popover opened and that item no longer
exists. Focus goes to the control that opened the menu — the column's ⋮ button — which is the
element still on screen at the same place.

- [ ] **Step 1: Write the failing test**

Create `src/FilterPopover.test.tsx`:

```tsx
import { createColumnHelper } from "@tanstack/react-table"
import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable, defaultLabels } from "./components/DataTable"
import { FilterPopover } from "./components/FilterPopover"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * The header menu's "Filter…" item and the popover it opens.
 *
 * The menu is left a real `role="menu"` with no form controls in it — see
 * §8.2 — so everything below goes through the item, not through the menu.
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
  helper.accessor("id", { header: "Id", size: 100, meta: { filter: false } }),
]
const data: Row[] = [
  { id: "r0", name: "Agro Ltd", amount: 15 },
  { id: "r1", name: "Temir", amount: 500 },
]

function Table() {
  const instance = useDataTable<Row>({ id: "popover", columns, data, getRowId: (row) => row.id })
  return <DataTable instance={instance} virtualize={false} />
}

const shown = () => screen.getAllByRole("row").filter((row) => row.classList.contains("dt-tr"))

/** Open a column's menu and choose its Filter… item. */
const openFilter = async (columnName: string) => {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: `${columnName}: Column actions` }))
  await user.click(screen.getByRole("menuitem", { name: "Filter…" }))
  return user
}

type ObserverCallback = (entries: ResizeObserverEntry[]) => void

/** A ResizeObserver whose callbacks the test fires by hand. */
class ResizeObserverStub {
  static callbacks = new Set<ObserverCallback>()
  static fire() {
    for (const callback of ResizeObserverStub.callbacks) callback([])
  }
  private readonly callback: ObserverCallback
  constructor(callback: ObserverCallback) {
    this.callback = callback
  }
  observe() {
    ResizeObserverStub.callbacks.add(this.callback)
  }
  unobserve() {
    ResizeObserverStub.callbacks.delete(this.callback)
  }
  disconnect() {
    ResizeObserverStub.callbacks.delete(this.callback)
  }
}

function LonePopover({ measure }: { measure: () => DOMRect }) {
  const instance = useDataTable<Row>({ id: "lone", columns, data, getRowId: (row) => row.id })
  return (
    <FilterPopover
      instance={instance}
      column={instance.table.getColumn("name")!}
      position={{ x: 120, y: 700 }}
      labels={defaultLabels}
      onClose={() => undefined}
      measure={measure}
    />
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  ResizeObserverStub.callbacks.clear()
  vi.unstubAllGlobals()
})

describe("the column filter popover", () => {
  it("opens from the menu, closes the menu, and renders beside it under .dt-root", async () => {
    const { container } = render(<Table />)
    await openFilter("Name")

    expect(screen.queryByRole("menu")).toBeNull()
    const popover = screen.getByRole("dialog", { name: "Filter Name" })
    // A direct child of `.dt-root`, like the panel and the menu: that is what
    // the `:has()` z-index lift selects on.
    expect(popover.parentElement).toBe(container.querySelector(".dt-root"))
    expect(popover.className).toBe("dt-filter-popover")
  })

  it("commits on Apply and closes", async () => {
    render(<Table />)
    const user = await openFilter("Name")

    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(shown()).toHaveLength(1)
  })

  it("discards the draft on Escape and gives focus back to the column's button", async () => {
    render(<Table />)
    await openFilter("Name")
    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })

    fireEvent.keyDown(document, { key: "Escape" })

    expect(screen.queryByRole("dialog")).toBeNull()
    // Nothing was committed: a draft is discarded or applied, never synced.
    expect(shown()).toHaveLength(2)
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Name: Column actions" }),
    )
  })

  it("keeps Tab inside itself", async () => {
    render(<Table />)
    await openFilter("Name")

    const apply = screen.getByRole("button", { name: "Apply" })
    apply.focus()
    fireEvent.keyDown(apply, { key: "Tab" })

    expect(document.activeElement).toBe(screen.getByLabelText("Name: Operator"))
  })

  it("re-clamps when its own content resizes it", () => {
    // Switching operator changes the popover's height, long after the clamp's
    // layout effect has run. jsdom reports every rect as zeros, so the height
    // is injected rather than laid out.
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    let tall = false
    const rect = (height: number): DOMRect => new DOMRect(0, 0, 200, height)
    render(<LonePopover measure={() => rect(tall ? 400 : 100)} />)

    const popover = screen.getByRole("dialog", { name: "Filter Name" })
    expect(popover.style.top).toBe("660px")

    tall = true
    act(() => ResizeObserverStub.fire())

    expect(popover.style.top).toBe("360px")
  })

  it("marks a filtered column in its header", async () => {
    render(<Table />)
    const user = await openFilter("Name")
    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })
    await user.click(screen.getByRole("button", { name: "Apply" }))

    const marker = screen.getByRole("img", { name: "Filtered" })
    expect(marker.closest("th")).toBe(screen.getByRole("columnheader", { name: /name/i }))
  })

  it("offers no Filter… item for a column whose host turned filtering off", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(screen.getByRole("button", { name: "Id: Column actions" }))

    expect(screen.queryByRole("menuitem", { name: "Filter…" })).toBeNull()
  })
})
```

Append this case to the end of the `describe("stacking context", …)` block in
`src/StylesCascade.test.ts`:

```ts
  it("lifts .dt-root while a filter popover is open, and paints it above the progress bar", () => {
    // FilterPopover.tsx renders `.dt-filter-popover` as a direct child of
    // `.dt-root`, structurally parallel to the menu and the panel. The lift
    // only orders this table against the page, so the popover also needs a
    // z-index of its own inside the root's single stacking context — without
    // one it paints under the sticky header (3), the pinned header cells (4),
    // the drag indicator (5) and the progress bar (6) it is anchored above.
    const root = renderRoot("dt-filter-popover")
    expect(getComputedStyle(root).zIndex).toBe("1")

    const popover = root.firstElementChild as HTMLElement
    const progress = document.createElement("div")
    progress.className = "dt-progress"
    root.appendChild(progress)

    expect(Number(getComputedStyle(popover).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(progress).zIndex),
    )
    root.remove()
  })
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/FilterPopover.test.tsx src/StylesCascade.test.ts
```

`FilterPopover.test.tsx` fails at import — `Failed to resolve import "./components/FilterPopover"`.
The cascade case fails on its first assertion: `expected "auto" to be "1"`, because no rule matches
`.dt-root:has(> .dt-filter-popover)` yet.

- [ ] **Step 3: Implement**

Create `src/components/FilterPopover.tsx`:

```tsx
import type { Column, RowData } from "@tanstack/react-table"
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { columnLabel } from "../core/columnLabel"
import { useClampedPlacement, type ClampedPoint } from "../core/useClampedPlacement"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { FilterEditor } from "./FilterEditor"

/**
 * One column's filter editor, floating over the table.
 *
 * Opened by the header menu's "Filter…" item — never rendered *inside* that
 * menu, which is a real `role="menu"`: form controls under it are invalid
 * ARIA, the menu closes on any item click, and its own clamp measures once per
 * open and cannot correct a menu that grows afterwards.
 *
 * Rendered as a direct child of `.dt-root`, so `.dt-root:has(> .dt-filter-popover)`
 * can lift the whole table above whatever follows it on the page.
 */

/** Anything the popover can be focused back onto when it closes. */
const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled])"

export interface FilterPopoverProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  column: Column<DataTableFeatures, TData, unknown>
  /** Where the menu was, in viewport pixels. Stable, or the clamp re-measures. */
  position: ClampedPoint
  labels: DataTableLabels
  /** Closes the popover. The draft is discarded, never committed, on the way out. */
  onClose: () => void
  /**
   * How the popover measures itself; defaults to its own bounding rect.
   *
   * Injectable for the same reason {@link useClampedPlacement} takes one: in
   * jsdom every rect is zeros, so a re-clamp cannot otherwise be observed.
   */
  measure?: (() => DOMRect) | undefined
}

export function FilterPopover<TData extends RowData>({
  instance,
  column,
  position,
  labels,
  onClose,
  measure,
}: FilterPopoverProps<TData>) {
  const ref = useRef<HTMLDivElement>(null)
  const placement = useClampedPlacement(ref, position, measure)

  // Close on outside click and on Escape, the two things a user will try —
  // the same pair the menu and the panel handle.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [onClose])

  /*
   * Tab stays inside. A popover the keyboard can walk out of leaves the user
   * in the table behind it with no way back and an editor still open over the
   * rows they are reading.
   */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return
    const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (first === undefined || last === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
      return
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="dt-filter-popover"
      ref={ref}
      role="dialog"
      aria-label={labels.filterTitle(columnLabel(column.id, column.columnDef.header))}
      style={{ left: placement.x, top: placement.y }}
      onKeyDown={handleKeyDown}
    >
      <FilterEditor
        instance={instance}
        column={column}
        labels={labels}
        onCommit={onClose}
        autoFocus
      />
    </div>
  )
}
```

In `src/components/HeaderMenu.tsx`, add the new prop to `HeaderMenuProps` — the interface becomes:

```tsx
interface HeaderMenuProps<TData extends RowData> {
  column: Column<DataTableFeatures, TData, unknown>
  position: HeaderMenuPosition
  flags: Required<DataTableFeatureFlags>
  labels: DataTableLabels
  onAutosize: () => void
  onAutosizeAll: () => void
  /**
   * Opens this column's filter editor in a popover. Optional: a shell of your
   * own that renders no popover simply leaves it out, and the item is not
   * offered.
   */
  onOpenFilter?: (() => void) | undefined
  /**
   * Opens the side panel's Filters tab with this column's editor expanded and
   * focused — §8.3's `focusColumnId` route. Optional for the same reason, and
   * Task 17 is what passes it: the panel does not know about tabs until then.
   */
  onOpenFilterInPanel?: (() => void) | undefined
  onClose: () => void
}
```

add `onOpenFilter,` and `onOpenFilterInPanel,` to the destructured parameter list, between
`onAutosizeAll,` and `onClose,`, and insert the two items as the menu's first children —
immediately after the opening `<div className="dt-menu" … >` tag's closing `>` and before
`{flags.sorting && column.getCanSort() ? (`:

```tsx
      {/*
        First, and what the menu's own autofocus lands on: it is what a user
        opening a column's menu on a filterable table most often wants. Both
        items open a surface of their own — form controls never go inside a
        `role="menu"` (§8.2) — the popover for this column alone, the panel for
        this column beside every other filter at once.
      */}
      {onOpenFilter || onOpenFilterInPanel ? (
        <>
          {onOpenFilter ? (
            <button
              type="button"
              role="menuitem"
              className="dt-menu-item"
              onClick={run(onOpenFilter)}
            >
              {labels.filter}
            </button>
          ) : null}
          {onOpenFilterInPanel ? (
            <button
              type="button"
              role="menuitem"
              className="dt-menu-item"
              onClick={run(onOpenFilterInPanel)}
            >
              {labels.filterInPanel}
            </button>
          ) : null}
          <hr className="dt-menu-sep" />
        </>
      ) : null}

```

In `src/components/HeaderCell.tsx`, add the marker inside `.dt-th-inner`, immediately after the
`)}` that closes the `canSort ? … : …` expression and before the `</div>` that closes
`.dt-th-inner`:

```tsx
        {/*
          The same vocabulary as the sort indicator: a mark in the header, not
          a second control. A filtered column that is hidden has no header to
          carry this, which is why the Filters tab lists hidden columns too.
        */}
        {column.getIsFiltered() ? (
          <span
            className="dt-filtered"
            role="img"
            aria-label={labels.filteredBadge}
            title={labels.filteredBadge}
          >
            <FilterIcon />
          </span>
        ) : null}
```

and add the icon beside `SortIcon` at the end of the same file:

```tsx
function FilterIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.5 2.5 h9 l-3.4 4 v3.2 l-2.2 1.3 v-4.5 z" />
    </svg>
  )
}
```

In `src/components/DataTable.tsx`, add the two imports beneath the `QuickSearch` one

```tsx
import { QuickSearch } from "./QuickSearch"
import { canFilterColumn } from "./FilterEditor"
import { FilterPopover } from "./FilterPopover"
```

add the popover's state immediately after the `menu` state

```tsx
  const [menu, setMenu] = useState<{ columnId: string; at: HeaderMenuPosition } | null>(null)
  const [filterAt, setFilterAt] = useState<{ columnId: string; at: HeaderMenuPosition } | null>(null)
```

add the callback and the gate immediately after the `handleReorder` callback

```tsx
  /*
   * §8.2 asks for focus to return to the menu item that opened the popover.
   * That item is gone — the menu closes as the popover opens — so focus goes
   * to the control that opened the menu instead: the column's ⋮ button, which
   * is the element still on screen in the same place.
   *
   * Which column to focus is recorded here and acted on one commit later, by
   * the layout effect below. Moving the focus from this callback would move it
   * while the popover is still mounted, and leaving the editor's value field
   * is exactly what commits a typed draft (FilterEditor.tsx) — so Escape would
   * apply the draft it exists to discard.
   */
  const restoreFocusRef = useRef<string | null>(null)
  const closeFilter = useCallback(() => {
    restoreFocusRef.current = filterAt?.columnId ?? null
    setFilterAt(null)
  }, [filterAt])

  useIsomorphicLayoutEffect(() => {
    const columnId = restoreFocusRef.current
    // Only once the popover is really gone, and only for a close this
    // component asked for: a first render, or the popover opening, must not
    // pull the focus anywhere.
    if (filterAt !== null || columnId === null) return
    restoreFocusRef.current = null
    /*
     * Matched by walking the headers rather than by a `[data-column-id="…"]`
     * selector: a column id is whatever the host's accessor or header string
     * produced, and quotes or brackets in one would make that selector throw.
     */
    for (const header of tableRef.current?.querySelectorAll("th[data-column-id]") ?? []) {
      if (header.getAttribute("data-column-id") !== columnId) continue
      header.querySelector<HTMLButtonElement>(".dt-kebab")?.focus()
      return
    }
  }, [filterAt])

  /**
   * Whether a column has a filter editor to offer at all.
   *
   * One gate for both of the menu's filter items, so the popover and the panel
   * route can never disagree about which columns are filterable. Task 17 uses
   * it again for the second item.
   */
  const canFilter = (columnId: string): boolean => {
    const column = table.getColumn(columnId)
    return column !== undefined && canFilterColumn(instance, column)
  }
```

`useIsomorphicLayoutEffect` comes from `../core/useIsomorphicLayoutEffect`, added beside the
`useAutosize` import. Two corrections made while implementing this task, both from the real code:

- the synchronous `closeFilter` this plan first printed moved the focus *before* React unmounted the
  popover, so leaving the value field fired the editor's `onBlur` — and Escape committed the very
  draft it discards. The Escape case in `FilterPopover.test.tsx` fails against that version;
- `canFilterColumn` already reads `instance.filtering.enabled` (see FilterEditor.tsx), so the extra
  `instance.filtering.enabled &&` this plan printed was a second copy of a gate that exists once.

and replace the whole `{menu ? ( … ) : null}` block with:

```tsx
      {menu ? (
        <HeaderMenu
          column={table.getColumn(menu.columnId)!}
          position={menu.at}
          flags={flags}
          labels={labels}
          onAutosize={() => autosize(menu.columnId)}
          onAutosizeAll={autosizeAll}
          onOpenFilter={
            canFilter(menu.columnId)
              ? () => setFilterAt({ columnId: menu.columnId, at: menu.at })
              : undefined
          }
          onClose={() => setMenu(null)}
        />
      ) : null}

      {filterAt ? (
        <FilterPopover
          instance={instance}
          column={table.getColumn(filterAt.columnId)!}
          position={filterAt.at}
          labels={labels}
          onClose={closeFilter}
        />
      ) : null}
```

In `src/styles.css`, add the popover to the `:has()` lift — change

```css
.dt-root:has(> .dt-panel),
.dt-root:has(> .dt-menu) {
  z-index: 1;
}
```

to

```css
.dt-root:has(> .dt-panel),
.dt-root:has(> .dt-menu),
.dt-root:has(> .dt-filter-popover) {
  z-index: 1;
}
```

and widen the comment directly above it, replacing

```css
/*
 * Lift the table above whatever follows it while its panel or header menu
 * hangs open. Both render as a direct child of `.dt-root` (see DataTable.tsx)
 * and can extend past the table's own box — the menu is `position: fixed`
 * and clamped only to the viewport, not to this table.
 */
```

with

```css
/*
 * Lift the table above whatever follows it while its panel, its header menu or
 * a filter popover hangs open. All three render as a direct child of
 * `.dt-root` (see DataTable.tsx) and can extend past the table's own box — the
 * menu and the popover are `position: fixed` and clamped only to the viewport,
 * not to this table.
 */
```

add the filtered marker beside the sort indicator, immediately after the `.dt-sort-index` rule:

```css
/*
 * --dt-accent-text, not --dt-accent: this is accent-as-text, the same pairing
 * `.dt-link` and the menu's current choices use. It clears WCAG 1.4.11's 3:1
 * non-text minimum on --dt-header-bg in both themes, which matters because
 * this mark is the only visual sign that a column is filtered.
 */
.dt-filtered {
  flex: none;
  display: inline-flex;
  color: var(--dt-accent-text);
}
```

and add the popover itself immediately after the `.dt-menu-sep` rule, which ends the menu section:

```css
.dt-filter-popover {
  position: fixed;
  /*
   * Inside `.dt-root`'s single stacking context: above the menu that opened it
   * (20), the Columns panel (10), the progress bar (6), the drag indicator (5),
   * the pinned header cells (4) and the sticky header (3) — every one of which
   * would otherwise paint over a popover anchored above them. The `:has()`
   * rule near the top of this file is a different question: it orders this
   * whole table against the rest of the page.
   */
  z-index: 21;
  width: 240px;
  border: 1px solid var(--dt-border);
  border-radius: var(--dt-radius);
  background: var(--dt-bg);
  box-shadow: 0 12px 34px rgb(0 0 0 / 0.18);
}
```

In `src/index.ts`, add the popover beside the editor — the pair added in Task 15 becomes:

```ts
export { canFilterColumn, FilterEditor } from "./components/FilterEditor"
export type { FilterEditorProps } from "./components/FilterEditor"
export { FilterPopover } from "./components/FilterPopover"
export type { FilterPopoverProps } from "./components/FilterPopover"
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/FilterPopover.test.tsx src/StylesCascade.test.ts src/HeaderMenu.test.tsx src/Resizing.test.tsx src/ColumnAlignment.test.tsx
pnpm typecheck && pnpm test && pnpm build
```

The three older suites are the net under the new menu item: they drive the menu by item name, and
none of them counts items, so all of them must still pass untouched.

`pnpm test` must report **14 tests more than the run before this task** — the absolute totals
printed in this plan are stale, because each review round added regression tests. This task's suite
ends at 13 in `FilterPopover.test.tsx` (the seven above plus six added while implementing: the
table-wide `filtering: false` gate, the panel item's absence, the menu's autofocus landing on the
filter item, the Shift+Tab wrap, the outside-pointer close, and Clear closing the popover and
dropping the header's mark) and 1 in `StylesCascade.test.ts`. Measured here: 517 before, 531 after.

- [ ] **Step 5: Commit**

```bash
git add src/components/FilterPopover.tsx src/components/HeaderMenu.tsx src/components/HeaderCell.tsx src/components/DataTable.tsx src/styles.css src/index.ts src/FilterPopover.test.tsx src/StylesCascade.test.ts
git commit -m "feat(filters): open a filter popover from the header menu"
git push origin khojiakbar
```

---

### Task 17: The side panel grows a second tab

**Files:**
- Create: `src/components/TablePanel.tsx`
- Create: `src/components/ColumnsTab.tsx`
- Create: `src/components/FiltersTab.tsx`
- Modify: `src/components/ColumnPanel.tsx`
- Modify: `src/components/DataTable.tsx`
- Modify: `src/styles.css`
- Modify: `src/index.ts`
- Modify: `README.md`
- Modify: `src/FilterPopover.test.tsx` (one case flips — see below)
- Modify: `src/themes/themes.test.ts` (the pin-badge regex — see below)
- Test: `src/FiltersPanel.test.tsx`

`ColumnPanel` becomes a shell with two tabs in it. Four things about this task are easy to get
wrong:

- **`ColumnPanel` keeps its four props and its name**, because it is a published export. It becomes
  a thin wrapper that renders `TablePanel` with its own tab state. A host that wants to choose the
  tab renders `TablePanel`.
- **The Filters tab lists hidden columns too.** TanStack goes on applying a hidden column's filter,
  and that column has no header to carry the marker Task 16 added — so a tab that listed only
  rendered columns (which is what `ColumnPanel` does today, and what a `FiltersTab` written to
  match would inherit) would strand a filter with no surface anywhere: 40 rows out of 10 000 and no
  way to find out why.
- **The tab strip sits outside the scrolling box.** `.dt-panel` scrolls today; after this it is a
  flex column whose *body* scrolls, so the tabs do not scroll away.
- **The Columns tab's Reset is about columns.** `instance.resetLayout()` restores every slice,
  filters included (§7.2), so the tab takes the filter model before the reset and puts it back
  after. Clearing filters is the Filters tab's own action, at its foot.

`panelOpen` becomes `{ open, tab, focusColumnId? }`, as §8.3 requires — and the built-in shell
**sets it**, from the header menu's second item, which is the route §8.3 names: "a header-menu item
can open the panel straight onto the Filters tab with that column's editor focused". Task 16
declared and rendered that item; this task is what passes it, because `setPanelOpen` cannot carry a
tab or a column until `PanelState` exists. `TablePanel` still takes `focusColumnId` as a prop for a
host driving the panel itself, and one case below drives it that way.

One existing test flips with that wiring and must be updated here, not worked around:
`FilterPopover.test.tsx`'s "does not offer the panel route until a shell passes one" asserts that
the built-in shell offers no "Filter in panel…" item yet. Once `onOpenFilterInPanel` is passed, turn
it into its positive form — the item is offered, and choosing it opens the panel's Filters tab on
that column.

- [ ] **Step 1: Write the failing test**

Create `src/FiltersPanel.test.tsx`:

```tsx
import { createColumnHelper } from "@tanstack/react-table"
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable, defaultLabels } from "./components/DataTable"
import { TablePanel } from "./components/TablePanel"
import type { FilterCondition } from "./core/filters"
import { useDataTable, type DataTableFeatures } from "./useDataTable"
import type { TableLayout } from "./types"

/**
 * The side panel with two tabs: the Columns list it always had, and the
 * Filters tab beside it — which lists every filterable column, hidden ones
 * included, because a hidden column's filter has no header to show it.
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
  helper.accessor("id", { header: "Id", size: 100, meta: { filter: false } }),
]
const data: Row[] = [
  { id: "r0", name: "Agro Ltd", amount: 15 },
  { id: "r1", name: "Temir", amount: 500 },
  { id: "r2", name: "Kimyo", amount: 900 },
]

const over100: FilterCondition = { kind: "number", field: "amount", op: "gt", value: 100 }

function Table({ initialLayout }: { initialLayout?: Partial<TableLayout> }) {
  const instance = useDataTable<Row>({
    id: "panel",
    columns,
    data,
    getRowId: (row) => row.id,
    ...(initialLayout === undefined ? {} : { initialLayout }),
  })
  return <DataTable instance={instance} virtualize={false} />
}

/** The panel rendered directly, the way a shell of its own would. */
function LonePanel({ focusColumnId }: { focusColumnId?: string }) {
  const instance = useDataTable<Row>({ id: "lone-panel", columns, data, getRowId: (row) => row.id })
  return (
    <TablePanel
      instance={instance}
      labels={defaultLabels}
      onReorder={() => undefined}
      onClose={() => undefined}
      tab="filters"
      onTabChange={() => undefined}
      focusColumnId={focusColumnId}
    />
  )
}

const shown = () => screen.getAllByRole("row").filter((row) => row.classList.contains("dt-tr"))
const panel = () => screen.getByRole("dialog")
const entries = () => within(panel()).getAllByRole("listitem").map((item) => item.textContent ?? "")

/** Open the panel and switch to its Filters tab. */
const openFilters = async () => {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: "Columns" }))
  await user.click(screen.getByRole("tab", { name: "Filters" }))
  return user
}

/** Filter Name through the header menu's popover, the way Task 16's own suite does. */
const filterNameFromHeader = async () => {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: "Name: Column actions" }))
  await user.click(screen.getByRole("menuitem", { name: "Filter…" }))
  fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })
  await user.click(screen.getByRole("button", { name: "Apply" }))
}

beforeEach(() => localStorage.clear())

describe("the side panel's tabs", () => {
  it("opens on the Columns tab, with Show all inside it", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(screen.getByRole("button", { name: "Columns" }))

    expect(screen.getByRole("tab", { name: "Columns" })).toHaveAttribute("aria-selected", "true")
    expect(within(panel()).getByRole("button", { name: "Show all" })).toBeInTheDocument()
    expect(within(panel()).getByLabelText("Name")).toBeInTheDocument()
  })

  it("keeps the tab strip out of the scrolling box", async () => {
    const user = userEvent.setup()
    render(<Table />)
    await user.click(screen.getByRole("button", { name: "Columns" }))

    // Only the body scrolls, so the tabs cannot scroll away from under the
    // user's pointer.
    const body = panel().querySelector(".dt-panel-body")!
    expect(body.contains(screen.getByRole("tab", { name: "Filters" }))).toBe(false)
  })

  it("lists every filterable column on the Filters tab", async () => {
    render(<Table />)
    await openFilters()

    expect(entries()).toHaveLength(2)
    expect(entries().join(" ")).toContain("Name")
    // `meta: { filter: false }` keeps a column out of the list entirely.
    expect(entries().join(" ")).not.toContain("Id")
  })

  it("lists a hidden column that still carries a filter, and marks it hidden", async () => {
    render(<Table initialLayout={{ filters: [over100], columnVisibility: { amount: false } }} />)
    await openFilters()

    // TanStack goes on applying a hidden column's filter and the header is
    // gone, so this list is the only surface that filter has.
    expect(entries()[0]).toContain("Amount")
    expect(entries()[0]).toContain("Hidden")
    expect(shown()).toHaveLength(2)
  })

  it("puts a filtered column first and says what its filter does", async () => {
    render(<Table initialLayout={{ filters: [over100] }} />)
    await openFilters()

    expect(entries()[0]).toContain("Amount")
    expect(entries()[0]).toContain("Greater than 100")
    expect(entries()[1]).toContain("Name")
  })

  it("commits from an entry's own editor", async () => {
    render(<Table />)
    const user = await openFilters()

    await user.click(within(panel()).getByRole("button", { name: /^Name/ }))
    fireEvent.change(screen.getByLabelText("Name: Value"), { target: { value: "temir" } })
    fireEvent.blur(screen.getByLabelText("Name: Value"))

    expect(shown()).toHaveLength(1)
  })

  it("clears every filter from the foot of the tab", async () => {
    render(<Table initialLayout={{ filters: [over100] }} />)
    const user = await openFilters()
    expect(shown()).toHaveLength(2)

    await user.click(within(panel()).getByRole("button", { name: "Clear all filters" }))

    expect(shown()).toHaveLength(3)
    expect(within(panel()).getByText("No filters applied")).toBeInTheDocument()
  })

  it("resets the column arrangement without touching the filters", async () => {
    render(<Table />)
    const user = await openFilters()

    /*
     * The filter is set through the tab rather than through `initialLayout`:
     * `resetLayout` restores `{ ...EMPTY_LAYOUT, ...initialLayout }`, so a
     * filter that came from `initialLayout` would survive a reset by itself
     * and this case would prove nothing.
     */
    await user.click(within(panel()).getByRole("button", { name: /^Amount/ }))
    fireEvent.change(screen.getByLabelText("Amount: Operator"), { target: { value: "gt" } })
    fireEvent.change(screen.getByLabelText("Amount: Value"), { target: { value: "100" } })
    fireEvent.blur(screen.getByLabelText("Amount: Value"))
    expect(shown()).toHaveLength(2)

    await user.click(screen.getByRole("tab", { name: "Columns" }))
    await user.click(within(panel()).getByLabelText("Name"))
    expect(screen.queryByRole("columnheader", { name: /name/i })).toBeNull()

    await user.click(within(panel()).getByRole("button", { name: "Reset" }))

    // The column is back and the filter is still on: `resetLayout` blanks
    // every slice, filters included, so the tab takes the model out and puts
    // it back.
    expect(screen.getByRole("columnheader", { name: /name/i })).toBeInTheDocument()
    expect(shown()).toHaveLength(2)
  })

  it("opens one column's editor, focused, when a shell asks it to", () => {
    render(<LonePanel focusColumnId="name" />)

    expect(screen.getByLabelText("Name: Value")).toBe(document.activeElement)
  })

  it("opens on one column's editor from the header menu's second filter item", async () => {
    const user = userEvent.setup()
    render(<Table />)

    await user.click(screen.getByRole("button", { name: "Amount: Column actions" }))
    await user.click(screen.getByRole("menuitem", { name: "Filter in panel…" }))

    // §8.3's `focusColumnId` route, wired end to end: the menu closes, the
    // panel opens on the Filters tab, and that column's editor is expanded and
    // holds the focus.
    expect(screen.queryByRole("menu")).toBeNull()
    expect(screen.getByRole("tab", { name: "Filters" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByLabelText("Amount: Value")).toBe(document.activeElement)
  })

  it("shows in the tab the condition the header popover set", async () => {
    render(<Table />)
    await filterNameFromHeader()
    expect(shown()).toHaveLength(1)

    const user = await openFilters()

    // Both surfaces are views of one model, which is §8.3's whole
    // architectural claim: the tab says what the popover set, and the tab's
    // own editor opens on exactly that condition.
    expect(entries()[0]).toContain("Name")
    expect(entries()[0]).toContain("Contains temir")
    await user.click(within(panel()).getByRole("button", { name: /^Name/ }))
    expect(screen.getByLabelText("Name: Operator")).toHaveValue("contains")
    expect(screen.getByLabelText("Name: Value")).toHaveValue("temir")
  })

  it("clears from the tab what the header popover set, in both surfaces", async () => {
    render(<Table />)
    await filterNameFromHeader()
    expect(screen.getByRole("img", { name: "Filtered" })).toBeInTheDocument()

    const user = await openFilters()
    await user.click(within(panel()).getByRole("button", { name: /^Name/ }))
    await user.click(within(panel()).getByRole("button", { name: "Clear filter" }))

    // And the other direction: clearing in the tab un-marks the header the
    // popover marked, because there is one model and not two.
    expect(screen.queryByRole("img", { name: "Filtered" })).toBeNull()
    expect(shown()).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/FiltersPanel.test.tsx
```

The run fails at import — `Failed to resolve import "./components/TablePanel"` — so all twelve cases
fail before any of them runs.

- [ ] **Step 3: Implement**

Create `src/components/ColumnsTab.tsx`. The head and the list are `ColumnPanel`'s, moved across
unchanged apart from the reset:

```tsx
import type { RowData } from "@tanstack/react-table"
import { useState, type DragEvent } from "react"
import { columnLabel } from "../core/columnLabel"
import { renderedLeafColumns } from "../core/pinning"
import type { DropSide } from "../core/reorder"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

/**
 * What is shown, and in what order.
 *
 * Columns are listed in the order they appear in the table and dragged into a
 * new order by their handle. Pinning lives in the header's context menu, where
 * it sits next to the other per-column actions instead of as a pair of arrow
 * buttons whose direction has to be decoded.
 */

export interface ColumnsTabProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
}

export function ColumnsTab<TData extends RowData>({
  instance,
  labels,
  onReorder,
}: ColumnsTabProps<TData>) {
  const { table, flags, resetLayout, isCustomised, filtering } = instance
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; side: DropSide } | null>(null)

  /*
   * Listed in render order, not `getAllLeafColumns()` order — the latter puts
   * pinned columns first, so the panel would disagree with the table about
   * where a column is, and dragging inside it would move the wrong one.
   */
  const columns = renderedLeafColumns(table)

  const handleDragOver = (event: DragEvent<HTMLElement>, id: string) => {
    if (!flags.reordering || !draggingId) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    // A list runs vertically: the midpoint that matters is the horizontal one.
    const side: DropSide = event.clientY - rect.top > rect.height / 2 ? "end" : "start"
    setDropTarget({ id, side })
  }

  const handleDrop = (event: DragEvent<HTMLElement>, id: string) => {
    event.preventDefault()
    const draggedId = event.dataTransfer.getData("text/plain")
    const rect = event.currentTarget.getBoundingClientRect()
    const side: DropSide = event.clientY - rect.top > rect.height / 2 ? "end" : "start"
    setDropTarget(null)
    setDraggingId(null)
    if (draggedId && draggedId !== id) onReorder(draggedId, id, side)
  }

  const handleReset = () => {
    /*
     * This Reset is about columns. `resetLayout` restores every slice, filters
     * and search included (§7.2), so the filter model is taken before it and
     * put back after — both updates land in one commit, and clearing filters
     * stays the Filters tab's own action.
     */
    const model = filtering.getModel()
    resetLayout()
    filtering.setModel(model)
  }

  return (
    <>
      <div className="dt-panel-head">
        <span>{labels.columnsTitle}</span>
        <span className="dt-spacer" />
        <button
          type="button"
          className="dt-link"
          onClick={() => table.toggleAllColumnsVisible(true)}
        >
          {labels.showAll}
        </button>
        {isCustomised ? (
          <button type="button" className="dt-link" onClick={handleReset}>
            {labels.reset}
          </button>
        ) : null}
      </div>

      <ul className="dt-panel-list">
        {columns.map((column) => {
          const isTarget = dropTarget?.id === column.id
          const className = [
            "dt-panel-item",
            draggingId === column.id ? "dt-panel-dragging" : "",
            isTarget && dropTarget.side === "start" ? "dt-panel-drop-before" : "",
            isTarget && dropTarget.side === "end" ? "dt-panel-drop-after" : "",
          ]
            .filter(Boolean)
            .join(" ")

          return (
            <li
              key={column.id}
              className={className}
              onDragOver={(event) => handleDragOver(event, column.id)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(event) => handleDrop(event, column.id)}
            >
              {flags.reordering ? (
                <span
                  className="dt-drag-handle"
                  draggable
                  role="button"
                  tabIndex={-1}
                  aria-label={`${columnLabel(column.id, column.columnDef.header)}: ${labels.dragHint}`}
                  title={labels.dragHint}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move"
                    event.dataTransfer.setData("text/plain", column.id)
                    setDraggingId(column.id)
                  }}
                  onDragEnd={() => {
                    setDraggingId(null)
                    setDropTarget(null)
                  }}
                >
                  <GripIcon />
                </span>
              ) : null}

              <input
                id={`${instance.id}-col-${column.id}`}
                type="checkbox"
                checked={column.getIsVisible()}
                disabled={!flags.hiding || !column.getCanHide()}
                onChange={column.getToggleVisibilityHandler()}
              />
              <label
                className="dt-panel-label"
                htmlFor={`${instance.id}-col-${column.id}`}
              >
                {columnLabel(column.id, column.columnDef.header)}
              </label>

              {column.getIsPinned() ? (
                <span className="dt-pin-badge">
                  {column.getIsPinned() === "start"
                    ? labels.pinnedStartBadge
                    : labels.pinnedEndBadge}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" fill="currentColor">
      {[2, 7, 12].map((y) =>
        [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />),
      )}
    </svg>
  )
}
```

Create `src/components/FiltersTab.tsx`:

```tsx
import type { RowData } from "@tanstack/react-table"
import { useState } from "react"
import { columnLabel } from "../core/columnLabel"
import { describeCondition } from "../core/filterDraft"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { canFilterColumn, FilterEditor } from "./FilterEditor"

/**
 * Every filterable column in one place.
 *
 * The other half of the model the header popover edits — same editor, same
 * draft rules — and the only surface a *hidden* column's filter has, which is
 * why this list is built from `getAllLeafColumns()` rather than from the
 * rendered ones.
 */

export interface FiltersTabProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  /** Open this column's editor, focused, when the tab first renders. */
  focusColumnId?: string | undefined
}

export function FiltersTab<TData extends RowData>({
  instance,
  labels,
  focusColumnId,
}: FiltersTabProps<TData>) {
  const { table, filtering } = instance
  const [openId, setOpenId] = useState<string | null>(focusColumnId ?? null)

  /*
   * Hidden columns included. TanStack goes on applying a hidden column's
   * filter, and that column has no header to carry a marker, so listing only
   * rendered columns would strand a filter with no surface anywhere: 40 rows
   * out of 10 000 and no way to find out why.
   */
  const columns = table.getAllLeafColumns().filter((column) => canFilterColumn(instance, column))
  const active = new Set(filtering.conditions.map((condition) => condition.field))
  // Filtered columns first; each half keeps the order the table is in.
  const ordered = [
    ...columns.filter((column) => active.has(column.id)),
    ...columns.filter((column) => !active.has(column.id)),
  ]

  return (
    <>
      {filtering.isFiltered ? null : <p className="dt-filter-note">{labels.noFilters}</p>}

      <ul className="dt-panel-list">
        {ordered.map((column) => {
          const condition = filtering.conditions.find((entry) => entry.field === column.id)
          const open = openId === column.id
          return (
            <li key={column.id}>
              <button
                type="button"
                className="dt-panel-item"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : column.id)}
              >
                <span className="dt-panel-label">
                  {columnLabel(column.id, column.columnDef.header)}
                </span>
                {column.getIsVisible() ? null : (
                  <span className="dt-filter-badge">{labels.hiddenColumn}</span>
                )}
                {condition ? (
                  <span className="dt-filter-summary">{describeCondition(condition, labels)}</span>
                ) : null}
              </button>

              {open ? (
                <FilterEditor
                  instance={instance}
                  column={column}
                  labels={labels}
                  autoFocus={column.id === focusColumnId}
                />
              ) : null}
            </li>
          )
        })}
      </ul>

      <div className="dt-panel-foot">
        <button
          type="button"
          className="dt-link"
          disabled={!filtering.isFiltered}
          onClick={filtering.clearAll}
        >
          {labels.clearAllFilters}
        </button>
      </div>
    </>
  )
}
```

Create `src/components/TablePanel.tsx`:

```tsx
import type { RowData } from "@tanstack/react-table"
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react"
import type { DropSide } from "../core/reorder"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { ColumnsTab } from "./ColumnsTab"
import { FiltersTab } from "./FiltersTab"

/**
 * The side panel behind the "Columns" button.
 *
 * It owns what both tabs share — the outside-click and Escape handling, the
 * tab strip, and the one scrolling box — and nothing else. Which tab is
 * showing is the caller's state, so a header-menu item or a host's own control
 * can open the panel straight onto one of them.
 */

/** Which half of the panel is showing. */
export type PanelTab = "columns" | "filters"

const TABS: readonly PanelTab[] = ["columns", "filters"]

export interface TablePanelProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
  onClose: () => void
  /** Which tab is showing. */
  tab: PanelTab
  onTabChange: (tab: PanelTab) => void
  /** On the Filters tab, open this column's editor and focus it. */
  focusColumnId?: string | undefined
}

export function TablePanel<TData extends RowData>({
  instance,
  labels,
  onReorder,
  onClose,
  tab,
  onTabChange,
  focusColumnId,
}: TablePanelProps<TData>) {
  const ref = useRef<HTMLDivElement>(null)
  const tabbed = instance.filtering.enabled
  // With filtering off there is no second tab, and no strip to choose it with.
  const current: PanelTab = tabbed ? tab : "columns"

  // Close on outside click and on Escape, the two things a user will try.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [onClose])

  /*
   * Arrow keys move between tabs, which is what a screen-reader user expects
   * of a tablist; the roving `tabIndex` below is the other half of that
   * pattern, so Tab enters the strip once rather than once per tab.
   */
  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const next = TABS[(TABS.indexOf(current) + delta + TABS.length) % TABS.length]
    if (next === undefined) return
    onTabChange(next)
    ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus()
  }

  return (
    <div
      className="dt-panel"
      ref={ref}
      role="dialog"
      aria-label={current === "columns" ? labels.columnsTitle : labels.filtersTab}
    >
      {tabbed ? (
        <div className="dt-panel-tabs" role="tablist" onKeyDown={handleTabKeyDown}>
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              data-tab={name}
              id={`${instance.id}-tab-${name}`}
              className="dt-panel-tab"
              aria-selected={current === name}
              aria-controls={`${instance.id}-panel-${name}`}
              tabIndex={current === name ? 0 : -1}
              onClick={() => onTabChange(name)}
            >
              {name === "columns" ? labels.columnsTitle : labels.filtersTab}
            </button>
          ))}
        </div>
      ) : null}

      {/* The one scrolling box: the strip above it stays put. */}
      <div
        className="dt-panel-body"
        id={`${instance.id}-panel-${current}`}
        {...(tabbed
          ? { role: "tabpanel", "aria-labelledby": `${instance.id}-tab-${current}` }
          : {})}
      >
        {current === "filters" ? (
          <FiltersTab instance={instance} labels={labels} focusColumnId={focusColumnId} />
        ) : (
          <ColumnsTab instance={instance} labels={labels} onReorder={onReorder} />
        )}
      </div>
    </div>
  )
}
```

Replace the whole of `src/components/ColumnPanel.tsx` with the wrapper:

```tsx
import type { RowData } from "@tanstack/react-table"
import { useState } from "react"
import type { DropSide } from "../core/reorder"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { TablePanel, type PanelTab } from "./TablePanel"

/**
 * The panel behind the "Columns" button, opened on its Columns tab.
 *
 * Kept as its own export with the same four props it has always had: it is
 * part of the published shell, and a host rendering it should not have to
 * learn about tabs to keep working. A shell that wants to choose the tab — or
 * to open the panel on one column's filter — renders {@link TablePanel}.
 */
interface ColumnPanelProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
  onClose: () => void
}

export function ColumnPanel<TData extends RowData>(props: ColumnPanelProps<TData>) {
  const [tab, setTab] = useState<PanelTab>("columns")
  return <TablePanel {...props} tab={tab} onTabChange={setTab} />
}
```

In `src/components/DataTable.tsx`, swap the panel import — change

```tsx
import { ColumnPanel } from "./ColumnPanel"
```

to

```tsx
import { TablePanel, type PanelTab } from "./TablePanel"
```

add the state's own type immediately above the `DataTableProps` interface:

```tsx
/**
 * Whether the side panel is open, which tab it is on, and — for a shell that
 * opens it on one column — whose filter to expand.
 */
interface PanelState {
  open: boolean
  tab: PanelTab
  focusColumnId?: string | undefined
}

```

replace the panel's state line

```tsx
  const [panelOpen, setPanelOpen] = useState(false)
```

with

```tsx
  const [panelOpen, setPanelOpen] = useState<PanelState>({ open: false, tab: "columns" })
```

replace the toolbar button's two state-reading lines — change

```tsx
              aria-expanded={panelOpen}
              aria-haspopup="dialog"
              onClick={() => setPanelOpen((open) => !open)}
```

to

```tsx
              aria-expanded={panelOpen.open}
              aria-haspopup="dialog"
              onClick={() => setPanelOpen((state) => ({ open: !state.open, tab: state.tab }))}
```

`focusColumnId` is dropped here rather than spread through: it is a one-shot instruction from the
header menu's second item, and a panel reopened from the toolbar button should not silently expand
and focus whatever column was last filtered from a menu.

wire the header menu's second filter item — in the `<HeaderMenu … />` element Task 16 left, insert
this immediately after its `onOpenFilter={…}` prop:

```tsx
          onOpenFilterInPanel={
            canFilter(menu.columnId)
              ? () => setPanelOpen({ open: true, tab: "filters", focusColumnId: menu.columnId })
              : undefined
          }
```

(the whole state is replaced rather than spread, so opening the panel this way always lands on the
Filters tab and always expands that column, whatever the panel was showing last)

and replace the whole `{panelOpen ? ( … ) : null}` block with:

```tsx
      {panelOpen.open ? (
        <TablePanel
          instance={instance}
          labels={labels}
          onReorder={handleReorder}
          onClose={() => setPanelOpen((state) => ({ open: false, tab: state.tab }))}
          tab={panelOpen.tab}
          onTabChange={(tab) => setPanelOpen({ open: true, tab })}
          focusColumnId={panelOpen.focusColumnId}
        />
      ) : null}
```

In `src/styles.css`, make the panel a column whose body scrolls — change

```css
.dt-panel {
  position: absolute;
  inset-inline-end: 8px;
  top: 40px;
  z-index: 10;
  width: 260px;
  max-height: 340px;
  overflow: auto;
  padding: 6px;
```

to

```css
.dt-panel {
  position: absolute;
  inset-inline-end: 8px;
  top: 40px;
  z-index: 10;
  width: 260px;
  max-height: 340px;
  /*
   * The tab strip must not scroll away from under the pointer, so the panel is
   * a column and only its body scrolls.
   */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 6px;
```

add the new pieces immediately after the `.dt-panel-head` rule:

```css
.dt-panel-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.dt-panel-tabs {
  flex: none;
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--dt-border);
}

.dt-panel-tab {
  padding: 6px 8px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--dt-muted-fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.dt-panel-tab[aria-selected="true"] {
  /* Accent-as-text on --dt-bg, the same pairing `.dt-link` uses. */
  color: var(--dt-accent-text);
  border-bottom-color: var(--dt-accent);
}

.dt-panel-tab:focus-visible {
  outline: 2px solid var(--dt-focus-ring);
  outline-offset: -2px;
}

.dt-panel-foot {
  flex: none;
  display: flex;
  justify-content: flex-end;
  padding: 6px 4px 2px;
  border-top: 1px solid var(--dt-border);
}

/* One condition in words, beside the column it belongs to. */
.dt-filter-summary {
  flex: none;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dt-muted-fg);
  font-size: 11px;
}
```

give the hidden-column badge the pin badge's own look rather than a second one — change

```css
.dt-pin-badge {
```

to

```css
.dt-pin-badge,
.dt-filter-badge {
```

That grouping breaks a check that is already in the suite: `themes.test.ts`'s "pin badge
contrast" matches the rule with `/\.dt-pin-badge\s*\{([^}]*)\}/`, which an anchored `\s*\{`
makes fail against `.dt-pin-badge,\n.dt-filter-badge {` — and fail *vacuously*, since the
`?? ""` fallback would then assert on an empty string. Widen the selector half to `[^{]*`,
with a comment saying why:

```ts
    // `[^{]*` and not `\s*`: the Filters tab's `.dt-filter-badge` shares this
    // rule rather than declaring a second look of its own, so the selector is
    // a group and an anchored `\s*\{` would match nothing and pass vacuously.
    const badge = styles.match(/\.dt-pin-badge[^{]*\{([^}]*)\}/)?.[1] ?? ""
```

and add the disabled link state immediately after the `.dt-link` rule:

```css
/* "Clear all filters" with nothing to clear: still there, plainly inert. */
.dt-link:disabled {
  color: var(--dt-muted-fg);
  cursor: default;
}
```

In `src/index.ts`, add the shell's new parts immediately after the `export { ColumnPanel } …` line:

```ts
export { TablePanel } from "./components/TablePanel"
export type { PanelTab, TablePanelProps } from "./components/TablePanel"
export { ColumnsTab } from "./components/ColumnsTab"
export type { ColumnsTabProps } from "./components/ColumnsTab"
export { FiltersTab } from "./components/FiltersTab"
export type { FiltersTabProps } from "./components/FiltersTab"
```

In `README.md`, add this paragraph to the exported-parts list, immediately after the
`<QuickSearch …>` paragraph Task 12 added:

```markdown
`<TablePanel instance={instance} labels={…} tab={tab} onTabChange={setTab} onReorder={…} onClose={…} />` —
the side panel with both tabs, for a shell that wants to choose which one opens;
`<ColumnsTab>` and `<FiltersTab>` are its halves, and `<ColumnPanel>` is still
exported and still takes exactly the four props it always did, opening on the
Columns tab. The Filters tab lists every filterable column, **hidden ones
included and marked** — a hidden column's filter goes on applying and its
header is not there to say so.
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/FiltersPanel.test.tsx src/DataTable.test.tsx src/Reordering.test.tsx
pnpm typecheck && pnpm test && pnpm build
```

`DataTable.test.tsx` and `Reordering.test.tsx` drive the Columns panel — its checkbox labels, its
drag handles, its persistence — and both must pass untouched: that is what "`ColumnPanel`'s current
public props stay intact" means in practice.

`pnpm test` gains **12 tests** (`FiltersPanel.test.tsx`) and one existing case changes
meaning rather than being added, so the file count goes up by one and the test total by
twelve. The absolute totals printed in this plan are stale — the review rounds added
regression tests — so check the count before and after rather than matching a number:
this task ran 532 → 544 across 39 → 40 files.

- [ ] **Step 5: Commit**

```bash
git add src/components/TablePanel.tsx src/components/ColumnsTab.tsx src/components/FiltersTab.tsx src/components/ColumnPanel.tsx src/components/DataTable.tsx src/styles.css src/index.ts src/FiltersPanel.test.tsx src/FilterPopover.test.tsx src/themes/themes.test.ts README.md
git commit -m "feat(filters): a Filters tab beside the Columns tab in the side panel"
git push origin khojiakbar
```

---

### Task 18: Values lists, from the data and from the host

**Files:**
- Create: `src/components/FilterValues.tsx`
- Modify: `src/components/FilterEditor.tsx`
- Modify: `src/useDataTable.ts`
- Modify: `src/styles.css`
- Modify: `src/index.ts`
- Modify: `README.md`
- Modify: `src/FilterEditor.test.tsx` — its list-column case asserts the Task 15
  placeholder (`noValues` for a client-mode `tag` column that faceting can now
  fill), so it has to become an assertion about the real list. Rewrite it, never
  delete it: the count must not go down.
- Test: `src/FilterValues.test.tsx`

The checkbox list a `list` column gets, and the one place this stage adds a new async surface.
§5.3's precedence is the whole design, and it is an **either/or, not a fallback chain that ends in
an empty list**:

1. `meta.values`, wherever it is declared, in both modes — shown **without counts**, because the
   host supplied labels rather than data.
2. Otherwise, in client mode, faceting, **with counts**. `getFacetedRowModel()` already applies the
   *other* columns' filters while excluding this column's own, which is the narrowing behaviour a
   user expects from Excel and AG Grid, in MIT code we already ship.
3. Otherwise, in server mode, `loadValues`.

A column with none of the three is **disabled with an explanatory label**, never an empty checkbox
list: silence there reads as "there is no data". The same rule is why a values request keeps the
previous result on screen — dimmed and `aria-busy` while a new one is in flight, and kept with a
failure line and a retry when one is rejected — rather than blanking. This is the one new async
surface in the stage, so it owes all four states, and it pays them with the vocabulary the rows
already have: the 0.6 opacity of `.dt-loading tbody`, and `loadFailed`/`retry`'s own treatment.

Two traps worth naming before you write it:

- **Facet keys are raw accessor values, not `FilterValue`.** With no `columnDef.getUniqueValues`,
  TanStack keys the Map on whatever the accessor returned — a `Date`, an object, an array element.
  A checkbox built straight from that Map would put a non-JSON value into a condition, and then
  `layoutSliceEqual` treats any two `Date`s as equal (§3.4) and ticking a different date is dropped
  as a no-op. A column whose facets are not JSON primitives does not fall back to faceting at all.
- **"(Blanks)" is an operator, not a member.** Ticking it emits `{ op: "blank" }`. Do not reach for
  `{ op: "in", values: [null] }`: it matches nullish rows client-side and returns nothing
  server-side, because `NULL = ANY(ARRAY[NULL])` is `NULL` and never true. A list condition carries
  a value set **or** blankness, never both — so ticking one drops the other.

- [ ] **Step 1: Write the failing test**

Create `src/FilterValues.test.tsx`:

```tsx
import { createColumnHelper } from "@tanstack/react-table"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/FilterValues.test.tsx
```

Every case fails. The first reports `Unable to find a label with the text of: closed` — the list
editor still renders Task 15's placeholder notice, so the only thing on screen is
"No values to choose from".

- [ ] **Step 3: Implement**

Create `src/components/FilterValues.tsx`:

```tsx
import type { Column, RowData } from "@tanstack/react-table"
import { useCallback, useEffect, useState } from "react"
import { columnLabel } from "../core/columnLabel"
import type { ListDraft } from "../core/filterDraft"
import { isFilterValue, type FilterValue, type FilterValueOption } from "../core/filters"
import { useDebouncedValue } from "../core/useDebouncedValue"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

/**
 * The checkbox list a `list` column is filtered with.
 *
 * Its choices come from exactly one source (§5.3): `meta.values` wherever it is
 * declared, otherwise client-side faceting with its free counts, otherwise
 * `loadValues` in server mode. A column with none of the three is disabled
 * with a label — never an empty list, which reads as "there is no data".
 */

/** How long a values search waits before the host is asked again. */
const VALUES_SEARCH_DEBOUNCE_MS = 300

/** Numeric-aware, so 9 sorts before 10 rather than after it. */
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

export interface FilterValuesProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  column: Column<DataTableFeatures, TData, unknown>
  labels: DataTableLabels
  draft: ListDraft
  /** Ticking is a discrete act, so the new draft is applied at once (§6.2). */
  onDraft: (draft: ListDraft) => void
}

export function FilterValues<TData extends RowData>({
  instance,
  column,
  labels,
  draft,
  onDraft,
}: FilterValuesProps<TData>) {
  const [needle, setNeedle] = useState("")
  // Debounced only where it costs a request; the local filter below is instant.
  const search = useDebouncedValue(needle, VALUES_SEARCH_DEBOUNCE_MS)
  const name = columnLabel(column.id, column.columnDef.header)

  /*
   * One source, in §5.3's order. Faceting is deliberately not memoised: it is
   * already memoised inside TanStack, only one editor is open at a time, and a
   * dependency list here would have to name every filter on every other column
   * — the very thing `getFacetedRowModel()` narrows by.
   */
  const declared = column.columnDef.meta?.values
  const facets = declared === undefined && instance.mode === "client" ? facetOptions(column) : null
  const usesServer =
    declared === undefined &&
    facets === null &&
    instance.mode === "server" &&
    instance.filtering.loadValues !== undefined
  const loaded = useLoadedValues(instance, column.id, search, usesServer)

  const options = declared ?? facets?.options ?? loaded.options
  const hasSource = declared !== undefined || facets !== null || usesServer
  if (!hasSource) return <p className="dt-filter-note">{labels.noValues}</p>

  /*
   * Filtered locally in both modes: server-side the host has already narrowed
   * the list, but the previous result stays on screen while a new one is in
   * flight, and it should narrow with the box rather than lag behind it.
   */
  const visible = options.filter(
    (option) =>
      needle === "" ||
      String(option.label ?? option.value)
        .toLowerCase()
        .includes(needle.toLowerCase()),
  )
  const blankSelected = draft.op === "blank"
  const allSelected =
    visible.length > 0 && visible.every((option) => draft.values.includes(option.value))
  /** A value set and blankness cannot both be carried, so choosing one drops the other. */
  const valueOp = draft.op === "blank" || draft.op === "notBlank" ? "in" : draft.op

  const toggleValue = (value: FilterValue, on: boolean) => {
    const values = on
      ? [...draft.values, value]
      : draft.values.filter((member) => member !== value)
    onDraft({ kind: "list", op: valueOp, values })
  }

  return (
    <div className="dt-values">
      <input
        type="search"
        className="dt-filter-input"
        aria-label={`${name}: ${labels.searchValues}`}
        placeholder={labels.searchValues}
        value={needle}
        onChange={(event) => setNeedle(event.target.value)}
      />

      {loaded.failed ? (
        <p className="dt-values-failed">
          <span>{labels.valuesFailed}</span>
          <button type="button" className="dt-link" onClick={loaded.retry}>
            {labels.retry}
          </button>
        </p>
      ) : null}

      {/*
        The in-flight state, and the fourth of the four this surface owes: the
        previous answer stays on screen while a new one is requested (§6.3), so
        the list must say it is stale rather than go blank or silently lie.
        `aria-busy` carries both halves — assistive technology hears it, and the
        stylesheet dims the list off the same attribute, with the 0.6 opacity
        and 200ms ease `.dt-loading tbody` already uses for the rows.
      */}
      <ul className="dt-values-list" aria-busy={loaded.loading}>
        <li className="dt-values-item">
          <label className="dt-values-label">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(event) =>
                onDraft({
                  kind: "list",
                  op: valueOp,
                  values: event.target.checked ? visible.map((option) => option.value) : [],
                })
              }
            />
            <span>{labels.selectAll}</span>
          </label>
        </li>

        <li className="dt-values-item">
          <label className="dt-values-label">
            <input
              type="checkbox"
              checked={blankSelected}
              onChange={(event) =>
                /*
                 * Blankness is an operator, not a member: `{ op: "in", values:
                 * [null] }` matches nullish rows on the client and returns
                 * nothing on the server, because `NULL = ANY(ARRAY[NULL])` is
                 * NULL and never true.
                 */
                onDraft(
                  event.target.checked
                    ? { kind: "list", op: "blank", values: [] }
                    : { kind: "list", op: "in", values: [] },
                )
              }
            />
            <span>{labels.blanks}</span>
          </label>
          {facets === null || facets.blanks === 0 ? null : (
            <span className="dt-values-count">{facets.blanks}</span>
          )}
        </li>

        {visible.map((option) => (
          <li key={`${typeof option.value}:${String(option.value)}`} className="dt-values-item">
            <label className="dt-values-label">
              <input
                type="checkbox"
                checked={draft.values.includes(option.value)}
                onChange={(event) => toggleValue(option.value, event.target.checked)}
              />
              <span>{option.label ?? String(option.value)}</span>
            </label>
            {option.count === undefined ? null : (
              <span className="dt-values-count">{option.count}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * A column's distinct values and their counts, from client-side faceting.
 *
 * `getFacetedUniqueValues()` keys its Map on whatever the accessor returned —
 * a Date, an object, an array element — and a value outside `FilterValue`
 * cannot become a condition: `layoutSliceEqual` treats any two Dates as equal
 * (§3.4), so ticking a different date would be dropped as a no-op. A column
 * whose facets are not JSON primitives does not fall back to faceting at all.
 *
 * @param column - The column being edited.
 * @returns Its options and how many rows are blank, or null when the facets
 *   could never become conditions.
 */
function facetOptions<TData extends RowData>(
  column: Column<DataTableFeatures, TData, unknown>,
): { options: FilterValueOption[]; blanks: number } | null {
  const entries: [unknown, number][] = Array.from(column.getFacetedUniqueValues())
  const options: FilterValueOption[] = []
  let blanks = 0
  for (const [value, count] of entries) {
    // Blankness is an operator, not a member, so a nullish facet is counted
    // rather than listed.
    if (value === null || value === undefined || value === "") {
      blanks += count
      continue
    }
    if (!isFilterValue(value)) return null
    options.push({ value, count })
  }
  options.sort((a, b) => COLLATOR.compare(String(a.value), String(b.value)))
  return { options, blanks }
}

/** A values request's four states, as {@link useLoadedValues} tracks them. */
interface LoadedValues {
  options: FilterValueOption[]
  loading: boolean
  failed: boolean
  retry: () => void
}

/**
 * The host's answer for one column, kept across a new request.
 *
 * A facet request is not a page request and does not share its cache key. A
 * rejected one keeps whatever was already on screen and raises `failed`:
 * falling back to an empty list is the same "there is no data" lie §5.3
 * rejects for a column with no callback at all.
 *
 * @param instance - The table instance, for its `loadValues`.
 * @param columnId - Which column's values to ask for.
 * @param search - The editor's search box, already debounced.
 * @param enabled - False when another source supplies the list.
 * @returns The options, whether one is in flight, whether the last one failed,
 *   and a retry.
 */
function useLoadedValues<TData extends RowData>(
  instance: DataTableInstance<TData>,
  columnId: string,
  search: string,
  enabled: boolean,
): LoadedValues {
  const { loadValues } = instance.filtering
  const [state, setState] = useState<{
    options: FilterValueOption[]
    loading: boolean
    failed: boolean
  }>({ options: [], loading: false, failed: false })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  useEffect(() => {
    if (!enabled || loadValues === undefined) return
    const controller = new AbortController()
    let cancelled = false
    setState((current) => ({ ...current, loading: true, failed: false }))
    loadValues(columnId, { search, signal: controller.signal })
      .then((options) => {
        if (!cancelled) setState({ options, loading: false, failed: false })
      })
      .catch(() => {
        if (!cancelled) setState((current) => ({ ...current, loading: false, failed: true }))
      })
    return () => {
      cancelled = true
      // A superseded request is aborted, so a slow first answer cannot land
      // on top of a faster second one.
      controller.abort()
    }
  }, [enabled, loadValues, columnId, search, attempt])

  return { ...state, retry }
}
```

In `src/components/FilterEditor.tsx`, import the list — add one line beneath the
existing `../types` import:

```tsx
import { FilterValues } from "./FilterValues"
```

The file already imports `Column`/`RowData` from `@tanstack/react-table` and
`DataTableFeatures`/`DataTableInstance`/`DataTableLabels`, which is everything
the generic `DraftFields` below needs; re-importing them would be a duplicate
identifier.

give `DraftFields` the two things a values list needs — replace

```tsx
interface DraftFieldsProps {
  draft: FilterDraft
  /** The column's name, so every field says which column it belongs to. */
  name: string
  labels: DataTableLabels
  autoFocus: boolean
  onDraft: (draft: FilterDraft) => void
  onCommit: (draft: FilterDraft) => void
}
```

with

```tsx
interface DraftFieldsProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  column: Column<DataTableFeatures, TData, unknown>
  draft: FilterDraft
  /** The column's name, so every field says which column it belongs to. */
  name: string
  labels: DataTableLabels
  autoFocus: boolean
  onDraft: (draft: FilterDraft) => void
  onCommit: (draft: FilterDraft) => void
}
```

change its signature from

```tsx
function DraftFields({ draft, name, labels, autoFocus, onDraft, onCommit }: DraftFieldsProps) {
```

to

```tsx
function DraftFields<TData extends RowData>({
  instance,
  column,
  draft,
  name,
  labels,
  autoFocus,
  onDraft,
  onCommit,
}: DraftFieldsProps<TData>) {
```

replace the placeholder branch

```tsx
  if (draft.kind === "list") {
    /*
     * Task 18 replaces this with the real values list. Until then a list
     * column has no source of choices in either mode, which is exactly what
     * this line says: §5.3 refuses to show an empty checkbox list, because
     * silence there reads as "there is no data".
     */
    return <p className="dt-filter-note">{labels.noValues}</p>
  }
```

with

```tsx
  if (draft.kind === "list") {
    // Ticking a value is a discrete act, so it goes through `choose`: applied
    // at once, like an operator choice and unlike a keystroke (§6.2).
    return (
      <FilterValues
        instance={instance}
        column={column}
        labels={labels}
        draft={draft}
        onDraft={choose}
      />
    )
  }
```

and pass the two new props at the call site — the `<DraftFields … />` element becomes:

```tsx
      <DraftFields
        instance={instance}
        column={column}
        draft={draft}
        name={name}
        labels={labels}
        autoFocus={autoFocus && !focusSelect}
        onDraft={setDraft}
        onCommit={commit}
      />
```

In `src/useDataTable.ts`, forward the callback — add it to `filteringApi` immediately after the
`kinds` member Task 14 added:

```ts
      kinds: filterKinds,
      /*
       * Forwarded so a values editor can reach it. Never called in client
       * mode, where faceting computes the list for free and for nothing; in
       * server mode it is the only source of choices a host can supply.
       */
      loadValues: filteringOptions?.loadValues,
      conditions: layout.filters as readonly FilterCondition[],
```

with the callback added to that memo's dependency array, which becomes:

```ts
    [
      filteringEnabled,
      filterKinds,
      filteringOptions?.loadValues,
      layout.filters,
      layout.search,
      setCondition,
      clearColumn,
      clearAll,
      updateSearch,
      setModel,
    ],
```

In `src/styles.css`, add the values list at the end of the filter-editor section, after the
`.dt-filter-note` rule:

```css
.dt-values {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dt-values-list {
  list-style: none;
  margin: 0;
  padding: 0;
  /* Long enough to be worth scrolling, short enough to leave the popover a
     shape. A high-cardinality column is what the search box above is for. */
  max-height: 180px;
  overflow: auto;
}

/*
 * A list showing the previous answer while a new one is in flight: the same
 * dimming `.dt-loading tbody` gives the rows, so the one async surface this
 * stage adds reads the way the one the table already had does. Driven off
 * `aria-busy` rather than a class, so the visual state and the announced one
 * cannot come apart.
 */
.dt-values-list[aria-busy="true"] {
  opacity: 0.6;
  transition: opacity 200ms ease;
}

.dt-values-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}

.dt-values-label {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  cursor: pointer;
}

.dt-values-count {
  flex: none;
  color: var(--dt-muted-fg);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/*
 * The same failure treatment the rows already have: what failed, and a way to
 * try again. Never an empty list, which would read as "there is no data".
 */
.dt-values-failed {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--dt-muted-fg);
  font-size: 12px;
}
```

In `src/index.ts`, add the component beside the editor and the popover:

```ts
export { FilterValues } from "./components/FilterValues"
export type { FilterValuesProps } from "./components/FilterValues"
```

In `README.md`, add this to the **Server-side data** section, at the end of the "Filters on the
wire" subsection Task 10 finished:

```markdown
**A values filter's choices come from exactly one source**, in this order:
`meta.values` on the column, wherever it is declared and in either mode, shown
without counts; otherwise, in client mode, the data itself, with counts, and
narrowed by whatever the *other* columns are filtered by; otherwise, in server
mode, `filtering.loadValues(columnId, { search, signal })`. A server-mode list
column with neither is disabled with a label rather than shown an empty list —
an empty list reads as "there is no data". While a request is out the previous
answer stays on screen, dimmed and `aria-busy`, and a rejected one keeps it and
offers a retry; `signal` aborts a superseded request. Declaring `meta.values` on
a client-mode column trades the free counts for fixed labels, which is a real
trade.
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/FilterValues.test.tsx src/FilterEditor.test.tsx src/ServerMode.test.tsx
pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` must add **9 tests** to whatever the suite already reports — the
printed absolute totals in this plan are stale, because the review rounds added
regression tests of their own. Count before and after rather than matching a
number. (Run of record: 550 across 40 files → 559 across 41.)

- [ ] **Step 5: Commit**

```bash
git add src/components/FilterValues.tsx src/components/FilterEditor.tsx src/useDataTable.ts src/styles.css src/index.ts src/FilterValues.test.tsx src/FilterEditor.test.tsx README.md
git commit -m "feat(filters): values lists from faceting and from the host"
git push origin khojiakbar
```

---

### Task 19: The way out, the demo, and the hand-off

**Files:**
- Modify: `src/components/DataTable.tsx`
- Modify: `src/styles.css`
- Modify: `src/demo/Demo.tsx`
- Modify: `src/demo/ServerDemo.tsx`
- Modify: `src/demo/fakeServer.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Test: `src/NoMatches.test.tsx`

`showEmpty` says "No rows" whether the table has no data or the filter excluded everything. Those
are different situations, and the second one needs a way out — an empty state with no exit is the
classic filter dead end. That is the last piece of UI this stage owes.

The demo is the other half of the task, and it is not decoration: the fake server is where the wire
contract is *shown* to carry its own meaning. It translates each condition the way §3.1 and §3.2
say a backend must — case-insensitive text, a blank value failing every comparison, `between`
inclusive at both ends, a date range inclusive at the bottom and **exclusive at the top** — and it
answers facet requests on their own lifecycle.

The accessibility pass is the README's own list plus the browser walk in Step 6; the surfaces
themselves were built with their roles, labels, focus handling and keyboard paths in Tasks 15–18,
which is where they belong rather than as a sweep afterwards.

- [ ] **Step 1: Write the failing test**

Create `src/NoMatches.test.tsx`:

```tsx
import { createColumnHelper } from "@tanstack/react-table"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import type { FilterCondition } from "./core/filters"
import { useDataTable, type DataTableFeatures } from "./useDataTable"
import type { TableLayout } from "./types"

/**
 * "No rows" and "no rows match" are different situations, and only one of them
 * has a way out.
 */

interface Row {
  id: string
  name: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 100 })]
const data: Row[] = [
  { id: "r0", name: "Agro Ltd" },
  { id: "r1", name: "Temir" },
]
const matchesNothing: FilterCondition = {
  kind: "text",
  field: "name",
  op: "contains",
  value: "zzzz",
}

function Table({
  rows = data,
  initialLayout,
  custom = false,
}: {
  rows?: Row[]
  initialLayout?: Partial<TableLayout>
  custom?: boolean
}) {
  const instance = useDataTable<Row>({
    id: "empty",
    columns,
    data: rows,
    getRowId: (row) => row.id,
    ...(initialLayout === undefined ? {} : { initialLayout }),
  })
  return (
    <DataTable
      instance={instance}
      virtualize={false}
      {...(custom ? { emptyState: <p>Nothing here</p> } : {})}
    />
  )
}

const shown = () => screen.queryAllByRole("row").filter((row) => row.classList.contains("dt-tr"))

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

describe("the filtered-empty state", () => {
  it("says a filter excluded everything, and offers a way out", () => {
    render(<Table initialLayout={{ filters: [matchesNothing] }} />)

    expect(shown()).toHaveLength(0)
    expect(screen.getByText("No rows match the current filters")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument()
  })

  it("brings the rows back from the empty state itself", () => {
    vi.useFakeTimers()
    render(<Table initialLayout={{ filters: [matchesNothing], search: "zzzz" }} />)

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    /*
     * The search goes with the filters — an exit that left one of them on
     * would still show an empty table — but it reaches the row model on the
     * same debounce every other search change does, so the timers have to run
     * before the rows can be counted.
     */
    act(() => vi.advanceTimersByTime(300))

    expect(shown()).toHaveLength(2)
    expect(screen.queryByText("No rows match the current filters")).toBeNull()
  })

  it("still says no rows when the table simply has none", () => {
    render(<Table rows={[]} />)

    expect(screen.getByText("No rows")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull()
  })

  it("leaves a host's own empty state alone in both cases", () => {
    render(<Table rows={[]} custom />)
    expect(screen.getByText("Nothing here")).toBeInTheDocument()

    render(<Table initialLayout={{ filters: [matchesNothing] }} custom />)
    expect(screen.getAllByText("Nothing here")).toHaveLength(2)
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
pnpm vitest run src/NoMatches.test.tsx
```

The first case fails with `Unable to find an element with the text: No rows match the current
filters` — the empty state still says "No rows" whatever excluded the rows. The second fails on the
missing button; the third and fourth pass already.

- [ ] **Step 3: Implement**

In `src/components/DataTable.tsx`, replace the empty state — change

```tsx
        {showEmpty ? (
          <div className="dt-empty">{emptyState ?? labels.empty}</div>
        ) : null}
```

to

```tsx
        {showEmpty ? (
          <div className="dt-empty">
            {/*
              An empty state with no exit is the classic filter dead end: "No
              rows" is true of a table with no data and of a table filtered to
              nothing, and only one of them is something the user can undo.
              A host's own `emptyState` still wins over both.
            */}
            {emptyState ??
              (instance.filtering.isFiltered ? (
                <>
                  <p className="dt-empty-text">{labels.noMatches}</p>
                  <button
                    type="button"
                    className="dt-menu-button"
                    onClick={instance.filtering.clearAll}
                  >
                    {labels.clearFilters}
                  </button>
                </>
              ) : (
                labels.empty
              ))}
          </div>
        ) : null}
```

In `src/styles.css`, add the paragraph's spacing immediately after the `.dt-empty` rule:

```css
.dt-empty-text {
  margin: 0 0 10px;
}
```

In `src/demo/fakeServer.ts`, replace the whole file with the filtering version — the row data and
the page shape are unchanged; what is new is the translation a backend would write:

```ts
import type { FilterCondition, FilterValueOption } from "../core/filters"
import type { TableQuery, TableSearch } from "../core/query"

/** One row as the fake backend would return it. */
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

/** One page of results, as `fetchReceipts` resolves it. */
export interface ServerPage {
  rows: ServerReceipt[]
  total: number
}

/**
 * How to read each column the wire can name.
 *
 * A real backend has the same map, spelled as a column list or an ORM model:
 * a condition carries a column id, and something has to turn that into a
 * column. Spelled out here so nothing in this file has to cast a row.
 */
const FIELD_READERS: Record<string, (row: ServerReceipt) => unknown> = {
  code: (row) => row.code,
  partner: (row) => row.partner,
  amount: (row) => row.amount,
  status: (row) => row.status,
  date: (row) => row.date,
}

/** `(col IS NULL OR col::text = '')`, in one predicate. */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === ""
}

/**
 * One condition, translated the way a backend would.
 *
 * Every rule here belongs to the contract rather than to this file: all six
 * text operators are case-insensitive, a blank value fails every comparison
 * rather than being coerced, `between` is inclusive on both ends, and a date
 * range is `[from, before)` — inclusive below, **exclusive** above, which is
 * what stops the last day of a range going missing.
 *
 * @param row - The row being tested.
 * @param condition - One condition off the wire.
 * @returns Whether the row satisfies it.
 */
function matchesCondition(row: ServerReceipt, condition: FilterCondition): boolean {
  const read = FIELD_READERS[condition.field]
  // A condition for a column this endpoint does not serve constrains nothing.
  if (read === undefined) return true
  const value = read(row)

  if (condition.op === "blank") return isBlank(value)
  if (condition.op === "notBlank") return !isBlank(value)
  /*
   * Blankness is the only operator that reaches a blank row. In SQL a
   * comparison against NULL is NULL rather than true, so every operator below
   * drops it — the negated ones included, which is exactly where a client
   * that implemented them as "the positive test, negated" would disagree.
   */
  if (isBlank(value)) return false

  switch (condition.kind) {
    case "text": {
      if (!("value" in condition)) return true
      const text = String(value).toLowerCase()
      const needle = condition.value.toLowerCase()
      const { op } = condition
      if (op === "contains") return text.includes(needle)
      if (op === "notContains") return !text.includes(needle)
      if (op === "equals") return text === needle
      if (op === "notEquals") return text !== needle
      if (op === "startsWith") return text.startsWith(needle)
      return text.endsWith(needle)
    }
    case "number": {
      const amount = Number(value)
      if ("from" in condition) {
        return (
          (condition.from === null || amount >= condition.from) &&
          (condition.to === null || amount <= condition.to)
        )
      }
      if (!("value" in condition)) return true
      const bound = condition.value
      const { op } = condition
      if (op === "eq") return amount === bound
      if (op === "ne") return amount !== bound
      if (op === "lt") return amount < bound
      if (op === "lte") return amount <= bound
      if (op === "gt") return amount > bound
      return amount >= bound
    }
    case "date": {
      if (!("from" in condition)) return true
      // These rows store `YYYY-MM-DD`, which compares chronologically as a
      // string. A real `date` or `timestamptz` column compares as itself, with
      // the same two clauses.
      const day = String(value)
      return (
        (condition.from === null || day >= condition.from) &&
        (condition.before === null || day < condition.before)
      )
    }
    case "boolean":
      return !("value" in condition) || value === condition.value
    case "list":
      if (!("values" in condition)) return true
      return condition.op === "in"
        ? condition.values.some((member) => member === value)
        : !condition.values.some((member) => member === value)
  }
}

/**
 * Quick search, translated the way a backend would.
 *
 * AND over tokens, OR over fields: every token must appear in at least one of
 * `fields`, and different tokens may match different columns. The naive
 * `includes(text)` across the fields disagrees with client mode the moment a
 * user types two words.
 *
 * @param row - The row being tested.
 * @param search - The search off the wire, or null when it is off.
 * @returns Whether the row satisfies it.
 */
function matchesSearch(row: ServerReceipt, search: TableSearch | null): boolean {
  if (search === null) return true
  const tokens = search.text.split(/\s+/).filter((token) => token !== "")
  return tokens.every((token) =>
    search.fields.some((field) => {
      const read = FIELD_READERS[field]
      if (read === undefined) return false
      return String(read(row) ?? "").toLowerCase().includes(token.toLowerCase())
    }),
  )
}

/**
 * Filter, search, sort, slice and reply after a delay — the way a real
 * endpoint would.
 *
 * @param query - The current filters, search, sort and page, built by {@link useDataTable}.
 * @param options - `fail` simulates a network error; `delayMs` simulates latency.
 * @returns The requested page of rows plus the total that matched.
 *
 * @example
 * const page = await fetchReceipts(query)
 */
export function fetchReceipts(
  query: TableQuery,
  options: { fail?: boolean; delayMs?: number } = {},
): Promise<ServerPage> {
  const { fail = false, delayMs = 300 } = options
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (fail) {
        reject(new Error("Simulated network failure"))
        return
      }
      const matched = ALL.filter(
        (row) =>
          query.filters.every((condition) => matchesCondition(row, condition)) &&
          matchesSearch(row, query.search),
      )
      const sorted = [...matched]
      const [sort] = query.sorting
      if (sort) {
        const key = sort.id as keyof ServerReceipt
        sorted.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (sort.desc ? -1 : 1))
      }
      const { pageIndex, pageSize } = query.pagination
      // The total is what matched, not what exists: it is what the footer
      // counts and what the page clamp is measured against.
      resolve({ rows: sorted.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize), total: matched.length })
    }, delayMs)
  })
}

/**
 * Distinct values for one column, for a values filter in server mode.
 *
 * A facet request is not a page request: its own query, its own latency, its
 * own cache key. `signal` aborts a superseded one, which is what keeps a slow
 * first answer from landing on top of a faster second.
 *
 * @param columnId - The column whose values are wanted.
 * @param options - The editor's search box, and an abort signal.
 * @returns Every distinct value that matches, with its count.
 */
export function fetchValues(
  columnId: string,
  options: { search: string; signal: AbortSignal },
): Promise<FilterValueOption[]> {
  const read = FIELD_READERS[columnId]
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (read === undefined) {
        resolve([])
        return
      }
      const needle = options.search.toLowerCase()
      const counts = new Map<string, number>()
      for (const row of ALL) {
        const value = String(read(row) ?? "")
        if (value === "") continue
        if (needle !== "" && !value.toLowerCase().includes(needle)) continue
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
      resolve([...counts].map(([value, count]) => ({ value, count })))
    }, 250)
    options.signal.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    })
  })
}
```

In `src/demo/ServerDemo.tsx`, import the facet endpoint — change

```tsx
import { fetchReceipts, type ServerPage, type ServerReceipt } from "./fakeServer"
```

to

```tsx
import { fetchReceipts, fetchValues, type ServerPage, type ServerReceipt } from "./fakeServer"
```

give the status column a values filter and the date column a date one — change

```tsx
  columnHelper.accessor("status", { header: "Holat", size: 130 }),
  columnHelper.accessor("date", { header: "Sana", size: 120 }),
```

to

```tsx
  // In server mode there is nothing to facet from — one page is all the client
  // holds — so the values list comes from `loadValues` below.
  columnHelper.accessor("status", { header: "Holat", size: 130, meta: { filter: "list" } }),
  columnHelper.accessor("date", { header: "Sana", size: 120, meta: { filter: "date" } }),
```

and hand the callback to the hook — change

```tsx
    getRowId: (row) => row.id,
    onQueryChange: setQuery,
    storage,
  })
```

to

```tsx
    getRowId: (row) => row.id,
    onQueryChange: setQuery,
    storage,
    filtering: { loadValues: fetchValues },
  })
```

In `src/demo/Demo.tsx`, declare the client demo's filter kinds — change

```tsx
          receiptCols.accessor("warehouse", { header: "Ombor", size: 170 }),
          receiptCols.accessor("date", { header: "Sana", size: 120 }),
```

to

```tsx
          receiptCols.accessor("warehouse", { header: "Ombor", size: 170, meta: { filter: "list" } }),
          receiptCols.accessor("date", { header: "Sana", size: 120, meta: { filter: "date" } }),
```

change

```tsx
          receiptCols.accessor("quantity", {
            header: "Miqdor",
            size: 130,
            cell: (info) => <span className="num">{qty.format(info.getValue())}</span>,
          }),
```

to

```tsx
          receiptCols.accessor("quantity", {
            header: "Miqdor",
            size: 130,
            // Numbers are searched by default; this one is noise in a search
            // box, so it opts out while keeping its number filter.
            meta: { searchable: false },
            cell: (info) => <span className="num">{qty.format(info.getValue())}</span>,
          }),
```

change

```tsx
      receiptCols.accessor("status", { header: "Holat", size: 130 }),
```

to

```tsx
      receiptCols.accessor("status", { header: "Holat", size: 130, meta: { filter: "list" } }),
```

and tell the reader what to try — change the lede paragraph

```tsx
      <p className="lede">
        Drag a header to reorder. Drag its right edge to resize, double-click the edge to
        fit the column to its content. Click a header to sort, click again to reverse. Use{" "}
        <b>Columns</b> to pin or hide. Both tables remember their own layout — rearrange one,
        reload, and the other is exactly as you left it.
      </p>
```

to

```tsx
      <p className="lede">
        Drag a header to reorder. Drag its right edge to resize, double-click the edge to
        fit the column to its content. Click a header to sort, click again to reverse. Use{" "}
        <b>Columns</b> to pin or hide, or its <b>Filters</b> tab to see every filter at once.
        Type in the search box to search every text column, or open a column's ⋮ menu and choose{" "}
        <b>Filter…</b>. Both tables remember their own layout — and their filters — so rearrange
        one, reload, and the other is exactly as you left it.
      </p>
```

In `README.md`, add two rows to the **What it does** table, immediately after the `**Sort**` row:

```markdown
| **Quick search** | One box over every searchable column. Every token must appear somewhere on the row; different tokens may match different columns. |
| **Filter columns** | Text, number, date, boolean and values-list filters, from the header menu or the side panel's Filters tab. Each one is published as an explicit operator a backend can translate. |
```

and replace the **Accessibility** section's list — insert these bullets immediately after the
"The per-column menu opens from a button as well as from right-click…" bullet:

```markdown
- The quick-search box announces its result count politely and never takes focus.
- The header menu's **Filter…** item opens a popover rather than putting form controls inside a
  `role="menu"`, which would be invalid. The popover is a labelled `role="dialog"`, keeps `Tab`
  inside itself, closes on `Escape` **discarding the draft**, and returns focus to the column's ⋮
  button. **Filter in panel…** beside it opens the side panel's Filters tab instead, with that
  column's editor expanded and focused.
- A filtered column is marked in its header with a labelled icon. The side panel's Filters tab
  lists hidden columns too, marked as hidden — a hidden column's filter goes on applying and has no
  header to say so.
- The panel's two tabs are a `tablist` with arrow-key movement and a single roving tab stop.
- An empty table says whether it has no rows or no *matching* rows, and the second offers a way out.
```

In `CHANGELOG.md`, append to the existing `## 0.5.0` section's `### Added` list, below the
`filterFn_dt` bullet:

```markdown
- Quick search in the toolbar (`QuickSearch`), published on a debounce, and a
  per-column filter editor reachable from the header menu (`FilterEditor`,
  `FilterPopover`) or from the side panel's new Filters tab (`TablePanel`,
  `ColumnsTab`, `FiltersTab`). `ColumnPanel` keeps the four props it always
  had and opens on the Columns tab.
- Values lists (`FilterValues`): distinct values with counts from the data in
  client mode, `filtering.loadValues` in server mode, `meta.values` in either,
  and an explanatory label rather than an empty list when a column has none.
- `instance.filtering`: `enabled`, `kinds`, `conditions`, `search`,
  `isFiltered`, `setCondition`, `clearColumn`, `clearAll`, `setSearch`,
  `getModel`, `setModel`, `loadValues`. Plus `columnLabel`,
  `useClampedPlacement` and the editors' draft helpers, for a shell of your own.
- A distinct empty state for "a filter excluded every row", with a way out of it.
```

- [ ] **Step 4: Run the checks**

```bash
pnpm vitest run src/NoMatches.test.tsx src/demo/ServerDemo.test.tsx src/LoadingStates.test.tsx
pnpm typecheck && pnpm test && pnpm build
```

`ServerDemo.test.tsx` mocks `fetchReceipts` outright, so the new filtering inside it cannot affect
that suite — but it does render `<ServerDemo />`, which now passes `filtering: { loadValues }`, so
run it deliberately rather than trusting that.

`pnpm test` must report **438 tests** (434 plus 4).

- [ ] **Step 5: Commit**

```bash
git add src/components/DataTable.tsx src/styles.css src/demo/fakeServer.ts src/demo/ServerDemo.tsx src/demo/Demo.tsx src/NoMatches.test.tsx README.md CHANGELOG.md
git commit -m "feat(filters): a way out of the filtered-empty state, and the demo end to end"
git push origin khojiakbar
```

- [ ] **Step 6: Verify the whole stage, in a browser, and hand it over**

Everything above is jsdom, which lays nothing out, paints nothing and has no ResizeObserver. Three
of this stage's decisions — the popover's z-index, its re-clamp, and the panel's non-scrolling tab
strip — are only really *seen* here.

First, the full run one more time from a clean tree:

```bash
pnpm typecheck && pnpm test && pnpm build
git status --short
git log --oneline main..khojiakbar
```

`pnpm test` reports **438 tests**, `git status` is clean, and the log shows this section's seven
commits on top of Sections A and B's twelve.

Then:

```bash
pnpm dev
```

and open the printed URL. Walk exactly this, in this order:

1. **Kirim hujjatlari** — type `agro` into the toolbar's search box. The rows narrow about a third
   of a second after you stop typing, the footer's total drops with them, and the box keeps every
   character you typed while you type. Click the `×`: every row comes back.
2. Type `agro 1005`. Rows survive where one token is in **Kontragent** and the other in **Kod** —
   tokens may match different columns.
3. Right-click the **Summa** header → **Filter…**. The menu closes and a popover opens under it.
   Choose **Between**, type `1000000` in **From**, press Tab. The rows narrow and a small funnel
   appears in the Summa header. Note that the popover grew by a field when you chose Between and
   stayed fully on screen — that is Task 13's re-measure.
4. Open **Filter…** on **Summa** again, type into a field, and press `Escape`. The popover closes,
   **nothing changed**, and focus is back on the ⋮ button.
5. **Holat** → **Filter…**. A checkbox list with a count beside each value. Tick `open` and
   `in_process`; the rows narrow. Tick **Select all**, then untick it: the column's filter is gone
   entirely, not left as an empty list.
6. Scroll the table right until Summa is under the sticky header, then open its filter again: the
   popover paints **over** the header, the pinned columns and the progress bar, not under them.
7. **Columns** → the **Filters** tab. The filtered columns are at the top, each with its condition
   in words. Open one, change it, collapse it. Scroll the list: the tab strip stays put. Press `←`
   and `→` with a tab focused — they move between the tabs. Now close the panel and take the other
   route: **Kontragent** → ⋮ → **Filter in panel…**. The panel opens straight onto the Filters tab
   with that column's editor already expanded and holding the focus, and you can type without
   touching the mouse again.
8. With Holat still filtered, hide **Holat** from its header menu. The rows stay filtered, the
   Filters tab still lists it, marked **Hidden** — and that is the only place that filter now
   exists.
9. **Clear all filters** at the foot of the tab. Everything comes back, and the tab says
   "No filters applied".
10. Type `zzzz` in the search box. The table says **No rows match the current filters** and offers
    **Clear filters**; click it and the rows return.
11. Reload the page. The filters you left on are still on — and the search box still holds its text.
12. **Server-side — 10 000 qator**: set a filter on **Holat**. Its list is fetched from the host
    (a beat of latency, then counts), one request goes out for the filter itself, and the footer's
    total is the *matched* total, not 10 000. Set a **Sana** filter to a single day and confirm rows
    on that day are included — that is the half-open range doing its job.
13. Tick **Keyingi so'rov xato bilan qaytsin** and change a filter: the error banner appears with
    **Retry**, and retrying recovers.
14. Keyboard only, from the top: Tab to a header's ⋮, `Enter`, `Enter` again on **Filter…**, type,
    `Enter` to apply. Then reopen and press Tab repeatedly — focus cycles inside the popover and
    never escapes into the table behind it.
15. Switch the OS to dark mode and check the popover, the tab strip, the filtered marker and the
    values list: every one of them is drawn with the existing tokens, so nothing should be
    invisible. If anything is, it is a token pairing bug, not a new token — see §8.1.

The last two steps are the two measurements §11 assigns to this plan. Both are taken on the
**100 000 qator — client mode, virtualizatsiya** table, which shares `receiptColumns` with the first
demo and therefore has the `Ombor` and `Holat` list filters this task just declared. Write both
numbers down; they go in the hand-off below.

16. **Faceting on a large client dataset.** Open the browser's Performance panel, start recording,
    right-click the **Ombor** header → **Filter…**, and stop once the checkbox list is on screen.
    Read two things: the wall time from the click to the paint that shows the list, and the
    `_createFacetedUniqueValues` frame inside it, which is the Map built over all 100 000 rows.
    **Ceiling: 150 ms** — above that the interaction stops feeling like a click. Over it, do not
    invent a cap here: the fix is §5.3's own first rule, which already exists — a client table this
    size declares `meta.values` on its list columns and never facets at all — and the README's
    values-list paragraph gains the measured number and that advice.
17. **The search input's keystroke cost.** Same table. Start a Performance recording, hold a key
    down in the toolbar's search box for about two seconds, and stop. Two numbers again:
    `_createFilteredRowModel` must appear **once**, after the keystrokes stop — not once per
    keystroke, which is the whole point of debouncing the published value rather than the keystroke
    (§6.2) — and **no commit over 16 ms**, so a held key never drops a frame. Over budget, the
    fallback is a `React.memo` around the row region so a keystroke re-renders the toolbar and not
    the rows; it is a follow-up to raise with the author, not a change to make during this walk.

Stop the dev server when you are done.

**Then hand it over. Do not merge.** This branch is `khojiakbar`, and everything above was pushed to
`origin/khojiakbar`. Ask the author whether to merge it into `main` and wait for an explicit yes —
a review of a 19-task stage belongs to the person who specified it. What to put in front of them:

- the branch, `origin/khojiakbar`, and `git log --oneline main..khojiakbar`;
- the test count, 270 at the start of the stage and **435** at the end;
- the two numbers from steps 16 and 17 — the facet build on 100 000 rows against its 150 ms ceiling,
  and the held-key recording's `_createFilteredRowModel` count and worst commit against 16 ms —
  because §11 asks for both by name and a risk with no number beside it is still open;
- the six places this plan decided something the spec left open, so a reviewer can disagree with
  each one on its own:
  - `instance.filtering.kinds` and `instance.filtering.loadValues`, two new members beyond §9's
    list;
  - the split between what commits instantly and what waits for blur (§6.2's own words, read as "a
    keystroke is not a decision");
  - the Columns tab's Reset taking the filter model out and putting it back, rather than a new
    `resetColumns` on the instance;
  - a 48th label key, `filterInPanel`, beyond the batch §8.5 describes — §8.3 asks for a header-menu
    item that opens the panel on one column, and an item needs a string;
  - `pruneFilters` keeping at most one condition per column, last one wins. §2 fixes the model at
    one condition per column and §7.1 makes the projection the only writer of `ColumnFilter.id`, so
    a duplicate could not round-trip; enforcing it in the one validation gate both `pruneLayout` and
    `setModel` run is this plan's reading of where that belongs;
  - the `columnFilters` projection depending on `resolvedSearchFields`. It is the only way found to
    make `createFilteredRowModel` — which memoises on the core row model, `columnFilters` and
    `globalFilter` alone — notice that hiding a column changed which columns quick search covers.
    The alternative is to accept that the client searches a hidden column the wire has dropped,
    which §3.3 states the predicate to prevent.
