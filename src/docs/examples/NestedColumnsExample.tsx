import { createColumnHelper } from "@tanstack/react-table"
import { DataTable, useDataTable, type DataTableFeatures } from "@hojiakbar_dev/data-table"
import { receipts, type Receipt } from "./receipts"

const col = createColumnHelper<DataTableFeatures, Receipt>()
const money = new Intl.NumberFormat("en-US")

const columns = [
  col.accessor("code", { header: "Code", size: 110 }),
  col.group({
    id: "document",
    header: "Document",
    columns: col.columns([
      col.accessor("partner", { header: "Partner", size: 220 }),
      col.accessor("city", { header: "City", size: 140 }),
    ]),
  }),
  col.group({
    id: "payment",
    header: "Payment",
    columns: col.columns([
      col.accessor("date", { header: "Date", size: 120 }),
      col.accessor("amount", {
        header: "Amount",
        size: 140,
        cell: (info) => money.format(info.getValue()),
      }),
    ]),
  }),
  col.accessor("status", { header: "Status", size: 120 }),
]

/**
 * Two column groups between two ungrouped columns, which span both header
 * rows on their own. Code is pinned to the start and Status to the end.
 * Drag a group header to move the whole group; drag its edge to resize
 * every column under it.
 */
export function NestedColumnsExample() {
  const table = useDataTable({
    id: "docs-nested",
    data: receipts,
    columns,
    initialLayout: { columnPinning: { start: ["code"], end: ["status"] } },
  })

  return <DataTable instance={table} height={360} striped />
}
