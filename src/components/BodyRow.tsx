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
  /**
   * The column that holds the group values while the table is grouped, or
   * undefined when it is not. A record has nothing to show there — the column
   * it names left the body — so that cell carries the record's indent instead.
   */
  groupColumnId?: string | undefined
  /** How many grouping levels a record sits under, for its indent. */
  groupDepth?: number
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
  groupColumnId,
  groupDepth = 0,
  onRowClick,
}: BodyRowProps<TData>) {
  const cells = row.getVisibleCells()
  const expandable = row.subRows.length > 0 || hasDetail
  const isExpanded = expandable && row.getIsExpanded()

  const rendered = cells.map((cell, index) => {
    const isGroupCell = cell.column.id === groupColumnId
    /*
     * A grouped column has left the body: its value is on the group header
     * above, once, instead of being repeated on every record underneath. The
     * cell keeps its slot — the `<colgroup>` width and any pinned offset are
     * the column's, not the value's — and carries the record's indent, which
     * is what lines a record up under the group it belongs to.
     */
    const value = isGroupCell ? null : flexRender(cell.column.columnDef.cell, cell.getContext())
    return (
      <td
        key={cell.id}
        className={classNames(
          "dt-td",
          cell.column.getIsPinned() && "dt-pinned",
          index === 0 && "dt-td-lead",
          isGroupCell && "dt-group-cell",
        )}
        style={pinnedStyle(cell.column)}
        data-column-id={cell.column.id}
      >
        {index === 0 || isGroupCell ? (
          <div className="dt-lead">
            {/*
              The detail/tree toggle belongs to the FIRST cell, the group
              indent to the group cell. They are usually different cells;
              when they are the same one both appear, toggle first, because
              each answers a different question about the row.
            */}
            {index === 0 &&
              (expandable ? (
                <ExpandToggle
                  expanded={isExpanded}
                  depth={row.depth}
                  label={isExpanded ? labels.collapseRow : labels.expandRow}
                  onToggle={() => row.toggleExpanded()}
                />
              ) : (
                <DepthSpacer depth={row.depth} />
              ))}
            {isGroupCell ? <DepthSpacer depth={groupDepth} /> : null}
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
