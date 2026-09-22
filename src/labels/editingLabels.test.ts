import { describe, expect, it } from "vitest"
import { defaultCellEditingLabels } from "./editing"
import { ruCellEditingLabels } from "./ru"
import { uzCellEditingLabels } from "./uz"

/**
 * Parity and orthography for the cell-editing label sets.
 *
 * `labels.test.ts` does this job for `DataTableLabels`; this file does it for
 * the editing set, which is separate until the wiring task folds the two
 * together. The checks are deliberately the same ones, because the failure
 * they catch is the same: a key added in English and left English everywhere
 * else, and an ASCII apostrophe in Uzbek that looks identical to the modifier
 * letter in every editor anyone reviews it in.
 */

const LOCALES = [
  { name: "ru", labels: ruCellEditingLabels },
  { name: "uz", labels: uzCellEditingLabels },
] as const

describe("cell-editing label parity", () => {
  for (const { name, labels } of LOCALES) {
    it(`${name} has every key the English set has, and no extra ones`, () => {
      const englishKeys = Object.keys(defaultCellEditingLabels).sort()
      const localeKeys = Object.keys(labels).sort()
      expect(localeKeys).toEqual(englishKeys)
    })

    it(`${name} translates every key into a non-empty string`, () => {
      for (const [key, value] of Object.entries(labels)) {
        expect(value, `${name}.${key} is empty`).toBeTypeOf("string")
        expect(value.trim().length, `${name}.${key} is empty`).toBeGreaterThan(0)
      }
    })

    it(`${name} does not leave a key in English`, () => {
      // Every string is either translated or a keyboard key's own name, which
      // is not translated in any of the three locales ("Enter", "Escape").
      for (const [key, value] of Object.entries(labels)) {
        if (key === "editHint") continue
        expect(
          value,
          `${name}.${key} still reads as the English default`,
        ).not.toBe(defaultCellEditingLabels[key as keyof typeof defaultCellEditingLabels])
      }
    })
  }
})

describe("Uzbek orthography in the editing labels", () => {
  // Uzbek Latin writes oʻ/gʻ with U+02BB and the glottal stop with U+02BC. The
  // ASCII apostrophe is a different character that most editors draw the same
  // way, so it survives review and then sits on screen beside the app's
  // correct forms.
  const ASCII_APOSTROPHE = /'/

  it("writes every label with the modifier letters, never the ASCII apostrophe", () => {
    for (const [key, value] of Object.entries(uzCellEditingLabels)) {
      expect(
        value,
        `uzCellEditingLabels.${key} uses U+0027 — write ʻ (U+02BB) or ʼ (U+02BC)`,
      ).not.toMatch(ASCII_APOSTROPHE)
    }
  })

  it("holds no function-shaped label that could escape the check above", () => {
    // Every value is a plain string today. A counted or interpolated label
    // added later must be called before it is checked, the way `labels.test.ts`
    // calls its own — this assertion is what will fail and say so.
    for (const value of Object.values(uzCellEditingLabels)) {
      expect(typeof value).toBe("string")
    }
  })
})
