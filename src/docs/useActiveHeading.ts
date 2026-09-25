import { useEffect, useState } from "react"

/**
 * How far down the viewport a heading has to scroll before it counts as the
 * one being read, as a fraction of the viewport's height. A quarter keeps a
 * heading "current" while its first paragraphs are on screen, rather than
 * handing over the instant the next heading peeks in at the bottom.
 */
const READING_LINE = 0.25

/** The last id whose element has scrolled above the reading line. */
function headingAtReadingLine(ids: readonly string[]): string | undefined {
  const line = window.innerHeight * READING_LINE
  // At the very bottom the last headings can never reach the line, so the
  // final one wins outright — otherwise the last topic could never be current.
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
  if (atBottom) return ids[ids.length - 1]

  let current: string | undefined = ids[0]
  for (const id of ids) {
    const element = document.getElementById(id)
    if (!element) continue
    if (element.getBoundingClientRect().top > line) break
    current = id
  }
  return current
}

/**
 * Which of a list of in-page anchors the reader is currently in — the
 * scroll-spy behind the sidebar's and the on-this-page list's highlight.
 *
 * Measured on scroll, throttled to one read per frame, rather than with an
 * IntersectionObserver: an observer reports headings entering and leaving a
 * band, and a long topic whose heading has scrolled out of every band would
 * leave nothing current. "The last heading above a line" has no such gap.
 *
 * @param ids - Anchor ids in document order.
 * @returns The id being read, or undefined before the page has any of them.
 *
 * @example
 * const active = useActiveHeading(["install", "first-table"])
 */
export function useActiveHeading(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0])

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      setActive(headingAtReadingLine(ids))
    }
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
    }
  }, [ids])

  return active
}
