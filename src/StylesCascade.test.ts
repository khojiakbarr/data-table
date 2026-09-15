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
