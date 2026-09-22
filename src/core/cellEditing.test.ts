import { describe, expect, it } from "vitest"
import {
  cellEditability,
  draftFromValue,
  isUnchanged,
  notEditableLabelKey,
  parseDraft,
} from "./cellEditing"
import { defaultCellEditingLabels } from "../labels/editing"

/**
 * The value logic under the editors, tested without a DOM.
 *
 * Every refusal the editor can show is decided here, which is why these cases
 * are the awkward ones: a day that does not exist, a number that is not
 * finite, a list value nobody offered.
 */

describe("cellEditability", () => {
  it("edits a column that declared a kind", () => {
    expect(cellEditability({ declared: "number", hasHandler: true })).toEqual({
      editable: true,
      kind: "number",
    })
  })

  it("refuses a column that declared nothing — silence is not consent", () => {
    expect(cellEditability({ declared: undefined, hasHandler: true })).toEqual({
      editable: false,
      reason: "column",
    })
  })

  it("refuses a column that declared false", () => {
    expect(cellEditability({ declared: false, hasHandler: true })).toEqual({
      editable: false,
      reason: "column",
    })
  })

  it("answers a group row before anything else, because it is true of every column", () => {
    expect(cellEditability({ declared: "text", hasHandler: true, isGroupRow: true })).toEqual({
      editable: false,
      reason: "group",
    })
  })

  it("reports a missing onCellEdit only for a cell that would otherwise be editable", () => {
    expect(cellEditability({ declared: "text", hasHandler: false })).toEqual({
      editable: false,
      reason: "unavailable",
    })
    // The column's own refusal is the more useful thing to say.
    expect(cellEditability({ declared: false, hasHandler: false })).toEqual({
      editable: false,
      reason: "column",
    })
  })

  it("lets the row veto an editable column", () => {
    expect(cellEditability({ declared: "text", hasHandler: true, rowAllows: false })).toEqual({
      editable: false,
      reason: "row",
    })
    expect(cellEditability({ declared: "text", hasHandler: true, rowAllows: true })).toEqual({
      editable: true,
      kind: "text",
    })
  })

  it("names a label for every reason, and each one is a real string", () => {
    for (const reason of ["column", "row", "group", "unavailable"] as const) {
      const key = notEditableLabelKey(reason)
      expect(defaultCellEditingLabels[key], `no label for "${reason}"`).toBeTypeOf("string")
      expect(defaultCellEditingLabels[key].length).toBeGreaterThan(0)
    }
  })
})

describe("draftFromValue", () => {
  it("opens a blank cell with an empty field, whatever the kind", () => {
    for (const kind of ["text", "number", "date", "boolean", "list"] as const) {
      expect(draftFromValue(null, kind)).toBe("")
      expect(draftFromValue(undefined, kind)).toBe("")
    }
  })

  it("reads a Date as the day it falls on in the viewer's own calendar", () => {
    // 23:30 local on the 31st is still the 31st. `toISOString().slice(0, 10)`
    // would name the 1st for anyone east of UTC.
    expect(draftFromValue(new Date(2026, 0, 31, 23, 30), "date")).toBe("2026-01-31")
  })

  it("strips the time off an ISO timestamp a server sent", () => {
    expect(draftFromValue("2026-01-31T09:15:00Z", "date")).toBe("2026-01-31")
  })

  it("empties a date field rather than show a day it cannot parse", () => {
    expect(draftFromValue("last Tuesday", "date")).toBe("")
    expect(draftFromValue(new Date("nonsense"), "date")).toBe("")
  })

  it("writes a boolean as the option value the editor renders", () => {
    expect(draftFromValue(true, "boolean")).toBe("true")
    expect(draftFromValue(false, "boolean")).toBe("false")
  })

  it("prints numbers and text as they are", () => {
    expect(draftFromValue(0, "number")).toBe("0")
    expect(draftFromValue(12.5, "number")).toBe("12.5")
    expect(draftFromValue("Ada", "text")).toBe("Ada")
  })
})

describe("parseDraft", () => {
  it("reads an empty draft as null for every kind — emptying a cell is an edit", () => {
    for (const kind of ["text", "number", "date", "boolean", "list"] as const) {
      expect(parseDraft("", kind)).toEqual({ ok: true, value: null })
      expect(parseDraft("   ", kind)).toEqual({ ok: true, value: null })
    }
  })

  it("keeps text exactly as typed, spaces included", () => {
    expect(parseDraft(" Ada Lovelace ", "text")).toEqual({ ok: true, value: " Ada Lovelace " })
  })

  it("parses a number, and refuses what is not one", () => {
    expect(parseDraft("12.5", "number")).toEqual({ ok: true, value: 12.5 })
    expect(parseDraft("-3", "number")).toEqual({ ok: true, value: -3 })
    expect(parseDraft("12px", "number")).toEqual({ ok: false, reason: "invalidNumber" })
    // A decimal comma is the everyday way to write this in ru/uz, and it is
    // exactly the case where a silent `NaN` would be worst.
    expect(parseDraft("12,5", "number")).toEqual({ ok: false, reason: "invalidNumber" })
    expect(parseDraft("1e400", "number")).toEqual({ ok: false, reason: "invalidNumber" })
  })

  it("parses a calendar day, and refuses one that does not exist", () => {
    expect(parseDraft("2026-01-31", "date")).toEqual({ ok: true, value: "2026-01-31" })
    expect(parseDraft("2026-02-30", "date")).toEqual({ ok: false, reason: "invalidDate" })
    expect(parseDraft("31-01-2026", "date")).toEqual({ ok: false, reason: "invalidDate" })
  })

  it("parses the two boolean options and nothing else", () => {
    expect(parseDraft("true", "boolean")).toEqual({ ok: true, value: true })
    expect(parseDraft("false", "boolean")).toEqual({ ok: true, value: false })
    expect(parseDraft("yes", "boolean")).toEqual({ ok: false, reason: "invalidChoice" })
  })

  it("accepts only a value the list actually offered, and gives back its own type", () => {
    const choices = [{ value: 3, label: "Three" }, { value: "open" }]
    expect(parseDraft("3", "list", choices)).toEqual({ ok: true, value: 3 })
    expect(parseDraft("open", "list", choices)).toEqual({ ok: true, value: "open" })
    expect(parseDraft("closed", "list", choices)).toEqual({ ok: false, reason: "invalidChoice" })
    expect(parseDraft("3", "list")).toEqual({ ok: false, reason: "invalidChoice" })
  })
})

describe("isUnchanged", () => {
  it("recognises the typed value as the one already there", () => {
    expect(isUnchanged(5, 5, "number")).toBe(true)
    expect(isUnchanged("Ada", "Ada", "text")).toBe(true)
    expect(isUnchanged(true, true, "boolean")).toBe(true)
    // A Date in the cell, an IsoDay out of the editor: the same day.
    expect(isUnchanged(new Date(2026, 0, 31), "2026-01-31", "date")).toBe(true)
    // A blank cell emptied again is not an edit, however it was blank.
    expect(isUnchanged(undefined, null, "text")).toBe(true)
  })

  it("sees a real change", () => {
    expect(isUnchanged(5, 6, "number")).toBe(false)
    expect(isUnchanged("Ada", null, "text")).toBe(false)
    expect(isUnchanged(true, false, "boolean")).toBe(false)
    expect(isUnchanged(new Date(2026, 0, 31), "2026-02-01", "date")).toBe(false)
  })
})
