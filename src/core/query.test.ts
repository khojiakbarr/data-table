import { describe, expect, it } from "vitest"
import { listCondition, textCondition, type FilterCondition } from "./filters"
import { buildQuery, queriesEqual } from "./query"

const amount: FilterCondition = { kind: "number", field: "amount", op: "gte", value: 1000 }
const partner = textCondition({ kind: "text", field: "partner", op: "contains", value: "agro" })!
const status = listCondition({ kind: "list", field: "status", op: "in", values: ["open", "in_process"] })!

describe("buildQuery", () => {
  it("carries sorting, filters, search and pagination", () => {
    const query = buildQuery({
      sorting: [{ id: "date", desc: true }],
      filters: [partner],
      search: { text: "KR-102", fields: ["code"] },
      pageIndex: 2,
      pageSize: 50,
    })

    expect(query).toEqual({
      sorting: [{ id: "date", desc: true }],
      filters: [partner],
      search: { text: "KR-102", fields: ["code"] },
      grouping: [],
      pagination: { pageIndex: 2, pageSize: 50 },
    })
  })

  it("sorts filters by field, whatever order they were set in", () => {
    // Column order is a layout slice the user drags. Emitting filters in column
    // position order would change the query string — and refetch an identical
    // result set, with the page reset — every time a column moved.
    const query = buildQuery({
      sorting: [],
      filters: [status, partner, amount],
      search: null,
      pageIndex: 0,
      pageSize: 50,
    })
    expect(query.filters.map((condition) => condition.field)).toEqual(["amount", "partner", "status"])
  })

  it("sorts search fields by id, and carries a null search as null", () => {
    const query = buildQuery({
      sorting: [],
      filters: [],
      search: { text: "kr", fields: ["status", "code", "partner"] },
      pageIndex: 0,
      pageSize: 50,
    })
    expect(query.search).toEqual({ text: "kr", fields: ["code", "partner", "status"] })
    expect(buildQuery({ sorting: [], filters: [], search: null, pageIndex: 0, pageSize: 50 }).search).toBeNull()
  })
})

describe("queriesEqual", () => {
  const base = buildQuery({
    sorting: [{ id: "date", desc: false }],
    filters: [],
    search: null,
    pageIndex: 0,
    pageSize: 50,
  })

  it("is true for structurally equal queries", () => {
    const same = buildQuery({
      sorting: [{ id: "date", desc: false }],
      filters: [],
      search: null,
      pageIndex: 0,
      pageSize: 50,
    })
    expect(queriesEqual(base, same)).toBe(true)
  })

  it("is false when any field differs", () => {
    expect(queriesEqual(base, { ...base, pagination: { pageIndex: 1, pageSize: 50 } })).toBe(false)
    expect(queriesEqual(base, { ...base, sorting: [{ id: "date", desc: true }] })).toBe(false)
    expect(queriesEqual(base, { ...base, search: { text: "x", fields: [] } })).toBe(false)
    expect(queriesEqual(base, { ...base, filters: [partner] })).toBe(false)
  })

  it("is true for a reordered-but-identical filters array", () => {
    const inputs = { sorting: [], search: null, pageIndex: 0, pageSize: 50 }
    const oneWay = buildQuery({ ...inputs, filters: [amount, partner, status] })
    const other = buildQuery({ ...inputs, filters: [status, amount, partner] })
    expect(queriesEqual(oneWay, other)).toBe(true)
  })

  it("is true for a reordered-but-identical values list and search fields", () => {
    const reticked = listCondition({ kind: "list", field: "status", op: "in", values: ["in_process", "open"] })!
    const inputs = { sorting: [], pageIndex: 0, pageSize: 50 }
    const oneWay = buildQuery({ ...inputs, filters: [status], search: { text: "a", fields: ["b", "a"] } })
    const other = buildQuery({ ...inputs, filters: [reticked], search: { text: "a", fields: ["a", "b"] } })
    expect(queriesEqual(oneWay, other)).toBe(true)
  })
})
