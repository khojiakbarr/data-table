import type { RowData } from "@tanstack/react-table"
import { useEffect, useRef, useState, type DragEvent } from "react"
import { columnLabel } from "../core/columnLabel"
import { renderedLeafColumns } from "../core/pinning"
import type { DropSide } from "../core/reorder"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

/**
 * The panel behind the "Columns" button.
 *
 * Columns are listed in the order they appear in the table and dragged into a
 * new order by their handle. Pinning lives in the header's context menu, where
 * it sits next to the other per-column actions instead of as a pair of arrow
 * buttons whose direction has to be decoded.
 */

interface ColumnPanelProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
  onClose: () => void
}

export function ColumnPanel<TData extends RowData>({
  instance,
  labels,
  onReorder,
  onClose,
}: ColumnPanelProps<TData>) {
  const { table, flags, resetLayout, isCustomised } = instance
  const ref = useRef<HTMLDivElement>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; side: DropSide } | null>(null)

  // Close on outside click and on Escape, the two things a user will try.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [onClose])

  /*
   * Listed in render order, not `getAllLeafColumns()` order — the latter puts
   * pinned columns first, so the panel would disagree with the table about
   * where a column is, and dragging inside it would move the wrong one.
   */
  const columns = renderedLeafColumns(table)

  const handleDragOver = (event: DragEvent<HTMLElement>, id: string) => {
    if (!flags.reordering || !draggingId) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    // A list runs vertically: the midpoint that matters is the horizontal one.
    const side: DropSide =
      event.clientY - rect.top > rect.height / 2 ? "end" : "start"
    setDropTarget({ id, side })
  }

  const handleDrop = (event: DragEvent<HTMLElement>, id: string) => {
    event.preventDefault()
    const draggedId = event.dataTransfer.getData("text/plain")
    const rect = event.currentTarget.getBoundingClientRect()
    const side: DropSide = event.clientY - rect.top > rect.height / 2 ? "end" : "start"
    setDropTarget(null)
    setDraggingId(null)
    if (draggedId && draggedId !== id) onReorder(draggedId, id, side)
  }

  return (
    <div className="dt-panel" ref={ref} role="dialog" aria-label={labels.columnsTitle}>
      <div className="dt-panel-head">
        <span>{labels.columnsTitle}</span>
        <span className="dt-spacer" />
        <button
          type="button"
          className="dt-link"
          onClick={() => table.toggleAllColumnsVisible(true)}
        >
          {labels.showAll}
        </button>
        {isCustomised ? (
          <button type="button" className="dt-link" onClick={resetLayout}>
            {labels.reset}
          </button>
        ) : null}
      </div>

      <ul className="dt-panel-list">
        {columns.map((column) => {
          const isTarget = dropTarget?.id === column.id
          const className = [
            "dt-panel-item",
            draggingId === column.id ? "dt-panel-dragging" : "",
            isTarget && dropTarget.side === "start" ? "dt-panel-drop-before" : "",
            isTarget && dropTarget.side === "end" ? "dt-panel-drop-after" : "",
          ]
            .filter(Boolean)
            .join(" ")

          return (
            <li
              key={column.id}
              className={className}
              onDragOver={(event) => handleDragOver(event, column.id)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(event) => handleDrop(event, column.id)}
            >
              {flags.reordering ? (
                <span
                  className="dt-drag-handle"
                  draggable
                  role="button"
                  tabIndex={-1}
                  aria-label={`${columnLabel(column.id, column.columnDef.header)}: ${labels.dragHint}`}
                  title={labels.dragHint}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move"
                    event.dataTransfer.setData("text/plain", column.id)
                    setDraggingId(column.id)
                  }}
                  onDragEnd={() => {
                    setDraggingId(null)
                    setDropTarget(null)
                  }}
                >
                  <GripIcon />
                </span>
              ) : null}

              <input
                id={`${instance.id}-col-${column.id}`}
                type="checkbox"
                checked={column.getIsVisible()}
                disabled={!flags.hiding || !column.getCanHide()}
                onChange={column.getToggleVisibilityHandler()}
              />
              <label
                className="dt-panel-label"
                htmlFor={`${instance.id}-col-${column.id}`}
              >
                {columnLabel(column.id, column.columnDef.header)}
              </label>

              {column.getIsPinned() ? (
                <span className="dt-pin-badge">
                  {column.getIsPinned() === "start"
                    ? labels.pinnedStartBadge
                    : labels.pinnedEndBadge}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" fill="currentColor">
      {[2, 7, 12].map((y) =>
        [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />),
      )}
    </svg>
  )
}
