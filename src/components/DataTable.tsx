import { flexRender, type RowData } from "@tanstack/react-table"
import { useCallback, useState, type CSSProperties, type ReactNode } from "react"
import { pinnedStyle } from "../core/pinning"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { ColumnPanel } from "./ColumnPanel"
import { HeaderCell } from "./HeaderCell"

/** English defaults; pass `labels` to translate. */
export const defaultLabels: DataTableLabels = {
  columnsButton: "Columns",
  columnsTitle: "Columns",
  showAll: "Show all",
  reset: "Reset",
  pinStart: "Pin to start",
  pinEnd: "Pin to end",
  unpin: "Unpin",
  hide: "Hide",
  sortAscending: "Sort ascending",
  sortDescending: "Sort descending",
  clearSort: "Clear sort",
  empty: "No rows",
  dragHint: "Drag to reorder",
  resizeColumn: "resize column",
}

export interface DataTableProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  /** Shade alternate rows. */
  striped?: boolean
  /** Fixed height; the header and pinned columns stay put while scrolling. */
  height?: number | string
  /** Hide the toolbar when the host application provides its own controls. */
  toolbar?: boolean
  /** Extra toolbar content, rendered before the Columns button. */
  toolbarContent?: ReactNode
  /** Shown instead of rows when there are none. */
  emptyState?: ReactNode
  labels?: Partial<DataTableLabels>
  /** Forces a theme instead of following the OS setting. */
  theme?: "light" | "dark"
  className?: string
  onRowClick?: (row: TData) => void
}

/**
 * The batteries-included table.
 *
 * It renders {@link useDataTable}'s instance. The hook is exported separately,
 * so an application that wants different markup can keep the behaviour and
 * write its own shell.
 *
 * @example
 * const instance = useDataTable({ id: "receipts", data, columns })
 * <DataTable instance={instance} striped height={520} />
 */
export function DataTable<TData extends RowData>({
  instance,
  striped = false,
  height,
  toolbar = true,
  toolbarContent,
  emptyState,
  labels: labelOverrides,
  theme,
  className,
  onRowClick,
}: DataTableProps<TData>) {
  const { table, flags } = instance
  const [panelOpen, setPanelOpen] = useState(false)
  const labels = { ...defaultLabels, ...labelOverrides }

  const handleReorder = useCallback(
    (draggedId: string, targetId: string) => {
      table.setColumnOrder((current) => {
        const order = current.length
          ? [...current]
          : table.getAllLeafColumns().map((column) => column.id)
        const from = order.indexOf(draggedId)
        const to = order.indexOf(targetId)
        if (from === -1 || to === -1) return order
        order.splice(to, 0, ...order.splice(from, 1))
        return order
      })
    },
    [table],
  )

  const rows = table.getRowModel().rows
  const rootStyle: CSSProperties = height === undefined ? {} : { height, overflow: "auto" }

  return (
    <div
      className={["dt-root", className].filter(Boolean).join(" ")}
      style={rootStyle}
      data-dt-theme={theme}
    >
      {toolbar ? (
        <div className="dt-toolbar">
          {toolbarContent}
          <span className="dt-spacer" />
          {flags.hiding || flags.pinning ? (
            <button
              type="button"
              className="dt-menu-button"
              aria-expanded={panelOpen}
              aria-haspopup="dialog"
              onClick={() => setPanelOpen((open) => !open)}
            >
              {labels.columnsButton}
            </button>
          ) : null}
        </div>
      ) : null}

      {panelOpen ? (
        <ColumnPanel
          instance={instance}
          labels={labels}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}

      <table
        className={["dt-table", striped ? "dt-striped" : ""].filter(Boolean).join(" ")}
        style={{ width: table.getTotalSize(), minWidth: "100%" }}
      >
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <HeaderCell
                  key={header.id}
                  header={header}
                  flags={flags}
                  labels={labels}
                  onReorder={handleReorder}
                />
              ))}
            </tr>
          ))}
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="dt-tr"
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={[
                    "dt-td",
                    cell.column.getIsPinned() ? "dt-pinned" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    width: cell.column.getSize(),
                    ...pinnedStyle(cell.column),
                  }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 ? (
        <div className="dt-empty">{emptyState ?? labels.empty}</div>
      ) : null}
    </div>
  )
}
