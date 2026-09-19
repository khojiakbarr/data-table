import type { Row, RowData } from "@tanstack/react-table"
import { useCallback, useMemo, type ReactNode, type RefObject } from "react"
import { isGroupRow } from "../core/grouping"
import { useRowVirtualizer } from "../core/useRowVirtualizer"
import { displayItemKey } from "../core/virtualRows"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { BodyRow } from "./BodyRow"
import { GroupBodyRow } from "./GroupBodyRow"

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
  /**
   * Rows already on earlier pages, so `aria-rowindex` counts from the table
   * rather than restarting at the top of every page. Zero with pagination off.
   */
  rowIndexOffset: number
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
  rowIndexOffset,
  labels,
  virtualize,
  renderDetail,
  onRowClick,
}: TableBodyProps<TData>) {
  const { rowHeight, getRowHeight, heightVersion, expanded, pagination, grouping } = instance
  const hasDetail = renderDetail !== undefined

  /*
   * A grouped page holds two kinds of row with two heights, which is exactly
   * what `getRowHeight` is for — but a group header is not one of the host's
   * records, so the host's own policy is never asked about it. It gets the
   * table's base `rowHeight`, which is what the stylesheet renders it at
   * (`--dt-row-height`, published on the root), so the virtualiser's estimate
   * and the rendered height agree by construction and the scrollbar stays
   * exact whatever the records measure.
   *
   * Left undefined when there is nothing to override: with no host policy,
   * `useRowVirtualizer` already falls back to `rowHeight` for every item.
   */
  const rowHeightOf = useMemo(() => {
    if (getRowHeight === undefined) return undefined
    return (original: TData): number =>
      isGroupRow(original) ? rowHeight : getRowHeight(original)
  }, [getRowHeight, rowHeight])
  // `row.getIsExpanded()` reads the expansion state; `expanded` is in the deps
  // so the display list is rebuilt when a panel opens, whatever TanStack does
  // with the rows array identity. Memoised: the virtualiser requires it.
  const isDetailOpen = useCallback(
    (row: Row<DataTableFeatures, TData>) =>
      hasDetail && !isGroupRow(row.original) && row.getIsExpanded(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `expanded` is the signal, read via the row
    [hasDetail, expanded],
  )

  const { items, top, bottom, measureElement } = useRowVirtualizer({
    rows,
    viewportRef,
    headRef,
    rowHeight,
    getRowHeight: rowHeightOf,
    heightVersion,
    isDetailOpen,
    enabled: virtualize,
    /*
     * A page is a whole thing: rendering 40 of its 50 rows while the viewport
     * has no size — which is every server render, and every table inside a
     * hidden ancestor — hands a crawler, and a browser before hydration, a
     * page with rows missing. With paging off there is no such unit, and the
     * built-in window stands.
     */
    ...(pagination.enabled ? { unmeasuredFloor: pagination.pageSize } : {}),
  })

  /*
   * A page that starts INSIDE an open group, whose header was on the page
   * before. The server says so with `startPath`, and without this the user
   * would see rows under nothing at all — a leaf carries no path, so nothing
   * else on the page could say which group these rows belong to.
   *
   * Drawn only when the page's first row is NOT a group header: when it is,
   * it says where the page is on its own. The PAGE's first row, not the
   * window's — scrolling down does not change which group the page started
   * in. It is outside the virtualised window on
   * purpose — one fixed row, so no item index moves — and `role="presentation"`
   * keeps it out of the `aria-rowindex` sequence, which counts the table's
   * real rows. The role propagates to the cells, so the text is still read;
   * this is a restatement of a header the previous page already carried, not a
   * row of the table.
   */
  const continuation =
    grouping.startPath.length > 0 && !isGroupRow(rows[0]?.original)
      ? grouping.startPath.map((key) => (key === "" ? labels.blanks : String(key)))
      : undefined

  return (
    <tbody>
      {continuation ? (
        <tr className="dt-tr dt-group-row dt-group-continued" role="presentation">
          <td className="dt-td dt-group-cell" colSpan={columnCount}>
            <div className="dt-lead">
              <span className="dt-group-value">{labels.groupContinued(continuation)}</span>
            </div>
          </td>
        </tr>
      ) : null}
      {top > 0 ? <SpacerRow height={top} span={columnCount} /> : null}
      {items.map(({ item, index }) => {
        if (item.kind === "detail") {
          return (
            <tr
              key={displayItemKey(item)}
              className="dt-detail-row"
              data-depth={item.row.depth}
              data-index={index}
              /* A panel is part of the row it belongs to, not a row of its own. */
              aria-rowindex={item.position + rowIndexOffset + headerRowCount + 1}
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
          )
        }
        const group = isGroupRow(item.row.original) ? item.row.original : undefined
        /*
         * A group header, not a record: no host cell renderer runs for it, no
         * detail panel opens under it, and its chevron changes the QUERY
         * rather than revealing rows the client already holds.
         */
        if (group) {
          return (
            <GroupBodyRow
              key={displayItemKey(item)}
              row={item.row}
              group={group}
              position={item.position}
              groupColumnId={grouping.columnId}
              expanded={grouping.isExpanded(group.path)}
              onToggle={() => grouping.toggle(group.path)}
              headerRowCount={headerRowCount}
              rowIndexOffset={rowIndexOffset}
              fillerAt={fillerAt}
              labels={labels}
            />
          )
        }
        return (
          <BodyRow
            key={displayItemKey(item)}
            row={item.row}
            position={item.position}
            height={getRowHeight?.(item.row.original)}
            headerRowCount={headerRowCount}
            rowIndexOffset={rowIndexOffset}
            fillerAt={fillerAt}
            labels={labels}
            hasDetail={hasDetail}
            groupColumnId={grouping.columnId}
            groupDepth={grouping.columns.length}
            onRowClick={onRowClick}
          />
        )
      })}
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
