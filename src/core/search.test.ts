import { describe, expect, it } from "vitest"
import { collectSearchFields, isSearchableColumn, rowMatchesSearch, searchNeedle } from "./search"

interface Receipt {
  code: string
  amount: number
  created: Date
  paid: boolean
  partner: { name: string }
  note: string | null
}

const rows: Receipt[] = [
  { code: "KR-1", amount: 100, created: new Date(2026, 2, 1), paid: false, partner: { name: "Agro" }, note: "a" },
  { code: "KR-2", amount: 500, created: new Date(2026, 2, 2), paid: true, partner: { name: "Temir" }, note: "b" },
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

  it("has no better answer than false for a column with no sample yet — the ambiguity is a matter for collectSearchFields", () => {
    // Documents the boundary of this function's contract: called on its own,
    // "no evidence yet" and "evidence of not being text" are indistinguishable.
    // Only `collectSearchFields`, which can see whether a sample was ever
    // found, is able to tell the two apart via `unresolved`.
    expect(isSearchableColumn({ meta: undefined, hasAccessor: true, sampleValue: undefined }, true)).toBe(false)
  })
})

describe("collectSearchFields", () => {
  it("walks nested groups and returns the ids sorted", () => {
    const { fields } = collectSearchFields<Receipt>(
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
    expect(
      collectSearchFields<Receipt>([{ accessorKey: "partner.name" }, { accessorKey: "code" }], rows, { code: false }).fields,
    ).toEqual(["partner_name"])
    expect(
      collectSearchFields<Receipt>([{ accessorKey: "partner.name" }], rows, { partner_name: false }).fields,
    ).toEqual([])
  })

  it("reports a column with no rows to sample yet as unresolved, not as excluded from fields", () => {
    // Regression: this used to fold "no sample found" straight into `false`,
    // so a table mounting before its first page of rows arrived (server mode,
    // or async client data) reported every unmeta'd column as unsearchable —
    // `fields` came back `[]` even though every column here is a perfectly
    // ordinary text/number field once data shows up.
    const result = collectSearchFields<Receipt>(
      [{ accessorKey: "code" }, { accessorKey: "amount" }, { id: "actions" }],
      [],
      {},
    )
    expect(result.fields).toEqual([])
    // Accessor-backed and visible, so both are unresolved rather than "known
    // not searchable" — a display column never is, it has no value either way.
    expect(result.unresolved).toEqual(["amount", "code"])
  })

  it("keeps a column whose sampled rows are all null unresolved rather than dropping it from the searchable set", () => {
    // Regression: paging in server mode recomputes the field list from each
    // page's own rows. A nullable text column (e.g. `note`) that is null
    // across the sampled rows of one page — but held a string on another —
    // used to silently narrow `fields`, which changes which columns are
    // searched for the same text between page 1 and page 2 of the same query.
    interface Page {
      id: string
      note: string | null
    }
    const nullNotePage: Page[] = Array.from({ length: 25 }, (_unused, index) => ({ id: `r${index}`, note: null }))
    const result = collectSearchFields<Page>([{ accessorKey: "id" }, { accessorKey: "note" }], nullNotePage, {})
    expect(result.fields).toEqual(["id"])
    // Not folded into `false`: nothing declared, and none of the 20 sampled
    // rows offered a non-null value, so the honest answer is "don't know yet".
    expect(result.unresolved).toEqual(["note"])

    // A row with a real value past the 20-row sample window changes nothing —
    // `firstNonNull` never looks that far, so the column stays unresolved
    // rather than flip-flopping once one more row happens to load.
    const withLateValue: Page[] = [...nullNotePage, { id: "r25", note: "hello" }]
    const resultWithLateValue = collectSearchFields<Page>([{ accessorKey: "id" }, { accessorKey: "note" }], withLateValue, {})
    expect(resultWithLateValue.unresolved).toEqual(["note"])
  })

  it("never marks a column unresolved once meta.searchable is declared, even with nothing to sample", () => {
    // An explicit `false` is a definite, data-independent answer — it must
    // stay out of both `fields` and `unresolved`, not just out of `fields`.
    const result = collectSearchFields<Receipt>([{ accessorKey: "code", meta: { searchable: false } }], [], {})
    expect(result.fields).toEqual([])
    expect(result.unresolved).toEqual([])
  })

  it("excludes a hidden column from unresolved too, not only from fields", () => {
    const result = collectSearchFields<Receipt>([{ accessorKey: "code" }], [], { code: false })
    expect(result.fields).toEqual([])
    expect(result.unresolved).toEqual([])
  })
})

describe("searchNeedle", () => {
  it("lower-cases and splits on whitespace, dropping empties", () => {
    expect(searchNeedle("  KR-102   Agro ")).toEqual({ tokens: ["kr-102", "agro"] })
    expect(searchNeedle("")).toEqual({ tokens: [] })
    expect(searchNeedle(undefined)).toEqual({ tokens: [] })
  })
})

describe("rowMatchesSearch", () => {
  const row = (values: Record<string, unknown>) => ({
    table: {
      getAllLeafColumns: () => [
        { id: "code", getCanGlobalFilter: () => true },
        { id: "partner", getCanGlobalFilter: () => true },
        { id: "secret", getCanGlobalFilter: () => false },
      ],
    },
    getValue: (columnId: string) => values[columnId],
  })

  it("matches every token, and lets different tokens match different columns", () => {
    const subject = row({ code: "KR-102", partner: "Agro Ltd", secret: "zzz" })
    expect(rowMatchesSearch(subject, searchNeedle("kr-102 agro"))).toBe(true)
    expect(rowMatchesSearch(subject, searchNeedle("KR-102 AGRO"))).toBe(true)
    expect(rowMatchesSearch(subject, searchNeedle("kr-102 temir"))).toBe(false)
  })

  it("never reads a column the table is not searching", () => {
    expect(rowMatchesSearch(row({ code: "KR-1", partner: "Agro", secret: "zzz" }), searchNeedle("zzz"))).toBe(false)
  })

  it("matches every row for an empty needle, and treats a nullish value as empty text", () => {
    expect(rowMatchesSearch(row({ code: null, partner: undefined }), searchNeedle("  "))).toBe(true)
    expect(rowMatchesSearch(row({ code: null, partner: undefined }), searchNeedle("a"))).toBe(false)
  })
})
