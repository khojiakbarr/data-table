/**
 * Fitting a column to its content.
 *
 * Measured with a canvas rather than by writing widths to the DOM and reading
 * them back: that would force a layout for every column, and on a wide table
 * the reflows are visible as a stutter. A canvas measures text with no layout
 * at all.
 *
 * Only the rows currently in the DOM are measured. Measuring the whole dataset
 * would mean rendering it, which defeats the point of not rendering it.
 *
 * Cells are found by column id, never by position. With grouped headers a
 * leaf that spans several header rows is not in the last row at all, so
 * `th:nth-child(n)` there belongs to a different column; and a descendant
 * selector reaches into the tables that detail panels mount, so their rows
 * would be counted too. `:scope >` plus `data-column-id` avoids both.
 */

/** Cell padding plus a little slack, so a fitted cell does not clip. */
const CELL_CHROME_PX = 28
/** Extra room in a header, which also holds the sort icon and resize handle. */
const HEADER_CHROME_PX = 46
/** The expand toggle (see `.dt-expand`) and the gap that follows it (`.dt-lead`). */
const LEAD_TOGGLE_PX = 18
const LEAD_GAP_PX = 6
/** Matches the `--dt-indent` default in styles.css. */
const DEFAULT_INDENT_PX = 18

let canvas: HTMLCanvasElement | null = null

function measureText(text: string, font: string): number {
  canvas ??= document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!context) return 0
  context.font = font
  return context.measureText(text).width
}

/** Rendered text of an element; `innerText` is absent in jsdom. */
function textOf(element: HTMLElement): string {
  return (element.innerText ?? element.textContent ?? "").trim()
}

/** The shorthand `font` value an element is rendered with. */
function fontOf(element: Element): string {
  const style = getComputedStyle(element)
  return `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
}

/** Escape a column id for use inside a double-quoted attribute selector. */
function quoteAttribute(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`
}

/** Pixel value of `--dt-indent` as the cell sees it. */
function indentOf(cell: Element): number {
  const px = Number.parseFloat(getComputedStyle(cell).getPropertyValue("--dt-indent"))
  return Number.isFinite(px) ? px : DEFAULT_INDENT_PX
}

/**
 * Non-text width a body cell needs besides its padding.
 *
 * The lead cell also holds the expand toggle or a depth spacer, the gap after
 * it, and one indent per nesting level — none of which the canvas sees.
 */
function cellChrome(cell: HTMLElement): number {
  if (!cell.classList.contains("dt-td-lead")) return CELL_CHROME_PX

  const depth = Number(cell.parentElement?.dataset.depth ?? 0)
  const control = cell.querySelector(".dt-expand")
    ? LEAD_TOGGLE_PX + LEAD_GAP_PX
    : cell.querySelector(".dt-depth-spacer")
      ? LEAD_GAP_PX
      : 0
  return CELL_CHROME_PX + control + (depth > 0 ? indentOf(cell) * depth : 0)
}

export interface AutosizeBounds {
  min: number
  max: number
}

/**
 * Width that fits a column's header label, including the header's chrome.
 *
 * Works for group headers too, which is what lets "Fit all columns" keep a
 * group label from being truncated when its children shrink.
 *
 * @param table - The table element the column is rendered in.
 * @param columnId - Leaf or group column id.
 * @returns A width in pixels, or null when no header carries that id.
 */
export function measureHeaderWidth(table: HTMLTableElement, columnId: string): number | null {
  const header = table.querySelector<HTMLElement>(
    `:scope > thead > tr > th[data-column-id=${quoteAttribute(columnId)}]`,
  )
  if (!header) return null
  return measureText(textOf(header), fontOf(header)) + HEADER_CHROME_PX
}

/**
 * Width that fits a column's visible content.
 *
 * @param table - The table element the column is rendered in.
 * @param columnId - The leaf column's id.
 * @param bounds - Clamp applied to the result.
 * @returns A width in pixels, or null when the column is not in the DOM.
 *
 * @example
 * const width = measureColumnWidth(tableEl, "partner", columnBounds(column))
 * if (width !== null) table.setColumnSizing((prev) => ({ ...prev, partner: width }))
 */
export function measureColumnWidth(
  table: HTMLTableElement,
  columnId: string,
  bounds: AutosizeBounds,
): number | null {
  const bodyCells = table.querySelectorAll<HTMLElement>(
    `:scope > tbody > tr:not(.dt-detail-row) > td[data-column-id=${quoteAttribute(columnId)}]`,
  )
  const headerWidth = measureHeaderWidth(table, columnId)
  if (bodyCells.length === 0 && headerWidth === null) return null

  let widest = headerWidth ?? 0
  for (const cell of bodyCells) {
    const width = measureText(textOf(cell), fontOf(cell)) + cellChrome(cell)
    if (width > widest) widest = width
  }

  return Math.round(Math.min(bounds.max, Math.max(bounds.min, widest)))
}
