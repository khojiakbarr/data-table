import { useVirtualizer } from "@tanstack/react-virtual"
import { useCallback, useMemo, useState, type RefObject } from "react"
import { buildDisplayList, displayItemKey, spacerSizes, type DisplayItem } from "./virtualRows"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

/** A guess for a detail panel until it is measured. */
const DETAIL_ESTIMATE_PX = 160
const DEFAULT_OVERSCAN = 8
/** Rows rendered from the top while the viewport has no size yet. */
const UNMEASURED_WINDOW = 40
/** Stable no-op for the disabled path, so `measureElement` does not re-attach its ref every render. */
const NOOP_MEASURE = () => undefined

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
 *
 * Preconditions:
 * - `isDetailOpen` must be referentially stable (e.g. wrapped in
 *   `useCallback`). An inline arrow is a new function every render, which
 *   rebuilds the display list and forces an O(n) measurement pass each time.
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
}: RowVirtualizerOptions<TRow>): RowVirtualizerResult<TRow> {
  const items = useMemo(() => buildDisplayList(rows, isDetailOpen), [rows, isDetailOpen])
  const scrollMargin = useElementHeight(headRef)
  useViewportLookup()

  // The virtualiser only ever asks for indices within [0, items.length) — the
  // `count` it was given — so `items[index]` below is always in range. The
  // guard in `estimateSize` stays because it must return a number
  // unconditionally; the other two accesses rely on the same guarantee via `!`.
  const estimateSize = useCallback(
    (index: number) => {
      const item = items[index]
      if (!item) return rowHeight
      if (item.kind === "detail") return DETAIL_ESTIMATE_PX
      return getRowHeight?.(item.row.original) ?? rowHeight
    },
    [items, rowHeight, getRowHeight],
  )
  // virtual-core re-measures only when `getItemKey` changes identity — not when
  // `estimateSize` does (see its getMeasurementOptions memo deps) — so the
  // height inputs belong in this callback's deps too, or a `rowHeight` /
  // `getRowHeight` change with the same `rows` would keep stale sizes. A key
  // change keeps measured detail heights, since the cache is keyed by item
  // key; `virtualizer.measure()` would throw them away instead.
  const getItemKey = useCallback(
    (index: number) => displayItemKey(items[index]!),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
    [items, rowHeight, getRowHeight],
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

  if (!enabled) {
    return {
      items: items.map((item, index) => ({ item, index })),
      top: 0,
      bottom: 0,
      measureElement: NOOP_MEASURE,
    }
  }

  /*
   * `scrollRect` is virtual-core's own record of the scroll element's size,
   * filled from `offsetWidth`/`offsetHeight` — not `getBoundingClientRect` —
   * and left null until the element is observed. Either state means no range,
   * so fall back to a leading window rather than an empty body.
   */
  const scrollRect = virtualizer.scrollRect
  if (!scrollRect || scrollRect.height === 0) {
    const count = Math.min(items.length, UNMEASURED_WINDOW)
    let renderedHeight = 0
    for (let index = 0; index < count; index++) renderedHeight += estimateSize(index)
    return {
      items: items.slice(0, count).map((item, index) => ({ item, index })),
      top: 0,
      bottom: Math.max(0, virtualizer.getTotalSize() - renderedHeight),
      measureElement: virtualizer.measureElement,
    }
  }

  const virtualItems = virtualizer.getVirtualItems()
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
 * Render once more right after mounting, so the viewport can be found.
 *
 * The scrolling viewport is an ANCESTOR of the rows, and React attaches a
 * parent's ref only after its children's layout effects have run. The
 * virtualiser looks for its scroll element in a layout effect of its own, so
 * on the first commit it finds null — and, with nothing else to prompt it, it
 * would never look again. A state change made from a layout effect is flushed
 * before paint, so the second look costs a render but no visible frame.
 */
function useViewportLookup(): void {
  const [, look] = useState(0)
  useIsomorphicLayoutEffect(() => look(1), [])
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
