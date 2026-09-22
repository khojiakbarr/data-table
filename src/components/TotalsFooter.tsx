import type { RowData } from "@tanstack/react-table"
import type { ReactNode } from "react"
import { classNames, insertAt } from "../core/classNames"
import { fillerIndex, pinnedStyle, renderedLeafColumns } from "../core/pinning"
import { isRowNumberColumn } from "../core/rowNumbers"
import { isSelectionColumn } from "../core/selection"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

export interface TotalsFooterProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  /**
   * The host's own totals, keyed by column id. See {@link DataTableProps.totals}.
   */
  totals: Record<string, ReactNode>
  labels: DataTableLabels
}

/**
 * The totals row: a `<tfoot>` aligned with the columns, holding whatever the
 * host put under each column id.
 *
 * **This component computes nothing.** Summing the fifty rows of a page and
 * presenting it as the table's total is the same lie that forced row grouping
 * to be server-side (see `core/grouping.ts`), and it is a lie the user cannot
 * see — a filtered or paged result would print a number that only ever
 * describes what happens to be on screen. The host answers the query for its
 * own total and hands the finished `ReactNode` over; this component's whole
 * job is alignment, not arithmetic.
 *
 * Alignment has three parts, and each one reuses machinery the header and the
 * body already have rather than inventing a second copy of it:
 *
 * - **Column order and the chrome columns.** Built from
 *   {@link renderedLeafColumns} and {@link fillerIndex} — the exact functions
 *   `<DataTable>`'s own `<colgroup>` and `TableBody` use — so a cell exists
 *   here for every rendered column, selection and row-number columns
 *   included, and never for a hidden one. A `totals` key naming a column that
 *   is hidden, or that does not exist at all, is simply never read: the loop
 *   below walks columns, not `totals`' own keys.
 * - **Pinning.** `pinnedStyle` is the same helper `BodyRow` calls, so a total
 *   under a pinned column sticks at the same `column.getStart()`/`getAfter()`
 *   offset the body already computes — never a second offset that could drift
 *   from it.
 * - **The column's own alignment.** There is no alignment concept of its own
 *   here: each cell is a plain `.dt-td`, the same box model (padding, height)
 *   a body cell renders with, so a host's own right-aligned money `<span>`
 *   lines up under the body's identically, with nothing for this component to
 *   get wrong.
 *
 * It sticks to the **bottom** of the scrolling viewport the way `.dt-th`
 * sticks to the top — `position: sticky; bottom: 0` in `styles.css`, on every
 * cell unconditionally, with no prop to turn it off: a total that scrolls out
 * of view is a total nobody reads.
 *
 * The leading cell — the first column that is not the selection or the
 * row-number column, the same test `BodyRow.leadIndex` runs — carries
 * `labels.totalsRow` as a caption, alongside whatever total the host put
 * under that same column (if any); the row itself carries the same label as
 * an `aria-label`, so a screen reader does not read it as one more record.
 *
 * `totals` being an empty object (`{}`) still draws the row, with only the
 * caption in it. That is deliberate: a host computing an asynchronous total
 * passes `{}` the instant the feature is turned on and fills it in once the
 * server answers, and a row that popped into existence on that answer would
 * shift the body by one row's height at an arbitrary moment. `totals` being
 * `undefined` is the only thing that renders no `<tfoot>` at all — see
 * `<DataTable>`.
 *
 * @example
 * <TotalsFooter instance={instance} totals={{ amount: "$128,430" }} labels={labels} />
 */
export function TotalsFooter<TData extends RowData>({
  instance,
  totals,
  labels,
}: TotalsFooterProps<TData>) {
  const { table } = instance
  const leafColumns = renderedLeafColumns(table)
  const fillerAt = fillerIndex(table)
  /*
   * The same test `BodyRow`'s own `leadIndex` runs: the first column that is
   * not chrome. A grouped table's group column is not excluded — it is a real
   * column with a real slot, and the caption belongs in whichever column
   * actually leads the row, the way the expand toggle does in `BodyRow`.
   */
  const leadIndex = leafColumns.findIndex(
    (column) => !isRowNumberColumn(column.id) && !isSelectionColumn(column.id),
  )

  const cells = leafColumns.map((column, index) => {
    const content = totals[column.id]
    const pinned = column.getIsPinned()
    const className = classNames("dt-td", "dt-tfoot-td", pinned && "dt-pinned")
    const style = pinnedStyle(column)

    if (index === leadIndex) {
      return (
        <td key={column.id} className={className} style={style} data-column-id={column.id}>
          <div className="dt-lead">
            <span className="dt-totals-label">{labels.totalsRow}</span>
            {content === undefined ? null : <span className="dt-td-value">{content}</span>}
          </div>
        </td>
      )
    }

    return (
      <td key={column.id} className={className} style={style} data-column-id={column.id}>
        {content ?? null}
      </td>
    )
  })

  return (
    <tfoot>
      {/*
        Named directly, rather than left to `<tfoot>`'s own semantics: support
        for announcing a table's footer section varies, and a row with no name
        of its own would be read as one more record — the exact confusion
        `labels.totalsRow` exists to head off. No `aria-rowindex`: it is not
        one of the header or data rows `aria-rowcount` on the `<table>`
        counts, the same reason the "continued" group header in `TableBody`
        stays out of that count.
      */}
      <tr className="dt-tr" aria-label={labels.totalsRow}>
        {insertAt(
          cells,
          fillerAt,
          <td key="filler" className="dt-td dt-tfoot-td dt-td-filler" role="presentation" />,
        )}
      </tr>
    </tfoot>
  )
}
