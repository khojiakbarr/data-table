import type { Header, RowData } from "@tanstack/react-table"
import { flexRender } from "@tanstack/react-table"
import { useState, type CSSProperties, type DragEvent } from "react"
import type { DataTableFeatures } from "../useDataTable"
import type { DataTableFeatureFlags, DataTableLabels } from "../types"
import { pinnedStyle } from "../core/pinning"
import { dropSideAt, type DropSide } from "../core/reorder"

/**
 * One header cell: the sort control, the drag target for reordering, and the
 * resize handle, on top of the sticky positioning a pinned column needs.
 *
 * These three interactions share an element and must not trigger each other.
 * The resize handle stops propagation so dragging it never starts a column
 * drag, and `draggable` is switched off for the duration of a resize so the
 * browser's drag machinery stays out of the way.
 */

interface HeaderCellProps<TData extends RowData> {
  header: Header<DataTableFeatures, TData, unknown>
  flags: Required<DataTableFeatureFlags>
  labels: DataTableLabels
  /** Keep the header in view while the body scrolls. */
  sticky: boolean
  /** Open the per-column action menu at a viewport position. */
  onOpenMenu: (at: { x: number; y: number }) => void
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
}

export function HeaderCell<TData extends RowData>({
  header,
  flags,
  labels,
  sticky,
  onReorder,
  onOpenMenu,
}: HeaderCellProps<TData>) {
  const { column } = header
  const [dropSide, setDropSide] = useState<DropSide | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  /**
   * A group header spans several leaf columns. Sorting, resizing and reordering
   * all act on a single column, so none of them apply here — a group's width is
   * the sum of its children's.
   *
   * The test is on the COLUMN, not on `header.subHeaders`: a leaf column that
   * sits above its natural depth is rendered by a spanning placeholder header,
   * and that header reports a sub-header while still standing for one ordinary
   * sortable column.
   */
  const isGroup = column.columns.length > 0

  const pinned = column.getIsPinned()
  const canSort = flags.sorting && !isGroup && column.getCanSort()
  const canResize = flags.resizing && !isGroup && column.getCanResize()
  const canDrag = flags.reordering && !isGroup && !column.getIsPinned()
  const isResizing = column.getIsResizing()
  const sorted = column.getIsSorted()

  const ariaSort: "ascending" | "descending" | "none" =
    sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"

  const handleDragStart = (event: DragEvent<HTMLTableCellElement>) => {
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

  const className = [
    "dt-th",
    isGroup ? "dt-th-group" : "",
    pinned ? "dt-pinned" : "",
    pinnedEdgeClass(header),
    isResizing ? "dt-resizing" : "",
    canDrag ? "dt-draggable" : "",
    isDragging ? "dt-dragging" : "",
    dropSide === "start" ? "dt-drop-start" : "",
    dropSide === "end" ? "dt-drop-end" : "",
  ]
    .filter(Boolean)
    .join(" ")

  /**
   * No width here: column widths come from the <colgroup>, which is the only
   * thing `table-layout: fixed` consults. Setting a width on a spanning header
   * would be ignored at best and fight the colgroup at worst.
   */
  const style: CSSProperties = {
    ...(sticky
      ? { top: `calc(var(--dt-header-height) * ${header.depth - 1})` }
      : {}),
    ...pinnedStyle(column),
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
      title={canDrag ? labels.dragHint : undefined}
    >
      <div className="dt-th-inner">
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
          aria-label={`${columnName}: ${labels.columnActions}`}
          aria-haspopup="menu"
          onClick={(event) => {
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            onOpenMenu({ x: rect.left, y: rect.bottom + 2 })
          }}
          onDragStart={(event) => event.preventDefault()}
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
          aria-label={`${columnName}: ${labels.resizeColumn}`}
          onMouseDown={(event) => {
            event.stopPropagation()
            header.getResizeHandler()(event)
          }}
          onTouchStart={(event) => {
            event.stopPropagation()
            header.getResizeHandler()(event)
          }}
          onDragStart={(event) => event.preventDefault()}
          onDoubleClick={() => column.resetSize()}
        />
      ) : null}
    </th>
  )
}

/** Only the inner edge of a pinned group casts a shadow over scrolling cells. */
function pinnedEdgeClass<TData extends RowData>(
  header: Header<DataTableFeatures, TData, unknown>,
): string {
  const pinned = header.column.getIsPinned()
  if (!pinned) return ""
  const group = header.column.table.getPinnedLeafColumns(pinned)
  const index = header.column.getPinnedIndex()
  if (pinned === "start") return index === group.length - 1 ? "dt-pinned-start-last" : ""
  return index === 0 ? "dt-pinned-end-first" : ""
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
