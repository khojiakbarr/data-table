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

/**
 * The site's two pages. Plain files rather than routes — GitHub Pages has no
 * SPA fallback, so a path it cannot find on disk is a 404 on reload. Built
 * from `BASE_URL` for the same reason as {@link LOGO_URL}.
 */
const PAGE_URL: Record<SitePage, string> = {
  playground: import.meta.env.BASE_URL,
  docs: `${import.meta.env.BASE_URL}docs.html`,
}

/** Which page of the site a masthead sits on. */
export type SitePage = "playground" | "docs"

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
  chrome: ChromeStrings
  /**
   * The page this masthead sits on; the header links to the other one.
   * Default `"playground"`.
   */
  page?: SitePage
  /** The language currently chosen. The switcher renders only with both of these. */
  language?: Language
  onLanguageChange?: (next: Language) => void
}

/**
 * The site's masthead: the mark, the package name, one line saying what the
 * package is, the language switcher, a link to the site's other page, and the
 * two links a visitor arriving from a README actually wants.
 *
 * Shared by the playground and the docs so the two read as one site. The docs
 * are English-only and pass no language, so they get no switcher — a control
 * that changed nothing on the page would be a lie.
 *
 * The `<h1>` is the package name and nothing else — the mark beside it is
 * decorative (`alt=""`) so it does not end up read out as part of the name.
 * A mark that fails to load hides itself rather than leaving a broken-image
 * glyph in the one place on the page that has to look finished.
 *
 * @param props.chrome - The page copy for the current language.
 * @param props.page - Which page this is; the header links to the other.
 * @param props.language - The language currently chosen.
 * @param props.onLanguageChange - Called with the newly picked language.
 *
 * @example
 * <PlaygroundHeader language={language} onLanguageChange={setLanguage} chrome={chrome} />
 */
export function PlaygroundHeader({ chrome, page = "playground", language, onLanguageChange }: PlaygroundHeaderProps) {
  const [hasLogo, setHasLogo] = useState(true)
  const otherPage: SitePage = page === "playground" ? "docs" : "playground"

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
          {language !== undefined && onLanguageChange !== undefined && (
            <LanguageSwitcher value={language} onChange={onLanguageChange} chrome={chrome} />
          )}
          <nav className="pg-links" aria-label={chrome.header.nav}>
            <a className="pg-link pg-link-site" href={PAGE_URL[otherPage]}>
              {chrome.header.links[otherPage]}
            </a>
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
