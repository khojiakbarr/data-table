import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The header's two pointer targets against WCAG 2.2 AA 2.5.8 (Target Size, Minimum).
 *
 * The column-menu trigger (`.dt-kebab`) and the resize handle (`.dt-resizer`) share the
 * header cell's inline-end edge. 2.5.8 asks for a 24 by 24 CSS px target, or — for an
 * undersized one — that a 24px circle centred on it intersect no other target. The resize
 * handle is deliberately narrow (it straddles the column edge), so its circle is the one
 * the kebab must stay clear of; the kebab itself is sized to pass on its own.
 *
 * The geometry is read from the real stylesheet and checked as arithmetic rather than
 * through `getComputedStyle`: jsdom resolves no layout and no logical insets, so a
 * computed-style check would pass on any values. What is pinned here is the relationship
 * between the numbers, which is what a later edit to one of them would break.
 */
const stylesheet = readFileSync(resolve(__dirname, "styles.css"), "utf8")

/** The WCAG 2.5.8 minimum, in CSS px. */
const MIN_TARGET_PX = 24

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

describe("header target size (WCAG 2.5.8)", () => {
  const kebabWidth = pxOf(".dt-kebab", "width")
  const kebabOffset = pxOf(".dt-kebab", "inset-inline-end")
  const resizerWidth = pxOf(".dt-resizer", "width")
  const resizerOffset = pxOf(".dt-resizer", "inset-inline-end")
  const reservedRoom = pxOf(".dt-th:not(.dt-th-group) .dt-th-inner", "padding-inline-end")

  it("gives the column-menu trigger a full 24px target", () => {
    expect(kebabWidth).toBeGreaterThanOrEqual(MIN_TARGET_PX)
  })

  it("keeps the trigger clear of the resize handle's 24px circle", () => {
    // The handle's circle is centred on the handle and reaches half a target past it.
    const circleReach = resizerOffset + resizerWidth / 2 + MIN_TARGET_PX / 2
    expect(kebabOffset).toBeGreaterThanOrEqual(circleReach)
  })

  it("reserves the label room the trigger covers, so it never paints over the label", () => {
    expect(reservedRoom).toBeGreaterThanOrEqual(kebabOffset + kebabWidth)
  })
})
