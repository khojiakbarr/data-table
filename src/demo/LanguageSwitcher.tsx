import type { ChromeStrings } from "./chrome"
import type { Language } from "./playgroundState"

/**
 * The three choices, each written in its own language.
 *
 * Endonyms on purpose: a language picker that renames the languages every time
 * you change language is how you get stuck in one you cannot read. "Русский"
 * stays "Русский" whatever the page is currently set to.
 */
const CHOICES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
  { value: "uz", label: "Oʻzbekcha" },
]

interface LanguageSwitcherProps {
  value: Language
  onChange: (next: Language) => void
  chrome: ChromeStrings
}

/**
 * Switches which of the three shipped `DataTableLabels` sets — English,
 * `ruLabels`, `uzLabels` — the table renders with, and which language the
 * page's own chrome speaks.
 *
 * A radio group rather than a `<select>`: three mutually exclusive choices,
 * always all visible, is exactly what radios are for, and every choice stays
 * one Tab stop plus arrow keys away instead of a click to open first.
 *
 * @param props.value - The language currently chosen.
 * @param props.onChange - Called with the newly picked language.
 * @param props.chrome - The page copy for {@link LanguageSwitcherProps.value}.
 *
 * @example
 * <LanguageSwitcher value={language} onChange={setLanguage} chrome={CHROME[language]} />
 */
export function LanguageSwitcher({ value, onChange, chrome }: LanguageSwitcherProps) {
  return (
    <fieldset className="pg-language" aria-label={chrome.language.groupLabel}>
      <legend>{chrome.language.legend}</legend>
      {CHOICES.map((choice) => (
        <label key={choice.value} className="pg-language-option">
          <input
            type="radio"
            name="pg-language"
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
          {choice.label}
        </label>
      ))}
    </fieldset>
  )
}
