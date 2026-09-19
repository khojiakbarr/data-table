import type { Column, RowData } from "@tanstack/react-table"
import { useState } from "react"
import { columnLabel } from "../core/columnLabel"
import { describeCondition } from "../core/filterDraft"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
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
  /**
   * Identifies this particular focus request, so a repeat request for the
   * SAME `focusColumnId` is not mistaken for a re-render — see
   * `TablePanelProps.focusNonce`, which this mirrors.
   */
  focusNonce?: number | undefined
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
  focusNonce,
}: FiltersTabProps<TData>) {
  const { table, filtering } = instance
  const [openId, setOpenId] = useState<string | null>(focusColumnId ?? null)
  /*
   * The seed above only runs on mount, and a shell that leaves this tab
   * mounted can send a new focus request while it stays on the Filters tab:
   * keyboard activation of a header menu's "Filter in panel…" item fires no
   * `pointerdown`, so nothing closes and remounts the panel first. Comparing
   * `focusColumnId` alone missed the case where the SAME column is asked for
   * twice in a row — the prop would already equal the last one honoured, so
   * nothing looked like a new request. `focusNonce` gives every request its
   * own identity instead, so the comparison below is "asked again", never
   * "value happens to match".
   *
   * Held in state rather than a ref, matching `openId` above: a render can be
   * thrown away, and a ref written during one that is would leave this
   * "honoured" bookkeeping out of sync with what actually opened — the same
   * argument `useTableQuery` documents for not caching derived identity in a
   * ref across renders.
   */
  const [honouredNonce, setHonouredNonce] = useState(focusNonce)
  if (focusColumnId !== undefined && focusNonce !== honouredNonce) {
    setHonouredNonce(focusNonce)
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
  const partitionByFilter = (): Array<Column<DataTableFeatures, TData, unknown>> => [
    ...columns.filter((column) => active.has(column.id)),
    ...columns.filter((column) => !active.has(column.id)),
  ]
  /*
   * Filtered columns sort first, but not out from under a user who has that
   * very entry open: an immediate-commit operator (`FilterEditor`'s
   * `handleOperator`, and the blur/Enter/Apply/Clear paths beside it) commits
   * on every change, and re-partitioning on each one would move the expanded
   * entry — with focus still inside it — the instant its own filter changed.
   * So the order is frozen for as long as `openId` names the same entry, and
   * only re-partitioned when an editor opens, closes, or switches to a
   * different column — i.e. exactly when `openId` itself changes, which is
   * always a deliberate act and never a side effect of the entry's own edit.
   *
   * State, not a bare recomputation gated on a `useMemo` cache: this file's
   * own neighbour above already rejects a ref for the same "must survive a
   * discarded render" reason, and React documents a `useMemo` cache as
   * something that may likewise be discarded and recomputed for a render
   * that changed none of its inputs — exactly the correctness (not just
   * performance) this freeze depends on.
   */
  const [frozenOpenId, setFrozenOpenId] = useState(openId)
  const [frozenOrder, setFrozenOrder] = useState(partitionByFilter)
  if (openId !== frozenOpenId) {
    setFrozenOpenId(openId)
    setFrozenOrder(partitionByFilter())
  }
  const ordered = openId === null ? partitionByFilter() : frozenOrder
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
          onClick={() =>
            /*
             * `filtering.clearAll` clears the quick search too, which this tab
             * neither shows nor names — pressing this button must not destroy
             * text typed into a control the user cannot see from here.
             * `setModel` is the existing whole-model writer, reused with the
             * current search carried through unchanged; it still flushes a
             * pending search debounce via `publishNow`, exactly as
             * `clearAll` does.
             */
            filtering.setModel({ filters: [], search: filtering.search })
          }
        >
          {labels.clearAllFilters}
        </button>
      </div>
    </>
  )
}
