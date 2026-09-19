import { isFilterValue, type FilterValue } from "./filters"

/**
 * Server-side row grouping: the shapes the wire carries and the small
 * functions every consumer of them needs.
 *
 * Grouping is computed by the host's server, never in the browser. A table
 * holding one page of fifty rows out of a hundred thousand cannot group the
 * other 99 950, and grouping the fifty it has would present a partial answer
 * as if it were the whole table — wrong in a way the user cannot see. So the
 * grouping travels with the query and the host answers it.
 */

/**
 * A group header in the flattened page the server answers with.
 *
 * It carries its identity and its size and nothing else: the value and the
 * count are what the group cell renders — `received (25 000)` — and
 * aggregations (AG Grid's Values zone) are deliberately outside this version.
 *
 * `path` is the key path from the outermost grouping level, so a group at the
 * second level is `["received", "Toshkent Kimyo Zavodi"]`. It is the same
 * shape {@link TableQuery.expanded} carries, which is what identifies a group
 * without a server-minted id and leaves room for a lazy, per-group fetch later.
 *
 * `count` is the number of **leaf** rows beneath it at every depth, not the
 * number of children at the next level down. An outer group's count is
 * therefore the sum of its children's counts, and a user reading
 * `received (25 000)` is being told how many records are in there — the only
 * reading of that number that survives opening the group.
 *
 * `kind` is the discriminant, and `"group"` on a `kind` field is therefore
 * RESERVED: a host whose own rows carry `kind: "group"` would have them
 * rendered as group headers.
 */
export interface GroupRow {
  kind: "group"
  /** The key path identifying this group, outermost first. */
  path: FilterValue[]
  /** How many leaf rows are under it, at every depth. */
  count: number
}

/**
 * Whether a row off a flattened page is a group header rather than a record.
 *
 * Takes `unknown` because it is applied to `row.original`, which the table
 * types as the host's own row: a grouped page carries both kinds in one array
 * and this is the only thing that tells them apart.
 *
 * @param row - One row off a flattened page.
 * @returns Whether it is a group, narrowing it.
 *
 * @example
 * const label = isGroupRow(row) ? `${row.path.at(-1)} (${row.count})` : row.code
 */
export function isGroupRow(row: unknown): row is GroupRow {
  if (typeof row !== "object" || row === null) return false
  const candidate = row as { kind?: unknown; path?: unknown; count?: unknown }
  return (
    candidate.kind === "group" &&
    Array.isArray(candidate.path) &&
    typeof candidate.count === "number"
  )
}

/**
 * The id a group row is keyed by: its key path, joined.
 *
 * `getRowId` has no answer for a group row otherwise — a group is not a record
 * and carries none of the host's fields — and the joined path is also stable
 * across refetches, which is what lets an open group keep its identity when
 * the page is fetched again.
 *
 * Each key is JSON-encoded before it is joined, rather than interpolated
 * directly. A bare join would make `["a/b"]` and `["a", "b"]` the same id — two
 * different groups sharing a React key and an expansion target — and would
 * also collapse the number `1` onto the string `"1"`. Encoding keeps every
 * distinct path distinct at the cost of a pair of quotes nobody sees.
 *
 * @param path - The group's key path, outermost first.
 * @returns A string id, unique among the paths of one grouped table.
 *
 * @example
 * groupRowId(["received", 42]) // '"received"/42'
 */
export function groupRowId(path: readonly FilterValue[]): string {
  return path.map((key) => JSON.stringify(key)).join("/")
}

/**
 * Whether two key paths name the same group.
 *
 * @param a - One path.
 * @param b - The other.
 * @returns Whether they are element-wise identical.
 */
export function pathsEqual(a: readonly FilterValue[], b: readonly FilterValue[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index])
}

/**
 * Whether this exact key path is one of the open ones.
 *
 * Exact, not prefix: a path whose parent is closed names a group that is not
 * on the page at all, and the server leaves it inert rather than opening it.
 * That is what lets a client keep a deep path across a collapse and get the
 * same subtree back when the parent reopens.
 *
 * @param expanded - The open key paths.
 * @param path - The group being asked about.
 * @returns Whether it is open.
 */
export function isPathExpanded(
  expanded: readonly FilterValue[][],
  path: readonly FilterValue[],
): boolean {
  return expanded.some((open) => pathsEqual(open, path))
}

/**
 * Open a closed group, or close an open one.
 *
 * Closing a group drops the paths BENEATH it as well as its own. Left behind,
 * a descendant path is inert while its parent is shut — the server never emits
 * it — but it still travels on every query, and a user who opened a dozen
 * subgroups and shut the parent would go on paying for them in the query
 * string forever. Reopening the parent shows its children closed, which is
 * also what a user who just shut a branch expects to find in it.
 *
 * @param expanded - The open key paths.
 * @param path - The group being toggled.
 * @returns A new array; `expanded` is not modified.
 *
 * @example
 * togglePath([["open"]], ["open"]) // []
 */
export function togglePath(
  expanded: readonly FilterValue[][],
  path: readonly FilterValue[],
): FilterValue[][] {
  if (isPathExpanded(expanded, path)) {
    return normaliseExpanded(
      expanded.filter((open) => !pathsEqual(open.slice(0, path.length), path)),
    )
  }
  return normaliseExpanded([...expanded, [...path]])
}

/**
 * Canonical order for the open paths.
 *
 * `queriesEqual` compares queries by `JSON.stringify`, so array ORDER is as
 * significant as content: opening A then B would otherwise produce a different
 * query from opening B then A, and a host keyed on the query would refetch an
 * identical page. Sorting by the encoded path — the same encoding
 * {@link groupRowId} uses, so outer paths sort beside their own children —
 * makes the array a function of the open set alone. Duplicates are dropped for
 * the same reason.
 *
 * @param expanded - Open key paths in any order.
 * @returns A new array in canonical order, with duplicates removed.
 */
export function normaliseExpanded(expanded: readonly (readonly FilterValue[])[]): FilterValue[][] {
  const byId = new Map<string, FilterValue[]>()
  for (const path of expanded) {
    const id = groupRowId(path)
    if (!byId.has(id)) byId.set(id, [...path])
  }
  return [...byId.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, path]) => path)
}

/**
 * Grouping reduced to columns the table actually defines, with no repeats.
 *
 * The same gate a stored layout, an `initialLayout` and the public setter all
 * go through: a group on a column the table no longer has would travel on
 * every query with nothing on screen able to take it off — the stranded-filter
 * case one slice over — and a column named twice would ask the server to group
 * by it at two depths, where the inner level holds exactly one key.
 *
 * @param grouping - Column ids as they arrived, trusted or not.
 * @param knownColumnIds - Column ids the table currently defines.
 * @returns The grouping, outermost first, with unknown and repeated ids removed.
 */
export function pruneGrouping(
  grouping: unknown,
  knownColumnIds: readonly string[],
): string[] {
  if (!Array.isArray(grouping)) return []
  const known = new Set(knownColumnIds)
  const seen = new Set<string>()
  const pruned: string[] = []
  for (const id of grouping) {
    if (typeof id !== "string" || !known.has(id) || seen.has(id)) continue
    seen.add(id)
    pruned.push(id)
  }
  return pruned
}

/**
 * Open paths reduced to ones a grouping of this depth could name.
 *
 * `expanded` is untrusted JSON wherever it comes from — storage, a URL, a
 * host's own store — so every element is checked before it reaches the wire:
 * a key that is not a {@link FilterValue} cannot travel as JSON, and a path
 * deeper than the grouping names a level that does not exist.
 *
 * @param expanded - Open key paths as they arrived.
 * @param depth - How many levels the grouping has.
 * @returns Canonical, valid paths; empty when the table is not grouped.
 */
export function pruneExpanded(expanded: unknown, depth: number): FilterValue[][] {
  if (depth === 0 || !Array.isArray(expanded)) return []
  const valid: FilterValue[][] = []
  for (const path of expanded) {
    if (!Array.isArray(path) || path.length === 0 || path.length > depth) continue
    if (!path.every(isFilterValue)) continue
    valid.push(path as FilterValue[])
  }
  return normaliseExpanded(valid)
}
