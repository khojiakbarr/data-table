/** Set on the fades while there is more to scroll to at the start — its fade shows. */
export const MORE_AT_START = "data-dt-more-start"

/** Set on the fades while there is more to scroll to at the end. */
export const MORE_AT_END = "data-dt-more-end"

/**
 * The box of what the viewport shows — inside its borders and scrollbars, in
 * the coordinates of the element both are positioned in — which the fades
 * stand over: `--dt-edges-top`, `-left`, `-width`, `-height`.
 */
export const EDGES_BOX_VARS = ["--dt-edges-top", "--dt-edges-left", "--dt-edges-width", "--dt-edges-height"] as const

/** A pixel of slack: a fractional `scrollLeft` at either end is not "more". */
const EDGE_SLACK_PX = 1

/** What {@link scrollEdges} reads off a scrolling box. */
export interface ScrollMetrics {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
}

/**
 * Whether a box that scrolls sideways has more out of sight at each end.
 *
 * @param box - The scrolling box, or its numbers.
 * @returns `start` while it is scrolled away from its start, `end` while its
 *   content runs past its end. Both false for a box whose content fits.
 *
 * @example
 * scrollEdges({ scrollLeft: 0, clientWidth: 375, scrollWidth: 620 }) // { start: false, end: true }
 */
export function scrollEdges(box: ScrollMetrics): { start: boolean; end: boolean } {
  // A right-to-left box counts its scrollLeft down from 0; the distance from the start is the same either way.
  const fromStart = Math.abs(box.scrollLeft)
  return {
    start: fromStart > EDGE_SLACK_PX,
    end: fromStart + box.clientWidth < box.scrollWidth - EDGE_SLACK_PX,
  }
}

/**
 * Keep {@link MORE_AT_START} and {@link MORE_AT_END} on the fades true to how
 * the viewport is scrolled sideways, and the fades' box ({@link EDGES_BOX_VARS})
 * over what the viewport shows, as it scrolls, resizes, moves or its content
 * changes — the table swapped for another, a column dragged wider, a bar
 * appearing above it.
 *
 * The fades are out of flow, positioned in the same element the viewport is
 * (`offsetParent`), so their box takes nothing from the viewport's: a box in
 * the flow sized from the viewport was a loop, each measure moving the
 * viewport it had measured. Attributes and custom properties, not React
 * state: a scroll fires dozens of events a second, and none of them should
 * draw a row again — a scroll only ever toggles the two attributes.
 *
 * @param viewport - The table's scroller.
 * @param edges - The fades: an absolutely positioned box beside it.
 * @returns Stops watching and clears what it set.
 *
 * @example
 * useIsomorphicLayoutEffect(() => watchScrollEdges(viewportRef.current!, edgesRef.current!), [])
 */
export function watchScrollEdges(viewport: HTMLElement, edges: HTMLElement): () => void {
  const update = (): void => {
    const { start, end } = scrollEdges(viewport)
    edges.toggleAttribute(MORE_AT_START, start)
    edges.toggleAttribute(MORE_AT_END, end)
  }
  const measure = (): void => {
    // Inside the borders and a right-to-left scrollbar (`clientLeft`), as wide and tall as what is in view.
    const box = [
      viewport.offsetTop + viewport.clientTop,
      viewport.offsetLeft + viewport.clientLeft,
      viewport.clientWidth,
      viewport.clientHeight,
    ]
    EDGES_BOX_VARS.forEach((name, index) => edges.style.setProperty(name, `${box[index] ?? 0}px`))
    update()
  }

  // Without one — a test's DOM — the fades still follow the scroll, only not a resize.
  const resizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
  const watchSizes = (): void => {
    if (!resizes) return
    resizes.disconnect()
    resizes.observe(viewport)
    for (const child of viewport.children) resizes.observe(child)
    // The element both are placed in grows when a bar above the viewport appears, which moves it without resizing it.
    if (viewport.offsetParent instanceof HTMLElement) resizes.observe(viewport.offsetParent)
  }
  const children =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => {
          watchSizes()
          measure()
        })

  watchSizes()
  children?.observe(viewport, { childList: true })
  viewport.addEventListener("scroll", update, { passive: true })
  measure()

  return () => {
    viewport.removeEventListener("scroll", update)
    resizes?.disconnect()
    children?.disconnect()
    edges.removeAttribute(MORE_AT_START)
    edges.removeAttribute(MORE_AT_END)
    for (const name of EDGES_BOX_VARS) edges.style.removeProperty(name)
  }
}
