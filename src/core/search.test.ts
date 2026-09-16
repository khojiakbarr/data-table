import { describe, expect, it } from "vitest"
import { collectSearchFields, isSearchableColumn } from "./search"

interface Receipt {
  code: string
  amount: number
  created: Date
  paid: boolean
  partner: { name: string }
}

const rows: Receipt[] = [
  { code: "KR-1", amount: 100, created: new Date(2026, 2, 1), paid: false, partner: { name: "Agro" } },
  { code: "KR-2", amount: 500, created: new Date(2026, 2, 2), paid: true, partner: { name: "Temir" } },
]

describe("isSearchableColumn", () => {
  it("defaults to a column whose first value is a string or a number", () => {
    expect(isSearchableColumn({ meta: undefined, hasAccessor: true, sampleValue: "KR-1" }, true)).toBe(true)
    expect(isSearchableColumn({ meta: undefined, hasAccessor: true, sampleValue: 100 }, true)).toBe(true)
    expect(isSearchableColumn({ meta: undefined, hasAccessor: true, sampleValue: true }, true)).toBe(false)
    expect(isSearchableColumn({ meta: undefined, hasAccessor: true, sampleValue: new Date() }, true)).toBe(false)
  })

  it("takes meta.searchable over the heuristic, both ways", () => {
    // TanStack's own heuristic is a gate underneath the flags, so a host
    // marking a Date column searchable would still be excluded by it.
    expect(isSearchableColumn({ meta: { searchable: true }, hasAccessor: true, sampleValue: new Date() }, true)).toBe(true)
    expect(isSearchableColumn({ meta: { searchable: false }, hasAccessor: true, sampleValue: "KR-1" }, true)).toBe(false)
  })

  it("excludes a hidden column, and a display column that has no value to search", () => {
    expect(isSearchableColumn({ meta: { searchable: true }, hasAccessor: true, sampleValue: "KR-1" }, false)).toBe(false)
    expect(isSearchableColumn({ meta: { searchable: true }, hasAccessor: false, sampleValue: undefined }, true)).toBe(false)
  })
})

describe("collectSearchFields", () => {
  it("walks nested groups and returns the ids sorted", () => {
    const fields = collectSearchFields<Receipt>(
      [
        { id: "money", columns: [{ accessorKey: "amount" }, { accessorKey: "paid" }] },
        { accessorKey: "code" },
        { accessorKey: "created" },
        { id: "actions" },
      ],
      rows,
      {},
    )
    // `paid` is a boolean, `created` a Date, `actions` a display column, and a
    // group carries no value of its own.
    expect(fields).toEqual(["amount", "code"])
  })

  it("drops a hidden column and derives a dotted accessorKey's id the way TanStack does", () => {
    // `constructColumn` gives `"partner.name"` the live id `"partner_name"`,
    // so that is what `columnVisibility` is keyed by and what `search.fields`
    // has to carry: a list built from the dotted key would silently miss the
    // visibility flag and name a column the table does not have. Only the
    // *value* is read through the dots, by `valueReader`.
    expect(collectSearchFields<Receipt>([{ accessorKey: "partner.name" }, { accessorKey: "code" }], rows, { code: false }))
      .toEqual(["partner_name"])
    expect(collectSearchFields<Receipt>([{ accessorKey: "partner.name" }], rows, { partner_name: false })).toEqual([])
  })
})
