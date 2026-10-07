import type { Row, RowData } from "@tanstack/react-table"
import type { ReactNode } from "react"
import { CardContext } from "../core/cardContext"
import { cardPlaces } from "../core/cardLayout"
import { columnLabel } from "../core/columnLabel"
import { groupValueLabel, isGroupRow } from "../core/grouping"
import { renderedLeafColumns } from "../core/pinning"
import { selectAllLabel } from "../core/selectAllLabel"
import { isRowNumberColumn, rowNumberAt } from "../core/rowNumbers"
import { isSelectionColumn } from "../core/selection"
import { isTimelineColumn } from "../core/timeline"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels, RowTone } from "../types"
import { CardRow } from "./CardRow"
import { ExpandToggle } from "./ExpandToggle"
import { SelectionCheckbox } from "./SelectionCheckbox"

export interface CardListProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  /** The rows to draw — the table's row model, one page of it with pagination on. */
  rows: Row<DataTableFeatures, TData>[]
  /** Rows already on earlier pages, so a card's number counts from the table. */
  rowIndexOffset: number
  labels: DataTableLabels
  /** Skeleton cards in place of the rows, while the first page is on its way. */
  skeleton?: number | undefined
  renderDetail?: ((row: TData) => ReactNode) | undefined
  onRowClick?: ((row: TData) => void) | undefined
  getRowTone?: ((row: TData) => RowTone | undefined) | undefined
  /** The host's totals, keyed by column id (`DataTableProps.totals`): a card of their own at the foot. */
  totals?: Record<string, ReactNode> | undefined
}

/**
 * The rows as a list of cards, for a narrow table (`layout="cards"`, or
 * `"auto"` below its breakpoint). Each row is a {@link CardRow}, laid out
 * from the columns' `meta.card`; a group of a grouped table is a heading that
 * opens and closes it; the totals are a card that stays at the foot of the
 * scrolling list; while the first page is on its way, skeleton cards hold its
 * place.
 *
 * Every card of the page is drawn, none windowed: a card's height depends on
 * what it holds, and a page is at most what the server sends at once. A long
 * client-side list in cards wants pagination on.
 *
 * With rows selected, a select-all box heads the list, as the header's box
 * heads the table. Header, sorting by a header, cell editing and a row's
 * context menu are the table's: a card has no header to click, an edit
 * belongs on a screen wide enough to see the row, and a phone has no right
 * click.
 */
export function CardList<TData extends RowData>({
  instance,
  rows,
  rowIndexOffset,
  labels,
  skeleton,
  renderDetail,
  onRowClick,
  getRowTone,
  totals,
}: CardListProps<TData>) {
  const { table, grouping } = instance
  const columns = renderedLeafColumns(table)
  // A grouped column's value is on the group's heading, once: a card under it does not repeat it, nor take it for a title.
  const contentColumns = columns.filter((column) => !isChrome(column.id) && column.id !== grouping.columnId)
  // A loop over a dozen columns: cheaper than the memo that would guard it.
  const places = cardPlaces(contentColumns.map((column) => ({ id: column.id, card: column.columnDef.meta?.card })))
  const selection = instance.selection.enabled && columns.some((column) => isSelectionColumn(column.id)) ? instance.selection : undefined

  if (skeleton !== undefined) {
    return (
      <div className="dt-cards" aria-hidden="true">
        {Array.from({ length: skeleton }, (_, index) => (
          <div key={index} className="dt-card dt-card-skeleton" aria-hidden="true">
            <span className="dt-card-bar" style={{ width: "36%" }} />
            <span className="dt-card-bar" style={{ width: "72%" }} />
            <span className="dt-card-bar" style={{ width: "48%" }} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <CardContext.Provider value={true}>
    <div className="dt-cards">
      {selection === undefined ? null : (
        <div className="dt-cards-head">
          <SelectionCheckbox
            checked={selection.headerChecked}
            indeterminate={selection.headerIndeterminate}
            label={selectAllLabel(selection, labels)}
            onChange={selection.toggleAll}
          />
          <span aria-hidden="true">{selectAllLabel(selection, labels)}</span>
        </div>
      )}
      <div role="list" className="dt-cards-list">
        {rows.map((row, position) => {
          const original = row.original
          if (isGroupRow(original)) {
            const depth = Math.max(0, original.path.length - 1)
            const valueColumn = row.getAllCells().find((cell) => cell.column.id === grouping.columns[depth])?.column
            const value = groupValueLabel(original.path[original.path.length - 1], valueColumn?.columnDef.meta?.groupLabel, labels.blanks)
            const expanded = grouping.isExpanded(original.path)
            return (
              <div
                key={row.id}
                role="listitem"
                className="dt-card-group"
                style={depth > 0 ? { paddingInlineStart: `calc(var(--dt-indent) * ${String(depth)})` } : undefined}
              >
                <ExpandToggle
                  expanded={expanded}
                  depth={0}
                  label={`${expanded ? labels.collapseRow : labels.expandRow}: ${labels.groupRow(value, original.count)}`}
                  onToggle={() => grouping.toggle(original.path)}
                />
                <span className="dt-card-group-value">{value}</span>
                <span className="dt-group-count">{labels.groupCount(original.count)}</span>
              </div>
            )
          }
          return (
            <CardRow
              key={row.id}
              row={row}
              places={places}
              number={rowNumberAt(position, rowIndexOffset)}
              labels={labels}
              selection={selection}
              renderDetail={renderDetail}
              onRowClick={onRowClick}
              tone={getRowTone?.(original)}
            />
          )
        })}
      </div>
      {totals === undefined ? null : (
        <div className="dt-card dt-card-totals" role="group" aria-label={labels.totalsRow}>
          <div className="dt-card-totals-label">{labels.totalsRow}</div>
          <dl className="dt-card-fields">
            {contentColumns.flatMap((column) =>
              totals[column.id] === undefined
                ? []
                : [
                    <div key={column.id} className="dt-card-field" data-column-id={column.id}>
                      <dt>{columnLabel(column.id, column.columnDef.header, column.columnDef.meta?.label)}</dt>
                      <dd>{totals[column.id]}</dd>
                    </div>,
                  ],
            )}
          </dl>
        </div>
      )}
    </div>
    </CardContext.Provider>
  )
}

/** The columns a card draws by itself (the selection) or not at all (row numbers, the timeline). */
const isChrome = (id: string): boolean => isSelectionColumn(id) || isRowNumberColumn(id) || isTimelineColumn(id)
