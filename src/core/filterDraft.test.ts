import { describe, expect, it } from "vitest"
import {
  conditionToDayChoice,
  describeCondition,
  draftFromCondition,
  draftToCondition,
  emptyDraft,
  isBlankOperator,
  isRangeOperator,
  operatorChoices,
  withOperator,
} from "./filterDraft"
import type { DateCondition } from "./filters"
import type { DataTableLabels } from "../types"
import { defaultLabels } from "../components/DataTable"

/**
 * The editors' shared draft: what a set of form controls holds, and what it
 * becomes. Everything here is pure, so the editors themselves stay a thin
 * layer of inputs over it.
 */

const labels: DataTableLabels = defaultLabels

describe("operatorChoices", () => {
  it("offers each kind its own operators, in the order they are listed", () => {
    expect(operatorChoices("text").map((choice) => choice.value)).toEqual([
      "contains",
      "notContains",
      "equals",
      "notEquals",
      "startsWith",
      "endsWith",
      "blank",
      "notBlank",
    ])
    expect(operatorChoices("number").map((choice) => choice.value)).toEqual([
      "eq",
      "ne",
      "lt",
      "lte",
      "gt",
      "gte",
      "between",
      "blank",
      "notBlank",
    ])
    // The date editor offers modes, not operators: all four become one
    // half-open range on the wire.
    expect(operatorChoices("date").map((choice) => choice.value)).toEqual([
      "is",
      "before",
      "after",
      "between",
      "blank",
      "notBlank",
    ])
    expect(operatorChoices("boolean").map((choice) => choice.value)).toEqual([
      "isTrue",
      "isFalse",
      "blank",
      "notBlank",
    ])
    expect(operatorChoices("list").map((choice) => choice.value)).toEqual([
      "in",
      "notIn",
      "blank",
      "notBlank",
    ])
  })

  it("names every operator through a label key that is a plain string", () => {
    for (const kind of ["text", "number", "date", "boolean", "list"] as const) {
      for (const choice of operatorChoices(kind)) {
        expect(typeof labels[choice.labelKey]).toBe("string")
      }
    }
  })
})

describe("empty drafts", () => {
  it("starts each editor on its most useful operator", () => {
    expect(emptyDraft("text")).toEqual({ kind: "text", op: "contains", value: "" })
    expect(emptyDraft("number")).toEqual({ kind: "number", op: "eq", value: "", from: "", to: "" })
    expect(emptyDraft("date")).toEqual({ kind: "date", mode: "is", day: "", from: "", to: "" })
    expect(emptyDraft("boolean")).toEqual({ kind: "boolean", op: "isTrue" })
    expect(emptyDraft("list")).toEqual({ kind: "list", op: "in", values: [] })
  })
})

describe("withOperator", () => {
  it("keeps what is already typed", () => {
    expect(withOperator({ kind: "text", op: "contains", value: "x" }, "notBlank")).toEqual({
      kind: "text",
      op: "notBlank",
      value: "x",
    })
    expect(
      withOperator({ kind: "date", mode: "is", day: "2026-01-01", from: "", to: "" }, "between"),
    ).toEqual({ kind: "date", mode: "between", day: "2026-01-01", from: "", to: "" })
  })

  it("ignores an operator the kind does not offer", () => {
    // The value arrives from a `<select>` as a plain string; a draft is never
    // left holding an operator the constructors would have to reject.
    const draft = { kind: "text", op: "contains", value: "x" } as const
    expect(withOperator(draft, "between")).toBe(draft)
  })

  it("says which operators carry no value, and which carry two", () => {
    expect(isBlankOperator({ kind: "date", mode: "blank", day: "", from: "", to: "" })).toBe(true)
    expect(isBlankOperator({ kind: "text", op: "contains", value: "" })).toBe(false)
    expect(isRangeOperator({ kind: "number", op: "between", value: "", from: "", to: "" })).toBe(true)
    expect(isRangeOperator({ kind: "number", op: "gt", value: "5", from: "", to: "" })).toBe(false)
  })
})

describe("draftFromCondition", () => {
  it("fills an editor from the condition its column carries", () => {
    expect(
      draftFromCondition({ kind: "number", field: "a", op: "between", from: 10, to: null }, "number"),
    ).toEqual({ kind: "number", op: "between", value: "", from: "10", to: "" })
    expect(draftFromCondition({ kind: "boolean", field: "b", op: "is", value: false }, "boolean"))
      .toEqual({ kind: "boolean", op: "isFalse" })
  })

  it("reads a one-day range back as the Is the editor offered", () => {
    expect(
      draftFromCondition({ kind: "date", field: "d", op: "range", from: "2026-03-31", before: "2026-04-01" }, "date"),
    ).toEqual({ kind: "date", mode: "is", day: "2026-03-31", from: "", to: "" })
  })

  it("ignores a condition whose kind is not the column's", () => {
    // The same rule `pruneFilters` applies on load: a text condition on a
    // number column would run a substring test against a numeric accessor.
    expect(draftFromCondition({ kind: "text", field: "a", op: "contains", value: "x" }, "number"))
      .toEqual(emptyDraft("number"))
    expect(draftFromCondition(undefined, "text")).toEqual(emptyDraft("text"))
  })
})

describe("conditionToDayChoice", () => {
  it("is the inverse of the four-way conversion", () => {
    const range = (from: string | null, before: string | null): DateCondition => ({
      kind: "date",
      field: "d",
      op: "range",
      from,
      before,
    })
    expect(conditionToDayChoice(range("2026-03-31", "2026-04-01"))).toEqual({ mode: "is", day: "2026-03-31" })
    expect(conditionToDayChoice(range(null, "2026-03-31"))).toEqual({ mode: "before", day: "2026-03-31" })
    // "After 31 Mar" was published as `from: 1 Apr`; it reads back as 31 Mar.
    expect(conditionToDayChoice(range("2026-04-01", null))).toEqual({ mode: "after", day: "2026-03-31" })
    expect(conditionToDayChoice(range("2026-03-01", "2026-04-01"))).toEqual({
      mode: "between",
      from: "2026-03-01",
      to: "2026-03-31",
    })
  })
})

describe("draftToCondition", () => {
  it("builds through the constructors, so normalisation happens once", () => {
    expect(draftToCondition({ kind: "text", op: "contains", value: "  agro " }, "a")).toEqual({
      kind: "text",
      field: "a",
      op: "contains",
      value: "agro",
    })
    // Reversed bounds are swapped by the constructor, not published.
    expect(draftToCondition({ kind: "number", op: "between", value: "", from: "20", to: "10" }, "a")).toEqual({
      kind: "number",
      field: "a",
      op: "between",
      from: 10,
      to: 20,
    })
  })

  it("converts a between-days draft into a half-open range", () => {
    expect(
      draftToCondition({ kind: "date", mode: "between", day: "", from: "2026-03-01", to: "2026-03-31" }, "d"),
    ).toEqual({ kind: "date", field: "d", op: "range", from: "2026-03-01", before: "2026-04-01" })
  })

  it("returns null for a draft that constrains nothing", () => {
    expect(draftToCondition({ kind: "text", op: "contains", value: "   " }, "a")).toBeNull()
    expect(draftToCondition({ kind: "number", op: "gt", value: "abc", from: "", to: "" }, "a")).toBeNull()
    expect(draftToCondition({ kind: "date", mode: "is", day: "", from: "", to: "" }, "d")).toBeNull()
    expect(draftToCondition({ kind: "list", op: "in", values: [] }, "s")).toBeNull()
  })
})

describe("describeCondition", () => {
  it("says what a filter does, for a collapsed entry in the Filters tab", () => {
    expect(describeCondition({ kind: "text", field: "a", op: "contains", value: "agro" }, labels))
      .toBe("Contains agro")
    expect(describeCondition({ kind: "number", field: "a", op: "between", from: 10, to: null }, labels))
      .toBe("Between 10 – …")
    expect(describeCondition({ kind: "date", field: "d", op: "range", from: "2026-03-31", before: "2026-04-01" }, labels))
      .toBe("Is 2026-03-31")
    expect(describeCondition({ kind: "list", field: "s", op: "in", values: ["closed", "open"] }, labels))
      .toBe("Is any of closed, open")
    expect(describeCondition({ kind: "boolean", field: "b", op: "is", value: false }, labels)).toBe("False")
  })

  it("describes blankness with its operator alone", () => {
    expect(describeCondition({ kind: "text", field: "a", op: "notBlank" }, labels)).toBe("Is not blank")
  })
})
