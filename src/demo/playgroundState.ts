/** Which of the three shipped label sets the table renders with. */
export type Language = "en" | "ru" | "uz"

/**
 * Every toggle the playground offers, one field per real option or prop.
 *
 * Kept as one object — rather than one `useState` per toggle — so a reset is
 * a single `setFeatures(DEFAULT_FEATURES)` and a "share this setup" link (were
 * one ever added) would only need to serialise one value.
 */
export interface FeatureState {
  /* `useDataTable({ features })` — `DataTableFeatureFlags`. */
  sorting: boolean
  resizing: boolean
  reordering: boolean
  pinning: boolean
  hiding: boolean
  /* `useDataTable({ filtering, pagination })`. Quick search rides with `filtering`. */
  filtering: boolean
  pagination: boolean
  /* `<DataTable>` props. */
  striped: boolean
  toolbar: boolean
  footer: boolean
  virtualize: boolean
  stickyHeader: boolean
  /** Whether `renderDetail` is passed at all. */
  detailPanel: boolean
}

export const DEFAULT_FEATURES: FeatureState = {
  sorting: true,
  resizing: true,
  reordering: true,
  pinning: true,
  hiding: true,
  filtering: true,
  pagination: true,
  striped: true,
  toolbar: true,
  footer: true,
  virtualize: true,
  stickyHeader: true,
  detailPanel: false,
}

/**
 * Every theme control, one field per `--dt-*` token plus the two things that
 * are not tokens: `theme` (light/dark/system) and `rowHeight`.
 *
 * `rowHeight` is deliberately here and not a CSS variable: `<DataTable>`
 * writes `--dt-row-height` inline on its own root every render, so a rule on
 * a wrapper around it would always lose. It has to go through the
 * `rowHeight` option instead, which is why {@link themeToCssVars} below
 * excludes it from the style object it builds.
 */
export interface ThemeTokenState {
  theme: "light" | "dark" | "system"
  background: string
  foreground: string
  accent: string
  accentText: string
  border: string
  headerBackground: string
  headerForeground: string
  headerHeight: number
  rowHover: string
  rowStripe: string
  detailBackground: string
  radius: number
  fontFamily: string
  fontSize: number
  rowHeight: number
}

/** The light defaults from `styles.css`, restated here so "Reset" has a value to return to. */
export const DEFAULT_THEME: ThemeTokenState = {
  theme: "system",
  background: "#ffffff",
  foreground: "#18181b",
  accent: "#3b82f6",
  accentText: "#1d4ed8",
  border: "#e4e4e7",
  headerBackground: "#fafafa",
  headerForeground: "#52525b",
  headerHeight: 38,
  rowHover: "#f4f4f5",
  rowStripe: "#fcfcfd",
  detailBackground: "#f8f8fa",
  radius: 8,
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontSize: 14,
  rowHeight: 40,
}

/** The playground's own class on the table root, `themeStyleRule` writes its overrides against. */
export const THEME_CLASS = "pg-theme-vars"

/**
 * The `--dt-*` declarations the theme controls currently ask for.
 *
 * Excludes `rowHeight` and `theme` — see the note on {@link ThemeTokenState}
 * for why the first is not a token at all, and `<DataTable theme>` is how the
 * second is applied.
 *
 * @param theme - The current theme controls.
 * @returns CSS custom property name to value, unitted where the token expects one.
 */
function themeTokens(theme: ThemeTokenState): Record<string, string> {
  return {
    "--dt-bg": theme.background,
    "--dt-fg": theme.foreground,
    "--dt-accent": theme.accent,
    "--dt-accent-text": theme.accentText,
    "--dt-border": theme.border,
    "--dt-header-bg": theme.headerBackground,
    "--dt-header-fg": theme.headerForeground,
    "--dt-header-height": `${theme.headerHeight}px`,
    "--dt-row-hover": theme.rowHover,
    "--dt-row-stripe": theme.rowStripe,
    "--dt-detail-bg": theme.detailBackground,
    "--dt-radius": `${theme.radius}px`,
    "--dt-font": theme.fontFamily,
    "--dt-font-size": `${theme.fontSize}px`,
  }
}

/**
 * A `<style>` block that makes the theme controls actually win.
 *
 * `styles.css` declares every `--dt-*` token directly on `.dt-root` itself —
 * its own docblock says so — which means a token set on an ANCESTOR wrapper
 * is never read: a custom property's used value comes from a declaration
 * matching the element itself before it ever falls back to an inherited one,
 * so `.dt-root`'s own rule wins over a wrapper's inline style regardless of
 * specificity. An override has to match `.dt-root` directly instead — the
 * doubled-class trick the stylesheet's own comment recommends
 * (`.dt-root.dt-root { … }`), which is what `<DataTable className={THEME_CLASS}>`
 * plus this rule produce.
 *
 * `!important` is what then beats the dark-theme selectors
 * (`.dt-root[data-dt-theme="dark"]`, and the `prefers-color-scheme` media
 * variant), which already match `.dt-root` at the same doubled specificity —
 * a plain doubled class only outranks the plain light default, not those. The
 * playground's whole point is that every token is live-editable regardless of
 * which base theme is picked, so the override has to hold against both.
 *
 * @param theme - The current theme controls.
 * @returns CSS text for a `<style>` element; safe to interpolate directly —
 *   every value here comes from a `<input type="color">` (always a `#rrggbb`
 *   value) or a numeric `<input type="range">`, never free text.
 */
export function themeStyleRule(theme: ThemeTokenState): string {
  const declarations = Object.entries(themeTokens(theme))
    .map(([name, value]) => `  ${name}: ${value} !important;`)
    .join("\n")
  return `.${THEME_CLASS}.dt-root {\n${declarations}\n}`
}
