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
      // Pre-formatted strings, the same shape `formatCount` hands it — this
      // label only places the three, it does not reformat them.
      expect(labels.range("1", "50", "1 000")).toContain("1")
      expect(labels.range("1", "50", "1 000")).toContain("50")
      expect(labels.range("1", "50", "1 000")).toContain("1 000")
      // An unknown total must not silently print "undefined".
      expect(labels.range("1", "50", "…")).not.toContain("undefined")
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

    it(`${name}Labels.statusBarRows shows the count and survives an unknown one`, () => {
      expect(labels.statusBarRows("1 000", 1000)).toContain("1 000")
      // The loading state — no server answer yet — must not print "undefined".
      expect(labels.statusBarRows("…", undefined)).not.toContain("undefined")
    })

    it(`${name}Labels.statusBarFiltered states the count alone, then "X of Y" once a total is known`, () => {
      expect(labels.statusBarFiltered("253", 253, undefined)).toContain("253")
      expect(labels.statusBarFiltered("253", 253, undefined)).not.toContain("undefined")
      const withTotal = labels.statusBarFiltered("253", 253, "1 000")
      expect(withTotal).toContain("253")
      expect(withTotal).toContain("1 000")
    })

    it(`${name}Labels.selectRow names the row it selects`, () => {
      // Every checkbox in the column is otherwise identical, so the number is
      // the only thing telling one row's box from another's.
      expect(labels.selectRow(3)).toContain("3")
    })

    it(`${name}Labels.selectAllRows states the count, and leaves it out when unknown`, () => {
      // The header checkbox takes everything the query matches, so its name
      // has to say how many that is.
      expect(labels.selectAllRows("100 000", 100_000)).toContain("100 000")
      // And while a server has not answered there is no number to say. Naming
      // the control after a wrong one is the failure this branch exists for,
      // so neither "undefined" nor a stray digit may appear.
      const unknown = labels.selectAllRows(undefined, undefined)
      expect(unknown).not.toContain("undefined")
      expect(unknown).not.toMatch(/\d/)
      expect(unknown.trim()).not.toBe("")
    })

    it(`${name}Labels.statusBarGroupedBy names every grouped column, in order`, () => {
      const said = labels.statusBarGroupedBy(["Holat", "Hamkor"])
      expect(said).toContain("Holat")
      expect(said).toContain("Hamkor")
      expect(said.indexOf("Holat")).toBeLessThan(said.indexOf("Hamkor"))
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

describe("Russian plural agreement in the status bar", () => {
  // Every count the bar speaks goes through `plural`, statusBarRows and
  // statusBarFiltered included — not only searchResults, which was the one
  // label already exercising it before this feature.
  it("agrees statusBarRows with its raw count", () => {
    expect(ruLabels.statusBarRows("21", 21)).toBe("Всего 21 строка")
    expect(ruLabels.statusBarRows("3", 3)).toBe("Всего 3 строки")
    expect(ruLabels.statusBarRows("11", 11)).toBe("Всего 11 строк")
  })

  it("agrees statusBarFiltered with its raw count, with and without a total", () => {
    expect(ruLabels.statusBarFiltered("21", 21, undefined)).toBe("Отфильтровано: 21 строка")
    expect(ruLabels.statusBarFiltered("3", 3, "1 000")).toBe("Отфильтровано: 3 строки из 1 000")
    expect(ruLabels.statusBarFiltered("11", 11, "1 000")).toBe("Отфильтровано: 11 строк из 1 000")
  })

  it("agrees the header checkbox's name with the rows it would select", () => {
    // Accusative, which is the case "выбрать" governs: строку / строки / строк.
    expect(ruLabels.selectAllRows("1", 1)).toBe("Выбрать все 1 строку")
    expect(ruLabels.selectAllRows("3", 3)).toBe("Выбрать все 3 строки")
    expect(ruLabels.selectAllRows("11", 11)).toBe("Выбрать все 11 строк")
    expect(ruLabels.selectAllRows("100 000", 100_000)).toBe("Выбрать все 100 000 строк")
  })

  it("falls back to the many-form while the raw count is still unknown", () => {
    // The visible count reads "…"; the word it sits beside still has to pick
    // some form, and "many" (0's own form) is the closest honest default.
    expect(ruLabels.statusBarRows("…", undefined)).toBe("Всего … строк")
  })
})

describe("Uzbek has no plural agreement after a numeral", () => {
  it("keeps the bare noun for every count", () => {
    expect(uzLabels.searchResults(1)).toBe("1 ta qator topildi")
    expect(uzLabels.searchResults(5)).toBe("5 ta qator topildi")
    expect(uzLabels.searchResults(11)).toBe("11 ta qator topildi")
  })

  it("keeps the bare noun in the status bar too", () => {
    expect(uzLabels.statusBarRows("1", 1)).toBe("Jami 1 ta qator")
    expect(uzLabels.statusBarRows("11", 11)).toBe("Jami 11 ta qator")
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
    uzLabels.range("1", "50", "1 000"),
    uzLabels.range("1", "50", "…"),
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
    uzLabels.statusBarRows("1 000", 1000),
    uzLabels.statusBarRows("…", undefined),
    uzLabels.statusBarFiltered("253", 253, undefined),
    uzLabels.statusBarFiltered("253", 253, "1 000"),
    uzLabels.statusBarGroupedBy(["Holat", "Hamkor"]),
    uzLabels.selectRow(3),
    uzLabels.selectAllRows("1 000", 1000),
    uzLabels.selectAllRows(undefined, undefined),
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
      "selectAllRows",
      "selectRow",
      "statusBarFiltered",
      "statusBarGroupedBy",
      "statusBarRows",
      "tableHeight",
      "ungroupColumn",
    ])
  })
})
