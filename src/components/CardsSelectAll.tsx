import type { Row, RowData } from "@tanstack/react-table"
import { isGroupRow } from "../core/grouping"
import { selectAllLabel } from "../core/selectAllLabel"
import { pageHeaderState } from "../core/selection"
import type { SelectionApi } from "../core/useSelection"
import type { DataTableFeatures } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { SelectionCheckbox } from "./SelectionCheckbox"

export interface CardsSelectAllProps<TData extends RowData> {
  selection: SelectionApi
  /** The cards drawn, group headings included. */
  rows: readonly Row<DataTableFeatures, TData>[]
  /** The list scrolls on (`useInfiniteRows`), so its pages are one list. */
  isInfinite: boolean
  labels: DataTableLabels
}

/**
 * The select-all box heading a list of cards, as the header's box heads the
 * table, in a label so a finger's larger target ticks it.
 *
 * Page-scoped over cards that scroll on, it stands for every card drawn, not
 * the table's current page alone: the person sees one list, and a box that
 * ticked only its last page would leave the cards above it as they were.
 */
export function CardsSelectAll<TData extends RowData>({ selection, rows, isInfinite, labels }: CardsSelectAllProps<TData>) {
  const drawnIds =
    selection.headerScope === "page" && isInfinite
      ? rows.filter((row) => !isGroupRow(row.original)).map((row) => row.id)
      : undefined
  const head = drawnIds === undefined ? undefined : pageHeaderState(selection.model, drawnIds)
  const label = selectAllLabel(selection, labels)
  return (
    <div className="dt-cards-head">
      <label className="dt-card-check">
        <SelectionCheckbox
          checked={head?.checked ?? selection.headerChecked}
          indeterminate={head?.indeterminate ?? selection.headerIndeterminate}
          label={label}
          onChange={(selected) => (drawnIds === undefined ? selection.toggleAll(selected) : selection.toggleRows(drawnIds, selected))}
        />
        <span aria-hidden="true">{label}</span>
      </label>
    </div>
  )
}
