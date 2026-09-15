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
    expect(new Set(baseTokens).size).toBe(23)
  })

  it("matches digit-suffixed token names", () => {
    const sample = "  --dt-elevation-1: 0 1px 2px black;\n  --dt-accent: #3b82f6;"
    const matches = [...sample.matchAll(/^\s*(--dt-[a-z0-9-]+)\s*:/gm)].map((m) => m[1])
    expect(matches).toEqual(["--dt-elevation-1", "--dt-accent"])
  })
})

describe("shadcn presets", () => {
  for (const file of ["shadcn.css", "shadcn-hsl.css"]) {
    it(`${file} maps every base token`, () => {
      const preset = read(file)
      const missing = [...new Set(baseTokens)].filter((token) => !preset.includes(`${token}:`))
      expect(missing).toEqual([])
    })

    it(`${file} pairs --dt-accent with a readable foreground token`, () => {
      const preset = read(file)
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

describe("pin badge contrast", () => {
  it("uses a token for its foreground colour, not a hardcoded white", () => {
    const styles = read("../styles.css")
    const badge = styles.match(/\.dt-pin-badge\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(badge).toContain("color: var(--dt-accent-fg)")
    expect(badge).not.toMatch(/color:\s*#fff/)
  })
})
