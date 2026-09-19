import type { Column, RowData } from "@tanstack/react-table"
import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react"
import {
  buildColumnTree,
  groupVisibility,
  leafColumnsOfNode,
  type ColumnTreeGroup,
  type ColumnTreeLeaf,
  type ColumnTreeNode,
} from "../core/columnTree"
import { columnLabel } from "../core/columnLabel"
import { dropRegionOf } from "../core/dropRegion"
import { orderedLeafColumns } from "../core/pinning"
import { reachableRange, type DropSide } from "../core/reorder"
import { useDropSlot } from "../core/useDropSlot"
import { useIsomorphicLayoutEffect } from "../core/useIsomorphicLayoutEffect"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { ColumnGroupRow } from "./ColumnGroupRow"

/**
 * What is shown, and in what order.
 *
 * Columns are listed as the tree the table actually has — a group, then its
 * children indented beneath it, to whatever depth they nest — and dragged into
 * a new order by their handle, with a pointer or from the keyboard, which is
 * the only reordering path a user who cannot drag has. Pinning lives in the
 * header's context menu, where it sits next to the other per-column actions
 * instead of as a pair of arrow buttons whose direction has to be decoded.
 *
 * Both list and drag work off ONE flat array of leaves in render order. The
 * tree is a way of drawing that array, not a second model of it: every index
 * a drop or a keyboard move is resolved against is an index into it, so the
 * nesting cannot introduce an arithmetic of its own to be wrong in.
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
 * @returns The head, with Show all and Reset, and the column tree.
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
   *
   * Hidden columns are included, which is the difference from what the table
   * itself renders from: a row is how a hidden column is shown again, so a
   * list of only the visible ones would let a user hide a column and then
   * have no way back to it.
   */
  const columns = orderedLeafColumns(table)
  const tree = buildColumnTree(columns)
  const drop = useDropSlot(columns.map((column) => column.id))
  const [announcement, setAnnouncement] = useState("")
  /**
   * Which groups are folded away. Collapsed rather than expanded ids, so a
   * group the user has never touched — including one that appears later —
   * starts open without having to be enrolled first.
   */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )
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
    for (const item of listRef.current?.querySelectorAll("li.dt-panel-item") ?? []) {
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

  /**
   * Show or hide every leaf under a group in one state change.
   *
   * One `setColumnVisibility` rather than a `toggleVisibility` per column:
   * the group's leaves go together, so they belong in one commit — and one
   * undoable step, once a host wires the layout to undo.
   *
   * Hiding skips a column that may not be hidden; showing never does, because
   * such a column is already visible and writing `true` says the same thing.
   */
  const setGroupVisible = (
    leaves: readonly Column<DataTableFeatures, TData, unknown>[],
    visible: boolean,
  ) => {
    table.setColumnVisibility((current) => {
      const next = { ...current }
      for (const leaf of leaves) {
        if (visible) next[leaf.id] = true
        else if (leaf.getCanHide()) next[leaf.id] = false
      }
      return next
    })
  }

  const toggleCollapsed = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  /** One leaf column: the drag surface, its checkbox, and how it is pinned. */
  const renderLeaf = (node: ColumnTreeLeaf<TData>): ReactNode => {
    const { column, index } = node
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
             * In the Tab order, unlike the decorative grip it used to be: this
             * is the whole keyboard route to reordering, and the instructions
             * ride on the label because there is nowhere else a screen reader
             * would find them in time.
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
        <label className="dt-panel-label" htmlFor={`${instance.id}-col-${column.id}`}>
          {name}
        </label>

        {column.getIsPinned() ? (
          <span className="dt-pin-badge">
            {column.getIsPinned() === "start" ? labels.pinnedStartBadge : labels.pinnedEndBadge}
          </span>
        ) : null}
      </li>
    )
  }

  /** One group: its own row, and a nested list of whatever stands under it. */
  const renderGroup = (node: ColumnTreeGroup<TData>): ReactNode => {
    const leaves = leafColumnsOfNode(node)
    const { checked, indeterminate } = groupVisibility(leaves)
    const collapsed = collapsedGroups.has(node.key)
    /*
     * Keyed by position, not by the group's id: an id is whatever the host's
     * definition produced and may contain a space, which is not a valid
     * IDREF — and `aria-controls` would then point at nothing.
     */
    const domId = `${instance.id}-colgroup-${node.index}`

    return (
      /*
       * The group is a list item with a list inside it, which is the nesting
       * itself rather than a picture of it: a screen reader announces the
       * level, and the indent is left to the stylesheet.
       *
       * It carries `data-group-id` and not `data-column-id` — a group is not
       * a column the table draws, and the drag surfaces select rows by the
       * latter.
       */
      <li key={node.runKey} className="dt-panel-group" data-group-id={node.column.id}>
        <ColumnGroupRow
          name={columnLabel(node.column.id, node.column.columnDef.header)}
          checkboxId={`${domId}-visible`}
          sublistId={domId}
          checked={checked}
          indeterminate={indeterminate}
          disabled={!flags.hiding || !leaves.some((leaf) => leaf.getCanHide())}
          collapsed={collapsed}
          labels={labels}
          onToggleVisibility={(next) => setGroupVisible(leaves, next)}
          onToggleCollapse={() => toggleCollapsed(node.key)}
        />
        <ul className="dt-panel-sublist" id={domId} hidden={collapsed}>
          {renderNodes(node.children)}
        </ul>
      </li>
    )
  }

  const renderNodes = (nodes: readonly ColumnTreeNode<TData>[]): ReactNode =>
    nodes.map((node) => (node.kind === "leaf" ? renderLeaf(node) : renderGroup(node)))

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
        {renderNodes(tree)}
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
