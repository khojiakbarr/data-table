/**
 * Deriving a column's id the way TanStack does.
 *
 * `constructColumn` (TanStack table-core) computes a live column's id as
 * `columnDef.id ?? String(accessorKey).replaceAll(".", "_") ?? (typeof header
 * === "string" ? header : undefined)`. Anything in this library that computes
 * an id from column definitions independently of the table instance — a stored
 * layout's known columns, a per-column filter kind, a set of searchable fields
 * — has to agree with that, or a lookup by id silently misses: a nested
 * `accessorKey` like `"partner.name"` gets live id `"partner_name"`, and a
 * header-only display column gets its header text rather than its position.
 */

/** The column-def fields {@link deriveColumnId} needs. */
export interface ColumnIdSource {
  id?: string
  accessorKey?: unknown
  header?: unknown
}

/**
 * Derive a leaf column's id exactly as TanStack's `constructColumn` does.
 *
 * @param def - The id, accessorKey and header a column definition declares.
 * @param index - The column's position, used only when nothing else identifies it.
 * @returns The id TanStack would assign this column.
 */
export function deriveColumnId(def: ColumnIdSource, index: number): string {
  if (typeof def.id === "string") return def.id
  if (typeof def.accessorKey === "string") return def.accessorKey.replaceAll(".", "_")
  if (typeof def.header === "string") return def.header
  return String(index)
}
