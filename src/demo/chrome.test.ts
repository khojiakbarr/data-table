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

/**
 * Every function-shaped string in one language's copy, called.
 *
 * `walk` below only sees strings, so a function's text would escape both
 * checks entirely — the same hole `labels.test.ts` closes with its own
 * FUNCTION_OUTPUTS list. These are the three the bulk-action bar speaks, and
 * each is called in both of its branches: with a count, and with the undefined
 * one a server that has not answered leaves behind.
 */
const spokenCounts = (language: Language): [string, string][] => {
  const { bulk } = CHROME[language]
  return [
    [`${language}.bulk.selected(known)`, bulk.selected("100 000", 100_000)],
    [`${language}.bulk.selected(unknown)`, bulk.selected(undefined, undefined)],
    [`${language}.bulk.done`, bulk.done("24 997", 24_997)],
  ]
}

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
      for (const [path, text] of [...strings, ...spokenCounts(language)]) {
        expect(text.trim(), `${path} is blank`).not.toBe("")
        expect(text, `${path} interpolated an undefined`).not.toContain("undefined")
      }
    }
  })

  it("leaves the number out of the bulk bar until the server has answered", () => {
    // The playground's copy of the library's own rule: naming a count nobody
    // can stand behind is worse than naming none.
    for (const language of LANGUAGES) {
      const said = CHROME[language].bulk.selected(undefined, undefined)
      expect(said, `${language} printed a digit for an unknown count`).not.toMatch(/\d/)
    }
  })

  it("agrees the Russian bulk copy with the count it speaks", () => {
    const { bulk } = CHROME.ru
    expect(bulk.selected("1", 1)).toBe("Выбрано 1 строка")
    expect(bulk.selected("3", 3)).toBe("Выбрано 3 строки")
    expect(bulk.selected("11", 11)).toBe("Выбрано 11 строк")
    expect(bulk.done("1", 1)).toBe("Обновлено 1 квитанция")
    expect(bulk.done("24 997", 24_997)).toBe("Обновлено 24 997 квитанций")
  })

  it("writes the Uzbek copy with the modifier letters, never the ASCII apostrophe", () => {
    // Uzbek Latin writes oʻ/gʻ with U+02BB and the glottal stop with U+02BC.
    // The ASCII apostrophe draws the same in most editors, so it survives
    // review and then sits on screen one line under a correct form.
    for (const [path, text] of [...walk(CHROME.uz, "uz"), ...spokenCounts("uz")]) {
      expect(text, `${path} uses U+0027 — write ʻ (U+02BB) or ʼ (U+02BC)`).not.toMatch(/'/)
    }
  })
})
