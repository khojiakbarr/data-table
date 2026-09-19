import type { RowData } from "@tanstack/react-table"
import { useState } from "react"
import type { DropSide } from "../core/reorder"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { TablePanel, type PanelTab } from "./TablePanel"

/**
 * The panel behind the "Columns" button, opened on its Columns tab.
 *
 * Kept as its own export with the same four props it has always had: it is
 * part of the published shell, and a host rendering it should not have to
 * learn about tabs to keep working. A shell that wants to choose the tab — or
 * to open the panel on one column's filter — renders {@link TablePanel}.
 */
interface ColumnPanelProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
  onClose: () => void
}

/**
 * The side panel with its own tab state, opening on Columns.
 *
 * @param props - See {@link ColumnPanelProps}; unchanged from before the panel
 *   grew a second tab.
 * @returns {@link TablePanel}, driven by this component's own tab state.
 */
export function ColumnPanel<TData extends RowData>(props: ColumnPanelProps<TData>) {
  const [tab, setTab] = useState<PanelTab>("columns")
  return <TablePanel {...props} tab={tab} onTabChange={setTab} />
}
