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
