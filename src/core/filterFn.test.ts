import type { Row } from "@tanstack/react-table"
import { afterEach, describe, expect, it } from "vitest"
import { filterFn_dt, isBlankValue, resolveCondition } from "./filterFn"
import type { DataTableFeatures } from "../useDataTable"
import { startOfLocalDay, type FilterCondition } from "./filters"

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
    // The rejecting half of each pair: a `return true` mutation on
    // `notContains`/`notEquals`, or pointing `startsWith`/`endsWith` at the
    // plain substring test, would pass the assertions above unnoticed.
    expect(matches({ kind: "text", field, op: "notContains", value: "agro" }, "Gallaorol agro")).toBe(false)
    expect(matches({ kind: "text", field, op: "notEquals", value: "agro" }, "Agro")).toBe(false)
    expect(matches({ kind: "text", field, op: "startsWith", value: "ROL" }, "Gallaorol")).toBe(false)
    expect(matches({ kind: "text", field, op: "endsWith", value: "GAL" }, "Gallaorol")).toBe(false)
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
    // The boundary each comparator must reject — without these, weakening
    // `lt`/`gt` to `<=`/`>=` and `eq` to `>=` still passes every assertion
    // above.
    expect(matches({ kind: "number", field, op: "lt", value: 10 }, 10)).toBe(false)
    expect(matches({ kind: "number", field, op: "gt", value: 10 }, 10)).toBe(false)
    expect(matches({ kind: "number", field, op: "lte", value: 10 }, 11)).toBe(false)
    expect(matches({ kind: "number", field, op: "gte", value: 10 }, 9)).toBe(false)
    expect(matches({ kind: "number", field, op: "eq", value: 10 }, 11)).toBe(false)
    expect(matches({ kind: "number", field, op: "ne", value: 10 }, 10)).toBe(false)
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
  // `process.env.TZ = undefined` does not unset the variable — env vars are
  // always strings, so it stores the literal text `"undefined"`, which ICU
  // then resolves to UTC instead of this machine's real zone. That would
  // silently flatten the three tests below to a fixed-offset zone, which is
  // the opposite of what a local-calendar test is for. Same restore as
  // `filters.test.ts`.
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ
    else process.env.TZ = ORIGINAL_TZ
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

  it("fails open on a non-object condition instead of throwing", () => {
    // Reachable from a host: table-core's own auto-remove strips only
    // `undefined` and `""`, so `column.setFilterValue(null)` (or a stored
    // layout whose value was serialised as null) reaches here as `null`.
    expect(resolveCondition(null as unknown as FilterCondition)).toEqual({ kind: "always" })
    expect(matches(null as unknown as FilterCondition, "anything")).toBe(true)
    expect(matches(null as unknown as FilterCondition, null)).toBe(true)
  })

  it("treats a bound with a key dropped by serialisation as unbounded, not blank", () => {
    // A backend that omits nulls (Go `omitempty`, Jackson NON_NULL,
    // protobuf-JSON) publishes only the bound it has. The dropped bound must
    // not turn the whole condition into "match only blank rows".
    const dateFromDropped = { kind: "date", field: "v", op: "range", before: "2026-04-01" } as FilterCondition
    expect(resolveCondition(dateFromDropped)).toEqual({
      kind: "date",
      from: null,
      before: startOfLocalDay("2026-04-01"),
    })
    expect(matches(dateFromDropped, "2026-03-15")).toBe(true)
    expect(matches(dateFromDropped, null)).toBe(false)

    const numberToDropped = { kind: "number", field: "v", op: "between", to: 20 } as FilterCondition
    expect(resolveCondition(numberToDropped)).toEqual({
      kind: "numberRange",
      min: Number.NEGATIVE_INFINITY,
      max: 20,
    })
    expect(matches(numberToDropped, 5)).toBe(true)
  })

  it("fails open when a valued op's own value key was dropped by serialisation", () => {
    // A missing `value`/`values` must not silently become "match only blank
    // rows" either — it constrains nothing, the same as an unreadable kind.
    expect(resolveCondition({ kind: "text", field: "v", op: "contains" } as FilterCondition)).toEqual({
      kind: "always",
    })
    expect(resolveCondition({ kind: "boolean", field: "v", op: "is" } as FilterCondition)).toEqual({
      kind: "always",
    })
    expect(resolveCondition({ kind: "list", field: "v", op: "in" } as FilterCondition)).toEqual({
      kind: "always",
    })
    expect(matches({ kind: "text", field: "v", op: "contains" } as FilterCondition, "anything")).toBe(true)
  })

  it("fails open on an operator its kind does not declare", () => {
    // Same untrusted door as the null condition above: an operator this
    // version does not know (a stale one from an older release, a miscased
    // one from a JS host) reached the inner switches, which either blanked
    // the table or — worse — dropped the operator and kept exactly the rows
    // the caller asked to exclude.
    const staleText = { kind: "text", field: "v", op: "matches", value: "agro" } as unknown as FilterCondition
    expect(resolveCondition(staleText)).toEqual({ kind: "always" })
    expect(matches(staleText, "Gallaorol agro")).toBe(true)
    expect(matches(staleText, null)).toBe(true)

    const staleNumber = { kind: "number", field: "v", op: "gtOrEq", value: 10 } as unknown as FilterCondition
    expect(matches(staleNumber, 5)).toBe(true)

    // `isNot` used to resolve to a bare `{ kind: "boolean", value }`, i.e. `is`.
    const staleBoolean = { kind: "boolean", field: "v", op: "isNot", value: true } as unknown as FilterCondition
    expect(matches(staleBoolean, false)).toBe(true)

    // `notInAll` used to resolve with `negated: false`, i.e. `in`.
    const staleList = { kind: "list", field: "v", op: "notInAll", values: ["open"] } as unknown as FilterCondition
    expect(matches(staleList, "closed")).toBe(true)

    // The date branch never looked at `op` at all, so an unreadable operator
    // became an unbounded range that still rejected every non-date value.
    const staleDate = { kind: "date", field: "v", op: "onOrBefore", day: "2026-04-01" } as unknown as FilterCondition
    expect(matches(staleDate, null)).toBe(true)
    expect(matches(staleDate, "not a date")).toBe(true)
  })

  it("fails open on a non-finite number rather than matching nothing", () => {
    // `typeof NaN === "number"`, so both value checks passed and the
    // comparison then failed for every row. `filters.ts` rejects non-finite
    // numbers through `finiteOrNull`; this module has to agree with it.
    const nanValue = { kind: "number", field: "v", op: "eq", value: Number.NaN } as FilterCondition
    expect(resolveCondition(nanValue)).toEqual({ kind: "always" })
    expect(matches(nanValue, 1)).toBe(true)

    const nanBound = { kind: "number", field: "v", op: "between", from: Number.NaN, to: 20 } as FilterCondition
    expect(resolveCondition(nanBound)).toEqual({
      kind: "numberRange",
      min: Number.NEGATIVE_INFINITY,
      max: 20,
    })
    expect(matches(nanBound, 5)).toBe(true)
    expect(matches(nanBound, 25)).toBe(false)
  })

  it("resolves the canonical condition, so the client agrees with the wire", () => {
    // `pruneFilters` orders reversed bounds and sorts list values before
    // `buildQuery` sees them. A host that registers `filterFn_dt` on its own
    // column hands conditions straight here, and a client that read them
    // differently would disagree with its own backend.
    const reversed = { kind: "number", field: "v", op: "between", from: 20, to: 10 } as FilterCondition
    expect(matches(reversed, 15)).toBe(true)
    const reversedDays = {
      kind: "date",
      field: "v",
      op: "range",
      from: "2026-04-01",
      before: "2026-03-01",
    } as FilterCondition
    expect(matches(reversedDays, "2026-03-15")).toBe(true)
  })

  it("fails open on an empty needle, the way the layout drops it", () => {
    // `textCondition` returns null for `contains ""` — it constrains nothing,
    // so it is never stored and never published, and the server therefore
    // returns every row. Matching "every non-blank row" here would make the
    // client hide rows the backend kept.
    const emptyNeedle = { kind: "text", field: "v", op: "contains", value: "" } as FilterCondition
    expect(resolveCondition(emptyNeedle)).toEqual({ kind: "always" })
    expect(matches(emptyNeedle, null)).toBe(true)
  })
})
