import { collectColumnFacts, type FilterColumnDefShape, type FilterKindSource } from "./filterKinds"

/**
 * Quick search: which columns it covers, and how a row is matched.
 */

/**
 * Whether quick search covers one column.
 *
 * `meta.searchable` wins outright; with nothing declared the default is "the
 * column's first non-null value is a string or a number". Neither half is
 * TanStack's default: its own heuristic is a gate *underneath* the flags rather
 * than a default a host can override, and it never consults visibility at all —
 * so without this predicate a hidden column would go on being searched
 * client-side while the wire's `fields` omitted it.
 *
 * @param facts - The column's meta, accessor and sample value.
 * @param visible - Whether the column is currently rendered.
 * @returns Whether the column is searched.
 */
export function isSearchableColumn(facts: FilterKindSource, visible: boolean): boolean {
  if (!facts.hasAccessor || !visible) return false
  const declared = facts.meta?.searchable
  if (declared !== undefined) return declared
  return typeof facts.sampleValue === "string" || typeof facts.sampleValue === "number"
}

/**
 * Every column quick search covers, by id, sorted.
 *
 * Sorted here as well as in `buildQuery`, so the list is a function of the
 * searchable set alone: dragging a column into a new position must not change
 * `search.fields` and make a host refetch an identical result set.
 *
 * @param columns - Column definitions, possibly nested.
 * @param rows - The data, or the page of it the table is holding.
 * @param visibility - TanStack's visibility state; an absent id is visible.
 * @returns Leaf column ids, sorted.
 */
export function collectSearchFields<TData>(
  columns: readonly FilterColumnDefShape<TData>[],
  rows: readonly TData[],
  visibility: Record<string, boolean>,
): string[] {
  const fields: string[] = []
  for (const [id, facts] of collectColumnFacts(columns, rows)) {
    if (isSearchableColumn(facts, visibility[id] ?? true)) fields.push(id)
  }
  return fields.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
