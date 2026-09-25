import type { DocSection } from "./model"

interface OnThisPageProps {
  /** The section being read; its topics are listed. */
  section: DocSection | undefined
  activeTopicId: string | undefined
}

/**
 * The right-hand list of the current section's topics, shown on wide screens
 * only — below that the sidebar already lists them, and a third column would
 * squeeze the content it indexes.
 *
 * @param props.section - The section whose topics to list.
 * @param props.activeTopicId - The topic being read.
 *
 * @example
 * <OnThisPage section={DOC_SECTIONS[0]} activeTopicId="install" />
 */
export function OnThisPage({ section, activeTopicId }: OnThisPageProps) {
  if (!section) return null

  return (
    <nav className="docs-toc" aria-labelledby="docs-toc-heading">
      <p className="docs-toc-heading" id="docs-toc-heading">
        On this page
      </p>
      <ol>
        {section.topics.map((topic) => (
          <li key={topic.id}>
            <a href={`#${topic.id}`} aria-current={topic.id === activeTopicId ? "location" : undefined}>
              {topic.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
