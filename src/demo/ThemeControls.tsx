import type { ChangeEvent } from "react"
import type { ChromeStrings } from "./chrome"
import {
  DEFAULT_THEME,
  type FontChoiceKey,
  type ThemeColorKey,
  type ThemeSizeKey,
  type ThemeTokenState,
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
  // Row height is not a CSS token — see the note on `ThemeTokenState` — but it
  // belongs next to the other size controls, not in a section of its own.
  { key: "rowHeight", min: 28, max: 72 },
  { key: "radius", min: 0, max: 24 },
  { key: "fontSize", min: 11, max: 20 },
]

/** The CSS font stack behind each named choice. The names themselves are translated. */
const FONT_STACKS: Record<FontChoiceKey, string> = {
  system: DEFAULT_THEME.fontFamily,
  mono: "'IBM Plex Mono', ui-monospace, monospace",
  serif: "Georgia, 'Times New Roman', serif",
  sans: "'Inter', 'Segoe UI', sans-serif",
}

const FONT_KEYS = Object.keys(FONT_STACKS) as FontChoiceKey[]

/** The three values `<DataTable theme>` understands, plus the "follow the OS" case. */
const THEME_MODES: ThemeTokenState["theme"][] = ["light", "dark", "system"]

interface ThemeControlsProps {
  value: ThemeTokenState
  onChange: (next: ThemeTokenState) => void
  chrome: ChromeStrings
}

/**
 * Every theme control: the light/dark/system switch, one color picker per
 * `--dt-*` color token, one slider per numeric token (plus `rowHeight`, which
 * is not a token — see `ThemeTokenState`), and a font-family choice.
 *
 * Deliberately has no "Export CSS" button — the playground's author decided
 * against one; copying a value out of a color picker is enough for trying a
 * look, and a real integration sets its tokens in a stylesheet, not by
 * scraping a demo page.
 *
 * @param props.value - The whole theme state, as one object.
 * @param props.onChange - Called with a new state object; the old one is never mutated.
 * @param props.chrome - The page copy for the current language.
 *
 * @example
 * <ThemeControls value={theme} onChange={setTheme} chrome={CHROME[language]} />
 */
export function ThemeControls({ value, onChange, chrome }: ThemeControlsProps) {
  const setColor = (key: ThemeColorKey) => (event: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: event.target.value })
  const setNumber = (key: ThemeSizeKey) => (event: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: Number(event.target.value) })

  return (
    <div className="pg-controls" aria-label={chrome.theme.groupLabel}>
      <fieldset className="pg-fieldset">
        <legend>{chrome.theme.legends.appearance}</legend>
        <label className="pg-field">
          <span>{chrome.theme.appearance}</span>
          <select
            value={value.theme}
            onChange={(event) =>
              onChange({ ...value, theme: event.target.value as ThemeTokenState["theme"] })
            }
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
            value={value.fontFamily}
            onChange={(event) => onChange({ ...value, fontFamily: event.target.value })}
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
            <input type="color" value={value[key]} onChange={setColor(key)} />
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
                {value[field.key]}px
              </span>
            </span>
            <input
              type="range"
              min={field.min}
              max={field.max}
              value={value[field.key]}
              onChange={setNumber(field.key)}
            />
          </label>
        ))}
      </fieldset>

      <button type="button" className="pg-reset" onClick={() => onChange(DEFAULT_THEME)}>
        {chrome.theme.reset}
      </button>
    </div>
  )
}
