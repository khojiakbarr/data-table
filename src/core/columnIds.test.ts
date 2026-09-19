import { describe, expect, it } from "vitest"
import { deriveColumnId } from "./columnIds"

describe("deriveColumnId", () => {
  it("prefers an explicit id over everything else", () => {
    expect(deriveColumnId({ id: "total", accessorKey: "amount", header: "Amount" }, 0)).toBe("total")
  })

  it("replaces every dot in a dotted accessorKey with an underscore, matching TanStack's constructColumn", () => {
    // TanStack's constructColumn computes a live column's id as
    // `String(accessorKey).replaceAll(".", "_")`. A caller that derives ids
    // independently — a stored layout's known columns, a per-column filter
    // kind — has to match, or a lookup by id silently misses.
    expect(deriveColumnId({ accessorKey: "partner.name" }, 0)).toBe("partner_name")
    expect(deriveColumnId({ accessorKey: "a.b.c" }, 0)).toBe("a_b_c")
  })

  it("keeps a dot-free accessorKey unchanged", () => {
    expect(deriveColumnId({ accessorKey: "amount" }, 0)).toBe("amount")
  })

  it("falls back to a string header when there is no id or accessorKey", () => {
    expect(deriveColumnId({ header: "Actions" }, 0)).toBe("Actions")
  })

  it("falls back to the column's position when nothing else identifies it", () => {
    expect(deriveColumnId({}, 3)).toBe("3")
    expect(deriveColumnId({ header: () => "Actions" }, 3)).toBe("3")
  })

  it("ignores a non-string accessorKey and a non-string header", () => {
    expect(deriveColumnId({ accessorKey: 5, header: 9 }, 2)).toBe("2")
  })
})
