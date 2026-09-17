import { constructFilterFn } from "@tanstack/react-table"
import { collectColumnFacts, type FilterColumnDefShape, type FilterKindSource } from "./filterKinds"

/**
 * Quick search: which columns it covers, and how a row is matched.
 */

/**
 * Whether quick search covers one column, given what is known about it right now.
 *
 * `enableGlobalFilter: false` wins outright, ahead of everything else: TanStack's
 * own `column_getCanGlobalFilter` ANDs `columnDef.enableGlobalFilter ?? true`
 * into the client's verdict regardless of what this library's own gate says, so
 * a column that opted out that way can never actually be searched client-side —
 * this function has to agree, or `search.fields` on the wire would claim a
 * column the client silently refuses to match. Short of that, `meta.searchable`
 * wins; with nothing declared the default is "the column's first non-null value
 * is a string or a number". Neither the `enableGlobalFilter` check nor the
 * string/number default is TanStack's own: its heuristic is a gate
 * *underneath* the flags rather than a default a host can override, and it
 * never consults visibility at all — so without this predicate a hidden column
 * would go on being searched client-side while the wire's `fields` omitted it.
 *
 * This always returns a definite boolean, including when `sampleValue` is
 * `undefined` because no sample has been found yet — that case reads as
 * `false` here. A single column in isolation has no better answer to give: it
 * cannot refuse to answer the way {@link collectSearchFields} can, by putting
 * the id in `unresolved` instead of guessing. Prefer that when the caller can
 * act on the distinction; call this directly only once the caller has already
 * decided how an unresolved column should be treated.
 *
 * @param facts - The column's meta, accessor, enableGlobalFilter flag and sample value.
 * @param visible - Whether the column is currently rendered.
 * @returns Whether the column is searched.
 */
export function isSearchableColumn(facts: FilterKindSource, visible: boolean): boolean {
  if (!facts.hasAccessor || !visible) return false
  if (facts.enableGlobalFilter === false) return false
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
  /**
   * Visible, accessor-backed leaf ids resolved as **not** searched, sorted —
   * either `enableGlobalFilter: false`, `meta.searchable: false`, or a sampled
   * value that failed the string-or-number heuristic. Definite, the same way
   * `fields` is: a caller that remembers a verdict across renders
   * (`useDataTable`'s monotonic search-field cache) needs this to tell
   * "resolved false" apart from "not yet resolved" without re-deriving it from
   * `fields` and the column set.
   */
  excluded: string[]
  /**
   * Ids resolved by an explicit declaration on the column definition —
   * `enableGlobalFilter: false` or `meta.searchable` — rather than inferred
   * from a sampled value, sorted. Always a subset of `fields` ∪ `excluded`,
   * never of `unresolved`: a declaration is definite the instant the column
   * definition is read, with no data to wait for.
   *
   * `useDataTable`'s monotonic search-field cache exists to smooth over
   * *inference* changing page to page in server mode — it has nothing to do
   * with a host-authored declaration, which is not data-dependent and must
   * win immediately, in both directions, however it changes after mount. This
   * is how that caller tells the two kinds of verdict apart without
   * re-deriving it from `meta`/`enableGlobalFilter` itself.
   */
  declared: string[]
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
 * @returns `fields`, `unresolved`, `excluded` and `declared`, each sorted.
 */
export function collectSearchFields<TData>(
  columns: readonly FilterColumnDefShape<TData>[],
  rows: readonly TData[],
  visibility: Record<string, boolean>,
): SearchFieldsResult {
  const fields: string[] = []
  const unresolved: string[] = []
  const excluded: string[] = []
  const declared: string[] = []
  for (const [id, facts] of collectColumnFacts(columns, rows)) {
    const visible = visibility[id] ?? true
    if (!facts.hasAccessor || !visible) continue
    // `enableGlobalFilter: false` is definite the instant the column
    // definition is read — no sample to wait for, unlike `meta.searchable`
    // paired with inference — so it is resolved, and recorded as declared,
    // ahead of the unresolved check below.
    if (facts.enableGlobalFilter === false) {
      excluded.push(id)
      declared.push(id)
      continue
    }
    // Same "nothing declared, nothing sampled" check `collectFilterKinds` uses
    // to skip rather than guess — see the JSDoc above for why folding this
    // into either `true` or `false` would be wrong.
    if (facts.meta?.searchable === undefined && facts.sampleValue === undefined) {
      unresolved.push(id)
      continue
    }
    if (facts.meta?.searchable !== undefined) declared.push(id)
    if (isSearchableColumn(facts, visible)) fields.push(id)
    else excluded.push(id)
  }
  return {
    fields: fields.sort(compareIds),
    unresolved: unresolved.sort(compareIds),
    excluded: excluded.sort(compareIds),
    declared: declared.sort(compareIds),
  }
}

/** The search text with its per-filter work done: lower-cased, split. */
export interface SearchNeedle {
  tokens: string[]
}

/**
 * Split the search text into the tokens a row must satisfy.
 *
 * The returned needle is plain, immutable data — safe to memoise across
 * renders or reuse for many rows. It carries no cached state of its own;
 * {@link rowMatchesSearch} always reads a row's currently-searched columns
 * fresh, so a memoised needle never goes stale even if which columns are
 * searched changes later.
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

/**
 * Which ids to read off a row, asked fresh from the row's own table.
 *
 * Read from the table rather than closed over, so this list and the table's own
 * `getColumnCanGlobalFilter` can never disagree about which columns are being
 * searched — they are the same answer, asked once.
 *
 * @param row - The row whose table is asked which columns it is searching.
 * @returns The searched leaf column ids, in table order.
 */
function searchFieldsForRow(row: SearchableRow): readonly string[] {
  return row.table
    .getAllLeafColumns()
    .filter((column) => column.getCanGlobalFilter())
    .map((column) => column.id)
}

/**
 * Whether every token appears somewhere in the given fields of one row.
 *
 * Factored out of {@link rowMatchesSearch} and the internal, cached matcher
 * `filterFn_dtSearch` uses, so the two share this line rather than drifting.
 */
function matchesFields(tokens: readonly string[], fields: readonly string[], row: SearchableRow): boolean {
  const haystack = fields.map((id) => valueText(row.getValue(id)))
  return tokens.every((token) => haystack.some((value) => value.includes(token)))
}

/**
 * Whether every token appears somewhere in the searched fields of one row.
 *
 * Recomputes the field list from `row.table` on every call rather than
 * caching it against the needle, so this is safe to call with a needle built
 * and kept around by the caller — memoised across renders, reused for many
 * rows, even reused after the table's searchable columns changed. Each call
 * answers against the row's *current* `getCanGlobalFilter` set.
 *
 * `filterFn_dtSearch` delegates here too for any needle it cannot prove is
 * its own — see `matchesSearchCached` — so this is also what makes a needle
 * built with `searchNeedle` and handed straight to `filterFn_dtSearch`,
 * outside the table, safe: it is never stale, only ever slower than the
 * table's own in-pipeline cache.
 *
 * @param row - The row under test.
 * @param needle - The resolved search text.
 * @returns Whether the row matches.
 */
export function rowMatchesSearch(row: SearchableRow, needle: SearchNeedle): boolean {
  if (needle.tokens.length === 0) return true
  return matchesFields(needle.tokens, searchFieldsForRow(row), row)
}

/**
 * Marks a needle that `filterFn_dtSearch`'s own `resolveFilterValue` minted.
 *
 * TanStack calls `resolveFilterValue` fresh, once per globally-filterable
 * column, before that column's row loop runs (`createFilteredRowModel.js`),
 * so a branded needle really cannot outlive the single filtering pass that
 * built it. Nothing outside this module can produce the brand — the public
 * `searchNeedle` never sets it — so a needle a caller mints with
 * `searchNeedle` and hands to `filterFn_dtSearch` directly, or memoises and
 * reuses across renders, can never be mistaken for one whose cached field
 * list is still fresh. That is what actually closes the invariant rather
 * than merely asserting it: see `matchesSearchCached`.
 */
const PASS: unique symbol = Symbol("dt-search-pass")

/** A {@link SearchNeedle} branded by `filterFn_dtSearch.resolveFilterValue`. */
type PassNeedle = SearchNeedle & { readonly [PASS]: true }

/** Type guard for {@link PassNeedle}. */
function isPassNeedle(needle: SearchNeedle): needle is PassNeedle {
  return PASS in needle
}

/*
 * The field list, cached against the needle the table resolved it for.
 *
 * Private to this module's own `matchesSearchCached` below, and only ever
 * populated for a `PassNeedle` — see `isPassNeedle` — so keying on identity
 * here really can never outlive the pass that built it. Weakly, so neither
 * needle nor field list is held alive by the cache.
 */
const fieldsByNeedle = new WeakMap<PassNeedle, readonly string[]>()

/**
 * `rowMatchesSearch`'s matching rule, with the per-column field lookup cached
 * against the needle for the duration of one filtering pass.
 *
 * Only a `PassNeedle` — one `filterFn_dtSearch.resolveFilterValue` itself
 * minted — is allowed to use that cache. Any other `SearchNeedle` (built with
 * the public `searchNeedle` and handed to `filterFn_dtSearch` directly,
 * outside the table) delegates to `rowMatchesSearch`, which always re-reads
 * the row's currently-searched columns instead of trusting a cached list.
 */
function matchesSearchCached(row: SearchableRow, needle: SearchNeedle): boolean {
  if (!isPassNeedle(needle)) return rowMatchesSearch(row, needle)
  if (needle.tokens.length === 0) return true
  let fields = fieldsByNeedle.get(needle)
  if (fields === undefined) {
    fields = searchFieldsForRow(row)
    fieldsByNeedle.set(needle, fields)
  }
  return matchesFields(needle.tokens, fields, row)
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
 * the row loop — once per searchable column — rather than once per row. A
 * needle built any other way (the public `searchNeedle`, called directly)
 * still filters correctly if handed to this function outside the table; it
 * just does not carry the brand `resolveFilterValue` mints here, so it never
 * touches the per-pass field-list cache — see `matchesSearchCached`.
 */
export const filterFn_dtSearch = constructFilterFn({
  resolveFilterValue: (text: unknown): SearchNeedle => {
    const needle: PassNeedle = { ...searchNeedle(text), [PASS]: true }
    return needle
  },
  filter: (_dataValue: unknown, needle: SearchNeedle, row) => matchesSearchCached(row, needle),
})
