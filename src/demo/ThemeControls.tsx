import type { ChangeEvent } from "react"
import type { ChromeStrings } from "./chrome"
import {
  DEFAULT_THEME,
  SYSTEM_FONT_STACK,
  type FontChoiceKey,
  type ThemeColorKey,
  type ThemeMode,
  type ThemeSizeKey,
  type ThemeTokenState,
  type ThemeTokenValues,
} from "./playgroundState"

/** The colour tokens, in the order they read best — surface first, then chrome. */
const COLOR_FIELDS: ThemeColorKey[] = [
  "background",
  "foreground",
  "accent",
  "accentText",
  "border",
  "headerBackground",
  "headerForeground",
  "rowHover",
  "rowStripe",
  "detailBackground",
]

/** One numeric token and the range a slider may move it over. */
interface NumberFieldDef {
  key: ThemeSizeKey
  min: number
  max: number
}

const NUMBER_FIELDS: NumberFieldDef[] = [
  { key: "headerHeight", min: 28, max: 64 },
  // Row height is not a CSS token — see the note on `ThemeTokenValues` — but it
  // belongs next to the other size controls, not in a section of its own.
  { key: "rowHeight", min: 28, max: 72 },
  { key: "radius", min: 0, max: 24 },
  { key: "fontSize", min: 11, max: 20 },
]

/** The CSS font stack behind each named choice. The names themselves are translated. */
const FONT_STACKS: Record<FontChoiceKey, string> = {
  system: SYSTEM_FONT_STACK,
  mono: "'IBM Plex Mono', ui-monospace, monospace",
  serif: "Georgia, 'Times New Roman', serif",
  sans: "'Inter', 'Segoe UI', sans-serif",
}

const FONT_KEYS = Object.keys(FONT_STACKS) as FontChoiceKey[]

/** The three values `<DataTable theme>` understands, plus the "follow the OS" case. */
const THEME_MODES: ThemeMode[] = ["light", "dark", "system"]

interface ThemeControlsProps {
  /** What the user has changed: the base theme, and the tokens they have moved. */
  value: ThemeTokenState
  /** What every control displays — `value`'s overrides over the base theme's own defaults. */
  resolved: ThemeTokenValues
  onChange: (next: ThemeTokenState) => void
  /**
   * The table's current height in pixels.
   *
   * Not a theme token: it is the library's own layout slice, read straight
   * off `instance.tableHeight` so this field and the grip on the table's
   * bottom edge show — and write — exactly one value.
   */
  tableHeight: number
  /** The shortest the table may be, so the field cannot ask for less. */
  minTableHeight: number
  onTableHeightChange: (pixels: number) => void
  chrome: ChromeStrings
}

/**
 * Every theme control: the light/dark/system switch, one color picker per
 * `--dt-*` color token, one slider per numeric token (plus `rowHeight`, which
 * is not a token — see `ThemeTokenValues`), and a font-family choice.
 *
 * Deliberately has no "Export CSS" button — the playground's author decided
 * against one; copying a value out of a color picker is enough for trying a
 * look, and a real integration sets its tokens in a stylesheet, not by
 * scraping a demo page.
 *
 * A control the user has not touched shows the base theme's own value and
 * writes nothing to the page: only a moved token becomes an override, which is
 * what leaves the Light/Dark switch free to move everything else.
 *
 * @param props.value - The base theme and the overrides, as one object.
 * @param props.resolved - The values to display, from `resolveThemeValues`.
 * @param props.onChange - Called with a new state object; the old one is never mutated.
 * @param props.tableHeight - The table's height in pixels, from `instance.tableHeight`.
 * @param props.minTableHeight - The shortest the table may be.
 * @param props.onTableHeightChange - Writes a typed height back to the same layout slice the grip writes.
 * @param props.chrome - The page copy for the current language.
 *
 * @example
 * <ThemeControls value={theme} resolved={values} onChange={setTheme} chrome={CHROME[language]} />
 */
export function ThemeControls({
  value,
  resolved,
  onChange,
  tableHeight,
  minTableHeight,
  onTableHeightChange,
  chrome,
}: ThemeControlsProps) {
  const setColor = (key: ThemeColorKey) => (event: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, overrides: { ...value.overrides, [key]: event.target.value } })
  const setNumber = (key: ThemeSizeKey) => (event: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, overrides: { ...value.overrides, [key]: Number(event.target.value) } })

  return (
    <div className="pg-controls" aria-label={chrome.theme.groupLabel}>
      <fieldset className="pg-fieldset">
        <legend>{chrome.theme.legends.appearance}</legend>
        <label className="pg-field">
          <span>{chrome.theme.appearance}</span>
          <select
            value={value.theme}
            onChange={(event) => onChange({ ...value, theme: event.target.value as ThemeMode })}
          >
            {THEME_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {chrome.theme.modes[mode]}
              </option>
            ))}
          </select>
        </label>
        <label className="pg-field">
          <span>{chrome.theme.fontFamily}</span>
          <select
            value={resolved.fontFamily}
            onChange={(event) =>
              onChange({ ...value, overrides: { ...value.overrides, fontFamily: event.target.value } })
            }
          >
            {FONT_KEYS.map((key) => (
              <option key={key} value={FONT_STACKS[key]}>
                {chrome.theme.fonts[key]}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className="pg-fieldset">
        <legend>{chrome.theme.legends.colors}</legend>
        {COLOR_FIELDS.map((key) => (
          <label key={key} className="pg-field pg-field-color">
            <span>{chrome.theme.colors[key]}</span>
            <input type="color" value={resolved[key]} onChange={setColor(key)} />
          </label>
        ))}
      </fieldset>

      <fieldset className="pg-fieldset">
        <legend>{chrome.theme.legends.sizing}</legend>
        {NUMBER_FIELDS.map((field) => (
          <label key={field.key} className="pg-field pg-field-range">
            <span>
              {chrome.theme.sizes[field.key]}{" "}
              {/*
                A plain span, and hidden from assistive tech, for two reasons.
                `<output>` is a labelable element, so as the first one inside
                this `<label>` it takes the label for itself and leaves the
                slider with no accessible name at all. And a range input
                already announces its own value through `aria-valuenow`, so
                repeating it in the name would have a screen reader say the
                number twice.
              */}
              <span className="pg-readout" aria-hidden="true">
                {resolved[field.key]}px
              </span>
            </span>
            <input
              type="range"
              min={field.min}
              max={field.max}
              value={resolved[field.key]}
              onChange={setNumber(field.key)}
            />
          </label>
        ))}

        {/*
          A number field rather than a slider: the height is the one size here
          with no useful upper bound to lay a track out over, and typing an
          exact figure is the reason this control exists beside the grip.
          Empty and malformed input are dropped rather than coerced — `Number("")`
          is 0, which would collapse the table on the way to typing "600".
        */}
        <label className="pg-field">
          <span>{chrome.theme.tableHeight}</span>
          <input
            type="number"
            min={minTableHeight}
            step={10}
            value={tableHeight}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (event.target.value !== "" && Number.isFinite(next)) onTableHeightChange(next)
            }}
          />
        </label>
      </fieldset>

      <button type="button" className="pg-reset" onClick={() => onChange(DEFAULT_THEME)}>
        {chrome.theme.reset}
      </button>
    </div>
  )
}
