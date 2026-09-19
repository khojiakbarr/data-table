import { useRef, useState, type RefObject } from "react"
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
 * It is laid out once at the requested spot, measured, and moved before paint,
 * then re-measured whenever the overlay's own size changes afterwards (a
 * popover that grows when its operator changes, for example).
 *
 * The overlay's own rendered size must not depend on the position this hook
 * gives it. A `position: fixed` box with `width: auto` shrink-to-fits to
 * `containingBlock - left`, so every clamp hands it a little more room, which
 * grows the box, which re-triggers the observer — a slow feedback loop, not a
 * one-time reflow. Give the overlay an explicit width, or bound it with
 * `width: max-content; max-width: …` (see `.dt-menu` in styles.css).
 *
 * The overlay element may still be `null` on the render that first calls this
 * hook — `{isOpen && <div ref={ref} />}` is an ordinary way to write an
 * overlay. The element is picked up reactively once it mounts, on whichever
 * later render that happens to be, not only on the hook's first run.
 *
 * @param ref - The overlay element.
 * @param requested - Where the caller wants its top-left corner, in viewport
 *   pixels. Only `x`/`y` are compared across renders, so a fresh object every
 *   render — the usual shape, since it closes over the event or state that
 *   opened the overlay — never by itself re-runs the effect below.
 * @param measure - How to measure the overlay. Defaults to its own bounding
 *   rect; injectable because jsdom lays nothing out and reports every rect as
 *   zeros, which makes a re-clamp indistinguishable from no clamp at all. Read
 *   through a ref refreshed every render, so a fresh closure each render (it
 *   typically closes over component state, same as `requested`) does not
 *   re-run the effect either.
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
  const { x: requestedX, y: requestedY } = requested

  // Latest-ref: `measure` is read, not depended on. Depending on its identity
  // would disconnect and reobserve on every render for a caller who (as the
  // @example does) writes it as a fresh closure each time.
  const measureRef = useRef(measure)
  useIsomorphicLayoutEffect(() => {
    measureRef.current = measure
  })

  // Mirrors `ref.current` into state so a late-attaching ref is noticed.
  // `ref` is caller-owned (typically `useRef(null)`), so its *identity*
  // never changes and can't be a dependency below; without this mirror, an
  // overlay written as `{isOpen && <div ref={ref} />}` would run this hook
  // once while `ref.current` is still null, bail out, and never clamp or
  // observe even after the element mounts on a later render — silently and
  // permanently. This effect has no dependency array so it checks after
  // every commit, but only calls `setElement` when the node actually
  // changed, so it does not loop.
  const [element, setElement] = useState(ref.current)
  useIsomorphicLayoutEffect(() => {
    if (ref.current !== element) setElement(ref.current)
  })

  useIsomorphicLayoutEffect(() => {
    if (!element) return
    const clamp = () => {
      const { width, height } = measureRef.current
        ? measureRef.current()
        : element.getBoundingClientRect()
      const x = clampToViewport(requestedX, width, window.innerWidth)
      const y = clampToViewport(requestedY, height, window.innerHeight)
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
    // `requested` and `measure` are read above via requestedX/requestedY and
    // measureRef on purpose, not depended on directly — see the JSDoc @param
    // notes: depending on their identities would re-run this effect (and
    // disconnect + reobserve) on every render regardless of whether the
    // requested point actually moved. `element` (not `ref`) is the
    // dependency, so a ref that attaches after this hook's first run
    // correctly re-triggers the clamp.
  }, [element, requestedX, requestedY])

  return placement
}

function clampToViewport(start: number, size: number, viewport: number): number {
  const furthest = viewport - size - VIEWPORT_MARGIN_PX
  return Math.max(VIEWPORT_MARGIN_PX, Math.min(start, furthest))
}
