import { startOfLocalDay, toIsoDay, type FilterKind, type FilterValue, type FilterValueOption } from "./filters"

/**
 * The value logic under an inline cell editor: which cell may be edited, what
 * the editor starts with, and what a typed draft means.
 *
 * All of it is pure, so the awkward cases — a date that does not exist, a list
 * value the host never offered, a number typed as a minus sign — are decided
 * once and tested without a DOM. `CellEditor.tsx` renders these answers; it
 * does not repeat them.
 */

/**
 * Which editor a column gets.
 *
 * Deliberately the filter kinds: a column that filters as a date edits as a
 * date, and one vocabulary serves `meta.filter` and `meta.editable` both. The
 * kinds are shared; the editors are not — a filter picks several list values,
 * an editor picks one.
 */
export type EditableKind = FilterKind

/** Why a cell offers no editor. Each maps to one label on the disabled Edit item. */
export type NotEditableReason = "column" | "row" | "group" | "unavailable"

/** Whether a cell can be edited, and with what — or why not. */
export type Editability =
  | { editable: true; kind: EditableKind }
  | { editable: false; reason: NotEditableReason }

/** What {@link cellEditability} needs to know about one cell. */
export interface EditabilityFacts {
  /**
   * The column's `meta.editable`, already resolved against this row if the
   * host declared a predicate. `false` and `undefined` differ in the reason
   * the user is given, not in the answer: silence is not consent for something
   * that writes to a database, so a column that declared nothing is not
   * editable either.
   */
  declared: EditableKind | false | undefined
  /** False when the host passed no `onCellEdit`, so there is nowhere to send the edit. */
  hasHandler: boolean
  /** True for a group row, which aggregates rows and has none of its own to write to. */
  isGroupRow?: boolean
  /** False when this row's own state forbids the edit — the `editable` predicate said no. */
  rowAllows?: boolean
}

/**
 * Whether one cell can be edited, and why not when it cannot.
 *
 * The order of the checks is the order the reasons are worth hearing. A group
 * row is answered first because it is true of every column at once; the
 * column's own declaration comes next; a host with no `onCellEdit` is a
 * mistake in the table's configuration rather than a fact about this cell, so
 * it is only reported for a cell that would otherwise have been editable; and
 * the row's own veto is last, because it is the only reason that can change
 * while the user watches.
 *
 * @param facts - What is known about the cell.
 * @returns The kind to edit with, or the reason there is none.
 *
 * @example
 * cellEditability({ declared: "number", hasHandler: true }) // { editable: true, kind: "number" }
 */
export function cellEditability(facts: EditabilityFacts): Editability {
  if (facts.isGroupRow === true) return { editable: false, reason: "group" }
  if (facts.declared === undefined || facts.declared === false) {
    return { editable: false, reason: "column" }
  }
  if (!facts.hasHandler) return { editable: false, reason: "unavailable" }
  if (facts.rowAllows === false) return { editable: false, reason: "row" }
  return { editable: true, kind: facts.declared }
}

/** The label key that states one {@link NotEditableReason} to the user. */
const REASON_LABELS = {
  column: "editNotEditableColumn",
  row: "editNotEditableRow",
  group: "editNotEditableGroup",
  unavailable: "editUnavailable",
} as const

/**
 * The `CellEditingLabels` key that explains why a cell cannot be edited.
 *
 * A lookup rather than a `switch` in the menu, so a reason added later is a
 * compile error here — where the four translations are — instead of a menu
 * item that silently says nothing.
 *
 * @param reason - Why the cell offers no editor.
 * @returns The label key to render.
 */
export function notEditableLabelKey(reason: NotEditableReason): (typeof REASON_LABELS)[NotEditableReason] {
  return REASON_LABELS[reason]
}

/**
 * What the editor's field starts with, for a cell holding `value`.
 *
 * Every editor keeps its draft as a string, including the two that render a
 * `<select>`: one shape means one commit path, and a `<select>`'s value is a
 * string whatever the option stood for.
 *
 * @param value - The cell's value at the moment the editor opened.
 * @param kind - The editor's kind.
 * @returns The draft text. `""` for a blank cell, whatever the kind.
 *
 * @example
 * draftFromValue(new Date(2026, 0, 31), "date") // "2026-01-31"
 */
export function draftFromValue(value: unknown, kind: EditableKind): string {
  if (value === null || value === undefined) return ""
  if (kind === "date") {
    // A Date is read as the day it falls on in the viewer's own calendar, not
    // the UTC one `toISOString()` would name — the same rule the date filter
    // follows, so the editor and the filter agree about which day a row is on.
    if (value instanceof Date) return toIsoDay(value) ?? ""
    const text = String(value)
    // An ISO timestamp from a server ("2026-01-31T00:00:00Z") is a day with a
    // time bolted on; `<input type="date">` refuses anything but the day.
    const day = text.slice(0, 10)
    return startOfLocalDay(day) === null ? "" : day
  }
  if (kind === "boolean") return value === true ? "true" : value === false ? "false" : ""
  return String(value)
}

/** A draft that parsed, or the label key saying why it did not. */
export type ParsedDraft =
  | { ok: true; value: FilterValue | null }
  | { ok: false; reason: "invalidNumber" | "invalidDate" | "invalidChoice" }

/**
 * What a draft means as a cell value, or why it means nothing.
 *
 * An empty draft is `null` for every kind: emptying a cell is an edit a user
 * can legitimately make, and `""` would write a blank string into a number
 * column. A host that forbids blanks rejects the edit in `onCellEdit`, which
 * is where its own rules live. Whitespace alone counts as empty — nobody means
 * to set a cell to three spaces — but text that has any content is committed
 * exactly as typed, leading and trailing spaces included, because trimming a
 * name or a code is the editor silently altering data it was only asked to
 * carry.
 *
 * @param draft - What the field holds.
 * @param kind - The editor's kind.
 * @param choices - The list editor's offered values. Ignored by every other kind.
 * @returns The value to commit, or the refusal to show.
 *
 * @example
 * parseDraft("12,5", "number") // { ok: false, reason: "invalidNumber" }
 */
export function parseDraft(
  draft: string,
  kind: EditableKind,
  choices?: readonly FilterValueOption[] | undefined,
): ParsedDraft {
  const text = draft.trim()
  if (text === "") return { ok: true, value: null }

  if (kind === "number") {
    // `Number("")` is 0 and `Number(" ")` is 0 too, which is why the blank
    // case is answered above rather than here. `Number("12px")` is NaN, and
    // `Number("1e400")` is Infinity — neither is a number a column can hold.
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) return { ok: false, reason: "invalidNumber" }
    return { ok: true, value: parsed }
  }

  if (kind === "date") {
    // `startOfLocalDay` is the library's one parser for a calendar day, so a
    // day the filters refuse is a day the editor refuses: 2026-02-30 is not a
    // date, however plausibly it is spelled.
    if (startOfLocalDay(text) === null) return { ok: false, reason: "invalidDate" }
    return { ok: true, value: text }
  }

  if (kind === "boolean") {
    if (text === "true") return { ok: true, value: true }
    if (text === "false") return { ok: true, value: false }
    return { ok: false, reason: "invalidChoice" }
  }

  if (kind === "list") {
    // Matched by the string the <option> carried, because that round trip is
    // what a `<select>` does to a number or a boolean choice.
    const chosen = (choices ?? []).find((choice) => String(choice.value) === text)
    if (chosen === undefined) return { ok: false, reason: "invalidChoice" }
    return { ok: true, value: chosen.value }
  }

  return { ok: true, value: draft }
}

/**
 * Whether committing `next` would change anything.
 *
 * A commit that changes nothing must not reach `onCellEdit`: in a server-first
 * table that callback is a request, and a user who opened an editor, touched
 * nothing and clicked away has not edited a row. The comparison runs on the
 * *parsed* value against the cell's own, both normalised through
 * {@link draftFromValue}, so `"5"` typed over a numeric 5 is recognised as the
 * same value and a Date is compared as the day it names.
 *
 * @param previous - The cell's value when the editor opened.
 * @param next - What the draft parsed to.
 * @param kind - The editor's kind.
 * @returns True when the two name the same value.
 *
 * @example
 * isUnchanged(5, 5, "number") // true
 */
export function isUnchanged(previous: unknown, next: FilterValue | null, kind: EditableKind): boolean {
  return draftFromValue(previous, kind) === draftFromValue(next, kind)
}

/**
 * A per-row rule that can forbid an edit the column otherwise allows.
 *
 * The row arrives untyped, and that is not an oversight. `meta` reaches a host
 * through TanStack's `columnMeta` slot, which is ONE concrete type for the
 * whole feature set (`tableFeatures({ columnMeta: … })`) — it is not generic
 * over the row, so the host's own row type has nowhere to enter from.
 * `unknown` would be worse here rather than better: under
 * `strictFunctionTypes` a host's `(row: Receipt) => boolean` is not assignable
 * to `(row: unknown) => boolean`, so every call site would need the `as` cast
 * this repository forbids. With `any` the parameter is contextually typed at
 * the call site instead — annotate it (`(row: Receipt) => …`) and the body is
 * fully checked.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see the docblock above
export type EditableRowPredicate = (row: any) => boolean

/**
 * What a column declares about editing its cells.
 *
 * A kind names the editor outright. A predicate says "editable, when this row
 * allows it" and leaves the kind to the one inference rule §1 shares with the
 * filters — see {@link resolveEditable}. `false` and silence both mean no
 * editor; they differ only in the reason the user is given.
 */
export type EditableDeclaration = EditableKind | false | EditableRowPredicate

/**
 * One cell's edit, as the host receives it.
 *
 * `previous` is the value the cell held when the EDITOR OPENED, never one read
 * back at commit time: a refetch in between would otherwise rewrite history
 * and hand the host an undo target that was never on screen.
 */
export interface CellEdit<TData> {
  /** The row the edited cell belongs to. Never a group row. */
  row: TData
  /** The edited column's id. */
  columnId: string
  /** The value to write. `null` empties the cell. */
  value: unknown
  /** What the cell held when the editor opened. */
  previous: unknown
}

/**
 * What a host does with a committed edit.
 *
 * Returning a promise is what buys the optimistic render: the new value shows
 * while it is in flight, and a rejection reverts the cell and says why.
 */
export type CellEditHandler<TData> = (edit: CellEdit<TData>) => void | Promise<void>

/** What {@link resolveEditable} reads besides the declaration itself. */
export interface EditableFacts {
  /** The row the predicate is asked about. */
  row: unknown
  /**
   * The column's resolved FILTER kind, from `instance.filtering.kinds`.
   *
   * The vocabulary is shared on purpose (§1): a column that filters as a date
   * edits as a date. `false` — a column whose filtering the host turned off —
   * is not a statement about editing, so it falls through to the default
   * rather than cancelling the editor.
   */
  filterKind: EditableKind | false | undefined
}

/**
 * The editor a column offers this row, and whether the row allows it.
 *
 * Splits one `meta.editable` into the two facts {@link cellEditability} asks
 * for. The split is what lets a refused predicate be reported as "this row
 * cannot be edited" rather than as "this column cannot be edited": the column
 * DID offer an editor, and something about this row took it away.
 *
 * @param declared - The column's `meta.editable`.
 * @param facts - The row, and the column's resolved filter kind.
 * @returns The column-level kind (or the absence of one) and the row's verdict.
 *
 * @example
 * resolveEditable((row) => row.status !== "closed", { row, filterKind: "number" })
 * // { declared: "number", rowAllows: true }
 */
export function resolveEditable(
  declared: EditableDeclaration | undefined,
  facts: EditableFacts,
): { declared: EditableKind | false | undefined; rowAllows: boolean } {
  if (declared === undefined || declared === false) return { declared, rowAllows: true }
  if (typeof declared === "function") {
    return {
      /*
       * A predicate names no editor, so the kind comes from the one rule the
       * filters already resolved. A column with no filter kind either —
       * filtering turned off for it, or a page of nothing but nulls to infer
       * from — edits as text, which is the kind that can carry anything the
       * user can type.
       */
      declared:
        facts.filterKind === false || facts.filterKind === undefined ? "text" : facts.filterKind,
      rowAllows: declared(facts.row) === true,
    }
  }
  return { declared, rowAllows: true }
}

/** One cell, as the editing feature addresses it. */
export interface CellRef {
  rowId: string
  columnId: string
}

/**
 * Whether two cell references name the same cell.
 *
 * @param a - One reference, or null.
 * @param b - The other reference, or null.
 * @returns True only when both are present and name the same cell.
 *
 * @example
 * isSameCell(editing, { rowId: row.id, columnId: cell.column.id })
 */
export function isSameCell(a: CellRef | null | undefined, b: CellRef | null | undefined): boolean {
  if (!a || !b) return false
  return a.rowId === b.rowId && a.columnId === b.columnId
}

/**
 * The key one cell's pending edit is filed under.
 *
 * A row id and a column id are both host-supplied strings, so they are joined
 * on a character neither can plausibly contain — a NUL is not legal in a
 * JavaScript identifier, a SQL identifier or a URL path segment, and an id
 * carrying one would have larger problems than this map.
 *
 * @param cell - The row and column.
 * @returns The map key.
 *
 * @example
 * cellEditKey({ rowId: "rc-3", columnId: "amount" })
 */
export function cellEditKey(cell: CellRef): string {
  return `${cell.rowId} ${cell.columnId}`
}

/**
 * Where Tab goes from an open editor.
 *
 * `grid` holds only the EDITABLE cells, in render order — row by row, and
 * within a row in the order the columns are rendered. "The next editable cell
 * in the row, wrapping to the next row at the end" (§3) is then a single step
 * along that list, and the wrap at the very end is the wrap back to the start:
 * a user tabbing through a page of edits arrives back where they began rather
 * than at a dead stop with the focus nowhere.
 *
 * @param grid - Every editable cell on the page, in render order.
 * @param from - The cell the editor is open on.
 * @param direction - 1 for Tab, -1 for Shift+Tab.
 * @returns The cell to open next, or undefined when `from` is not in the grid
 *   — a row refetched away mid-edit — or when it is the only editable cell.
 *
 * @example
 * nextEditableCell(grid, { rowId: "rc-1", columnId: "code" }, 1)
 */
export function nextEditableCell(
  grid: readonly CellRef[],
  from: CellRef,
  direction: 1 | -1,
): CellRef | undefined {
  if (grid.length < 2) return undefined
  const at = grid.findIndex((cell) => isSameCell(cell, from))
  if (at === -1) return undefined
  // `+ grid.length` before the modulo: JavaScript's `%` keeps the sign of the
  // dividend, so -1 % n is -1 rather than n - 1.
  return grid[(at + direction + grid.length) % grid.length]
}
