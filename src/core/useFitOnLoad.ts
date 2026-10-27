import type { Column, ColumnSizingState, RowData } from "@tanstack/react-table"
import { useRef, type RefObject } from "react"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import { renderedLeafColumns } from "./pinning"
import { isRowNumberColumn } from "./rowNumbers"
import { afterFontsLoad } from "./afterFontsLoad"
import { columnBounds, type ColumnBounds } from "./sizing"
import { fitColumnWidth, widenGroupsToFitLabels } from "./useAutosize"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

type AnyColumn<TData extends RowData> = Column<DataTableFeatures, TData, unknown>

/** How a table fits its columns to the first rows it draws. */
export interface FitColumnsOnLoad {
  /**
   * The widest a fitted column may grow, as a multiple of its declared `size`
   * — or of the table's `defaultColumnWidth` (160 unless set) for a column
   * that declares none. Default 2: one long name must not push every other
   * column off the screen. `maxSize` still wins when lower.
   */
  maxGrowth?: number | undefined
}

/**
 * TanStack's own width for a definition no size reached at all. Under
 * `useDataTable` there is none: it merges `defaultColumnWidth` into every
 * column, so a column that declares no `size` reads that instead.
 */
const TANSTACK_DEFAULT_SIZE = 150
const DEFAULT_MAX_GROWTH = 2
/** Frames to wait for the first rows to reach the DOM — a virtualised body draws them a frame late. */
const MAX_WAIT_FRAMES = 3

/**
 * The bounds a column is fitted within on load: its own, with the ceiling
 * lowered to `maxGrowth` times its declared size.
 *
 * @example
 * fitBounds({ min: 60, max: 800 }, 120, 2) // { min: 60, max: 240 }
 */
export function fitBounds(bounds: ColumnBounds, declaredSize: number | undefined, maxGrowth: number): ColumnBounds {
  const ceiling = Math.round((declaredSize ?? TANSTACK_DEFAULT_SIZE) * maxGrowth)
  return { min: bounds.min, max: Math.max(bounds.min, Math.min(bounds.max, ceiling)) }
}

/**
 * The columns a load fits: drawn, resizable and not fitted yet.
 *
 * A column the person sized IS fitted all the same — their width still wins
 * on screen, and the fit is what Reset width returns the column to. The
 * row-number column never is: its width follows the row count, which the
 * first rows on screen do not show.
 */
export function columnsToFit<TData extends RowData>(
  columns: readonly AnyColumn<TData>[],
  fitted: Readonly<ColumnSizingState>,
): AnyColumn<TData>[] {
  return columns.filter(
    (column) => column.getCanResize() && !isRowNumberColumn(column.id) && fitted[column.id] === undefined,
  )
}

/** Whether the table's body holds a drawn data row to measure. */
function hasDrawnRow(element: HTMLTableElement): boolean {
  return element.querySelector(":scope > tbody > tr:not(.dt-detail-row) > td[data-column-id]") !== null
}

/**
 * Fit every column the table has not fitted yet to the first rows it draws —
 * once per mounted table.
 *
 * The widths are the TABLE's default, written through
 * `instance.setFittedSizing` rather than `columnSizing`: they never make the
 * layout customised, a width the person sets still wins over them, and Reset
 * width and `resetLayout` return a column to them. They are stored with the
 * layout, so the next visit draws them as they were and fits only a column it
 * has not seen: the columns follow the data on the first look and then hold
 * still, through a page, a search, a filter and a reload.
 *
 * Turned off, the stored fit is dropped, so the declared widths are back.
 *
 * @param instance - From {@link useDataTable}.
 * @param tableRef - The rendered `<table>`.
 * @param options - Off with `false`; `maxGrowth` caps a column's growth.
 * @param ready - The first rows are on screen: not loading, no error, rows, not cards.
 */
export function useFitOnLoad<TData extends RowData>(
  instance: DataTableInstance<TData>,
  tableRef: RefObject<HTMLTableElement | null>,
  options: boolean | FitColumnsOnLoad,
  ready: boolean,
): void {
  const { table, fittedSizing, setFittedSizing } = instance
  const isDoneRef = useRef(false)
  // Read through a ref: the fit's own write must not re-run the effect that made it.
  const fittedRef = useRef(fittedSizing)
  fittedRef.current = fittedSizing
  const enabled = options !== false
  const maxGrowth = typeof options === "object" ? (options.maxGrowth ?? DEFAULT_MAX_GROWTH) : DEFAULT_MAX_GROWTH

  useIsomorphicLayoutEffect(() => {
    if (enabled || Object.keys(fittedRef.current).length === 0) return
    // A fit nothing will refresh, and Reset would keep: off means the declared widths again.
    setFittedSizing({})
    isDoneRef.current = false
  }, [enabled, setFittedSizing])

  useIsomorphicLayoutEffect(() => {
    const element = tableRef.current
    if (!enabled || !ready || isDoneRef.current || !element) return
    let frame = 0
    let handle = 0

    const fit = () => {
      const current = tableRef.current
      if (!current) return
      // A virtualised body may draw its first rows a frame after the data: wait for them, a few frames at most.
      if (!hasDrawnRow(current)) {
        if (frame++ < MAX_WAIT_FRAMES) handle = requestAnimationFrame(fit)
        return
      }
      isDoneRef.current = true
      const sizes = measureUnfitted(table, current, fittedRef.current, maxGrowth)
      if (sizes !== null) setFittedSizing((previous) => ({ ...previous, ...sizes }))
    }

    const cancelWait = afterFontsLoad(element, fit)
    return () => {
      cancelWait()
      cancelAnimationFrame(handle)
    }
  }, [enabled, ready, maxGrowth, table, tableRef, setFittedSizing])
}

/**
 * The fitted widths for every column not fitted yet, with the leaves under a
 * group label widened until it fits — or null when there is nothing to fit.
 *
 * Widening runs over the TABLE's widths (fitted and new), not the person's,
 * so a dragged column does not count toward the room a label has.
 */
function measureUnfitted<TData extends RowData>(
  table: DataTableInstance<TData>["table"],
  element: HTMLTableElement,
  fitted: Readonly<ColumnSizingState>,
  maxGrowth: number,
): ColumnSizingState | null {
  const boundsOf = (column: AnyColumn<TData>) => fitBounds(columnBounds(column), column.columnDef.size, maxGrowth)
  const measured: ColumnSizingState = {}
  for (const column of columnsToFit(renderedLeafColumns(table), fitted)) {
    const width = fitColumnWidth(element, column, boundsOf(column))
    if (width !== null) measured[column.id] = width
  }
  if (Object.keys(measured).length === 0) return null
  return widenGroupsToFitLabels(table.getAllColumns(), element, { ...fitted, ...measured }, boundsOf)
}
