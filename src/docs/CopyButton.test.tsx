import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CopyButton } from "./CopyButton"

/** Replaces the clipboard with one whose write resolves or rejects. */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
}

describe("CopyButton", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("copies the exact text and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    const user = userEvent.setup()
    render(<CopyButton text="npm i x" what="bash code" />)
    // userEvent installs its own clipboard on setup; ours has to go on after it.
    stubClipboard(writeText)

    await user.click(screen.getByRole("button", { name: "Copy bash code" }))

    expect(writeText).toHaveBeenCalledWith("npm i x")
    expect(screen.getByRole("button", { name: "Copied bash code" })).toBeInTheDocument()
  })

  it("says the copy failed when the clipboard refuses", async () => {
    const user = userEvent.setup()
    render(<CopyButton text="npm i x" what="bash code" />)
    stubClipboard(() => Promise.reject(new Error("denied")))

    await user.click(screen.getByRole("button", { name: "Copy bash code" }))

    expect(screen.getByRole("button", { name: "Copy failed bash code" })).toBeInTheDocument()
  })
})
