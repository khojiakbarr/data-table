import type { RowData } from "@tanstack/react-table"
import type { ReactNode, RefObject } from "react"
import type { DataTableInstance } from "../useDataTable"
import { measureTotalWidth } from "./autosize"
import { fitBounds } from "./fitBounds"
import { renderedLeafColumns } from "./pinning"
import { columnBounds } from "./sizing"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

/**
 * What the totals hold, as a key that changes when one appears or its text
 * does: a total drawn as an element counts by its column alone, since there
 * is no cheap way to read what it will say.
 *
 * @example
 * totalsKey({ amount: "1 200", qty: <b>4</b> }) // '[["amount","1 200"],["qty","object"]]'
 */
export function totalsKey(totals: Record<string, ReactNode> | undefined): string {
  if (totals === undefined) return ""
  const shown = Object.entries(totals).filter(([, value]) => value !== undefined && value !== null && value !== "")
  if (shown.length === 0) return ""
  return JSON.stringify(shown.map(([id, value]) => [id, typeof value === "string" || typeof value === "number" ? value : typeof value]))
}

/**
 * Widen a fitted column whose total came after the fit (`fitColumnsOnLoad`).
 *
 * A host's totals often answer later than its page, so the fit measured an
 * empty footer and the total was cut under the width the rows gave. Each
 * time a total appears or its text changes, a fitted column grows to hold
 * it — within the fit's own bounds, and never narrower: the columns still
 * hold still, and only the footer is measured, not the rows on screen now.
 *
 * @param instance - From {@link useDataTable}.
 * @param tableRef - The rendered `<table>`.
 * @param maxGrowth - The fit's `maxGrowth`.
 * @param key - {@link totalsKey} of the totals; "" while there are none or the fit is off.
 *
 * @example
 * useFitTotals(instance, tableRef, maxGrowthOf(fitColumnsOnLoad), fitColumnsOnLoad ? totalsKey(totals) : "")
 */
export function useFitTotals<TData extends RowData>(
  instance: DataTableInstance<TData>,
  tableRef: RefObject<HTMLTableElement | null>,
  maxGrowth: number,
  key: string,
): void {
  const { table, fittedSizing, setFittedSizing } = instance
  useIsomorphicLayoutEffect(() => {
    const element = tableRef.current
    // Before the fit there is nothing to grow: the fit measures the footer itself.
    if (key === "" || !element || Object.keys(fittedSizing).length === 0) return
    const grown: Record<string, number> = {}
    for (const column of renderedLeafColumns(table)) {
      const fitted = fittedSizing[column.id]
      if (fitted === undefined) continue
      const width = measureTotalWidth(element, column.id, fitBounds(columnBounds(column), column.columnDef.size, maxGrowth))
      if (width !== null && width > fitted) grown[column.id] = width
    }
    if (Object.keys(grown).length > 0) setFittedSizing((previous) => ({ ...previous, ...grown }))
  }, [key, fittedSizing, maxGrowth, table, tableRef, setFittedSizing])
}
