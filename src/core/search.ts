import { constructFilterFn } from "@tanstack/react-table"
import { collectColumnFacts, type FilterColumnDefShape, type FilterKindSource } from "./filterKinds"

/**
 * Quick search: which columns it covers, and how a row is matched.
 */

/**
 * Whether quick search covers one column, given what is known about it right now.
 *
 * `meta.searchable` wins outright; with nothing declared the default is "the
 * column's first non-null value is a string or a number". Neither half is
 * TanStack's default: its own heuristic is a gate *underneath* the flags rather
 * than a default a host can override, and it never consults visibility at all —
 * so without this predicate a hidden column would go on being searched
 * client-side while the wire's `fields` omitted it.
 *
 * This always returns a definite boolean, including when `sampleValue` is
 * `undefined` because no sample has been found yet — that case reads as
 * `false` here. A single column in isolation has no better answer to give: it
 * cannot refuse to answer the way {@link collectSearchFields} can, by putting
 * the id in `unresolved` instead of guessing. Prefer that when the caller can
 * act on the distinction; call this directly only once the caller has already
 * decided how an unresolved column should be treated.
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

/** Deterministic, locale-independent id order — mirrors `query.ts`'s `compareIds`. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * {@link collectSearchFields}'s answer: what it could resolve, and what it could not.
 */
export interface SearchFieldsResult {
  /** Leaf column ids known to be searched, sorted. */
  fields: string[]
  /**
   * Visible, accessor-backed leaf ids with no declared `meta.searchable` and
   * no sampled value to infer one from, sorted. Neither in `fields` nor
   * excluded from it — unresolved, not `false`.
   */
  unresolved: string[]
}

/**
 * Every column quick search covers, by id, sorted — and every column this
 * call could not resolve either way.
 *
 * `fields` is a function of the column set, the sampled rows, and visibility
 * *together*, not of the searchable set alone: a column with no declared
 * `meta.searchable` needs a sampled value to infer a type from, and the
 * sample comes from `rows`. In server mode `rows` is only the page currently
 * held in memory, so a nullable text column that happens to be null across
 * the sampled rows of one page — `filterKinds.ts`'s `SAMPLE_ROWS` caps how
 * many rows are looked at — and not another would have no stable answer if
 * this function had to guess one.
 *
 * It does not guess. Exactly as {@link collectFilterKinds} omits a column it
 * cannot resolve rather than defaulting it to `"text"`, an id with nothing
 * declared and no sample comes back in `unresolved` instead of being folded
 * into `fields` as `false`. Folding it into `false` — this function's
 * original behaviour — reads "no evidence yet" as "definitely not
 * searchable": on a first render with no rows at all, every unmeta'd column
 * would be excluded and `fields` would come back empty even though every
 * column is perfectly capable of holding text. Folding it into `true` would
 * be just as wrong the other way, matching a Date or boolean column whenever
 * its sample happened to be empty.
 *
 * A caller that must end up with a flat, definite list — `search.fields` on
 * the wire, or `getColumnCanGlobalFilter` — decides what to do with
 * `unresolved` itself: keep including an id while it stays unresolved (until
 * a `firstNonNull` sample can be found), or, especially in server mode where
 * the sample changes page to page, prefer `filtering.searchFields` so
 * inference is bypassed for those columns entirely.
 *
 * @param columns - Column definitions, possibly nested.
 * @param rows - The data, or the page of it the table is holding.
 * @param visibility - TanStack's visibility state; an absent id is visible.
 * @returns `fields` and `unresolved`, each sorted.
 */
export function collectSearchFields<TData>(
  columns: readonly FilterColumnDefShape<TData>[],
  rows: readonly TData[],
  visibility: Record<string, boolean>,
): SearchFieldsResult {
  const fields: string[] = []
  const unresolved: string[] = []
  for (const [id, facts] of collectColumnFacts(columns, rows)) {
    const visible = visibility[id] ?? true
    if (!facts.hasAccessor || !visible) continue
    // Same "nothing declared, nothing sampled" check `collectFilterKinds` uses
    // to skip rather than guess — see the JSDoc above for why folding this
    // into either `true` or `false` would be wrong.
    if (facts.meta?.searchable === undefined && facts.sampleValue === undefined) {
      unresolved.push(id)
      continue
    }
    if (isSearchableColumn(facts, visible)) fields.push(id)
  }
  return { fields: fields.sort(compareIds), unresolved: unresolved.sort(compareIds) }
}

/** The search text with its per-filter work done: lower-cased, split. */
export interface SearchNeedle {
  tokens: string[]
}

/**
 * Split the search text into the tokens a row must satisfy.
 *
 * @param text - Whatever `state.globalFilter` holds.
 * @returns The lower-cased, non-empty tokens.
 */
export function searchNeedle(text: unknown): SearchNeedle {
  return {
    tokens: String(text ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token !== ""),
  }
}

/** One column value as searchable text. */
function valueText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).toLowerCase()
}

/** The leaf columns a table is currently searching. */
interface SearchableTable {
  getAllLeafColumns: () => Array<{ id: string; getCanGlobalFilter: () => boolean }>
}

/** One row plus the table it belongs to: everything the search predicate reads. */
interface SearchableRow {
  table: SearchableTable
  getValue: (columnId: string) => unknown
}

/*
 * The field list, cached against the needle the table resolved it for.
 *
 * Every needle is built before any row is tested — TanStack resolves the
 * filter value up front, once per globally-filterable column — so this
 * computes the list once per searchable column per filtering pass instead of
 * once per row. Keyed on the needle rather than on the table so a stale list
 * can never outlive the pass that built it, and weakly so neither is held
 * alive by the cache.
 */
const fieldsByNeedle = new WeakMap<SearchNeedle, readonly string[]>()

/**
 * Which ids to read off a row.
 *
 * Read from the table rather than closed over, so this list and the table's own
 * `getColumnCanGlobalFilter` can never disagree about which columns are being
 * searched — they are the same answer, asked once.
 */
function searchFieldsFor(needle: SearchNeedle, row: SearchableRow): readonly string[] {
  const cached = fieldsByNeedle.get(needle)
  if (cached !== undefined) return cached
  const fields = row.table
    .getAllLeafColumns()
    .filter((column) => column.getCanGlobalFilter())
    .map((column) => column.id)
  fieldsByNeedle.set(needle, fields)
  return fields
}

/**
 * Whether every token appears somewhere in the searched fields of one row.
 *
 * @param row - The row under test.
 * @param needle - The resolved search text.
 * @returns Whether the row matches.
 */
export function rowMatchesSearch(row: SearchableRow, needle: SearchNeedle): boolean {
  if (needle.tokens.length === 0) return true
  const fields = searchFieldsFor(needle, row)
  const haystack = fields.map((id) => valueText(row.getValue(id)))
  return needle.tokens.every((token) => haystack.some((value) => value.includes(token)))
}

/**
 * The library's global filter function.
 *
 * A **row-level** predicate: the table calls it once per searchable column with
 * that column's id and ORs the results, breaking on the first `true`, so a
 * per-column function could never express "every token must appear somewhere,
 * and different tokens may appear in different columns". This one ignores the
 * column id it is handed and reads every searched field off the row itself,
 * returning the same verdict whichever column it was asked about.
 *
 * Tokenising happens in `resolveFilterValue`, which the table applies ahead of
 * the row loop — once per searchable column — rather than once per row.
 */
export const filterFn_dtSearch = constructFilterFn({
  resolveFilterValue: (text: unknown): SearchNeedle => searchNeedle(text),
  filter: (_dataValue: unknown, needle: SearchNeedle, row) => rowMatchesSearch(row, needle),
})
