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

/** Every token the base sheet defines on .dt-root. */
const baseTokens = [...read("../styles.css").matchAll(/^\s*(--dt-[a-z-]+):/gm)].map((m) => m[1] as string)

describe("shadcn presets", () => {
  for (const file of ["shadcn.css", "shadcn-hsl.css"]) {
    it(`${file} maps every base token`, () => {
      const preset = read(file)
      const missing = [...new Set(baseTokens)].filter((token) => !preset.includes(`${token}:`))
      expect(missing).toEqual([])
    })
  }
})
