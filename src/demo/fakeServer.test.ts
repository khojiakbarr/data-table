import { describe, expect, it } from "vitest"
import type { FilterCondition } from "../core/filters"
import type { TableQuery } from "../core/query"
import { fetchReceipts, fetchValues } from "./fakeServer"

/**
 * Drives the fake server directly, one case per operator, against the same
 * semantics `filterFn_dt`'s own tests assert: all six text operators
 * case-insensitive, `between`/date ranges inclusive-low/exclusive-high with
 * `null` unbounded, and negated operators never matching a blank value. If
 * this file and `filterFn.test.ts` ever disagree, the contract is wrong
 * somewhere — see `fakeServer.ts`'s docblock.
 *
 * Every test below scopes to an exact list of ten codes first — rows 0–9, a
 * deterministic, hand-computed slice of the 100 000 generated rows — so each
 * operator's result set is exact and small, without asserting on the
 * dataset's internal generation formula anywhere else. Naming them by an
 * exact `in` list rather than a `code` prefix: `"KR-1000"` is also a prefix
 * of six-digit codes like `KR-100026` (index 90 026), so a `startsWith` scope
 * silently pulls in far more than rows 0–9.
 */
const SCOPE_CODES = Array.from({ length: 10 }, (_, index) => `KR-${10_000 + index}`)
const SCOPE: FilterCondition = { kind: "list", field: "code", op: "in", values: SCOPE_CODES }

function query(filters: FilterCondition[], overrides: Partial<TableQuery> = {}): TableQuery {
  return {
    sorting: [],
    filters,
    search: null,
    grouping: [],
    pagination: { pageIndex: 0, pageSize: 20 },
    ...overrides,
  }
}

async function codesFor(filter: FilterCondition): Promise<string[]> {
  const page = await fetchReceipts(query([SCOPE, filter]), { delayMs: 0 })
  return page.rows.map((row) => row.code).sort()
}

describe("fetchReceipts — text operators (case-insensitive)", () => {
  it("contains", async () => {
    expect(await codesFor({ kind: "text", field: "partner", op: "contains", value: "kimyo" })).toEqual([
      "KR-10003",
      "KR-10007",
    ])
  })

  it("notContains", async () => {
    const codes = await codesFor({ kind: "text", field: "partner", op: "notContains", value: "kimyo" })
    expect(codes).toHaveLength(8)
    expect(codes).not.toContain("KR-10003")
    expect(codes).not.toContain("KR-10007")
  })

  it("equals", async () => {
    expect(
      await codesFor({ kind: "text", field: "partner", op: "equals", value: "toshkent kimyo zavodi" }),
    ).toEqual(["KR-10003", "KR-10007"])
  })

  it("notEquals", async () => {
    const codes = await codesFor({ kind: "text", field: "partner", op: "notEquals", value: "toshkent kimyo zavodi" })
    expect(codes).toHaveLength(8)
  })

  it("startsWith", async () => {
    expect(await codesFor({ kind: "text", field: "partner", op: "startsWith", value: "tosh" })).toEqual([
      "KR-10003",
      "KR-10007",
    ])
  })

  it("endsWith", async () => {
    expect(await codesFor({ kind: "text", field: "partner", op: "endsWith", value: "zavodi" })).toEqual([
      "KR-10003",
      "KR-10007",
    ])
  })
})

describe("fetchReceipts — number operators", () => {
  it("eq", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "eq", value: 310_000 })).toEqual(["KR-10000"])
  })

  it("ne", async () => {
    const codes = await codesFor({ kind: "number", field: "amount", op: "ne", value: 310_000 })
    expect(codes).toHaveLength(9)
    expect(codes).not.toContain("KR-10000")
  })

  it("lt", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "lt", value: 2_000_000 })).toEqual([
      "KR-10000",
      "KR-10001",
    ])
  })

  it("lte is inclusive at the boundary", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "lte", value: 2_146_466 })).toEqual([
      "KR-10000",
      "KR-10001",
      "KR-10002",
    ])
  })

  it("gt", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "gt", value: 8_000_000 })).toEqual(["KR-10009"])
  })

  it("gte is inclusive at the boundary", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "gte", value: 7_655_864 })).toEqual([
      "KR-10008",
      "KR-10009",
    ])
  })

  it("between is inclusive on both ends", async () => {
    expect(
      await codesFor({ kind: "number", field: "amount", op: "between", from: 1_228_233, to: 3_064_699 }),
    ).toEqual(["KR-10001", "KR-10002", "KR-10003"])
  })

  it("between treats a null bound as unbounded", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "between", from: null, to: 1_228_233 })).toEqual([
      "KR-10000",
      "KR-10001",
    ])
  })
})

describe("fetchReceipts — date range: from inclusive, before exclusive", () => {
  it("keeps the lower bound and drops the upper", async () => {
    expect(
      await codesFor({ kind: "date", field: "date", op: "range", from: "2026-03-03", before: "2026-06-06" }),
    ).toEqual(["KR-10002", "KR-10003", "KR-10004"])
  })

  it("supports a null (unbounded) start", async () => {
    expect(await codesFor({ kind: "date", field: "date", op: "range", from: null, before: "2026-02-02" })).toEqual([
      "KR-10000",
    ])
  })
})

describe("fetchReceipts — boolean and list operators", () => {
  it("boolean is", async () => {
    expect(await codesFor({ kind: "boolean", field: "flagged", op: "is", value: true })).toEqual([
      "KR-10000",
      "KR-10007",
    ])
  })

  it("list in", async () => {
    expect(
      await codesFor({ kind: "list", field: "status", op: "in", values: ["open", "closed"] }),
    ).toEqual(["KR-10000", "KR-10003", "KR-10004", "KR-10007", "KR-10008"])
  })

  it("list notIn", async () => {
    expect(
      await codesFor({ kind: "list", field: "status", op: "notIn", values: ["open", "closed"] }),
    ).toEqual(["KR-10001", "KR-10002", "KR-10005", "KR-10006", "KR-10009"])
  })
})

describe("fetchReceipts — blank / notBlank", () => {
  it("blank matches nothing when every row in scope has a value", async () => {
    expect(await codesFor({ kind: "text", field: "code", op: "blank" })).toEqual([])
  })

  it("notBlank matches every row in scope", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "notBlank" })).toHaveLength(10)
  })
})

describe("fetchReceipts — quick search: AND over tokens, OR over fields", () => {
  it("requires every token, letting different tokens match different fields", async () => {
    const page = await fetchReceipts(
      query([SCOPE], { search: { text: "kimyo 10007", fields: ["partner", "code"] } }),
      { delayMs: 0 },
    )
    expect(page.rows.map((row) => row.code)).toEqual(["KR-10007"])
  })
})

describe("fetchReceipts — sorting and pagination", () => {
  it("sorts by the requested column and direction", async () => {
    const page = await fetchReceipts(query([SCOPE], { sorting: [{ id: "amount", desc: true }] }), { delayMs: 0 })
    expect(page.rows[0]?.code).toBe("KR-10009")
  })

  it("slices by pageIndex/pageSize and reports the total that matched", async () => {
    const page = await fetchReceipts(query([SCOPE], { pagination: { pageIndex: 1, pageSize: 3 } }), { delayMs: 0 })
    expect(page.rows.map((row) => row.code)).toEqual(["KR-10003", "KR-10004", "KR-10005"])
    expect(page.total).toBe(10)
  })
})

describe("fetchReceipts — the injected failure", () => {
  it("rejects instead of resolving when fail is requested", async () => {
    await expect(fetchReceipts(query([SCOPE]), { fail: true, delayMs: 0 })).rejects.toThrow(
      "Simulated network failure",
    )
  })
})

describe("fetchValues", () => {
  it("returns every distinct value with its count", async () => {
    const controller = new AbortController()
    const values = await fetchValues("status", { search: "", signal: controller.signal })
    const byValue = new Map(values.map((option) => [option.value, option.count]))
    expect(byValue.get("open")).toBe(25_000)
    expect(byValue.get("in_process")).toBe(25_000)
    expect(byValue.get("received")).toBe(25_000)
    expect(byValue.get("closed")).toBe(25_000)
  })

  it("filters distinct values by the editor's search box", async () => {
    const controller = new AbortController()
    const values = await fetchValues("status", { search: "clo", signal: controller.signal })
    expect(values.map((option) => option.value)).toEqual(["closed"])
  })

  it("rejects when the caller aborts", async () => {
    const controller = new AbortController()
    const pending = fetchValues("status", { search: "", signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow("Aborted")
  })
})
