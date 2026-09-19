import { useRef } from "react"
import { useIsomorphicLayoutEffect } from "../core/useIsomorphicLayoutEffect"
import type { DataTableLabels } from "../types"

/**
 * One group header inside the Columns panel's tree.
 *
 * It is not a column the table draws cells for, so it carries none of the
 * per-column controls a leaf row has — no drag handle, no pin badge, no
 * filter. What it does carry is the two things a group is: a checkbox that
 * speaks for every leaf under it, and a control that folds those leaves away.
 */

export interface ColumnGroupRowProps {
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
  /** Show (`true`) or hide (`false`) every leaf under the group at once. */
  onToggleVisibility: (next: boolean) => void
  onToggleCollapse: () => void
}

/**
 * The row a group is represented by.
 *
 * @param props - See {@link ColumnGroupRowProps}.
 * @returns The collapse control, the group's checkbox and its name.
 *
 * @example
 * <ColumnGroupRow name="Document" checked indeterminate={false} … />
 */
export function ColumnGroupRow({
  name,
  checkboxId,
  sublistId,
  checked,
  indeterminate,
  disabled,
  collapsed,
  labels,
  onToggleVisibility,
  onToggleCollapse,
}: ColumnGroupRowProps) {
  const boxRef = useRef<HTMLInputElement>(null)

  /*
   * `indeterminate` is a property of the DOM node and nothing else — there is
   * no attribute for it and no way to reach it from CSS — so React cannot
   * carry it in the JSX and it has to be written to the element by hand. A
   * layout effect rather than a passive one: it runs before paint, so a group
   * that is half-shown is never drawn ticked for a frame first.
   */
  useIsomorphicLayoutEffect(() => {
    if (boxRef.current) boxRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <div className="dt-panel-group-head">
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
