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
})
