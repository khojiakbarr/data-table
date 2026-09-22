import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createColumnHelper } from "@tanstack/react-table"
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DataTable } from "../components/DataTable"
import { useDataTable, type DataTableFeatures } from "../useDataTable"
import { muiTokens, type MuiThemeInput, type TokenStyle } from "./mui"

/**
 * A theme shaped the way `@mui/material` v5's `createTheme()` leaves one:
 * plain colour strings, `shape.borderRadius` and `typography.fontSize` as
 * unitless numbers. Values are MUI's own stock light palette.
 *
 * Deliberately NOT written with `satisfies MuiThemeInput`: that would apply an
 * excess-property check to the literal and reject `common`, `primary.light`,
 * `text.disabled` and the rest — the very fields a real theme carries. Passing
 * it as a variable is the assignability a host actually gets, and the
 * `muiTokens(v5Theme)` calls below are what prove it.
 */
const v5Theme = {
  palette: {
    mode: "light",
    common: { black: "#000", white: "#fff" },
    primary: { main: "#1976d2", light: "#42a5f5", dark: "#1565c0", contrastText: "#fff" },
    text: { primary: "rgba(0, 0, 0, 0.87)", secondary: "rgba(0, 0, 0, 0.6)", disabled: "rgba(0, 0, 0, 0.38)" },
    // MUI v5's stock light palette really does state these the same; the
    // header mapping has to cope with that rather than assume a page tone.
    background: { paper: "#fff", default: "#fff" },
    divider: "rgba(0, 0, 0, 0.12)",
    action: { hover: "rgba(0, 0, 0, 0.04)", hoverOpacity: 0.04, selected: "rgba(0, 0, 0, 0.08)", selectedOpacity: 0.08 },
  },
  typography: { fontFamily: '"Roboto","Helvetica","Arial",sans-serif', fontSize: 14 },
  shape: { borderRadius: 4 },
} as const

/**
 * A v6 theme in CSS-variables mode: the same fields, but holding `var(--mui-*)`
 * references, plus the `*Channel` companions and the `vars` tree v6 adds. The
 * extra fields must be ignored without complaint, and a `var()` reference must
 * pass through as the CSS value it already is.
 */
const v6Theme = {
  palette: {
    mode: "dark",
    primary: { main: "var(--mui-palette-primary-main)", contrastText: "var(--mui-palette-primary-contrastText)" },
    text: { primary: "var(--mui-palette-text-primary)", secondary: "var(--mui-palette-text-secondary)" },
    background: {
      paper: "var(--mui-palette-background-paper)",
      default: "var(--mui-palette-background-default)",
      paperChannel: "18 18 18",
      defaultChannel: "18 18 18",
    },
    divider: "var(--mui-palette-divider)",
    dividerChannel: "255 255 255",
    action: { hoverOpacity: 0.08, selectedOpacity: 0.16 },
  },
  vars: { palette: { primary: { main: "var(--mui-palette-primary-main)" } } },
  colorSchemes: { light: {}, dark: {} },
  typography: { fontFamily: "Inter, sans-serif", fontSize: 16 },
  shape: { borderRadius: 12 },
} as const

/** Every `--dt-*` token the base stylesheet swaps in its pinned dark block. */
const darkBlockTokens = (): string[] => {
  const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8")
  const block = css.match(/\.dt-root\[data-dt-theme="dark"\]\s*\{([^}]*)\}/)?.[1] ?? ""
  return [...block.matchAll(/(--dt-[a-z0-9-]+)\s*:/g)].map((match) => match[1] as string)
}

describe("muiTokens", () => {
  it("maps a v5 theme's palette, typography and radius", () => {
    const tokens = muiTokens(v5Theme)

    expect(tokens["--dt-bg"]).toBe("#fff")
    expect(tokens["--dt-fg"]).toBe("rgba(0, 0, 0, 0.87)")
    expect(tokens["--dt-muted-fg"]).toBe("rgba(0, 0, 0, 0.6)")
    expect(tokens["--dt-border"]).toBe("rgba(0, 0, 0, 0.12)")
    expect(tokens["--dt-header-fg"]).toBe("rgba(0, 0, 0, 0.6)")
    expect(tokens["--dt-accent"]).toBe("#1976d2")
    expect(tokens["--dt-accent-fg"]).toBe("#fff")
    expect(tokens["--dt-resize-handle"]).toBe("rgba(0, 0, 0, 0.12)")
    // Unitless numbers mean pixels in MUI, and a CSS length needs the unit.
    expect(tokens["--dt-radius"]).toBe("4px")
    expect(tokens["--dt-font-size"]).toBe("14px")
    expect(tokens["--dt-font"]).toBe('"Roboto","Helvetica","Arial",sans-serif')
  })

  it("prints the accent as text unchanged, because that is MUI's own pairing", () => {
    // `primary.main` IS what MUI prints as text on a surface (Link, text
    // Button), so the token the base sheet keeps separate for the stricter
    // 4.5:1 text minimum copies it rather than darkening it independently.
    const tokens = muiTokens(v5Theme)
    expect(tokens["--dt-accent-text"]).toBe("#1976d2")
    expect(tokens["--dt-accent-text"]).toBe(tokens["--dt-accent"])
  })

  it("rebuilds the action tints opaquely, since a pinned cell is sticky", () => {
    const tokens = muiTokens(v5Theme)

    // Light mode tints with black, at exactly the opacity MUI states — and
    // against --dt-bg, so the result is opaque rather than see-through.
    expect(tokens["--dt-row-hover"]).toBe("color-mix(in srgb, #000 4%, var(--dt-bg))")
    // A stripe is permanent, so it stays the quietest tone on the table —
    // a quarter of the hover, the base sheet's own #fcfcfd : #f4f4f5 ratio.
    // `selectedOpacity` cannot stand in: MUI states it STRONGER than hover.
    expect(tokens["--dt-row-stripe"]).toBe("color-mix(in srgb, #000 1%, var(--dt-bg))")
    expect(tokens["--dt-detail-bg"]).toBe("color-mix(in srgb, #000 8%, var(--dt-bg))")
  })

  it("tints the header off the surface when MUI states both backgrounds alike", () => {
    // v5's stock light palette has paper === default, so copying `default`
    // would leave the header the exact colour of the body.
    expect(muiTokens(v5Theme)["--dt-header-bg"]).toBe("color-mix(in srgb, #000 2%, var(--dt-bg))")
  })

  it("honours background.default once the host has set it apart from paper", () => {
    const tinted = muiTokens({ palette: { background: { paper: "#ffffff", default: "#f5f7fb" } } })
    expect(tinted["--dt-header-bg"]).toBe("#f5f7fb")
    expect(tinted["--dt-bg"]).toBe("#ffffff")
  })

  it("passes a v6 CSS-variables theme through and ignores its extra fields", () => {
    const tokens = muiTokens(v6Theme)

    expect(tokens["--dt-bg"]).toBe("var(--mui-palette-background-paper)")
    expect(tokens["--dt-header-bg"]).toBe("var(--mui-palette-background-default)")
    expect(tokens["--dt-border"]).toBe("var(--mui-palette-divider)")
    expect(tokens["--dt-accent-fg"]).toBe("var(--mui-palette-primary-contrastText)")
    expect(tokens["--dt-radius"]).toBe("12px")
    expect(tokens["--dt-font-size"]).toBe("16px")
  })

  it("tints with white and takes the dark shadow once palette.mode is dark", () => {
    const tokens = muiTokens(v6Theme)

    expect(tokens["--dt-row-hover"]).toBe("color-mix(in srgb, #fff 8%, var(--dt-bg))")
    expect(tokens["--dt-row-stripe"]).toBe("color-mix(in srgb, #fff 2%, var(--dt-bg))")
    expect(tokens["--dt-detail-bg"]).toBe("color-mix(in srgb, #fff 16%, var(--dt-bg))")
    expect(tokens["--dt-pin-shadow-start"]).toBe("6px 0 6px -6px rgb(0 0 0 / 0.5)")
    expect(tokens["--dt-pin-shadow-end"]).toBe("-6px 0 6px -6px rgb(0 0 0 / 0.5)")
  })

  it("falls back to the built-in palette for an empty object", () => {
    const tokens = muiTokens({})

    expect(tokens["--dt-bg"]).toBe("#ffffff")
    expect(tokens["--dt-fg"]).toBe("#18181b")
    expect(tokens["--dt-header-bg"]).toBe("#fafafa")
    expect(tokens["--dt-accent"]).toBe("#3b82f6")
    // The light-mode text accent, not the plain accent: the base sheet darkens
    // its own blue to clear 4.5:1 and the fallback has to carry that too.
    expect(tokens["--dt-accent-text"]).toBe("#1d4ed8")
    expect(tokens["--dt-radius"]).toBe("8px")
    expect(tokens["--dt-font"]).toBe("inherit")
    expect(tokens["--dt-pin-shadow-start"]).toBe("6px 0 6px -6px rgb(0 0 0 / 0.18)")
  })

  it("falls back to the built-in DARK palette for a bare dark theme", () => {
    // The mode alone has to swing every fallback, or a theme that sets only
    // `palette.mode` would render light text on a light surface.
    const tokens = muiTokens({ palette: { mode: "dark" } })

    expect(tokens["--dt-bg"]).toBe("#18181b")
    expect(tokens["--dt-fg"]).toBe("#fafafa")
    expect(tokens["--dt-header-bg"]).toBe("#1f1f23")
    expect(tokens["--dt-accent-text"]).toBe("#60a5fa")
    expect(tokens["--dt-row-hover"]).toBe("color-mix(in srgb, #fff 4%, var(--dt-bg))")
  })

  it("fills the gaps in a partial theme without dropping what it does have", () => {
    const tokens = muiTokens({ palette: { primary: { main: "#6d28d9" } }, shape: { borderRadius: "0.5rem" } })

    expect(tokens["--dt-accent"]).toBe("#6d28d9")
    expect(tokens["--dt-accent-text"]).toBe("#6d28d9")
    // No `contrastText` to copy, so the base sheet's own value stands in.
    expect(tokens["--dt-accent-fg"]).toBe("#18181b")
    expect(tokens["--dt-bg"]).toBe("#ffffff")
    // A radius that already carries a unit is not given a second one.
    expect(tokens["--dt-radius"]).toBe("0.5rem")
  })

  it("never produces an empty or undefined CSS value, whatever it is handed", () => {
    const junk = {
      palette: {
        mode: "sideways",
        background: { paper: "   ", default: 42 },
        text: { primary: null },
        divider: "",
        primary: { main: undefined },
        action: { hoverOpacity: Number.NaN, selectedOpacity: 5 },
      },
      typography: { fontFamily: 12, fontSize: Number.POSITIVE_INFINITY },
      shape: { borderRadius: {} },
      // A plain-JS host can hand this function anything; the point of the case
      // is that every branch narrows at runtime rather than trusting the type.
    } as unknown as MuiThemeInput

    const cases: MuiThemeInput[] = [{}, v5Theme, v6Theme, junk]
    for (const theme of cases) {
      const tokens = muiTokens(theme)
      for (const [name, value] of Object.entries(tokens)) {
        expect(value, name).toBeTypeOf("string")
        expect(String(value).trim(), name).not.toBe("")
        expect(String(value), name).not.toContain("undefined")
        expect(String(value), name).not.toContain("NaN")
      }
    }
  })

  it("emits every token the base stylesheet swaps between light and dark", () => {
    /*
     * The dark-mode contract. An inline style beats every stylesheet rule, so
     * these tokens override the base sheet's `prefers-color-scheme` block —
     * but only the ones actually emitted. A token left out would still be
     * swapped by the OS, so a light MUI theme on a dark machine would get dark
     * borders on a light surface. Emitting the whole dark block is what makes
     * "the MUI theme's mode wins" true rather than nearly true.
     */
    const tokens = muiTokens(v5Theme)
    const swapped = darkBlockTokens()

    expect(swapped.length).toBeGreaterThan(0)
    for (const token of swapped) {
      expect(Object.keys(tokens), token).toContain(token)
    }
  })
})

interface Row {
  id: string
  name: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 120 })]
const data: Row[] = [{ id: "r0", name: "Alpha" }]

/** A table whose only interesting prop is the one under test. */
function Table({ style }: { style?: TokenStyle }) {
  const instance = useDataTable<Row>({ id: "mui", columns, data, getRowId: (row) => row.id })
  return <DataTable instance={instance} virtualize={false} style={style} />
}

describe("the style prop the tokens are spread onto", () => {
  it("puts the tokens on the element that declares them", () => {
    // The base sheet declares every `--dt-*` on `.dt-root` itself, so an
    // override has to land on that same element — anywhere further out and
    // the root's own declaration beats it.
    render(<Table style={muiTokens({ palette: { primary: { main: "#6d28d9" } } })} />)
    const root = document.querySelector<HTMLElement>(".dt-root")

    expect(root?.style.getPropertyValue("--dt-accent")).toBe("#6d28d9")
    expect(root?.style.getPropertyValue("--dt-bg")).toBe("#ffffff")
  })

  it("keeps the row height the virtualiser is estimating with", () => {
    // The host's style is spread first for exactly this: a stray
    // `--dt-row-height` would desynchronise the rows from the scrollbar.
    const rowHeightOverride: TokenStyle = { "--dt-row-height": "999px" }
    render(<Table style={rowHeightOverride} />)
    const root = document.querySelector<HTMLElement>(".dt-root")

    expect(root?.style.getPropertyValue("--dt-row-height")).toBe("40px")
  })
})
