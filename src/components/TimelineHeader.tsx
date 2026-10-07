import { useMemo, useRef, useState, type RefObject } from "react"
import { classNames } from "../core/classNames"
import { coveredMarks, cutMonths, dayMarks, monthSpans, pointX, type MonthSpan, type TimelineMarker, type TimelineState } from "../core/timeline"
import { useIsomorphicLayoutEffect } from "../core/useIsomorphicLayoutEffect"
import type { DataTableLabels } from "../types"

interface TimelineHeaderProps<TData> {
  timeline: TimelineState<TData>
  labels: DataTableLabels
  /**
   * How wide the start-pinned columns are. A month's name sticks at this edge
   * while its month scrolls under them, and `scrollTo` lands past them.
   */
  pinnedStartWidth: number
}

/** `07` for 7: the scale prints day and month in two digits, `07.09`. */
const twoDigits = (value: number): string => String(value).padStart(2, "0")

/**
 * The timeline's header: the months across the top, then the days (day zoom)
 * or the Mondays (week zoom) under them, and a chip for each marker at its day.
 *
 * Drawn for the eye only. The header cell is named for a screen reader by
 * `labels.timeline` and the markers' own words; the dates themselves are a
 * picture of the same days the table's columns state in text.
 *
 * A month's name sticks to the leading edge of the visible pane while the
 * month scrolls through it, so a user deep into October still reads
 * "OCT 2026" over the bars rather than nothing at all.
 */
export function TimelineHeader<TData>({ timeline, labels, pinnedStartWidth }: TimelineHeaderProps<TData>) {
  const { scale, options } = timeline
  const months = useMemo(() => monthSpans(scale), [scale])
  const ticks = useMemo(() => (scale.zoom === "month" ? [] : dayMarks(scale, scale.zoom === "week")), [scale])
  const markers = placedMarkers(timeline)
  const scaleRef = useRef<HTMLDivElement>(null)
  const daysRef = useRef<HTMLDivElement>(null)
  useMonthNamesThatFit(scaleRef, months, pinnedStartWidth)
  const covered = useCoveredDays(daysRef, `${scale.zoom}|${scale.first}|${scale.days}|${scale.dayWidth}|${markers.map(({ marker, x }) => `${x}:${marker.label}`).join(",")}`)

  /*
   * `scrollTo`, carried out when the pane appears and whenever the day it
   * names or the scale moves — the zoom, the range, the day width — and at no
   * other time: a render caused by anything else (a refetch, a row opened)
   * must not drag the pane back from wherever the user has scrolled it.
   */
  const scrollTo = options.scrollTo
  useIsomorphicLayoutEffect(() => {
    if (scrollTo === undefined) return
    const x = pointX(scale, scrollTo, "middle")
    const element = scaleRef.current
    const viewport = element?.closest(".dt-viewport")
    if (x === null || !element || !(viewport instanceof HTMLElement)) return
    const scroll = (): void => {
      const start = paneStart(element, viewport)
      const visible = Math.max(0, viewport.clientWidth - pinnedStartWidth)
      // A third of the way into the visible pane: the day, and some of what came before it.
      viewport.scrollLeft = Math.max(0, start + x - pinnedStartWidth - visible / 3)
    }
    /*
     * A viewport with no width yet — a table mounted before its stylesheet
     * landed, or inside a panel that is still opening — would put the day at
     * the pane's very edge, so the scroll waits for the first real width.
     * Where nothing can tell it (no ResizeObserver), it goes ahead.
     */
    if (viewport.clientWidth > pinnedStartWidth || typeof ResizeObserver === "undefined") {
      scroll()
      return
    }
    const observer = new ResizeObserver(() => {
      if (viewport.clientWidth <= pinnedStartWidth) return
      observer.disconnect()
      scroll()
    })
    observer.observe(viewport)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a pinned column resized is not a reason to scroll
  }, [scrollTo, scale])

  return (
    <>
      <span className="dt-sr-only">
        {markers.length === 0 ? labels.timeline : `${labels.timeline}: ${markers.map(({ marker }) => marker.label).join(", ")}`}
      </span>
      <div ref={scaleRef} className="dt-timeline-scale" aria-hidden="true" style={{ width: scale.width }}>
        <div className="dt-timeline-months">
          {months.map((span) => (
            <div key={`${span.year}-${span.month}`} className="dt-timeline-month" style={{ left: span.left, width: span.width }}>
              <span className="dt-timeline-month-label" style={{ insetInlineStart: pinnedStartWidth }}>
                {labels.timelineMonth(span.month)} {span.year}
              </span>
            </div>
          ))}
        </div>
        <div ref={daysRef} className="dt-timeline-days">
          {ticks.map((tick, index) => (
            <span
              key={tick.day}
              className={classNames(
                "dt-timeline-day",
                scale.zoom === "day" && "dt-timeline-day-cell",
                scale.zoom === "day" && tick.weekday >= 5 && "dt-timeline-weekend",
                covered.has(index) && "dt-timeline-day-covered",
              )}
              style={scale.zoom === "day" ? { left: tick.left, width: scale.dayWidth } : { left: tick.left }}
            >
              {scale.zoom === "day" ? tick.date : `${twoDigits(tick.date)}.${twoDigits(tick.month + 1)}`}
            </span>
          ))}
          {markers.map(({ marker, x }) => (
            <span key={`${marker.date}-${marker.label}`} className={classNames("dt-timeline-chip", `dt-timeline-tone-${marker.tone}`)} style={{ left: x }}>
              {marker.label}
            </span>
          ))}
        </div>
      </div>
    </>
  )
}

/**
 * Where the pane starts inside the viewport's scrolled content, in pixels.
 *
 * @param scale - The scale's element.
 * @param viewport - The table's scrolling viewport.
 * @returns The pane's left edge, the same whatever the scroll.
 */
function paneStart(scale: HTMLElement, viewport: HTMLElement): number {
  return scale.getBoundingClientRect().left - viewport.getBoundingClientRect().left + viewport.scrollLeft
}

/**
 * Hides a month's name while the part of its month on screen is narrower than
 * the name (`cutMonths`), as the pane scrolls, the viewport resizes or the
 * months change. Written to the DOM as `data-dt-cut`, not through React state:
 * a scroll is many events a second, and a render per event for a few names
 * would cost the whole header.
 *
 * @param scaleRef - The scale's element.
 * @param months - The months drawn, in order.
 * @param pinnedStartWidth - The pinned columns' width, which hides the pane's start.
 */
function useMonthNamesThatFit(scaleRef: RefObject<HTMLDivElement | null>, months: readonly MonthSpan[], pinnedStartWidth: number): void {
  useIsomorphicLayoutEffect(() => {
    const element = scaleRef.current
    const viewport = element?.closest(".dt-viewport")
    if (!element || !(viewport instanceof HTMLElement)) return
    let frame = 0
    const fit = (): void => {
      frame = 0
      const labels = [...element.querySelectorAll<HTMLElement>(".dt-timeline-month-label")]
      const from = viewport.scrollLeft + pinnedStartWidth - paneStart(element, viewport)
      const cut = new Set(cutMonths(months, labels.map((label) => label.offsetWidth), from, from - pinnedStartWidth + viewport.clientWidth))
      labels.forEach((label, index) => label.toggleAttribute("data-dt-cut", cut.has(index)))
    }
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(fit)
    }
    fit()
    viewport.addEventListener("scroll", schedule, { passive: true })
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule)
    observer?.observe(viewport)
    return () => {
      viewport.removeEventListener("scroll", schedule)
      observer?.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [scaleRef, months, pinnedStartWidth])
}

/**
 * The day marks a marker's chip covers, measured once the scale is drawn and
 * again whenever what it holds changes (`layout`: the zoom, the range, the day
 * width, the chips). A chip's width is its text's, which only the browser
 * knows; a date half hidden under "Today 29.09" read as "05.1", so a covered
 * date is hidden and its line kept.
 *
 * @param days - The strip holding the dates and the chips.
 * @param layout - A key that changes whenever the dates or the chips move.
 * @returns The indexes of the covered marks, in the strip's order.
 */
function useCoveredDays(days: RefObject<HTMLDivElement | null>, layout: string): ReadonlySet<number> {
  const [covered, setCovered] = useState<ReadonlySet<number>>(() => new Set())
  useIsomorphicLayoutEffect(() => {
    const strip = days.current
    if (!strip) return
    const marks = [...strip.querySelectorAll<HTMLElement>(".dt-timeline-day")].map((mark) => ({ left: mark.offsetLeft, width: mark.offsetWidth }))
    // A chip is centred on its line by a translate, which `offsetLeft` does not count: its left IS its centre.
    const chips = [...strip.querySelectorAll<HTMLElement>(".dt-timeline-chip")].map((chip) => ({ center: chip.offsetLeft, width: chip.offsetWidth }))
    const next = coveredMarks(marks, chips)
    setCovered((current) => (current.size === next.length && next.every((index) => current.has(index)) ? current : new Set(next)))
  }, [days, layout])
  return covered
}

/** A marker with the x it stands at. */
export interface PlacedMarker {
  marker: TimelineMarker
  x: number
}

/**
 * The markers that fall inside the pane, with where each one stands — the
 * same answer for the header's chips and every row's line.
 *
 * @param timeline - The pane.
 * @returns The markers on screen, in the host's order.
 */
export function placedMarkers<TData>({ scale, options }: TimelineState<TData>): PlacedMarker[] {
  return (options.markers ?? []).flatMap((marker) => {
    const x = pointX(scale, marker.date, marker.at ?? "middle")
    return x === null ? [] : [{ marker, x }]
  })
}
