import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { MENU_TRIGGER_MIN_COLUMN_WIDTH } from "./components/HeaderCell"

/**
 * The header's two pointer targets at its inline-end edge: the resize handle
 * (`.dt-resizer`) and the column-menu trigger (`.dt-kebab`).
 *
 * The header is COMPACT by the owner's choice: the trigger sits right against
 * the handle so its dots land about 12px from the column divider. That gives up
 * WCAG 2.2 AA 2.5.8's 24px target spacing for these two (an earlier version met
 * it, with a 30px band between the dots and the divider on every header). What
 * is pinned here is what must stay true anyway — that the targets never overlap
 * each other or the label they sit beside, and that neither shrinks further
 * without someone changing this file on purpose.
 *
 * The geometry is read from the real stylesheet and checked as arithmetic rather
 * than through `getComputedStyle`: jsdom resolves no layout and no logical
 * insets, so a computed-style check would pass on any values.
 */
const stylesheet = readFileSync(resolve(__dirname, "styles.css"), "utf8")

/**
 * Reads one declaration from the first rule whose selector text is exactly `selector`.
 *
 * @param selector - The rule's selector, as written in the sheet.
 * @param property - The declaration's property name.
 * @returns The value in px.
 */
function pxOf(selector: string, property: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const rule = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(stylesheet)
  if (!rule) throw new Error(`no rule for ${selector}`)
  // A bare `0` is written without a unit; anything else must be px to be compared.
  const declaration = new RegExp(`(?:^|;|\\s)${property}:\\s*(0|[\\d.]+px)\\s*;`).exec(
    rule[1] ?? "",
  )
  if (!declaration) throw new Error(`${selector} has no ${property} in px`)
  return Number.parseFloat(declaration[1] ?? "")
}

describe("header targets at the column's end edge", () => {
  const kebabWidth = pxOf(".dt-kebab", "width")
  const kebabOffset = pxOf(".dt-kebab", "inset-inline-end")
  const resizerWidth = pxOf(".dt-resizer", "width")
  const resizerOffset = pxOf(".dt-resizer", "inset-inline-end")
  const reservedRoom = pxOf(".dt-th.dt-th-has-menu .dt-th-inner", "padding-inline-end")

  it("keeps the trigger off the resize handle, so a click on the dots never starts a resize", () => {
    expect(kebabOffset).toBeGreaterThanOrEqual(resizerOffset + resizerWidth)
  })

  it("reserves the room the trigger covers, so it never sits over the sort button", () => {
    // Overlap here would make a click on the sort arrow open the menu instead.
    expect(reservedRoom).toBeGreaterThanOrEqual(kebabOffset + kebabWidth)
  })

  it("keeps both targets at least as large as the compact header settled on", () => {
    // Floors, not targets: shrinking either below these is a decision, not a tidy-up.
    expect(kebabWidth).toBeGreaterThanOrEqual(14)
    expect(resizerWidth).toBeGreaterThanOrEqual(7)
  })

  it("draws no trigger in a column too narrow to leave its label room", () => {
    // The trigger's room plus enough for a short label to stay readable.
    expect(MENU_TRIGGER_MIN_COLUMN_WIDTH).toBeGreaterThanOrEqual(reservedRoom + 24)
  })
})
