import { useEffect, useRef } from "react"

/**
 * The box the list scrolls in: the table's viewport while it scrolls (a `height`), else the page (null). A viewport
 * with no height of its own grows with its cards, so in its own box the mark is always in view and every page would
 * be asked for at once; watched against the page, it is in view only once the list is scrolled to its end, and an
 * app's own scrolling area still clips it. Read afresh each time more cards are drawn.
 */
function scrollingBox(mark: HTMLElement): HTMLElement | null {
  const viewport = mark.closest<HTMLElement>(".dt-viewport")
  return viewport !== null && viewport.scrollHeight > viewport.clientHeight ? viewport : null
}

/**
 * The mark after the last card: in view — or within 300px of it, while the list scrolls in a box of its own (see
 * {@link scrollingBox}) — it asks for the next page. Watched afresh each time more cards are drawn, so a mark still in view after a short page asks
 * again rather than waiting for a scroll that will never come.
 */
export function MoreRowsMark({ onVisible, drawn }: { onVisible: () => void; drawn: number }) {
  const ref = useRef<HTMLDivElement>(null)
  // The latest ask, without watching afresh when only the function changed.
  const ask = useRef(onVisible)
  useEffect(() => {
    ask.current = onVisible
  })
  useEffect(() => {
    const mark = ref.current
    if (mark === null || typeof IntersectionObserver === "undefined") return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) ask.current()
      },
      { root: scrollingBox(mark), rootMargin: "0px 0px 300px 0px" },
    )
    observer.observe(mark)
    return () => observer.disconnect()
  }, [drawn])
  return <div ref={ref} className="dt-cards-more" aria-hidden="true" />
}
