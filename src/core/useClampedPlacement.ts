import { useState, type RefObject } from "react"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

/** Smallest gap kept between an overlay and the edge of the window. */
const VIEWPORT_MARGIN_PX = 8

/** A viewport-relative point, in CSS pixels. */
export interface ClampedPoint {
  x: number
  y: number
}

/**
 * Where to put an overlay so that all of it is on screen.
 *
 * An overlay opens at the pointer or under the control that summoned it, and
 * for the last column that is usually within its own width of the window edge.
 * It is laid out once at the requested spot, measured, and moved before paint.
 *
 * @param ref - The overlay element.
 * @param requested - Where the caller wants its top-left corner. Stable across
 *   renders, or every render re-measures.
 * @param measure - How to measure the overlay. Defaults to its own bounding
 *   rect; injectable because jsdom lays nothing out and reports every rect as
 *   zeros, which makes a re-clamp indistinguishable from no clamp at all.
 * @returns The corner to render at.
 *
 * @example
 * const placement = useClampedPlacement(ref, { x: event.clientX, y: event.clientY })
 */
export function useClampedPlacement(
  ref: RefObject<HTMLElement | null>,
  requested: ClampedPoint,
  measure?: (() => DOMRect) | undefined,
): ClampedPoint {
  const [placement, setPlacement] = useState(requested)

  useIsomorphicLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const clamp = () => {
      const { width, height } = measure ? measure() : element.getBoundingClientRect()
      const x = clampToViewport(requested.x, width, window.innerWidth)
      const y = clampToViewport(requested.y, height, window.innerHeight)
      // Same point, same object: a fresh one re-renders for nothing, and a
      // re-render that resized the element would observe itself forever.
      setPlacement((current) => (current.x === x && current.y === y ? current : { x, y }))
    }
    clamp()
    /*
     * A menu is measured once and never changes size; a filter popover grows
     * and shrinks as its operator changes, long after the layout effect above
     * has run. jsdom implements no ResizeObserver, so this is guarded rather
     * than assumed.
     */
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(clamp)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, requested, measure])

  return placement
}

function clampToViewport(start: number, size: number, viewport: number): number {
  const furthest = viewport - size - VIEWPORT_MARGIN_PX
  return Math.max(VIEWPORT_MARGIN_PX, Math.min(start, furthest))
}
