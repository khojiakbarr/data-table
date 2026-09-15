import { useState, type RefObject } from "react"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"
import { warnOnce } from "./warnOnce"

/**
 * Rows below which an unscrolling viewport is left alone.
 *
 * A viewport that holds this many rows without scrolling is taller than any
 * display — 200 rows is 8000px at the default row height, 4000px at the
 * smallest one anybody uses — so the only way to be under it is to have no
 * height at all. Short tables in tall boxes, which are ordinary, stay below
 * the threshold and are never touched.
 */
const UNBOUNDED_MIN_ROWS = 200
/**
 * Slack between the two readings, in pixels.
 *
 * `clientHeight` is rounded and `scrollHeight` rounds up, so content that
 * happens to end on a fraction reports one pixel of overflow that cannot be
 * scrolled to. A pixel or two is not a scrollbar.
 */
const SCROLL_SLACK_PX = 2

/** Inputs to {@link useUnboundedViewport}. */
export interface UnboundedViewportOptions {
  /** The scrolling element. */
  viewportRef: RefObject<HTMLElement | null>
  /** Rows in the row model — the page, when the table is paged. */
  rows: number
  /** Only virtualised tables are worth correcting; see below. */
  enabled: boolean
  /** The table's id, so the warning says which table to fix. */
  id: string
}

/**
 * Whether the viewport has to be given a height because nobody else did.
 *
 * Virtualisation needs a scroller. `.dt-root` has no height of its own, so a
 * table given neither the `height` prop nor a bounded ancestor grows to fit
 * its rows: `overflow: auto` never clips, the virtualiser measures a viewport
 * as tall as the whole list, and its window is the whole list. A hundred
 * thousand rows then land in the DOM with no error, no warning and no clue —
 * only a tab that stops responding. Documenting that trap is not the same as
 * not falling into it.
 *
 * The state is read from the DOM rather than guessed from the props, because
 * a height can come from anywhere — the prop, a class on the root, a grid
 * ancestor — and a library that assumed the prop was the only way would fight
 * every host that used one of the others. A scroller that does not scroll
 * while it holds more rows than any screen can show has no height of its own,
 * whatever gave it one; a scroller that scrolls needs nothing from us.
 *
 * The answer latches. Correcting it makes the viewport scroll, which is
 * exactly the condition that says "leave this alone" — unlatched, the two
 * would take turns for ever.
 *
 * @param options - See {@link UnboundedViewportOptions}.
 * @returns True once the fallback bound is needed; never false again.
 *
 * @example
 * const unbounded = useUnboundedViewport({ viewportRef, rows: rows.length, enabled: virtualize, id })
 * <div className="dt-viewport" data-dt-unbounded={unbounded ? "" : undefined} ref={viewportRef} />
 */
export function useUnboundedViewport({
  viewportRef,
  rows,
  enabled,
  id,
}: UnboundedViewportOptions): boolean {
  const [unbounded, setUnbounded] = useState(false)
  const watch = enabled && rows > UNBOUNDED_MIN_ROWS

  useIsomorphicLayoutEffect(() => {
    if (!watch || unbounded) return
    const element = viewportRef.current
    if (!element) return

    const check = () => {
      /*
       * Nothing is laid out: a `display: none` ancestor, or a test environment
       * that lays nothing out at all. That is not the unbounded case — there
       * is no height to be missing yet — and clipping it here would be
       * guesswork.
       */
      if (element.clientHeight === 0) return
      if (element.scrollHeight - element.clientHeight > SCROLL_SLACK_PX) return

      setUnbounded(true)
      /*
       * `process.env.NODE_ENV` rather than `import.meta.env.DEV`, bare rather
       * than behind `typeof process`: see the warnings in `useDataTable` for
       * why either alternative would strip this from the consumer's build.
       */
      if (process.env.NODE_ENV !== "production") {
        warnOnce(
          `DataTable("${id}"): the table is rendering ${rows} rows into a viewport with no ` +
            `height of its own, so nothing scrolls and every row would be in the DOM. ` +
            `Falling back to --dt-viewport-max-height; pass the height prop, or give the table ` +
            `an ancestor with a height, to bound it yourself.`,
        )
      }
    }
    check()

    /*
     * A table revealed from a hidden ancestor, or one whose host rearranges
     * the page around it, gets no render of its own to be checked in — the
     * box's own size change is the only signal there is. The observer is
     * dropped the moment the answer latches, which is also what stops the
     * correction's own resize from being read as a fresh question.
     */
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(check)
    observer.observe(element)
    return () => observer.disconnect()
  }, [watch, unbounded, viewportRef, rows, id])

  return unbounded
}
