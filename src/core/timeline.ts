import type { ColumnDef, RowData } from "@tanstack/react-table"
import type { CSSProperties } from "react"
import type { DataTableFeatures } from "../useDataTable"
import type { IsoDay } from "./filters"

/**
 * The timeline pane: a time scale after a table's columns, each row drawing
 * its plan, what actually happened and the days in between as bars and points.
 *
 * Everything here is calendar arithmetic and geometry — no React, no DOM — so
 * the parts that are easy to get subtly wrong (an inclusive end, a clipped
 * edge, a month of 28 days, a week that starts before the range does) are
 * tested on their own. The pane itself is `TimelineHeader` and `TimelineCell`.
 *
 * Days are CALENDAR days, never instants: an `IsoDay` names a date on a wall
 * calendar, and the same string must land on the same column for every user
 * whatever their time zone. So a day becomes a day number through `Date.UTC`
 * — days since 1970-01-01 in a calendar that has no offset — and never through
 * local midnight, which would shift a column wherever a daylight-saving change
 * fell inside the range.
 */

/** How much room a day gets: a column a day, a week of narrow days, or a month of thin ones. */
export type TimelineZoom = "day" | "week" | "month"

/**
 * The colour an item or a marker is drawn in. `primary` is work under way,
 * `success` work done, `danger` something late, `neutral` a plain fact — a
 * due day, a deadline.
 */
export type TimelineTone = "primary" | "success" | "danger" | "neutral"

/**
 * A span of days on a row.
 *
 * `start` and `end` are both INCLUSIVE: `start === end` is a one-day bar, the
 * way a plan "01.09 – 01.09" reads to the person who typed it. Every member
 * below is written `?: T | undefined`, as the rest of this library's options
 * are, because `exactOptionalPropertyTypes` otherwise refuses the natural
 * call site `tone: done ? "success" : undefined`.
 */
export interface TimelineBar {
  kind: "bar"
  start: IsoDay
  end: IsoDay
  /**
   * `plan` — a dashed outline of what was planned; `actual` — what happened,
   * filled to `progress`; `overrun` — the days past the plan, striped red.
   * Drawn in that order, so a row's overrun lies over its actual bar.
   */
  variant: "plan" | "actual" | "overrun"
  /** `actual` only: `primary` (under way, filled to `progress`) by default, `success` once done. */
  tone?: TimelineTone | undefined
  /** `actual` only: how far the work is, 0–100. Values outside are clamped. */
  progress?: number | undefined
  /** `thick` for a row that sums the rows under it — a department over its steps. */
  size?: "regular" | "thick" | undefined
  /** The item's tooltip, and — with `onItemClick` — its accessible name. */
  title?: string | undefined
}

/**
 * One day on a row: a `dot` in the middle of the day (a payment) or a `tick`
 * at its end (a due day, which lasts until the day is over).
 */
export interface TimelinePoint {
  kind: "point"
  date: IsoDay
  shape: "dot" | "tick"
  /** `success` for a dot and `neutral` for a tick by default. */
  tone?: TimelineTone | undefined
  /** The item's tooltip, and — with `onItemClick` — its accessible name. */
  title?: string | undefined
}

/** Anything a row draws on the timeline. */
export type TimelineItem = TimelineBar | TimelinePoint

/**
 * A day drawn across every row, with a chip in the header naming it — today,
 * a deadline.
 */
export interface TimelineMarker {
  date: IsoDay
  /** The chip's text, which the host writes whole: «Сегодня 29.09». */
  label: string
  tone: TimelineTone
  /** A dashed line, for a day that is a limit rather than a moment (a deadline). */
  dashed?: boolean | undefined
  /**
   * Where in the day the line stands. `middle` (default) for a moment — today
   * is half over; `end` for a limit — a deadline lasts the whole day.
   */
  at?: "middle" | "end" | undefined
}

/**
 * The timeline pane, as `useDataTable({ timeline })` takes it.
 *
 * `start`, `end` and `zoom` (and `dayWidth`) decide the scale; the column is
 * rebuilt only when one of them changes. Everything else is read on every
 * render, so inline functions are fine.
 */
export interface TimelineOptions<TData> {
  /** The first day on screen. */
  start: IsoDay
  /** The last day on screen, inclusive. */
  end: IsoDay
  zoom: TimelineZoom
  /** Pixels per day, per zoom. Default `{ day: 30, week: 14, month: 5 }`. */
  dayWidth?: Partial<Record<TimelineZoom, number>> | undefined
  /** The bars and points one row draws. Called for every rendered row, so keep it cheap. */
  getItems: (row: TData) => readonly TimelineItem[]
  /** Days drawn across every row and named in the header. */
  markers?: readonly TimelineMarker[] | undefined
  /**
   * A day scrolled into view when the pane appears, and again when the day,
   * the zoom or the range changes — never on an ordinary render, where it
   * would fight the user's own scrolling. Usually today.
   */
  scrollTo?: IsoDay | undefined
  /**
   * A click on an item. With it, every item becomes a button named by its
   * `title`; without it, the drawing is a picture and nothing in it takes focus.
   */
  onItemClick?: ((item: TimelineItem, row: TData) => void) | undefined
}

/** Pixels per day at each zoom, before a host's `dayWidth`. */
export const DEFAULT_DAY_WIDTH: Readonly<Record<TimelineZoom, number>> = { day: 30, week: 14, month: 5 }

/**
 * The narrowest a bar is drawn. At the month zoom a day is 5px, and a
 * one-day bar that came out narrower than its own rounded corners would read
 * as a dot, or not at all.
 */
export const MIN_BAR_WIDTH = 4

/**
 * The timeline column's id. Prefixed like the row-number and selection
 * columns' so no id a host's definition could produce collides with it.
 */
export const TIMELINE_COLUMN_ID = "__dt_timeline"

/**
 * Whether a column is the timeline pane.
 *
 * @param columnId - Any column id.
 * @returns True for the timeline column.
 *
 * @example
 * if (isTimelineColumn(cell.column.id)) return <TimelineCell … />
 */
export function isTimelineColumn(columnId: string): boolean {
  return columnId === TIMELINE_COLUMN_ID
}

const MS_PER_DAY = 86_400_000
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * A calendar day as a whole number: days since 1970-01-01.
 *
 * Built in UTC, which has no offset and no daylight saving, so the difference
 * between two days is always a whole number of days. `setUTCFullYear` takes
 * all three fields at once for the reason `startOfLocalDay` does: the
 * `Date.UTC(year, …)` form maps a two-digit year into the 1900s.
 *
 * @param day - `YYYY-MM-DD`.
 * @returns The day number, or null for a malformed or impossible day (2026-02-30).
 *
 * @example
 * dayNumber("1970-01-02") // 1
 */
export function dayNumber(day: IsoDay): number | null {
  const parts = ISO_DAY.exec(day)
  if (!parts) return null
  const year = Number(parts[1])
  const month = Number(parts[2])
  const date = Number(parts[3])
  const stamp = new Date(0)
  stamp.setUTCFullYear(year, month - 1, date)
  // A day that does not exist rolls forward instead of failing; reading the
  // parts back is what catches it.
  if (stamp.getUTCFullYear() !== year || stamp.getUTCMonth() !== month - 1 || stamp.getUTCDate() !== date) {
    return null
  }
  return Math.round(stamp.getTime() / MS_PER_DAY)
}

/** A day number taken apart: month 0–11, weekday 0 = Monday … 6 = Sunday. */
export interface CalendarParts {
  year: number
  month: number
  date: number
  weekday: number
}

/**
 * The calendar fields of a day number.
 *
 * @param day - A day number from {@link dayNumber}.
 * @returns Its year, month (0–11), date and weekday (Monday = 0).
 */
export function calendarParts(day: number): CalendarParts {
  const stamp = new Date(day * MS_PER_DAY)
  return {
    year: stamp.getUTCFullYear(),
    month: stamp.getUTCMonth(),
    date: stamp.getUTCDate(),
    // `getUTCDay` counts from Sunday; a European week, and this scale, starts on Monday.
    weekday: (stamp.getUTCDay() + 6) % 7,
  }
}

/** How many days a month has. `month` is 0–11. */
function daysInMonth(year: number, month: number): number {
  const stamp = new Date(0)
  // Day 0 of the next month is the last day of this one.
  stamp.setUTCFullYear(year, month + 1, 0)
  return stamp.getUTCDate()
}

/** The scale every part of the pane is drawn against. */
export interface TimelineScale {
  zoom: TimelineZoom
  /** The day number of `start`. */
  first: number
  /** How many days are on screen, `start` and `end` included. */
  days: number
  /** Pixels per day. */
  dayWidth: number
  /** The pane's width: `days × dayWidth`. */
  width: number
}

/**
 * The scale for a range and a zoom.
 *
 * @param start - The first day on screen.
 * @param end - The last day on screen, inclusive.
 * @param zoom - Which day width applies.
 * @param dayWidth - The host's day widths, over {@link DEFAULT_DAY_WIDTH}.
 * @returns The scale, or null when either day is not a day, the range runs
 *   backwards, or the day width is not a positive number — the pane is then
 *   not drawn at all, rather than drawn wrong.
 *
 * @example
 * timelineScale("2026-08-31", "2026-12-07", "week") // { first: 20696, days: 99, dayWidth: 14, width: 1386, … }
 */
export function timelineScale(
  start: IsoDay,
  end: IsoDay,
  zoom: TimelineZoom,
  dayWidth?: Partial<Record<TimelineZoom, number>>,
): TimelineScale | null {
  const first = dayNumber(start)
  const last = dayNumber(end)
  if (first === null || last === null || last < first) return null
  const perDay = dayWidth?.[zoom] ?? DEFAULT_DAY_WIDTH[zoom]
  if (!Number.isFinite(perDay) || perDay <= 0) return null
  const days = last - first + 1
  return { zoom, first, days, dayWidth: perDay, width: days * perDay }
}

/** Where a bar is drawn, and whether either end runs past the pane. */
export interface BarBox {
  left: number
  width: number
  /** The bar starts before the pane: its leading corners are squared off. */
  clippedStart: boolean
  /** The bar ends after the pane: its trailing corners are squared off. */
  clippedEnd: boolean
}

/**
 * A bar's box on the scale: `x = (start − first) × dayWidth`, as wide as its
 * days INCLUDING the end day, never narrower than {@link MIN_BAR_WIDTH}.
 *
 * A bar running past either edge is cut at that edge, not dropped — a plan
 * that began before the range is still a plan in progress — and says which
 * side it was cut on, so the cut side is drawn square rather than rounded.
 *
 * @param scale - The pane's scale.
 * @param start - The bar's first day.
 * @param end - Its last day, inclusive.
 * @returns The box, or null when either day is not a day, the end comes
 *   before the start, or the whole bar lies outside the pane.
 *
 * @example
 * barBox(scale, "2026-09-01", "2026-09-05") // { left: 14, width: 70, … } at 14px a day from 31.08
 */
export function barBox(scale: TimelineScale, start: IsoDay, end: IsoDay): BarBox | null {
  const from = dayNumber(start)
  const to = dayNumber(end)
  if (from === null || to === null || to < from) return null
  const rawLeft = (from - scale.first) * scale.dayWidth
  const rawRight = (to - scale.first + 1) * scale.dayWidth
  if (rawRight <= 0 || rawLeft >= scale.width) return null
  const left = Math.max(0, rawLeft)
  const width = Math.max(MIN_BAR_WIDTH, Math.min(scale.width, rawRight) - left)
  // A widened sliver at the very end is pulled back inside rather than left hanging past the edge.
  return { left: Math.min(left, scale.width - width), width, clippedStart: rawLeft < 0, clippedEnd: rawRight > scale.width }
}

/**
 * Where a day is drawn: the middle of its column for a moment (a payment,
 * today), its trailing edge for a limit (a due day, a deadline).
 *
 * @param scale - The pane's scale.
 * @param date - The day.
 * @param at - Which point of the day.
 * @returns The x offset, or null when the day is not a day or lies outside the pane.
 */
export function pointX(scale: TimelineScale, date: IsoDay, at: "middle" | "end"): number | null {
  const day = dayNumber(date)
  if (day === null || day < scale.first || day >= scale.first + scale.days) return null
  const offset = (day - scale.first) * scale.dayWidth
  return at === "middle" ? offset + scale.dayWidth / 2 : offset + scale.dayWidth
}

/** One month's stretch of the pane: the whole month, or the part of it the range covers. */
export interface MonthSpan {
  year: number
  /** 0–11, as `labels.timelineMonth(month)` takes it. */
  month: number
  left: number
  width: number
}

/**
 * The months the pane crosses, in order. The first and last are usually
 * partial: a range from 31.08 begins with one day of August.
 *
 * @param scale - The pane's scale.
 * @returns One span per month, covering the pane edge to edge.
 */
export function monthSpans(scale: TimelineScale): MonthSpan[] {
  const spans: MonthSpan[] = []
  const last = scale.first + scale.days - 1
  let day = scale.first
  while (day <= last) {
    const { year, month, date } = calendarParts(day)
    const end = Math.min(last, day + daysInMonth(year, month) - date)
    spans.push({ year, month, left: (day - scale.first) * scale.dayWidth, width: (end - day + 1) * scale.dayWidth })
    day = end + 1
  }
  return spans
}

/** One day's mark on the scale: where its column starts and what to print over it. */
export interface DayMark {
  day: number
  left: number
  /** Day of the month, 1–31. */
  date: number
  /** 0–11. */
  month: number
  /** 0 = Monday … 6 = Sunday. */
  weekday: number
}

/**
 * Every day on the pane (the day zoom's scale), or only its Mondays (the
 * week zoom's).
 *
 * @param scale - The pane's scale.
 * @param mondaysOnly - Keep only the days a week starts on.
 * @returns The marks, left to right.
 */
export function dayMarks(scale: TimelineScale, mondaysOnly: boolean): DayMark[] {
  const marks: DayMark[] = []
  for (let offset = 0; offset < scale.days; offset += 1) {
    const day = scale.first + offset
    const { month, date, weekday } = calendarParts(day)
    if (mondaysOnly && weekday !== 0) continue
    marks.push({ day, left: offset * scale.dayWidth, date, month, weekday })
  }
  return marks
}

/** A day mark's text on the scale, as drawn: where it starts and how wide it is. */
export interface MarkBox {
  left: number
  width: number
}

/** A marker's chip, as drawn: centred on its line. */
export interface ChipBox {
  center: number
  width: number
}

/**
 * Which day marks a marker's chip lies over. The chip sits on the same strip
 * as the dates, so a "Today 29.09" over "28.09" leaves the date half shown
 * under it — the scale hides those dates instead, keeping their lines.
 *
 * @param marks - Every day mark's box, in pixels from the pane's start.
 * @param chips - Every chip's box.
 * @param gap - Room kept clear on each side of a chip.
 * @returns The indexes of the marks a chip covers.
 *
 * @example
 * coveredMarks([{ left: 0, width: 30 }, { left: 98, width: 30 }], [{ center: 110, width: 60 }], 2) // [1]
 */
export function coveredMarks(marks: readonly MarkBox[], chips: readonly ChipBox[], gap = 2): number[] {
  return marks.flatMap((mark, index) =>
    chips.some((chip) => mark.left < chip.center + chip.width / 2 + gap && mark.left + mark.width > chip.center - chip.width / 2 - gap)
      ? [index]
      : [],
  )
}

/**
 * The grid every row draws behind its items, as one set of CSS backgrounds.
 *
 * One element per row carries all of it — month lines, week lines, and at the
 * day zoom the day lines and the weekend shading — so a table of hundreds of
 * rows adds no nodes for its grid. Regular lines are one tile repeated along
 * the row and positioned on the first Monday; month lines, which are not
 * regular, are a layer each, and there are only ever a handful.
 *
 * The colours are tokens, resolved where the row is drawn, so the grid follows
 * the theme and dark mode without being rebuilt.
 *
 * @param scale - The pane's scale.
 * @returns A style object for the grid layer.
 */
export function gridStyle(scale: TimelineScale): CSSProperties {
  const layers: { image: string; size: string; position: string; repeat: string }[] = []
  const line = (color: string): string => `linear-gradient(to right, ${color} 0 1px, transparent 1px)`

  for (const span of monthSpans(scale)) {
    if (span.left === 0) continue
    layers.push({ image: line("var(--dt-timeline-grid)"), size: "1px 100%", position: `${span.left}px 0`, repeat: "no-repeat" })
  }

  const firstMonday = ((7 - calendarParts(scale.first).weekday) % 7) * scale.dayWidth
  const week = 7 * scale.dayWidth
  if (scale.zoom !== "month") {
    layers.push({ image: line("var(--dt-border)"), size: `${week}px 100%`, position: `${firstMonday}px 0`, repeat: "repeat-x" })
  }
  if (scale.zoom === "day") {
    layers.push({
      image: line("color-mix(in srgb, var(--dt-border) 55%, transparent)"),
      size: `${scale.dayWidth}px 100%`,
      position: "0 0",
      repeat: "repeat-x",
    })
    // Saturday and Sunday are the last two days of a week that starts on Monday.
    layers.push({
      image: `linear-gradient(to right, transparent 0 ${5 * scale.dayWidth}px, var(--dt-timeline-weekend) ${5 * scale.dayWidth}px)`,
      size: `${week}px 100%`,
      position: `${firstMonday}px 0`,
      repeat: "repeat-x",
    })
  }

  return {
    backgroundImage: layers.map((layer) => layer.image).join(", "),
    backgroundSize: layers.map((layer) => layer.size).join(", "),
    backgroundPosition: layers.map((layer) => layer.position).join(", "),
    backgroundRepeat: layers.map((layer) => layer.repeat).join(", "),
  }
}

/**
 * The timeline pane's column definition.
 *
 * Chrome, not data, for the reasons the row-number column is (see
 * `rowNumbers.ts`): it is a real TanStack column so that pinned offsets, the
 * colgroup, virtual rows and the totals and detail rows all count its width,
 * but it is none of the host's columns. Its width is the scale's, declared as
 * its minimum and maximum too, so `maxColumnWidth` cannot clamp a pane wider
 * than any ordinary column and no stored width can override it.
 *
 * @param width - The scale's width in pixels.
 * @returns The definition `useDataTable` appends after the host's columns.
 */
export function timelineColumnDef<TData extends RowData>(width: number): ColumnDef<DataTableFeatures, TData, unknown> {
  return {
    id: TIMELINE_COLUMN_ID,
    header: "",
    cell: () => null,
    size: width,
    minSize: width,
    maxSize: width,
    enableHiding: false,
    enablePinning: false,
    enableResizing: false,
    enableSorting: false,
    enableColumnFilter: false,
    enableGlobalFilter: false,
    meta: { menu: false, filter: false, searchable: false },
  }
}

/** The pane as the table holds it: the host's options of this render, and the scale they make. */
export interface TimelineState<TData> {
  options: TimelineOptions<TData>
  scale: TimelineScale
}
