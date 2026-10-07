import { useState, type RefObject } from "react"
import type { RowsLayout } from "../types"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

/**
 * Whether the rows are drawn as cards: always for `"cards"`, never for
 * `"table"`, and for `"auto"` while the element is narrower than
 * `breakpoint`.
 *
 * The TABLE's own width is measured, not the window's — a table in a narrow
 * side panel of a wide screen is as cramped as one on a phone. It is read
 * before the first paint, so a table never mounts as one layout to settle as
 * the other, and again whenever it changes (a frame may show the old layout
 * then). The layout width is read, not the drawn box, so a dialog's zoom-in
 * does not count as narrow. A width of 0 says the element is not laid out (a
 * hidden tab), not that it is narrow, and changes nothing.
 *
 * @param ref - The element whose width decides: the table's root.
 * @param layout - The table's `layout`.
 * @param breakpoint - The width below which `"auto"` draws cards, px.
 * @returns True while the rows are cards.
 *
 * @example
 * const isCards = useCardLayout(rootRef, "auto", 640)
 */
export function useCardLayout(ref: RefObject<HTMLElement | null>, layout: RowsLayout, breakpoint: number): boolean {
  const [isNarrow, setNarrow] = useState(false)
  useIsomorphicLayoutEffect(() => {
    if (layout !== "auto") return
    const element = ref.current
    if (!element) return
    const measure = (): void => {
      const width = element.offsetWidth
      if (width > 0) setNarrow(width < breakpoint)
    }
    measure()
    // jsdom has no ResizeObserver; a test sets the width and the layout before rendering.
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, layout, breakpoint])
  return layout === "cards" || (layout === "auto" && isNarrow)
}
