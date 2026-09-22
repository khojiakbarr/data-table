import type { DragEventHandler, ReactNode } from "react"
import { classNames } from "../core/classNames"
import { useIndeterminate } from "../core/useIndeterminate"
import type { DataTableLabels } from "../types"

/**
 * One group header inside the Columns panel's tree.
 *
 * It carries none of the PER-COLUMN controls a leaf row has — no pin badge,
 * no filter, no row-group toggle — because a group has no values of its own.
 * What it does carry is the three things a group is: a checkbox that speaks
 * for every leaf under it, a control that folds those leaves away, and a grip,
 * because a group is moved as one thing in the header and must be here too.
 *
 * This row, and not the `<li>` around it, is the group's drag surface. The
 * `<li>` holds the nested list as well, so a `dragover` on a child leaf would
 * bubble into it and the enclosing group would draw a slot for a drop that is
 * refused — the one thing a preview must never do.
 */

export interface ColumnGroupRowProps {
  /**
   * The group column's id.
   *
   * Written to `data-column-id`, the attribute every drag surface in this
   * library identifies a row by — see the note in `ColumnsTab.renderGroup`
   * for why a group answers to it.
   */
  columnId: string
  /** The group's header text. */
  name: string
  /** DOM id for the checkbox, so the visible text can label it. */
  checkboxId: string
  /** DOM id of the list this group's children are in, for `aria-controls`. */
  sublistId: string
  /** Every leaf under the group is visible. */
  checked: boolean
  /** Some, but not all, are. */
  indeterminate: boolean
  /** Nothing under this group may be hidden, so the checkbox is inert. */
  disabled: boolean
  collapsed: boolean
  labels: DataTableLabels
  /**
   * The grip this row is picked up by, or nothing when the group may not be
   * moved at all — reordering off, or a group split across a pinning boundary.
   */
  handle?: ReactNode
  /** This group is the one in flight. */
  dragging?: boolean
  /** This group stands where the drop would land. */
  dropSlot?: boolean
  onDragOver?: DragEventHandler<HTMLDivElement>
  onDragLeave?: DragEventHandler<HTMLDivElement>
  onDrop?: DragEventHandler<HTMLDivElement>
  /** Show (`true`) or hide (`false`) every leaf under the group at once. */
  onToggleVisibility: (next: boolean) => void
  onToggleCollapse: () => void
}

/**
 * The row a group is represented by.
 *
 * @param props - See {@link ColumnGroupRowProps}.
 * @returns The grip, the collapse control, the group's checkbox and its name.
 *
 * @example
 * <ColumnGroupRow columnId="document" name="Document" checked indeterminate={false} … />
 */
export function ColumnGroupRow({
  columnId,
  name,
  checkboxId,
  sublistId,
  checked,
  indeterminate,
  disabled,
  collapsed,
  labels,
  handle,
  dragging = false,
  dropSlot = false,
  onDragOver,
  onDragLeave,
  onDrop,
  onToggleVisibility,
  onToggleCollapse,
}: ColumnGroupRowProps) {
  // The third state is a DOM property with no attribute behind it; see
  // {@link useIndeterminate}, which the selection column's header shares.
  const boxRef = useIndeterminate(indeterminate)

  return (
    <div
      className={classNames(
        "dt-panel-group-head",
        dragging && "dt-panel-dragging",
        dropSlot && "dt-drop-slot",
      )}
      data-column-id={columnId}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {handle}
      <button
        type="button"
        className="dt-group-toggle"
        aria-expanded={!collapsed}
        aria-controls={sublistId}
        aria-label={`${name}: ${collapsed ? labels.expandGroup : labels.collapseGroup}`}
        onClick={onToggleCollapse}
      >
        <ChevronIcon collapsed={collapsed} />
      </button>

      <input
        ref={boxRef}
        id={checkboxId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        /*
         * Named over the visible text, which says only "Document" and would
         * be indistinguishable from a leaf column of the same name. The
         * group's name still opens the accessible name, so the visible label
         * remains contained in it (WCAG 2.5.3).
         */
        aria-label={labels.columnGroup(name)}
        onChange={(event) => onToggleVisibility(event.target.checked)}
      />
      <label className="dt-panel-label dt-panel-group-label" htmlFor={checkboxId}>
        {name}
      </label>
    </div>
  )
}

/** The disclosure arrow. Turned with a transform, never redrawn. */
function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={collapsed ? "dt-chevron dt-chevron-collapsed" : "dt-chevron"}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 3.5 5 6.5 8 3.5" />
    </svg>
  )
}
