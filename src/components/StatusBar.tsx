import type { RowData } from "@tanstack/react-table"
import type { ReactNode } from "react"
import { columnLabel } from "../core/columnLabel"
import { formatCount } from "../core/formatCount"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

export interface StatusBarProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
}

/**
 * The band under the table stating what the result set contains, per
 * `DataTableFeatureFlags.statusBar`.
 *
 * **Why it is not the footer.** `<TablePagination>` already prints the total
 * beside the page controls; this band exists because that is navigation and
 * this is content, and a band repeating a number already on screen would be
 * worse than no band. So the two hand the row count off between them —
 * `<TablePagination>` reads the very same `instance.flags.statusBar` this
 * component does, and drops its own total the moment this one is on. See
 * that flag's JSDoc for the whole story.
 *
 * **What it says**, as up to three independent parts rather than one
 * concatenated sentence — so a translation can put a different one first:
 *
 * - The row count, labelled TOTAL, or FILTERED while a column filter or the
 *   quick search is narrowing the result (`instance.filtering.isFiltered`).
 *   Filtered says "X of Y" once the host has answered
 *   `UseDataTableOptions.unfilteredTotal`, and just "X" until it has — see
 *   that option's own JSDoc for why absent is the graceful case.
 * - The columns the table is grouped by, outermost first, while any are —
 *   naming them the way the Row Groups chips already do
 *   ({@link columnLabel}), rather than inventing a second way to say a
 *   column's name.
 * - The host's own content, when `instance.flags.statusBar` is a `ReactNode`
 *   rather than a bare `true`.
 *
 * **Deliberately silent about two things.** A selected-row count is absent
 * because there is no row-selection feature in this library for it to count.
 * A sum or an average is absent because the Values zone client-side
 * aggregation would need is explicitly deferred on the roadmap, and
 * aggregating over one SERVER page of a filtered result would be wrong in
 * the exact way client-side grouping would have been — a partial answer
 * presented as the whole one, wrong in a way the user cannot see. Neither is
 * a gap to fill quietly later; both are their own decision.
 *
 * `role="status"` / `aria-live="polite"`: the whole job of this band is to
 * report a change the user caused elsewhere (a filter, a group), and polite
 * is what keeps a row count from interrupting whatever a screen reader is
 * already reading.
 *
 * @example
 * <StatusBar instance={instance} labels={labels} />
 */
export function StatusBar<TData extends RowData>({ instance, labels }: StatusBarProps<TData>) {
  const { table, pagination, filtering, grouping, flags } = instance

  const rawCount = pagination.rowCount
  const count = formatCount(rawCount)

  const rawUnfilteredTotal = pagination.unfilteredTotal
  const unfilteredTotal = rawUnfilteredTotal === undefined ? undefined : formatCount(rawUnfilteredTotal)

  // A bare `true` — or `false`, which never reaches here, `<DataTable>`
  // renders nothing for it — carries no content of its own; anything else IS
  // the host's content, whatever shape it took. See `statusBar`'s own JSDoc.
  const hostContent: ReactNode = typeof flags.statusBar === "boolean" ? null : flags.statusBar

  const groupedNames = grouping.columns.map((columnId) => {
    const column = table.getColumn(columnId)
    return columnLabel(columnId, column?.columnDef.header)
  })

  return (
    <div className="dt-status-bar" role="status" aria-live="polite">
      <span className="dt-status-bar-rows">
        {filtering.isFiltered
          ? labels.statusBarFiltered(count, rawCount, unfilteredTotal)
          : labels.statusBarRows(count, rawCount)}
      </span>

      {grouping.isGrouped ? (
        <span className="dt-status-bar-grouped">{labels.statusBarGroupedBy(groupedNames)}</span>
      ) : null}

      <span className="dt-spacer" />

      {hostContent !== null ? <span className="dt-status-bar-content">{hostContent}</span> : null}
    </div>
  )
}
