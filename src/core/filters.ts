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
