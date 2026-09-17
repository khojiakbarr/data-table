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
  type FilterDraft,
} from "./filterDraft"
import type { DateCondition, FilterCondition } from "./filters"
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

  it("ignores an operator the kind does not offer, for every kind — not only text", () => {
    // Each `case` in `withOperator`'s switch runs its own `pickOperator`
    // call; a single text-only rejection test would not notice one of the
    // other four branches losing its guard.
    const listDraft: FilterDraft = { kind: "list", op: "in", values: [] }
    expect(withOperator(listDraft, "eq")).toBe(listDraft)
    const numberDraft = { kind: "number", op: "eq", value: "1", from: "", to: "" } as const
    expect(withOperator(numberDraft, "contains")).toBe(numberDraft)
    const booleanDraft = { kind: "boolean", op: "isTrue" } as const
    expect(withOperator(booleanDraft, "between")).toBe(booleanDraft)
    const dateDraft = { kind: "date", mode: "is", day: "", from: "", to: "" } as const
    expect(withOperator(dateDraft, "eq")).toBe(dateDraft)
  })

  it("says which operators carry no value, and which carry two", () => {
    expect(isBlankOperator({ kind: "date", mode: "blank", day: "", from: "", to: "" })).toBe(true)
    expect(isBlankOperator({ kind: "text", op: "contains", value: "" })).toBe(false)
    expect(isRangeOperator({ kind: "number", op: "between", value: "", from: "", to: "" })).toBe(true)
    expect(isRangeOperator({ kind: "number", op: "gt", value: "5", from: "", to: "" })).toBe(false)
  })

  it("treats a date between as the range operator, and the other three modes as single-value", () => {
    // Task 15 uses this to decide between one day input and two; a mutation
    // that hard-codes `false` for dates would leave the between editor
    // showing a single day input and silently discard the second bound.
    expect(isRangeOperator({ kind: "date", mode: "between", day: "", from: "2026-03-01", to: "2026-03-31" })).toBe(
      true,
    )
    expect(isRangeOperator({ kind: "date", mode: "is", day: "2026-03-01", from: "", to: "" })).toBe(false)
    expect(isRangeOperator({ kind: "date", mode: "before", day: "2026-03-01", from: "", to: "" })).toBe(false)
    expect(isRangeOperator({ kind: "date", mode: "after", day: "2026-03-01", from: "", to: "" })).toBe(false)
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

  it("preserves the text operator, not only the value", () => {
    // A default of "contains" would still pass a value-only assertion;
    // "notContains" pins the branch to `condition.op` rather than a
    // hard-coded default.
    expect(draftFromCondition({ kind: "text", field: "a", op: "notContains", value: "x" }, "text")).toEqual({
      kind: "text",
      op: "notContains",
      value: "x",
    })
  })

  it("reads a one-day range back as the Is the editor offered", () => {
    expect(
      draftFromCondition({ kind: "date", field: "d", op: "range", from: "2026-03-31", before: "2026-04-01" }, "date"),
    ).toEqual({ kind: "date", mode: "is", day: "2026-03-31", from: "", to: "" })
  })

  it("preserves the list operator and values, including blank/notBlank", () => {
    expect(
      draftFromCondition({ kind: "list", field: "s", op: "in", values: ["open", "closed"] }, "list"),
    ).toEqual({ kind: "list", op: "in", values: ["open", "closed"] })
    // The one kind whose blank/notBlank operator this module used to drop —
    // a column filtered to "(Blanks)" must re-open with the operator select
    // reading "Is blank", not "Is any of".
    expect(draftFromCondition({ kind: "list", field: "s", op: "blank" }, "list")).toEqual({
      kind: "list",
      op: "blank",
      values: [],
    })
    expect(draftFromCondition({ kind: "list", field: "s", op: "notBlank" }, "list")).toEqual({
      kind: "list",
      op: "notBlank",
      values: [],
    })
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

describe("draftFromCondition + draftToCondition round trip", () => {
  it("round-trips a list blank/notBlank condition unchanged", () => {
    // The regression this pins: `draftFromCondition` used to collapse
    // list's blank/notBlank to "in", producing an empty-values draft that
    // `draftToCondition` then turned into `null` — silently clearing a
    // column filtered to "(Blanks)" on the first commit.
    const blank: FilterCondition = { kind: "list", field: "s", op: "blank" }
    expect(draftToCondition(draftFromCondition(blank, "list"), "s")).toEqual(blank)
    const notBlank: FilterCondition = { kind: "list", field: "s", op: "notBlank" }
    expect(draftToCondition(draftFromCondition(notBlank, "list"), "s")).toEqual(notBlank)
  })

  it("round-trips one condition per kind and operator family", () => {
    const cases: FilterCondition[] = [
      { kind: "text", field: "a", op: "contains", value: "agro" },
      { kind: "text", field: "a", op: "blank" },
      { kind: "number", field: "a", op: "gt", value: 5 },
      { kind: "number", field: "a", op: "between", from: 1, to: 9 },
      { kind: "number", field: "a", op: "blank" },
      { kind: "date", field: "d", op: "range", from: "2026-03-31", before: "2026-04-01" },
      { kind: "date", field: "d", op: "range", from: "2026-03-01", before: "2026-04-01" },
      { kind: "date", field: "d", op: "blank" },
      { kind: "boolean", field: "b", op: "is", value: true },
      { kind: "boolean", field: "b", op: "notBlank" },
      { kind: "list", field: "s", op: "in", values: ["a", "b"] },
      { kind: "list", field: "s", op: "blank" },
    ]
    for (const condition of cases) {
      expect(draftToCondition(draftFromCondition(condition, condition.kind), condition.field)).toEqual(condition)
    }
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

  it("pins each date mode to its own label, not just Is", () => {
    // `operatorLabel` maps a date's mode to `opDateBefore` / `opDateAfter` /
    // `opDateBetween` by hand rather than through `operatorChoices`; a swap
    // between the before and after labels is otherwise invisible, since the
    // only date case previously covered was the one-day "Is" range.
    expect(
      describeCondition({ kind: "date", field: "d", op: "range", from: null, before: "2026-03-31" }, labels),
    ).toBe("Before 2026-03-31")
    expect(
      describeCondition({ kind: "date", field: "d", op: "range", from: "2026-04-01", before: null }, labels),
    ).toBe("After 2026-03-31")
    expect(
      describeCondition(
        { kind: "date", field: "d", op: "range", from: "2026-03-01", before: "2026-04-01" },
        labels,
      ),
    ).toBe("Between 2026-03-01 – 2026-03-31")
  })
})
