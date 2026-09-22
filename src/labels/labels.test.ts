import { describe, expect, it } from "vitest"
import { defaultLabels } from "../components/DataTable"
import { ruLabels } from "./ru"
import { uzLabels } from "./uz"

/**
 * Parity between the three shipped label sets.
 *
 * A label added later to `DataTableLabels` and to `defaultLabels` is a
 * compile error in `ru.ts`/`uz.ts` already, because both are typed as the
 * whole interface rather than a `Partial`. This file is the runtime backstop
 * for the same guarantee: it fails loudly, and names the key, instead of a
 * translation quietly staying English because a literal object was edited by
 * hand and one line was missed.
 */

const LOCALES = [
  { name: "ru", labels: ruLabels },
  { name: "uz", labels: uzLabels },
] as const

describe("label set parity", () => {
  for (const { name, labels } of LOCALES) {
    it(`${name}Labels has every key defaultLabels has, and no extra ones`, () => {
      const defaultKeys = Object.keys(defaultLabels).sort()
      const localeKeys = Object.keys(labels).sort()
      const missing = defaultKeys.filter((key) => !localeKeys.includes(key))
      const extra = localeKeys.filter((key) => !defaultKeys.includes(key))
      expect(missing, `${name}Labels is missing: ${missing.join(", ")}`).toEqual([])
      expect(extra, `${name}Labels has keys defaultLabels lacks: ${extra.join(", ")}`).toEqual([])
    })

    it(`${name}Labels keeps every key's shape the same as defaultLabels`, () => {
      for (const key of Object.keys(defaultLabels) as (keyof typeof defaultLabels)[]) {
        const englishValue = defaultLabels[key]
        const localeValue = labels[key]
        if (typeof englishValue === "function") {
          expect(typeof localeValue, `${name}Labels.${key} must be a function`).toBe("function")
        } else {
          expect(typeof localeValue, `${name}Labels.${key} must be a string`).toBe("string")
        }
      }
    })
  }
})

describe("function-shaped labels return sensible text", () => {
  for (const { name, labels } of LOCALES) {
    it(`${name}Labels.range interpolates known and unknown totals`, () => {
      expect(labels.range(1, 50, 1000)).toContain("1")
      expect(labels.range(1, 50, 1000)).toContain("50")
      expect(labels.range(1, 50, 1000)).toContain("1000")
      // An unknown total must not silently print "undefined".
      expect(labels.range(1, 50, undefined)).not.toContain("undefined")
    })

    it(`${name}Labels.page interpolates a known and an unknown page count`, () => {
      expect(labels.page(3, 20)).toContain("3")
      expect(labels.page(3, 20)).toContain("20")
      expect(labels.page(3, undefined)).toContain("3")
      expect(labels.page(3, undefined)).not.toContain("undefined")
    })

    it(`${name}Labels.searchResults handles zero, one, many and unknown`, () => {
      expect(labels.searchResults(0)).toContain("0")
      expect(labels.searchResults(1)).toContain("1")
      expect(labels.searchResults(5)).toContain("5")
      // "Searching…" while the count is not known yet must not read as zero.
      expect(labels.searchResults(undefined)).not.toContain("undefined")
      expect(labels.searchResults(undefined)).not.toMatch(/^0\D/)
    })

    it(`${name}Labels.filterTitle names the column`, () => {
      expect(labels.filterTitle("Сумма")).toContain("Сумма")
    })

    it(`${name}Labels.rowGroupLevel names the column, its level and the depth`, () => {
      // The grouping's own `reorderPosition`: a keyboard move that says the
      // level without saying out of how many leaves the listener with no idea
      // how deep the nesting they are moving in goes.
      const announced = labels.rowGroupLevel("Статус", 1, 3)
      expect(announced).toContain("Статус")
      expect(announced).toContain("1")
      expect(announced).toContain("3")
    })

    it(`${name}Labels' edit notices all name the column`, () => {
      // Each one is read after the cell it is about has already reverted or
      // gone: without the column's name the reader is being told that
      // something failed, somewhere.
      for (const said of [
        labels.editFailed("Сумма"),
        labels.editCancelled("Сумма"),
        labels.editRowFiltered("Сумма"),
      ]) {
        expect(said).toContain("Сумма")
      }
    })

    it(`${name}Labels.reorderPosition names the column and both numbers`, () => {
      // What a screen reader hears on every step of a keyboard reorder: the
      // column, where it is now, and out of how many. A translation that drops
      // the total leaves the listener with no idea how far there is to go.
      const announced = labels.reorderPosition("Сумма", 3, 7)
      expect(announced).toContain("Сумма")
      expect(announced).toContain("3")
      expect(announced).toContain("7")
    })
  }
})

describe("Russian plural agreement in searchResults", () => {
  // One form: the numeral ends in 1, except the teens (11 is "many", not "one").
  const ONE = [1, 21]
  // Few form: the numeral ends in 2, 3 or 4, except the teens.
  const FEW = [2, 3, 4, 22]
  // Many form: everything else, including 0 and the whole teens run — the
  // case a naive "ends in 1 → one, else → many" implementation gets wrong.
  const MANY = [0, 5, 11, 12, 14, 25]

  it("uses the one-form for 1 and 21", () => {
    for (const count of ONE) {
      expect(ruLabels.searchResults(count)).toContain("строка")
      expect(ruLabels.searchResults(count)).not.toContain("строки")
      expect(ruLabels.searchResults(count)).not.toContain("строк ")
    }
  })

  it("uses the few-form for 2, 3, 4 and 22", () => {
    for (const count of FEW) {
      expect(ruLabels.searchResults(count)).toContain("строки")
    }
  })

  it("uses the many-form for 0, 5, and the teens 11, 12, 14, and 25", () => {
    for (const count of MANY) {
      expect(ruLabels.searchResults(count)).toContain("строк")
      expect(ruLabels.searchResults(count)).not.toContain("строка")
      expect(ruLabels.searchResults(count)).not.toContain("строки")
    }
  })

  it("gets the teens right specifically (11 and 12 do not become the one-form)", () => {
    expect(ruLabels.searchResults(11)).toBe("Найдено: 11 строк")
    expect(ruLabels.searchResults(12)).toBe("Найдено: 12 строк")
  })
})

describe("Uzbek has no plural agreement after a numeral", () => {
  it("keeps the bare noun for every count", () => {
    expect(uzLabels.searchResults(1)).toBe("1 ta qator topildi")
    expect(uzLabels.searchResults(5)).toBe("5 ta qator topildi")
    expect(uzLabels.searchResults(11)).toBe("11 ta qator topildi")
  })
})

describe("Uzbek orthography", () => {
  // Uzbek Latin writes oʻ/gʻ with U+02BB and the glottal stop with U+02BC. The
  // ASCII apostrophe is a different character that most editors draw the same
  // way, so it survives review and then sits on screen beside the app's correct
  // forms — "O'sish bo'yicha" one line under "Ustun kengligini oʻzgartirish".
  const ASCII_APOSTROPHE = /'/

  // Every function-shaped label, called: their text never reaches Object.values.
  const FUNCTION_OUTPUTS = [
    uzLabels.range(1, 50, 1000),
    uzLabels.range(1, 50, undefined),
    uzLabels.page(1, 20),
    uzLabels.page(1, undefined),
    uzLabels.searchResults(0),
    uzLabels.searchResults(undefined),
    uzLabels.filterTitle("Summa"),
    uzLabels.reorderPosition("Summa", 1, 5),
    uzLabels.columnGroup("Hujjat"),
    uzLabels.tableHeight(420),
    uzLabels.groupCount(253),
    uzLabels.groupRow("Qabul qilingan", 253),
    uzLabels.groupContinued(["Qabul qilingan"]),
    uzLabels.groupByColumn("Holat"),
    uzLabels.ungroupColumn("Holat"),
    uzLabels.rowGroupLevel("Holat", 1, 2),
    uzLabels.editFailed("Summa"),
    uzLabels.editCancelled("Summa"),
    uzLabels.editRowFiltered("Summa"),
  ]

  it("writes every label with the modifier letters, never the ASCII apostrophe", () => {
    for (const [key, value] of Object.entries(uzLabels)) {
      if (typeof value !== "string") continue
      expect(value, `uzLabels.${key} uses U+0027 — write ʻ (U+02BB) or ʼ (U+02BC)`).not.toMatch(
        ASCII_APOSTROPHE,
      )
    }
    for (const text of FUNCTION_OUTPUTS) {
      expect(text, `a function-shaped label returned "${text}" with U+0027 in it`).not.toMatch(
        ASCII_APOSTROPHE,
      )
    }
  })

  it("calls every function-shaped label, so none escapes the check above", () => {
    const functionKeys = Object.entries(uzLabels)
      .filter(([, value]) => typeof value === "function")
      .map(([key]) => key)
      .sort()
    // A function label added later would otherwise go unread: add it to
    // FUNCTION_OUTPUTS and to this list together.
    expect(functionKeys).toEqual([
      "columnGroup",
      "editCancelled",
      "editFailed",
      "editRowFiltered",
      "filterTitle",
      "groupByColumn",
      "groupContinued",
      "groupCount",
      "groupRow",
      "page",
      "range",
      "reorderPosition",
      "rowGroupLevel",
      "searchResults",
      "tableHeight",
      "ungroupColumn",
    ])
  })
})
