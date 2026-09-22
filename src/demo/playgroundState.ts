import { useSyncExternalStore } from "react"

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
  /**
   * The leading row-number column.
   *
   * The one flag here whose library default is FALSE, and the playground
   * keeps that default rather than showing the table in a state a fresh
   * install is not in.
   */
  rowNumbers: boolean
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
  // False, like the library's own default; see the field's own comment.
  rowNumbers: false,
  filtering: true,
  pagination: true,
  striped: true,
  toolbar: true,
  footer: true,
  virtualize: true,
  stickyHeader: true,
  detailPanel: false,
}

/** What `<DataTable theme>` can be pinned to, plus the "follow the OS" case. */
export type ThemeMode = "light" | "dark" | "system"

/** The two themes `styles.css` actually ships a full set of values for. */
export type ThemeBaseMode = Exclude<ThemeMode, "system">

/**
 * Every value the theme controls can move: one field per `--dt-*` token, plus
 * `rowHeight`, which is not a token at all.
 *
 * `rowHeight` is deliberately here and not a CSS variable: `<DataTable>`
 * writes `--dt-row-height` inline on its own root every render, so a rule on
 * a wrapper around it would always lose. It has to go through the `rowHeight`
 * option instead, which is why {@link TOKEN_NAMES} below has no entry for it.
 */
export interface ThemeTokenValues {
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

/** One field of {@link ThemeTokenValues} — anything the user can move. */
export type ThemeEditableKey = keyof ThemeTokenValues

/**
 * The tokens {@link ThemeControls} edits with a color picker.
 *
 * Declared here rather than inside the control, so the translated labels in
 * `chrome.ts` are keyed by the same union: adding a color to the state without
 * naming it in all three languages becomes a compile error instead of a field
 * that renders with no label.
 */
export type ThemeColorKey = Extract<
  ThemeEditableKey,
  | "background"
  | "foreground"
  | "accent"
  | "accentText"
  | "border"
  | "headerBackground"
  | "headerForeground"
  | "rowHover"
  | "rowStripe"
  | "detailBackground"
>

/** The numeric controls, sliders rather than pickers. Same key-parity reason as {@link ThemeColorKey}. */
export type ThemeSizeKey = Extract<
  ThemeEditableKey,
  "headerHeight" | "rowHeight" | "radius" | "fontSize"
>

/** Which font stack the font-family control is on; the stacks themselves live in {@link ThemeControls}. */
export type FontChoiceKey = "system" | "mono" | "serif" | "sans"

/** The base sheet's `--dt-font` value, shared with the font control's "System UI" choice. */
export const SYSTEM_FONT_STACK = "system-ui, -apple-system, 'Segoe UI', sans-serif"

/** The light defaults, restated from `styles.css`'s own `.dt-root` block. */
const LIGHT_VALUES: ThemeTokenValues = {
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
  fontFamily: SYSTEM_FONT_STACK,
  fontSize: 14,
  rowHeight: 40,
}

/**
 * The dark defaults, restated from `styles.css`'s `[data-dt-theme="dark"]`
 * block (the `prefers-color-scheme: dark` block carries the same values).
 *
 * Only the colours differ between the two themes — sizes, radius and the font
 * are declared once on `.dt-root` and never re-declared — so the rest is
 * spread from {@link LIGHT_VALUES} rather than repeated. `accent` is absent
 * for the same reason: the dark block leaves `--dt-accent` alone and only
 * lightens `--dt-accent-text`.
 *
 * These exist so an untouched picker shows the colour that is actually on
 * screen. They are never emitted as CSS — see {@link themeStyleRule}.
 */
const DARK_VALUES: ThemeTokenValues = {
  ...LIGHT_VALUES,
  background: "#18181b",
  foreground: "#fafafa",
  accentText: "#60a5fa",
  border: "#2e2e33",
  headerBackground: "#1f1f23",
  headerForeground: "#a1a1aa",
  rowHover: "#232327",
  rowStripe: "#1b1b1f",
  detailBackground: "#1c1c20",
}

/** What each base theme starts every token at, before any override. */
export const BASE_THEME_VALUES: Record<ThemeBaseMode, ThemeTokenValues> = {
  light: LIGHT_VALUES,
  dark: DARK_VALUES,
}

/**
 * The theme controls' state: which base theme is picked, and only the tokens
 * the user has actually moved.
 *
 * Storing the overrides rather than a full set of values is what makes the
 * base-theme switch work at all. A full set would have to be emitted in full,
 * and emitting a token the user never touched pins it — which is exactly how
 * the Light/Dark/System control came to be unable to darken anything. Absent
 * from `overrides` means "whatever the base theme says", in the cascade as
 * well as in the picker, so the two can never disagree.
 */
export interface ThemeTokenState {
  theme: ThemeMode
  overrides: Readonly<Partial<ThemeTokenValues>>
}

/** A fresh page, and what "Reset" returns to: follow the OS, override nothing. */
export const DEFAULT_THEME: ThemeTokenState = { theme: "system", overrides: {} }

/** The playground's own class on the table root, {@link themeStyleRule} writes its overrides against. */
export const THEME_CLASS = "pg-theme-vars"

/**
 * The `--dt-*` custom property behind each editable field. `rowHeight` has
 * none — see {@link ThemeTokenValues}.
 *
 * Exported so the drift guard in `playgroundState.test.ts` can compare each
 * default against the declaration it was copied from in `styles.css`, rather
 * than restating the mapping and checking its own copy of it.
 */
export const TOKEN_NAMES: Record<Exclude<ThemeEditableKey, "rowHeight">, string> = {
  background: "--dt-bg",
  foreground: "--dt-fg",
  accent: "--dt-accent",
  accentText: "--dt-accent-text",
  border: "--dt-border",
  headerBackground: "--dt-header-bg",
  headerForeground: "--dt-header-fg",
  headerHeight: "--dt-header-height",
  rowHover: "--dt-row-hover",
  rowStripe: "--dt-row-stripe",
  detailBackground: "--dt-detail-bg",
  radius: "--dt-radius",
  fontFamily: "--dt-font",
  fontSize: "--dt-font-size",
}

/** `Object.keys` erases the key type; the record above is the declaration this restores it from. */
const TOKEN_KEYS = Object.keys(TOKEN_NAMES) as Exclude<ThemeEditableKey, "rowHeight">[]

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)"

/** The OS preference query, or null where there is no `matchMedia` to ask (SSR, older jsdom). */
function darkMedia(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null
  return window.matchMedia(DARK_MEDIA_QUERY)
}

/** Module scope, so `useSyncExternalStore` sees one stable subscribe function. */
function subscribeToOsTheme(onChange: () => void): () => void {
  const media = darkMedia()
  if (!media || typeof media.addEventListener !== "function") return () => {}
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

function readOsPrefersDark(): boolean {
  return darkMedia()?.matches ?? false
}

/** No OS to ask during a server render; the base sheet's own default is light. */
function osPrefersDarkOnServer(): boolean {
  return false
}

/**
 * Which theme the table is actually painted in right now.
 *
 * `"system"` is not a theme the stylesheet has values for — it is the absence
 * of a pinned one, which the OS then resolves. The controls need the resolved
 * answer so an untouched picker shows the colour on screen rather than the
 * light default; subscribing (rather than reading once) is what keeps that
 * true when the OS flips mid-session.
 *
 * @param theme - The base theme the user picked.
 * @returns `"light"` or `"dark"`, never `"system"`.
 *
 * @example
 * const base = useBaseThemeMode(theme.theme)
 * const values = resolveThemeValues(theme, base)
 */
export function useBaseThemeMode(theme: ThemeMode): ThemeBaseMode {
  const prefersDark = useSyncExternalStore(
    subscribeToOsTheme,
    readOsPrefersDark,
    osPrefersDarkOnServer,
  )
  if (theme !== "system") return theme
  return prefersDark ? "dark" : "light"
}

/**
 * What every control should display: the base theme's own value for a token,
 * or the user's override where there is one.
 *
 * @param state - The theme controls' state.
 * @param base - The resolved base theme, from {@link useBaseThemeMode}.
 * @returns A full set of values, with no gaps for a control to fall over.
 *
 * @example
 * resolveThemeValues({ theme: "dark", overrides: {} }, "dark").background // "#18181b"
 */
export function resolveThemeValues(
  state: ThemeTokenState,
  base: ThemeBaseMode,
): ThemeTokenValues {
  return { ...BASE_THEME_VALUES[base], ...state.overrides }
}

/** `38` becomes `38px`; a colour or a font stack is already CSS text. */
function cssValue(value: string | number): string {
  return typeof value === "number" ? `${value}px` : value
}

/**
 * A `<style>` block carrying the tokens the user has actually moved, and
 * nothing else.
 *
 * Two rules decide the selector and the `!important`, and they are separate.
 *
 * The selector: `styles.css` declares every `--dt-*` token directly on
 * `.dt-root` itself — its own docblock says so — which means a token set on an
 * ANCESTOR wrapper is never read: a custom property's used value comes from a
 * declaration matching the element itself before it ever falls back to an
 * inherited one, so `.dt-root`'s own rule wins over a wrapper's inline style
 * regardless of specificity. An override has to match `.dt-root` directly
 * instead — the doubled-class trick the stylesheet's own comment recommends
 * (`.dt-root.dt-root { … }`), which is what `<DataTable className={THEME_CLASS}>`
 * plus this rule produce.
 *
 * The `!important`: `.dt-root[data-dt-theme="dark"]` and the
 * `prefers-color-scheme` variant match at the same `(0,2,0)` specificity as
 * the doubled class, so a plain declaration would only TIE them and be settled
 * by which stylesheet connects last. `!important` makes an edited token hold
 * against the dark theme with no load-order dependency left to reason about.
 *
 * What it must NOT do is emit a token nobody edited. Doing that pinned all
 * fourteen at their light defaults on every render, so Light/Dark/System could
 * not darken the table and an OS-dark viewer got a half-dark one — a white
 * surface still carrying the dark theme's `--dt-muted-fg`, at 2.6:1. An
 * untouched token is simply absent here, and the base theme decides it.
 *
 * @param state - The theme controls' state.
 * @returns CSS text for a `<style>` element, or `""` while nothing is
 *   overridden. Safe to interpolate: a value is either a `#rrggbb` string from
 *   an `<input type="color">`, a number from an `<input type="range">`, or one
 *   of the fixed font stacks the family `<select>` offers — never free text.
 *
 * @example
 * themeStyleRule({ theme: "dark", overrides: { radius: 20 } })
 * // .pg-theme-vars.dt-root {
 * //   --dt-radius: 20px !important;
 * // }
 */
export function themeStyleRule(state: ThemeTokenState): string {
  const declarations = TOKEN_KEYS.flatMap((key) => {
    const value = state.overrides[key]
    return value === undefined ? [] : [`  ${TOKEN_NAMES[key]}: ${cssValue(value)} !important;`]
  })
  if (declarations.length === 0) return ""
  return `.${THEME_CLASS}.dt-root {\n${declarations.join("\n")}\n}`
}
