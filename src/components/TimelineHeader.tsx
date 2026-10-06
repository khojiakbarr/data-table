import { useMemo, useRef } from "react"
import { classNames } from "../core/classNames"
import { dayMarks, monthSpans, pointX, type TimelineMarker, type TimelineState } from "../core/timeline"
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
      const start = element.getBoundingClientRect().left - viewport.getBoundingClientRect().left + viewport.scrollLeft
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
        <div className="dt-timeline-days">
          {ticks.map((tick) => (
            <span
              key={tick.day}
              className={classNames(
                "dt-timeline-day",
                scale.zoom === "day" && "dt-timeline-day-cell",
                scale.zoom === "day" && tick.weekday >= 5 && "dt-timeline-weekend",
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
