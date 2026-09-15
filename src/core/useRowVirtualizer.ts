import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual"
import { useCallback, useMemo, useRef, useState, type RefObject } from "react"
import { buildDisplayList, displayItemKey, spacerSizes, type DisplayItem } from "./virtualRows"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

/** A guess for a detail panel until it is measured. */
const DETAIL_ESTIMATE_PX = 160
const DEFAULT_OVERSCAN = 8
/** Rows rendered from the top while the viewport has no size yet. */
const UNMEASURED_WINDOW = 40
/** Stable no-op for the disabled path, so `measureElement` does not re-attach its ref every render. */
const NOOP_MEASURE = () => undefined
/** Stable empty window for the disabled path, so the drift check has nothing to look at. */
const NO_VIRTUAL_ITEMS: readonly VirtualItem[] = []

/** Options for {@link useRowVirtualizer}. */
export interface RowVirtualizerOptions<TRow extends { id: string; original: unknown }> {
  rows: readonly TRow[]
  /** The scrolling element. */
  viewportRef: RefObject<HTMLElement | null>
  /** The `<thead>`, whose height offsets every row inside the same scroll box. */
  headRef: RefObject<HTMLElement | null>
  rowHeight: number
  getRowHeight?: ((row: TRow["original"]) => number) | undefined
  isDetailOpen: (row: TRow) => boolean
  /** False renders everything, with no spacers. */
  enabled: boolean
  overscan?: number
  /**
   * Smallest leading window to render while the viewport has no size — pass
   * the page size, so a server-rendered page carries all of its rows.
   *
   * Counts display items, panels included. Defaults to none, and the window
   * is never shorter than the built-in one described below.
   */
  unmeasuredFloor?: number | undefined
}

/** One item to render, with its position in the display list. */
export interface RenderedItem<TRow> {
  item: DisplayItem<TRow>
  /** Index in the display list; detail rows need it for measurement. */
  index: number
}

/** What {@link useRowVirtualizer} returns: the window to render and its spacers. */
export interface RowVirtualizerResult<TRow> {
  items: RenderedItem<TRow>[]
  top: number
  bottom: number
  /** Attach to detail rows (with `data-index`) so their height is measured. */
  measureElement: (element: HTMLElement | null) => void
}

/**
 * Which rows to render, and how much empty space to leave around them.
 *
 * Data rows are never measured: their height is `rowHeight` or
 * `getRowHeight(row)`, so the scrollbar is exact by construction. Detail
 * panels are the exception and are measured on mount and on resize.
 *
 * An unmeasured viewport renders a leading window instead of nothing.
 * virtual-core sizes the scroll element from `offsetHeight`, and with an outer
 * size of 0 it has no range to compute, so `getVirtualItems()` comes back
 * empty. That state is real: the first frame before the ResizeObserver reports,
 * a table inside a `display: none` ancestor, or a test environment that lays
 * nothing out. Rendering nothing there means a table that is revealed shows
 * blank until it scrolls, and a jsdom test sees no rows at all. The first
 * {@link UNMEASURED_WINDOW} items cover a tall viewport and cost little.
 * This library's own jsdom suites depend on it — nothing has a size there — so
 * the cap must stay at or above the row counts those fixtures render.
 * A paged table raises the cap to its page size through `unmeasuredFloor`,
 * since a page rendered short on the server is a page with rows missing from
 * the HTML a crawler (or a browser before hydration) is given.
 *
 * Preconditions:
 * - `isDetailOpen` must be referentially stable (e.g. wrapped in
 *   `useCallback`). An inline arrow is a new function every render, which
 *   rebuilds the display list and forces an O(n) measurement pass each time.
 * - `getRowHeight` needs no such stability — an inline arrow is fine — but it
 *   must be a pure function of its row. Its identity is deliberately not a
 *   measurement input (see {@link useHeightDrift}); a policy that starts
 *   answering differently is noticed from the rows on screen instead.
 * - `rowHeight` / `getRowHeight` must equal the rendered row's border-box
 *   height exactly. Data rows are never measured, so even a 1px discrepancy
 *   accumulates across rows into a wrong scrollbar height.
 * - `headRef` must point at an element that mounts in the same commit as the
 *   body. The effect that reads its height runs once per ref identity, not
 *   on every render, so a header appearing later keeps a stale `scrollMargin`.
 *
 * @example
 * const { items, top, bottom, measureElement } = useRowVirtualizer({ ... })
 */
export function useRowVirtualizer<TRow extends { id: string; original: unknown }>({
  rows,
  viewportRef,
  headRef,
  rowHeight,
  getRowHeight,
  isDetailOpen,
  enabled,
  overscan = DEFAULT_OVERSCAN,
  unmeasuredFloor,
}: RowVirtualizerOptions<TRow>): RowVirtualizerResult<TRow> {
  const items = useMemo(() => buildDisplayList(rows, isDetailOpen), [rows, isDetailOpen])
  const scrollMargin = useElementHeight(headRef)
  useViewportLookup(enabled)
  /*
   * Bumped when the rows on screen show that the height function has started
   * answering differently. `getItemKey` depends on it, and a new key function
   * is what makes virtual-core measure again — see {@link useHeightDrift}.
   */
  const [heightVersion, setHeightVersion] = useState(0)
  const onHeightDrift = useCallback(() => setHeightVersion((version) => version + 1), [])

  /** The height an item is supposed to have, shared by the estimate and the drift check. */
  const heightOf = useCallback(
    (item: DisplayItem<TRow>) =>
      item.kind === "detail" ? DETAIL_ESTIMATE_PX : (getRowHeight?.(item.row.original) ?? rowHeight),
    [rowHeight, getRowHeight],
  )
  // The virtualiser only ever asks for indices within [0, items.length) — the
  // `count` it was given — so `items[index]` below is always in range. The
  // guard in `estimateSize` stays because it must return a number
  // unconditionally; the other two accesses rely on the same guarantee via `!`.
  const estimateSize = useCallback(
    (index: number) => {
      const item = items[index]
      return item ? heightOf(item) : rowHeight
    },
    [items, rowHeight, heightOf],
  )
  // virtual-core re-measures only when `getItemKey` changes identity — not when
  // `estimateSize` does (see its getMeasurementOptions memo deps) — so the
  // height inputs belong in this callback's deps too, or a `rowHeight` change
  // with the same `rows` would keep stale sizes. `getRowHeight` is represented
  // by `heightVersion` rather than by its own identity, which would re-measure
  // every item on every host render; {@link useHeightDrift} is what moves the
  // version. A key change keeps measured detail heights, since the cache is
  // keyed by item key; `virtualizer.measure()` would throw them away instead.
  const getItemKey = useCallback(
    (index: number) => displayItemKey(items[index]!),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
    [items, rowHeight, heightVersion],
  )

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    estimateSize,
    getItemKey,
    overscan,
    scrollMargin,
    enabled,
  })

  // Reading the window is the virtualiser's own work, and there is none to do
  // while it is off; the drift check then has nothing to look at either.
  const virtualItems = enabled ? virtualizer.getVirtualItems() : NO_VIRTUAL_ITEMS
  useHeightDrift(items, virtualItems, heightOf, onHeightDrift)

  if (!enabled) {
    return {
      items: items.map((item, index) => ({ item, index })),
      top: 0,
      bottom: 0,
      measureElement: NOOP_MEASURE,
    }
  }

  /*
   * Rows to show but no window to show them in: the viewport has no size yet,
   * so there is no range. `measurementsCache` holds the same item geometry the
   * measured path uses — `getVirtualItems()` above has just filled it — so the
   * spacers are exact rather than a second, divergent sum.
   */
  if (virtualItems.length === 0 && items.length > 0) {
    const count = Math.min(items.length, Math.max(UNMEASURED_WINDOW, floorOf(unmeasuredFloor)))
    const measurements = virtualizer.measurementsCache
    const { top, bottom } = spacerSizes(
      measurements[0],
      measurements[count - 1],
      virtualizer.getTotalSize(),
      scrollMargin,
    )
    return {
      items: items.slice(0, count).map((item, index) => ({ item, index })),
      top,
      bottom,
      measureElement: virtualizer.measureElement,
    }
  }

  const { top, bottom } = spacerSizes(
    virtualItems[0],
    virtualItems[virtualItems.length - 1],
    virtualizer.getTotalSize(),
    scrollMargin,
  )
  return {
    // in range — see the note above `estimateSize`
    items: virtualItems.map((virtualItem) => ({ item: items[virtualItem.index]!, index: virtualItem.index })),
    top,
    bottom,
    measureElement: virtualizer.measureElement,
  }
}

/**
 * Measure again when the height function starts answering differently.
 *
 * `getItemKey` deliberately does not depend on `getRowHeight`'s identity. An
 * inline arrow — the form a host writes without thinking about it, and the
 * form this library's own README shows — is a new function on every render,
 * and virtual-core keys its measurement pass on `getItemKey` by identity, so
 * every render would re-key and re-estimate every item in the list: an O(n)
 * sweep of a 100 000-row table for a render that changed nothing. Identity is
 * the wrong question anyway. It says a function was rebuilt, not that it
 * answers differently.
 *
 * The rows on screen answer the right question. A data row is never measured,
 * so its item size IS what the height function returned during the last
 * measurement pass; when the two disagree, the heights have changed under the
 * virtualiser and every offset past them is stale. The correction is made in a
 * layout effect, so it costs a render but no visible frame.
 *
 * One correction per clean render. A height function that is not a pure
 * function of its row — one reading the clock, say — would otherwise disagree
 * with every fresh measurement and re-render for ever. It gets one correction,
 * then nothing until a render agrees with its own heights again.
 *
 * @param items - The display list, indexed by the rendered items' `index`.
 * @param rendered - The window virtual-core is showing, with its item sizes.
 * @param heightOf - The height an item is supposed to have right now.
 * @param onDrift - Called once when the two disagree.
 */
function useHeightDrift<TRow>(
  items: readonly DisplayItem<TRow>[],
  rendered: readonly VirtualItem[],
  heightOf: (item: DisplayItem<TRow>) => number,
  onDrift: () => void,
): void {
  const corrected = useRef(false)
  useIsomorphicLayoutEffect(() => {
    const drifted = rendered.some((virtualItem) => {
      const item = items[virtualItem.index]
      // Detail panels are measured, so their size is meant to differ from the estimate.
      return item !== undefined && item.kind === "row" && heightOf(item) !== virtualItem.size
    })
    if (!drifted) {
      corrected.current = false
      return
    }
    if (corrected.current) return
    corrected.current = true
    onDrift()
  })
}

/**
 * A caller-supplied window floor, or none.
 *
 * Sanitised rather than trusted: this is a public option, and a `NaN` from a
 * host sizing pages off an element it has not measured would travel through
 * `Math.max` into `slice(0, NaN)` and render no rows at all.
 *
 * @param floor - The requested floor, if any.
 * @returns A whole, non-negative count; 0 when there is nothing usable.
 */
function floorOf(floor: number | undefined): number {
  if (floor === undefined || !Number.isFinite(floor)) return 0
  return Math.max(0, Math.trunc(floor))
}

/**
 * Render once more right after mounting, so the viewport can be found.
 *
 * The scrolling viewport is an ANCESTOR of the rows, and React attaches a
 * parent's ref only after its children's layout effects have run, so the
 * virtualiser's first look for its scroll element finds null. The adapter
 * re-reads `getScrollElement()` on every render — its layout effect has no
 * dependency array — so nothing is stuck except for the want of a second
 * render, which is what this supplies. In a browser one usually arrives
 * anyway, from `useElementHeight(headRef)` reporting the header's height as it
 * goes from 0 to its real value; the bump is what makes a header-less table,
 * and jsdom, work as well. A state change made from a layout effect is
 * flushed before paint, so it costs a render but no visible frame.
 *
 * @param enabled - Whether virtualisation is on; there is nothing to look for
 *   otherwise, and the extra render would be pure waste.
 */
function useViewportLookup(enabled: boolean): void {
  const [, look] = useState(0)
  useIsomorphicLayoutEffect(() => {
    if (enabled) look((n) => n + 1)
  }, [enabled])
}

/** The rendered height of an element, kept current with a ResizeObserver when one exists. */
function useElementHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0)
  useIsomorphicLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setHeight(element.offsetHeight)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return height
}
