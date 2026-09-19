import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  BASE_THEME_VALUES,
  DEFAULT_THEME,
  resolveThemeValues,
  THEME_CLASS,
  TOKEN_NAMES,
  themeStyleRule,
  type ThemeEditableKey,
} from "./playgroundState"

/**
 * The theme state's own rules, away from the page.
 *
 * Two things are worth pinning here. That an untouched token emits no CSS at
 * all — the whole of the Light/Dark/System control depends on it, and the
 * regression it guards (fourteen tokens pinned at their light defaults on
 * every render) was invisible to a test that only looked for one declaration
 * it knew was there. And that the light and dark defaults still say what
 * `styles.css` says, since they are a copy of it.
 */

const stylesheet = readFileSync(resolve(__dirname, "../styles.css"), "utf8")

/** The declarations of one rule, as `{ "--dt-bg": "#ffffff", … }`. */
function declarationsOf(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [, name, value] of block.matchAll(/(--dt-[a-z-]+):\s*([^;]+);/g)) {
    // Later wins, the same way the cascade resolves a repeated declaration.
    if (name && value) out[name] = value.trim()
  }
  return out
}

/** `styles.css`'s own light block: the first `.dt-root { … }` rule in the file. */
const lightCss = declarationsOf(stylesheet.match(/\.dt-root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "")

/** Its pinned dark block. The `prefers-color-scheme` one carries the same values. */
const darkCss = declarationsOf(
  stylesheet.match(/\.dt-root\[data-dt-theme="dark"\]\s*\{([^}]*)\}/)?.[1] ?? "",
)

/** `38` is written `38px` in CSS; a colour is already its own text. */
const asCss = (value: string | number): string => (typeof value === "number" ? `${value}px` : value)

const TOKEN_ENTRIES = Object.entries(TOKEN_NAMES) as [ThemeEditableKey, string][]

describe("themeStyleRule", () => {
  it("emits nothing at all until a token is edited", () => {
    // The critical one. Emitting every token at its light default pinned all
    // fourteen, which is how `theme="dark"` came to set `data-dt-theme` on the
    // root and change nothing: the base sheet's dark rule was overridden by an
    // `!important` copy of the light palette. An unedited playground has to
    // leave the cascade alone.
    expect(themeStyleRule(DEFAULT_THEME)).toBe("")
    expect(themeStyleRule({ theme: "dark", overrides: {} })).toBe("")
  })

  it("emits only the tokens that were edited, and leaves the rest to the base theme", () => {
    const rule = themeStyleRule({ theme: "dark", overrides: { background: "#ff0000" } })

    expect(rule).toContain("--dt-bg: #ff0000")
    expect(rule).not.toContain("--dt-fg")
    expect(rule).not.toContain("--dt-header-bg")
    expect(rule).not.toContain("--dt-row-stripe")
  })

  it("matches .dt-root directly and wins with !important", () => {
    // Both halves are load-bearing and for different reasons: the doubled
    // class because every token is declared on `.dt-root` itself, so an
    // ancestor's value is never read; `!important` because the dark rules
    // match at the same (0,2,0) specificity and would otherwise be settled by
    // which stylesheet connects last.
    const rule = themeStyleRule({ theme: "dark", overrides: { radius: 20 } })

    expect(rule).toContain(`.${THEME_CLASS}.dt-root {`)
    expect(rule).toContain("--dt-radius: 20px !important;")
  })

  it("units a numeric token and leaves a font stack alone", () => {
    const rule = themeStyleRule({
      theme: "light",
      overrides: { headerHeight: 48, fontSize: 16, fontFamily: "Georgia, serif" },
    })

    expect(rule).toContain("--dt-header-height: 48px !important;")
    expect(rule).toContain("--dt-font-size: 16px !important;")
    expect(rule).toContain("--dt-font: Georgia, serif !important;")
  })

  it("never emits row height, which is an option rather than a token", () => {
    // `<DataTable>` writes `--dt-row-height` inline on its own root every
    // render, so a rule here would lose to it and the slider would look dead.
    expect(themeStyleRule({ theme: "light", overrides: { rowHeight: 60 } })).toBe("")
  })
})

describe("resolveThemeValues", () => {
  it("shows the base theme's own value for an untouched token", () => {
    expect(resolveThemeValues(DEFAULT_THEME, "dark").background).toBe("#18181b")
    expect(resolveThemeValues(DEFAULT_THEME, "light").background).toBe("#ffffff")
  })

  it("keeps an edited token across a base-theme switch, and re-seeds the rest", () => {
    const state = { theme: "dark" as const, overrides: { background: "#ff0000" } }

    expect(resolveThemeValues(state, "dark")).toMatchObject({
      background: "#ff0000",
      headerBackground: "#1f1f23",
    })
    expect(resolveThemeValues(state, "light")).toMatchObject({
      background: "#ff0000",
      headerBackground: "#fafafa",
    })
  })
})

describe("base theme defaults", () => {
  it("still say what styles.css's own light block says", () => {
    for (const [key, token] of TOKEN_ENTRIES) {
      // `--dt-font` is the one deliberate divergence: the sheet says
      // `inherit`, which is not something a `<select>` can offer as a choice,
      // so the playground names the stack the page is actually using.
      if (key === "fontFamily") continue
      expect({ token, value: asCss(BASE_THEME_VALUES.light[key]) }).toEqual({
        token,
        value: lightCss[token],
      })
    }
  })

  it("still say what its dark block says, falling back to light where it declares nothing", () => {
    for (const [key, token] of TOKEN_ENTRIES) {
      if (key === "fontFamily") continue
      expect({ token, value: asCss(BASE_THEME_VALUES.dark[key]) }).toEqual({
        token,
        value: darkCss[token] ?? lightCss[token],
      })
    }
  })
})
