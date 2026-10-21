import type { Column, RowData } from "@tanstack/react-table"
import { useRef, type RefObject } from "react"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import { measureColumnWidth } from "./autosize"
import { renderedLeafColumns } from "./pinning"
import { columnBounds, type ColumnBounds } from "./sizing"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

type AnyColumn<TData extends RowData> = Column<DataTableFeatures, TData, unknown>

/** How a table fits its columns to the first rows it draws. */
export interface FitColumnsOnLoad {
  /**
   * The widest a fitted column may grow, as a multiple of its declared `size`
   * (TanStack's 150 when it declares none). Default 2: one long name must not
   * push every other column off the screen. `maxSize` still wins when lower.
   */
  maxGrowth?: number
}

/** TanStack's width for a column that declares none. */
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
 * The columns a load may fit: drawn, resizable and with no width of their own
 * yet — a width in the state is the person's (a drag, a fit, a stored layout),
 * and a load never undoes it.
 */
export function columnsToFit<TData extends RowData>(
  columns: readonly AnyColumn<TData>[],
  sizing: Readonly<Record<string, number>>,
): AnyColumn<TData>[] {
  return columns.filter((column) => column.getCanResize() && sizing[column.id] === undefined)
}

/** Whether the table's body holds a drawn data row to measure. */
function hasDrawnRow(element: HTMLTableElement): boolean {
  return element.querySelector(":scope > tbody > tr:not(.dt-detail-row) > td[data-column-id]") !== null
}

/**
 * Fit every column the person has not sized to the first rows the table
 * draws — once per mounted table. Its widths go into `columnSizing`, so a
 * stored layout keeps them and the next visit draws them as they were: the
 * columns follow the data on the first look and then hold still, through a
 * page, a search and a filter.
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
  const { table } = instance
  const isDoneRef = useRef(false)
  const enabled = options !== false
  const maxGrowth = typeof options === "object" ? (options.maxGrowth ?? DEFAULT_MAX_GROWTH) : DEFAULT_MAX_GROWTH

  useIsomorphicLayoutEffect(() => {
    if (!enabled || !ready || isDoneRef.current) return
    let frame = 0
    let handle = 0

    const fit = () => {
      const element = tableRef.current
      if (!element) return
      // A virtualised body may draw its first rows a frame after the data: wait for them, a few frames at most.
      if (!hasDrawnRow(element)) {
        if (frame++ < MAX_WAIT_FRAMES) handle = requestAnimationFrame(fit)
        return
      }
      isDoneRef.current = true
      const sizes: Record<string, number> = {}
      for (const column of columnsToFit(renderedLeafColumns(table), table.state.columnSizing)) {
        const bounds = fitBounds(columnBounds(column), column.columnDef.size, maxGrowth)
        const width = measureColumnWidth(element, column.id, bounds)
        if (width !== null) sizes[column.id] = width
      }
      if (Object.keys(sizes).length === 0) return
      // What is in the state already stays: a width set while this waited is the person's.
      table.setColumnSizing((previous) => ({ ...sizes, ...previous }))
    }

    fit()
    return () => cancelAnimationFrame(handle)
  }, [enabled, ready, maxGrowth, table, tableRef])
}
