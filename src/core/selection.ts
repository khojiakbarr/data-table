import type { ColumnDef, RowData } from "@tanstack/react-table"
import type { DataTableFeatures } from "../useDataTable"
import type { TableQuery } from "./query"

/**
 * What a selection IS, and the column that edits it.
 *
 * Not a list of ids. A hundred thousand ids is not a thing to hold, to publish
 * or to put in a `WHERE` clause — and the rows a user means when they tick the
 * header are mostly rows the browser has never been sent. So a selection is
 * one of two statements ABOUT the query: "these particular records", or
 * "everything the query matches, except these".
 *
 * The column that edits it is chrome rather than data, exactly as the
 * row-number column is — see `rowNumbers.ts`, which this file is deliberately
 * the sibling of rather than a second invention.
 */

/**
 * A selection, relative to one {@link TableQuery}.
 *
 * The two modes never convert into one another. Unticking every row on screen
 * while in `all-matching` leaves "everything except these fifty", which is the
 * correct reading of what the user did; ticking rows one at a time never
 * becomes `all-matching`, because the user never said "everything".
 */
export type SelectionModel =
  /** Rows the user picked one at a time. The empty array is "nothing". */
  | { mode: "ids"; ids: readonly string[] }
  /** Everything the query matches, minus the rows the user unticked. */
  | { mode: "all-matching"; excluded: readonly string[] }

/**
 * "Nothing is selected", at module scope.
 *
 * One frozen object rather than a fresh literal per clear: the hook holds the
 * model in state and publishes it on change, so a new-but-equal object would
 * announce a change that did not happen — to React, and then to the host.
 */
export const EMPTY_SELECTION: SelectionModel = Object.freeze({
  mode: "ids",
  ids: Object.freeze([]) as readonly string[],
})

/** "Everything the query matches", for the same reason {@link EMPTY_SELECTION} is. */
export const ALL_MATCHING_SELECTION: SelectionModel = Object.freeze({
  mode: "all-matching",
  excluded: Object.freeze([]) as readonly string[],
})

/**
 * The id the selection column carries.
 *
 * Prefixed the way {@link ROW_NUMBER_COLUMN_ID} is, and for the same reason:
 * an accessor key with two leading underscores and this exact spelling is not
 * an id anyone writes by accident, and it is the only name this column is ever
 * known by — the header, the body and the drop region all look it up by this
 * constant.
 */
export const SELECTION_COLUMN_ID = "__dt_selection"

/**
 * Whether a column is the selection column.
 *
 * A named question rather than `id === SELECTION_COLUMN_ID` spelled out at
 * five call sites: the header asks it to draw the all-matching checkbox, the
 * body asks it to draw a row's own, the Columns panel asks it to leave the
 * column out of its tree, and `dropRegionOf` asks it to refuse every drag.
 *
 * @param columnId - Any column id.
 * @returns True for the selection column.
 *
 * @example
 * if (isSelectionColumn(cell.column.id)) return <td className="dt-selection-cell" />
 */
export function isSelectionColumn(columnId: string): boolean {
  return columnId === SELECTION_COLUMN_ID
}

/**
 * How wide the column is declared.
 *
 * A fixed width, unlike the row-number column's, because the widest thing in
 * it is a checkbox and a checkbox does not grow with the row count: 20px of
 * control centred in a 44px cell, which is also the 44×44 touch target WCAG
 * 2.5.5 asks for once the row height is taken into account.
 */
export const SELECTION_COLUMN_WIDTH = 44

/**
 * Whether the selection is empty — nothing ticked, nobody having said "all".
 *
 * `all-matching` is never empty, even with every visible row excluded: the
 * rows it stands for are mostly rows the browser has never seen, so "the user
 * unticked the fifty on screen" says nothing about the other 99 950.
 *
 * @param model - The current selection.
 * @returns True only for `ids` mode with no ids.
 *
 * @example
 * if (isSelectionEmpty(model)) return null // no bulk-action bar
 */
export function isSelectionEmpty(model: SelectionModel): boolean {
  return model.mode === "ids" && model.ids.length === 0
}

/**
 * Whether one row's checkbox is ticked.
 *
 * @param model - The current selection.
 * @param rowId - The row's id, from `getRowId`.
 * @returns True when the row is in the selection.
 *
 * @example
 * <input checked={isRowSelected(model, row.id)} />
 */
export function isRowSelected(model: SelectionModel, rowId: string): boolean {
  return model.mode === "ids" ? model.ids.includes(rowId) : !model.excluded.includes(rowId)
}

/**
 * The selection after one row's checkbox was ticked or unticked.
 *
 * The whole of "the two modes never convert": this only ever adds to or
 * removes from the list the CURRENT mode carries. In `ids` that list is what
 * is selected; in `all-matching` it is what is not. A user who unticks every
 * row of a page while in `all-matching` ends with "everything except these
 * fifty" and not with "nothing" — the alternative would silently discard a
 * selection of 25 000 in response to fifty clicks.
 *
 * @param model - The current selection.
 * @param rowId - The row whose checkbox moved.
 * @param selected - Where it moved to.
 * @returns A new selection; the same object when nothing changed.
 *
 * @example
 * setModel((current) => withRow(current, row.id, true))
 */
export function withRow(model: SelectionModel, rowId: string, selected: boolean): SelectionModel {
  if (isRowSelected(model, rowId) === selected) return model
  if (model.mode === "ids") {
    return {
      mode: "ids",
      ids: selected ? [...model.ids, rowId] : model.ids.filter((id) => id !== rowId),
    }
  }
  return {
    mode: "all-matching",
    excluded: selected ? model.excluded.filter((id) => id !== rowId) : [...model.excluded, rowId],
  }
}

/**
 * How many rows are selected, or undefined while that cannot be said.
 *
 * In `ids` it is the length of the list, and it is always known — those rows
 * were ticked one at a time, on screen. In `all-matching` it is
 * `rowCount - excluded.length`, and `rowCount` is the server's answer: until
 * one has arrived there is no number, and **undefined is what this returns
 * rather than a guess**. Printing the rows on screen, or a 0, or a NaN would
 * each be a number the user has no way to know is wrong.
 *
 * Clamped at zero. A count is a count of rows; a negative one could only come
 * from a `rowCount` that shrank under a selection, and reporting -3 rows would
 * be worse than reporting none.
 *
 * @param model - The current selection.
 * @param rowCount - Rows the query matches, or undefined while unanswered.
 * @returns The number selected, or undefined.
 *
 * @example
 * selectionCount({ mode: "all-matching", excluded: ["a"] }, 25_000) // 24_999
 */
export function selectionCount(
  model: SelectionModel,
  rowCount: number | undefined,
): number | undefined {
  if (model.mode === "ids") return model.ids.length
  if (rowCount === undefined || !Number.isFinite(rowCount)) return undefined
  return Math.max(0, rowCount - model.excluded.length)
}

/**
 * The part of a query a selection is defined RELATIVE to.
 *
 * The filters, the search and the grouping (which branches are open included):
 * change any of them and "everything the query matches" silently comes to mean
 * a different set of rows — a selection of 25 000 becoming one of 90 000 with
 * no gesture from the user, and then a bulk action on them. So a change to
 * this string clears the selection; see `useSelection`.
 *
 * Sorting and pagination are deliberately NOT in it. Neither changes which
 * rows match, only their order and which slice is on screen, and clearing a
 * selection because the user turned a page would make the feature useless for
 * the case it exists for.
 *
 * `expanded` IS in it, although it only opens and closes group headers: the
 * count in `all-matching` is `rowCount - excluded.length`, and `rowCount` is
 * the length of the FLATTENED list, so opening a group changes the number the
 * header checkbox speaks without any row's membership changing. A count that
 * moved under the user would be the same defect one step smaller.
 *
 * A string rather than a structural comparison, and built by `JSON.stringify`
 * for the same reason {@link queriesEqual} is: everything in a query is JSON,
 * and every array in it is already in a canonical order (`buildQuery` sorts
 * the filters and the search fields, and canonicalises the open paths), so a
 * stringify is exact here and cheap at this size.
 *
 * @param query - The table's current query.
 * @returns An opaque key; two queries select over the same rows exactly when
 *   their keys match.
 *
 * @example
 * if (selectionScopeOf(previous) !== selectionScopeOf(next)) clear()
 */
export function selectionScopeOf(query: TableQuery): string {
  return JSON.stringify([query.filters, query.search, query.grouping, query.expanded])
}

/**
 * The selection column's definition.
 *
 * A DISPLAY column with no accessor, exactly as the row-number column is: the
 * same sentence of TanStack's own (`column_getCanSort` and
 * `column_getCanFilter` both end in `!!column.accessorFn`) already refuses to
 * sort or filter it, so there is no flag here restating that. The three that
 * do not follow are stated — hiding, because a tick that could remove the
 * column would contradict the `selection` flag that put it there; pinning,
 * because the column is pinned to the start by derivation and an Unpin the
 * next render undid would be worse than no Unpin at all; and resizing,
 * because the widest thing in the column is a checkbox and a width the user
 * dragged would be padding they then had to store.
 *
 * `minSize` restates the width. `defaultColumn` sets `minSize: minColumnWidth`
 * (60 by default) for every column, and `column_getSize` clamps against it —
 * so without this the 44px column would render at 60 and the declared width
 * would be a comment rather than a width.
 *
 * It renders nothing. The checkboxes belong to the HEADER and to each ROW —
 * `HeaderCell` and `BodyRow` draw them — because they have to be named for a
 * screen reader out of `DataTableLabels`, and this definition is built in
 * `useDataTable`, which speaks no labels: they are a `<DataTable>` prop, and a
 * column definition rebuilt whenever the language changed would rebuild every
 * column with it.
 *
 * @returns A definition to put at the very front of the table's columns.
 *
 * @example
 * const tableColumns = [selectionColumnDef<Row>(), rowNumberColumnDef<Row>(w), ...columns]
 */
export function selectionColumnDef<TData extends RowData>(): ColumnDef<
  DataTableFeatures,
  TData,
  unknown
> {
  return {
    id: SELECTION_COLUMN_ID,
    header: "",
    cell: () => null,
    size: SELECTION_COLUMN_WIDTH,
    minSize: SELECTION_COLUMN_WIDTH,
    enableHiding: false,
    enablePinning: false,
    enableResizing: false,
  }
}
