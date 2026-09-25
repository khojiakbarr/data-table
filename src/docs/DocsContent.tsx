import type { DocSection } from "./model"

/**
 * The page body: each section as an `<h2>` region, each topic as an `<h3>`
 * region under it. Every heading's id is the fragment the sidebar links to,
 * and every heading is itself a link to that fragment, so a reader can copy
 * the address of the paragraph they are on.
 *
 * @param props.sections - The page's sections, in order.
 *
 * @example
 * <DocsContent sections={DOC_SECTIONS} />
 */
export function DocsContent({ sections }: { sections: DocSection[] }) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.id} className="docs-section" aria-labelledby={section.id}>
          <h2 id={section.id} className="docs-h2">
            <a href={`#${section.id}`}>{section.title}</a>
          </h2>
          <p className="docs-summary">{section.summary}</p>
          {section.topics.map(({ id, title, Body }) => (
            <section key={id} className="docs-topic" aria-labelledby={id}>
              <h3 id={id} className="docs-h3">
                <a href={`#${id}`}>{title}</a>
              </h3>
              <Body />
            </section>
          ))}
        </section>
      ))}
    </>
  )
}
