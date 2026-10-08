import { flexRender, type Cell, type Row, type RowData } from "@tanstack/react-table"
import type { MouseEvent, ReactNode } from "react"
import { isBlankCardValue, type CardPlaces } from "../core/cardLayout"
import { classNames } from "../core/classNames"
import { columnLabel } from "../core/columnLabel"
import type { SelectionApi } from "../core/useSelection"
import type { DataTableFeatures } from "../useDataTable"
import type { CardSlot, DataTableLabels, RowTone } from "../types"
import { ExpandToggle } from "./ExpandToggle"
import { SelectionCheckbox } from "./SelectionCheckbox"

type AnyCell<TData extends RowData> = Cell<DataTableFeatures, TData, unknown>

/** What a click on a card must leave alone: a control inside it has its own job. */
const INTERACTIVE = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[tabindex]",
  ...["button", "checkbox", "menuitem", "menuitemcheckbox", "menuitemradio", "link", "switch", "tab", "option", "radio", "combobox"].map(
    (role) => `[role='${role}']`,
  ),
].join(", ")

export interface CardRowProps<TData extends RowData> {
  row: Row<DataTableFeatures, TData>
  /** Which column goes where (`cardPlaces`), the same for every card of the table. */
  places: CardPlaces
  /** The row's place in the whole result, for the names of its controls. */
  number: number
  labels: DataTableLabels
  /** The selection, when the table selects rows: the card leads with its checkbox. */
  selection?: SelectionApi | undefined
  /** A detail panel opens inside the card (`DataTableProps.renderDetail`). */
  renderDetail?: ((row: TData) => ReactNode) | undefined
  onRowClick?: ((row: TData) => void) | undefined
  tone?: RowTone | undefined
}

/**
 * One row of the table drawn as a card (`layout="cards"`): its code, status
 * and ⋮ along the top; its picture, title and subtitle beside the amount and
 * a note under it; its fields as "label: value"; its chips and trailing mark
 * along the foot. Every cell is the column's own renderer — a card shows a
 * value exactly as the table does. A column with a value of its own that is
 * blank draws nothing, never a dash; a display column always draws its cell.
 *
 * A click opens the row, as a table row's does, except on a control inside
 * the card (a link, a menu, the checkbox), which keeps its own job, inside its
 * open detail, or in something a cell drew in a portal. The card is not a Tab
 * stop of its own — a list item that acts would be announced as nothing — so
 * the keyboard's way in is a link a cell draws, as it is in the table.
 */
export function CardRow<TData extends RowData>({
  row,
  places,
  number,
  labels,
  selection,
  renderDetail,
  onRowClick,
  tone,
}: CardRowProps<TData>) {
  const cells = new Map(row.getVisibleCells().map((cell) => [cell.column.id, cell]))
  const draw = (id: string): ReactNode => {
    const cell = cells.get(id)
    if (cell === undefined || isBlank(cell)) return null
    return <span key={id} className="dt-card-cell" data-column-id={id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
  }
  const slot = (name: CardSlot): ReactNode[] => places[name].map(draw).filter((node) => node !== null)
  const code = slot("code")
  const status = slot("status")
  const actions = slot("actions")
  const leading = slot("leading")
  const title = slot("title")
  const subtitle = slot("subtitle")
  const amount = slot("amount")
  const amountNote = slot("amountNote")
  const chips = slot("chips")
  const trailing = slot("trailing")
  const fields = places.fields.flatMap((id) => {
    const cell = cells.get(id)
    if (cell === undefined || isBlank(cell)) return []
    const { column } = cell
    const value = flexRender(column.columnDef.cell, cell.getContext())
    // A column with no name of its own (a drawn header, no `meta.label`) is drawn without one: its id is a developer's word.
    const isNamed = typeof column.columnDef.header === "string" || column.columnDef.meta?.label !== undefined
    return [
      <div key={id} className={classNames("dt-card-field", !isNamed && "dt-card-field-bare")} data-column-id={id}>
        {isNamed ? <dt>{columnLabel(column.id, column.columnDef.header, column.columnDef.meta?.label)}</dt> : null}
        <dd>{value}</dd>
      </div>,
    ]
  })

  const expandable = row.subRows.length > 0 || (renderDetail !== undefined && row.getCanExpand())
  const isExpanded = expandable && row.getIsExpanded()
  const isSelected = selection?.isRowSelected(row.id) ?? false
  const hasTop = selection !== undefined || code.length + status.length + actions.length > 0
  const hasFoot = chips.length + trailing.length > 0 || expandable

  const open = (event: MouseEvent<HTMLDivElement>): void => {
    if (!onRowClick) return
    const target = event.target as Element
    // A React event bubbles out of a portal into the card that rendered it; the click was not on the card.
    if (!event.currentTarget.contains(target)) return
    const control = target.closest(INTERACTIVE)
    if (control !== null && event.currentTarget.contains(control)) return
    onRowClick(row.original)
  }

  return (
    <div
      role="listitem"
      className={classNames("dt-card", isExpanded && "dt-card-expanded")}
      data-dt-tone={tone}
      data-depth={row.depth > 0 ? row.depth : undefined}
      style={row.depth > 0 ? { marginInlineStart: `calc(var(--dt-indent) * ${String(row.depth)})` } : undefined}
      data-selected={isSelected ? "" : undefined}
      data-clickable={onRowClick ? "" : undefined}
      onClick={onRowClick ? open : undefined}
    >
      {hasTop ? (
        <div className="dt-card-top">
          {selection === undefined ? null : (
            <SelectionCheckbox
              checked={isSelected}
              label={labels.selectRow(number)}
              onChange={(selected) => selection.toggleRow(row.id, selected)}
            />
          )}
          {code.length > 0 ? <span className="dt-card-code">{code}</span> : null}
          <span className="dt-spacer" />
          {status.length > 0 ? <span className="dt-card-status">{status}</span> : null}
          {actions.length > 0 ? <span className="dt-card-actions">{actions}</span> : null}
        </div>
      ) : null}
      {leading.length + title.length + subtitle.length + amount.length + amountNote.length > 0 ? (
        <div className="dt-card-main">
          {leading.length > 0 ? <span className="dt-card-leading">{leading}</span> : null}
          <div className="dt-card-heading">
            {title.length > 0 ? <div className="dt-card-title">{title}</div> : null}
            {subtitle.length > 0 ? <div className="dt-card-subtitle">{subtitle}</div> : null}
          </div>
          {amount.length + amountNote.length > 0 ? (
            <div className="dt-card-figure">
              {amount.length > 0 ? <div className="dt-card-amount">{amount}</div> : null}
              {amountNote.length > 0 ? <div className="dt-card-note">{amountNote}</div> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {fields.length > 0 ? <dl className="dt-card-fields">{fields}</dl> : null}
      {hasFoot ? (
        <div className="dt-card-foot">
          {chips.length > 0 ? <span className="dt-card-chips">{chips}</span> : null}
          <span className="dt-spacer" />
          {/* The trailing mark and the toggle wrap together, so the toggle is never alone on a line of its own. */}
          {trailing.length > 0 || expandable ? (
            <span className="dt-card-end">
              {trailing.length > 0 ? <span className="dt-card-trailing">{trailing}</span> : null}
              {expandable ? (
                <ExpandToggle
                  expanded={isExpanded}
                  depth={0}
                  label={`${isExpanded ? labels.collapseRow : labels.expandRow}: ${number}`}
                  onToggle={() => row.toggleExpanded()}
                />
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
      {isExpanded && renderDetail !== undefined ? (
        // Reading the detail opens nothing: in the table it is a row of its own, with no click of the row's.
        <div className="dt-card-detail" onClick={(event) => event.stopPropagation()}>
          {renderDetail(row.original)}
        </div>
      ) : null}
    </div>
  )
}

/** A cell of a column with a value of its own (an accessor) that holds nothing; a display column is never blank. */
function isBlank<TData extends RowData>(cell: AnyCell<TData>): boolean {
  return cell.column.accessorFn !== undefined && isBlankCardValue(cell.getValue())
}
