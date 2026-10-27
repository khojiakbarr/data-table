import type { RefObject } from "react"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

/** The custom property the viewport's visible width is written to. */
export const VIEWPORT_WIDTH_PROPERTY = "--dt-viewport-width"

/**
 * Write the viewport's visible width to `--dt-viewport-width` on it, and keep
 * it current as the viewport resizes.
 *
 * For what must fit the screen rather than the table: a detail panel under a
 * row spans every column, and on a table wider than its viewport — a
 * timeline, many columns — most of that is off screen. The stylesheet holds
 * the panel to this width at the start edge.
 *
 * @param viewportRef - The table's scroller.
 * @param enabled - Something reads the width: detail panels in a table, not cards.
 *
 * @example
 * useViewportWidth(viewportRef, renderDetail !== undefined && !isCards)
 */
export function useViewportWidth(viewportRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  useIsomorphicLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!enabled || !viewport) return
    const write = (): void => {
      // A hidden tab reads 0: the panel keeps the last real width instead of none.
      if (viewport.clientWidth > 0) viewport.style.setProperty(VIEWPORT_WIDTH_PROPERTY, `${viewport.clientWidth}px`)
    }
    write()
    // jsdom has no ResizeObserver; a test measures once.
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(write)
    observer?.observe(viewport)
    return () => {
      observer?.disconnect()
      viewport.style.removeProperty(VIEWPORT_WIDTH_PROPERTY)
    }
  }, [viewportRef, enabled])
}
