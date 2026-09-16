import { flexRender, type Row, type RowData } from "@tanstack/react-table"
import type { CSSProperties } from "react"
import { classNames, insertAt } from "../core/classNames"
import { pinnedStyle } from "../core/pinning"
import type { DataTableFeatures } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { DepthSpacer, ExpandToggle } from "./ExpandToggle"

interface BodyRowProps<TData extends RowData> {
  row: Row<DataTableFeatures, TData>
  /** Position among rows in render order; drives striping. */
  position: number
  /** Explicit height when the table has `getRowHeight`. */
  height?: number | undefined
  /** Header rows above the body, so `aria-rowindex` can count past them. */
  headerRowCount: number
  /**
   * Rows already on earlier pages, so `aria-rowindex` counts from the table
   * rather than restarting at the top of every page. Zero with pagination off.
   */
  rowIndexOffset: number
  /** Where the filler cell goes among the visible cells; see `fillerIndex`. */
  fillerAt: number
  labels: DataTableLabels
  /** Whether a detail panel can open under this row. */
  hasDetail: boolean
  onRowClick?: ((row: TData) => void) | undefined
}

/**
 * One data row.
 *
 * The lead cell holds the expand toggle (or an indent spacer) beside the
 * value, in a flex wrapper INSIDE the cell: a `<td>` that is itself a flex
 * container cannot truncate its text with an ellipsis.
 *
 * Striping is keyed on `data-parity`, not `:nth-child`: with virtualisation
 * the DOM position of a row says nothing about its position in the data.
 * `aria-rowindex` says the same thing to assistive technology, which would
 * otherwise be told the table holds only the rows currently in the DOM.
 *
 * An explicit `height` also re-declares `--dt-row-height` on the row. The
 * stylesheet sizes cells from that token, and a `height` on the `<tr>` alone
 * is only a floor — a row asked to be shorter than the table's default would
 * render at the default while the virtualiser budgeted for the shorter one.
 */
export function BodyRow<TData extends RowData>({
  row,
  position,
  height,
  headerRowCount,
  rowIndexOffset,
  fillerAt,
  labels,
  hasDetail,
  onRowClick,
}: BodyRowProps<TData>) {
  const cells = row.getVisibleCells()
  const expandable = row.subRows.length > 0 || hasDetail
  const isExpanded = expandable && row.getIsExpanded()

  const rendered = cells.map((cell, index) => {
    const value = flexRender(cell.column.columnDef.cell, cell.getContext())
    return (
      <td
        key={cell.id}
        className={classNames(
          "dt-td",
          cell.column.getIsPinned() && "dt-pinned",
          index === 0 && "dt-td-lead",
        )}
        style={pinnedStyle(cell.column)}
        data-column-id={cell.column.id}
      >
        {index === 0 ? (
          <div className="dt-lead">
            {expandable ? (
              <ExpandToggle
                expanded={isExpanded}
                depth={row.depth}
                label={isExpanded ? labels.collapseRow : labels.expandRow}
                onToggle={() => row.toggleExpanded()}
              />
            ) : (
              <DepthSpacer depth={row.depth} />
            )}
            <span className="dt-td-value">{value}</span>
          </div>
        ) : (
          value
        )}
      </td>
    )
  })

  return (
    <tr
      className={isExpanded ? "dt-tr dt-tr-expanded" : "dt-tr"}
      data-depth={row.depth}
      data-parity={position % 2 === 0 ? "even" : "odd"}
      aria-rowindex={position + rowIndexOffset + headerRowCount + 1}
      style={
        height === undefined
          ? undefined
          : ({ height, "--dt-row-height": `${height}px` } as CSSProperties)
      }
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
    >
      {insertAt(
        rendered,
        fillerAt,
        <td key="filler" className="dt-td dt-td-filler" role="presentation" />,
      )}
    </tr>
  )
}
