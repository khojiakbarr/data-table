# Timeline (Gantt) pane — design

**Date:** 2026-10-07 · **Asked by:** gofur (`gantt-data-table.md`, 2026-10-06) · **Built by:** Khojiakbar · **Ships as:** 0.13.0

## What it is

A time scale to the right of a table's columns: each row draws its plan, what actually happened, the overrun past
the plan, a document's due day and a payment's day as bars and points, under two full-height markers (today, the
deadline). The first host is D-System's project page («Этапы»): departments → steps → documents on the left, the
Gantt on the right. The table on the left already exists — a tree, pinned columns, virtual rows, fixed row heights —
so the pane is one more column of it, not a second component beside it.

The library knows nothing about projects. It draws bars and points on rows; the host turns its data into them.

## Decisions

1. **A chrome column, like row numbers and selection.** `useDataTable({ timeline })` appends one column with the
   reserved id `__dt_timeline`, after the host's columns and unpinned, so it scrolls while pinned columns stay. Being
   a real TanStack column is what makes pinning offsets, the tree, virtualisation, row heights, horizontal scroll and
   the totals and detail rows line up with no new layout code. It is not one of the host's columns: absent from
   `columnIds`, the stored layout, the Columns panel and quick search; no menu, sort, filter, pin, hide, resize,
   autosize or drag, and alone in its drop region so nothing lands beside it.
2. **Its width is computed**: `days × dayWidth`, declared as `size = minSize = maxSize`, so `maxColumnWidth` cannot
   clamp it and no stored width can override it. A zoom change rebuilds the column definition (one rebuild, not one
   per render: the definition is memoised on the width alone).
3. **Calendar days, no time zone.** `IsoDay` strings in, a day number (days since 1970-01-01 by `Date.UTC`) inside.
   A bar is inclusive (`start = end` is a one-day bar). `x = (day − start) × dayWidth`; width
   `(end − start + 1) × dayWidth`, at least 4px. A bar crossing the range is clipped at its edge, never dropped; a
   point outside the range is not drawn.
4. **What changes every render is read every render.** `getItems`, `markers` and `onItemClick` come from the
   options of the current render (`instance.timeline.options`), so a host may pass inline functions.
5. **The grid is one `background-image` per row**, built once per scale: month lines (solid), week lines (Mondays,
   week and day zoom), day lines and weekend shading (day zoom). Hundreds of rows draw no extra nodes for it.
6. **Markers are drawn per row** as a full-height line in each row's cell — continuous down the body with
   virtualisation, no overlay to keep in step with the scroll — and as a chip in the header.
7. **Row tones are a table feature, not a timeline one.** `<DataTable getRowTone>` returns `"strong" | "soft"` for a
   row; the whole row — pinned cells and the timeline cell included — takes `--dt-row-strong-bg` /
   `--dt-row-soft-bg`. A class-name hook was the alternative; a pinned cell paints its own background from a more
   specific rule, so every host would have had to out-specify it.
8. **Month names come from the labels** (`timelineMonth(month)`), not `Intl`: Chrome's ICU has no Latin Uzbek month
   names and prints "M09". So the request's `locale` option is not here — the language is the label set the host
   passes, as for every other word of the table.
9. **Colours are tokens derived from the palette** (`color-mix` over `--dt-accent`, `--dt-bg`, `--dt-fg`), so a
   theme that sets its accent — `muiTokens` included — brands the bars, and dark mode needs no block of its own. The
   red marker chip is `#dc2626` (white text 4.8:1), not the prototype's `#e5484d` (3.9:1).
10. **Read-only.** No drag or resize. `title` on an item is its tooltip and, with `onItemClick`, the item becomes a
    button named by it. Without `onItemClick` a row's drawing is one image named by its items' titles, or hidden from
    assistive technology when none has a title — the table's own columns say the same in text.
11. **`scrollTo`** scrolls the day into view (a third of the way in, past the pinned columns) when the pane appears
    and whenever the day, the zoom or the range changes — never on an ordinary render, which would fight the user.
12. **A group header keeps the grid and the markers** on a server-grouped page, with no items: `getItems` is for
    records. Otherwise every marker line would break at each group header.
13. **A day that is not a day is said**, once, in development (`"29.09.2026"`, an end before its start): it vanishes
    exactly as an item outside the range does, and only the console can tell the two apart.

## API

```ts
type TimelineZoom = "day" | "week" | "month"
type TimelineTone = "primary" | "success" | "danger" | "neutral"
type TimelineItem =
  | { kind: "bar"; start: IsoDay; end: IsoDay; variant: "plan" | "actual" | "overrun";
      tone?: TimelineTone; progress?: number; size?: "regular" | "thick"; title?: string }
  | { kind: "point"; date: IsoDay; shape: "dot" | "tick"; tone?: TimelineTone; title?: string }
interface TimelineMarker { date: IsoDay; label: string; tone: TimelineTone; dashed?: boolean; at?: "middle" | "end" }
interface TimelineOptions<TData> {
  start: IsoDay; end: IsoDay; zoom: TimelineZoom
  dayWidth?: Partial<Record<TimelineZoom, number>>  // { day: 30, week: 14, month: 5 }
  getItems: (row: TData) => readonly TimelineItem[]
  markers?: readonly TimelineMarker[]
  scrollTo?: IsoDay
  onItemClick?: (item: TimelineItem, row: TData) => void
}
useDataTable({ ..., timeline: TimelineOptions<TData> | undefined })
<DataTable getRowTone={(row) => "strong" | "soft" | undefined} />
```

## Not in this version

Dragging or resizing bars, dependency arrows, critical path, export, a custom tooltip renderer (the request's
`renderTooltip`: `title` is the tooltip, a native one a screen reader reads too), RTL.
