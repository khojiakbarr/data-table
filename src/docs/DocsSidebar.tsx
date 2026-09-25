import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import type { DocSection } from "./model"

interface DocsSidebarProps {
  sections: DocSection[]
  /** The section and topic being read, for `aria-current`. */
  activeSectionId: string | undefined
  activeTopicId: string | undefined
}

/**
 * The docs navigation: every section and every topic, as plain links.
 *
 * Plain in-page links on purpose — each one is a Tab stop, opens in a new tab
 * with a modifier, and can be copied as a URL that survives a reload, which a
 * JavaScript router on GitHub Pages could not promise. The current section and
 * topic carry `aria-current="location"`, the value meant for "where you are
 * within a page".
 *
 * Below the wide layout the list folds behind a "Contents" button, which
 * closes again once a link is followed so the reader lands on the content
 * rather than on an open menu. Opening it scrolls the current topic into
 * view inside the list; Escape closes it and returns focus to the button.
 *
 * @param props.sections - The page's sections, in order.
 * @param props.activeSectionId - The section being read.
 * @param props.activeTopicId - The topic being read.
 *
 * @example
 * <DocsSidebar sections={DOC_SECTIONS} activeSectionId="features" activeTopicId="pinning" />
 */
export function DocsSidebar({ sections, activeSectionId, activeTopicId }: DocsSidebarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const handleFollow = () => setIsOpen(false)

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !isOpen) return
    setIsOpen(false)
    toggleRef.current?.focus()
  }

  // A 40-row list opened at its top would hide where the reader is.
  useEffect(() => {
    if (!isOpen) return
    listRef.current?.querySelector('[aria-current="location"]')?.scrollIntoView({ block: "nearest" })
  }, [isOpen])

  return (
    <nav
      className="docs-sidebar"
      aria-label="Documentation"
      data-open={isOpen ? "" : undefined}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={toggleRef}
        type="button"
        className="docs-sidebar-toggle"
        aria-expanded={isOpen}
        aria-controls="docs-sidebar-list"
        onClick={() => setIsOpen((open) => !open)}
      >
        Contents
      </button>
      <ol className="docs-sidebar-list" id="docs-sidebar-list" ref={listRef}>
        {sections.map((section) => (
          <li key={section.id}>
            <a
              className="docs-sidebar-section"
              href={`#${section.id}`}
              aria-current={section.id === activeSectionId ? "location" : undefined}
              onClick={handleFollow}
            >
              {section.title}
            </a>
            <ol className="docs-sidebar-topics">
              {section.topics.map((topic) => (
                <li key={topic.id}>
                  <a
                    className="docs-sidebar-topic"
                    href={`#${topic.id}`}
                    aria-current={topic.id === activeTopicId ? "location" : undefined}
                    onClick={handleFollow}
                  >
                    {topic.title}
                  </a>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </nav>
  )
}
