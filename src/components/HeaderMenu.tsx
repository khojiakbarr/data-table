import type { Column, RowData } from "@tanstack/react-table"
import { useRef } from "react"
import { useMenuSurface } from "../core/useMenuSurface"
import type { DataTableFeatures } from "../useDataTable"
import type { DataTableFeatureFlags, DataTableLabels } from "../types"

/**
 * Per-column actions, opened by right-clicking a header or from its ⋮ button.
 *
 * Everything that acts on one column lives here — sorting, pinning, width,
 * visibility — so the Columns panel can stay a plain list of what is shown and
 * in what order.
 */

/** Where the menu's top-left corner goes, in viewport pixels. */
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
  /**
   * Opens this column's filter editor in a popover. Optional: a shell of your
   * own that renders no popover simply leaves it out, and the item is not
   * offered.
   */
  onOpenFilter?: (() => void) | undefined
  /**
   * Opens the side panel's Filters tab with this column's editor expanded and
   * focused — §8.3's `focusColumnId` route. Optional for the same reason, and
   * Task 17 is what passes it: the panel does not know about tabs until then.
   */
  onOpenFilterInPanel?: (() => void) | undefined
  /**
   * Whether the rows are currently grouped by this column.
   *
   * Passed in rather than read off the column, for the same reason everything
   * else here is: the menu knows nothing of the table, and the grouping lives
   * on the instance rather than on TanStack's column state.
   */
  isGrouped: boolean
  onClose: () => void
}

export function HeaderMenu<TData extends RowData>({
  column,
  position,
  flags,
  labels,
  onAutosize,
  onAutosizeAll,
  onOpenFilter,
  onOpenFilterInPanel,
  isGrouped,
  onClose,
}: HeaderMenuProps<TData>) {
  const ref = useRef<HTMLDivElement>(null)
  /*
   * Placement, dismissal and the initial focus were all written here first and
   * now live in `useMenuSurface`, because the cell menu needs the same four
   * answers and a second copy of them is how two menus come to disagree about
   * what Escape does. No behaviour changed in the move: this menu passes no
   * `returnFocusTo`, because the control that opened it — the column's ⋮
   * button — is still on screen and keeps the focus the shell sends it.
   */
  const placement = useMenuSurface(ref, { position, onDismiss: onClose })

  const run = (action: () => void) => () => {
    action()
    onClose()
  }

  const handleHide = () => {
    /*
     * `aria-disabled` keeps the item focusable, so the platform will not
     * refuse the click — it has to be refused here, the way `CellMenu` refuses
     * an Edit it is offering but cannot take.
     */
    if (isGrouped) return
    column.toggleVisibility(false)
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
      style={{ left: placement.x, top: placement.y }}
    >
      {/*
        First, and what the menu's own autofocus lands on: it is what a user
        opening a column's menu on a filterable table most often wants. Both
        items open a surface of their own — form controls never go inside a
        `role="menu"` (§8.2) — the popover for this column alone, the panel for
        this column beside every other filter at once.
      */}
      {onOpenFilter || onOpenFilterInPanel ? (
        <>
          {onOpenFilter ? (
            <button
              type="button"
              role="menuitem"
              className="dt-menu-item"
              onClick={run(onOpenFilter)}
            >
              {labels.filter}
            </button>
          ) : null}
          {onOpenFilterInPanel ? (
            <button
              type="button"
              role="menuitem"
              className="dt-menu-item"
              onClick={run(onOpenFilterInPanel)}
            >
              {labels.filterInPanel}
            </button>
          ) : null}
          <hr className="dt-menu-sep" />
        </>
      ) : null}

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
          /*
           * A grouped column's visibility is not the user's to set while it is
           * grouped: its values have left the body and the table decides which
           * grouped column keeps a slot for them, so the derived visibility
           * overrules whatever is written. The Columns panel takes the same
           * position on its checkbox, and for the same reason — an action
           * whose flag is immediately overruled is worse than no action,
           * because the flag is still stored and springs the moment the
           * grouping comes off, with no nearby gesture to explain it.
           *
           * Disabled rather than dropped, so the menu keeps its shape whatever
           * the table is doing; `aria-disabled` rather than `disabled`, so the
           * item stays focusable and the reason on it is actually announced.
           */
          aria-disabled={isGrouped ? true : undefined}
          onClick={handleHide}
        >
          {labels.hide}
          {isGrouped ? (
            /* Part of the item's own accessible name, deliberately: a reason
               that only exists in a tooltip is a reason a screen-reader user
               never hears. */
            <span className="dt-menu-note">{labels.hideGrouped}</span>
          ) : null}
        </button>
      ) : null}
    </div>
  )
}
