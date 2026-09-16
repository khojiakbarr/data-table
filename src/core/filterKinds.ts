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
  columns?: readonly FilterColumnDefShape<TData>[]
}

/**
 * Every leaf column's resolved filter kind.
 *
 * Mirrors `collectLeafIds`' own id resolution (both derive it the way
 * TanStack's `constructColumn` does — see {@link deriveColumnId}) so the map
 * lines up with the ids a stored layout holds. Only the first few rows are
 * sampled: inference needs one non-null value, and walking a 100 000-row array
 * per column on every mount to find one is not worth the accuracy.
 *
 * @param columns - Column definitions, possibly nested.
 * @param rows - The data, or the page of it the table is holding.
 * @returns Leaf column id to resolved kind.
 */
export function collectFilterKinds<TData>(
  columns: readonly FilterColumnDefShape<TData>[],
  rows: readonly TData[],
): Map<string, FilterKind | false> {
  const kinds = new Map<string, FilterKind | false>()
  const walk = (defs: readonly FilterColumnDefShape<TData>[]): void => {
    defs.forEach((def, index) => {
      if (def.columns?.length) {
        walk(def.columns)
        return
      }
      const id = deriveColumnId(def, index)
      const read = valueReader(def)
      kinds.set(id, resolveFilterKind({
        meta: def.meta,
        hasAccessor: read !== null,
        sampleValue: read === null ? undefined : firstNonNull(rows, read),
      }))
    })
  }
  walk(columns)
  return kinds
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
