import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

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
      // A selector may legitimately *exclude* a pinned theme (the dark-media
      // branch does, via `:not([data-dt-theme="light"])`) without mapping
      // it. What must not reappear is a selector that positively matches
      // `[data-dt-theme="dark"]` or `[data-dt-theme="light"]` — that would
      // map the pinned branches to the same shadcn variables as the
      // unpinned case, making the public `theme` prop a no-op.
      const selectors = extractSelectorGroups(preset)
        .flatMap((group) => group.split(","))
        .map((selector) => selector.trim())
      const pinsATheme = selectors.some((selector) =>
        /\[data-dt-theme="(dark|light)"\]/.test(selector.replace(/:not\([^)]*\)/g, "")),
      )
      expect(pinsATheme).toBe(false)
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
