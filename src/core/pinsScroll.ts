import { createContext, useState, type RefObject } from "react"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

/**
 * The most of the viewport's width the pinned columns may take and still
 * stay put. Past it they scroll with the rest: five columns pinned to a
 * Gantt's start, 656px of them, held still in a 311px phone would hide the
 * timeline for good — nothing scrolls into a viewport the pinned ones fill.
 */
export const MAX_PINNED_SHARE = 2 / 3

/**
 * Whether the pinned columns are too wide to hold still in this viewport.
 *
 * @param pinnedWidth - The columns pinned to both edges, together, px.
 * @param viewportWidth - The viewport's visible width, px.
 * @returns True while the pinned columns would leave the others less than a
 *   third of the viewport — they scroll then.
 *
 * @example
 * pinsOverflow(656, 311) // true: a phone
 * pinsOverflow(656, 1200) // false: a desk
 */
export function pinsOverflow(pinnedWidth: number, viewportWidth: number): boolean {
  return pinnedWidth > viewportWidth * MAX_PINNED_SHARE
}

/**
 * True while the table's pinned columns scroll with the rest (see
 * {@link pinsOverflow}): the timeline's header reads it, so its month names
 * stick to the viewport's edge rather than behind pinned columns that have
 * scrolled away.
 */
export const PinsScrollContext = createContext(false)

/**
 * Whether the pinned columns scroll with the rest in this viewport now,
 * measured before the first paint and again whenever the viewport's width or
 * the pinned columns' change. A width of 0 says the viewport is not laid out
 * (a hidden tab), not that it is narrow, and changes nothing.
 *
 * @param viewportRef - The table's scroller.
 * @param pinnedWidth - The columns pinned to both edges, together, px.
 * @param enabled - False while the rows are cards, which pin nothing.
 * @returns True while the pinned columns scroll.
 *
 * @example
 * const pinsScroll = usePinsScroll(viewportRef, table.getStartTotalSize() + table.getEndTotalSize(), !isCards)
 */
export function usePinsScroll(viewportRef: RefObject<HTMLElement | null>, pinnedWidth: number, enabled: boolean): boolean {
  const [scrolls, setScrolls] = useState(false)
  useIsomorphicLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!enabled || pinnedWidth === 0 || !viewport) return
    const measure = (): void => {
      const width = viewport.clientWidth
      if (width > 0) setScrolls(pinsOverflow(pinnedWidth, width))
    }
    measure()
    // jsdom has no ResizeObserver; a test measures once.
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [viewportRef, pinnedWidth, enabled])
  return enabled && pinnedWidth > 0 && scrolls
}
