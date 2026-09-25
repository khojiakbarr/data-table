import { createColumnHelper } from "@tanstack/react-table"
import { DataTable, useDataTable, type DataTableFeatures } from "@hojiakbar_dev/data-table"
import "@hojiakbar_dev/data-table/styles.css"
import { receipts, type Receipt } from "./receipts"

const col = createColumnHelper<DataTableFeatures, Receipt>()

const columns = [
  col.accessor("code", { header: "Code", size: 110 }),
  col.accessor("partner", { header: "Partner", size: 220 }),
  col.accessor("city", { header: "City", size: 140 }),
  col.accessor("status", { header: "Status", size: 120 }),
]

/** The smallest useful table: client mode, sixty rows, a bounded height. */
export function MinimalExample() {
  const table = useDataTable({ id: "docs-minimal", data: receipts, columns })

  return <DataTable instance={table} height={360} />
}
