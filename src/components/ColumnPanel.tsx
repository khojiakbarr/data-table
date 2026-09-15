import type { RowData } from "@tanstack/react-table"
import { useEffect, useRef } from "react"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

/**
 * The panel behind the "Columns" button: show, hide, pin and reset.
 *
 * Reordering happens by dragging headers; this panel deliberately does not
 * duplicate it. Two ways to do one thing in one screen is how a control surface
 * starts to feel arbitrary.
 */

interface ColumnPanelProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  onClose: () => void
}

export function ColumnPanel<TData extends RowData>({
  instance,
  labels,
  onClose,
}: ColumnPanelProps<TData>) {
  const { table, flags, resetLayout, isCustomised } = instance
  const ref = useRef<HTMLDivElement>(null)

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

  const columns = table.getAllLeafColumns()

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

      {columns.map((column) => {
        const pinned = column.getIsPinned()
        return (
          <div key={column.id} className="dt-panel-item">
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

            {flags.pinning && column.getCanPin() ? (
              <span className="dt-pin-group">
                <button
                  type="button"
                  className="dt-pin-toggle"
                  aria-pressed={pinned === "start"}
                  title={pinned === "start" ? labels.unpin : labels.pinStart}
                  onClick={() => column.pin(pinned === "start" ? false : "start")}
                >
                  ⇤
                </button>
                <button
                  type="button"
                  className="dt-pin-toggle"
                  aria-pressed={pinned === "end"}
                  title={pinned === "end" ? labels.unpin : labels.pinEnd}
                  onClick={() => column.pin(pinned === "end" ? false : "end")}
                >
                  ⇥
                </button>
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** Header definitions can be strings or render functions; only strings label well. */
function columnLabel(id: string, header: unknown): string {
  return typeof header === "string" && header.length > 0 ? header : id
}
