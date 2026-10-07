import { describe, expect, it } from "vitest"
import { cardPlaces, isBlankCardValue } from "./cardLayout"

describe("cardPlaces", () => {
  it("puts each column where its meta asks, in column order", () => {
    const places = cardPlaces([
      { id: "code", card: "code" },
      { id: "partner", card: "title" },
      { id: "total", card: "amount" },
      { id: "base", card: "amountNote" },
      { id: "date", card: "chips" },
      { id: "paid", card: "chips" },
    ])
    expect(places.code).toEqual(["code"])
    expect(places.title).toEqual(["partner"])
    expect(places.amount).toEqual(["total"])
    expect(places.amountNote).toEqual(["base"])
    expect(places.chips).toEqual(["date", "paid"])
  })

  it("makes the first unplaced column the title while none is named, and the rest fields", () => {
    const places = cardPlaces([
      { id: "name", card: undefined },
      { id: "email", card: undefined },
      { id: "role", card: "status" },
    ])
    expect(places.title).toEqual(["name"])
    expect(places.fields).toEqual(["email"])
    expect(places.status).toEqual(["role"])
  })

  it("keeps an unplaced column a field once a title is named, and leaves out what asks to be left out", () => {
    const places = cardPlaces([
      { id: "note", card: undefined },
      { id: "name", card: "title" },
      { id: "hidden", card: false },
    ])
    expect(places.title).toEqual(["name"])
    expect(places.fields).toEqual(["note"])
    expect(Object.values(places).flat()).not.toContain("hidden")
  })
})

describe("isBlankCardValue", () => {
  it("calls absent, empty and whitespace values blank, and keeps zero and false", () => {
    for (const blank of [null, undefined, "", "  ", []]) expect(isBlankCardValue(blank)).toBe(true)
    for (const value of [0, false, "0", ["a"], { a: 1 }]) expect(isBlankCardValue(value)).toBe(false)
  })
})
