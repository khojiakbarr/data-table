/**
 * How tall the whole table may be, and where a grip drag or an arrow press
 * lands.
 *
 * The decisions live here rather than in the grip component so they can be
 * tested without a layout engine: jsdom lays nothing out, so a component test
 * could only ever check that these were called, never what they answered.
 */

/**
 * Space the rows never get, in pixels.
 *
 * `height` sizes the WHOLE table — toolbar, header, rows, footer — so a
 * minimum expressed in rows has to leave room for the rest. Deliberately a
 * constant and not a measurement: the minimum exists to stop a drag from
 * collapsing the table to nothing, and a bound that moved as the toolbar
 * wrapped or the footer appeared would make the grip stick at a different
 * place on every render. It is a generous estimate of a default toolbar, one
 * header row and a pagination footer; a table with none of them simply stops
 * a little sooner than it strictly had to, which is the safe direction.
 */
const CHROME_ALLOWANCE_PX = 130

/** Rows that stay visible at the minimum, so the table never collapses to its chrome. */
const MIN_VISIBLE_ROWS = 2

/** Shift-arrow moves the grip this many rows at once. */
const COARSE_STEP_ROWS = 5

/** What a row height falls back to when a host passes something unusable. */
const FALLBACK_ROW_HEIGHT_PX = 40

/**
 * A usable row height.
 *
 * `rowHeight` is a public option, so `NaN`, `0` and a negative are all things
 * a host can hand over — and each would travel straight into `Math.max` and
 * make the minimum below either `NaN` or smaller than the chrome it is meant
 * to protect.
 */
function usableRowHeight(rowHeight: number): number {
  return Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : FALLBACK_ROW_HEIGHT_PX
}

/**
 * The shortest the table is allowed to be.
 *
 * Enough for the chrome plus {@link MIN_VISIBLE_ROWS} rows, so a grip dragged
 * to the top of the screen leaves a table that still reads as a table.
 *
 * @param rowHeight - The table's row height, in pixels.
 * @returns The minimum height in pixels.
 *
 * @example
 * minTableHeight(40) // 210
 */
export function minTableHeight(rowHeight: number): number {
  return CHROME_ALLOWANCE_PX + MIN_VISIBLE_ROWS * usableRowHeight(rowHeight)
}

/**
 * How far one arrow press moves the grip.
 *
 * One row, rather than the column resizer's flat 10px: a height is read in
 * rows, and a press that reveals exactly one more row is both the obvious
 * unit and one a user can count. Shift multiplies it by
 * {@link COARSE_STEP_ROWS}, the way Shift does on the column handle.
 *
 * @param rowHeight - The table's row height, in pixels.
 * @param coarse - Whether Shift was held.
 * @returns The step in pixels.
 */
export function tableHeightStep(rowHeight: number, coarse: boolean): number {
  const step = usableRowHeight(rowHeight)
  return coarse ? step * COARSE_STEP_ROWS : step
}

/**
 * Keep a height inside its bounds, and off fractional pixels.
 *
 * Every write goes through here — the drag, the keyboard, the playground's
 * field and a layout read back from storage — so what is persisted is what is
 * rendered, the way {@link clampColumnWidth} does for a column.
 *
 * There is no maximum. A table taller than the window is a layout the host
 * chose and the page scrolls to; capping it would mean guessing at a viewport
 * this module cannot see.
 *
 * @param height - The requested height in pixels.
 * @param rowHeight - The table's row height, in pixels.
 * @returns A whole number of pixels, never below {@link minTableHeight}.
 *
 * @example
 * clampTableHeight(startHeight + event.clientY - startY, instance.rowHeight)
 */
export function clampTableHeight(height: number, rowHeight: number): number {
  const min = minTableHeight(rowHeight)
  if (!Number.isFinite(height)) return min
  return Math.max(min, Math.round(height))
}
