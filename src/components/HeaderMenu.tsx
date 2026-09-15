import type { Column, RowData } from "@tanstack/react-table"
import { useEffect, useRef } from "react"
import type { DataTableFeatures } from "../useDataTable"
import type { DataTableFeatureFlags, DataTableLabels } from "../types"

/**
 * Per-column actions, opened by right-clicking a header or from its ⋮ button.
 *
 * Everything that acts on one column lives here — sorting, pinning, width,
 * visibility — so the Columns panel can stay a plain list of what is shown and
 * in what order.
 */

export interface HeaderMenuPosition {
  x: number
  y: number
}

interface HeaderMenuProps<TData extends RowData> {
  column: Column<DataTableFeatures, TData, unknown>
  position: HeaderMenuPosition
  flags: Required<DataTableFeatureFlags>
  labels: DataTableLabels
  onAutosize: () => void
  onAutosizeAll: () => void
  onClose: () => void
}

export function HeaderMenu<TData extends RowData>({
  column,
  position,
  flags,
  labels,
  onAutosize,
  onAutosizeAll,
  onClose,
}: HeaderMenuProps<TData>) {
  const ref = useRef<HTMLDivElement>(null)

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

  // Focus the first item so the menu is usable from the keyboard.
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus()
  }, [])

  const run = (action: () => void) => () => {
    action()
    onClose()
  }

  const sorted = column.getIsSorted()
  const pinned = column.getIsPinned()

  return (
    <div
      className="dt-menu"
      ref={ref}
      role="menu"
      aria-label={labels.columnActions}
      style={{ left: position.x, top: position.y }}
    >
      {flags.sorting && column.getCanSort() ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="dt-menu-item"
            aria-current={sorted === "asc"}
            onClick={run(() => column.toggleSorting(false))}
          >
            {labels.sortAscending}
          </button>
          <button
            type="button"
            role="menuitem"
            className="dt-menu-item"
            aria-current={sorted === "desc"}
            onClick={run(() => column.toggleSorting(true))}
          >
            {labels.sortDescending}
          </button>
          {sorted ? (
            <button
              type="button"
              role="menuitem"
              className="dt-menu-item"
              onClick={run(() => column.clearSorting())}
            >
              {labels.clearSort}
            </button>
          ) : null}
          <hr className="dt-menu-sep" />
        </>
      ) : null}

      {flags.pinning && column.getCanPin() ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="dt-menu-item"
            aria-current={pinned === "start"}
            onClick={run(() => column.pin(pinned === "start" ? false : "start"))}
          >
            {labels.pinStart}
          </button>
          <button
            type="button"
            role="menuitem"
            className="dt-menu-item"
            aria-current={pinned === "end"}
            onClick={run(() => column.pin(pinned === "end" ? false : "end"))}
          >
            {labels.pinEnd}
          </button>
          {pinned ? (
            <button
              type="button"
              role="menuitem"
              className="dt-menu-item"
              onClick={run(() => column.pin(false))}
            >
              {labels.unpin}
            </button>
          ) : null}
          <hr className="dt-menu-sep" />
        </>
      ) : null}

      {flags.resizing && column.getCanResize() ? (
        <>
          <button type="button" role="menuitem" className="dt-menu-item" onClick={run(onAutosize)}>
            {labels.autosize}
          </button>
          <button
            type="button"
            role="menuitem"
            className="dt-menu-item"
            onClick={run(onAutosizeAll)}
          >
            {labels.autosizeAll}
          </button>
          <button
            type="button"
            role="menuitem"
            className="dt-menu-item"
            onClick={run(() => column.resetSize())}
          >
            {labels.resetWidth}
          </button>
          <hr className="dt-menu-sep" />
        </>
      ) : null}

      {flags.hiding && column.getCanHide() ? (
        <button
          type="button"
          role="menuitem"
          className="dt-menu-item"
          onClick={run(() => column.toggleVisibility(false))}
        >
          {labels.hide}
        </button>
      ) : null}
    </div>
  )
}
