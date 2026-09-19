/**
 * The filter model: the conditions the table publishes and filters with.
 *
 * Every condition is built by one constructor per kind, so its key order is
 * fixed. Key order matters because `queriesEqual` and `layoutSliceEqual` both
 * compare by structure — a reordered-but-identical condition would read as a
 * change, refetch forever and write the layout on every render.
 */

/**
 * A calendar day, `YYYY-MM-DD`. Never a `Date`.
 *
 * A plain `string` alias, so the compiler enforces nothing about the shape:
 * every day that crosses a boundary — storage, the wire, a host's own call —
 * has to be read through {@link startOfLocalDay} before it is trusted. The
 * year is four digits, so only years 0000..9999 can be named; {@link toIsoDay}
 * returns null rather than emit anything else.
 */
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
  // All three fields are set in one `setFullYear` call rather than through
  // `new Date(year, month - 1, date)`, which maps years under 100 into the
  // 1900s and so evaluates the day in the wrong year before the year can be
  // corrected: 0000-02-29 exists (year 0 is divisible by 400) but 1900-02-29
  // does not, so it rolled to 1 March and was then rejected as unreal. The
  // same detour also applied a modern UTC offset to a pre-standard-time date,
  // landing minutes inside the day instead of at its first instant.
  const stamp = new Date(0)
  stamp.setFullYear(year, month - 1, date)
  stamp.setHours(0, 0, 0, 0)
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
 * A year outside 0..9999 is the same defect by another route, and is guarded
 * the same way — see the comment on the year below.
 *
 * @param date - Any date; may be an Invalid Date.
 * @returns Its local calendar day, `YYYY-MM-DD`, or null if `date` is invalid
 *   or falls in a year that cannot be named in four digits.
 */
export function toIsoDay(date: Date): IsoDay | null {
  if (Number.isNaN(date.getTime())) return null
  const yearNumber = date.getFullYear()
  // `ISO_DAY` parses exactly four digits, so a year outside 0..9999 cannot be
  // named as an `IsoDay`: `padStart` would emit `"10000-01-01"` or
  // `"00-1-12-31"`, strings this module's own parser refuses. Returning them
  // would make the generator contradict the parser — and because they are not
  // null, every caller's null guard is bypassed and the malformed day reaches
  // the stored layout and the wire, only to resolve to `null` at evaluation
  // time and silently widen the filter.
  if (yearNumber < 0 || yearNumber > 9999) return null
  const year = String(yearNumber).padStart(4, "0")
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
 * @param days - Whole days to move; may be negative. Anything else is
 *   rejected rather than truncated: `setDate` truncates toward zero, so `0.5`
 *   moved nothing while `-0.5` moved a whole day back — the same input read
 *   two different ways. `Number.isInteger` also covers `NaN` and `Infinity`,
 *   which would otherwise reach `toIsoDay` as an Invalid Date.
 * @returns The moved day, or null if `day` is not a day, `days` is not a whole
 *   number, or the result falls outside the years an `IsoDay` can name.
 */
export function addDays(day: IsoDay, days: number): IsoDay | null {
  if (!Number.isInteger(days)) return null
  const start = startOfLocalDay(day)
  if (start === null) return null
  const moved = new Date(start)
  moved.setDate(moved.getDate() + days)
  return toIsoDay(moved)
}

/**
 * Whether a value can be a member of a list condition.
 *
 * A `number` must also be finite. `NaN`/`Infinity` pass `typeof === "number"`
 * but `JSON.stringify` serialises them as `null` — the one value list
 * conditions deliberately drop (see `listCondition`) — and a non-finite pair
 * makes `compareFilterValues`' subtraction return `NaN`, which the sort spec
 * treats as "equal", making the published order depend on input order.
 */
export function isFilterValue(value: unknown): value is FilterValue {
  if (typeof value === "number") return Number.isFinite(value)
  return typeof value === "string" || typeof value === "boolean"
}

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
 * The operators `textCondition` accepts.
 *
 * `rebuildCondition` validates `kind` but has no way to validate `op` itself —
 * that has to happen in each constructor, or an unknown operator (a stale
 * value from an older library version, or a miscased one from a JS host)
 * round-trips as a "canonical" condition and silently disagrees with
 * whatever `buildQuery` and the Task 3 filter functions do with it.
 */
const TEXT_OPS = new Set<TextCondition["op"]>([
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "startsWith",
  "endsWith",
  "blank",
  "notBlank",
])

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
  if (!TEXT_OPS.has(op)) return null
  if (op === "blank" || op === "notBlank") return { kind: "text", field, op }
  const value = "value" in condition ? condition.value : undefined
  // `contains ""` matches every row on the client while `col ILIKE '%%'` is
  // NULL for a null column and drops those rows on the server.
  if (typeof value !== "string" || value === "") return null
  return { kind: "text", field, op, value }
}

/** The operators `numberCondition` accepts. See `TEXT_OPS`. */
const NUMBER_OPS = new Set<NumberCondition["op"]>([
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

/**
 * Build a number condition.
 *
 * @param condition - The condition to normalise.
 * @returns The condition in canonical key order, or null if it constrains nothing.
 */
export function numberCondition(condition: NumberCondition): NumberCondition | null {
  const { field, op } = condition
  if (!NUMBER_OPS.has(op)) return null
  if (op === "blank" || op === "notBlank") return { kind: "number", field, op }
  if (op === "between") {
    // Read each bound independently: a condition serialised by a backend
    // that omits nulls (Go `omitempty`, Jackson NON_NULL, protobuf-JSON)
    // carries only the bound it has, and a single `"from" in condition` gate
    // would discard that surviving bound along with the missing one.
    const givenFrom = "from" in condition ? finiteOrNull(condition.from) : null
    const givenTo = "to" in condition ? finiteOrNull(condition.to) : null
    const [from, to] = orderedBounds(givenFrom, givenTo)
    if (from === null && to === null) return null
    return { kind: "number", field, op: "between", from, to }
  }
  const value = "value" in condition ? condition.value : undefined
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return { kind: "number", field, op, value }
}

/** The operators `dateCondition` accepts. See `TEXT_OPS`. */
const DATE_OPS = new Set<DateCondition["op"]>(["range", "blank", "notBlank"])

/**
 * Build a date condition.
 *
 * @param condition - The condition to normalise.
 * @returns The condition in canonical key order, or null if it constrains nothing.
 */
export function dateCondition(condition: DateCondition): DateCondition | null {
  const { field, op } = condition
  if (!DATE_OPS.has(op)) return null
  if (op === "blank" || op === "notBlank") return { kind: "date", field, op }
  // Read each bound independently — see the matching comment in `numberCondition`.
  const givenFrom = "from" in condition ? isoDayOrNull(condition.from) : null
  const givenBefore = "before" in condition ? isoDayOrNull(condition.before) : null
  const [from, before] = orderedBounds(givenFrom, givenBefore)
  if (from === null && before === null) return null
  return { kind: "date", field, op: "range", from, before }
}

/** The operators `booleanCondition` accepts. See `TEXT_OPS`. */
const BOOLEAN_OPS = new Set<BooleanCondition["op"]>(["is", "blank", "notBlank"])

/**
 * Build a boolean condition.
 *
 * @param condition - The condition to normalise.
 * @returns The condition in canonical key order, or null if it constrains nothing.
 */
export function booleanCondition(condition: BooleanCondition): BooleanCondition | null {
  const { field, op } = condition
  if (!BOOLEAN_OPS.has(op)) return null
  if (op === "blank" || op === "notBlank") return { kind: "boolean", field, op }
  const value = "value" in condition ? condition.value : undefined
  if (typeof value !== "boolean") return null
  return { kind: "boolean", field, op: "is", value }
}

/** The operators `listCondition` accepts. See `TEXT_OPS`. */
const LIST_OPS = new Set<ListCondition["op"]>(["in", "notIn", "blank", "notBlank"])

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
  if (!LIST_OPS.has(op)) return null
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
      // Order the two picked days BEFORE making the later one exclusive: the
      // date editor's two day inputs are independent, so a user who fills
      // the end day first hands this a reversed `{ from, to }`. Adding one
      // day to the raw `to` before ordering put the +1 on the wrong end and
      // shorted the range by a day at both ends for reversed input.
      const [first, last] = orderedBounds(isoDayOrNull(choice.from), isoDayOrNull(choice.to))
      const before = last === null ? null : addDays(last, 1)
      if (last !== null && before === null) return null
      return dateCondition({ kind: "date", field, op: "range", from: first, before })
    }
    default:
      return null
  }
}

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
 * @param filters - Conditions as they came out of storage or from a host. Not
 *   trusted to actually be an array — untrusted JSON (a hand-edited
 *   `localStorage` entry, a server response) can hand this a string, a plain
 *   object or anything else `JSON.parse` produces.
 * @param knownColumnIds - Column ids the table currently defines.
 * @param filterKinds - Each column's resolved filter kind; `false` where
 *   filtering is off for it. Omitted, the kind check is skipped.
 * @returns The conditions worth keeping, one per column, each rebuilt in
 *   canonical form. Empty when `filters` is not an array.
 */
export function pruneFilters(
  filters: readonly FilterCondition[],
  knownColumnIds: readonly string[],
  filterKinds?: ReadonlyMap<string, FilterKind | false> | undefined,
): FilterCondition[] {
  // `filters` is typed as an array, but this is exactly the untrusted-input
  // boundary the type does not enforce at runtime: a stored `{"filters":{"a":1}}`
  // would otherwise reach `for...of` on a non-iterable and throw, crashing the
  // `useArrangement` initialiser that calls this on every mount with no
  // recovery — the bad entry is never cleared, so the crash repeats forever.
  if (!Array.isArray(filters)) return []
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
