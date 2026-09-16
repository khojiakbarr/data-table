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
 * @param date - Any date.
 * @returns Its local calendar day, `YYYY-MM-DD`.
 */
export function toIsoDay(date: Date): IsoDay {
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
 * @param days - How many days to move; may be negative.
 * @returns The moved day, or null if `day` is not a day.
 */
export function addDays(day: IsoDay, days: number): IsoDay | null {
  const start = startOfLocalDay(day)
  if (start === null) return null
  const moved = new Date(start)
  moved.setDate(moved.getDate() + days)
  return toIsoDay(moved)
}

/** Whether a value can be a member of a list condition. */
export function isFilterValue(value: unknown): value is FilterValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}
