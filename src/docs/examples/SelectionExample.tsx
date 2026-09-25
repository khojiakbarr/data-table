import { createColumnHelper } from "@tanstack/react-table"
import { DataTable, useDataTable, type DataTableFeatures } from "@hojiakbar_dev/data-table"
import { receipts, type Receipt } from "./receipts"

const col = createColumnHelper<DataTableFeatures, Receipt>()

const columns = [
  col.accessor("code", { header: "Code", size: 110 }),
  col.accessor("partner", { header: "Partner", size: 220 }),
  col.accessor("status", { header: "Status", size: 120 }),
]

/**
 * Row selection with a bulk-action bar. Tick the header checkbox: the
 * selection becomes "every matching row", not the rows on screen.
 */
export function SelectionExample() {
  const table = useDataTable({
    id: "docs-selection",
    data: receipts,
    columns,
    getRowId: (row) => row.id, // a selection follows records, not positions
    features: { selection: true, rowNumbers: true },
  })

  return (
    <DataTable
      instance={table}
      height={360}
      renderSelectionActions={({ mode, count, clear }) => (
        <>
          {/* `count` is undefined while a server has not answered yet. */}
          <span>
            {count ?? "All"} selected · {mode === "all-matching" ? "every matching row" : "by id"}
          </span>
          <button type="button" className="dt-menu-button" onClick={clear}>
            Clear
          </button>
        </>
      )}
    />
  )
}
