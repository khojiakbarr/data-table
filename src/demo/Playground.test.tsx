import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defaultLabels } from "../components/DataTable"
import { CHROME } from "./chrome"
import { Playground } from "./Playground"
import { THEME_CLASS } from "./playgroundState"

/**
 * What the playground page itself owns: that every control reaches the real
 * option or prop behind it, and that the four states a server-backed table can
 * be in are all reachable from this page.
 *
 * Deliberately not a second copy of the library's suite — whether sorting
 * sorts is `useDataTable`'s test's business. But "it renders" is not a test of
 * wiring either: each assertion below is written so that deleting the one line
 * of `Playground.tsx` it covers turns it red, which a check for the page's
 * existence never does.
 */

/** The fake server's own delay is 300ms; give a request room without being flaky. */
const SERVER_TIMEOUT = 5_000

/** Waits for the first page of rows to land, which is when the skeleton gives way. */
async function waitForRows(): Promise<void> {
  await screen.findByText("KR-10000", {}, { timeout: SERVER_TIMEOUT })
}

/** The playground's `<style>` block, which is empty until a token is edited. */
function themeRule(): string {
  return document.querySelector(".pg-main style")?.textContent ?? ""
}

/**
 * The Pagination checkbox, found through the hint printed under its label.
 *
 * `getByLabelText` cannot be used: the hint lives inside the `<label>`, so it
 * is part of the control's accessible name and no exact label string matches.
 */
function paginationToggle(): HTMLInputElement {
  const label = screen.getByText(CHROME.en.features.hints.pagination).closest("label")
  const input = label?.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!input) throw new Error("no Pagination checkbox beside the hint")
  return input
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

  it("sends the layout toggles through to <DataTable>'s own props", async () => {
    const user = userEvent.setup()
    render(<Playground />)
    await waitForRows()

    // Three separate props, each with its own mark in the DOM, so a toggle
    // that stops at its own checkbox cannot pass here.
    expect(document.querySelector(".dt-footer")).not.toBeNull()
    expect(document.querySelector(".dt-table")).toHaveClass("dt-striped")
    // `stickyHeader` is what gives the filler header cell an offset to stick at.
    expect(document.querySelector<HTMLElement>(".dt-th-filler")?.style.top).toBe("0px")

    const toggles = screen.getByLabelText(CHROME.en.features.groupLabel)
    await user.click(within(toggles).getByLabelText(CHROME.en.features.labels.footer))
    await user.click(within(toggles).getByLabelText(CHROME.en.features.labels.striped))
    await user.click(within(toggles).getByLabelText(CHROME.en.features.labels.stickyHeader))

    await waitFor(() => expect(document.querySelector(".dt-footer")).toBeNull())
    expect(document.querySelector(".dt-table")).not.toHaveClass("dt-striped")
    expect(document.querySelector<HTMLElement>(".dt-th-filler")?.style.top).toBe("")
  })

  it("sends the row-height slider through the `rowHeight` option", async () => {
    render(<Playground />)
    await waitForRows()

    // Row height is the one size control that is NOT a CSS override: the table
    // writes `--dt-row-height` inline on its own root from the option, so a
    // rule in the playground's `<style>` would lose to it. Reading the root's
    // own inline value is the only place the option's arrival shows.
    const root = document.querySelector<HTMLElement>(".dt-root")
    expect(root?.style.getPropertyValue("--dt-row-height")).toBe("40px")

    const themePanel = screen.getByLabelText(CHROME.en.theme.groupLabel)
    const rowHeight = within(themePanel).getByRole("slider", {
      name: new RegExp(CHROME.en.theme.sizes.rowHeight),
    })
    // `fireEvent.change` rather than a keypress: jsdom gives a range input no
    // native arrow-key behaviour, so `user.keyboard` would move the focus ring
    // and nothing else. Dragging a slider is not something jsdom can model.
    fireEvent.change(rowHeight, { target: { value: "64" } })

    await waitFor(() => expect(root?.style.getPropertyValue("--dt-row-height")).toBe("64px"))
    expect(themeRule()).not.toContain("--dt-row-height")
  })

  it("overrides no theme token until one is edited, then only that one", async () => {
    render(<Playground />)
    await waitForRows()

    // The page must leave the cascade alone while nothing is edited, or the
    // Light/Dark/System control has nothing left to move — an `!important`
    // copy of the light palette beats the stylesheet's own dark rules.
    expect(themeRule()).toBe("")

    const themePanel = screen.getByLabelText(CHROME.en.theme.groupLabel)
    const radius = within(themePanel).getByRole("slider", {
      name: new RegExp(CHROME.en.theme.sizes.radius),
    })
    fireEvent.change(radius, { target: { value: "20" } })

    await waitFor(() => {
      // Doubled class, because every token is declared on `.dt-root` itself;
      // `!important`, because the dark rules match at the same specificity.
      expect(themeRule()).toContain(`.${THEME_CLASS}.dt-root`)
      expect(themeRule()).toContain("--dt-radius: 20px !important;")
    })
    // Still nothing else: the colours stay the base theme's to decide.
    expect(themeRule()).not.toContain("--dt-bg")
    expect(themeRule()).not.toContain("--dt-fg")
  })

  it("fills a values list from the server, through `filtering.loadValues`", async () => {
    const user = userEvent.setup()
    render(<Playground />)
    await waitForRows()

    await user.click(screen.getByRole("button", { name: /status: column actions/i }))
    await user.click(screen.getByText(defaultLabels.filter))

    // These are the raw stored values, which only the server knows: the cells
    // render them translated ("In process"), and one page of 50 rows could not
    // produce the 25 000 count beside each. A bare `filtering: true` drops
    // `loadValues` and the editor falls back to "no values to choose from".
    expect(await screen.findByText("in_process", {}, { timeout: SERVER_TIMEOUT })).toBeInTheDocument()
    expect(screen.queryByText(defaultLabels.noValues)).not.toBeInTheDocument()
  })

  it("reaches the error state and comes back from it through Retry", async () => {
    const user = userEvent.setup()
    render(<Playground />)
    await waitForRows()

    // The control only arms the failure; something has to ask the server for
    // the next request to be the one that fails.
    await user.click(screen.getByLabelText(CHROME.en.failNext))
    await user.click(screen.getByRole("button", { name: defaultLabels.nextPage }))

    await waitFor(
      () => expect(screen.getByText(new RegExp(defaultLabels.loadFailed))).toBeInTheDocument(),
      { timeout: SERVER_TIMEOUT },
    )

    await user.click(screen.getByRole("button", { name: defaultLabels.retry }))

    // Page two's first row, so this cannot pass on the rows left over from the
    // failed request's page.
    expect(await screen.findByText("KR-10050", {}, { timeout: SERVER_TIMEOUT })).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(defaultLabels.loadFailed))).not.toBeInTheDocument()
  })

  it("reaches the filtered-empty state when a search matches nothing", async () => {
    const user = userEvent.setup()
    render(<Playground />)
    await waitForRows()

    await user.type(screen.getByRole("searchbox"), "zzzzzz")

    // Not `labels.empty`: the table knows a filter is what emptied it, and
    // says so with a way out rather than "No rows".
    await waitFor(() => expect(screen.getByText(defaultLabels.noMatches)).toBeInTheDocument(), {
      timeout: SERVER_TIMEOUT,
    })
  })

  it("warns on the Pagination toggle that server mode needs paging", async () => {
    const user = userEvent.setup()
    render(<Playground />)
    await waitForRows()

    // Unticking this drops the table into the state `useDataTable` warns about
    // in the console — one page of 50 out of 100 000, and no footer to reach
    // the rest. The hint is the only thing on screen that says so.
    for (const language of ["en", "ru", "uz"] as const) {
      if (language !== "en") {
        await user.click(screen.getByLabelText(language === "ru" ? "Русский" : "Oʻzbekcha"))
      }
      const chrome = CHROME[language]
      const hint = await screen.findByText(chrome.features.hints.pagination)
      const toggle = hint.closest("label")
      expect(toggle?.textContent).toContain(chrome.features.labels.pagination)
      expect(toggle?.querySelector('input[type="checkbox"]')).not.toBeNull()
    }
  })

  it("takes the pager away when Pagination is unticked, and brings it back", async () => {
    const user = userEvent.setup()
    render(<Playground />)
    await waitForRows()

    // The state the hint above warns about, asserted rather than described:
    // with `pagination` off the footer stops rendering altogether, so one page
    // of 50 out of 100 000 is all there is and nothing leads to the rest.
    // Without this the toggle could stop at its own checkbox — the option
    // would fall back to its default and the warning would be about nothing.
    const nextPage = { name: defaultLabels.nextPage }
    expect(screen.getByRole("button", nextPage)).toBeInTheDocument()

    await user.click(paginationToggle())
    await waitFor(() => expect(screen.queryByRole("button", nextPage)).toBeNull())

    await user.click(paginationToggle())
    await waitFor(() => expect(screen.getByRole("button", nextPage)).toBeInTheDocument())
  })

  it("switches the table labels and the page chrome together", async () => {
    const user = userEvent.setup()
    render(<Playground />)
    await waitForRows()

    /*
     * Scoped to the table: the Columns tab and the Row Groups zone name the
     * same columns, so a page-wide `getByText("Partner")` can match more than
     * one element. It is the COLUMN HEADER that has to move with the language.
     */
    const header = () => within(screen.getByRole("table"))
    expect(header().getByText("Partner")).toBeInTheDocument()
    expect(screen.getByText(CHROME.en.resetAll)).toBeInTheDocument()

    await user.click(screen.getByLabelText("Русский"))

    // The column header is the page's own translation, the sidebar copy is
    // `CHROME.ru`, and the rail's tab is the library's `ruLabels` — all three
    // have to move for the switcher to have done its job.
    await waitFor(() => expect(header().getByText("Контрагент")).toBeInTheDocument())
    expect(screen.getByText(CHROME.ru.resetAll)).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Столбцы" })).toBeInTheDocument()
    expect(screen.queryByText(CHROME.en.resetAll)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText("Oʻzbekcha"))
    await waitFor(() => expect(header().getByText("Kontragent")).toBeInTheDocument())
    expect(screen.getByText(CHROME.uz.resetAll)).toBeInTheDocument()
  })
})

/**
 * The virtualiser is the one prop with nothing to show for itself until the
 * viewport has a size: jsdom lays nothing out, so an unmeasured table renders
 * its whole page either way (`useRowVirtualizer`'s `unmeasuredFloor`, which is
 * deliberate — a server render must not hand out a page with rows missing).
 * Stubbing the scroll box's height is what makes the windowing observable, so
 * it is scoped to this one suite rather than left on for the rest.
 */
describe("playground virtualisation", () => {
  const VIEWPORT_PX = 300

  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  let restoreSizes: () => void

  beforeEach(() => {
    localStorage.clear()
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")
    const sizeOf = (element: HTMLElement, size: number): number =>
      element.classList.contains("dt-viewport") ? size : 0
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(): number {
        return sizeOf(this as HTMLElement, VIEWPORT_PX)
      },
    })
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(): number {
        return sizeOf(this as HTMLElement, 800)
      },
    })
    restoreSizes = () => {
      // Deleting matters: jsdom may not define these at all, and a stub left
      // on the prototype would size every later suite's elements.
      if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height)
      else delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight
      if (width) Object.defineProperty(HTMLElement.prototype, "offsetWidth", width)
      else delete (HTMLElement.prototype as { offsetWidth?: unknown }).offsetWidth
    }
  })

  afterEach(() => restoreSizes())

  it("windows the rows only while the Virtualize toggle is on", async () => {
    const user = userEvent.setup()
    render(<Playground />)
    await waitForRows()

    const bodyRows = (): number => document.querySelectorAll("tbody tr").length
    const pageSize = 50

    // A 300px window over 40px rows: a fraction of the page, plus overscan and
    // the two spacer rows that hold the scroll height open.
    expect(bodyRows()).toBeLessThan(pageSize)

    const toggles = screen.getByLabelText(CHROME.en.features.groupLabel)
    await user.click(within(toggles).getByLabelText(CHROME.en.features.labels.virtualize))

    // Off, every row of the page is in the DOM — which is the cost the toggle
    // exists to make visible.
    await waitFor(() => expect(bodyRows()).toBe(pageSize))
  })
})
