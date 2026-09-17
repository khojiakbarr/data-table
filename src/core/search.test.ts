import { describe, expect, it } from "vitest"
import { collectSearchFields, filterFn_dtSearch, isSearchableColumn, rowMatchesSearch, searchNeedle } from "./search"

/**
 * A minimal stub satisfying what `rowMatchesSearch` and `filterFn_dtSearch`
 * actually read off a row: `table.getAllLeafColumns()` for the searched
 * column set, and `getValue` for each field's text. Shared by the
 * `rowMatchesSearch` and `filterFn_dtSearch` suites below rather than
 * duplicated between them.
 */
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

  it("excludes a column with enableGlobalFilter: false, even over an explicit meta.searchable: true", () => {
    // TanStack's own `column_getCanGlobalFilter` ANDs `columnDef.enableGlobalFilter
    // ?? true` into the client's verdict regardless of this library's own
    // gate, so a column opted out that way can never actually be searched
    // client-side — this function has to agree, or `search.fields` on the
    // wire would claim a column the client silently refuses to match.
    expect(
      isSearchableColumn(
        { meta: { searchable: true }, hasAccessor: true, sampleValue: "KR-1", enableGlobalFilter: false },
        true,
      ),
    ).toBe(false)
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

  it("reports a resolved-false column separately from an unresolved one", () => {
    // `excluded` is what tells a caller that remembers verdicts across
    // renders (`useDataTable`'s monotonic search-field cache) that a column
    // has a definite "no" — as opposed to "no evidence yet" — without having
    // to re-derive it from `fields` and the full column set.
    const result = collectSearchFields<Receipt>(
      [{ accessorKey: "code" }, { accessorKey: "created" }, { accessorKey: "paid", meta: { searchable: false } }],
      rows,
      {},
    )
    expect(result.fields).toEqual(["code"])
    // `created` (a Date) and `paid` (declared false) both have a definite
    // answer this call — neither is missing evidence.
    expect(result.excluded).toEqual(["created", "paid"])
    expect(result.unresolved).toEqual([])
  })

  it("resolves enableGlobalFilter: false immediately, without a sample, and reports it as declared", () => {
    // `enableGlobalFilter` is a static column-def option, not data-dependent
    // like `meta.searchable` paired with inference — it never needs to wait
    // for a row to arrive the way an unmeta'd column does.
    const result = collectSearchFields<Receipt>([{ accessorKey: "code", enableGlobalFilter: false }], [], {})
    expect(result.fields).toEqual([])
    expect(result.excluded).toEqual(["code"])
    expect(result.unresolved).toEqual([])
    expect(result.declared).toEqual(["code"])
  })

  it("separates ids resolved by a declaration from ids resolved by inference", () => {
    // `useDataTable`'s monotonic search-field cache only applies to the
    // inference path — it reads `declared` to skip caching an id whose
    // searchability came from the column definition itself.
    const result = collectSearchFields<Receipt>(
      [{ accessorKey: "code" }, { accessorKey: "amount", meta: { searchable: false } }],
      rows,
      {},
    )
    expect(result.fields).toEqual(["code"])
    expect(result.excluded).toEqual(["amount"])
    // `code` was inferred from its sampled string value; `amount` was
    // declared false via `meta.searchable` — only the latter is `declared`.
    expect(result.declared).toEqual(["amount"])
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

  it("re-reads the table's searched columns on every call, even for a needle a caller reuses across passes", () => {
    // Reproduces the review finding on Task 8: a host that memoises a needle
    // (e.g. `useMemo(() => searchNeedle(text), [text])`) and reuses it across
    // renders must see a column drop out of search the moment
    // `getCanGlobalFilter` says so — not a stale answer frozen at first call.
    let partnerSearchable = true
    const subject = {
      table: {
        getAllLeafColumns: () => [
          { id: "code", getCanGlobalFilter: () => true },
          { id: "partner", getCanGlobalFilter: () => partnerSearchable },
        ],
      },
      getValue: (columnId: string) => ({ code: "KR-1", partner: "Agro Ltd" })[columnId],
    }
    const needle = searchNeedle("agro")

    expect(rowMatchesSearch(subject, needle)).toBe(true)

    partnerSearchable = false
    expect(rowMatchesSearch(subject, needle)).toBe(false)
  })
})

describe("filterFn_dtSearch", () => {
  /**
   * Call the filter the way TanStack's own `constructFilterFn` docblock
   * prescribes for a direct, out-of-table call — the same shape
   * `filterFn.test.ts`'s `matches` helper uses for `filterFn_dt`.
   *
   * The row stub is not a full TanStack `Row`, only what the predicate
   * actually reads (`table.getAllLeafColumns` and `getValue`); `as never` is
   * how `filterFn.test.ts`'s sibling test reaches the same real code path
   * without constructing one.
   */
  const call = (subject: ReturnType<typeof row>, columnId: string, text: string): boolean =>
    filterFn_dtSearch(subject as never, columnId, filterFn_dtSearch.resolveFilterValue?.(text) ?? text, () => undefined)

  it("returns the same row-level verdict whichever column it is asked about", () => {
    const subject = row({ code: "KR-102", partner: "Agro Ltd", secret: "zzz" })
    expect(call(subject, "code", "kr-102 agro")).toBe(true)
    expect(call(subject, "partner", "kr-102 agro")).toBe(true) // ignores the columnId it is handed
    expect(call(subject, "code", "zzz")).toBe(false) // never reads a non-searched column
  })

  it("never returns a stale verdict for a needle built with searchNeedle and handed to it directly, bypassing resolveFilterValue", () => {
    // Reproduces the review finding on Task 8's round-1 fix: a host that
    // mints a needle with the public `searchNeedle` — as its own JSDoc
    // invites — and calls the exported `filterFn_dtSearch` with it directly,
    // skipping `resolveFilterValue`, must not read a field list cached
    // before a column stopped being searched. Only a needle
    // `resolveFilterValue` mints itself may use that per-pass cache.
    let partnerSearchable = true
    const subject = {
      table: {
        getAllLeafColumns: () => [
          { id: "code", getCanGlobalFilter: () => true },
          { id: "partner", getCanGlobalFilter: () => partnerSearchable },
        ],
      },
      getValue: (columnId: string) => ({ code: "KR-1", partner: "Agro Ltd" } as Record<string, unknown>)[columnId],
    }
    const needle = searchNeedle("agro")

    expect(filterFn_dtSearch(subject as never, "code", needle, () => undefined)).toBe(true)

    partnerSearchable = false
    expect(filterFn_dtSearch(subject as never, "code", needle, () => undefined)).toBe(false)
  })
})
