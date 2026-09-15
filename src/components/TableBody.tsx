import type { Row, RowData } from "@tanstack/react-table"
import { useCallback, type ReactNode, type RefObject } from "react"
import { useRowVirtualizer } from "../core/useRowVirtualizer"
import { displayItemKey } from "../core/virtualRows"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { BodyRow } from "./BodyRow"

interface TableBodyProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  rows: Row<DataTableFeatures, TData>[]
  viewportRef: RefObject<HTMLElement | null>
  headRef: RefObject<HTMLTableSectionElement | null>
  /** Where the filler cell goes among the visible cells. */
  fillerAt: number
  /** Visible leaf columns plus the filler, for the spacer's colSpan. */
  columnCount: number
  /** Header rows above the body, so `aria-rowindex` can count past them. */
  headerRowCount: number
  labels: DataTableLabels
  virtualize: boolean
  renderDetail?: ((row: TData) => ReactNode) | undefined
  onRowClick?: ((row: TData) => void) | undefined
}

/**
 * The rows, windowed.
 *
 * A top spacer, the rendered window (data rows and open detail panels), and
 * a bottom spacer. Rows stay in normal table flow, so sticky headers, pinned
 * cells and the colgroup behave as they do without virtualisation.
 *
 * The spacers are `aria-hidden`, and every real row carries an explicit
 * `aria-rowindex`, so the window the DOM holds is not mistaken for the table.
 */
export function TableBody<TData extends RowData>({
  instance,
  rows,
  viewportRef,
  headRef,
  fillerAt,
  columnCount,
  headerRowCount,
  labels,
  virtualize,
  renderDetail,
  onRowClick,
}: TableBodyProps<TData>) {
  const { rowHeight, getRowHeight, expanded } = instance
  const hasDetail = renderDetail !== undefined
  // `row.getIsExpanded()` reads the expansion state; `expanded` is in the deps
  // so the display list is rebuilt when a panel opens, whatever TanStack does
  // with the rows array identity. Memoised: the virtualiser requires it.
  const isDetailOpen = useCallback(
    (row: Row<DataTableFeatures, TData>) => hasDetail && row.getIsExpanded(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `expanded` is the signal, read via the row
    [hasDetail, expanded],
  )

  const { items, top, bottom, measureElement } = useRowVirtualizer({
    rows,
    viewportRef,
    headRef,
    rowHeight,
    getRowHeight,
    isDetailOpen,
    enabled: virtualize,
  })

  return (
    <tbody>
      {top > 0 ? <SpacerRow height={top} span={columnCount} /> : null}
      {items.map(({ item, index }) =>
        item.kind === "row" ? (
          <BodyRow
            key={displayItemKey(item)}
            row={item.row}
            position={item.position}
            height={getRowHeight?.(item.row.original)}
            headerRowCount={headerRowCount}
            fillerAt={fillerAt}
            labels={labels}
            hasDetail={hasDetail}
            onRowClick={onRowClick}
          />
        ) : (
          <tr
            key={displayItemKey(item)}
            className="dt-detail-row"
            data-depth={item.row.depth}
            data-index={index}
            /* A panel is part of the row it belongs to, not a row of its own. */
            aria-rowindex={item.position + headerRowCount + 1}
            ref={measureElement}
          >
            <td className="dt-detail-cell" colSpan={columnCount}>
              <div
                className="dt-detail"
                style={
                  item.row.depth > 0
                    ? { marginInlineStart: `calc(var(--dt-indent) * ${item.row.depth + 1})` }
                    : undefined
                }
              >
                {renderDetail?.(item.row.original)}
              </div>
            </td>
          </tr>
        ),
      )}
      {bottom > 0 ? <SpacerRow height={bottom} span={columnCount} /> : null}
    </tbody>
  )
}

/** Empty space standing in for rows that are not rendered. */
function SpacerRow({ height, span }: { height: number; span: number }) {
  return (
    <tr className="dt-spacer-row" aria-hidden="true" style={{ height }}>
      <td colSpan={span} />
    </tr>
  )
}
