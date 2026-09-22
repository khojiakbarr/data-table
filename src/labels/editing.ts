/**
 * Every string the cell editors and the cell menu speak.
 *
 * A set of its own rather than more keys on `DataTableLabels`, for one
 * reason: `defaultLabels` — the English set every other locale is checked
 * against — lives inside `DataTable.tsx`, the shell that will wire editing up
 * in the task after this one. Editors and a menu that nothing renders yet must
 * not force a key into an interface whose only default value sits in a file
 * they have no business editing.
 *
 * The join is one line when the wiring lands: `DataTableLabels` extends
 * {@link CellEditingLabels}, `defaultLabels` spreads
 * {@link defaultCellEditingLabels}, and `ruLabels`/`uzLabels` spread the two
 * translations that already sit beside them in `ru.ts` and `uz.ts`. Nothing
 * here has to be translated twice for that to happen.
 */

/** The strings {@link CellEditor} and {@link CellMenu} render. */
export interface CellEditingLabels {
  /** Accessible name of the cell's context menu. */
  cellActions: string
  /** The menu's first item, which opens the editor. */
  edit: string
  /** On a disabled Edit: the column never offered an editor. */
  editNotEditableColumn: string
  /** On a disabled Edit: this row's own state forbids the edit. */
  editNotEditableRow: string
  /** On a disabled Edit: a group row aggregates rows and has none of its own to write to. */
  editNotEditableGroup: string
  /** On a disabled Edit: the host passed no way to save an edit. */
  editUnavailable: string
  /** Spoken after the column's name as the editor field's accessible name. */
  editValue: string
  /** Tooltip on the field, saying which keys commit and which cancel. */
  editHint: string
  /** Refusal shown when the typed text is not a number. */
  invalidNumber: string
  /** Refusal shown when the typed text is not a real calendar day. */
  invalidDate: string
  /** Refusal shown when the chosen value is not one of the offered ones. */
  invalidChoice: string
  /** The "true" option of a boolean editor. */
  booleanTrue: string
  /** The "false" option of a boolean editor. */
  booleanFalse: string
  /** The option that empties a cell, in a boolean or list editor. */
  noValue: string
}

/**
 * English cell-editing labels, and the set every translation is checked
 * against.
 *
 * @example
 * <CellEditor kind="text" labels={defaultCellEditingLabels} … />
 */
export const defaultCellEditingLabels: CellEditingLabels = {
  cellActions: "Cell actions",
  edit: "Edit",
  editNotEditableColumn: "This column cannot be edited",
  editNotEditableRow: "This row cannot be edited",
  editNotEditableGroup: "A group row cannot be edited",
  editUnavailable: "Editing is not available",
  editValue: "Value",
  editHint: "Enter saves, Escape cancels",
  invalidNumber: "Enter a number",
  invalidDate: "Enter a date as YYYY-MM-DD",
  invalidChoice: "Choose one of the offered values",
  booleanTrue: "Yes",
  booleanFalse: "No",
  noValue: "(empty)",
}
