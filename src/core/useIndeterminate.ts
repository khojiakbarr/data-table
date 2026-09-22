import { useRef, type RefObject } from "react"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

/**
 * A ref for a checkbox that has to render the third state.
 *
 * `indeterminate` is a property of the DOM node and nothing else — there is no
 * attribute for it, no way to reach it from CSS, and React will not carry it
 * in the JSX — so it has to be written to the element by hand. A LAYOUT effect
 * rather than a passive one: it runs before paint, so a checkbox standing for
 * a partial selection is never drawn fully ticked for a frame first.
 *
 * Two checkboxes need this — the Columns panel's group row, which speaks for
 * the leaves under it, and the selection column's header, which speaks for the
 * rows the query matches — and writing the effect twice is how the two would
 * come to disagree about when the frame happens.
 *
 * @param indeterminate - Whether the box is in the third state right now.
 * @returns A ref to put on the `<input type="checkbox">`.
 *
 * @example
 * const boxRef = useIndeterminate(someButNotAll)
 * return <input ref={boxRef} type="checkbox" checked={all} />
 */
export function useIndeterminate(indeterminate: boolean): RefObject<HTMLInputElement | null> {
  const boxRef = useRef<HTMLInputElement>(null)
  useIsomorphicLayoutEffect(() => {
    if (boxRef.current) boxRef.current.indeterminate = indeterminate
  }, [indeterminate])
  return boxRef
}
