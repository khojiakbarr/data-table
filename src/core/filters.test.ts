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
