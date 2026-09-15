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
 */

/** Room for cell padding and any control sharing the cell. */
const CELL_CHROME_PX = 28
/** Extra room in a header, which also holds the sort icon and resize handle. */
const HEADER_CHROME_PX = 46

let canvas: HTMLCanvasElement | null = null

function measureText(text: string, font: string): number {
  canvas ??= document.createElement("canvas")
  const context = canvas.getContext("2d")
  if (!context) return 0
  context.font = font
  return context.measureText(text).width
}

/** The shorthand `font` value an element is rendered with. */
function fontOf(element: Element): string {
  const style = getComputedStyle(element)
  return `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
}

export interface AutosizeBounds {
  min: number
  max: number
}

/**
 * Width that fits a column's visible content.
 *
 * @param root - The table's root element.
 * @param columnIndex - Zero-based position among the rendered columns.
 * @param bounds - Clamp applied to the result.
 * @returns A width in pixels, or null when the column is not in the DOM.
 *
 * @example
 * const width = measureColumnWidth(rootEl, 2, { min: 60, max: 800 })
 * if (width !== null) column.setSize(width)
 */
export function measureColumnWidth(
  root: HTMLElement,
  columnIndex: number,
  bounds: AutosizeBounds,
): number | null {
  const bodyCells = root.querySelectorAll<HTMLElement>(
    `tbody tr:not(.dt-detail-row) td:nth-child(${columnIndex + 1})`,
  )
  const headerCell = root.querySelector<HTMLElement>(
    `thead tr:last-child th:nth-child(${columnIndex + 1})`,
  )
  if (bodyCells.length === 0 && !headerCell) return null

  let widest = 0

  if (headerCell) {
    widest = measureText(headerCell.innerText.trim(), fontOf(headerCell)) + HEADER_CHROME_PX
  }

  for (const cell of bodyCells) {
    const width = measureText(cell.innerText.trim(), fontOf(cell)) + CELL_CHROME_PX
    if (width > widest) widest = width
  }

  return Math.round(Math.min(bounds.max, Math.max(bounds.min, widest)))
}
