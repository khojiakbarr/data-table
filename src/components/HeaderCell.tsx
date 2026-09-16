import type { Header, RowData } from "@tanstack/react-table"
import { flexRender } from "@tanstack/react-table"
import {
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type TouchEvent,
} from "react"
import type { DataTableFeatures } from "../useDataTable"
import type { DataTableFeatureFlags, DataTableLabels } from "../types"
import { classNames } from "../core/classNames"
import { headerPinning, leafColumnsOf } from "../core/pinning"
import { dropSideAt, type DropSide } from "../core/reorder"
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
  /** Open the per-column action menu at a viewport position. */
  onOpenMenu: (at: { x: number; y: number }) => void
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
  /** Fit a leaf column to its content. A group's handle fits each of its leaves. */
  onAutosize: (columnId: string) => void
}

export function HeaderCell<TData extends RowData>({
  header,
  flags,
  labels,
  sticky,
  onReorder,
  onOpenMenu,
  onAutosize,
}: HeaderCellProps<TData>) {
  const { column } = header
  const [dropSide, setDropSide] = useState<DropSide | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  /**
   * A group header spans several leaf columns. Sorting and reordering act on
   * a single column, so neither applies here. Resizing does: TanStack's
   * handler snapshots every leaf under the header and scales each by the same
   * percentage, which is how AG Grid treats a group's edge too.
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
  const canDrag = flags.reordering && !isGroup && !pinned
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
    setIsDragging(true)
  }

  const handleDragOver = (event: DragEvent<HTMLTableCellElement>) => {
    if (!canDrag) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    // State here drives the caret only; the drop reads the event again.
    setDropSide(dropSideAt(event.clientX, event.currentTarget.getBoundingClientRect()))
  }

  const handleDrop = (event: DragEvent<HTMLTableCellElement>) => {
    event.preventDefault()
    const draggedId = event.dataTransfer.getData("text/plain")
    const side = dropSideAt(event.clientX, event.currentTarget.getBoundingClientRect())
    setDropSide(null)
    if (draggedId && draggedId !== column.id) onReorder(draggedId, column.id, side)
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
    dropSide === "start" && "dt-drop-start",
    dropSide === "end" && "dt-drop-end",
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
  const columnName =
    typeof column.columnDef.header === "string" && column.columnDef.header.length > 0
      ? column.columnDef.header
      : String(column.id)

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
      onDragEnd={() => {
        setIsDragging(false)
        setDropSide(null)
      }}
      onDragOver={handleDragOver}
      onDragLeave={() => setDropSide(null)}
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
