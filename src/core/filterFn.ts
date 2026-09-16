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
  // A filter value reaches this from `state.columnFilters`, which any host can
  // write through TanStack's own `setFilterValue` — table-core auto-removes
  // only `undefined` and `""`, so a `null` (or any other non-object) lands
  // here and must fail open rather than throw on `condition.kind`.
  if (typeof condition !== "object" || condition === null) return { kind: "always" }
  switch (condition.kind) {
    case "text": {
      if (condition.op === "blank" || condition.op === "notBlank") return blankResolved(condition.op)
      // Branch on `op` — the actual discriminant — before reading `value`: a
      // condition serialised by a backend that omits nulls (Go `omitempty`,
      // Jackson NON_NULL, protobuf-JSON) can carry a valued op with its
      // `value` key dropped, and that must fail open, not silently become a
      // blank filter. See the matching comment in `textCondition`.
      if (!("value" in condition) || typeof condition.value !== "string") return { kind: "always" }
      return { kind: "text", op: condition.op, needle: condition.value.toLowerCase() }
    }
    case "number": {
      if (condition.op === "blank" || condition.op === "notBlank") return blankResolved(condition.op)
      if (condition.op === "between") {
        // Read each bound independently — a bound whose key was dropped in
        // serialisation is unbounded, not a blank filter. See the matching
        // comment in `numberCondition`.
        const from = "from" in condition && typeof condition.from === "number" ? condition.from : null
        const to = "to" in condition && typeof condition.to === "number" ? condition.to : null
        return {
          kind: "numberRange",
          min: from ?? Number.NEGATIVE_INFINITY,
          max: to ?? Number.POSITIVE_INFINITY,
        }
      }
      if (!("value" in condition) || typeof condition.value !== "number") return { kind: "always" }
      return { kind: "number", op: condition.op, value: condition.value }
    }
    case "date": {
      if (condition.op === "blank" || condition.op === "notBlank") return blankResolved(condition.op)
      // A bound whose key was dropped in serialisation is unbounded, not a
      // blank filter: see the matching comment in `dateCondition`.
      return {
        kind: "date",
        from: "from" in condition && condition.from !== null ? startOfLocalDay(condition.from) : null,
        before: "before" in condition && condition.before !== null ? startOfLocalDay(condition.before) : null,
      }
    }
    case "boolean": {
      if (condition.op === "blank" || condition.op === "notBlank") return blankResolved(condition.op)
      if (!("value" in condition) || typeof condition.value !== "boolean") return { kind: "always" }
      return { kind: "boolean", value: condition.value }
    }
    case "list": {
      if (condition.op === "blank" || condition.op === "notBlank") return blankResolved(condition.op)
      if (!("values" in condition) || !Array.isArray(condition.values)) return { kind: "always" }
      return { kind: "list", negated: condition.op === "notIn", values: new Set(condition.values) }
    }
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
