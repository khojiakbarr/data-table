import { describe, expect, it } from "vitest"
import { collectFilterKinds, resolveFilterKind } from "./filterKinds"

interface Receipt {
  code: string
  amount: number | null
  paid: boolean
  partner: { name: string }
}

describe("resolveFilterKind", () => {
  it("takes the declared kind, including false", () => {
    expect(resolveFilterKind({ meta: { filter: "list" }, hasAccessor: true, sampleValue: 5 })).toBe("list")
    expect(resolveFilterKind({ meta: { filter: false }, hasAccessor: true, sampleValue: "x" })).toBe(false)
  })

  it("infers from the first non-null value when nothing is declared", () => {
    expect(resolveFilterKind({ meta: undefined, hasAccessor: true, sampleValue: "x" })).toBe("text")
    expect(resolveFilterKind({ meta: undefined, hasAccessor: true, sampleValue: 5 })).toBe("number")
    expect(resolveFilterKind({ meta: undefined, hasAccessor: true, sampleValue: true })).toBe("boolean")
    // Anything else — a Date, an object — falls back to text rather than
    // guessing at an editor that cannot read it.
    expect(resolveFilterKind({ meta: undefined, hasAccessor: true, sampleValue: new Date() })).toBe("text")
    expect(resolveFilterKind({ meta: undefined, hasAccessor: true, sampleValue: undefined })).toBe("text")
  })

  it("turns filtering off for a display column, which has no value to filter", () => {
    expect(resolveFilterKind({ meta: undefined, hasAccessor: false, sampleValue: undefined })).toBe(false)
  })
})

describe("collectFilterKinds", () => {
  const rows: Receipt[] = [
    { code: "KR-1", amount: null, paid: false, partner: { name: "Agro" } },
    { code: "KR-2", amount: 500, paid: true, partner: { name: "Temir" } },
  ]

  it("walks nested groups and resolves every leaf", () => {
    const kinds = collectFilterKinds<Receipt>(
      [
        {
          id: "money",
          columns: [
            { accessorKey: "amount" },
            { accessorKey: "paid" },
          ],
        },
        { accessorKey: "code" },
        { id: "actions" },
      ],
      rows,
    )

    // `amount` is null on the first row; inference looks past it.
    expect(kinds.get("amount")).toBe("number")
    expect(kinds.get("paid")).toBe("boolean")
    expect(kinds.get("code")).toBe("text")
    expect(kinds.get("actions")).toBe(false)
    // A group carries no filter of its own.
    expect(kinds.has("money")).toBe(false)
  })

  it("keys a dotted accessorKey the way TanStack's constructColumn does, but still reads it as a path", () => {
    // TanStack's `constructColumn` computes a live column's id as
    // `accessorKey.replaceAll(".", "_")`, so `"partner.name"` has live id
    // `"partner_name"` — the map must be keyed the same way, or a stored
    // condition on this column can never be found again.
    const kinds = collectFilterKinds<Receipt>([{ accessorKey: "partner.name" }], rows)
    expect(kinds.get("partner_name")).toBe("text")
    expect(kinds.has("partner.name")).toBe(false)
  })

  it("falls back to a string header for the id, again matching constructColumn", () => {
    const kinds = collectFilterKinds<Receipt>([{ header: "Actions" }], rows)
    expect(kinds.get("Actions")).toBe(false)
  })

  it("prefers an accessorFn and an explicit meta over inference", () => {
    const kinds = collectFilterKinds<Receipt>(
      [
        { id: "total", accessorFn: (row) => row.amount ?? 0 },
        { id: "status", accessorFn: (row) => row.code, meta: { filter: "list" } },
      ],
      rows,
    )
    expect(kinds.get("total")).toBe("number")
    expect(kinds.get("status")).toBe("list")
  })

  it("omits an undeclared column when there are no rows yet to infer a kind from", () => {
    /*
     * Regression: this used to fall through `resolveFilterKind`'s "text"
     * default with no sample to go on, and `pruneFilters` reads a resolved
     * "text" as a *fact* — dropping any stored `number`/`boolean` condition on
     * that column. That made every server-mode mount (rows arrive after the
     * first fetch) and every async client-mode mount silently lose a stored
     * filter on any non-text column before its data ever loaded.
     */
    const kinds = collectFilterKinds<Receipt>(
      [{ accessorKey: "amount" }, { accessorKey: "paid" }, { id: "actions" }],
      [],
    )
    expect(kinds.has("amount")).toBe(false)
    expect(kinds.has("paid")).toBe(false)
    // A display column has no accessor at all, so its answer — filtering is
    // off — does not depend on data and stays a certainty either way.
    expect(kinds.get("actions")).toBe(false)
  })

  it("still honours a declared kind with no rows to sample", () => {
    const kinds = collectFilterKinds<Receipt>([{ accessorKey: "amount", meta: { filter: "number" } }], [])
    expect(kinds.get("amount")).toBe("number")
  })
})
