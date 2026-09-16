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

  it("reads a dotted accessorKey as a path, the way TanStack does", () => {
    const kinds = collectFilterKinds<Receipt>([{ accessorKey: "partner.name" }], rows)
    expect(kinds.get("partner.name")).toBe("text")
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
})
