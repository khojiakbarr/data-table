import type { CSSProperties, MouseEvent, ReactNode } from "react"
import { classNames } from "../core/classNames"
import {
  barBox,
  dayNumber,
  gridStyle,
  pointX,
  type TimelineItem,
  type TimelineScale,
  type TimelineState,
  type TimelineTone,
} from "../core/timeline"
import { warnOnce } from "../core/warnOnce"
import { placedMarkers } from "./TimelineHeader"

interface TimelineCellProps<TData> {
  timeline: TimelineState<TData>
  /**
   * The record whose items are drawn. None for a group row, which carries the
   * grid and the markers alone — so a marker's line runs unbroken past it and
   * the weeks stay ruled across it.
   */
  row?: TData | undefined
}

/**
 * The grid, built once per scale. Every row of a table draws the same one,
 * and the scale object only changes when the range, the zoom or the day width
 * does (`useDataTable` memoises it), so this is one computation per zoom
 * rather than one per row per render.
 */
const grids = new WeakMap<TimelineScale, CSSProperties>()

function gridOf(scale: TimelineScale): CSSProperties {
  const cached = grids.get(scale)
  if (cached) return cached
  const style = gridStyle(scale)
  grids.set(scale, style)
  return style
}

/**
 * Plans under the work done, the work done under its overrun, and the days
 * on top — whatever order the host listed them in, so an overrun is never
 * hidden under the bar it overruns.
 */
const DRAW_ORDER = { plan: 0, actual: 1, overrun: 2, point: 3 } as const
const drawRank = (item: TimelineItem): number => (item.kind === "point" ? DRAW_ORDER.point : DRAW_ORDER[item.variant])

/**
 * One row's stretch of the timeline: its grid, its items and a line for each
 * marker — the lines of every row together making the marker run the height
 * of the body, with nothing outside the row to keep in step with the scroll
 * or the virtual window.
 *
 * Without `onItemClick` the drawing is one picture: named by its items'
 * titles when they have any, and hidden from a screen reader when they have
 * none, since the table's own columns say the same dates in words. With it,
 * each item is a button named by its title. A group row's stretch has no
 * items and is always hidden.
 */
export function TimelineCell<TData>({ timeline, row }: TimelineCellProps<TData>) {
  const drawn = row === undefined ? undefined : drawItems(timeline, row)
  return (
    <div className="dt-timeline-row" style={gridOf(timeline.scale)} {...(drawn?.picture ?? { "aria-hidden": true })}>
      {drawn?.nodes}
      {placedMarkers(timeline).map(({ marker, x }) => (
        <span
          key={`${marker.date}-${marker.label}`}
          className={classNames("dt-timeline-marker", `dt-timeline-tone-${marker.tone}`, marker.dashed && "dt-timeline-marker-dashed")}
          style={{ left: x }}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}

interface TimelineBodyCellProps<TData> {
  columnId: string
  /** The pane; undefined draws the cell empty, for a table whose pane has no valid scale this render. */
  timeline: TimelineState<TData> | undefined
  /** The record, or none for a group row. */
  row?: TData | undefined
}

/**
 * The body cell the pane is drawn in, a record's row's or a group's — one
 * place for the class the stylesheet keys the row's separator on.
 *
 * No cell menu and no editing: the pane draws what the host's own columns
 * hold, and has no value of its own to edit.
 */
export function TimelineBodyCell<TData>({ columnId, timeline, row }: TimelineBodyCellProps<TData>) {
  return (
    <td className="dt-td dt-timeline-cell" data-column-id={columnId}>
      {timeline === undefined ? null : <TimelineCell timeline={timeline} row={row} />}
    </td>
  )
}

/** How a screen reader takes a row's drawing: a named picture, nothing at all, or (empty) its buttons. */
type Picture = { role: "img"; "aria-label": string } | { "aria-hidden": true } | Record<string, never>

/**
 * A record's items, in draw order, as spans — or as buttons when the host
 * listens for a click — and how the drawing as a whole is announced.
 *
 * @param timeline - The pane.
 * @param row - The record.
 * @returns The items' nodes and the drawing's accessible shape.
 */
function drawItems<TData>({ scale, options }: TimelineState<TData>, row: TData): { nodes: ReactNode[]; picture: Picture } {
  const items = [...options.getItems(row)].sort((a, b) => drawRank(a) - drawRank(b))
  const onItemClick = options.onItemClick
  const titles = items.flatMap((item) => (item.title ? [item.title] : []))
  const picture: Picture = onItemClick
    ? {}
    : titles.length > 0
      ? { role: "img", "aria-label": titles.join("; ") }
      : { "aria-hidden": true }
  const nodes = items.map((item, index) => {
    const placed = place(item, scale)
    if (!placed) return null
    if (!onItemClick) {
      return (
        <span key={index} className={placed.className} style={placed.style} title={item.title}>
          {placed.children}
        </span>
      )
    }
    if (process.env.NODE_ENV !== "production" && !item.title) {
      warnOnce("timeline: with onItemClick every item is a button, and an item without a title is a button with no name.")
    }
    return (
      <button
        key={index}
        type="button"
        className={classNames(placed.className, "dt-timeline-button")}
        style={placed.style}
        title={item.title}
        aria-label={item.title}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          // The row's own click (a host's `onRowClick`) is a different action.
          event.stopPropagation()
          onItemClick(item, row)
        }}
      >
        {placed.children}
      </button>
    )
  })
  return { nodes, picture }
}

interface Placed {
  className: string
  style: CSSProperties
  children: ReactNode
}

/** 0–100, whatever was passed; a missing or non-numeric progress is none. */
const progressOf = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, value))

/**
 * Whether an item names days that exist, the right way round. An item outside
 * the range is simply not drawn; one whose days are not days is a host's bug —
 * a `Date` passed whole, a `DD.MM.YYYY` string, an end before its start — and
 * it vanishes exactly the same way, so it is said, once, in development.
 *
 * @param item - A bar or a point.
 * @returns True when it can be placed.
 */
function isWellFormed(item: TimelineItem): boolean {
  if (item.kind === "point") return dayNumber(item.date) !== null
  const start = dayNumber(item.start)
  const end = dayNumber(item.end)
  return start !== null && end !== null && end >= start
}

/**
 * Where an item goes and how it looks, or null when it is not on the pane.
 *
 * @param item - A bar or a point.
 * @param scale - The pane's scale.
 * @returns Its class, position and content.
 */
function place(item: TimelineItem, scale: TimelineScale): Placed | null {
  if (process.env.NODE_ENV !== "production" && !isWellFormed(item)) {
    warnOnce(
      item.kind === "point"
        ? `timeline: a point on "${String(item.date)}" is not drawn — a day is "YYYY-MM-DD".`
        : `timeline: a bar "${String(item.start)}" – "${String(item.end)}" is not drawn — days are "YYYY-MM-DD", and the end is not before the start.`,
    )
  }
  if (item.kind === "bar") {
    const box = barBox(scale, item.start, item.end)
    if (!box) return null
    const tone: TimelineTone = item.tone ?? (item.variant === "overrun" ? "danger" : "primary")
    return {
      className: classNames(
        "dt-timeline-item",
        "dt-timeline-bar",
        `dt-timeline-${item.variant}`,
        item.size === "thick" && "dt-timeline-thick",
        `dt-timeline-tone-${tone}`,
        box.clippedStart && "dt-timeline-clip-start",
        box.clippedEnd && "dt-timeline-clip-end",
      ),
      style: { left: box.left, width: box.width },
      // Only work under way is filled to its progress: done is drawn whole, in its own colour.
      children:
        item.variant === "actual" && tone === "primary" ? (
          <span className="dt-timeline-progress" style={{ width: `${progressOf(item.progress)}%` }} />
        ) : null,
    }
  }
  const x = pointX(scale, item.date, item.shape === "dot" ? "middle" : "end")
  if (x === null) return null
  const tone: TimelineTone = item.tone ?? (item.shape === "dot" ? "success" : "neutral")
  return {
    className: classNames("dt-timeline-item", "dt-timeline-point", `dt-timeline-${item.shape}`, `dt-timeline-tone-${tone}`),
    style: { left: x },
    children: null,
  }
}
