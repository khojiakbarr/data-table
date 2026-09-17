import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

/**
 * Cascade-resolution checks for the base stylesheet.
 *
 * Both suites below inject the real `src/styles.css` into the document and
 * read back `getComputedStyle` — the actual CSS cascade a browser would
 * resolve, not a guess about it from selector text. This is what catches
 * specificity and source-order bugs that reading the CSS text cannot.
 *
 * jsdom does not resolve `var()`/`color-mix()` into a final colour (verified:
 * an element styled with `background: var(--x)` reports
 * `getComputedStyle(el).backgroundColor` as `"rgba(0, 0, 0, 0)"` regardless of
 * what `--x` is set to), so the striping suite substitutes two distinguishable
 * literal colours for the exact `var(--dt-row-stripe)` / `var(--dt-row-hover)`
 * usages before injecting the sheet. That substitution changes nothing about
 * which selector wins — only makes the winner legible to `getComputedStyle`.
 */
const baseStylesheet = readFileSync(resolve(__dirname, "styles.css"), "utf8")

describe("stacking context", () => {
  let styleEl: HTMLStyleElement

  beforeEach(() => {
    styleEl = document.createElement("style")
    styleEl.textContent = baseStylesheet
    document.head.appendChild(styleEl)
  })

  afterEach(() => {
    styleEl.remove()
  })

  /** Builds a bare `.dt-root` and, when given, a direct-child overlay element. */
  const renderRoot = (overlayClassName?: string): HTMLDivElement => {
    const root = document.createElement("div")
    root.className = "dt-root"
    if (overlayClassName) {
      const overlay = document.createElement("div")
      overlay.className = overlayClassName
      root.appendChild(overlay)
    }
    document.body.appendChild(root)
    return root
  }

  it("lifts .dt-root while its Columns panel is open", () => {
    const root = renderRoot("dt-panel")
    expect(getComputedStyle(root).zIndex).toBe("1")
    root.remove()
  })

  it("lifts .dt-root while its header menu is open, the same as the Columns panel", () => {
    // HeaderMenu.tsx renders `.dt-menu` as a direct child of `.dt-root`,
    // structurally parallel to ColumnPanel's `.dt-panel` — see
    // DataTable.tsx, where both are siblings inside the root. `.dt-menu` is
    // `position: fixed` and clamped only to the viewport (HeaderMenuPlacement
    // tests), so it routinely extends past its own table's box; without this
    // rule the table sits at the page's default stack level and a later,
    // also-unlifted sibling (e.g. a second table) wins ties by DOM order,
    // covering the menu regardless of the menu's own internal z-index.
    const root = renderRoot("dt-menu")
    expect(getComputedStyle(root).zIndex).toBe("1")
    root.remove()
  })

  it("leaves .dt-root at the page's stack level when neither is open", () => {
    const root = renderRoot()
    expect(getComputedStyle(root).zIndex).toBe("auto")
    root.remove()
  })

  it("lifts .dt-root while a filter popover is open, and paints it above the progress bar", () => {
    // FilterPopover.tsx renders `.dt-filter-popover` as a direct child of
    // `.dt-root`, structurally parallel to the menu and the panel. The lift
    // only orders this table against the page, so the popover also needs a
    // z-index of its own inside the root's single stacking context — without
    // one it paints under the sticky header (3), the pinned header cells (4),
    // the drag indicator (5) and the progress bar (6) it is anchored above.
    const root = renderRoot("dt-filter-popover")
    expect(getComputedStyle(root).zIndex).toBe("1")

    const popover = root.firstElementChild as HTMLElement
    const progress = document.createElement("div")
    progress.className = "dt-progress"
    root.appendChild(progress)

    expect(Number(getComputedStyle(popover).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(progress).zIndex),
    )
    root.remove()
  })
})

describe("striping vs. row-state cascade", () => {
  const STRIPE_COLOR = "rgb(1, 2, 3)"
  const HOVER_COLOR = "rgb(4, 5, 6)"

  let styleEl: HTMLStyleElement

  beforeEach(() => {
    const withLiteralColors = baseStylesheet
      .replaceAll("var(--dt-row-stripe)", STRIPE_COLOR)
      .replaceAll("var(--dt-row-hover)", HOVER_COLOR)
    styleEl = document.createElement("style")
    styleEl.textContent = withLiteralColors
    document.head.appendChild(styleEl)
  })

  afterEach(() => {
    styleEl.remove()
  })

  /** Builds the <table><tbody><tr><td> markup BodyRow.tsx produces for one row. */
  const renderRow = (options: {
    striped: boolean
    expanded: boolean
    parity: "odd" | "even"
  }): { table: HTMLTableElement; cell: HTMLTableCellElement } => {
    const table = document.createElement("table")
    table.className = options.striped ? "dt-table dt-striped" : "dt-table"
    const tbody = document.createElement("tbody")
    const row = document.createElement("tr")
    row.className = options.expanded ? "dt-tr dt-tr-expanded" : "dt-tr"
    row.dataset.parity = options.parity
    const cell = document.createElement("td")
    cell.className = "dt-td"
    row.appendChild(cell)
    tbody.appendChild(row)
    table.appendChild(tbody)
    document.body.appendChild(table)
    return { table, cell }
  }

  it("keeps the expanded tint over striping on an expanded odd row", () => {
    // BodyRow.tsx puts both data-parity="odd" and dt-tr-expanded on the same
    // <tr> whenever an odd-positioned row is expanded — the exact case the
    // striping rule's higher specificity used to win regardless of intent.
    const { table, cell } = renderRow({ striped: true, expanded: true, parity: "odd" })
    expect(getComputedStyle(cell).backgroundColor).toBe(HOVER_COLOR)
    table.remove()
  })

  it("keeps the stripe on a non-expanded odd row (control)", () => {
    const { table, cell } = renderRow({ striped: true, expanded: false, parity: "odd" })
    expect(getComputedStyle(cell).backgroundColor).toBe(STRIPE_COLOR)
    table.remove()
  })

  it("keeps the expanded tint on an expanded even row (control)", () => {
    const { table, cell } = renderRow({ striped: true, expanded: true, parity: "even" })
    expect(getComputedStyle(cell).backgroundColor).toBe(HOVER_COLOR)
    table.remove()
  })
})

/**
 * The README's headline "Styling" recipe (finding #19): every token is
 * declared directly on `.dt-root`, so an override has to match that element,
 * not an ancestor — and, unlike the shadcn preset's `(0,2,0)` selector, the
 * base sheet's own `.dt-root {}` is only `(0,1,0)`, so `.dt-root.dt-root`
 * beats it outright with no load-order dependency to document.
 */
describe("README override recipes", () => {
  let styleEl: HTMLStyleElement

  beforeEach(() => {
    styleEl = document.createElement("style")
    styleEl.textContent = baseStylesheet
    document.head.appendChild(styleEl)
  })

  afterEach(() => styleEl.remove())

  it("is not reached by a rule on an ancestor (the recipe this replaced)", () => {
    const ancestorRule = document.createElement("style")
    ancestorRule.textContent = ".my-app { --dt-header-bg: red; }"
    document.head.appendChild(ancestorRule)

    const wrapper = document.createElement("div")
    wrapper.className = "my-app"
    const root = document.createElement("div")
    root.className = "dt-root"
    wrapper.appendChild(root)
    document.body.appendChild(wrapper)

    // `.dt-root`'s own declaration wins over anything inherited, regardless
    // of the ancestor rule's specificity — this is why the old recipe did
    // nothing, silently, for every host who copied it.
    expect(getComputedStyle(root).getPropertyValue("--dt-header-bg").trim()).toBe("#fafafa")

    wrapper.remove()
    ancestorRule.remove()
  })

  it("overrides the base sheet on the element itself, regardless of load order", () => {
    // Two fresh `<style>` elements per iteration, connected in the stated
    // order and nothing reordered afterwards — jsdom's cascade resolves a tie
    // by connection order, so reusing (or `insertBefore`-ing ahead of) an
    // already-connected sheet would not actually exercise "loads first".
    for (const overrideFirst of [true, false]) {
      const base = document.createElement("style")
      base.textContent = baseStylesheet
      const override = document.createElement("style")
      override.textContent = ".dt-root.dt-root { --dt-header-bg: red; }"

      if (overrideFirst) {
        document.head.appendChild(override)
        document.head.appendChild(base)
      } else {
        document.head.appendChild(base)
        document.head.appendChild(override)
      }

      const root = document.createElement("div")
      root.className = "dt-root"
      document.body.appendChild(root)

      expect(getComputedStyle(root).getPropertyValue("--dt-header-bg").trim()).toBe("red")

      root.remove()
      base.remove()
      override.remove()
    }
  })
})

/**
 * `.dt-menu` is `position: fixed` and placed with `left`/`top`
 * (HeaderMenu.tsx, via `useClampedPlacement`). A `width: auto` box in that
 * combination shrink-to-fits to `containingBlock - left` (CSS2.1 §10.3.7): a
 * clamp that moves the box hands it exactly that much more room, growing it,
 * which re-triggers `useClampedPlacement`'s ResizeObserver, which clamps
 * again — a feedback loop, not a one-time reflow (review finding on
 * useClampedPlacement.ts). jsdom does no layout, so this cannot be caught by
 * measuring a real reflow; it can only be caught by asserting what the box
 * declares.
 *
 * The invariant is that the declared width is *placement-independent*, which
 * is narrower than "not the keyword `auto`": `width: fit-content` is
 * `min(max-content, max(min-content, stretch-fit))` (CSS-SIZING-3), and for a
 * `position: fixed` box with `left` set and `right: auto` the stretch-fit term
 * is `ICB width - left` — the same dependency on `left`, under a different
 * spelling. So each declaration is asserted by value rather than by what it is
 * not, and `fit-content` is the specific spelling that must not come back.
 */
describe(".dt-menu sizing", () => {
  let styleEl: HTMLStyleElement

  beforeEach(() => {
    styleEl = document.createElement("style")
    styleEl.textContent = baseStylesheet
    document.head.appendChild(styleEl)
  })

  afterEach(() => styleEl.remove())

  it("does not leave the menu's width dependent on its own `left`", () => {
    const menu = document.createElement("div")
    menu.className = "dt-menu"
    document.body.appendChild(menu)

    expect(getComputedStyle(menu).width).toBe("max-content")

    menu.remove()
  })

  it("still bounds the menu to the viewport instead of letting it grow unboundedly", () => {
    const menu = document.createElement("div")
    menu.className = "dt-menu"
    document.body.appendChild(menu)

    // jsdom resolves the declared `calc(100vw - 16px)` against its own
    // viewport, so the computed value comes back as a pixel length: the
    // window less the 8px margin `useClampedPlacement` keeps on each side.
    expect(getComputedStyle(menu).maxWidth).toBe(`${window.innerWidth - 16}px`)

    menu.remove()
  })
})
