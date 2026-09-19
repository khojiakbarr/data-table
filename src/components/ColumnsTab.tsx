import type { Column, RowData } from "@tanstack/react-table"
import { useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import { columnLabel } from "../core/columnLabel"
import { dropRegionOf } from "../core/dropRegion"
import { renderedLeafColumns } from "../core/pinning"
import { reachableRange, type DropSide } from "../core/reorder"
import { useDropSlot } from "../core/useDropSlot"
import { useIsomorphicLayoutEffect } from "../core/useIsomorphicLayoutEffect"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

/**
 * What is shown, and in what order.
 *
 * Columns are listed in the order they appear in the table and dragged into a
 * new order by their handle — with a pointer, or from the keyboard, which is
 * the only reordering path a user who cannot drag has. Pinning lives in the
 * header's context menu, where it sits next to the other per-column actions
 * instead of as a pair of arrow buttons whose direction has to be decoded.
 */

export interface ColumnsTabProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
}

/**
 * The side panel's Columns half.
 *
 * @param props - See {@link ColumnsTabProps}.
 * @returns The head, with Show all and Reset, and the list of columns.
 */
export function ColumnsTab<TData extends RowData>({
  instance,
  labels,
  onReorder,
}: ColumnsTabProps<TData>) {
  const { table, flags, resetLayout, isCustomised, filtering } = instance

  /*
   * Listed in render order, not `getAllLeafColumns()` order — the latter puts
   * pinned columns first, so the panel would disagree with the table about
   * where a column is, and dragging inside it would move the wrong one.
   */
  const columns = renderedLeafColumns(table)
  const drop = useDropSlot(columns.map((column) => column.id))
  const [announcement, setAnnouncement] = useState("")
  const listRef = useRef<HTMLUListElement>(null)
  /*
   * A committed keyboard move reorders the list, and React moves the `<li>`
   * by re-inserting it — which blurs whatever was focused inside it. Without
   * this the handle a user just pressed Space on would drop them at the top
   * of the document (WCAG 2.4.3), so the id is recorded here and the focus
   * put back one commit later, when the row is at its new place.
   */
  const restoreFocusRef = useRef<string | null>(null)

  useIsomorphicLayoutEffect(() => {
    const columnId = restoreFocusRef.current
    if (columnId === null) return
    restoreFocusRef.current = null
    /*
     * Walked rather than selected by `[data-column-id="…"]`: a column id is
     * whatever the host's accessor produced, and a quote or a bracket in one
     * would make that selector throw.
     */
    for (const item of listRef.current?.querySelectorAll("li[data-column-id]") ?? []) {
      if (item.getAttribute("data-column-id") !== columnId) continue
      item.querySelector<HTMLElement>(".dt-drag-handle")?.focus()
      return
    }
  })

  /** Whether a drop on `targetId` would actually be carried out. */
  const canDropOn = (targetId: string): boolean => {
    const dragged = columns.find((column) => column.id === drop.draggedId)
    const target = columns.find((column) => column.id === targetId)
    return (
      dragged !== undefined && target !== undefined && dropRegionOf(dragged) === dropRegionOf(target)
    )
  }

  /** Which edge of a list row the pointer is nearest. A list runs vertically. */
  const sideWithin = (event: DragEvent<HTMLElement>): DropSide => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY - rect.top > rect.height / 2 ? "end" : "start"
  }

  const handleDragOver = (event: DragEvent<HTMLElement>, id: string) => {
    if (!flags.reordering || !canDropOn(id)) return
    event.preventDefault()
    drop.over(id, sideWithin(event))
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>, id: string) => {
    // `dragleave` bubbles from the checkbox and the label too; only a pointer
    // that has really left the row takes the slot away. See HeaderCell.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    drop.leave(id)
  }

  const handleDrop = (event: DragEvent<HTMLElement>, id: string) => {
    event.preventDefault()
    const draggedId = event.dataTransfer.getData("text/plain")
    const side = sideWithin(event)
    drop.end()
    if (draggedId && draggedId !== id) onReorder(draggedId, id, side)
  }

  /**
   * Say where the held column now sits, for a screen reader to read politely.
   *
   * The column is passed in rather than looked up at `index`: the position is
   * the SLOT's, and the column standing there is the one being displaced, not
   * the one the user is holding.
   */
  const announce = (held: Column<DataTableFeatures, TData, unknown>, index: number) => {
    setAnnouncement(
      labels.reorderPosition(
        columnLabel(held.id, held.columnDef.header),
        index + 1,
        columns.length,
      ),
    )
  }

  /**
   * Space picks the column up and puts it down; the arrows move the slot
   * between; Escape gives up. The same slot the pointer draws follows along,
   * so the keyboard path is the feature rather than a lesser version of it.
   */
  const handleGripKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const column = columns[index]
    if (!column) return
    const held = drop.isKeyboardGrab && drop.draggedId === column.id

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault()
      if (!held) {
        drop.start(column.id, { keyboard: true })
        announce(column, index)
        return
      }
      const move = drop.resolve()
      // Announced from the slot's index, which is where the column is about to
      // be: the list has not re-rendered yet, and after it does this row's own
      // index is no longer the one the user asked for.
      const landedAt = drop.slotIndex
      drop.end()
      if (move) {
        restoreFocusRef.current = move.draggedId
        onReorder(move.draggedId, move.targetId, move.side)
      }
      announce(column, landedAt)
      return
    }

    if (!held) return

    if (event.key === "Escape") {
      event.preventDefault()
      /*
       * The panel closes on Escape from a listener on `document`. Cancelling a
       * grab and dismissing the whole panel with the same key would make the
       * cancel unusable, so while a column is held this Escape is spent here
       * and does not reach it.
       */
      event.stopPropagation()
      drop.end()
      // Back where it started, and said out loud — a silent cancel leaves a
      // screen-reader user believing the last announced position took effect.
      announce(column, index)
      return
    }

    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0
    if (step === 0) return
    event.preventDefault()
    const { first, last } = reachableRange(columns.map(dropRegionOf), index)
    const next = Math.min(Math.max(drop.slotIndex + step, first), last)
    if (next === drop.slotIndex) return
    drop.moveTo(next)
    announce(column, next)
  }

  const handleReset = () => {
    /*
     * This Reset is about columns. `resetLayout` restores every slice, filters
     * and search included (§7.2), so the filter model is taken before it and
     * put back after — both updates land in one commit, and clearing filters
     * stays the Filters tab's own action.
     */
    const model = filtering.getModel()
    resetLayout()
    filtering.setModel(model)
  }

  return (
    <>
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
          <button type="button" className="dt-link" onClick={handleReset}>
            {labels.reset}
          </button>
        ) : null}
      </div>

      <ul className="dt-panel-list" ref={listRef}>
        {columns.map((column, index) => {
          const name = columnLabel(column.id, column.columnDef.header)
          const held = drop.isKeyboardGrab && drop.draggedId === column.id
          const className = [
            "dt-panel-item",
            drop.draggedId === column.id ? "dt-panel-dragging" : "",
            drop.slotId === column.id ? "dt-drop-slot" : "",
          ]
            .filter(Boolean)
            .join(" ")

          return (
            <li
              key={column.id}
              className={className}
              data-column-id={column.id}
              onDragOver={(event) => handleDragOver(event, column.id)}
              onDragLeave={(event) => handleDragLeave(event, column.id)}
              onDrop={(event) => handleDrop(event, column.id)}
            >
              {flags.reordering ? (
                <span
                  className="dt-drag-handle"
                  draggable
                  role="button"
                  /*
                   * In the Tab order, unlike the decorative grip it used to
                   * be: this is the whole keyboard route to reordering, and
                   * the instructions ride on the label because there is
                   * nowhere else a screen reader would find them in time.
                   */
                  tabIndex={0}
                  aria-pressed={held}
                  aria-label={`${name}: ${labels.dragHint}. ${labels.reorderHint}`}
                  title={labels.dragHint}
                  onKeyDown={(event) => handleGripKeyDown(event, index)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move"
                    event.dataTransfer.setData("text/plain", column.id)
                    drop.start(column.id)
                  }}
                  onDragEnd={drop.end}
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
                {name}
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

      {/*
        The slot itself is decorative and hidden from assistive technology; the
        meaning travels here instead, politely, so a keyboard move is not a
        silent one.
      */}
      <span className="dt-sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
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
