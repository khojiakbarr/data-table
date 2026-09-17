import {
  addDays,
  booleanCondition,
  dayChoiceToCondition,
  listCondition,
  numberCondition,
  textCondition,
  type DateCondition,
  type DayChoice,
  type FilterCondition,
  type FilterKind,
  type FilterValue,
  type ListCondition,
  type NumberCondition,
  type TextCondition,
} from "./filters"
import type { DataTableLabels } from "../types"

/**
 * What a filter editor holds while the user is still deciding.
 *
 * A draft is not a condition: it is what a set of form controls contains, so
 * every field is a string, the way an `<input>` reports it. Nothing here
 * reaches `layout.filters` — `draftToCondition` runs it through the
 * constructors in `filters.ts` first, and a draft that constrains nothing
 * becomes `null` and clears the column.
 *
 * There is deliberately no draft in the model and no syncing back into one: a
 * draft is discarded or applied, never kept in step with committed state.
 */

/** The boolean editor's four choices; `is` carries its value in the choice. */
export type BooleanDraftOp = "isTrue" | "isFalse" | "blank" | "notBlank"

export type FilterDraft =
  | { kind: "text"; op: TextCondition["op"]; value: string }
  | { kind: "number"; op: NumberCondition["op"]; value: string; from: string; to: string }
  | { kind: "date"; mode: DayChoice["mode"]; day: string; from: string; to: string }
  | { kind: "boolean"; op: BooleanDraftOp }
  | { kind: "list"; op: ListCondition["op"]; values: FilterValue[] }

/** The list editor's own draft, which a values list reads and rewrites whole. */
export type ListDraft = Extract<FilterDraft, { kind: "list" }>

/**
 * The label keys that name an operator.
 *
 * Spelled out rather than `keyof DataTableLabels`, which also holds the
 * parameterised labels: an operator name is always a plain string, and
 * `labels[key]` has to be one too.
 */
export type OperatorLabelKey =
  | "opContains"
  | "opNotContains"
  | "opEquals"
  | "opNotEquals"
  | "opStartsWith"
  | "opEndsWith"
  | "opEq"
  | "opNe"
  | "opLt"
  | "opLte"
  | "opGt"
  | "opGte"
  | "opBetween"
  | "opDateIs"
  | "opDateBefore"
  | "opDateAfter"
  | "opDateBetween"
  | "opIsTrue"
  | "opIsFalse"
  | "opIn"
  | "opNotIn"
  | "opBlank"
  | "opNotBlank"

/** One entry in an editor's operator select, typed to its own kind. */
export interface KindOperatorChoice<TOp extends string> {
  /** The draft's own operator (or, for a date, its mode). */
  value: TOp
  /** Which label names it. */
  labelKey: OperatorLabelKey
}

/** One entry in an editor's operator select, whatever kind it belongs to. */
export type OperatorChoice = KindOperatorChoice<string>

const TEXT_OPS: readonly KindOperatorChoice<TextCondition["op"]>[] = [
  { value: "contains", labelKey: "opContains" },
  { value: "notContains", labelKey: "opNotContains" },
  { value: "equals", labelKey: "opEquals" },
  { value: "notEquals", labelKey: "opNotEquals" },
  { value: "startsWith", labelKey: "opStartsWith" },
  { value: "endsWith", labelKey: "opEndsWith" },
  { value: "blank", labelKey: "opBlank" },
  { value: "notBlank", labelKey: "opNotBlank" },
]

const NUMBER_OPS: readonly KindOperatorChoice<NumberCondition["op"]>[] = [
  { value: "eq", labelKey: "opEq" },
  { value: "ne", labelKey: "opNe" },
  { value: "lt", labelKey: "opLt" },
  { value: "lte", labelKey: "opLte" },
  { value: "gt", labelKey: "opGt" },
  { value: "gte", labelKey: "opGte" },
  { value: "between", labelKey: "opBetween" },
  { value: "blank", labelKey: "opBlank" },
  { value: "notBlank", labelKey: "opNotBlank" },
]

/*
 * The date editor offers four modes and the wire carries one operator: every
 * one of them becomes a half-open `[from, before)` range (see
 * `dayChoiceToCondition`), which is why these are modes rather than operators.
 */
const DATE_OPS: readonly KindOperatorChoice<DayChoice["mode"]>[] = [
  { value: "is", labelKey: "opDateIs" },
  { value: "before", labelKey: "opDateBefore" },
  { value: "after", labelKey: "opDateAfter" },
  { value: "between", labelKey: "opDateBetween" },
  { value: "blank", labelKey: "opBlank" },
  { value: "notBlank", labelKey: "opNotBlank" },
]

const BOOLEAN_OPS: readonly KindOperatorChoice<BooleanDraftOp>[] = [
  { value: "isTrue", labelKey: "opIsTrue" },
  { value: "isFalse", labelKey: "opIsFalse" },
  { value: "blank", labelKey: "opBlank" },
  { value: "notBlank", labelKey: "opNotBlank" },
]

const LIST_OPS: readonly KindOperatorChoice<ListCondition["op"]>[] = [
  { value: "in", labelKey: "opIn" },
  { value: "notIn", labelKey: "opNotIn" },
  { value: "blank", labelKey: "opBlank" },
  { value: "notBlank", labelKey: "opNotBlank" },
]

/**
 * The operators one kind of editor offers, in the order they are listed.
 *
 * @param kind - The column's resolved filter kind.
 * @returns The choices, each with the label key that names it.
 */
export function operatorChoices(kind: FilterKind): readonly OperatorChoice[] {
  switch (kind) {
    case "text":
      return TEXT_OPS
    case "number":
      return NUMBER_OPS
    case "date":
      return DATE_OPS
    case "boolean":
      return BOOLEAN_OPS
    case "list":
      return LIST_OPS
  }
}

/**
 * The same draft under a different operator, keeping everything already typed.
 *
 * The operator arrives from a `<select>` as a plain string; one the kind does
 * not offer leaves the draft alone rather than producing an operator the
 * constructors would have to reject.
 *
 * @param draft - What the editor holds.
 * @param operator - The chosen operator, or a date editor's mode.
 * @returns The draft under that operator.
 */
export function withOperator(draft: FilterDraft, operator: string): FilterDraft {
  switch (draft.kind) {
    case "text": {
      const op = pickOperator(TEXT_OPS, operator)
      return op === null ? draft : { ...draft, op }
    }
    case "number": {
      const op = pickOperator(NUMBER_OPS, operator)
      return op === null ? draft : { ...draft, op }
    }
    case "date": {
      const mode = pickOperator(DATE_OPS, operator)
      return mode === null ? draft : { ...draft, mode }
    }
    case "boolean": {
      const op = pickOperator(BOOLEAN_OPS, operator)
      return op === null ? draft : { ...draft, op }
    }
    case "list": {
      const op = pickOperator(LIST_OPS, operator)
      return op === null ? draft : { ...draft, op }
    }
  }
}

/** The offered operator equal to `value`, narrowed to its own kind, or null. */
function pickOperator<TOp extends string>(
  offered: readonly KindOperatorChoice<TOp>[],
  value: string,
): TOp | null {
  for (const choice of offered) if (choice.value === value) return choice.value
  return null
}

/**
 * Whether a draft's operator carries no value of its own.
 *
 * @param draft - What the editor holds.
 * @returns True for `blank` and `notBlank`, which are operators on every kind.
 */
export function isBlankOperator(draft: FilterDraft): boolean {
  const operator = draft.kind === "date" ? draft.mode : draft.op
  return operator === "blank" || operator === "notBlank"
}

/**
 * Whether a draft's operator takes two bounds rather than one value.
 *
 * @param draft - What the editor holds.
 * @returns True for a number `between` and a date `between`.
 */
export function isRangeOperator(draft: FilterDraft): boolean {
  if (draft.kind === "number") return draft.op === "between"
  if (draft.kind === "date") return draft.mode === "between"
  return false
}

/**
 * An editor with nothing chosen yet.
 *
 * @param kind - The column's resolved filter kind.
 * @returns A draft on that kind's most useful operator.
 */
export function emptyDraft(kind: FilterKind): FilterDraft {
  switch (kind) {
    case "text":
      return { kind: "text", op: "contains", value: "" }
    case "number":
      return { kind: "number", op: "eq", value: "", from: "", to: "" }
    case "date":
      return { kind: "date", mode: "is", day: "", from: "", to: "" }
    case "boolean":
      return { kind: "boolean", op: "isTrue" }
    case "list":
      return { kind: "list", op: "in", values: [] }
  }
}

/**
 * Read a date condition back as the choice that would have produced it.
 *
 * The wire carries one operator and an exclusive upper bound, so re-opening an
 * editor on `[2026-03-31, 2026-04-01)` has to show "Is 31 Mar" rather than a
 * range nobody typed. The inverse of {@link dayChoiceToCondition}.
 *
 * @param condition - A date condition, as stored.
 * @returns The editor choice it came from.
 */
export function conditionToDayChoice(condition: DateCondition): DayChoice {
  if (condition.op === "blank" || condition.op === "notBlank") return { mode: condition.op }
  /*
   * Narrowing this union by its operator does not exclude the blank member —
   * that member's own `op` is a union of literals — so the bounds are read
   * through an `in` check, the same way the constructors in `filters.ts` read
   * theirs.
   */
  if (!("from" in condition)) return { mode: "is", day: "" }
  const { from, before } = condition
  if (from === null && before === null) return { mode: "is", day: "" }
  if (from === null) return { mode: "before", day: before ?? "" }
  if (before === null) return { mode: "after", day: addDays(from, -1) ?? from }
  // One day wide is the "Is" the editor offered; anything else is a range.
  if (addDays(from, 1) === before) return { mode: "is", day: from }
  return { mode: "between", from, to: addDays(before, -1) }
}

/**
 * Fill an editor from the condition a column already carries.
 *
 * A condition of a different kind than the column now resolves to is ignored
 * rather than reinterpreted — the same rule `pruneFilters` applies on load,
 * for the same reason: a text condition on a number column would run a
 * substring test against a numeric accessor.
 *
 * @param condition - The column's current condition, if it has one.
 * @param kind - The column's resolved filter kind.
 * @returns A draft for that kind.
 */
export function draftFromCondition(
  condition: FilterCondition | undefined,
  kind: FilterKind,
): FilterDraft {
  if (condition === undefined || condition.kind !== kind) return emptyDraft(kind)
  switch (condition.kind) {
    case "text":
      return {
        kind: "text",
        op: condition.op,
        value: "value" in condition ? condition.value : "",
      }
    case "number": {
      if (condition.op === "between") {
        return {
          kind: "number",
          op: "between",
          value: "",
          from: condition.from === null ? "" : String(condition.from),
          to: condition.to === null ? "" : String(condition.to),
        }
      }
      return {
        kind: "number",
        op: condition.op,
        value: "value" in condition ? String(condition.value) : "",
        from: "",
        to: "",
      }
    }
    case "date": {
      const choice = conditionToDayChoice(condition)
      if (choice.mode === "between") {
        return { kind: "date", mode: "between", day: "", from: choice.from ?? "", to: choice.to ?? "" }
      }
      return {
        kind: "date",
        mode: choice.mode,
        day: "day" in choice ? choice.day : "",
        from: "",
        to: "",
      }
    }
    case "boolean": {
      if (condition.op === "blank" || condition.op === "notBlank") {
        return { kind: "boolean", op: condition.op }
      }
      return { kind: "boolean", op: "value" in condition && condition.value ? "isTrue" : "isFalse" }
    }
    case "list":
      // Every other kind preserves its own operator here (text, number, date
      // via `conditionToDayChoice`, boolean); list must too, or a column
      // filtered to "(Blanks)" re-opens with "Is any of" selected instead of
      // "Is blank", and the first commit clears the filter because an empty
      // `values` list builds no condition.
      return {
        kind: "list",
        op: condition.op,
        values: "values" in condition ? [...condition.values] : [],
      }
  }
}

/** A finite number from what an `<input type="number">` reports, or NaN. */
function draftNumber(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text)
}

/** A bound from a number input: null for "unbounded", which is what blank means. */
function draftBound(text: string): number | null {
  const value = draftNumber(text)
  return Number.isFinite(value) ? value : null
}

/**
 * Turn an editor's draft into the condition it describes.
 *
 * Every draft goes through the constructors in `filters.ts`, which fix key
 * order, sort a list's values and swap reversed bounds — so a condition the
 * editors build is byte-identical to the same condition restored from a URL,
 * and `instance.query` does not change identity for a filter that did not.
 *
 * @param draft - What the editor holds.
 * @param field - The column id the condition is for.
 * @returns The condition, or null when it constrains nothing — in which case
 *   the caller clears the column rather than storing it.
 */
export function draftToCondition(draft: FilterDraft, field: string): FilterCondition | null {
  switch (draft.kind) {
    case "text": {
      const { op } = draft
      if (op === "blank" || op === "notBlank") return textCondition({ kind: "text", field, op })
      return textCondition({ kind: "text", field, op, value: draft.value.trim() })
    }
    case "number": {
      const { op } = draft
      if (op === "blank" || op === "notBlank") return numberCondition({ kind: "number", field, op })
      if (op === "between") {
        return numberCondition({
          kind: "number",
          field,
          op: "between",
          from: draftBound(draft.from),
          to: draftBound(draft.to),
        })
      }
      return numberCondition({ kind: "number", field, op, value: draftNumber(draft.value) })
    }
    case "date": {
      const { mode } = draft
      if (mode === "blank" || mode === "notBlank") return dayChoiceToCondition(field, { mode })
      if (mode === "between") {
        return dayChoiceToCondition(field, {
          mode: "between",
          from: draft.from === "" ? null : draft.from,
          to: draft.to === "" ? null : draft.to,
        })
      }
      return dayChoiceToCondition(field, { mode, day: draft.day })
    }
    case "boolean": {
      const { op } = draft
      if (op === "blank" || op === "notBlank") return booleanCondition({ kind: "boolean", field, op })
      return booleanCondition({ kind: "boolean", field, op: "is", value: op === "isTrue" })
    }
    case "list":
      return listCondition({ kind: "list", field, op: draft.op, values: draft.values })
  }
}

/** The label that names one condition's operator. */
function operatorLabel(condition: FilterCondition, labels: DataTableLabels): string {
  if (condition.op === "blank") return labels.opBlank
  if (condition.op === "notBlank") return labels.opNotBlank
  if (condition.kind === "date") {
    const choice = conditionToDayChoice(condition)
    if (choice.mode === "before") return labels.opDateBefore
    if (choice.mode === "after") return labels.opDateAfter
    if (choice.mode === "between") return labels.opDateBetween
    return labels.opDateIs
  }
  const key = operatorChoices(condition.kind).find((choice) => choice.value === condition.op)
  return key === undefined ? condition.op : labels[key.labelKey]
}

/**
 * One condition in words, for a collapsed entry in the Filters tab.
 *
 * Reads as "Contains agro" or "Between 10 – 20" — the operator's own label
 * followed by its value, so the tab says what a filter does without opening
 * its editor.
 *
 * @param condition - The condition to describe.
 * @param labels - The table's labels.
 * @returns A short phrase naming the operator and its value.
 */
export function describeCondition(condition: FilterCondition, labels: DataTableLabels): string {
  const operator = operatorLabel(condition, labels)
  if (condition.op === "blank" || condition.op === "notBlank") return operator
  switch (condition.kind) {
    case "text":
      return `${operator} ${"value" in condition ? condition.value : ""}`
    case "number":
      if ("from" in condition) return `${operator} ${condition.from ?? "…"} – ${condition.to ?? "…"}`
      return `${operator} ${"value" in condition ? condition.value : ""}`
    case "date": {
      const choice = conditionToDayChoice(condition)
      if (choice.mode === "between") return `${operator} ${choice.from ?? "…"} – ${choice.to ?? "…"}`
      return `${operator} ${"day" in choice ? choice.day : ""}`
    }
    case "boolean":
      return "value" in condition && condition.value ? labels.opIsTrue : labels.opIsFalse
    case "list":
      return `${operator} ${"values" in condition ? condition.values.join(", ") : ""}`
  }
}
