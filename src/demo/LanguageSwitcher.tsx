import type { Language } from "./playgroundState"

const CHOICES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
  { value: "uz", label: "Oʻzbekcha" },
]

interface LanguageSwitcherProps {
  value: Language
  onChange: (next: Language) => void
}

/**
 * Switches which of the three shipped {@link DataTableLabels} sets — English,
 * `ruLabels`, `uzLabels` — the table renders with.
 *
 * A radio group rather than a `<select>`: three mutually exclusive choices,
 * always all visible, is exactly what radios are for, and every choice stays
 * one Tab stop plus arrow keys away instead of a click to open first.
 *
 * @example
 * <LanguageSwitcher value={language} onChange={setLanguage} />
 */
export function LanguageSwitcher({ value, onChange }: LanguageSwitcherProps) {
  return (
    <fieldset className="pg-language" aria-label="Table language">
      <legend>Language</legend>
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
