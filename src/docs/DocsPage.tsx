import { useEffect, useMemo } from "react"
import { CHROME } from "../demo/chrome"
import { PlaygroundHeader } from "../demo/PlaygroundHeader"
import { DocsContent } from "./DocsContent"
import { DocsSidebar } from "./DocsSidebar"
import type { DocSection } from "./model"
import { OnThisPage } from "./OnThisPage"
import { DOC_SECTIONS } from "./sections"
import { useActiveHeading } from "./useActiveHeading"

/** Every anchor on the page in document order, and which section each belongs to. */
function indexAnchors(sections: DocSection[]) {
  const ids: string[] = []
  const sectionOf = new Map<string, DocSection>()
  for (const section of sections) {
    ids.push(section.id)
    sectionOf.set(section.id, section)
    for (const topic of section.topics) {
      ids.push(topic.id)
      sectionOf.set(topic.id, section)
    }
  }
  return { ids, sectionOf }
}

/**
 * Scrolls to the fragment in the address once the content exists.
 *
 * The browser tries on load, before React has rendered a single heading, and
 * finds nothing — so a reload of `docs.html#row-selection`, or a link shared
 * from the sidebar, would otherwise land at the top of the page.
 */
function useInitialFragment() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    // Instant, not the page's smooth scrolling: arriving at a link is not a
    // movement the reader asked to watch.
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "instant" })
  }, [])
}

/**
 * The documentation page: the site masthead, a sidebar of sections, the
 * content, and an on-this-page list on wide screens.
 *
 * One static page with fragment links rather than a client-side router:
 * GitHub Pages serves files and has no SPA fallback, so `docs.html#pinning`
 * survives a hard reload where `/docs/pinning` would 404. The content is
 * English, like the README it condenses; only the masthead's link back to the
 * playground is shared with the translated playground chrome.
 *
 * @example
 * createRoot(root).render(<DocsPage />)
 */
export function DocsPage() {
  const { ids, sectionOf } = useMemo(() => indexAnchors(DOC_SECTIONS), [])
  const activeId = useActiveHeading(ids)
  const activeSection = activeId === undefined ? undefined : sectionOf.get(activeId)
  const activeTopicId = activeId !== undefined && activeId !== activeSection?.id ? activeId : undefined
  useInitialFragment()

  return (
    <div className="pg-root docs-root">
      <a className="docs-skip" href="#docs-main">
        Skip to content
      </a>
      <PlaygroundHeader page="docs" chrome={CHROME.en} />
      <div className="docs-layout">
        <DocsSidebar sections={DOC_SECTIONS} activeSectionId={activeSection?.id} activeTopicId={activeTopicId} />
        <main className="docs-main" id="docs-main" tabIndex={-1}>
          <header className="docs-intro">
            <p className="docs-eyebrow">Documentation</p>
            <h1 className="docs-title">A React data table people can rearrange</h1>
            <p className="docs-lede">
              Built on TanStack Table v9. Every rearrangement is a request, not a mutation: the table asks your server
              for a page and asks your code to commit an edit. Start with <a href="#first-table">your first table</a>,
              or open the <a href="./">playground</a> to try every feature against a 100 000-row fake server.
            </p>
          </header>
          <DocsContent sections={DOC_SECTIONS} />
        </main>
        <OnThisPage section={activeSection} activeTopicId={activeTopicId} />
      </div>
    </div>
  )
}
