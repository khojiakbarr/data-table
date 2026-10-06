import { createColumnHelper } from "@tanstack/react-table"
import { useEffect, useState } from "react"
import {
  DataTable,
  useDataTable,
  type DataTableFeatures,
  type TimelineItem,
  type TimelineMarker,
  type TimelineZoom,
} from "@hojiakbar_dev/data-table"

interface Stage {
  id: string
  label: string
  level: 0 | 1 | 2
  items: TimelineItem[]
  children?: Stage[]
}

const plan = (start: string, end: string): TimelineItem => ({ kind: "bar", variant: "plan", start, end, title: `Plan ${start} – ${end}` })
const act = (start: string, end: string, progress: number, size?: "thick"): TimelineItem => ({
  kind: "bar",
  variant: "actual",
  start,
  end,
  progress,
  tone: progress >= 100 ? "success" : "primary",
  size,
  title: `Actual ${start} – ${end}, ${progress}%`,
})
const late = (start: string, end: string): TimelineItem => ({ kind: "bar", variant: "overrun", start, end, title: `Late ${start} – ${end}` })
const due = (date: string): TimelineItem => ({ kind: "point", shape: "tick", date, title: `Due ${date}` })
const paid = (date: string): TimelineItem => ({ kind: "point", shape: "dot", date, tone: "success", title: `Paid ${date}` })

/** A project carried from the offer to the payment: departments, their steps, each step's documents. */
const stages: Stage[] = [
  { id: "g-mgmt", label: "Management", level: 0, items: [plan("2026-09-01", "2026-09-05"), act("2026-09-01", "2026-09-04", 100, "thick")], children: [
    { id: "s-project", label: "Project", level: 1, items: [plan("2026-09-01", "2026-09-05"), act("2026-09-01", "2026-09-04", 100)] },
  ] },
  { id: "g-sales", label: "Sales", level: 0, items: [plan("2026-09-03", "2026-09-20"), act("2026-09-03", "2026-09-19", 100, "thick")], children: [
    { id: "s-offer", label: "Offer", level: 1, items: [plan("2026-09-05", "2026-09-10"), act("2026-09-06", "2026-09-09", 100)], children: [
      { id: "d-of", label: "OF10007", level: 2, items: [act("2026-09-06", "2026-09-09", 100), due("2026-09-10")] },
    ] },
    { id: "s-order", label: "Order", level: 1, items: [plan("2026-09-10", "2026-09-18"), act("2026-09-12", "2026-09-18", 100)], children: [
      { id: "d-co", label: "CO10004", level: 2, items: [act("2026-09-12", "2026-09-18", 100), due("2026-09-18")] },
    ] },
  ] },
  { id: "g-wh", label: "Warehouse", level: 0, items: [plan("2026-09-24", "2026-11-10"), act("2026-09-24", "2026-09-29", 50, "thick")], children: [
    { id: "s-receipt", label: "Receipt", level: 1, items: [plan("2026-09-24", "2026-09-27"), act("2026-09-24", "2026-09-29", 100), late("2026-09-28", "2026-09-29")], children: [
      { id: "d-rc", label: "RC10005", level: 2, items: [act("2026-09-24", "2026-09-29", 100), due("2026-09-27")] },
    ] },
    { id: "s-shipment", label: "Shipment", level: 1, items: [plan("2026-11-01", "2026-11-10"), act("2026-09-29", "2026-09-29", 0)] },
  ] },
  { id: "g-prod", label: "Production", level: 0, items: [plan("2026-09-26", "2026-10-31"), act("2026-09-27", "2026-09-29", 35, "thick")], children: [
    { id: "s-prod", label: "Production", level: 1, items: [plan("2026-09-26", "2026-10-31"), act("2026-09-27", "2026-09-29", 35)], children: [
      { id: "d-mo", label: "MO10001 · chairs", level: 2, items: [act("2026-09-27", "2026-09-29", 35), due("2026-10-31")] },
    ] },
  ] },
  { id: "g-acc", label: "Accounting", level: 0, items: [plan("2026-09-18", "2026-11-30"), act("2026-09-18", "2026-09-29", 15, "thick")], children: [
    { id: "s-payment", label: "Payment", level: 1, items: [plan("2026-09-18", "2026-11-30"), act("2026-09-18", "2026-09-29", 30)], children: [
      { id: "d-pay", label: "PAY10021 · 30% advance", level: 2, items: [paid("2026-09-18")] },
    ] },
  ] },
]

const markers: TimelineMarker[] = [
  { date: "2026-09-29", label: "Today 29.09", tone: "danger", at: "middle" },
  { date: "2026-11-30", label: "Deadline 30.11", tone: "neutral", dashed: true, at: "end" },
]

const col = createColumnHelper<DataTableFeatures, Stage>()
const columns = [col.accessor("label", { header: "Department / step / document", size: 240 })]

const ZOOMS: TimelineZoom[] = ["day", "week", "month"]

/**
 * A project's stages on a timeline. The library draws bars and points; the
 * rows say what they are. Departments head a strong band, steps a soft one.
 */
export function TimelineExample() {
  const [zoom, setZoom] = useState<TimelineZoom>("week")
  const table = useDataTable({
    id: "docs-timeline",
    data: stages,
    columns,
    getRowId: (row) => row.id,
    getSubRows: (row) => row.children,
    initialLayout: { columnPinning: { start: ["label"], end: [] } },
    timeline: {
      start: "2026-08-31",
      end: "2026-12-07",
      zoom,
      getItems: (row) => row.items,
      markers,
      scrollTo: "2026-09-29",
    },
  })

  // Every department and step open, so the whole plan reads at once.
  useEffect(() => table.table.toggleAllRowsExpanded(true), [table.table])

  return (
    <DataTable
      instance={table}
      height={460}
      getRowTone={(row) => (row.level === 0 ? "strong" : row.level === 1 ? "soft" : undefined)}
      toolbarContent={
        <div role="group" aria-label="Zoom" style={{ display: "flex", gap: 4 }}>
          {ZOOMS.map((option) => (
            <button
              key={option}
              type="button"
              className="dt-menu-button"
              aria-pressed={zoom === option}
              onClick={() => setZoom(option)}
            >
              {option}
            </button>
          ))}
        </div>
      }
    />
  )
}
