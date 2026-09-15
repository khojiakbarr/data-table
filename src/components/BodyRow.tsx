import { flexRender, type Row, type RowData } from "@tanstack/react-table"
import { Fragment, type ReactNode } from "react"
import { classNames, insertAt } from "../core/classNames"
import { pinnedStyle } from "../core/pinning"
import type { DataTableFeatures } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { DepthSpacer, ExpandToggle } from "./ExpandToggle"

interface BodyRowProps<TData extends RowData> {
  row: Row<DataTableFeatures, TData>
  /** Where the filler cell goes among the visible cells; see `fillerIndex`. */
  fillerAt: number
  labels: DataTableLabels
  renderDetail?: ((row: TData) => ReactNode) | undefined
  onRowClick?: ((row: TData) => void) | undefined
}

/**
 * One data row, plus its detail panel when it is open.
 *
 * The lead cell holds the expand toggle (or an indent spacer) beside the
 * value. Those sit in a flex wrapper INSIDE the cell rather than on the cell
 * itself: a `<td>` that is a flex container cannot truncate its text with an
 * ellipsis, so the first column would clip hard the moment it was narrowed.
 */
export function BodyRow<TData extends RowData>({
  row,
  fillerAt,
  labels,
  renderDetail,
  onRowClick,
}: BodyRowProps<TData>) {
  const cells = row.getVisibleCells()
  const hasChildren = row.subRows.length > 0
  const expandable = hasChildren || Boolean(renderDetail)
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
    <Fragment>
      <tr
        className={isExpanded ? "dt-tr dt-tr-expanded" : "dt-tr"}
        data-depth={row.depth}
        onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      >
        {insertAt(
          rendered,
          fillerAt,
          <td key="filler" className="dt-td dt-td-filler" role="presentation" />,
        )}
      </tr>

      {isExpanded && renderDetail ? (
        <tr className="dt-detail-row" data-depth={row.depth}>
          {/* One more than the cells: the filler column counts too. */}
          <td className="dt-detail-cell" colSpan={cells.length + 1}>
            <div
              className="dt-detail"
              style={
                row.depth > 0
                  ? { marginInlineStart: `calc(var(--dt-indent) * ${row.depth + 1})` }
                  : undefined
              }
            >
              {renderDetail(row.original)}
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}
