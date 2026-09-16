import { describe, expect, it } from "vitest"
import { buildQuery, queriesEqual } from "./query"

describe("buildQuery", () => {
  it("carries sorting and pagination, and reserves the later fields", () => {
    const query = buildQuery({ sorting: [{ id: "date", desc: true }], pageIndex: 2, pageSize: 50 })

    expect(query).toEqual({
      sorting: [{ id: "date", desc: true }],
      columnFilters: [],
      globalFilter: "",
      grouping: [],
      pagination: { pageIndex: 2, pageSize: 50 },
    })
  })
})

describe("queriesEqual", () => {
  const base = buildQuery({ sorting: [{ id: "date", desc: false }], pageIndex: 0, pageSize: 50 })

  it("is true for structurally equal queries", () => {
    expect(queriesEqual(base, buildQuery({ sorting: [{ id: "date", desc: false }], pageIndex: 0, pageSize: 50 }))).toBe(true)
  })

  it("is false when any field differs", () => {
    expect(queriesEqual(base, { ...base, pagination: { pageIndex: 1, pageSize: 50 } })).toBe(false)
    expect(queriesEqual(base, { ...base, sorting: [{ id: "date", desc: true }] })).toBe(false)
    expect(queriesEqual(base, { ...base, globalFilter: "x" })).toBe(false)
  })
})
