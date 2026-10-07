import { describe, expect, it } from "vitest"
import {
  coveredMarks,
  DEFAULT_DAY_WIDTH,
  MIN_BAR_WIDTH,
  TIMELINE_COLUMN_ID,
  barBox,
  calendarParts,
  dayMarks,
  dayNumber,
  gridStyle,
  isTimelineColumn,
  monthSpans,
  pointX,
  timelineColumnDef,
  timelineScale,
  type TimelineScale,
} from "./timeline"

/**
 * The timeline's arithmetic, apart from anything drawn.
 *
 * The range is the prototype's (PRJ10005): 31.08.2026, a Monday, to 07.12.2026
 * — 99 days, five months, the first and last of them partial. At the week zoom
 * a day is 14px, so a bar's left edge is its day's offset × 14.
 */

const scaleOf = (zoom: TimelineScale["zoom"] = "week"): TimelineScale => {
  const scale = timelineScale("2026-08-31", "2026-12-07", zoom)
  if (!scale) throw new Error("the fixture range is valid")
  return scale
}

describe("dayNumber", () => {
  it("counts calendar days from 1970-01-01, whatever the time zone", () => {
    expect(dayNumber("1970-01-01")).toBe(0)
    expect(dayNumber("1970-01-02")).toBe(1)
    expect(dayNumber("2026-08-31")).toBe(20696)
  })

  it("refuses a malformed day and a day the calendar does not have", () => {
    expect(dayNumber("2026-9-1")).toBeNull()
    expect(dayNumber("2026-02-29")).toBeNull()
    expect(dayNumber("2026-13-01")).toBeNull()
    expect(dayNumber("2028-02-29")).not.toBeNull()
  })

  it("keeps a two-digit year in its own century", () => {
    expect(calendarParts(dayNumber("0050-03-01") ?? Number.NaN).year).toBe(50)
  })
})

describe("calendarParts", () => {
  it("numbers the week from Monday", () => {
    expect(calendarParts(dayNumber("2026-08-31") ?? 0)).toEqual({ year: 2026, month: 7, date: 31, weekday: 0 })
    expect(calendarParts(dayNumber("2026-09-06") ?? 0).weekday).toBe(6)
  })
})

describe("timelineScale", () => {
  it("is as wide as its days, end included, at the zoom's day width", () => {
    expect(scaleOf("week")).toEqual({ zoom: "week", first: 20696, days: 99, dayWidth: 14, width: 1386 })
    expect(scaleOf("day").width).toBe(99 * DEFAULT_DAY_WIDTH.day)
    expect(scaleOf("month").width).toBe(99 * DEFAULT_DAY_WIDTH.month)
  })

  it("takes the host's day width for the zoom in force", () => {
    expect(timelineScale("2026-09-01", "2026-09-10", "week", { week: 20, day: 40 })?.width).toBe(200)
  })

  it("draws nothing for a range it cannot read", () => {
    expect(timelineScale("2026-09-10", "2026-09-01", "week")).toBeNull()
    expect(timelineScale("soon", "2026-09-01", "week")).toBeNull()
    expect(timelineScale("2026-09-01", "2026-09-10", "week", { week: 0 })).toBeNull()
  })
})

describe("barBox", () => {
  const scale = scaleOf("week")

  it("starts at its day and is as wide as its days, the end day included", () => {
    expect(barBox(scale, "2026-09-01", "2026-09-05")).toEqual({ left: 14, width: 70, clippedStart: false, clippedEnd: false })
    expect(barBox(scale, "2026-09-29", "2026-09-29")).toMatchObject({ left: 29 * 14, width: 14 })
  })

  it("cuts a bar at the pane's edge instead of losing it, and says which edge", () => {
    expect(barBox(scale, "2026-08-20", "2026-09-02")).toEqual({ left: 0, width: 3 * 14, clippedStart: true, clippedEnd: false })
    expect(barBox(scale, "2026-12-01", "2027-01-15")).toEqual({ left: 92 * 14, width: 7 * 14, clippedStart: false, clippedEnd: true })
  })

  it("leaves out a bar wholly outside the pane, or one that ends before it starts", () => {
    expect(barBox(scale, "2026-08-01", "2026-08-30")).toBeNull()
    expect(barBox(scale, "2026-12-08", "2026-12-20")).toBeNull()
    expect(barBox(scale, "2026-09-05", "2026-09-01")).toBeNull()
  })

  it("is never narrower than a bar can be read", () => {
    const thin = timelineScale("2026-09-01", "2026-09-30", "month", { month: 2 })
    if (!thin) throw new Error("valid")
    expect(barBox(thin, "2026-09-10", "2026-09-10")?.width).toBe(MIN_BAR_WIDTH)
    // Widened at the very end, it is pulled back inside the pane.
    expect(barBox(thin, "2026-09-30", "2026-09-30")).toMatchObject({ left: thin.width - MIN_BAR_WIDTH, width: MIN_BAR_WIDTH })
  })
})

describe("pointX", () => {
  const scale = scaleOf("week")

  it("stands a moment in the middle of its day and a limit at its end", () => {
    expect(pointX(scale, "2026-09-29", "middle")).toBe(29 * 14 + 7)
    expect(pointX(scale, "2026-11-30", "end")).toBe(92 * 14)
  })

  it("draws no point outside the pane", () => {
    expect(pointX(scale, "2026-08-30", "middle")).toBeNull()
    expect(pointX(scale, "2026-12-08", "end")).toBeNull()
    expect(pointX(scale, "2026-12-07", "end")).toBe(scale.width)
  })
})

describe("monthSpans", () => {
  it("covers the pane edge to edge, a partial month at either end", () => {
    const spans = monthSpans(scaleOf("week"))
    expect(spans.map((span) => [span.month, span.width / 14])).toEqual([
      [7, 1],
      [8, 30],
      [9, 31],
      [10, 30],
      [11, 7],
    ])
    expect(spans[1]?.left).toBe(14)
    expect(spans.reduce((sum, span) => sum + span.width, 0)).toBe(1386)
  })
})

describe("dayMarks", () => {
  it("gives the week zoom its Mondays and the day zoom every day", () => {
    const mondays = dayMarks(scaleOf("week"), true)
    expect(mondays).toHaveLength(15)
    expect(mondays.slice(0, 2).map((mark) => [mark.date, mark.month, mark.left])).toEqual([
      [31, 7, 0],
      [7, 8, 7 * 14],
    ])
    expect(dayMarks(scaleOf("day"), false)).toHaveLength(99)
  })
})

describe("gridStyle", () => {
  it("draws a line where each month after the first begins, and the weeks from the first Monday", () => {
    const style = gridStyle(scaleOf("week"))
    const images = String(style.backgroundImage)
    expect(images.match(/--dt-timeline-grid/g)).toHaveLength(4)
    expect(String(style.backgroundPosition).split(", ")).toEqual(["14px 0", "434px 0", "868px 0", "1288px 0", "0px 0"])
    expect(images).not.toContain("--dt-timeline-weekend")
  })

  it("shades the weekends and draws the days only at the day zoom", () => {
    expect(String(gridStyle(scaleOf("day")).backgroundImage)).toContain("--dt-timeline-weekend")
    expect(String(gridStyle(scaleOf("month")).backgroundImage)).not.toContain("--dt-border")
  })

  it("starts the week tile on the first Monday when the range does not", () => {
    const scale = timelineScale("2026-09-02", "2026-09-30", "week")
    if (!scale) throw new Error("valid")
    // Wednesday 02.09: the first Monday, 07.09, is five days in.
    expect(String(gridStyle(scale).backgroundPosition).split(", ").at(-1)).toBe(`${5 * 14}px 0`)
  })
})

describe("timelineColumnDef", () => {
  it("is exactly the scale's width, and none of the host's interactions", () => {
    const def = timelineColumnDef(1386)
    expect(def).toMatchObject({
      id: TIMELINE_COLUMN_ID,
      size: 1386,
      minSize: 1386,
      maxSize: 1386,
      enableHiding: false,
      enablePinning: false,
      enableResizing: false,
      enableSorting: false,
      meta: { menu: false },
    })
    expect(isTimelineColumn(TIMELINE_COLUMN_ID)).toBe(true)
    expect(isTimelineColumn("deadline")).toBe(false)
  })
})

describe("coveredMarks", () => {
  it("names the dates a chip lies over, keeping a little room on each side, and no others", () => {
    const marks = [
      { left: 0, width: 30 },
      { left: 98, width: 30 },
      { left: 196, width: 30 },
    ]
    expect(coveredMarks(marks, [{ center: 110, width: 60 }])).toEqual([1])
    // 165 + 30 + 2 = 197 reaches the third date's first pixel; 165 − 30 − 2 = 133 stops short of the second's end.
    expect(coveredMarks(marks, [{ center: 165, width: 60 }])).toEqual([2])
    expect(coveredMarks(marks, [])).toEqual([])
  })
})
