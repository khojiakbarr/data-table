import type { RowData } from "@tanstack/react-table"
import { useState } from "react"
import type { DropSide } from "../core/reorder"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { TablePanel, type PanelTab } from "./TablePanel"

/**
 * The panel behind the "Columns" button, opened on its Columns tab.
 *
 * Kept as its own export with the same four props it has always had, and with
 * the same behaviour: a floating popover that closes on an outside press and
 * on Escape. The built-in shell no longer renders it — it docks
 * {@link TablePanel} inside a side bar instead — but that is a change to the
 * shell, not to this component, so a host rendering it keeps exactly the panel
 * it had. The presentation is passed explicitly below rather than left to the
 * default, because it is this component's contract and not an accident.
 *
 * A shell that wants to choose the tab — or to open the panel on one column's
 * filter, or to dock it — renders {@link TablePanel} directly.
 */
interface ColumnPanelProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
  onClose: () => void
}

/**
 * The floating side panel with its own tab state, opening on Columns.
 *
 * @param props - See {@link ColumnPanelProps}; unchanged from before the panel
 *   grew a second tab, and unchanged by the docked side bar.
 * @returns {@link TablePanel} in its floating presentation, driven by this
 *   component's own tab state.
 */
export function ColumnPanel<TData extends RowData>(props: ColumnPanelProps<TData>) {
  const [tab, setTab] = useState<PanelTab>("columns")
  return <TablePanel {...props} presentation="floating" tab={tab} onTabChange={setTab} />
}
