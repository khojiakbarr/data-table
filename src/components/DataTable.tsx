import { flexRender, type RowData } from "@tanstack/react-table"
import { Fragment, useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { pinnedStyle, renderedLeafColumns } from "../core/pinning"
import { moveColumn, type DropSide } from "../core/reorder"
import { measureColumnWidth } from "../core/autosize"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { DepthSpacer, ExpandToggle } from "./ExpandToggle"
import { HeaderMenu, type HeaderMenuPosition } from "./HeaderMenu"
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
  expandRow: "Expand row",
  collapseRow: "Collapse row",
  columnActions: "Column actions",
  autosize: "Fit this column",
  autosizeAll: "Fit all columns",
  resetWidth: "Reset width",
}

export interface DataTableProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  /** Shade alternate rows. */
  striped?: boolean
  /** Fixed height; the body scrolls inside it. */
  height?: number | string
  /**
   * Keep the header row(s) in view while the body scrolls. Default true.
   *
   * Turn it off for a short table inside a longer page, where a header that
   * follows the scroll is more distracting than useful.
   */
  stickyHeader?: boolean
  /** Hide the toolbar when the host application provides its own controls. */
  toolbar?: boolean
  /** Extra toolbar content, rendered before the Columns button. */
  toolbarContent?: ReactNode
  /** Shown instead of rows when there are none. */
  emptyState?: ReactNode
  /**
   * Content revealed under an expanded row.
   *
   * Rendered in a full-width row beneath its parent. It may contain anything,
   * including another `<DataTable>` — nesting is not limited.
   */
  renderDetail?: (row: TData) => ReactNode
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
  stickyHeader = true,
  toolbar = true,
  toolbarContent,
  emptyState,
  renderDetail,
  labels: labelOverrides,
  theme,
  className,
  onRowClick,
}: DataTableProps<TData>) {
  const { table, flags } = instance
  const [panelOpen, setPanelOpen] = useState(false)
  const [menu, setMenu] = useState<{ columnId: string; at: HeaderMenuPosition } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const labels = { ...defaultLabels, ...labelOverrides }

  const bounds = { min: 60, max: 800 }

  /** Fit one column to the content currently rendered. */
  const autosize = useCallback(
    (columnId: string) => {
      const root = rootRef.current
      if (!root) return
      const index = renderedLeafColumns(table).findIndex((c) => c.id === columnId)
      if (index === -1) return
      const width = measureColumnWidth(root, index, bounds)
      if (width !== null) {
        table.setColumnSizing((previous) => ({ ...previous, [columnId]: width }))
      }
    },
    // `bounds` is a literal recreated per render but never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table],
  )

  const autosizeAll = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const columns = renderedLeafColumns(table)
    const sizes: Record<string, number> = {}
    columns.forEach((column, index) => {
      const width = measureColumnWidth(root, index, bounds)
      if (width !== null) sizes[column.id] = width
    })
    // One state write for the whole table rather than one per column.
    table.setColumnSizing((previous) => ({ ...previous, ...sizes }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table])

  const handleReorder = useCallback(
    (draggedId: string, targetId: string, side: DropSide) => {
      /*
       * A leaf column cannot leave its group: the order is a flat list, so
       * moving one across a group boundary would either be ignored or tear the
       * group's header apart. Refusing the drop is the honest outcome.
       */
      const dragged = table.getColumn(draggedId)
      const target = table.getColumn(targetId)
      if (!dragged || !target) return
      if (dragged.parent?.id !== target.parent?.id) return

      table.setColumnOrder((current) => {
        /*
         * When nothing has been reordered yet the order is empty, meaning
         * "natural". The fallback must be the order the columns are RENDERED
         * in — `getAllLeafColumns()` groups pinned columns first, so using it
         * here scrambles every column on the very first drag.
         */
        const order = current.length
          ? current
          : renderedLeafColumns(table).map((column) => column.id)
        return moveColumn(order, draggedId, targetId, side)
      })
    },
    [table],
  )

  const rows = table.getRowModel().rows
  const rootStyle: CSSProperties = height === undefined ? {} : { height, overflow: "auto" }

  return (
    <div
      ref={rootRef}
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
          onReorder={handleReorder}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}

      {menu ? (
        <HeaderMenu
          column={table.getColumn(menu.columnId)!}
          position={menu.at}
          flags={flags}
          labels={labels}
          onAutosize={() => autosize(menu.columnId)}
          onAutosizeAll={autosizeAll}
          onClose={() => setMenu(null)}
        />
      ) : null}

      <table
        className={["dt-table", striped ? "dt-striped" : ""].filter(Boolean).join(" ")}
        style={{ width: table.getTotalSize(), minWidth: "100%" }}
      >
        {/*
          Under `table-layout: fixed` the browser takes column widths from the
          first row only — which, with grouped headers, is a row of spanning
          cells. A colgroup states the widths directly, so nested headers and
          resizing stop fighting each other.
        */}
        <colgroup>
          {renderedLeafColumns(table).map((column) => (
            <col key={column.id} style={{ width: column.getSize() }} />
          ))}
        </colgroup>

        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers
                /*
                 * TanStack marks a header that a taller cell above already
                 * covers with rowSpan 0. Rendering those would repeat every
                 * label once per header row.
                 */
                .filter((header) => header.rowSpan > 0)
                .map((header) => (
                  <HeaderCell
                    key={header.id}
                    header={header}
                    flags={flags}
                    labels={labels}
                    sticky={stickyHeader}
                    onReorder={handleReorder}
                    onOpenMenu={(at) => setMenu({ columnId: header.column.id, at })}
                  />
                ))}
            </tr>
          ))}
        </thead>

        <tbody>
          {rows.map((row) => {
            const cells = row.getVisibleCells()
            const hasChildren = row.subRows.length > 0
            const expandable = hasChildren || Boolean(renderDetail)
            const isExpanded = expandable && row.getIsExpanded()

            return (
              <Fragment key={row.id}>
                <tr
                  className={isExpanded ? "dt-tr dt-tr-expanded" : "dt-tr"}
                  data-depth={row.depth}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {cells.map((cell, index) => (
                    <td
                      key={cell.id}
                      className={[
                        "dt-td",
                        cell.column.getIsPinned() ? "dt-pinned" : "",
                        index === 0 ? "dt-td-lead" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={pinnedStyle(cell.column)}
                    >
                      {index === 0 ? (
                        expandable ? (
                          <ExpandToggle
                            expanded={isExpanded}
                            depth={row.depth}
                            label={isExpanded ? labels.collapseRow : labels.expandRow}
                            onToggle={() => row.toggleExpanded()}
                          />
                        ) : (
                          <DepthSpacer depth={row.depth} />
                        )
                      ) : null}
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>

                {isExpanded && renderDetail ? (
                  <tr className="dt-detail-row" data-depth={row.depth}>
                    <td className="dt-detail-cell" colSpan={cells.length}>
                      <div
                        className="dt-detail"
                        style={
                          row.depth > 0
                            ? { marginInlineStart: `calc(var(--dt-indent) * ${row.depth + 1})` }
                            : undefined
                        }
                      >
                        {renderDetail(row.original)}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {rows.length === 0 ? (
        <div className="dt-empty">{emptyState ?? labels.empty}</div>
      ) : null}
    </div>
  )
}
