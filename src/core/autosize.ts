/**
 * Fitting a column to its content.
 *
 * Measured with a canvas rather than by writing widths to the DOM and reading
 * them back: that would force a layout for every column, and on a wide table
 * the reflows are visible as a stutter. A canvas measures text with no layout
 * at all.
 *
 * A cell's text alone is not its width, though: a chip or a badge draws its
 * label inside its own padding and border, and an icon beside a name takes
 * room no text accounts for. Measured as text, a column of status chips was
 * fitted 20–30px too narrow and every chip was cut at its right edge. So a
 * body cell is walked as boxes: text through the canvas, each element's own
 * horizontal padding, border, margin and pixel `min-width` from its computed
 * style, a row of
 * flex children with their gap, and a replaced element (an icon, an image) by
 * its drawn width. Nothing is written, so the one layout this may read is the
 * one the browser owes the frame anyway.
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

/** Elements whose width is their own, not their content's. */
const REPLACED = new Set(["svg", "img", "canvas", "video", "input", "select", "textarea", "progress", "meter"])
/** The lead cell's own parts, which `cellChrome` already counts. */
const LEAD_PARTS = ".dt-expand, .dt-depth-spacer"

function px(value: string): number {
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : 0
}

/** A border's width, which is none at all while it has no style — whatever `border-width` says. */
function borderWidth(borderStyle: string, width: string): number {
  return borderStyle === "" || borderStyle === "none" || borderStyle === "hidden" ? 0 : px(width)
}

/** An element's horizontal padding and border — what stands between its border edge and its content. */
function paddingAndBorder(style: CSSStyleDeclaration): number {
  return (
    px(style.paddingLeft) +
    px(style.paddingRight) +
    borderWidth(style.borderLeftStyle, style.borderLeftWidth) +
    borderWidth(style.borderRightStyle, style.borderRightWidth)
  )
}

/** A `min-width` in pixels; `auto`, `0` and a percentage of a width still being found are no floor. */
function minWidthOf(style: CSSStyleDeclaration): number {
  return style.minWidth.endsWith("px") ? px(style.minWidth) : 0
}

/** Whether an element lays its children out side by side, as a flex row does. */
function isRow(style: CSSStyleDeclaration): boolean {
  return style.display.endsWith("flex") && !style.flexDirection.startsWith("column")
}

/** Whether an element starts a line of its own inside a block. */
function isBlockLevel(style: CSSStyleDeclaration): boolean {
  return ["block", "flex", "grid", "list-item", "table"].includes(style.display)
}

/**
 * The width an element's children need laid out on one line, unwrapped and
 * uncut: side by side with their gap in a flex row; in a block, the inline
 * ones run together and each block-level one takes a line of its own.
 */
function childrenWidth(element: Element, style: CSSStyleDeclaration): number {
  const widths: number[] = []
  const blocks: number[] = []
  let run = 0
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const collapsed = (child.textContent ?? "").replace(/\s+/g, " ")
      // A lone text node's edges collapse away in a nowrap cell, as `innerText` trims them.
      const text = element.childNodes.length === 1 ? collapsed.trim() : collapsed
      if (text.trim() === "") continue
      const width = measureText(text, fontOf(element))
      widths.push(width)
      run += width
      continue
    }
    if (!(child instanceof Element) || child.matches(LEAD_PARTS)) continue
    const childStyle = getComputedStyle(child)
    if (childStyle.display === "none" || childStyle.position === "absolute" || childStyle.position === "fixed") continue
    const width = boxWidth(child, childStyle)
    widths.push(width)
    if (isBlockLevel(childStyle)) blocks.push(width)
    else run += width
  }
  if (isRow(style)) {
    const gap = px(style.columnGap)
    return widths.reduce((sum, width) => sum + width, 0) + (widths.length > 1 ? gap * (widths.length - 1) : 0)
  }
  return Math.max(run, ...blocks)
}

/** The width an element needs drawn whole: its content and its own horizontal chrome. */
function boxWidth(element: Element, style: CSSStyleDeclaration): number {
  if (REPLACED.has(element.localName)) {
    const drawn = element.getBoundingClientRect().width
    return (drawn > 0 ? drawn : px(style.width)) + px(style.marginLeft) + px(style.marginRight)
  }
  // An empty inline box (a spacer, an icon's frame) is as wide as it is drawn; a block one would read the cell's width.
  const ownWidth = element.childNodes.length === 0 && !isBlockLevel(style) ? px(style.width) : 0
  const content = Math.max(childrenWidth(element, style), ownWidth)
  const edges = paddingAndBorder(style)
  // A chip a theme gives a `min-width` is drawn that wide whatever its label; the floor is the border box's or the content's.
  const floor = minWidthOf(style)
  const box = style.boxSizing === "border-box" ? Math.max(content + edges, floor) : Math.max(content, floor) + edges
  return box + px(style.marginLeft) + px(style.marginRight)
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
    const width = childrenWidth(cell, getComputedStyle(cell)) + cellChrome(cell)
    if (width > widest) widest = width
  }

  return Math.round(Math.min(bounds.max, Math.max(bounds.min, widest)))
}
