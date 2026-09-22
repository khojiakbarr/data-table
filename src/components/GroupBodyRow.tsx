import type { Row, RowData } from "@tanstack/react-table"
import { classNames, insertAt } from "../core/classNames"
import { isSameCell } from "../core/cellEditing"
import { groupValueLabel, type GroupRow } from "../core/grouping"
import { pinnedStyle } from "../core/pinning"
import type { CellEditing } from "../core/useCellEditing"
import type { DataTableFeatures } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { ExpandToggle } from "./ExpandToggle"

interface GroupBodyRowProps<TData extends RowData> {
  /** The table row wrapping the group header, for its cells and its id. */
  row: Row<DataTableFeatures, TData>
  /** The group itself: its key path and how many records are under it. */
  group: GroupRow
  /** Position among rows in render order; drives striping. */
  position: number
  /** The column whose cell holds the chevron, the value and the count. */
  groupColumnId: string | undefined
  /**
   * Column ids the table is grouped by, outermost first — `instance.grouping.columns`.
   *
   * Not the same thing as {@link GroupBodyRowProps.groupColumnId}: that one
   * names which CELL renders the group's text, always the same column
   * regardless of depth, while this one says which of the host's columns a
   * given LEVEL's value actually came from — `columnIds[depth]` — which is
   * what a formatter has to be read off of. A table grouped by "region" then
   * "status" shows every level in the region column's slot, but a depth-1
   * group's key is a status, and only the status column's own
   * `meta.groupLabel` knows what it means.
   */
  columnIds: readonly string[]
  expanded: boolean
  onToggle: () => void
  /** Header rows above the body, so `aria-rowindex` can count past them. */
  headerRowCount: number
  /** Rows already on earlier pages, so `aria-rowindex` counts from the table. */
  rowIndexOffset: number
  /** Where the filler cell goes among the visible cells; see `fillerIndex`. */
  fillerAt: number
  labels: DataTableLabels
  /**
   * Cell editing, or undefined for a table that has none.
   *
   * A group row has nothing to edit and gets the menu all the same (§4): a
   * menu that sometimes fails to appear teaches the user the feature is
   * broken, so Edit is offered here disabled, saying that a group row
   * aggregates records and has none of its own to write to.
   */
  editing?: CellEditing<TData> | undefined
}

/**
 * One group header in a flattened, server-grouped page.
 *
 * It is a row of the same shape as every other — the same cells, in the same
 * order, with the same pinned offsets — so the `<colgroup>` widths line up and
 * a pinned column stays pinned across it. Only one cell has anything in it:
 * the group column's, holding the chevron, the group's value and its count.
 * The rest are empty on purpose, because a group is not a record and has no
 * value for any of the host's other columns.
 *
 * The chevron is {@link ExpandToggle}, the same control a detail panel uses,
 * so `aria-expanded`, the focus ring and the reduced-motion rule are the ones
 * the table already has. What it drives is different: opening a group changes
 * the QUERY, so the page is refetched rather than revealed locally.
 *
 * Indentation is the group's own depth — a second-level group sits one indent
 * in — which is what makes a nested grouping readable without a tree line.
 */
export function GroupBodyRow<TData extends RowData>({
  row,
  group,
  position,
  groupColumnId,
  columnIds,
  expanded,
  onToggle,
  headerRowCount,
  rowIndexOffset,
  fillerAt,
  labels,
  editing,
}: GroupBodyRowProps<TData>) {
  const depth = Math.max(0, group.path.length - 1)
  const key = group.path[group.path.length - 1]
  /*
   * The column THIS level's key actually came from, not necessarily the one
   * the value is rendered in (`groupColumnId`) — see `columnIds` above.
   * `getAllCells` rather than `getVisibleCells`: every grouped column but the
   * lead one is hidden from the body, and a hidden column's meta is exactly
   * as good as a visible one's.
   */
  const valueColumn = row.getAllCells().find((cell) => cell.column.id === columnIds[depth])?.column
  const value = groupValueLabel(key, valueColumn?.columnDef.meta?.groupLabel, labels.blanks)
  const name = labels.groupRow(value, group.count)

  const cells = row.getVisibleCells().map((cell, index) => {
    const isGroupCell = cell.column.id === groupColumnId
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
        /* See BodyRow: the cell the menu opened on takes the focus back. */
        tabIndex={isSameCell(editing?.focusCell, { rowId: row.id, columnId: cell.column.id }) ? -1 : undefined}
        onContextMenu={
          editing === undefined
            ? undefined
            : (event) => editing.onCellContextMenu(event, row, cell.column.id)
        }
      >
        {isGroupCell ? (
          <div className="dt-lead">
            <ExpandToggle
              expanded={expanded}
              depth={depth}
              label={`${expanded ? labels.collapseRow : labels.expandRow}: ${name}`}
              onToggle={onToggle}
            />
            <span className="dt-td-value dt-group-value">{value}</span>
            <span className="dt-group-count">{labels.groupCount(group.count)}</span>
          </div>
        ) : null}
      </td>
    )
  })

  return (
    <tr
      className="dt-tr dt-group-row"
      data-depth={depth}
      data-parity={position % 2 === 0 ? "even" : "odd"}
      aria-rowindex={position + rowIndexOffset + headerRowCount + 1}
    >
      {insertAt(
        cells,
        fillerAt,
        <td key="filler" className="dt-td dt-td-filler" role="presentation" />,
      )}
    </tr>
  )
}
