/**
 * Column width bounds.
 *
 * TanStack clamps a width when it is READ (`column.getSize()`), not when it is
 * written, so a drag past the edge or an oversized autosize result would be
 * stored as-is and only look right. Everything that writes a width goes
 * through here first, so what is persisted is what is rendered.
 */

/** TanStack's own fallbacks for a column that declares no bounds. */
const DEFAULT_MIN_WIDTH_PX = 20
const DEFAULT_MAX_WIDTH_PX = Number.MAX_SAFE_INTEGER

/** The subset of a TanStack column these helpers read. */
export interface SizedColumn {
  columnDef: { size?: number; minSize?: number; maxSize?: number }
}

export interface ColumnBounds {
  min: number
  max: number
}

/**
 * The narrowest and widest a column may be.
 *
 * `columnDef` already carries the table's `defaultColumn`, so a table-wide
 * `minColumnWidth` / `maxColumnWidth` shows up here without extra plumbing.
 *
 * @param column - The column being sized.
 * @returns Its bounds in pixels.
 */
export function columnBounds(column: SizedColumn): ColumnBounds {
  return {
    min: column.columnDef.minSize ?? DEFAULT_MIN_WIDTH_PX,
    max: column.columnDef.maxSize ?? DEFAULT_MAX_WIDTH_PX,
  }
}

/**
 * Keep a width inside a column's bounds.
 *
 * @param column - The column being sized.
 * @param width - The requested width.
 * @returns The width, clamped.
 *
 * @example
 * table.setColumnSizing((prev) => ({ ...prev, [id]: clampColumnWidth(column, 12) }))
 */
export function clampColumnWidth(column: SizedColumn, width: number): number {
  const { min, max } = columnBounds(column)
  return Math.min(max, Math.max(min, width))
}
