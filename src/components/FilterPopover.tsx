import type { Column, RowData } from "@tanstack/react-table"
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { columnLabel } from "../core/columnLabel"
import { useClampedPlacement, type ClampedPoint } from "../core/useClampedPlacement"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { FilterEditor } from "./FilterEditor"

/**
 * One column's filter editor, floating over the table.
 *
 * Opened by the header menu's "Filter…" item — never rendered *inside* that
 * menu, which is a real `role="menu"`: form controls under it are invalid
 * ARIA, the menu closes on any item click, and its own clamp measures once per
 * open and cannot correct a menu that grows afterwards.
 *
 * Rendered as a direct child of `.dt-root`, so `.dt-root:has(> .dt-filter-popover)`
 * can lift the whole table above whatever follows it on the page.
 */

/** Anything the popover can trap the Tab key between. */
const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled])"

export interface FilterPopoverProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  column: Column<DataTableFeatures, TData, unknown>
  /** Where the menu was, in viewport pixels. Stable, or the clamp re-measures. */
  position: ClampedPoint
  labels: DataTableLabels
  /** Closes the popover. The draft is discarded, never committed, on the way out. */
  onClose: () => void
  /**
   * How the popover measures itself; defaults to its own bounding rect.
   *
   * Injectable for the same reason {@link useClampedPlacement} takes one: in
   * jsdom every rect is zeros, so a re-clamp cannot otherwise be observed.
   */
  measure?: (() => DOMRect) | undefined
}

/**
 * One column's filter editor in a floating panel.
 *
 * @param props - See {@link FilterPopoverProps}.
 * @returns The popover element, positioned and clamped to the viewport.
 *
 * @example
 * {filterAt ? (
 *   <FilterPopover
 *     instance={instance}
 *     column={table.getColumn(filterAt.columnId)!}
 *     position={filterAt.at}
 *     labels={labels}
 *     onClose={closeFilter}
 *   />
 * ) : null}
 */
export function FilterPopover<TData extends RowData>({
  instance,
  column,
  position,
  labels,
  onClose,
  measure,
}: FilterPopoverProps<TData>) {
  const ref = useRef<HTMLDivElement>(null)
  const placement = useClampedPlacement(ref, position, measure)

  // Close on outside click and on Escape, the two things a user will try —
  // the same pair the menu and the panel handle.
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
   * Tab stays inside. A popover the keyboard can walk out of leaves the user
   * in the table behind it with no way back and an editor still open over the
   * rows they are reading.
   */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return
    const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (first === undefined || last === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
      return
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="dt-filter-popover"
      ref={ref}
      role="dialog"
      aria-label={labels.filterTitle(columnLabel(column.id, column.columnDef.header))}
      style={{ left: placement.x, top: placement.y }}
      onKeyDown={handleKeyDown}
    >
      <FilterEditor
        instance={instance}
        column={column}
        labels={labels}
        onCommit={onClose}
        autoFocus
      />
    </div>
  )
}
