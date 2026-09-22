import { useRef, type ReactNode } from "react"
import { notEditableLabelKey, type NotEditableReason } from "../core/cellEditing"
import type { ClampedPoint } from "../core/useClampedPlacement"
import { useMenuSurface } from "../core/useMenuSurface"
import type { CellEditingLabels } from "../labels/editing"

/**
 * The actions one body cell offers, opened by right-clicking it.
 *
 * `HeaderMenu`'s sibling, not its copy: placement clamping, dismissal, the
 * initial focus and the focus return all come from `useMenuSurface`, which was
 * extracted from that menu so the two cannot drift apart about what Escape
 * does. What differs is only the items — Edit first, and room after it for the
 * row actions that will follow.
 *
 * It knows nothing of the table. Where it opens is a point the caller
 * measured, and whether the cell can be edited is a prop, which is what lets
 * the pointer route and a later keyboard route hand it different anchors
 * without it changing.
 */
export interface CellMenuProps {
  /**
   * Where the menu's top-left corner goes, in viewport pixels: the pointer for
   * a right-click, or the focused cell's corner for the keyboard route.
   */
  position: ClampedPoint
  labels: CellEditingLabels
  /**
   * Why this cell cannot be edited, or undefined when it can.
   *
   * A cell that cannot be edited still gets the menu, with Edit disabled and
   * the reason on the item — §2: a menu that sometimes fails to appear teaches
   * the user that the feature is broken.
   */
  notEditable?: NotEditableReason | undefined
  /** Chosen Edit. Never called while {@link CellMenuProps.notEditable} is set. */
  onEdit: () => void
  /** Escape, a pointer press outside, or an item that ran. */
  onClose: () => void
  /**
   * Where the focus returns when the menu closes — the cell it was opened on,
   * once a body cell can hold focus. Safe to leave out until then.
   */
  returnFocusTo?: HTMLElement | null | undefined
  /**
   * Further items, after a separator: the row actions this menu was given room
   * for. Each should be a `<button role="menuitem" className="dt-menu-item">`.
   */
  children?: ReactNode
}

/**
 * The cell's context menu.
 *
 * @param props - See {@link CellMenuProps}.
 * @returns The menu, positioned inside the viewport.
 *
 * @example
 * <CellMenu position={{ x: event.clientX, y: event.clientY }} labels={labels}
 *   onEdit={openEditor} onClose={close} />
 */
export function CellMenu({
  position,
  labels,
  notEditable,
  onEdit,
  onClose,
  returnFocusTo,
  children,
}: CellMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const placement = useMenuSurface(ref, {
    position,
    onDismiss: onClose,
    returnFocusTo,
  })

  const handleEdit = () => {
    // `aria-disabled` keeps the item focusable, so it is announced and
    // reachable — which also means the click has to be refused here rather
    // than by the platform.
    if (notEditable !== undefined) return
    onEdit()
    onClose()
  }

  return (
    <div
      className="dt-menu"
      ref={ref}
      role="menu"
      aria-label={labels.cellActions}
      style={{ left: placement.x, top: placement.y }}
    >
      <button
        type="button"
        role="menuitem"
        className="dt-menu-item"
        aria-disabled={notEditable === undefined ? undefined : true}
        onClick={handleEdit}
      >
        {labels.edit}
        {notEditable === undefined ? null : (
          /* Part of the item's own accessible name, deliberately: a reason
             that only exists in a tooltip is a reason a screen-reader user
             never hears. */
          <span className="dt-menu-note">{labels[notEditableLabelKey(notEditable)]}</span>
        )}
      </button>

      {children === undefined ? null : (
        <>
          <hr className="dt-menu-sep" />
          {children}
        </>
      )}
    </div>
  )
}
