import type { Column, RowData } from "@tanstack/react-table"
import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react"
import {
  buildColumnTree,
  groupVisibility,
  leafColumnsOfNode,
  siblingOrderOf,
  type ColumnTreeGroup,
  type ColumnTreeLeaf,
  type ColumnTreeNode,
} from "../core/columnTree"
import { classNames } from "../core/classNames"
import { columnLabel } from "../core/columnLabel"
import { dropRegionOf, isMovableRegion } from "../core/dropRegion"
import { orderedLeafColumns } from "../core/pinning"
import { isRowNumberColumn } from "../core/rowNumbers"
import { isSelectionColumn } from "../core/selection"
import { reachableRange, type DropSide } from "../core/reorder"
import { useDropSlot } from "../core/useDropSlot"
import { useIsomorphicLayoutEffect } from "../core/useIsomorphicLayoutEffect"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { ColumnDragHandle } from "./ColumnDragHandle"
import { ColumnGroupRow } from "./ColumnGroupRow"
import { RowGroupsZone } from "./RowGroupsZone"

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
 * A GROUP row is dragged too, on exactly the terms the header already offers:
 * it moves among its siblings and carries its leaves with it. That is why the
 * drag works level by level rather than over one flat array of leaves — a
 * group three columns wide does not land on one-column steps, and resolving
 * its drop in the leaf order would answer with a leaf halfway through the
 * group being moved. `siblingOrderOf` is the same reading `DataTable` gives
 * the header, so the two surfaces cannot drift apart again.
 */

export interface ColumnsTabProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
  /**
   * A column being dragged from OUTSIDE this list — a table header — so the
   * Row Groups zone can draw its slot for it. A drag started inside the list
   * is known here already and needs no telling.
   */
  draggedColumnId?: string | null | undefined
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
  draggedColumnId,
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
  /*
   * The chrome columns are left out entirely, and that is the whole of
   * "absent from the Columns panel tree": the tree below is built from this
   * list and nothing else, so a column that is not in it has no row to be
   * shown, ticked, moved or counted in. Showing either would mean offering a
   * tick that removes the column its own feature flag put there, which
   * contradicts the flag — and `dropRegionOf` refuses them a second time, for
   * the surfaces that do list them.
   */
  const columns = orderedLeafColumns(table).filter(
    (column) => !isRowNumberColumn(column.id) && !isSelectionColumn(column.id),
  )
  const tree = buildColumnTree(columns)
  /*
   * The column holding the group values, which the grouping has lifted to the
   * front of its section. Its place is derived, so it has no drag handle and
   * no reachable position — one of the rows `dropRegionOf` puts alone in a
   * region, alongside a group split across a pinning boundary.
   */
  const groupColumnId = instance.grouping.columnId
  /*
   * A drag moves a column among its SIBLINGS and nowhere else, so that is the
   * order each slot is resolved against: a leaf steps past the leaves beside
   * it, a group row past the whole groups beside it. The array handed back
   * here is the very one `renderNodes` maps over at that level, which is what
   * keeps the slot the hook resolves and the row that wears it in step.
   */
  const drop = useDropSlot((draggedId) => siblingOrderOf(tree, draggedId))
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
     *
     * Every row, not only `li.dt-panel-item`: a group row carries the same
     * attribute on its head, and a keyboard move of a group would otherwise
     * leave focus at the top of the document (WCAG 2.4.3).
     */
    for (const row of listRef.current?.querySelectorAll("[data-column-id]") ?? []) {
      if (row.getAttribute("data-column-id") !== columnId) continue
      row.querySelector<HTMLElement>(".dt-drag-handle")?.focus()
      return
    }
  })

  /**
   * Whether this row may be picked up at all.
   *
   * The same question the header asks, asked the same way: a column alone in
   * its drop region can never land anywhere, so a grip on it is the broken
   * promise a slot would be, made one step earlier. One answer refuses the
   * group column, the row-number column and a group split across a pinning
   * boundary, instead of three special cases that can fall out of step.
   */
  const canMove = (column: Column<DataTableFeatures, TData, unknown>): boolean =>
    flags.reordering && isMovableRegion(dropRegionOf(column, groupColumnId))

  /**
   * Whether a drop on `target` would actually be carried out.
   *
   * The column in flight is looked for among `siblings` rather than anywhere
   * in the tree: a drag is a move among siblings and nothing else, so a column
   * from another level is already out of reach — which is exactly how a group
   * dropped on a leaf inside another group is refused, and why no slot is
   * painted for it. `dropRegionOf` then answers the rest, which is whether the
   * two are in the same run of this one level.
   */
  const canDropOn = (
    target: Column<DataTableFeatures, TData, unknown>,
    siblings: readonly ColumnTreeNode<TData>[],
  ): boolean => {
    const dragged = siblings.find((node) => node.column.id === drop.draggedId)?.column
    return (
      dragged !== undefined &&
      dropRegionOf(dragged, groupColumnId) === dropRegionOf(target, groupColumnId)
    )
  }

  /** Which edge of a list row the pointer is nearest. A list runs vertically. */
  const sideWithin = (event: DragEvent<HTMLElement>): DropSide => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY - rect.top > rect.height / 2 ? "end" : "start"
  }

  const handleDragOver = (
    event: DragEvent<HTMLElement>,
    target: Column<DataTableFeatures, TData, unknown>,
    siblings: readonly ColumnTreeNode<TData>[],
  ) => {
    if (!flags.reordering || !canDropOn(target, siblings)) return
    event.preventDefault()
    drop.over(target.id, sideWithin(event))
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
   * What a row is called when it is spoken.
   *
   * A group is named the way its own checkbox already names it, so "Document"
   * the group and "Document" the column are told apart by ear — and so the
   * panel needs no reordering strings of its own for groups.
   */
  const spokenName = (node: ColumnTreeNode<TData>): string => {
    const name = columnLabel(node.column.id, node.column.columnDef.header)
    return node.kind === "group" ? labels.columnGroup(name) : name
  }

  /**
   * Say where the held row now sits, for a screen reader to read politely.
   *
   * The name is passed in rather than looked up at `index`: the position is
   * the SLOT's, and the row standing there is the one being displaced, not the
   * one the user is holding. Both numbers are counted at the row's OWN level,
   * which is the only run it can reach — a total that counted positions the
   * arrows refuse to visit would be a number with no meaning.
   */
  const announce = (name: string, index: number, total: number) => {
    setAnnouncement(labels.reorderPosition(name, index + 1, total))
  }

  /**
   * Space picks the row up and puts it down; the arrows move the slot between;
   * Escape gives up. The same slot the pointer draws follows along, so the
   * keyboard path is the feature rather than a lesser version of it — and a
   * group row takes exactly these keys, because a group that could only be
   * moved with a mouse would be half a feature.
   *
   * @param event - The key press, from the grip.
   * @param siblings - The level this row stands at, which is the run it moves
   *   within and the run every number below is counted in.
   * @param index - Where this row sits in `siblings`.
   */
  const handleGripKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    siblings: readonly ColumnTreeNode<TData>[],
    index: number,
  ) => {
    const node = siblings[index]
    if (!node) return
    const { column } = node
    const name = spokenName(node)
    const total = siblings.length
    const held = drop.isKeyboardGrab && drop.draggedId === column.id

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault()
      if (!held) {
        drop.start(column.id, { keyboard: true })
        announce(name, index, total)
        return
      }
      const move = drop.resolve()
      // Announced from the slot's index, which is where the row is about to
      // be: the list has not re-rendered yet, and after it does this row's own
      // index is no longer the one the user asked for.
      const landedAt = drop.slotIndex
      drop.end()
      if (move) {
        restoreFocusRef.current = move.draggedId
        onReorder(move.draggedId, move.targetId, move.side)
      }
      announce(name, landedAt, total)
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
      announce(name, index, total)
      return
    }

    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0
    if (step === 0) return
    event.preventDefault()
    const { first, last } = reachableRange(
      siblings.map((sibling) => dropRegionOf(sibling.column, groupColumnId)),
      index,
    )
    const next = Math.min(Math.max(drop.slotIndex + step, first), last)
    if (next === drop.slotIndex) return
    drop.moveTo(next)
    announce(name, next, total)
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

  /**
   * The row in flight, when it stands for a column the rows have values in.
   *
   * A group row is draggable here now too, and a group is not such a column:
   * the Row Groups zone below would mint a ghost chip for a level the grouping
   * can never hold. `DataTable` filters a header drag the same way before
   * handing it over.
   */
  const draggedLeafId =
    drop.draggedId !== null && columns.some((column) => column.id === drop.draggedId)
      ? drop.draggedId
      : null

  const toggleCollapsed = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  /**
   * One leaf column: the drag surface, its checkbox, and how it is pinned.
   *
   * @param node - The tree node this row draws.
   * @param siblings - The level it stands at, for the drag.
   * @param at - Where it sits in `siblings`.
   */
  const renderLeaf = (
    node: ColumnTreeLeaf<TData>,
    siblings: readonly ColumnTreeNode<TData>[],
    at: number,
  ): ReactNode => {
    const { column } = node
    const name = columnLabel(column.id, column.columnDef.header)
    const held = drop.isKeyboardGrab && drop.draggedId === column.id
    const grouped = instance.grouping.has(column.id)
    const className = classNames(
      "dt-panel-item",
      drop.draggedId === column.id && "dt-panel-dragging",
      drop.slotId === column.id && "dt-drop-slot",
    )

    return (
      <li
        key={column.id}
        className={className}
        data-column-id={column.id}
        onDragOver={(event) => handleDragOver(event, column, siblings)}
        onDragLeave={(event) => handleDragLeave(event, column.id)}
        onDrop={(event) => handleDrop(event, column.id)}
      >
        {canMove(column) ? (
          <ColumnDragHandle
            columnId={column.id}
            name={name}
            labels={labels}
            held={held}
            onKeyDown={(event) => handleGripKeyDown(event, siblings, at)}
            onDragStart={() => drop.start(column.id)}
            onDragEnd={drop.end}
          />
        ) : null}

        <input
          id={`${instance.id}-col-${column.id}`}
          type="checkbox"
          checked={column.getIsVisible()}
          /*
           * A grouped column's visibility is not the user's to set while it is
           * grouped: its values have left the body and the table decides which
           * one keeps a slot for the group values. Offering a tick that the
           * derived visibility would immediately overrule is worse than
           * offering none — removing it from the Row Groups zone is what puts
           * the column back.
           */
          disabled={!flags.hiding || !column.getCanHide() || instance.grouping.has(column.id)}
          onChange={column.getToggleVisibilityHandler()}
        />
        <label className="dt-panel-label" htmlFor={`${instance.id}-col-${column.id}`}>
          {name}
        </label>

        {instance.grouping.enabled ? (
          <button
            type="button"
            className="dt-group-toggle-btn"
            /*
             * The keyboard route into the Row Groups zone, and back out of it.
             * A toggle rather than a second drag idiom: the row already has a
             * checkbox that says "shown", and this says "grouped" the same way,
             * so there is one thing to learn per row and not two.
             */
            aria-pressed={grouped}
            aria-label={grouped ? labels.ungroupColumn(name) : labels.groupByColumn(name)}
            title={grouped ? labels.ungroupColumn(name) : labels.groupByColumn(name)}
            onClick={() =>
              grouped ? instance.grouping.remove(column.id) : instance.grouping.add(column.id)
            }
          >
            <GroupIcon />
          </button>
        ) : null}

        {column.getIsPinned() ? (
          <span className="dt-pin-badge">
            {column.getIsPinned() === "start" ? labels.pinnedStartBadge : labels.pinnedEndBadge}
          </span>
        ) : null}
      </li>
    )
  }

  /**
   * One group: its own row, and a nested list of whatever stands under it.
   *
   * @param node - The tree node this row draws.
   * @param siblings - The level it stands at, for the drag.
   * @param at - Where it sits in `siblings`.
   */
  const renderGroup = (
    node: ColumnTreeGroup<TData>,
    siblings: readonly ColumnTreeNode<TData>[],
    at: number,
  ): ReactNode => {
    const leaves = leafColumnsOfNode(node)
    const { checked, indeterminate } = groupVisibility(leaves)
    const collapsed = collapsedGroups.has(node.key)
    const name = columnLabel(node.column.id, node.column.columnDef.header)
    const held = drop.isKeyboardGrab && drop.draggedId === node.column.id
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
       * The `<li>` keeps `data-group-id`, which names the whole SUBTREE — it
       * is what a collapse acts on and what a test reaches for to ask "is
       * Money inside Totals". The group's own ROW carries `data-column-id`
       * instead (see `ColumnGroupRow`), and that is a deliberate reversal of
       * the note that used to stand here: it said a group is not a column the
       * table draws, which is true, and then concluded it should not answer to
       * the attribute the drag surfaces use, which does not follow. A group IS
       * a column in every sense a drag cares about — `table.getColumn` finds
       * it, `dropRegionOf` places it, `reorderColumn` moves it by the run of
       * leaves the host declared under it. What "not drawn" really governs is
       * the cell selectors, and those are already scoped to `th`/`td` or to
       * `li.dt-panel-item`, never to a bare `[data-column-id]`.
       *
       * The attribute goes on the row and not on this `<li>` because the
       * `<li>` also holds the children: a `dragover` on a nested leaf bubbles
       * here, and an enclosing group would then draw a slot for a drop it is
       * about to refuse.
       */
      <li key={node.runKey} className="dt-panel-group" data-group-id={node.column.id}>
        <ColumnGroupRow
          columnId={node.column.id}
          name={name}
          checkboxId={`${domId}-visible`}
          sublistId={domId}
          checked={checked}
          indeterminate={indeterminate}
          disabled={!flags.hiding || !leaves.some((leaf) => leaf.getCanHide())}
          collapsed={collapsed}
          labels={labels}
          dragging={drop.draggedId === node.column.id}
          dropSlot={drop.slotId === node.column.id}
          handle={
            canMove(node.column) ? (
              <ColumnDragHandle
                columnId={node.column.id}
                name={labels.columnGroup(name)}
                labels={labels}
                held={held}
                onKeyDown={(event) => handleGripKeyDown(event, siblings, at)}
                onDragStart={() => drop.start(node.column.id)}
                onDragEnd={drop.end}
              />
            ) : null
          }
          onDragOver={(event) => handleDragOver(event, node.column, siblings)}
          onDragLeave={(event) => handleDragLeave(event, node.column.id)}
          onDrop={(event) => handleDrop(event, node.column.id)}
          onToggleVisibility={(next) => setGroupVisible(leaves, next)}
          onToggleCollapse={() => toggleCollapsed(node.key)}
        />
        <ul className="dt-panel-sublist" id={domId} hidden={collapsed}>
          {renderNodes(node.children)}
        </ul>
      </li>
    )
  }

  /*
   * `nodes` IS the sibling array a drag at this level is resolved against —
   * the same one `siblingOrderOf` hands `useDropSlot` — so it is passed down
   * rather than looked up again per row.
   */
  const renderNodes = (nodes: readonly ColumnTreeNode<TData>[]): ReactNode =>
    nodes.map((node, at) =>
      node.kind === "leaf" ? renderLeaf(node, nodes, at) : renderGroup(node, nodes, at),
    )

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

      {/*
        Under the tree, where AG Grid puts it — and only where it can work.
        `grouping.enabled` is false on a client table, where grouping one page
        of fifty rows would report counts for the page rather than for the
        table; a zone that took a drop and answered with a wrong number, or
        with nothing at all, is worse than no zone. So there is none.
      */}
      {instance.grouping.enabled ? (
        <RowGroupsZone
          instance={instance}
          labels={labels}
          incomingColumnId={draggedLeafId ?? draggedColumnId ?? null}
        />
      ) : null}
    </>
  )
}

/** Stacked bars: a column's values gathered into groups. */
function GroupIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    >
      <path d="M1.5 2.5 H10.5 M3.5 6 H10.5 M5.5 9.5 H10.5" />
    </svg>
  )
}
