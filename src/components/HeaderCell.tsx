import type { Header, RowData } from "@tanstack/react-table"
import { flexRender } from "@tanstack/react-table"
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type TouchEvent,
} from "react"
import type { DataTableFeatures } from "../useDataTable"
import type { DataTableFeatureFlags, DataTableLabels } from "../types"
import { classNames } from "../core/classNames"
import { columnLabel } from "../core/columnLabel"
import { dropRegionOf, isMovableRegion } from "../core/dropRegion"
import { headerPinning, leafColumnsOf } from "../core/pinning"
import { dropSideAt, type DropSide } from "../core/reorder"
import type { DropSlot } from "../core/useDropSlot"
import { clampColumnWidth } from "../core/sizing"

/**
 * One header cell: the sort control, the drag target for reordering, and the
 * resize handle, on top of the sticky positioning a pinned column needs.
 *
 * These three interactions share an element and must not trigger each other.
 * The resize handle cancels the mousedown default so the browser never starts
 * a native drag of the header underneath it, `draggable` is switched off for
 * the duration of a resize, and a drag that does start from one of the
 * buttons is refused at `dragstart` — which fires on the draggable `<th>`,
 * never on the button itself.
 */

/** Keyboard resize: one arrow press, and one with Shift held. */
const KEY_STEP_PX = 10
const KEY_COARSE_STEP_PX = 50

interface HeaderCellProps<TData extends RowData> {
  header: Header<DataTableFeatures, TData, unknown>
  flags: Required<DataTableFeatureFlags>
  labels: DataTableLabels
  /** Keep the header in view while the body scrolls. */
  sticky: boolean
  /**
   * Whether the rows are grouped by this column.
   *
   * A mark in the header rather than a control, like the filter and sort
   * indicators beside it: the column's values have left the body and the user
   * should be able to see which column they went to without opening a panel.
   */
  grouped?: boolean
  /**
   * Which column holds the group values, when the table is grouped.
   *
   * Needed for the drag, not for the paint: the group column leads its section
   * because the grouping put it there, so it is the one column a drag must
   * neither pick up nor drop onto. `dropRegionOf` is where that is decided,
   * once, for both surfaces.
   */
  groupColumnId?: string | undefined
  /** Open the per-column action menu at a viewport position. */
  onOpenMenu: (at: { x: number; y: number }) => void
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
  /**
   * The drag shared by every header cell.
   *
   * It cannot live in this component: the slot is drawn on the column that
   * stands at the DESTINATION, which is almost never the cell the pointer is
   * over, so no cell can decide on its own whether it is wearing the slot.
   */
  drop: DropSlot
  /** Fit a leaf column to its content. A group's handle fits each of its leaves. */
  onAutosize: (columnId: string) => void
}

export function HeaderCell<TData extends RowData>({
  header,
  flags,
  labels,
  sticky,
  grouped = false,
  groupColumnId,
  onReorder,
  onOpenMenu,
  onAutosize,
  drop,
}: HeaderCellProps<TData>) {
  const { column } = header
  const isDragging = drop.draggedId === column.id
  const isDropSlot = drop.slotId === column.id

  /**
   * A group header spans several leaf columns. Sorting acts on a single
   * column, so it does not apply here. Resizing does: TanStack's handler
   * snapshots every leaf under the header and scales each by the same
   * percentage, which is how AG Grid treats a group's edge too. So does
   * reordering, which moves the group's whole run of leaves — see `moveRun`.
   *
   * The test is on the COLUMN, not on `header.subHeaders`: a leaf column that
   * sits above its natural depth is rendered by a spanning placeholder header,
   * and that header reports a sub-header while still standing for one ordinary
   * sortable column.
   */
  const isGroup = column.columns.length > 0

  const pinning = headerPinning(header)
  const pinned = pinning.side
  const canSort = flags.sorting && !isGroup && column.getCanSort()
  const canResize = flags.resizing && column.getCanResize()
  /*
   * A group is picked up exactly as a leaf is, and refused for exactly the
   * same reasons: `dropRegionOf` says which columns it could ever swap with,
   * and a column alone in its region — the group column, a group split across
   * a pinning boundary — is not offered at all. Saying it with the region
   * rather than with a list of exceptions is what keeps the affordance and the
   * drop from disagreeing.
   */
  const region = dropRegionOf(column, groupColumnId)
  const canDrag = flags.reordering && !pinned && isMovableRegion(region)
  const isResizing = column.getIsResizing()
  const sorted = column.getIsSorted()

  const ariaSort: "ascending" | "descending" | "none" =
    sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"

  const handleDragStart = (event: DragEvent<HTMLTableCellElement>) => {
    // `dragstart` is dispatched at the draggable ancestor, so this is the only
    // place a drag that began on the kebab or the resize handle can be refused.
    if ((event.target as HTMLElement).closest(".dt-resizer, .dt-kebab")) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", column.id)
    // `getData` is unreadable during `dragover` in every browser's protected
    // drag mode, so who is moving has to be remembered here or the slot could
    // never be resolved until the drop.
    drop.start(column.id)
  }

  /**
   * Whether a drop on this cell would really be carried out.
   *
   * A pinned column and the filler are not drop targets at all — that is
   * `canDrag`. But a header that IS one can still be out of the dragged
   * column's reach: the shell refuses a move across a group or a pinning
   * boundary, and a group and the leaves inside it are never in one region, so
   * the two have to share a region as well. Both questions belong here,
   * because a cell that refuses draws no slot, and a slot on a cell the drop
   * would ignore promises a move that never happens.
   */
  const canDropHere = (): boolean => {
    if (!canDrag || drop.draggedId === null) return false
    const dragged = column.table.getColumn(drop.draggedId)
    return dragged !== undefined && dropRegionOf(dragged, groupColumnId) === region
  }

  const handleDragOver = (event: DragEvent<HTMLTableCellElement>) => {
    /*
     * Refusing here is what keeps the slot honest: with no `preventDefault`
     * the browser will not drop, and with no `over` the slot does not appear
     * somewhere the drop would ignore. The cell just left has already cleared
     * it, so the slot simply goes away over these.
     */
    if (!canDropHere()) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    // State here drives the slot only; the drop reads the event again.
    drop.over(column.id, dropSideAt(event.clientX, event.currentTarget.getBoundingClientRect()))
  }

  const handleDrop = (event: DragEvent<HTMLTableCellElement>) => {
    event.preventDefault()
    const draggedId = event.dataTransfer.getData("text/plain")
    const side = dropSideAt(event.clientX, event.currentTarget.getBoundingClientRect())
    drop.end()
    // The same (target, side) the slot was resolved from, so the column lands
    // in the slot the user was looking at — see `dropSlotId`.
    if (draggedId && draggedId !== column.id) onReorder(draggedId, column.id, side)
  }

  const handleDragLeave = (event: DragEvent<HTMLTableCellElement>) => {
    /*
     * `dragleave` bubbles from descendants, so crossing from the label to the
     * resize handle fires one without the pointer having left the cell at all.
     * Acting on those would blink the slot — and replay its opening animation
     * — several times per column. `relatedTarget` is the element being
     * entered; when it is inside this cell, nothing has been left.
     */
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    drop.leave(column.id)
  }

  const startResize = (event: MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    // The owning document, so a table in a popped-out window resizes there.
    header.getResizeHandler(event.currentTarget.ownerDocument)(event)
  }

  const handleResizerMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    // Only the primary button resizes. Its default action — focusing the
    // button, starting a text selection or a native drag of the header — is
    // unwanted in every case.
    if (event.button !== 0) return
    event.preventDefault()
    startResize(event)
  }

  /** Fit this column, or every leaf of this group, to its content. */
  const fit = () => leafColumnsOf(header).forEach((leaf) => onAutosize(leaf.id))

  const handleResizerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      fit()
      return
    }
    if (isGroup) return
    // "Outward" is the direction the handle sits on: right in LTR, left in RTL.
    const rtl = column.table.options.columnResizeDirection === "rtl"
    const outward = rtl ? "ArrowLeft" : "ArrowRight"
    const inward = rtl ? "ArrowRight" : "ArrowLeft"
    const step = event.shiftKey ? KEY_COARSE_STEP_PX : KEY_STEP_PX
    const delta = event.key === outward ? step : event.key === inward ? -step : 0
    if (delta === 0) return
    event.preventDefault()
    const width = clampColumnWidth(column, column.getSize() + delta)
    column.table.setColumnSizing((previous) => ({ ...previous, [column.id]: width }))
  }

  const className = classNames(
    "dt-th",
    isGroup && "dt-th-group",
    pinned && "dt-pinned",
    pinning.isInnerEdge && (pinned === "start" ? "dt-pinned-start-last" : "dt-pinned-end-first"),
    isResizing && "dt-resizing",
    canDrag && "dt-draggable",
    isDragging && "dt-dragging",
    isDropSlot && "dt-drop-slot",
  )

  /**
   * No width here: column widths come from the <colgroup>, which is the only
   * thing `table-layout: fixed` consults. Setting a width on a spanning header
   * would be ignored at best and fight the colgroup at worst.
   */
  const style: CSSProperties = {
    ...(sticky
      ? { top: `calc(var(--dt-header-height) * ${header.depth - 1})` }
      : {}),
    ...pinning.style,
  }

  const label = flexRender(column.columnDef.header, header.getContext())
  const columnName = columnLabel(column.id, column.columnDef.header)

  return (
    <th
      colSpan={header.colSpan}
      rowSpan={header.rowSpan > 1 ? header.rowSpan : undefined}
      className={className}
      style={style}
      data-column-id={column.id}
      aria-sort={canSort ? ariaSort : undefined}
      draggable={canDrag && !isResizing}
      onDragStart={canDrag ? handleDragStart : undefined}
      /*
       * Every way a drag can end arrives here: a drop, Escape, and the pointer
       * released outside the window all fire `dragend` on the source. The slot
       * must not survive any of them.
       */
      onDragEnd={drop.end}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={
        isGroup
          ? undefined
          : (event) => {
              event.preventDefault()
              onOpenMenu({ x: event.clientX, y: event.clientY })
            }
      }
    >
      {/* The tooltip lives on the label area so the buttons keep their own. */}
      <div className="dt-th-inner" title={canDrag ? labels.dragHint : undefined}>
        {canSort ? (
          <button
            type="button"
            className="dt-sortable"
            onClick={column.getToggleSortingHandler()}
            aria-label={`${columnName}: ${sortActionLabel(sorted, labels)}`}
          >
            <span className="dt-th-label">{label}</span>
            <SortIcon direction={sorted} />
            {column.getSortIndex() > -1 ? (
              <span className="dt-sort-index">{column.getSortIndex() + 1}</span>
            ) : null}
          </button>
        ) : (
          <span className="dt-th-label">{label}</span>
        )}

        {/*
          The same vocabulary as the sort indicator: a mark in the header, not
          a second control. A filtered column that is hidden has no header to
          carry this, which is why the Filters tab lists hidden columns too.
        */}
        {column.getIsFiltered() ? (
          <span
            className="dt-filtered"
            role="img"
            aria-label={labels.filteredBadge}
            title={labels.filteredBadge}
          >
            <FilterIcon />
          </span>
        ) : null}

        {grouped ? (
          <span
            className="dt-grouped"
            role="img"
            aria-label={labels.groupedBadge}
            title={labels.groupedBadge}
          >
            <GroupIcon />
          </span>
        ) : null}
      </div>

      {isGroup ? null : (
        <button
          type="button"
          className="dt-kebab"
          title={labels.columnActions}
          aria-label={`${columnName}: ${labels.columnActions}`}
          aria-haspopup="menu"
          onClick={(event) => {
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            onOpenMenu({ x: rect.left, y: rect.bottom + 2 })
          }}
        >
          <svg width="3" height="13" viewBox="0 0 3 13" aria-hidden="true" fill="currentColor">
            <circle cx="1.5" cy="2" r="1.3" />
            <circle cx="1.5" cy="6.5" r="1.3" />
            <circle cx="1.5" cy="11" r="1.3" />
          </svg>
        </button>
      )}

      {canResize ? (
        <button
          type="button"
          className="dt-resizer"
          title={labels.resizeColumn}
          aria-label={`${columnName}: ${labels.resizeColumn}`}
          onMouseDown={handleResizerMouseDown}
          onTouchStart={startResize}
          onDoubleClick={fit}
          onKeyDown={handleResizerKeyDown}
        />
      ) : null}
    </th>
  )
}

function sortActionLabel(
  sorted: false | "asc" | "desc",
  labels: DataTableLabels,
): string {
  if (sorted === "asc") return labels.sortDescending
  if (sorted === "desc") return labels.clearSort
  return labels.sortAscending
}

function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  return (
    <svg
      className="dt-sort-icon"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction !== "desc" ? <path d="M3 5 L6 2 L9 5" /> : null}
      {direction !== "asc" ? <path d="M3 7 L6 10 L9 7" /> : null}
    </svg>
  )
}

/** Three stacked bars, indented: rows gathered under a heading. */
function GroupIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M1.5 2.5 h9" />
      <path d="M4 6 h6.5" />
      <path d="M4 9.5 h6.5" />
    </svg>
  )
}

function FilterIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.5 2.5 h9 l-3.4 4 v3.2 l-2.2 1.3 v-4.5 z" />
    </svg>
  )
}
