import { deriveColumnId } from "./columnIds"
import type { FilterKind } from "./filters"
import type { DataTableColumnMeta } from "../types"

/**
 * Which filter editor each column gets.
 *
 * Resolved from the column definitions and the data rather than from the table
 * instance, because a stored layout is pruned by `useArrangement` before the
 * table exists — and pruning is where a mismatched kind has to be caught.
 */

/** What {@link resolveFilterKind} needs to know about one column. */
export interface FilterKindSource {
  /** The column's `columnDef.meta`, if it declared one. */
  meta: DataTableColumnMeta | undefined
  /** False for a display column, which has no value to filter. */
  hasAccessor: boolean
  /** The first non-null value the data offers for this column, for inference. */
  sampleValue: unknown
  /**
   * The column's own `columnDef.enableGlobalFilter`, when the column declared
   * one. TanStack's `column_getCanGlobalFilter` ANDs `columnDef.enableGlobalFilter
   * ?? true` into whether the client actually searches a column, so quick
   * search's own searchability answer has to account for it too — see
   * `isSearchableColumn` in `search.ts`, which this facts shape feeds.
   */
  enableGlobalFilter?: boolean
}

/**
 * One column's filter kind.
 *
 * `meta.filter` wins outright, including `false` to turn filtering off. With
 * nothing declared the kind is inferred from the first non-null value:
 * string → text, number → number, boolean → boolean, anything else → text.
 *
 * Inference is a convenience, not a contract — a column that matters declares
 * its kind. It is also *data-dependent*, which is why a stored condition is
 * checked against the resolved kind on load: a page whose first rows happen to
 * begin with nulls can infer a different kind on the next visit.
 *
 * @param source - The column's meta, whether it has an accessor, and a sample value.
 * @returns The kind, or false when the column cannot be filtered.
 */
export function resolveFilterKind(source: FilterKindSource): FilterKind | false {
  const declared = source.meta?.filter
  if (declared !== undefined) return declared
  if (!source.hasAccessor) return false
  if (typeof source.sampleValue === "number") return "number"
  if (typeof source.sampleValue === "boolean") return "boolean"
  return "text"
}

/** The parts of a column definition this module reads. */
export interface FilterColumnDefShape<TData> {
  id?: string
  accessorKey?: unknown
  accessorFn?: (row: TData, index: number) => unknown
  header?: unknown
  meta?: DataTableColumnMeta | undefined
  enableGlobalFilter?: boolean
  columns?: readonly FilterColumnDefShape<TData>[]
}

/**
 * Every leaf column's resolved filter kind.
 *
 * @param columns - Column definitions, possibly nested.
 * @param rows - The data, or the page of it the table is holding.
 * @returns Leaf column id to resolved kind. A column with no declared
 *   `meta.filter` and no rows yet to sample is omitted rather than guessed at
 *   — `pruneFilters` treats a missing entry as "kind check skipped", which is
 *   the only safe reading before the first row has arrived (server mode, or
 *   client mode with async data): guessing "text" would drop every stored
 *   number/boolean condition on that render.
 */
export function collectFilterKinds<TData>(
  columns: readonly FilterColumnDefShape<TData>[],
  rows: readonly TData[],
): Map<string, FilterKind | false> {
  const kinds = new Map<string, FilterKind | false>()
  for (const [id, facts] of collectColumnFacts(columns, rows)) {
    // Nothing declared and nothing to infer from: the kind is *unknown*, not
    // "text". Recording the guess makes `pruneFilters` delete every stored
    // number/boolean condition on the first render of a table whose rows have
    // not arrived — i.e. on every server-mode mount.
    if (facts.meta?.filter === undefined && facts.hasAccessor && facts.sampleValue === undefined) continue
    kinds.set(id, resolveFilterKind(facts))
  }
  return kinds
}

/**
 * Every leaf column's meta, accessor and sample value, in one walk.
 *
 * Extracted because quick search needs exactly the same three facts about a
 * column that {@link resolveFilterKind} does, and walking the definitions twice
 * — once per consumer — is how the two would drift apart about which id a
 * column has.
 *
 * Ids come from {@link deriveColumnId} — the one place this library derives an
 * id the way TanStack's `constructColumn` does — so the map lines up with the
 * live columns and with the ids a stored layout holds. Only the first few rows
 * are sampled: inference needs one non-null value, and walking a 100 000-row
 * array per column on every mount to find one is not worth the accuracy.
 *
 * @param columns - Column definitions, possibly nested.
 * @param rows - The data, or the page of it the table is holding.
 * @returns Leaf column id to the facts both resolvers read.
 */
export function collectColumnFacts<TData>(
  columns: readonly FilterColumnDefShape<TData>[],
  rows: readonly TData[],
): Map<string, FilterKindSource> {
  const facts = new Map<string, FilterKindSource>()
  const walk = (defs: readonly FilterColumnDefShape<TData>[]): void => {
    defs.forEach((def, index) => {
      if (def.columns?.length) {
        walk(def.columns)
        return
      }
      const id = deriveColumnId(def, index)
      const read = valueReader(def)
      facts.set(id, {
        meta: def.meta,
        hasAccessor: read !== null,
        sampleValue: read === null ? undefined : firstNonNull(rows, read),
        // Conditionally spread rather than assigned outright: `enableGlobalFilter`
        // is an optional property (exactOptionalPropertyTypes), so writing
        // `undefined` into it explicitly would differ from leaving it unset.
        ...(def.enableGlobalFilter !== undefined ? { enableGlobalFilter: def.enableGlobalFilter } : {}),
      })
    })
  }
  walk(columns)
  return facts
}

/** How to read one column's value off a row, or null for a display column. */
function valueReader<TData>(def: FilterColumnDefShape<TData>): ((row: TData, index: number) => unknown) | null {
  if (typeof def.accessorFn === "function") return def.accessorFn
  if (typeof def.accessorKey !== "string") return null
  // TanStack reads a dotted `accessorKey` as a path, so this has to as well.
  const path = def.accessorKey.split(".")
  return (row: TData) =>
    path.reduce<unknown>(
      (value, key) => (value === null || typeof value !== "object" ? undefined : (value as Record<string, unknown>)[key]),
      row,
    )
}

/** How many rows to look at before giving up on inferring a kind. */
const SAMPLE_ROWS = 20

function firstNonNull<TData>(rows: readonly TData[], read: (row: TData, index: number) => unknown): unknown {
  const limit = Math.min(rows.length, SAMPLE_ROWS)
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index]
    if (row === undefined) continue
    const value = read(row, index)
    if (value !== null && value !== undefined) return value
  }
  return undefined
}
