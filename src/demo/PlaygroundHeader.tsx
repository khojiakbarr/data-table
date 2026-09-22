import { useState } from "react"
import type { ChromeStrings } from "./chrome"
import { LanguageSwitcher } from "./LanguageSwitcher"
import type { Language } from "./playgroundState"

/*
 * The logo lives in `public/assets/`, so its URL depends on the site's `base`
 * — "/" in dev, "/data-table/" in the GitHub Pages build. A hard-coded
 * "/assets/logo.svg" would be left alone by Vite (it only rewrites URLs in
 * HTML attributes and in real module imports, never a JS string literal), so
 * it would work on localhost and 404 on the deployed site. `BASE_URL` is the
 * documented way to address a public asset from JavaScript; a bare `import`
 * cannot be used because Vite refuses to import out of `publicDir`.
 */
const LOGO_URL = `${import.meta.env.BASE_URL}assets/logo.svg`

const GITHUB_URL = "https://github.com/khojiakbarr/data-table"
const NPM_URL = "https://www.npmjs.com/package/@hojiakbar_dev/data-table"

/** The arrow every outbound link carries, so "GitHub" reads as leaving the page. */
function ExternalArrow() {
  return (
    <svg className="pg-link-arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path
        d="M4 2.5h5.5V8M9.2 2.8 2.5 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface PlaygroundHeaderProps {
  language: Language
  onLanguageChange: (next: Language) => void
  chrome: ChromeStrings
}

/**
 * The page's masthead: the mark, the package name, one line saying what the
 * package is, the language switcher and the two links a visitor arriving from
 * a README actually wants.
 *
 * The `<h1>` is the package name and nothing else — the mark beside it is
 * decorative (`alt=""`) so it does not end up read out as part of the name.
 * A mark that fails to load hides itself rather than leaving a broken-image
 * glyph in the one place on the page that has to look finished.
 *
 * @param props.language - The language currently chosen.
 * @param props.onLanguageChange - Called with the newly picked language.
 * @param props.chrome - The page copy for the current language.
 *
 * @example
 * <PlaygroundHeader language={language} onLanguageChange={setLanguage} chrome={chrome} />
 */
export function PlaygroundHeader({ language, onLanguageChange, chrome }: PlaygroundHeaderProps) {
  const [hasLogo, setHasLogo] = useState(true)

  return (
    <header className="pg-header">
      <div className="pg-header-inner">
        <div className="pg-brand">
          <img
            className="pg-logo"
            src={LOGO_URL}
            alt=""
            width={36}
            height={36}
            data-missing={hasLogo ? undefined : ""}
            onError={() => setHasLogo(false)}
          />
          <div className="pg-brand-text">
            {/* The package name is a proper noun — it is not translated. */}
            <h1 className="pg-wordmark">@hojiakbar_dev/data-table</h1>
            <p className="pg-tagline">{chrome.header.tagline}</p>
          </div>
        </div>

        <div className="pg-header-actions">
          <LanguageSwitcher value={language} onChange={onLanguageChange} chrome={chrome} />
          <nav className="pg-links" aria-label={chrome.header.nav}>
            <a className="pg-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              {chrome.header.links.github}
              <ExternalArrow />
            </a>
            <a className="pg-link" href={NPM_URL} target="_blank" rel="noopener noreferrer">
              {chrome.header.links.npm}
              <ExternalArrow />
            </a>
          </nav>
        </div>
      </div>
    </header>
  )
}
