# Stage 2 — Filtering: quick search, column filters, Filters panel

**Status:** design approved, ready for a plan
**Date:** 2026-09-16
**Follows:** `2026-09-15-stage1-virtualization-server-pagination-design.md` (merged as `d07b261`)

---

## 1. Goal

Give the table the filtering half of the AG Grid experience: a quick-search box in
the toolbar, a real filter per column reachable from the column header, and a
Filters tab in the side panel that lists every filterable column in one place.

The table must stay server-first. A filter is not a client-side trick that
happens to also work remotely — it is a value the host can hand to a backend and
translate into SQL without interpreting anything.

### In scope

- Quick search over the columns the host marks searchable.
- Per-column filters: text, number, date, boolean, and a values list.
- A filter editor opened from the column header menu.
- A Filters tab in the side panel, beside the existing Columns tab.
- A published filter model on `TableQuery`, with an explicit operator per
  condition.
- Filters persisted with the saved layout, with an opt-out.
- A values list sourced from the data client-side, and from a host callback in
  server mode.

### Out of scope, deliberately

- **Floating filters** — the row of small inputs under the header. Recognisable,
  but it breaks the uniform sticky-header offset every header cell computes from
  `--dt-header-height`, and it is a second view of a model that does not exist
  yet. Its own stage, after the model has settled.
- **Cross-column OR and nested condition groups.** One condition per column, all
  ANDed. See §3.6 for how OR can arrive later without breaking the wire.
- **Two conditions on one column** joined by AND/OR.
- Filter-aware row grouping, and anything else stage 4 owns.

---

## 2. Decisions taken

Recorded so the plan does not reopen them.

| Decision | Choice | Why |
|---|---|---|
| Filter surfaces | Column header menu and the side panel's Filters tab | Matches the screenshots; a floating-filter row is a separate stage |
| Wire shape | Explicit operator per condition | A backend translates it directly; an opaque value would have to be guessed at |
| Values list filter | In scope, including server mode via a host callback | Server mode is the primary use, so a client-only values filter would not serve it |
| Filter persistence | Persisted with the layout, `persist: false` to opt out | Consistent with sorting and page size, which already persist |
| Date values | Calendar day, `YYYY-MM-DD`, always emitted as a half-open range | Removes the "last day of the range is missing" bug class entirely |
| Filter logic depth | One condition per column, all ANDed | Covers the common case, maps one-to-one onto TanStack state, keeps the editors simple |
| `TableQuery` field names | Renamed to `filters` and `search` | The new shape is nothing like TanStack's, so it should not wear its name |

---

## 3. The filter model

This is the centre of the stage. Everything else is a view of it.

### 3.1 Conditions

Each condition is a discriminated union, discriminated twice: on `kind` (which
editor and which value shape) and on `op` (which arity). Both discriminations
are load-bearing — a wrong operator/value pairing must not compile.

```ts
/** A calendar day, `YYYY-MM-DD`. Never a `Date`; see §3.4. */
export type IsoDay = string

/**
 * A value a list filter can select. JSON primitives only, and deliberately
 * not `null`: blankness is an operator, not a value. See below.
 */
export type FilterValue = string | number | boolean

export type TextCondition =
  | { kind: "text"; field: string; op: "contains" | "notContains" | "equals" | "notEquals" | "startsWith" | "endsWith"; value: string }
  | { kind: "text"; field: string; op: "blank" | "notBlank" }

export type NumberCondition =
  | { kind: "number"; field: string; op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte"; value: number }
  | { kind: "number"; field: string; op: "between"; from: number | null; to: number | null }
  | { kind: "number"; field: string; op: "blank" | "notBlank" }

export type DateCondition =
  | { kind: "date"; field: string; op: "range"; from: IsoDay | null; before: IsoDay | null }
  | { kind: "date"; field: string; op: "blank" | "notBlank" }

export type BooleanCondition =
  | { kind: "boolean"; field: string; op: "is"; value: boolean }
  | { kind: "boolean"; field: string; op: "blank" | "notBlank" }

export type ListCondition =
  | { kind: "list"; field: string; op: "in" | "notIn"; values: FilterValue[] }
  | { kind: "list"; field: string; op: "blank" | "notBlank" }

export type FilterCondition =
  | TextCondition
  | NumberCondition
  | DateCondition
  | BooleanCondition
  | ListCondition

/** Which editor and which value shape. Also what `meta.filter` selects (§7.4). */
export type FilterKind = FilterCondition["kind"]
```

`field` is the column id.

**`blank` is an operator on every kind, including `list`.** It means the accessor
returned `null`, `undefined`, or `""`; `notBlank` is its complement, and the two
partition every row. `null` is not a legal member of `values` — the constructor
drops it — and ticking a "(Blanks)" row in a list editor emits a `blank`
condition instead. Without that rule an implementer reaches for
`{ op: "in", values: [null] }`, which matches nullish rows client-side and
returns nothing server-side, because `NULL = ANY(ARRAY[NULL])` is `NULL` and
never true. A list condition therefore carries a value set **or** blankness,
never both.

"Is empty" is exactly the kind of thing a client and a backend disagree about
silently, so the backend clause is pinned here the way the date one is in §3.2:

```sql
-- blank
(col IS NULL OR col::text = '')
-- notBlank
(col IS NOT NULL AND col::text <> '')
```

For a non-text column the `''` half is always false and may be dropped; the
`IS NULL` half is the whole meaning. The `IS NOT NULL` guard on `notBlank` is
not optional — a backend that writes the naive `col <> ''` silently excludes
every NULL through three-valued logic, and then `blank` and `notBlank` no longer
partition the table.

**Negated operators do not match a blank value.** `notContains`, `notEquals` and
`notIn` exclude a row whose value is nullish or `""`, because that is what
`NOT (col ILIKE …)` and `NOT (col = ANY(…))` do in SQL, where a comparison
against NULL is NULL rather than true. A client that implemented them as "the
positive test, negated" would include exactly the rows the backend drops. The
same rule covers the number comparators: a nullish value never satisfies `eq`,
`ne`, `lt`, `lte`, `gt`, `gte` or `between`. `blank` is the operator for
reaching those rows.

**`between` is inclusive on both ends**, with `null` meaning unbounded on that
side: `from <= value <= to`. That is worth stating because the date range
deliberately is not (§3.2), and because AG Grid's number `inRange` is exclusive
by default — anyone porting a backend will assume wrong unless it is written
down.

### 3.2 Dates are always a half-open range

There is one date operator on the wire, and it carries an inclusive lower bound
and an **exclusive** upper bound:

```ts
{ kind: "date", field: "created", op: "range", from: "2026-03-01", before: "2026-04-01" }
```

The editor still offers "Is / Before / After / Between" and converts:

| The user picks | The wire carries |
|---|---|
| Is 31 Mar 2026 | `from: "2026-03-31"`, `before: "2026-04-01"` |
| Before 31 Mar 2026 | `from: null`, `before: "2026-03-31"` |
| After 31 Mar 2026 | `from: "2026-04-01"`, `before: null` |
| 1–31 Mar 2026 | `from: "2026-03-01"`, `before: "2026-04-01"` |

A backend writes the same clause every time, and it is correct whether the column
is a `date` or a `timestamptz`:

```sql
(:from   IS NULL OR created >= :from)
AND (:before IS NULL OR created <  :before)
```

The bug this design exists to prevent: an inclusive `<= '2026-03-31'` against a
timestamp column silently drops every row recorded during that last day.

The table never emits a time or a zone. A day is a day in the user's calendar;
if a backend stores instants, converting the day boundary into its own zone is
the backend's job, and the README says so.

**Client-side, a day bound is parsed into the local calendar** — built from the
`YYYY-MM-DD` parts as `new Date(year, month - 1, day)`, never
`new Date("2026-03-01")`, which ES parses as **UTC** midnight. That distinction
reintroduces the very bug this operator exists to remove, in the client rather
than the backend: verified under `TZ=Asia/Tashkent`, a row at 1 Mar 02:00 local
falls before a UTC-parsed `from` of `2026-03-01` and is dropped; under
`TZ=America/Los_Angeles`, a row at 31 Mar 20:00 local falls after a UTC-parsed
`before` of `2026-04-01` and is dropped too. East of Greenwich the range loses
the first hours of its first day, west of it the last hours of its last day, and
in both cases the user sees rows they would call "1 March" or "31 March" go
missing.

For the same reason `filterFn_inDateRange` is **not** reused: it parses both
bounds and the row value through `new Date(value)`, and its comparison is
`>= min && <= max`, inclusive at both ends, so it cannot express `[from, before)`
at all.

### 3.3 Quick search

Search is its own field, not a synthetic condition, because it crosses columns
and a condition does not:

```ts
export interface TableSearch {
  /** The user's text, trimmed. Never empty — the field is `null` instead. */
  text: string
  /** Column ids the search covers, sorted by id. See §3.4. */
  fields: string[]
}
```

Semantics, identical client-side and server-side, and documented as the contract:
split `text` on whitespace; every token must appear, case-insensitively, in at
least one of `fields` on that row; tokens may match different columns.

`fields` is every **visible**, accessor-backed column whose `meta.searchable`
resolves true, where the default for `meta.searchable` is "the column's first
non-null value is a string or a number". **None of that is TanStack's default**,
and §5.1 has to state it as our own predicate:

- TanStack's `getColumnCanGlobalFilter` applies that same value-type heuristic,
  but as a gate *underneath* the flags rather than as a default a host can
  override — a host marking a `Date` column `searchable: true` would still be
  excluded by it.
- `column_getCanGlobalFilter` never consults visibility at all, so without our
  own predicate a hidden column goes on being searched client-side while `fields`
  omits it — the two modes would search different columns for the same text.
- A display column (no `accessorFn`) is excluded either way, by TanStack and by
  us. It has no value to search.

Hiding a column therefore narrows search — surprising either way, so it is
documented and overridable with `searchFields`. An empty `fields` means search is
off: the client has nothing to match against, so the wire carries `search: null`
rather than a term no backend could honour.

### 3.4 Everything on the wire is JSON

Not a style preference. `queriesEqual` compares queries with `JSON.stringify`,
and `layoutSliceEqual` decides whether a layout write is a no-op. Both break on
non-JSON values in ways that present as "filtering sometimes does nothing":

- A `Set` stringifies to `{}` whatever it holds, so two different value lists
  compare equal and the table stops refetching.
- Two different `Date` objects are structurally equal to `layoutSliceEqual`, so a
  date change is dropped as a no-op.
- An `undefined` member disappears from the string, so two different conditions
  compare equal.

So: dates are `YYYY-MM-DD` strings, lists are arrays of JSON primitives, and
absent bounds are `null`, never `undefined`. Conditions are built by one
constructor per kind (`src/core/filters.ts`) so the key order is fixed — key
order is significant to `JSON.stringify`, and a reordered-but-identical condition
would read as a change and refetch forever.

**Array order is as significant to `JSON.stringify` as key order, and it is the
reachable half.** Column order is a layout slice the user drags; pinning
reorders rendered columns too. If `filters` were emitted in column position
order, dragging a column while a filter was active would change the query
string, change `instance.query`'s identity, and make a host refetch an identical
result set — with the page reset, since every filter path resets it (§7.3).
So `buildQuery` sorts `filters` by `field` and `search.fields` by id, and the
list constructor sorts `values`: each array is then a function of the filter set
alone, and unticking and reticking the same two values produces the same
condition rather than a new query *and* a spurious layout write.

### 3.5 Degenerate conditions

A condition that constrains nothing is not a condition. Four shapes are legal
under §3.1 and mean nothing, or different things in each mode:
`{ op: "in", values: [] }`, `{ op: "between", from: null, to: null }`,
`{ op: "contains", value: "" }`, `{ op: "range", from: null, before: null }`.
Left undefined, `contains ""` matches every row client-side while
`col ILIKE '%%'` is NULL for a null column and drops those rows server-side.

The constructors in `src/core/filters.ts` are the only way to build a condition,
and they normalise before they build:

- **Reversed bounds are swapped**, so the wire never carries `from > to`. This
  is not cosmetic: `filterFn_inNumberRange` and `filterFn_inDateRange` swap
  reversed endpoints inside their own `resolveFilterValue`, so a client built on
  them would quietly show the swapped range while the backend's
  `created >= '2026-04-01' AND created < '2026-03-01'` matched nothing.
- **A condition that constrains nothing returns `null`**, and the caller clears
  the column instead of storing it.
- `values` is sorted and de-duplicated; `null` is dropped (§3.1).

There is no draft in the model. A half-typed condition lives only in an editor's
local draft state (§8.2) and never reaches `layout.filters`; every public
mutator — `setCondition`, `setModel`, `onColumnFiltersChange` — runs its input
back through the constructors first (§9).

### 3.6 Room for OR, without a breaking change

`filters` is a flat array, implicitly ANDed, sorted by `field`. When cross-column
OR eventually ships it arrives as a **new optional field** — not by changing the
element type — so a backend written against stage 2 keeps working and simply
never sees the new field. The README states this, so nobody designs a backend
that assumes the array is the whole story.

---

## 4. The wire contract

### 4.1 `TableQuery` changes shape

```ts
export interface TableQuery {
  sorting: SortingState
  filters: FilterCondition[]
  search: TableSearch | null
  grouping: GroupingState
  pagination: { pageIndex: number; pageSize: number }
}
```

`columnFilters` and `globalFilter` are **removed**. They have only ever been `[]`
and `""`, so no host can have read anything meaningful out of them, and a rename
makes `tsc` fail loudly where a silent type change under the same name would not.

The JSDoc in `query.ts` currently promises this shape will not change when
filters land. That promise is being broken deliberately: it was written before
the operator model existed, and carrying TanStack's names for a shape that is not
TanStack's would be worse. The plan must correct that JSDoc, the README, and ship
this as **0.5.0** with a changelog entry naming the rename.

### 4.2 A worked example

`filters` is sorted by `field`, per §3.4 — which is why `amount` comes first
here rather than the order the user happened to set the filters in:

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

A Prisma translation, to prove the shape carries its own meaning:

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

Two things the sketch is deliberately precise about. **Search is AND over tokens,
OR over fields** — the naive `contains: text` across the fields is the same
whole-string test §5.1 has to replace on the client, and a backend that writes it
disagrees with client mode the moment a user types two words. And every text
operator carries `mode: "insensitive"`, `equals` and `notEquals` included (§4.3).

The `new Date("…")` calls are the backend interpreting a calendar day as UTC
midnight, which is its prerogative and its decision to document (§3.2) — not the
client-side parsing §3.2 forbids.

### 4.3 Operators are frozen once published

A published operator's meaning never changes; new behaviour gets a new name.

**All six text operators — `contains`, `notContains`, `equals`, `notEquals`,
`startsWith`, `endsWith` — are case-insensitive**, and that is part of the
contract. Freezing only three of them would ship a text editor that answers
"contains agro" yes and "equals Agro" no from the same dropdown, permanently,
which a user reads as a bug. A backend using a case-sensitive collation will
return different row counts from client mode for the same filter, and users will
report *that* as a data bug too. The README says this next to the operator table,
along with `between`'s inclusivity (§3.1) and the negated-operator/blank rule.

The operator unions are closed. A host that needs something outside the
vocabulary uses a custom column filter (§7.4) rather than minting an operator the
backend cannot be expected to know.

---

## 5. Client-side behaviour

### 5.1 TanStack composition

Verified against the installed `@tanstack/table-core@9.2.4`, not recalled from
v8. Add to the existing `tableFeatures({...})` call:

```ts
columnFilteringFeature,
globalFilteringFeature,
filteredRowModel: createFilteredRowModel(),
columnFacetingFeature,
facetedRowModel: createFacetedRowModel(),
facetedUniqueValues: createFacetedUniqueValues(),
filterFns: { dt: filterFn_dt },
columnMeta: {} as DataTableColumnMeta & ColumnMeta<any, any, any>,
```

`ColumnMeta` is TanStack's own global, declaration-mergeable interface; the
`any` arguments are deliberate and unavoidable — the slot sits inside the call
whose `typeof` *is* `DataTableFeatures`, so naming that type here would be
circular. See §7.4 for what the intersection buys.

All of it goes in at once, at step 4 of §13, even though nothing reads the
faceting slots until step 8: the feature set is composed once, so
`DataTableFeatures` widens once rather than twice.

And to `useTable`'s options, beside the ones stage 1 already states:

```ts
globalFilterFn: filterFn_dtSearch,
getColumnCanGlobalFilter: (column) => resolvedSearchFields.includes(column.id),
filterFromLeafRows: getSubRows !== undefined,
manualFiltering: isServer,
defaultColumn: { size, minSize, maxSize, filterFn: "dt" },
onColumnFiltersChange: updateFiltersFromTanStack,
```

`resolvedSearchFields` is the one list §3.3 describes — `searchFields` if the
host supplied it, otherwise every visible, searchable, accessor-backed column —
computed once and used both here and as `search.fields` on the wire.

Seven facts the plan must respect. Each of them is a silent failure, not a
compile error.

1. `globalFilteringFeature` **requires** `columnFilteringFeature` — the compiler
   says so through `FeatureSlotPrereqs`. Quick search cannot ship alone; stage 2
   is one unit.
2. The bulk `filterFns` export is deprecated for bundle size. We register one
   function of our own.
3. Adding these features widens `DataTableFeatures`, which every host column def
   is parameterised by. Registering `filterFns` narrows the legal
   `columnDef.filterFn` strings to the keys we register, so the plan must check
   nothing in the repo or the README passes a built-in name.
4. **`columnFilteringFeature` defaults every column to `filterFn: "auto"`**, and
   `"auto"` resolves a built-in *name* (`includesString`, `inNumberRange`, …)
   through the very registry we are narrowing to `{ dt }`. Every lookup misses,
   `column_getFilterFn` returns `undefined`, and `createFilteredRowModel` skips
   that filter entirely — every row passes, with one dev-console warning per
   filtered column and nothing else. The fix is `filterFn: "dt"` on the existing
   `defaultColumn`: TanStack merges the feature default first, then
   `options.defaultColumn`, then a host's own column def, so this sets the
   default without taking the escape hatch away.
5. **`globalFilterFn` must be stated as our own function.** Its default is
   `"auto"`, which short-circuits to `filterFn_includesString` — one whole-string,
   case-insensitive substring test, applied once per globally-filterable column
   with that column's id, ORed with a `break` on the first `true`. That cannot
   express §3.3's "tokens may match different columns": searching `KR-102 agro`
   would look for the literal string `"KR-102 agro"` inside one column at a time
   and miss the row where the two tokens live in different columns. Ours is a
   **row-level** predicate that ignores the `columnId` it is handed, reads every
   id in `fields` off the row itself, and returns the same verdict for every
   column, so TanStack's own OR/`break` is harmless. Tokenising the needle
   happens in its `resolveFilterValue`, which the table applies ahead of the row
   loop — `createFilteredRowModel` resolves the global filter value once per
   globally-filterable column — rather than once per row.
6. **`getColumnCanGlobalFilter` must be stated too**, from `meta.searchable` and
   `column.getIsVisible()`, and `search.fields` is derived from that same
   predicate — otherwise the client searches hidden and unsearchable columns that
   the wire's `fields` excludes (§3.3).
7. **`filterFromLeafRows` defaults to `false`**, which for tree data hides a
   matching child whenever its parent fails the filter. This library ships tree
   data (`getSubRows`), so a filtered tree would show nothing for a term only
   leaves contain. `filterFromLeafRows: getSubRows !== undefined` keeps a parent
   whenever any descendant matches, which is what a user expects.
   `maxLeafRowFilterDepth` keeps its default. Expansion survives a filter change
   with no work: it is keyed by row id and `autoResetExpanded: false` is already
   set.

`onColumnFiltersChange` is wired so that `column.setFilterValue(condition)` keeps
working for a host driving the table through TanStack's own API: the handler maps
`{ id, value }[]` back to `FilterCondition[]` (the value *is* the condition, §5.2)
and hands it to `updateFilters`, through the same validation as `setModel`
(§3.5). Left unwired, the default updater would write to an atom that controlled
state overrides, and `setFilterValue` would silently do nothing.

### 5.2 One filter function, not one per operator

A column's `filterFn` is fixed at definition time in v9 — there is no runtime
operator concept. So a single registered function dispatches on the condition it
is handed. `constructFilterFn` takes a **definition object**, not a callback, and
its `filter` member is a value-level comparator that receives the row's value
first:

```ts
/** A condition with its per-filter work already done: needle lower-cased, day
 *  bounds parsed into local-calendar timestamps, `values` as a Set. Internal to
 *  the filter function — a resolved condition never reaches the wire, so §3.4's
 *  JSON-only rule does not bind it. */
export type ResolvedCondition = /* one resolved shape per kind */

const filterFn_dt = constructFilterFn({
  resolveFilterValue: (condition: FilterCondition): ResolvedCondition => resolve(condition),
  filter: (dataValue: unknown, resolved: ResolvedCondition, row, columnId) => match(dataValue, resolved),
})
```

Three mechanics that are easy to get wrong and fail silently:

- **`resolveFilterValue` runs once per filter, before any row is tested**, and
  what `filter` receives is the *resolved* value — not the raw condition. All
  filter-value normalisation belongs there: lower-casing the needle, parsing the
  day bounds, building the Set behind `in`.
- **`resolveDataValue` is handed the raw value alone** — no condition, no column —
  so one registered function cannot use it to normalise per kind. Per-kind data
  normalisation stays inside `filter`, per row. That is the cost of a dispatcher,
  and it is small: the expensive half is already hoisted.
- **A built-in reached from inside `filter` does not get its own
  `resolveFilterValue`.** The table only resolves the registered function's
  value, so a nested `filterFn_includesString(row, columnId, needle)` never
  lower-cases the needle while `constructFilterFn`'s wrapper *does* lower-case
  the data value — `contains "AGRO"` would match nothing. Call them as
  `fn(row, columnId, fn.resolveFilterValue?.(v) ?? v)`, which is what TanStack's
  own docblock says.

It is built on TanStack's MIT primitives where they fit: `filterFn_includesString`
for `contains`, `filterFn_startsWith`, `filterFn_endsWith`,
**`filterFn_equalsString`** for `equals` — the case-insensitive spelling, not
`filterFn_equals`, which is strict `===` (§4.3) — and `filterFn_inNumberRange`
for `between`, whose inclusive `[min, max]`, null-to-±Infinity endpoints and
"a non-number never matches" are already exactly §3.1's contract. Four families
are written here instead, each because the built-in disagrees with it:

| Not reused | Why |
|---|---|
| `filterFn_empty` / `notEmpty` | They count a whitespace-only string, and `[]` (`String([]) === ""`), as empty. §3.1 pins `blank` to nullish or `""`, which is what `IS NULL OR = ''` reproduces. |
| `filterFn_inDateRange` | Inclusive at both ends and parses bounds as UTC — the two bugs §3.2 exists to remove. |
| `filterFn_greaterThan` and its relatives | They coerce a nullish value to `0`, so a null row matches `amount > -5`. §3.1 requires a nullish value to fail every comparison, as it does in SQL. |
| `notContains`, `notEquals`, `notIn` | No built-in, and the naive "positive test, negated" includes the blank rows SQL drops (§3.1). |

The condition object itself is stored as the TanStack `ColumnFilter.value`, which
is typed `unknown`, so this is legal and keeps one source of truth: the same
object the client filters with is the object published to the server.

### 5.3 Values lists, client-side

`getFacetedUniqueValues()` returns `Map<value, count>` — the checkbox list with
its counts, free. `getFacetedRowModel()` applies the *other* columns' filters
while excluding the column's own, which is the narrowing behaviour a user expects
from Excel and AG Grid, already implemented in MIT code we ship.

**Facet keys are raw accessor values, not `FilterValue`.** With no
`columnDef.getUniqueValues`, TanStack keys the Map on whatever the accessor
returned — a `Date`, an object, an array element. A checkbox list built straight
from that Map would put a value outside `FilterValue` into a condition, and then
`layoutSliceEqual` treats any two `Date`s as equal (§3.4) and ticking a different
date is dropped as a no-op. So the list editor coerces each key to a
`FilterValue` before it can become a condition, and a column whose facets are not
JSON primitives does not fall back to faceting at all — it falls back to
`meta.values`, or it is not a list column.

Faceting is **disabled in server mode**, where it could only compute a
confidently wrong list from the one page in hand.

**A list filter's choices come from exactly one source**, in this order:

1. `meta.values`, wherever it is declared, in both modes — shown without counts,
   because the host supplied labels rather than data.
2. Otherwise, in client mode, faceting, with counts.
3. Otherwise, in server mode, `loadValues` (§6.3).

A server-mode list column with none of the three is disabled with an explanatory
label rather than an empty list — silence there reads as "there is no data".
`loadValues` is never called in client mode. Declaring `meta.values` on a
client-mode column therefore trades the free counts for fixed labels, which is a
real trade and is documented next to the option.

---

## 6. Server-side behaviour

### 6.1 Manual filtering

`manualFiltering: isServer` sits beside the existing `manualSorting` and
`manualPagination`. Like them it is written unconditionally on every render, as a
plain boolean, so the option merge can never carry a stale value and it needs no
`mergeOptions` branch: that path exists only for the four options this hook
*omits* from the literal (`getRowId`, `getSubRows`, `rowCount`, `pageCount`), and
adding a fifth entry to `stated` for an always-stated option would be dead code
that implies the others are at risk too.

Note that `manualFiltering` turns off the filtered row model, not the filter
state: `column.getIsFiltered()` reads `state.columnFilters` directly and keeps
working, which is what drives the header marker (§8.2) and the Filters tab's
ordering (§8.3) in server mode.

### 6.2 Debounce the published value, not the keystroke

`useTableQuery` re-announces in an effect on every committed change to the query
object. A quick-search box wired straight through would therefore fire one fetch
per keystroke, each one also resetting the page.

**`debounceMs` (default 300) applies to quick search only.** `layout.search`
holds the raw text and is written on every keystroke — cheap, and the input stays
a normal controlled field, trailing space and all. What is debounced is
everything downstream of it: `state.globalFilter`, `search` on the wire, and the
page reset. Ten keystrokes then produce ten renders that change nothing the row
model memoises on, and one query.

Putting the debounce there rather than between the editor and the state update is
what makes the flush question disappear. A debounce that withheld the text from
state would have to flush on `pagehide`, and its flush is a React state update:
`useDebouncedSave`'s own `pagehide` handler runs in the same tick against the
layout it already holds, so the last typed word could not reach storage however
the two listeners were ordered. With the text already in state, the existing
350 ms save and its `pagehide` flush persist it with no new machinery — and no
new ordering constraint between two flushes.

`layout.search` holds the raw input; both `state.globalFilter` and the wire
receive `text.trim()`. A value that trims to `""` means no search on both sides,
and the wire carries `null`. Without the trim the two modes disagree on
whitespace: `createFilteredRowModel` treats `" "` as a live global filter and
would run a substring search for a space, while a wire carrying `null` would have
the server return everything.

**Column filters are never debounced.** Both surfaces — the header popover and
the Filters tab's inline editors — hold draft state and commit on Apply, Enter or
blur (§8.2, §8.3). Choosing an operator, ticking a value, setting a number or a
date, sorting and paging are all instant: they are discrete, deliberate acts and
a delay there feels broken. It also keeps every filter change adjacent to its own
page reset, rather than deferring the reset by 300 ms.

### 6.3 Values lists, server-side

The host supplies them, with a lifecycle of their own — a facet request is not a
page request and must not share its cache key:

```ts
loadValues?: (
  columnId: string,
  options: { search: string; signal: AbortSignal },
) => Promise<FilterValueOption[]>

export interface FilterValueOption {
  value: FilterValue
  /** Shown instead of `value`. */
  label?: string
  /** Shown beside the label when the backend can count cheaply. */
  count?: number
}
```

Called when a values editor opens, and again (debounced) as the user types in its
search box, so a column with thousands of distinct values stays usable. The
previous result stays on screen while a new one is in flight, with the same
progress treatment the table already uses. `signal` aborts a superseded request.

A **rejected** `loadValues` keeps any previous result on screen and shows a
failure line with a retry action, reusing the `loadFailed`/`retry` treatment the
rows already have. Falling back to an empty checkbox list is the same "there is
no data" lie that §5.3 rejects for a missing callback, and it is the one place
this stage adds a new async surface — the 4-state rule applies to it like
anything else.

When the column has no `loadValues` and no `meta.values`, the editor is disabled
with an explanatory label; see §5.3 for the full precedence.

---

## 7. State, persistence and page reset

### 7.1 Where the state lives

Filters are two new `TableLayout` slices owned by `useArrangement`, exactly like
sorting:

```ts
interface TableLayout {
  …
  filters: FilterCondition[]
  search: string
}
```

`EMPTY_LAYOUT` gets `[]` and `""`. `""` is also what an absent global filter means
to TanStack, so the off state is unambiguous.

**`filters` is the first slice whose shape is not already TanStack's**, so it is
the first that cannot be passed straight through. Every other slice at
`useDataTable.ts:377-385` works because `TableLayout["sorting"]` *is*
`SortingState`; TanStack's is `ColumnFiltersState = { id: string; value: unknown }[]`.
The projection is one `useMemo` keyed on `layout.filters`, handed to
`state.columnFilters`:

```ts
const columnFilters = useMemo(
  () => layout.filters.map((condition) => ({ id: condition.field, value: condition })),
  [layout.filters],
)
```

Three things about it are load-bearing:

- **It must be memoised.** `createFilteredRowModel` compares its memo deps by
  reference, and a controlled state slice is read back verbatim — a fresh array
  per render would re-filter every row on every unrelated host re-render. This
  library is otherwise scrupulous about exactly that (see `useTableQuery`'s
  JSDoc, `layoutSliceEqual`), so the omission would read as an oversight.
- **It runs in both modes.** Under `manualFiltering` the filtered row model is
  inert, but `column.getIsFiltered()` still reads the state slice, and it is what
  marks a filtered header (§8.2) and sorts the Filters tab (§8.3). Skipping the
  projection in server mode would silently break both.
- **`condition.field` is authoritative.** The projection is the only writer of
  `ColumnFilter.id`, so the two can never disagree.

`layout.search` feeds `state.globalFilter` through the debounce described in
§6.2, trimmed.

### 7.2 Persistence needs no format bump

`pruneLayout` is a whitelist that rebuilds a fresh object from recognised keys,
so an unknown key from a newer build is dropped and a missing key from an older
one falls back to `EMPTY_LAYOUT`. `FORMAT_VERSION` stays where it is — bumping it
would throw away every user's column widths and pinning for a purely additive
change.

`pruneLayout` gains a `filters` branch mirroring the `sorting` one: drop any
condition whose `field` is not a known column id, whose `kind` is unknown, or
whose shape does not match its operator's arity. Without it, a deleted column's
filter stays active forever with no UI able to reach it.

That branch needs more than the column ids it is given today:

```ts
pruneLayout(
  stored: Partial<TableLayout>,
  knownColumnIds: readonly string[],
  /** Each column's resolved filter kind; `false` where filtering is off for it.
   *  Optional because `pruneLayout` is a public export — omitted, the branch
   *  falls back to the three rules above. The hook always passes it. */
  filterKinds?: ReadonlyMap<string, FilterKind | false>,
): Partial<TableLayout>
```

…so it can also drop a condition **whose `kind` disagrees with the column's
currently resolved filter kind**. A stored `{ kind: "text", op: "contains" }` on
a column that is now a number column passes all three of the original rules, and
then §7.4's `meta.filter` says "number editor" while §3.1's `kind` says "string
value": the client runs a substring test against a numeric accessor and the wire
sends `ILIKE` for an integer column, which is an error in Postgres. This is
reachable with **no host code change at all**, because §7.4 infers the kind from
the first non-null accessor value — a page whose first rows happen to begin with
nulls can infer a different kind on the next visit. A mismatched condition is
dropped, never reinterpreted.

`filtering: { persist: false }` keeps filters out of storage entirely, for hosts
who would rather every visit start clean. It has to be enforced on the **write**
side, because `pruneLayout` runs only on load and `LayoutStorage.save` is typed
to take a complete `TableLayout`. `useArrangement` gains a set of non-persisted
keys and:

- strips them at the save boundary — `save(id, { ...layout, filters: [], search: "" })`
  — rather than narrowing the object it also feeds to `useTable`;
- does **not** set `hasUnsavedChanges` for a change confined to them, so typing
  in the search box does not schedule one storage write per pause. For the
  server-backed adapter `types.ts` explicitly recommends, that would be one
  network request per pause for state the host asked not to keep.

Two more consequences of filters living in the layout, both of which would
otherwise ship as surprises:

- `resetLayout` restores `{ ...EMPTY_LAYOUT, ...initialLayout }`, which blanks
  `filters` and `search` too. The Columns tab's Reset is relabelled and rescoped
  in §8.3 to restore column arrangement only; clearing filters is the Filters
  tab's own action.
- `isCustomised` is computed from the non-filter slices, so a search does not make
  a Reset link appear in the Columns tab for a reason that has nothing to do with
  columns.

### 7.3 Every change to the result set resets the page

`updateFilters` and `updateSearch` are exact twins of `updateSorting`:
`updateSlice(...)` then `resetPage()`. **Every mutator in §9 goes through one of
them** — `setCondition`, `clearColumn`, `clearAll`, `setSearch`, `setModel`, and
the `onColumnFiltersChange` bridge of §5.1 — so there is no path that changes the
result set without resetting the page.

`setSearch` is the one an implementer will get wrong: §3.3 insists search is its
own field and not a synthetic condition, and §7.1 makes it its own layout slice,
so routing it through a plain `updateSlice` looks reasonable. Search changes the
row count exactly as a filter does.

TanStack's own post-filter reset is unavailable because `autoResetPageIndex: false`
is set for good server-mode reasons, and the fallbacks are not a substitute: the
pre-paint correction in client mode pulls the user to the **last** page of the
filtered set, and `usePagination`'s clamp does the same against the host's count
in server mode. On page 40 of 100, typing three characters without a reset lands
the user on page 3 of 3 of the results rather than page 1 — and in server mode
the query for page 40 goes out first and is answered with nothing.

### 7.4 Per-column configuration

Through `columnDef.meta`. This table declares no `columnMeta` slot today, so
`meta` resolves to TanStack's **empty** global `ColumnMeta` interface, and
`meta: { filter: "number" }` does not merely go unchecked — it is rejected as an
unknown property. §5.1's `tableFeatures({...})` therefore claims the slot, which
is what makes the three members below type-checked with no generic reaching the
host:

```ts
export interface DataTableColumnMeta {
  /** Which editor this column gets. `false` turns filtering off for it. */
  filter?: FilterKind | false | undefined
  /** Whether quick search covers this column. Default true for text-ish columns. */
  searchable?: boolean | undefined
  /** Fixed choices for a list filter; see §5.3 for how it ranks against faceting. */
  values?: FilterValueOption[] | undefined
}
```

Each member is written `?: T | undefined` because the repo runs
`exactOptionalPropertyTypes` and `meta: { filter: isNumeric ? "number" : undefined }`
is the natural call site.

The slot **replaces** the global interface rather than extending it, so declaring
it as `DataTableColumnMeta` alone would silently delete the fields of any host who
declaration-merges `ColumnMeta` today: their `meta: { myKey: 1 }` becomes an
excess-property error. Hence the intersection in §5.1,
`DataTableColumnMeta & ColumnMeta<any, any, any>`, which keeps a host's own merge
working. All three variants were compiled against this repo's own tsconfig flags:
with no slot a `meta.filter` is rejected outright; with the bare slot a host's
merged key is rejected; with the intersection both are accepted.

A column with no `meta.filter` gets a kind inferred from the first non-null
accessor value: string → text, number → number, boolean → boolean, otherwise
text. Inference is documented as a convenience, not a contract; a column that
matters declares its kind. It is also *data-dependent*, which is why a stored
condition is checked against the resolved kind on load (§7.2).

The filter *value* cannot be tied to a column's `TValue` while `columns` is
`ColumnDef<…, any>[]`. That is stated in the docs rather than papered over.

---

## 8. The user interface

### 8.1 Quick search

A single input in the toolbar, immediately before the existing spacer, so it sits
left of the Columns button. It gets its own flag rather than reusing the Columns
button's gate, is exported as `QuickSearch` for hosts that render
`toolbar={false}` and build their own shell, and is styled by adding `.dt-search`
to the existing `.dt-select, .dt-page-input` rules.

It carries a clear affordance while non-empty, announces its result count to
assistive technology politely, and never steals focus.

**No new `--dt-*` tokens** anywhere in this stage unless genuinely unavoidable:
every token must be mapped by both shadcn presets, and the themes test enforces
it — in two ways, see §10.

### 8.2 The column filter editor

The header menu stays a real `role="menu"`. It gains one **"Filter…"** item that
opens a separate popover; form controls are not embedded in the menu itself.
Five concrete reasons, all of which the plan would otherwise hit one at a time:
inputs under `role="menu"` are invalid ARIA; the menu closes on any item click;
Escape would be ambiguous; the menu autofocuses its first button; and
`useClampedPlacement` measures once per open and cannot correct a menu that grows
afterwards.

The popover:

- renders as a direct child of `.dt-root`, and its class joins the `:has()`
  z-index lift so a later sibling table cannot paint over it — with a matching
  case in the cascade test. That lift only orders *this table* against the page,
  so the popover also takes **its own z-index inside `.dt-root`'s single stacking
  context**, beside the panel (10) and the menu (20); without one it paints under
  the sticky header (3), the pinned header cells (4), the drag indicator (5) and
  the progress bar (6) it is anchored above;
- re-measures its clamp when its content resizes, because switching operator
  changes its height. `useClampedPlacement` gains an optional
  `measure: () => DOMRect`, defaulting to `ref.current.getBoundingClientRect()`,
  so the re-measure is observable in jsdom — where every rect is zeros and a
  re-clamp is otherwise indistinguishable from no clamp at all (§10);
- holds **draft** state and applies on Apply, Enter, or blur — never per
  keystroke, and never debounced (§6.2);
- offers Clear, which removes the column's condition entirely. Applying an editor
  that constrains nothing does the same thing, because the constructor returns
  `null` (§3.5);
- traps focus, restores focus to the menu item on close, and closes on Escape.

A filtered column is marked in its header — the same affordance the sort
indicator uses, so the header does not grow a second vocabulary.

### 8.3 The Filters panel tab

`ColumnPanel` becomes a `TablePanel` shell that owns the outside-click and
Escape handling, the tab strip and the tab state, with `ColumnsTab` and
`FiltersTab` as children. `ColumnPanel`'s current public props stay intact, since
it is exported.

- "Show all" / "Reset" move out of the shared head into the Columns tab, where
  they belong. That Reset restores column arrangement only and leaves filters
  alone (§7.2).
- The tab strip sits outside the scrolling box, so it does not scroll away.
- The Filters tab lists every column where `column.getCanFilter()` is true —
  **hidden columns included**, marked as hidden. TanStack goes on applying a
  hidden column's filter, and that column has no header to carry a marker, so
  listing only rendered columns (which is what `ColumnPanel` does today, and what
  a `FiltersTab` written to match would inherit) would strand a filter with no
  surface anywhere: 40 rows of 10 000 and no way to find out why. Hiding a column
  narrows quick search (§3.3) but never clears or hides its column filter.
- Each entry is collapsible, showing its current condition in words when
  collapsed and its editor when open. Columns with an active filter sort to the
  top and are marked.
- A "Clear all filters" action sits at the foot of the tab, enabled only when
  something is active.

`panelOpen` becomes `{ open, tab, focusColumnId? }` so a header-menu item can
open the panel straight onto the Filters tab with that column's editor focused.

Both tabs are a projection of one model, and both editors draft the same way: an
inline editor in the Filters tab holds a draft and commits on Apply, Enter or
blur, exactly as the popover does. No surface holds committed state of its own,
and a draft is discarded or applied, never synced.

### 8.4 The filtered-empty state

`showEmpty` currently says "No rows" whether the table has no data or the filter
excluded everything. Those are different situations and the second one needs a way
out: a distinct `noMatches` label plus a "Clear filters" action. An empty state
with no exit is the classic filter dead end.

### 8.5 Labels

Every new string goes through `DataTableLabels` in one batch — operator names,
editor labels, the search placeholder, the tab names, the clear actions, the
no-matches copy, the values-list failure line, and the count announcements.
Parameterised ones follow the existing `range(from, to, total)` precedent.

The batch lands **before** any of the UI that consumes it (§13), because new
required keys are a source break for hosts who hand-build a full labels object
rather than spreading `defaultLabels` — `TablePagination` and `TableStatus` take
the whole `DataTableLabels`, and `PublicExports.test.tsx` pins the
`{ ...defaultLabels, ...mine }` recipe. That break wants to happen once, with one
changelog note, not once per UI step.

---

## 9. Public API

Added to `useDataTable` options:

```ts
filtering?: boolean | FilteringOptions

interface FilteringOptions {
  /** ms before quick search is published. Default 300. Column filters are never debounced. */
  debounceMs?: number
  /** Keep active filters in the saved layout. Default true. */
  persist?: boolean
  /** Columns quick search covers. Default: every visible searchable column. */
  searchFields?: string[]
  /**
   * Server-mode source of a values filter's choices. Never called in client mode.
   * Written `| undefined` like the hook's other forwarded callbacks, because
   * `exactOptionalPropertyTypes` otherwise rejects passing one through.
   */
  loadValues?:
    | ((columnId: string, options: { search: string; signal: AbortSignal }) => Promise<FilterValueOption[]>)
    | undefined
}
```

The model the two round-trip methods carry:

```ts
export interface FilterModel {
  filters: FilterCondition[]
  /** Raw search text; `""` when off, matching the layout slice. */
  search: string
}
```

Added to the returned instance:

```ts
filtering: {
  enabled: boolean
  conditions: readonly FilterCondition[]
  search: string
  isFiltered: boolean
  setCondition: (condition: FilterCondition) => void
  clearColumn: (columnId: string) => void
  clearAll: () => void
  setSearch: (text: string) => void
  /** The whole model, ready to store or put in a URL. */
  getModel: () => FilterModel
  /** Restore a stored model wholesale. */
  setModel: (model: FilterModel) => void
}
```

`setModel` takes untrusted input — a URL, a host's own store, a hand-written
literal — so it is held to the same rules as a stored layout: it runs the same
validation as `pruneLayout`'s filters branch (unknown field, unknown kind, wrong
arity, kind mismatch), drops what it cannot honour, re-runs every surviving
condition through its constructor, and resets the page. The re-run is what protects the
invariant everything else rests on: a condition assembled by a host in a
different key order, or with `values` in a different order, would otherwise
stringify differently from an identical one the editors built, and §3.4's whole
no-spurious-refetch story would have a hole in it reachable through the very API
§9 recommends for URL round-trips.

`getModel`/`setModel` ship in the first version, before a second surface exists.
That round-trip is what makes filters persistable, shareable and testable with no
translation layer, and retrofitting it once three surfaces read state directly is
painful.

New exports: the condition types, `FilterModel`, `FilterValueOption`,
`QuickSearch`, the condition constructors, and the tab components.

---

## 10. Testing

Along the three tiers the repo already uses.

**Pure units.** Condition constructors and their key order, their swapping of
reversed bounds, and their `null` return for a condition that constrains nothing;
`filterFn_dt` per operator, including the blank/notBlank definition, the
negated-operator treatment of blanks, and a nullish value against every number
comparator; the day-to-half-open-range conversion at month and year boundaries,
and under a non-UTC `TZ`; `pruneLayout`'s new branch against unknown columns,
unknown kinds, wrong arity and a changed kind; `buildQuery` shape, with `filters`
and `search.fields` sorted; `queriesEqual` against a reordered-but-identical
condition **and** against a reordered `filters` array and a reordered `values`.

**Hooks.** Each mutator in §9 resets the page, one case per mutator; quick search
coalesces keystrokes into one query while the input stays responsive;
`manualFiltering` follows the mode; the `layout.filters` → `columnFilters`
projection keeps its identity across an unrelated re-render; `getIsFiltered()` is
true in server mode; persistence round-trip with `persist` on and off, including
that `persist: false` schedules no write; `getModel`/`setModel` round-trip, and
`setModel` with a hand-built, differently-key-ordered condition producing an
identical query.

**Components.** `src/Filtering.test.tsx` in the existing style: the search box
narrows client-side rows and matches tokens across two columns; the header-menu
item opens the popover and Apply commits; Escape discards the draft; the popover
re-clamps when its content resizes — driven by the fireable `ResizeObserverStub`
from `VirtualizationBounds.test.tsx` and a stubbed `measure` that returns a taller
rect on the second call; the Filters tab and the popover show the same condition;
the Filters tab lists a hidden column that has a filter; clearing from either
surface clears both; a filtered tree keeps a parent whose only match is a
descendant, and keeps its expansion; the no-matches state offers a way out; a
values filter lists distinct values with counts client-side and calls
`loadValues` in server mode; a values filter without `loadValues` in server mode
is disabled rather than empty; a rejected `loadValues` shows the failure line and
its retry.

**Cascade and theme.** The popover's entry in the `:has()` lift, and its z-index
relative to the sticky header and the progress bar. No new tokens — and if one
proves unavoidable, both presets map it (or it joins `INHERITED_TOKENS`) **and**
the hard-coded distinct-token count in `themes.test.ts` is bumped from 25. That
second assertion is the one that will surprise: it fails under the name "finds
the base tokens", which gives no hint that a new token is the cause.

---

## 11. Risks

- **The rename is a real break.** Low blast radius at 0.x with fields that were
  always empty, but it must be owned in the changelog rather than glossed.
- **Case sensitivity will diverge** between client mode and a backend whose
  collation disagrees. Documented, not preventable.
- **Quick search over unindexed text columns** is a good way to take down a
  database with three characters. The docs must say `fields` is a list of columns
  the backend should be prepared to search, and that hosts should mark sensitive
  or unindexed columns `searchable: false`.
- **`DataTableFeatures` widens**, so every host's column-def type changes. Additive,
  but it is a type-level change in a published package.
- **Claiming the `columnMeta` slot is not additive on its own.** The intersection
  in §5.1 preserves a host's own `ColumnMeta` declaration merge, and was verified
  by compiling all three variants; if it fails to hold up in a real host's
  project, the fallback is to drop the slot and declaration-merge
  `DataTableColumnMeta` into `ColumnMeta` instead, at the cost of putting our
  three keys on every TanStack table in that application.
- **Faceting on a large client dataset** builds a Map over every row per column.
  It is computed lazily per column and only for list filters, but a 100k-row table
  with a list filter on a high-cardinality column will feel it. Measured in the
  plan, and capped if it does not hold up.
- **The popover is a third overlay** after the menu and the panel, in a stacking
  context stage 1 already had to reason about carefully.
- **The search input re-renders the shell on every keystroke** (§6.2). The row
  model does not recompute, and virtualisation keeps the rendered row count
  small, but it is a deliberate trade of render work for the removal of a flush
  race, and worth a measurement on the 100k-row demo.

---

## 12. Licence boundary

Restating it because this stage runs closest to the line.

AG Grid's Set Filter, Advanced Filter, tool panels and side bar are **Enterprise**.
Their interfaces ship inside the MIT `ag-grid-community` package while their
implementations do not — which is exactly the trap: reading a shape from an MIT
`.d.ts` is fine, and a contributor who then goes looking for "how AG Grid does
this" lands in Enterprise code.

So: published documentation and observed behaviour of the live demos are the only
inputs. `ag-grid-enterprise` is not installed in this repository, not even
transiently to check something. Every line here is our own, built on TanStack's
MIT primitives and our existing components.

---

## 13. Order of work

1. The model: condition types, constructors and their normalisation, `filterFn_dt`, the day conversion — pure, fully tested, no UI.
2. The wire: `TableQuery` rename, `buildQuery` with its sorted arrays, README and JSDoc corrections, and a new `CHANGELOG.md` opening at **0.5.0** (earlier versions summarised in one line, not reconstructed) added to `package.json`'s `files`. There is no changelog in the repository today, so "ship a changelog entry" is really "create the changelog", and §4.1's and §8.5's breaking notes both land in it.
3. State: layout slices, `updateFilters`/`updateSearch` with page reset, the per-column kind resolver of §7.4, `pruneLayout`'s new branch and its new `filterKinds` argument, persistence opt-out.
4. TanStack composition — every feature, row model, faceting slot, `columnMeta` slot and table option from §5.1 in one go — plus the `layout.filters` → `columnFilters` projection and the `onColumnFiltersChange` bridge, which need the feature that owns that state slice. Client-side filtering end to end with no UI, but a test that drives it through the instance API.
5. The labels batch: every new `DataTableLabels` key at once, with its changelog note. Steps 6–10 consume these and add none.
6. Quick search: the debounced published value, the toolbar input, the search semantics.
7. The column filter popover and the header-menu item.
8. `TablePanel` shell, Columns tab extraction, Filters tab.
9. Values filters: client faceting, then `loadValues` for server mode, with its failure state.
10. No-matches state, accessibility pass.
11. Demo, README, full verification and review.
