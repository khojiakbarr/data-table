import type { SortingState } from "@tanstack/react-table"
import { columnLabel } from "./columnLabel"

/**
 * The sort control cards draw in the rail (0.17.0): which columns it offers,
 * what a choice makes of the sorting, and what its button says.
 *
 * Cards draw no header, so the header's sort button is not there to press.
 * The control writes the table's own sorting — the state a header click
 * writes — so everything that follows a sort (the query a server host is
 * handed, the first page, the cards starting over, the saved layout, the
 * arrows once the table is drawn again) follows this one too.
 */

/** One leaf column as the control sees it: plain data, read off TanStack's column by the caller. */
export interface CardSortColumn {
  id: string
  /** `columnDef.header` — text or a render function. */
  header: unknown
  /** `columnDef.meta.label`, the name of a column whose header is drawn. */
  label?: string | undefined
  /** `column.getCanSort()`. */
  canSort: boolean
}

/** A column the control offers. */
export interface CardSortOption {
  id: string
  label: string
}

/**
 * What the user picked in the control's menu: a column, a direction, or no sorting.
 */
export type CardSortChoice = { column: string } | { desc: boolean } | "clear"

/** What the control's button names: the column sorted first, its direction, and how many more follow it. */
export interface CardSortSummary {
  id: string
  label: string
  desc: boolean
  /** Further columns of a sort by several (a header's Shift+click), not named on the button. */
  more: number
}

/**
 * The columns the control offers, in column order, each by its name.
 *
 * @param columns - The columns shown, in order.
 * @returns Every one of them that can sort; empty when none can, and the control is then not drawn.
 *
 * @example
 * cardSortOptions([{ id: "expiry", header: "Expiry", canSort: true }]) // [{ id: "expiry", label: "Expiry" }]
 */
export function cardSortOptions(columns: readonly CardSortColumn[]): CardSortOption[] {
  return columns
    .filter((column) => column.canSort)
    .map((column) => ({ id: column.id, label: columnLabel(column.id, column.header, column.label) }))
}

/**
 * The sorting a choice in the control makes.
 *
 * The control sorts by one column. A column chosen keeps the direction the
 * sort already had (ascending when there was none); a direction chosen turns
 * the column sorted first; a sort by several columns becomes a sort by the one
 * the choice is about.
 *
 * @param current - The table's sorting now.
 * @param choice - What was picked.
 * @returns The new sorting; `current` itself when a direction is picked with nothing sorted.
 *
 * @example
 * nextCardSorting([{ id: "expiry", desc: true }], { column: "left" }) // [{ id: "left", desc: true }]
 */
export function nextCardSorting(current: SortingState, choice: CardSortChoice): SortingState {
  if (choice === "clear") return []
  const first = current[0]
  if ("column" in choice) return [{ id: choice.column, desc: first?.desc ?? false }]
  if (first === undefined) return current
  return [{ id: first.id, desc: choice.desc }]
}

/**
 * What the control's button names.
 *
 * @param sorting - The table's sorting.
 * @param labelOf - A column's name by its id — any leaf column, so a sort by a hidden one is still named.
 * @returns The first sorted column with its direction, or `undefined` while nothing is sorted.
 *
 * @example
 * cardSortSummary([{ id: "expiry", desc: false }], () => "Expiry") // { id: "expiry", label: "Expiry", desc: false, more: 0 }
 */
export function cardSortSummary(
  sorting: SortingState,
  labelOf: (id: string) => string,
): CardSortSummary | undefined {
  const first = sorting[0]
  if (first === undefined) return undefined
  return { id: first.id, label: labelOf(first.id), desc: first.desc, more: sorting.length - 1 }
}
