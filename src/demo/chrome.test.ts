import { describe, expect, it } from "vitest"
import { CHROME } from "./chrome"
import type { Language } from "./playgroundState"

/**
 * The page's own copy, as text rather than as types.
 *
 * `ChromeStrings` already makes a missing key a compile error, which is the
 * point of the one-object-per-language shape. What it cannot see is a key that
 * is present and empty, or Uzbek written with the ASCII apostrophe — the same
 * defect `labels.test.ts` pins for `uzLabels`, which never covered the
 * playground's own chrome because that lives outside `src/labels/`.
 */

const LANGUAGES: Language[] = ["en", "ru", "uz"]

/** Every string anywhere in one language's copy, with the path that reached it. */
function walk(value: unknown, path: string): [string, string][] {
  if (typeof value === "string") return [[path, value]]
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => walk(child, `${path}.${key}`))
  }
  return []
}

describe("playground chrome", () => {
  it("says something in every language, for every key", () => {
    for (const language of LANGUAGES) {
      const strings = walk(CHROME[language], language)
      // A guard on the guard: a shape that stopped recursing would make the
      // loop below pass by never running.
      expect(strings.length).toBeGreaterThan(50)
      for (const [path, text] of strings) {
        expect(text.trim(), `${path} is blank`).not.toBe("")
      }
    }
  })

  it("writes the Uzbek copy with the modifier letters, never the ASCII apostrophe", () => {
    // Uzbek Latin writes oʻ/gʻ with U+02BB and the glottal stop with U+02BC.
    // The ASCII apostrophe draws the same in most editors, so it survives
    // review and then sits on screen one line under a correct form.
    for (const [path, text] of walk(CHROME.uz, "uz")) {
      expect(text, `${path} uses U+0027 — write ʻ (U+02BB) or ʼ (U+02BC)`).not.toMatch(/'/)
    }
  })
})
