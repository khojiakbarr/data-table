import type { Row, RowData } from "@tanstack/react-table"
import { groupValueLabel, type GroupRow } from "../core/grouping"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { ExpandToggle } from "./ExpandToggle"

export interface CardGroupHeadingProps<TData extends RowData> {
  row: Row<DataTableFeatures, TData>
  group: GroupRow
  grouping: DataTableInstance<TData>["grouping"]
  labels: DataTableLabels
}

/**
 * A group of a grouped table, among the cards: its value and how many rows it
 * holds, with the toggle that opens and closes it — indented by its depth, as
 * the table indents a group's header.
 */
export function CardGroupHeading<TData extends RowData>({ row, group, grouping, labels }: CardGroupHeadingProps<TData>) {
  const depth = Math.max(0, group.path.length - 1)
  const valueColumn = row.getAllCells().find((cell) => cell.column.id === grouping.columns[depth])?.column
  const value = groupValueLabel(group.path[group.path.length - 1], valueColumn?.columnDef.meta?.groupLabel, labels.blanks)
  const expanded = grouping.isExpanded(group.path)
  return (
    <div
      role="listitem"
      className="dt-card-group"
      style={depth > 0 ? { paddingInlineStart: `calc(var(--dt-indent) * ${String(depth)})` } : undefined}
    >
      <ExpandToggle
        expanded={expanded}
        depth={0}
        label={`${expanded ? labels.collapseRow : labels.expandRow}: ${labels.groupRow(value, group.count)}`}
        onToggle={() => grouping.toggle(group.path)}
      />
      <span className="dt-card-group-value">{value}</span>
      <span className="dt-group-count">{labels.groupCount(group.count)}</span>
    </div>
  )
}
