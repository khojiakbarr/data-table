import type { ChangeEvent } from "react"
import { DEFAULT_THEME, type ThemeTokenState } from "./playgroundState"

/** One `--dt-*` color token, editable with a native color picker. */
interface ColorFieldDef {
  key: Extract<
    keyof ThemeTokenState,
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
  label: string
}

const COLOR_FIELDS: ColorFieldDef[] = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Foreground" },
  { key: "accent", label: "Accent" },
  { key: "accentText", label: "Accent text" },
  { key: "border", label: "Border" },
  { key: "headerBackground", label: "Header background" },
  { key: "headerForeground", label: "Header foreground" },
  { key: "rowHover", label: "Row hover" },
  { key: "rowStripe", label: "Row stripe" },
  { key: "detailBackground", label: "Detail background" },
]

/** One numeric token, editable with a range slider. */
interface NumberFieldDef {
  key: Extract<keyof ThemeTokenState, "headerHeight" | "radius" | "fontSize" | "rowHeight">
  label: string
  min: number
  max: number
}

const NUMBER_FIELDS: NumberFieldDef[] = [
  { key: "headerHeight", label: "Header height", min: 28, max: 64 },
  // Row height is not a CSS token — see the note on `ThemeTokenState` — but it
  // belongs next to the other size controls, not in a section of its own.
  { key: "rowHeight", label: "Row height", min: 28, max: 72 },
  { key: "radius", label: "Corner radius", min: 0, max: 24 },
  { key: "fontSize", label: "Font size", min: 11, max: 20 },
]

const FONT_CHOICES: { value: string; label: string }[] = [
  { value: DEFAULT_THEME.fontFamily, label: "System UI" },
  { value: "'IBM Plex Mono', ui-monospace, monospace", label: "Monospace" },
  { value: "Georgia, 'Times New Roman', serif", label: "Serif" },
  { value: "'Inter', 'Segoe UI', sans-serif", label: "Inter-ish sans" },
]

interface ThemeControlsProps {
  value: ThemeTokenState
  onChange: (next: ThemeTokenState) => void
}

/**
 * Every theme control: the light/dark/system switch, one color picker per
 * `--dt-*` color token, one slider per numeric token (plus `rowHeight`, which
 * is not a token — see {@link ThemeTokenState}), and a font-family choice.
 *
 * Deliberately has no "Export CSS" button — the playground's author decided
 * against one; copying a value out of a color picker is enough for trying a
 * look, and a real integration sets its tokens in a stylesheet, not by
 * scraping a demo page.
 *
 * @example
 * <ThemeControls value={theme} onChange={setTheme} />
 */
export function ThemeControls({ value, onChange }: ThemeControlsProps) {
  const setColor = (key: ColorFieldDef["key"]) => (event: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: event.target.value })
  const setNumber = (key: NumberFieldDef["key"]) => (event: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: Number(event.target.value) })

  return (
    <div className="pg-controls" aria-label="Theme tokens">
      <fieldset className="pg-fieldset">
        <legend>Theme</legend>
        <label className="pg-field">
          <span>Appearance</span>
          <select
            value={value.theme}
            onChange={(event) =>
              onChange({ ...value, theme: event.target.value as ThemeTokenState["theme"] })
            }
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </label>
        <label className="pg-field">
          <span>Font family</span>
          <select value={value.fontFamily} onChange={(event) => onChange({ ...value, fontFamily: event.target.value })}>
            {FONT_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className="pg-fieldset">
        <legend>Colors</legend>
        {COLOR_FIELDS.map((field) => (
          <label key={field.key} className="pg-field pg-field-color">
            <span>{field.label}</span>
            <input type="color" value={value[field.key]} onChange={setColor(field.key)} />
          </label>
        ))}
      </fieldset>

      <fieldset className="pg-fieldset">
        <legend>Sizing</legend>
        {NUMBER_FIELDS.map((field) => (
          <label key={field.key} className="pg-field pg-field-range">
            <span>
              {field.label} <output>{value[field.key]}px</output>
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
        Reset theme
      </button>
    </div>
  )
}
