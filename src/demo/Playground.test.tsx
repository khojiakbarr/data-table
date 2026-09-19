import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { CHROME } from "./chrome"
import { Playground } from "./Playground"
import { THEME_CLASS } from "./playgroundState"

/**
 * A smoke test for the playground page, not a second copy of the library's
 * own suite.
 *
 * What is worth asserting here is only what the page itself owns: that it
 * mounts and gets rows out of the fake server, that a control really reaches
 * the table rather than only moving its own checkbox, and that the language
 * switcher moves the page chrome and the table together. Whether sorting
 * sorts is `useDataTable`'s test's business.
 */

/** The fake server's own delay is 300ms; give a request room without being flaky. */
const SERVER_TIMEOUT = 5_000

/** Waits for the first page of rows to land, which is when the skeleton gives way. */
async function waitForRows(): Promise<void> {
  await screen.findByText("KR-10000", {}, { timeout: SERVER_TIMEOUT })
}

beforeEach(() => {
  // The page persists its layout under the id "playground"; a sorting or page
  // size left behind by one test would silently change the next one's query.
  localStorage.clear()
})

describe("playground", () => {
  it("renders and fills the table from the fake server", async () => {
    render(<Playground />)

    expect(screen.getByRole("heading", { name: "@khojiakbarr/data-table" })).toBeInTheDocument()
    await waitForRows()

    // The total comes from the server's answer, not from the rows on screen:
    // a page of 100 rows out of 100 000 is what server mode is for.
    expect(screen.getByText("KR-10001")).toBeInTheDocument()
  })

  it("lets a feature toggle change the table", async () => {
    const user = userEvent.setup()
    render(<Playground />)
    await waitForRows()

    const footer = document.querySelector(".dt-footer")
    expect(footer).not.toBeNull()

    const toggles = screen.getByLabelText(CHROME.en.features.groupLabel)
    await user.click(within(toggles).getByLabelText(CHROME.en.features.labels.footer))

    // The prop is gone, so the footer is gone — the toggle reached `<DataTable>`
    // rather than only flipping its own checkbox.
    await waitFor(() => expect(document.querySelector(".dt-footer")).toBeNull())
  })

  it("lets a theme control change a token", async () => {
    render(<Playground />)
    await waitForRows()

    const themePanel = screen.getByLabelText(CHROME.en.theme.groupLabel)
    // By role, not by label: the control's `<label>` also wraps the `<output>`
    // showing the current value, and that is a labelable element too, so
    // `getByLabelText` can hand back the readout instead of the slider.
    const radius = within(themePanel).getByRole("slider", {
      name: new RegExp(CHROME.en.theme.sizes.radius),
    })
    expect(document.querySelector("style")?.textContent).toContain("--dt-radius: 8px")

    // `fireEvent.change` rather than a keypress: jsdom gives a range input no
    // native arrow-key behaviour, so `user.keyboard` would move the focus ring
    // and nothing else. Dragging a slider is not something jsdom can model.
    fireEvent.change(radius, { target: { value: "20" } })

    // The injected override is what the table actually reads — see
    // `themeStyleRule` for why it has to match `.dt-root` directly.
    await waitFor(() => {
      const rule = document.querySelector("style")?.textContent ?? ""
      expect(rule).toContain(`.${THEME_CLASS}.dt-root`)
      expect(rule).toContain("--dt-radius: 20px")
    })
  })

  it("switches the table labels and the page chrome together", async () => {
    const user = userEvent.setup()
    render(<Playground />)
    await waitForRows()

    expect(screen.getByText("Partner")).toBeInTheDocument()
    expect(screen.getByText(CHROME.en.resetAll)).toBeInTheDocument()

    await user.click(screen.getByLabelText("Русский"))

    // The column header is the page's own translation, the sidebar copy is
    // `CHROME.ru`, and the toolbar button is the library's `ruLabels` — all
    // three have to move for the switcher to have done its job.
    await waitFor(() => expect(screen.getByText("Контрагент")).toBeInTheDocument())
    expect(screen.getByText(CHROME.ru.resetAll)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Столбцы" })).toBeInTheDocument()
    expect(screen.queryByText(CHROME.en.resetAll)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText("Oʻzbekcha"))
    await waitFor(() => expect(screen.getByText("Kontragent")).toBeInTheDocument())
    expect(screen.getByText(CHROME.uz.resetAll)).toBeInTheDocument()
  })
})
