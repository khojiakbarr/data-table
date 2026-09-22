import { useIndeterminate } from "../core/useIndeterminate"

export interface SelectionCheckboxProps {
  /** Every row the box stands for is selected. */
  checked: boolean
  /**
   * Some of them are. Written to the DOM property, which is the only place it
   * exists — see {@link useIndeterminate}.
   */
  indeterminate?: boolean
  /**
   * The accessible name. Required, and not optional with a fallback: this is
   * an unlabelled control in a cell with nothing else in it, so a box without
   * one is announced as "checkbox" and a screen-reader user cannot tell one
   * row's from another's.
   */
  label: string
  onChange: (selected: boolean) => void
}

/**
 * One checkbox in the selection column — the header's, or a row's.
 *
 * A real `<input type="checkbox">` rather than a styled `<div role="checkbox">`:
 * the native control is in the Tab order, answers Space, reports its own
 * state, and renders the third state, and every one of those is something a
 * div would have to be given back by hand.
 *
 * The click is stopped from bubbling. A row usually carries `onRowClick`, and
 * a tick that also opened the row would make the box unusable for the thing it
 * is there for. Only `click` is stopped, so the change event this component
 * listens to is untouched, and only on the pointer path — a Space press
 * dispatches a click on the input itself and never reaches the row.
 *
 * @param props - See {@link SelectionCheckboxProps}.
 * @returns The checkbox.
 *
 * @example
 * <SelectionCheckbox checked label="Select row 3" onChange={(on) => toggleRow(id, on)} />
 */
export function SelectionCheckbox({
  checked,
  indeterminate = false,
  label,
  onChange,
}: SelectionCheckboxProps) {
  const boxRef = useIndeterminate(indeterminate)

  return (
    <input
      ref={boxRef}
      type="checkbox"
      className="dt-selection-box"
      checked={checked}
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}
