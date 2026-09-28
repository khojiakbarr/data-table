import { describe, expect, it } from "vitest"
import { columnLabel } from "./columnLabel"

describe("columnLabel", () => {
  it("names a column by its header when the header is text", () => {
    expect(columnLabel("amount", "Amount", "Ignored")).toBe("Amount")
  })

  it("names a column whose header is drawn by its meta label, not its id", () => {
    const drawn = () => null
    expect(columnLabel("pick", drawn, "Choose")).toBe("Choose")
  })

  it("falls back to the id only when there is neither", () => {
    expect(columnLabel("actions", () => null)).toBe("actions")
    expect(columnLabel("actions", "", "")).toBe("actions")
  })
})
