import type { ColumnBounds } from "./sizing"

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

/**
 * The `maxGrowth` in force: the option's, else the default 2.
 *
 * @example
 * maxGrowthOf({ maxGrowth: 3 }) // 3
 * maxGrowthOf(true) // 2
 */
export function maxGrowthOf(options: boolean | FitColumnsOnLoad): number {
  return typeof options === "object" ? (options.maxGrowth ?? DEFAULT_MAX_GROWTH) : DEFAULT_MAX_GROWTH
}

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
