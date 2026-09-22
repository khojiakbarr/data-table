import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

/**
 * Presets are static CSS, not code — the only automatable check is that each
 * preset file mentions every custom property the base stylesheet defines on
 * `.dt-root`. That keeps a preset from silently going stale when a later task
 * adds a new `--dt-*` token to `src/styles.css`.
 */
const read = (file: string) => readFileSync(resolve(__dirname, file), "utf8")

/**
 * Every token the base sheet defines on `.dt-root`.
 *
 * The character class includes digits: the project's own token convention
 * uses digit-suffixed names (e.g. `--dt-elevation-1`, CLAUDE.md §7), and a
 * regex that can't see those would silently stop guarding them.
 */
const baseTokens = [...read("../styles.css").matchAll(/^\s*(--dt-[a-z0-9-]+)\s*:/gm)].map((m) => m[1] as string)

/**
 * Tokens the presets deliberately leave alone.
 *
 * shadcn has no variable for a row height, an indent or a fallback viewport
 * height, so a preset entry could only repeat the base sheet's own value — at
 * the preset's higher specificity, which would quietly stop a host from
 * changing it with a plain `.dt-root {}` rule. They stay with the base sheet
 * instead.
 */
const INHERITED_TOKENS = [
  "--dt-header-height",
  "--dt-row-height",
  "--dt-indent",
  "--dt-font-size",
  "--dt-viewport-max-height",
]

/** A preset with its comments removed, so prose cannot pass for a mapping. */
const readDeclarations = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "")

/** WCAG 2.x relative luminance of a `#rgb` or `#rrggbb` colour. */
const luminance = (hex: string): number => {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex
  const channel = (from: number): number => {
    const value = Number.parseInt(full.slice(from, from + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** WCAG contrast ratio between two hex colours, lighter over darker. */
const contrastRatio = (a: string, b: string): number => {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** The value the base sheet gives a token in its default (light) block. */
const baseTokenValue = (token: string): string => {
  const match = read("../styles.css").match(new RegExp(`^\\s*${token}\\s*:\\s*([^;]+);`, "m"))
  return (match?.[1] ?? "").trim()
}

/**
 * The value the base sheet gives a token in its pinned `[data-dt-theme="dark"]`
 * block. Scoped to that one block (rather than a file-wide search, which
 * `baseTokenValue` deliberately is not) so a token this suite does not check
 * in the dark theme can't be silently matched against its light value instead.
 */
const darkTokenValue = (token: string): string => {
  const block = read("../styles.css").match(/\.dt-root\[data-dt-theme="dark"\]\s*\{([^}]*)\}/)?.[1] ?? ""
  const match = block.match(new RegExp(`${token}\\s*:\\s*([^;]+);`))
  return (match?.[1] ?? "").trim()
}

/**
 * A token's final colour in one theme, following `var(--dt-*)` indirection.
 *
 * Several tokens are declared as an alias rather than a literal —
 * `--dt-footer-bg: var(--dt-bg)` is how the footer keeps the surface colour
 * it always had without duplicating the hex in two theme blocks — so a
 * contrast assertion that read the declaration text alone would be comparing
 * the string `var(--dt-bg)`, not a colour, and `luminance` would quietly
 * return garbage for it.
 *
 * A token the dark block does not restate resolves against its light
 * declaration, which is exactly what the cascade does: the dark block only
 * overrides what actually changes. That fallback is deliberate here and
 * deliberately absent from `darkTokenValue`, which stays strict so a token a
 * test means to check IN dark cannot silently pass on its light value.
 */
const resolvedTokenValue = (token: string, theme: "light" | "dark"): string => {
  const seen = new Set<string>()
  let name = token
  for (;;) {
    if (seen.has(name)) throw new Error(`cyclic token alias: ${name}`)
    seen.add(name)
    const value = (theme === "dark" ? darkTokenValue(name) || baseTokenValue(name) : baseTokenValue(name)).trim()
    const alias = value.match(/^var\(\s*(--dt-[a-z0-9-]+)\s*\)$/)
    if (!alias?.[1]) return value
    name = alias[1]
  }
}

/**
 * Approximates CSS specificity for the simple selectors these theme files
 * use (classes and attribute selectors only — no ids or type selectors), by
 * counting `.class` and `[attr=value]` components, including ones nested
 * inside `:not(...)`. That is exactly the "B" component of the standard
 * (a, b, c) specificity tuple, which is the only component that varies
 * across these selectors.
 */
const classAndAttributeSpecificity = (selector: string): number => {
  const classes = selector.match(/\.[a-zA-Z0-9_-]+/g)?.length ?? 0
  const attributes = selector.match(/\[[^\]]+\]/g)?.length ?? 0
  return classes + attributes
}

/**
 * Extracts every selector list that opens a rule body in a CSS file (i.e.
 * the text before each `{`), skipping `@media` block headers themselves —
 * only the nested rule's own selector carries specificity.
 */
const extractSelectorGroups = (css: string): string[] => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "")
  return [...withoutComments.matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((selector) => selector.length > 0 && !selector.startsWith("@"))
}

/** Highest specificity among all `.dt-root`-targeting selectors in a CSS file. */
const maxSpecificity = (css: string): number =>
  Math.max(
    0,
    ...extractSelectorGroups(css)
      .flatMap((group) => group.split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.startsWith(".dt-root"))
      .map(classAndAttributeSpecificity),
  )

describe("base stylesheet token extraction", () => {
  // Guards the extraction itself: if a future reformat of styles.css breaks
  // the line anchor the regex relies on, this fails loudly instead of the
  // preset tests below passing vacuously with an empty token list.
  it("finds the base tokens", () => {
    expect(baseTokens.length).toBeGreaterThan(0)
    expect(new Set(baseTokens).size).toBe(28)
  })

  it("matches digit-suffixed token names", () => {
    const sample = "  --dt-elevation-1: 0 1px 2px black;\n  --dt-accent: #3b82f6;"
    const matches = [...sample.matchAll(/^\s*(--dt-[a-z0-9-]+)\s*:/gm)].map((m) => m[1])
    expect(matches).toEqual(["--dt-elevation-1", "--dt-accent"])
  })
})

/**
 * The `--dt-*` tokens that read a host's own table token before falling back
 * to a shadcn variable, and the token each one reads.
 *
 * The host group also carries `--table-row-selected`; it is deliberately not
 * here, because this table has no row-selection feature and mapping it would
 * publish a token that paints nothing.
 */
const TABLE_TOKEN_PREFERENCES: Record<string, string> = {
  "--dt-header-bg": "--table-header-bg",
  "--dt-header-fg": "--table-header-fg",
  "--dt-row-hover": "--table-row-hover",
  "--dt-row-stripe": "--table-row-stripe",
  "--dt-pinned-bg": "--table-pinned-bg",
  "--dt-footer-bg": "--table-footer-bg",
  "--dt-footer-fg": "--table-footer-fg",
}

/**
 * What each preferred token resolved to BEFORE the `--table-*` chain existed,
 * i.e. what a host defining no table tokens must still get today.
 *
 * `--dt-pinned-bg` and the two footer tokens had no preset entry of their own
 * then; the value recorded is the one the base sheet's rule painted for that
 * surface (the plain `.dt-td` / `.dt-footer` background, and the footer's
 * muted text), which is the thing that must not move.
 */
const PRE_CHANGE_MAPPINGS: Record<string, Record<string, string>> = {
  "shadcn.css": {
    "--dt-header-bg": "var(--muted)",
    "--dt-header-fg": "var(--muted-foreground)",
    "--dt-row-hover": "var(--accent)",
    "--dt-row-stripe": "color-mix(in oklab, var(--muted) 50%, var(--background))",
    "--dt-pinned-bg": "var(--background)",
    "--dt-footer-bg": "var(--background)",
    "--dt-footer-fg": "var(--muted-foreground)",
  },
  "shadcn-hsl.css": {
    "--dt-header-bg": "hsl(var(--muted))",
    "--dt-header-fg": "hsl(var(--muted-foreground))",
    "--dt-row-hover": "hsl(var(--accent))",
    "--dt-row-stripe": "color-mix(in srgb, hsl(var(--muted)) 50%, hsl(var(--background)))",
    "--dt-pinned-bg": "hsl(var(--background))",
    "--dt-footer-bg": "hsl(var(--background))",
    "--dt-footer-fg": "hsl(var(--muted-foreground))",
  },
}

describe("shadcn presets", () => {
  for (const file of ["shadcn.css", "shadcn-hsl.css"]) {
    it(`${file} maps every base token shadcn can supply`, () => {
      // Comments are stripped first: both headers name tokens in prose, and a
      // raw-text search once counted that as a mapping — deleting a real
      // declaration left this test green.
      const preset = readDeclarations(file)
      const missing = [...new Set(baseTokens)]
        .filter((token) => !INHERITED_TOKENS.includes(token))
        .filter((token) => !preset.includes(`${token}:`))
      expect(missing).toEqual([])
    })

    it(`${file} leaves the sizing tokens to the base sheet`, () => {
      // Re-declaring a base value inside the preset's (0,2,0) rule costs the
      // host a plain `.dt-root {}` override and buys nothing.
      const preset = readDeclarations(file)
      expect(INHERITED_TOKENS.filter((token) => preset.includes(`${token}:`))).toEqual([])
    })

    it(`${file} pairs --dt-accent with a readable foreground token`, () => {
      const preset = readDeclarations(file)
      // shadcn guarantees --primary-foreground contrasts with --primary in
      // both light and dark, unlike a hardcoded white foreground.
      expect(preset).toMatch(/--dt-accent-fg:\s*(hsl\()?var\(--primary-foreground\)/)
    })

    it(`${file} does not exceed the base sheet's cascade specificity`, () => {
      const preset = read(file)
      const base = read("../styles.css")
      // A preset selector prized higher than the base sheet's own would beat
      // any host override written at the base sheet's own specificity,
      // leaving hosts no way to override a token short of `!important`.
      expect(maxSpecificity(preset)).toBeLessThanOrEqual(maxSpecificity(base))
    })

    it(`${file} leaves the pinned \`theme\` prop branches to the base sheet`, () => {
      const preset = read(file)
      // A selector may legitimately *exclude* a pinned theme (the sole rule
      // does, via `:not([data-dt-theme])`) without mapping it. What must not
      // reappear is a selector that positively matches `[data-dt-theme="dark"]`
      // or `[data-dt-theme="light"]` — that would map a pinned branch to the
      // same shadcn variables as the unpinned case, making the public `theme`
      // prop a no-op. This is a text-level guard only; the cascade-resolution
      // suite below is what actually proves the pin holds.
      const selectors = extractSelectorGroups(preset)
        .flatMap((group) => group.split(","))
        .map((selector) => selector.trim())
      const pinsATheme = selectors.some((selector) =>
        /\[data-dt-theme="(dark|light)"\]/.test(selector.replace(/:not\([^)]*\)/g, "")),
      )
      expect(pinsATheme).toBe(false)
    })

    it(`${file} excludes both pinned states from its one rule, not just one of them`, () => {
      const preset = read(file)
      // Regression guard for a real bug: an earlier round only excluded
      // `[data-dt-theme="light"]`, so `theme="dark"` under an OS dark
      // preference still lost to this preset (see the cascade-resolution
      // suite below for the reproduction). Excluding the attribute by
      // presence — `:not([data-dt-theme])`, with no value — excludes every
      // pinned value at once and can't silently regress to excluding just one.
      expect(preset).toContain(":not([data-dt-theme])")
      expect(preset).not.toContain(':not([data-dt-theme="light"])')
      expect(preset).not.toContain(':not([data-dt-theme="dark"])')
    })

    it(`${file} does not duplicate a dark-media branch`, () => {
      const preset = read(file)
      // A second `@media (prefers-color-scheme: dark)` block re-declaring
      // the same tokens at the base sheet's own specificity is how the
      // previous round silently defeated host overrides in dark OS mode
      // only (the plain rule and the media rule disagreed on what a host
      // override needs to beat). One rule, unconditional on OS mode, can't
      // reintroduce that mode-dependent asymmetry. Strip comments first: the
      // file's own header comment discusses `@media` in prose.
      const withoutComments = preset.replace(/\/\*[\s\S]*?\*\//g, "")
      expect(withoutComments).not.toMatch(/@media/)
    })

    it(`${file} prefers a host's own table token for every surface that has one`, () => {
      const preset = readDeclarations(file)
      // The host's `--table-*` group is more specific than anything shadcn's
      // general vocabulary can express, so it has to be READ FIRST, with the
      // old shadcn mapping demoted to the fallback. `--table-row-selected` is
      // absent on purpose: there is no row-selection feature to colour.
      for (const [dtToken, tableToken] of Object.entries(TABLE_TOKEN_PREFERENCES)) {
        const declaration = preset.match(new RegExp(`${dtToken}:\\s*([^;]+);`))?.[1] ?? ""
        expect(declaration.startsWith(`var(${tableToken},`)).toBe(true)
      }
    })

    it(`${file} falls back to exactly what it mapped before the table tokens existed`, () => {
      const preset = readDeclarations(file)
      // The whole point of the chain is that it is additive: a host with only
      // shadcn variables must get byte-identical output. These literals are
      // the pre-change right-hand sides, so a fallback that drifts — to
      // `--muted` for a pinned column, say, which would tint frozen columns
      // for every existing host — fails here rather than in their screenshot.
      for (const [dtToken, expected] of Object.entries(PRE_CHANGE_MAPPINGS[file] ?? {})) {
        const declaration = preset.match(new RegExp(`${dtToken}:\\s*([^;]+);`))?.[1]?.trim() ?? ""
        const fallback = declaration.replace(/^var\(--table-[a-z-]+,\s*/, "").replace(/\)$/, "")
        expect(fallback).toBe(expected)
      }
    })

    it(`${file} keeps the row stripe opaque instead of mixing to transparent`, () => {
      const preset = read(file)
      // A translucent stripe lets horizontally-scrolled content show through
      // a sticky pinned column on striped odd rows (`.dt-pinned` paints no
      // background of its own — see styles.css). Mixing toward the surface
      // token instead of `transparent` keeps the result opaque.
      const stripeDeclaration = preset.match(/--dt-row-stripe:\s*([^;]+);/)?.[1] ?? ""
      expect(stripeDeclaration).not.toContain("transparent")
      expect(stripeDeclaration).toMatch(/background/)
    })
  }
})

/**
 * Renders the base sheet plus each preset into a real `<style>` element and
 * reads back `getComputedStyle` — the actual CSS cascade, not a guess about
 * it from selector text. This is what catches specificity/source-order bugs
 * that a purely textual check (above) cannot: jsdom's CSSOM resolves classes,
 * attribute selectors and `:not()` exactly as a browser would, picking the
 * winning declaration by the real (specificity, source order) rule — it just
 * doesn't resolve `var()`/`color-mix()` values, so assertions compare the
 * winning declaration's raw text instead of a final resolved colour.
 *
 * Known gap: jsdom does not evaluate `prefers-color-scheme` for cascade
 * purposes (confirmed empirically — `window.matchMedia` mocked to report
 * `dark` does not change which `@media` rules apply), so these tests can only
 * exercise the "OS light" cascade. That is sufficient to catch the pin-defeat
 * regression this suite guards against: presets are unconditional on
 * `prefers-color-scheme` since the fix (see the "does not duplicate a
 * dark-media branch" test above), so an OS-dark branch no longer exists to
 * hide a separate bug from this OS-light check.
 */
describe("shadcn presets — cascade resolution", () => {
  const base = read("../styles.css")

  for (const file of ["shadcn.css", "shadcn-hsl.css"]) {
    describe(file, () => {
      let styleEl: HTMLStyleElement

      beforeEach(() => {
        styleEl = document.createElement("style")
        styleEl.textContent = `${base}\n${read(file)}`
        document.head.appendChild(styleEl)
      })

      afterEach(() => {
        styleEl.remove()
      })

      /** Renders a `.dt-root` with the given `data-dt-theme` (omitted when undefined) and returns its computed `--dt-bg`. */
      const resolvedBg = (theme?: "light" | "dark"): string => {
        const el = document.createElement("div")
        el.className = "dt-root"
        if (theme) el.setAttribute("data-dt-theme", theme)
        document.body.appendChild(el)
        const value = getComputedStyle(el).getPropertyValue("--dt-bg").trim()
        el.remove()
        return value
      }

      it("leaves an unpinned table on the preset's shadcn mapping", () => {
        // The base sheet's own light-default value is a hardcoded #ffffff;
        // winning over it with `var(--background)` is the preset's entire job.
        expect(resolvedBg()).toContain("var(--background)")
      })

      it('does not let the preset win over theme="light"', () => {
        // Regression: the previous round's unguarded `.dt-root {}` rule tied
        // the base sheet's own plain rule on specificity and loaded after it,
        // so this resolved to `var(--background)` instead of the pinned value.
        const value = resolvedBg("light")
        expect(value).not.toContain("var(--background)")
        expect(value).toBe("#ffffff")
      })

      it('does not let the preset win over theme="dark"', () => {
        const value = resolvedBg("dark")
        expect(value).not.toContain("var(--background)")
        expect(value).toBe("#18181b")
      })
    })
  }
})

/**
 * The shadcn override recipe (finding #18): the preset's own selector is
 * `(0,2,0)`, so a host rule at the same specificity only TIES it — and a tie
 * is broken by whichever stylesheet connects to the document last, not by
 * which rule "looks like an override". `.dt-root.dt-root.dt-root` is `(0,3,0)`
 * and wins outright, with no load-order dependency left to document.
 */
describe("shadcn presets — host override specificity", () => {
  const base = read("../styles.css")

  for (const file of ["shadcn.css", "shadcn-hsl.css"]) {
    describe(file, () => {
      const preset = read(file)

      /**
       * Base, preset and a host rule, connected in the given order and
       * nothing reordered afterwards — jsdom's tie-break follows connection
       * order, not final DOM position, so reusing an already-connected sheet
       * would not actually exercise "loads before/after".
       */
      const resolvedAccent = (hostRule: string, hostLoadsFirst: boolean): string => {
        const sheets = hostLoadsFirst ? [hostRule, base, preset] : [base, preset, hostRule]
        const elements = sheets.map((text) => {
          const el = document.createElement("style")
          el.textContent = text
          document.head.appendChild(el)
          return el
        })
        const root = document.createElement("div")
        root.className = "dt-root"
        document.body.appendChild(root)
        const value = getComputedStyle(root).getPropertyValue("--dt-accent").trim()
        root.remove()
        elements.forEach((el) => el.remove())
        return value
      }

      it("a doubled-class host rule only ties the preset, and can lose to it", () => {
        const hostRule = ".dt-root.dt-root { --dt-accent: red; }"
        // Host loads first, preset last: the preset — later in the tie — wins.
        expect(resolvedAccent(hostRule, true)).not.toBe("red")
        // Host loads last: now the host is later in the tie, and wins.
        expect(resolvedAccent(hostRule, false)).toBe("red")
      })

      it("a tripled-class host rule beats the preset regardless of load order", () => {
        const hostRule = ".dt-root.dt-root.dt-root { --dt-accent: red; }"
        expect(resolvedAccent(hostRule, true)).toBe("red")
        expect(resolvedAccent(hostRule, false)).toBe("red")
      })
    })
  }
})

describe("pin badge contrast", () => {
  it("uses a token for its foreground colour, not a hardcoded white", () => {
    const styles = read("../styles.css")
    // `[^{]*` and not `\s*`: the Filters tab's `.dt-filter-badge` shares this
    // rule rather than declaring a second look of its own, so the selector is
    // a group and an anchored `\s*\{` would match nothing and pass vacuously.
    const badge = styles.match(/\.dt-pin-badge[^{]*\{([^}]*)\}/)?.[1] ?? ""
    expect(badge).toContain("color: var(--dt-accent-fg)")
    expect(badge).not.toMatch(/color:\s*#fff/)
  })
})

describe("base palette", () => {
  it("prints the pin badge at WCAG AA", () => {
    // `.dt-pin-badge` renders --dt-accent-fg on --dt-accent at 10px. That is
    // normal-size text under WCAG, so it needs 4.5:1 — the 3:1 large-text
    // allowance cannot apply at that size.
    const ratio = contrastRatio(baseTokenValue("--dt-accent"), baseTokenValue("--dt-accent-fg"))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it("prints .dt-link and the active sort direction at WCAG AA in light", () => {
    // --dt-accent-text is --dt-accent printed AS TEXT on --dt-bg (.dt-link's
    // "Show all"/"Reset" buttons, the active sort direction in the header
    // menu) — normal-size text (12px/13px), so 4.5:1. --dt-accent itself is
    // only 3.68:1 here, which is why this is a separate, darker token.
    const ratio = contrastRatio(baseTokenValue("--dt-accent-text"), baseTokenValue("--dt-bg"))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it("prints .dt-link and the active sort direction at WCAG AA in dark", () => {
    const ratio = contrastRatio(darkTokenValue("--dt-accent-text"), darkTokenValue("--dt-bg"))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it("prints the multi-sort priority digit at WCAG AA in both themes", () => {
    // .dt-sort-index (the multi-sort priority number) is normal-size text
    // (10px) at full --dt-header-fg on --dt-header-bg — no opacity dimming,
    // which is what previously pulled it under 4.5:1 in both themes.
    expect(contrastRatio(baseTokenValue("--dt-header-fg"), baseTokenValue("--dt-header-bg"))).toBeGreaterThanOrEqual(
      4.5,
    )
    expect(contrastRatio(darkTokenValue("--dt-header-fg"), darkTokenValue("--dt-header-bg"))).toBeGreaterThanOrEqual(
      4.5,
    )
  })

  it("prints the inactive sort chevron at the WCAG 1.4.11 non-text minimum in both themes", () => {
    // .dt-sort-icon at rest is a graphical UI component (an aria-hidden SVG
    // signalling "sortable"), not text — WCAG 1.4.11 sets its floor at 3:1,
    // not 4.5:1. Full --dt-muted-fg on --dt-header-bg replaced an opacity
    // fraction of --dt-header-fg that fell under 3:1 in both themes.
    expect(contrastRatio(baseTokenValue("--dt-muted-fg"), baseTokenValue("--dt-header-bg"))).toBeGreaterThanOrEqual(
      3,
    )
    expect(contrastRatio(darkTokenValue("--dt-muted-fg"), darkTokenValue("--dt-header-bg"))).toBeGreaterThanOrEqual(
      3,
    )
  })

  it("prints the active sort chevron at the WCAG 1.4.11 non-text minimum in both themes", () => {
    // The active chevron is --dt-fg on --dt-header-bg, not --dt-header-fg —
    // see "keeps the active sort chevron visibly distinct..." below for why
    // it needs its own token rather than reusing the digit's. Still only a
    // graphical affordance (aria-hidden), so 3:1 is the floor, not 4.5:1.
    expect(contrastRatio(baseTokenValue("--dt-fg"), baseTokenValue("--dt-header-bg"))).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(darkTokenValue("--dt-fg"), darkTokenValue("--dt-header-bg"))).toBeGreaterThanOrEqual(3)
  })

  it("keeps the active sort chevron visibly distinct from the inactive one in both themes", () => {
    // Regression guard: the active chevron used to be --dt-header-fg, which
    // happens to equal --dt-muted-fg (the inactive colour) in the dark
    // palette — #a1a1aa on #a1a1aa, a no-op "transition" between two
    // identical greys, even though both individually clear 3:1 against
    // --dt-header-bg on their own. Asserting a real contrast ratio *between*
    // the two tokens — not just that each clears 3:1 against the background —
    // is what a per-token check above cannot catch and this one can.
    expect(contrastRatio(baseTokenValue("--dt-muted-fg"), baseTokenValue("--dt-fg"))).toBeGreaterThan(1.5)
    expect(contrastRatio(darkTokenValue("--dt-muted-fg"), darkTokenValue("--dt-fg"))).toBeGreaterThan(1.5)
  })

  it("prints the footer at WCAG AA in both themes", () => {
    // --dt-footer-fg on --dt-footer-bg is the row count, the "Rows per page"
    // label and the page-of-page text at 13px — normal-size text, so 4.5:1.
    // It is a new pair rather than a restatement of --dt-muted-fg on --dt-bg:
    // the two tokens can now move independently, and a host tinting the band
    // is exactly who needs this floor to have been checked at the defaults
    // they started from.
    for (const theme of ["light", "dark"] as const) {
      const ratio = contrastRatio(resolvedTokenValue("--dt-footer-fg", theme), resolvedTokenValue("--dt-footer-bg", theme))
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("keeps a pinned column on the body surface until a host tints it", () => {
    // --dt-pinned-bg introduces no colour of its own: the default has to be
    // the very fill `.dt-td` already painted, in both themes, or every
    // existing table's frozen columns shift the day they upgrade. Checked as
    // a resolved value, so aliasing it through --dt-bg still has to agree.
    for (const theme of ["light", "dark"] as const) {
      expect(resolvedTokenValue("--dt-pinned-bg", theme)).toBe(resolvedTokenValue("--dt-bg", theme))
    }
  })

  it("prints the column-panel drag handle at the WCAG 1.4.11 non-text minimum in both themes", () => {
    // .dt-drag-handle is the sole visual affordance for column reordering,
    // and now the only control that carries it for the keyboard too, so its
    // 3:1 floor is load-bearing. Full --dt-muted-fg on --dt-bg replaced an
    // opacity fraction that fell under 3:1 in both themes.
    expect(contrastRatio(baseTokenValue("--dt-muted-fg"), baseTokenValue("--dt-bg"))).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(darkTokenValue("--dt-muted-fg"), darkTokenValue("--dt-bg"))).toBeGreaterThanOrEqual(3)
  })
})
