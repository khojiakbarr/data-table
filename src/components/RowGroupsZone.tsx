import type { RowData } from "@tanstack/react-table"
import { useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import { classNames } from "../core/classNames"
import { columnLabel } from "../core/columnLabel"
import { moveColumn, type DropSide } from "../core/reorder"
import { useDropSlot } from "../core/useDropSlot"
import { useIsomorphicLayoutEffect } from "../core/useIsomorphicLayoutEffect"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

/**
 * The Row Groups zone: what the grouping IS, and the place a column is dropped
 * to join it.
 *
 * One chip per level, outermost at the top, so the nesting is read down the
 * list rather than decoded from a row of pills. A chip is dragged to renest it
 * and removed by its own button; a column arrives by being dragged in from the
 * Columns tab or from its header, or sent in from the keyboard by the control
 * on its row in the Columns tab.
 *
 * The drop affordance is the one the columns already use — the chip standing
 * where the dragged column will land wears `.dt-drop-slot` — with one addition
 * a grouping needs and a reorder does not: when the destination is PAST the
 * last level, a ghost chip is minted for the incoming column so that there is
 * something standing there to wear it. Preview and outcome are one array,
 * resolved by {@link moveColumn} both times, so the slot cannot promise a
 * place the drop does not deliver.
 */

export interface RowGroupsZoneProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  /**
   * The column a drag started elsewhere is carrying — the Columns tab's list,
   * or a table header. Null or absent when nothing is in flight.
   *
   * It has to be told, rather than read from the drop: `dataTransfer.getData`
   * is unreadable during `dragover` in every browser's protected drag mode, so
   * a zone left to discover the column at drop time could never draw a slot.
   */
  incomingColumnId?: string | null | undefined
}

/**
 * The side panel's Row Groups zone.
 *
 * @param props - See {@link RowGroupsZoneProps}.
 * @returns The zone: a heading, the chips in nesting order, and — while
 *   nothing is grouped — a dashed area saying what it is for.
 *
 * @example
 * <RowGroupsZone instance={instance} labels={labels} incomingColumnId={drop.draggedId} />
 */
export function RowGroupsZone<TData extends RowData>({
  instance,
  labels,
  incomingColumnId,
}: RowGroupsZoneProps<TData>) {
  const { table, grouping } = instance
  const grouped = grouping.columns

  /*
   * The column a drag elsewhere is carrying, and — separately — whether it
   * needs a chip minting for it.
   *
   * The two are not the same question. A column dragged in from the Columns
   * tree may already BE a level: the tree still lists it and its handle is
   * still draggable, and dragging it here is a renest. It is taken up all the
   * same, so the slot appears for it; it just has a chip of its own already.
   */
  const carried = typeof incomingColumnId === "string" ? incomingColumnId : null
  const incoming = carried !== null && !grouped.includes(carried) ? carried : null

  /*
   * The order every slot and every drop is resolved against: the levels as
   * they stand, plus the incoming column at the end. Appending it is not a
   * guess about where it will land — it is where it lands if the user drops it
   * without pointing anywhere in particular, and `moveColumn` moves it from
   * there to wherever the slot is.
   */
  const order = incoming === null ? [...grouped] : [...grouped, incoming]
  const drop = useDropSlot(order)
  const [announcement, setAnnouncement] = useState("")
  const listRef = useRef<HTMLUListElement>(null)
  /*
   * A committed keyboard move reorders the chips, and React moves the `<li>`
   * by re-inserting it — which blurs whatever was focused inside it. The same
   * problem, and the same answer, as the Columns tab's list.
   */
  const restoreFocusRef = useRef<string | null>(null)

  useIsomorphicLayoutEffect(() => {
    const columnId = restoreFocusRef.current
    if (columnId === null) return
    restoreFocusRef.current = null
    // Walked rather than selected by attribute: a column id is whatever the
    // host's accessor produced, and a quote in one would make that selector
    // throw. Same reason as ColumnsTab.
    for (const item of listRef.current?.querySelectorAll("li.dt-group-chip") ?? []) {
      if (item.getAttribute("data-column-id") !== columnId) continue
      item.querySelector<HTMLElement>(".dt-drag-handle")?.focus()
      return
    }
  })

  const nameOf = (columnId: string): string => {
    const column = table.getColumn(columnId)
    return columnLabel(columnId, column?.columnDef.header)
  }

  /** Which edge of a chip the pointer is nearest. The chips run vertically. */
  const sideWithin = (event: DragEvent<HTMLElement>): DropSide => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY - rect.top > rect.height / 2 ? "end" : "start"
  }

  /**
   * Take up the incoming column, if the zone has not already.
   *
   * `start` writes the whole drag state and `over` merges into it, and a
   * functional update queued after a plain one sees the plain one's result —
   * so the two may be called back to back within one handler.
   */
  const takeUpIncoming = () => {
    if (carried !== null && drop.draggedId !== carried) drop.start(carried)
  }

  /**
   * Carry out the move the slot is promising.
   *
   * Resolved through {@link moveColumn} over the same `order` the slot was
   * drawn from, so "where the chip is" and "where the column lands" are one
   * computation. `grouping.add` moves a column that is already a level rather
   * than repeating it, which is what makes one path serve both a new column
   * and a renesting.
   */
  const commit = (draggedId: string, targetId: string, side: DropSide) => {
    const landed = moveColumn(order, draggedId, targetId, side).indexOf(draggedId)
    // Not in this order: a drop from somewhere the zone was never told about.
    // Refusing is the honest answer — no slot was drawn for it either.
    if (landed < 0) return
    grouping.add(draggedId, landed)
  }

  const handleDragOver = (event: DragEvent<HTMLElement>, targetId: string) => {
    // Only a column may land here. `event.preventDefault()` is what tells the
    // browser a drop is allowed, so withholding it refuses the drop outright
    // rather than accepting it and doing nothing.
    if (carried === null && drop.draggedId === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    takeUpIncoming()
    drop.over(targetId, sideWithin(event))
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>, targetId: string) => {
    // `dragleave` bubbles from the chip's own children too; only a pointer
    // that has really left the chip takes the slot away.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    drop.leave(targetId)
  }

  const handleDrop = (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault()
    const draggedId = event.dataTransfer.getData("text/plain") || drop.draggedId
    const side = sideWithin(event)
    drop.end()
    if (draggedId) commit(draggedId, targetId, side)
  }

  /*
   * The zone's own padding, and the empty zone, are a drop target too — a
   * drag released just beside a chip should not be swallowed. It stands for
   * the last position, which is where a column dropped with no particular
   * target belongs: the innermost level.
   *
   * Guarded on the event's target being this element, because a chip's own
   * handler has already spoken by the time the event bubbles here, and this
   * would otherwise overrule it with "at the end" on every move.
   */
  const lastId = order[order.length - 1]

  const handleZoneDragOver = (event: DragEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || lastId === undefined) return
    if (carried === null && drop.draggedId === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    takeUpIncoming()
    drop.over(lastId, "end")
  }

  const handleZoneDrop = (event: DragEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || lastId === undefined) return
    event.preventDefault()
    const draggedId = event.dataTransfer.getData("text/plain") || drop.draggedId
    drop.end()
    if (draggedId) commit(draggedId, lastId, "end")
  }

  /**
   * Say where the held chip now sits, for a screen reader to read politely.
   *
   * Levels are counted from 1 and outermost first, which is the order the
   * chips are listed in — so what is heard and what is seen agree.
   */
  const announce = (columnId: string, index: number) => {
    setAnnouncement(labels.rowGroupLevel(nameOf(columnId), index + 1, order.length))
  }

  /**
   * Space picks a chip up and puts it down; the arrows move the slot between;
   * Escape gives up. The Columns tab's grip, exactly — the same keys doing the
   * same thing one panel section down.
   */
  const handleGripKeyDown = (event: KeyboardEvent<HTMLElement>, columnId: string, index: number) => {
    const held = drop.isKeyboardGrab && drop.draggedId === columnId

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault()
      if (!held) {
        drop.start(columnId, { keyboard: true })
        announce(columnId, index)
        return
      }
      const move = drop.resolve()
      // Announced from the SLOT's index: the list has not re-rendered yet, so
      // this chip's own index is still the one it is leaving.
      const landedAt = drop.slotIndex
      drop.end()
      if (move) {
        restoreFocusRef.current = move.draggedId
        commit(move.draggedId, move.targetId, move.side)
      }
      announce(columnId, landedAt)
      return
    }

    if (!held) return

    if (event.key === "Escape") {
      // The docked panel closes on Escape from inside it; while a chip is held
      // this Escape is spent cancelling the grab and does not reach it.
      event.preventDefault()
      event.stopPropagation()
      drop.end()
      announce(columnId, index)
      return
    }

    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0
    if (step === 0) return
    event.preventDefault()
    // Every level is reachable from every other: unlike the column list there
    // is no group or pinned section a chip may not cross.
    const next = Math.min(Math.max(drop.slotIndex + step, 0), order.length - 1)
    if (next === drop.slotIndex) return
    drop.moveTo(next)
    announce(columnId, next)
  }

  /*
   * The ghost chip exists for exactly one reason: to be something for the slot
   * to sit on when the place the column will land is PAST the last level —
   * the empty zone, and the drop below the innermost chip. Anywhere else the
   * chip already standing at the destination wears the slot, as it does in the
   * column list, and minting a second mark would say the same thing twice and
   * in two places: a ghost pinned to the end of the list while the slot sat
   * two rows above it also numbered itself the wrong level.
   */
  const showGhost = incoming !== null && drop.slotId === incoming
  const chips = showGhost ? order : grouped

  return (
    <section className="dt-rowgroups" aria-label={labels.rowGroupsTitle}>
      <div className="dt-panel-head">
        <span>{labels.rowGroupsTitle}</span>
        <span className="dt-spacer" />
        {grouped.length > 0 ? (
          <button type="button" className="dt-link" onClick={() => grouping.clear()}>
            {labels.clearGrouping}
          </button>
        ) : null}
      </div>

      <ul
        className={classNames("dt-rowgroups-list", chips.length === 0 && "dt-rowgroups-empty")}
        ref={listRef}
        onDragOver={handleZoneDragOver}
        onDrop={handleZoneDrop}
      >
        {chips.length === 0 ? (
          <li className="dt-rowgroups-placeholder">{labels.rowGroupsHint}</li>
        ) : null}

        {chips.map((columnId, index) => {
          const name = nameOf(columnId)
          const ghost = columnId === incoming
          const held = drop.isKeyboardGrab && drop.draggedId === columnId

          return (
            <li
              key={columnId}
              className={classNames(
                "dt-group-chip",
                ghost && "dt-group-chip-ghost",
                drop.draggedId === columnId && !ghost && "dt-panel-dragging",
                drop.slotId === columnId && "dt-drop-slot",
              )}
              data-column-id={columnId}
              onDragOver={(event) => handleDragOver(event, columnId)}
              onDragLeave={(event) => handleDragLeave(event, columnId)}
              onDrop={(event) => handleDrop(event, columnId)}
            >
              {/*
                The level's own number, so the nesting is legible without
                counting chips. Hidden from assistive technology because the
                grip's label already says "level 2 of 3" in words.
              */}
              <span className="dt-group-chip-level" aria-hidden="true">
                {index + 1}
              </span>

              {ghost ? (
                <span className="dt-group-chip-name">{name}</span>
              ) : (
                <span
                  className="dt-drag-handle dt-group-chip-name"
                  draggable
                  role="button"
                  tabIndex={0}
                  aria-pressed={held}
                  aria-label={`${name}: ${labels.rowGroupLevel(name, index + 1, order.length)}. ${labels.reorderHint}`}
                  title={labels.dragHint}
                  onKeyDown={(event) => handleGripKeyDown(event, columnId, index)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move"
                    event.dataTransfer.setData("text/plain", columnId)
                    drop.start(columnId)
                  }}
                  onDragEnd={drop.end}
                >
                  {name}
                </span>
              )}

              {ghost ? null : (
                <button
                  type="button"
                  className="dt-group-chip-remove"
                  aria-label={labels.ungroupColumn(name)}
                  title={labels.ungroupColumn(name)}
                  onClick={() => grouping.remove(columnId)}
                >
                  <CloseIcon />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {/* The slot is decorative; what it means travels here instead, politely. */}
      <span className="dt-sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </section>
  )
}

function CloseIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M2 2 L8 8 M8 2 L2 8" />
    </svg>
  )
}
