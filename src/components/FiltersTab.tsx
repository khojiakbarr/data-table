import type { RowData } from "@tanstack/react-table"
import { useRef, useState } from "react"
import { columnLabel } from "../core/columnLabel"
import { describeCondition } from "../core/filterDraft"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { canFilterColumn, FilterEditor } from "./FilterEditor"

/**
 * Every filterable column in one place.
 *
 * The other half of the model the header popover edits — same editor, same
 * draft rules — and the only surface a *hidden* column's filter has, which is
 * why this list is built from `getAllLeafColumns()` rather than from the
 * rendered ones.
 */

export interface FiltersTabProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  /** Open this column's editor, focused, when the tab first renders. */
  focusColumnId?: string | undefined
}

/**
 * The side panel's Filters half.
 *
 * @param props - See {@link FiltersTabProps}.
 * @returns The list of filterable columns, each with its own editor, and the
 *   Clear all filters action at the foot.
 */
export function FiltersTab<TData extends RowData>({
  instance,
  labels,
  focusColumnId,
}: FiltersTabProps<TData>) {
  const { table, filtering } = instance
  const [openId, setOpenId] = useState<string | null>(focusColumnId ?? null)
  /*
   * The seed above only runs on mount, and a shell that leaves this tab
   * mounted can send a new `focusColumnId` while it stays on the Filters tab:
   * keyboard activation of a header menu's "Filter in panel…" item fires no
   * `pointerdown`, so nothing closes and remounts the panel first. Track the
   * last request this tab actually honoured, and open the next one the
   * moment it differs — the way React documents state derived from props.
   */
  const honouredRef = useRef(focusColumnId)
  if (focusColumnId !== undefined && focusColumnId !== honouredRef.current) {
    honouredRef.current = focusColumnId
    setOpenId(focusColumnId)
  }

  /*
   * Hidden columns included. TanStack goes on applying a hidden column's
   * filter, and that column has no header to carry a marker, so listing only
   * rendered columns would strand a filter with no surface anywhere: 40 rows
   * out of 10 000 and no way to find out why.
   */
  const columns = table.getAllLeafColumns().filter((column) => canFilterColumn(instance, column))
  const active = new Set(filtering.conditions.map((condition) => condition.field))
  // Filtered columns first; each half keeps the order the table is in.
  const ordered = [
    ...columns.filter((column) => active.has(column.id)),
    ...columns.filter((column) => !active.has(column.id)),
  ]
  // This tab shows column filters only, so its own note and its own "Clear
  // all filters" answer for `conditions`, not for `filtering.isFiltered` —
  // that flag also turns true from the quick search, which this tab neither
  // shows nor should silently clear.
  const hasFilters = filtering.conditions.length > 0

  return (
    <>
      {hasFilters ? null : <p className="dt-filter-note">{labels.noFilters}</p>}

      <ul className="dt-panel-list">
        {ordered.map((column) => {
          const condition = filtering.conditions.find((entry) => entry.field === column.id)
          const open = openId === column.id
          return (
            <li key={column.id}>
              <button
                type="button"
                className="dt-panel-item"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : column.id)}
              >
                <span className="dt-panel-label">
                  {columnLabel(column.id, column.columnDef.header)}
                </span>
                {column.getIsVisible() ? null : (
                  <span className="dt-filter-badge">{labels.hiddenColumn}</span>
                )}
                {condition ? (
                  <span className="dt-filter-summary">{describeCondition(condition, labels)}</span>
                ) : null}
              </button>

              {open ? (
                <FilterEditor
                  instance={instance}
                  column={column}
                  labels={labels}
                  autoFocus={column.id === focusColumnId}
                />
              ) : null}
            </li>
          )
        })}
      </ul>

      <div className="dt-panel-foot">
        <button
          type="button"
          className="dt-link"
          disabled={!hasFilters}
          onClick={filtering.clearAll}
        >
          {labels.clearAllFilters}
        </button>
      </div>
    </>
  )
}
