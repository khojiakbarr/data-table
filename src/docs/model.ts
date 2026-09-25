import type { ComponentType } from "react"

/**
 * One topic inside a docs section: an `<h3>` and the prose under it.
 *
 * The sidebar, the on-this-page list and the page body are all drawn from
 * these objects, so a heading and the link to it cannot disagree about its
 * id or its wording.
 */
export interface DocTopic {
  /** The fragment the topic lives at — `docs.html#<id>`. Unique across the page. */
  id: string
  title: string
  Body: ComponentType
}

/** A top-level docs section: an `<h2>`, a one-line summary and its topics. */
export interface DocSection {
  id: string
  title: string
  /** One sentence under the heading saying what the section answers. */
  summary: string
  topics: DocTopic[]
}
