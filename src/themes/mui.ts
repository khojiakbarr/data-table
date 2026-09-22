import type { CSSProperties } from "react"

/**
 * A React `style` object carrying this library's `--dt-*` tokens.
 *
 * `CSSProperties` on its own rejects custom properties, so a pattern index
 * signature is intersected in. That keeps the object assignable to `style`
 * while letting a caller — or a test — read a token back by name instead of
 * casting the whole object.
 */
export type TokenStyle = CSSProperties & Record<`--dt-${string}`, string>

/**
 * The slice of a Material UI theme {@link muiTokens} reads.
 *
 * Deliberately structural and deliberately not `@mui/material`'s own `Theme`:
 * this library does not depend on MUI and must not import it, not even as a
 * type, or every host would need MUI installed to typecheck. Declaring only
 * the fields actually read — each optional, each also accepting `undefined`
 * for `exactOptionalPropertyTypes` hosts — makes a v5 theme, a v6 theme and a
 * hand-written object all assignable, and leaves every extra field a real
 * theme carries (v6's `*Channel` values, `vars`, `components`, …) harmlessly
 * ignored.
 *
 * `action.hover` and `action.selected` are absent on purpose. MUI states both
 * as translucent colours (`rgba(0, 0, 0, 0.04)`), and this table cannot use a
 * translucent row background: `.dt-td` paints an opaque `--dt-bg`, and a
 * pinned cell is `position: sticky`, so a see-through hover or stripe would
 * show the columns scrolling underneath it. The opacities are read instead
 * and recomposited against the surface — see {@link muiTokens}.
 */
export interface MuiThemeInput {
  palette?:
    | {
        mode?: "light" | "dark" | undefined
        background?: { default?: string | undefined; paper?: string | undefined } | undefined
        text?: { primary?: string | undefined; secondary?: string | undefined } | undefined
        divider?: string | undefined
        primary?: { main?: string | undefined; contrastText?: string | undefined } | undefined
        action?: { hoverOpacity?: number | undefined; selectedOpacity?: number | undefined } | undefined
      }
    | undefined
  typography?: { fontFamily?: string | undefined; fontSize?: number | string | undefined } | undefined
  shape?: { borderRadius?: number | string | undefined } | undefined
}

/**
 * The base stylesheet's own palette, per mode.
 *
 * Every field a theme does not supply falls back to the value here, so
 * `muiTokens({})` reproduces the built-in light theme exactly and
 * `muiTokens({ palette: { mode: "dark" } })` the built-in dark one. Keeping a
 * full set per mode is what stops a half-filled theme from producing a
 * half-dark table.
 *
 * `neutral` is not a token: it is the colour MUI itself tints a surface with
 * in that mode (`alpha(common.black | common.white, …)`), used below to
 * rebuild the action tints opaquely.
 */
const DEFAULTS = {
  light: {
    bg: "#ffffff",
    fg: "#18181b",
    mutedFg: "#71717a",
    border: "#e4e4e7",
    headerBg: "#fafafa",
    headerFg: "#52525b",
    resizeHandle: "#d4d4d8",
    accentText: "#1d4ed8",
    shadowAlpha: "0.18",
    neutral: "#000",
  },
  dark: {
    bg: "#18181b",
    fg: "#fafafa",
    mutedFg: "#a1a1aa",
    border: "#2e2e33",
    headerBg: "#1f1f23",
    headerFg: "#a1a1aa",
    resizeHandle: "#3f3f46",
    accentText: "#60a5fa",
    shadowAlpha: "0.5",
    neutral: "#fff",
  },
} as const

/** Tokens the base sheet gives the same value in both modes. */
const ACCENT_FALLBACK = "#3b82f6"
const ACCENT_FG_FALLBACK = "#18181b"
const RADIUS_FALLBACK = "8px"
const FONT_FALLBACK = "inherit"
const FONT_SIZE_FALLBACK = "14px"

/** MUI's own defaults, used when a theme omits `palette.action`. */
const HOVER_OPACITY_FALLBACK = 0.04
const SELECTED_OPACITY_FALLBACK = 0.08

/**
 * How the two derived surface tints sit against the hover MUI states.
 *
 * MUI names a strength for a hovered surface and for a selected one, and
 * nothing for a header or a zebra stripe. Those two keep the base sheet's own
 * proportions instead, measured off its light palette against #ffffff: hover
 * #f4f4f5 is ~4% black, the header #fafafa ~2%, the stripe #fcfcfd ~1%. Taking
 * the hover as the unit reproduces that ordering at whatever strength the host
 * has set — the shape stays the table's, the colour becomes the host's.
 *
 * The ordering is the point, not the numbers. A stripe is permanent, so it has
 * to be the quietest tone on the table or a hovered row stops reading as a
 * change; `selectedOpacity` cannot stand in for it, because MUI states
 * selected as the *stronger* of its two and borrowing it would invert that.
 */
const HEADER_TINT_OF_HOVER = 0.5
const STRIPE_TINT_OF_HOVER = 0.25

/**
 * A theme string — a colour, or a font family — or the fallback when it is
 * missing or blank.
 *
 * The type says `string | undefined`, but a hand-written theme reaches this
 * function unchecked, so the narrowing is done at runtime too: an empty string
 * would otherwise become an empty CSS declaration, which is not the same as no
 * declaration at all and would leave the token with nothing to resolve to.
 *
 * @param value - The raw theme field.
 * @param fallback - The base stylesheet's value for this token.
 * @returns A usable CSS value.
 */
const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() !== "" ? value : fallback

/**
 * A theme value used as a length, or the fallback when it is missing.
 *
 * MUI states `shape.borderRadius` and `typography.fontSize` as unitless
 * numbers meaning pixels, while a hand-written theme may already carry a unit
 * (`"0.5rem"`); both are accepted.
 *
 * @param value - The raw theme field.
 * @param fallback - The base stylesheet's value for this token.
 * @returns A usable CSS length.
 */
const lengthOr = (value: unknown, fallback: string): string => {
  if (typeof value === "number" && Number.isFinite(value)) return `${value}px`
  if (typeof value === "string" && value.trim() !== "") return value
  return fallback
}

/**
 * A theme opacity, or MUI's own default when it is missing or out of range.
 *
 * @param value - The raw theme field.
 * @param fallback - MUI's default for this opacity.
 * @returns A number in 0..1.
 */
const opacityOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback

/**
 * An opaque surface tint, the way MUI builds one but composited in CSS.
 *
 * MUI's `action.hover` is `alpha(common.black | common.white, hoverOpacity)` —
 * a translucent colour meant to be laid over whatever is beneath it. This
 * table cannot take it that way (see {@link MuiThemeInput}), so the same
 * recipe is rebuilt as a `color-mix` against `var(--dt-bg)`, which resolves on
 * the very element this object is spread onto and yields a fully opaque
 * colour. Mixing a bounded percentage of the mode's own extreme into the
 * surface moves its luminance by that same bounded amount, so text that met
 * its contrast ratio on `--dt-bg` still meets it here.
 *
 * @param neutral - The mode's tinting colour, black in light and white in dark.
 * @param opacity - The strength MUI states for this tint, in 0..1.
 * @returns A `color-mix()` expression.
 */
const tint = (neutral: string, opacity: number): string =>
  // Rounded, or 0.04 * 100 prints as 4.000000000000001.
  `color-mix(in srgb, ${neutral} ${Math.round(opacity * 10000) / 100}%, var(--dt-bg))`

/**
 * Maps a Material UI theme onto this table's `--dt-*` tokens.
 *
 * Spread the result onto the table's `style` prop and it takes the
 * application's palette, typography and corner radius. Scope is colour, type
 * and radius only: the table keeps its own density, borders and shape.
 *
 * Why this is a function rather than a stylesheet preset, as shadcn gets:
 * a preset works by pointing `--dt-*` at the host's own custom properties, and
 * MUI v5 exposes none — there is nothing for a stylesheet to read. v6 in
 * CSS-variables mode does publish `--mui-*`, but `theme.palette` still holds
 * those `var(--mui-…)` references, so reading the theme covers both.
 *
 * **Dark mode.** The theme's `palette.mode` wins, and does so on purpose. An
 * inline style beats every stylesheet rule, so the tokens below override both
 * the built-in `prefers-color-scheme` block and a `theme="light" | "dark"`
 * prop — pass the table the MUI theme and the mode is the application's, not
 * the operating system's and not the prop's. That is only safe because this
 * function emits *every* token the base sheet swaps between its light and dark
 * blocks: emitting a subset would leave a light MUI theme with dark borders on
 * a machine set to dark. A theme with no `palette.mode` is treated as light,
 * as MUI treats it.
 *
 * **Contrast.** The palette is the host's, so its own contrast is the host's
 * responsibility — `primary.main` that fails 4.5:1 as text on
 * `background.paper` fails here too. What this function guarantees is that it
 * introduces no failure of its own: every token is either copied from the
 * theme unchanged, or derived by a rule that cannot move a pair's contrast
 * beyond the tint strength MUI itself stated.
 *
 * @param theme - A MUI theme, or any object shaped like the part of one read here.
 * @returns The `--dt-*` tokens as a style object.
 *
 * @example
 * import { useTheme } from "@mui/material"
 * import { muiTokens } from "@khojiakbarr/data-table"
 *
 * const theme = useTheme()
 * return <DataTable instance={table} style={muiTokens(theme)} />
 */
export function muiTokens(theme: MuiThemeInput): TokenStyle {
  // Read defensively throughout: this is a public export, and a plain-JS host
  // reaches it with whatever it likes.
  const palette = theme?.palette
  const mode = palette?.mode === "dark" ? "dark" : "light"
  const base = DEFAULTS[mode]

  /*
   * One theme colour, two fallbacks. When the theme states `primary.main`,
   * the fill and the text accent are both it — MUI prints that colour as text
   * itself. When it does not, they must part: the base sheet's fill accent
   * (#3b82f6) is only 3.68:1 on white and would fail the 4.5:1 text minimum,
   * which is the whole reason the base sheet darkens a separate value for
   * text. Falling both back to the same colour would quietly undo that.
   */
  const primaryMain = palette?.primary?.main
  const accent = stringOr(primaryMain, ACCENT_FALLBACK)
  const accentText = stringOr(primaryMain, base.accentText)
  const hoverOpacity = opacityOr(palette?.action?.hoverOpacity, HOVER_OPACITY_FALLBACK)
  const selectedOpacity = opacityOr(palette?.action?.selectedOpacity, SELECTED_OPACITY_FALLBACK)

  /*
   * Surface and header.
   *
   * The table is a raised surface sitting on the page, so it takes
   * `background.paper`. The header wants the tone MUI puts *behind* that
   * surface — but only when the host has actually distinguished the two.
   * MUI's own stock palettes do not: v5 light states paper and default both
   * `#fff`, v5 dark both `#121212`. Copying `default` there would give the
   * header the body's exact colour, which is how MUI X's grid looks and is
   * not how this table is shaped. So when the host has set the two apart —
   * as an admin template with a tinted page background has — their `default`
   * is honoured, and when it has not, the header is tinted off the surface
   * instead, by MUI's own hover strength in MUI's own direction for the mode.
   * Either way the header reads as a header and the colour is the host's.
   */
  const surface = stringOr(palette?.background?.paper, base.bg)
  const page = stringOr(palette?.background?.default, base.headerBg)

  return {
    "--dt-bg": surface,
    "--dt-fg": stringOr(palette?.text?.primary, base.fg),
    "--dt-muted-fg": stringOr(palette?.text?.secondary, base.mutedFg),
    "--dt-border": stringOr(palette?.divider, base.border),
    "--dt-radius": lengthOr(theme?.shape?.borderRadius, RADIUS_FALLBACK),

    "--dt-header-bg": page === surface ? tint(base.neutral, hoverOpacity * HEADER_TINT_OF_HOVER) : page,
    /* The header label is a quieter kind of body text, not a heading — same
       role `text.secondary` has, and MUI states that colour as readable on
       both of its background tones. */
    "--dt-header-fg": stringOr(palette?.text?.secondary, base.headerFg),

    "--dt-row-hover": tint(base.neutral, hoverOpacity),
    "--dt-row-stripe": tint(base.neutral, hoverOpacity * STRIPE_TINT_OF_HOVER),
    /* The detail panel is a region the user opened, not a transient state, so
       it takes `selectedOpacity` — the strength MUI states for "this is the
       active one". That is twice its hover, so a MUI theme recesses the panel
       a little further than the base sheet's own #f8f8fa does. */
    "--dt-detail-bg": tint(base.neutral, selectedOpacity),

    "--dt-accent": accent,
    /* Printed ON --dt-accent, which is what `primary.contrastText` is for. A
       hand-written theme that sets `primary.main` and omits this gets the base
       sheet's value, which was tuned against the base sheet's accent — set
       both, or let `createTheme` compute it. */
    "--dt-accent-fg": stringOr(palette?.primary?.contrastText, ACCENT_FG_FALLBACK),
    /* Accent printed AS TEXT on --dt-bg (`.dt-link`, the current choice in a
       header menu). The base sheet keeps this apart from --dt-accent because a
       fill needs 3:1 and text needs 4.5:1, and darkens its own blue to clear
       the stricter bar. No darkening here: `primary.main` IS what MUI prints
       as text on a surface — it is the colour behind `Link` and a text
       `Button` — so copying it inherits MUI's pairing rather than inventing
       one, and a theme whose primary reads as text in the app reads as text
       here for the same reason. */
    "--dt-accent-text": accentText,
    "--dt-resize-handle": stringOr(palette?.divider, base.resizeHandle),

    /* Seam under a pinned column. MUI bakes its shadows into `theme.shadows`
       as whole `box-shadow` strings, with no colour to lift out of them, so
       these stay the base sheet's own — picked per mode, since the theme's
       mode now decides and leaving them to the stylesheet would let a dark OS
       darken the seam under a light MUI table. */
    "--dt-pin-shadow-start": `6px 0 6px -6px rgb(0 0 0 / ${base.shadowAlpha})`,
    "--dt-pin-shadow-end": `-6px 0 6px -6px rgb(0 0 0 / ${base.shadowAlpha})`,

    "--dt-font": stringOr(theme?.typography?.fontFamily, FONT_FALLBACK),
    "--dt-font-size": lengthOr(theme?.typography?.fontSize, FONT_SIZE_FALLBACK),
  }
}
