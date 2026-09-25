import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CHROME } from "./chrome"
import { PlaygroundHeader } from "./PlaygroundHeader"

/**
 * The masthead is shared by the site's two pages, and each must link to the
 * other — as a real file (`docs.html`), because GitHub Pages has no fallback
 * for a route it cannot find on disk.
 */
describe("site masthead", () => {
  it("links the playground to the docs, in the chosen language", () => {
    render(<PlaygroundHeader chrome={CHROME.uz} language="uz" onLanguageChange={() => {}} />)
    expect(screen.getByRole("link", { name: "Hujjatlar" })).toHaveAttribute("href", "/docs.html")
    expect(screen.getByRole("radio", { name: "Oʻzbekcha" })).toBeChecked()
  })

  it("links the docs back to the playground, with no language switcher", () => {
    render(<PlaygroundHeader page="docs" chrome={CHROME.en} />)
    expect(screen.getByRole("link", { name: "Playground" })).toHaveAttribute("href", "/")
    expect(screen.queryByRole("radio")).toBeNull()
  })
})
