import type { DocSection } from "../model"
import { accessibility } from "./accessibility"
import { apiReference } from "./apiReference"
import { columnTopics } from "./featureColumns"
import { interactionTopics } from "./featureInteractions"
import { rowTopics } from "./featureRows"
import { gettingStarted } from "./gettingStarted"
import { labels } from "./labels"
import { serverSide } from "./serverSide"
import { styling } from "./styling"

const features: DocSection = {
  id: "features",
  title: "Features",
  summary: "Columns people can rearrange, rows they can select, number, total, edit and expand.",
  topics: [...columnTopics, ...rowTopics, ...interactionTopics],
}

/**
 * The whole docs page, in reading order.
 *
 * The sidebar, the on-this-page list and the body are all rendered from this
 * one array, so adding a topic here is the only step there is.
 */
export const DOC_SECTIONS: DocSection[] = [
  gettingStarted,
  serverSide,
  features,
  styling,
  labels,
  accessibility,
  apiReference,
]
