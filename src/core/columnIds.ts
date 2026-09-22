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

/**
 * A column definition, for the two walks below: an id source that may stand
 * over children.
 *
 * Structural rather than TanStack's own `ColumnDef`, which is a union whose
 * group member alone declares `columns` — and which carries a row type these
 * walks have no use for.
 */
export interface ColumnDefNode extends ColumnIdSource {
  columns?: readonly ColumnDefNode[]
}

/**
 * Every leaf id under a set of definitions, in declaration order.
 *
 * Only leaves carry order, visibility, width and pinning, so a group's own id
 * must not appear — mixing them in makes TanStack drop every id it cannot
 * match and reshuffle the rest.
 *
 * @param columns - Column definitions, possibly nested.
 * @returns Every leaf id, depth-first.
 *
 * @example
 * leafIdsOf([{ id: "doc", columns: [{ id: "code" }] }, { id: "date" }])
 * // ["code", "date"]
 */
export function leafIdsOf(columns: readonly ColumnDefNode[]): string[] {
  return columns.flatMap((column, index) =>
    column.columns?.length ? leafIdsOf(column.columns) : [deriveColumnId(column, index)],
  )
}

/**
 * The leaf ids one column stands for, AS THE HOST DECLARED IT.
 *
 * The declared counterpart of "what a column is, to an order made of leaves":
 * a leaf stands for itself, a group for the whole run beneath it. Answered
 * from the definitions rather than from the live column, because the table is
 * not always built from the definitions the host wrote. While rows are
 * grouped the column holding the group values is hoisted OUT of its column
 * group so it can lead the table, so the live `Document` group answers with
 * one leaf where the host declared two — and a move carried out against that
 * answer drops the other column into the gap, tearing the group in half in
 * the stored order. Nothing on screen says so until the grouping is removed.
 *
 * The stored order is the host's arrangement, so it is the host's tree that
 * says what a run is. Total rather than conditional on a hoist being in
 * effect: with nothing grouped the two trees agree, so one answer serves both
 * and there is no second code path to keep honest.
 *
 * Order within the run is not significant — every caller treats it as a set —
 * so declaration order is returned rather than render order.
 *
 * @param columns - The host's definitions, possibly nested.
 * @param columnId - Any column: a leaf, or a group standing over leaves.
 * @returns One id for a leaf, the whole run for a group, or `null` when no
 *   column in these definitions carries that id.
 *
 * @example
 * declaredLeafIds(columns, "document") // ["code", "partner"]
 */
export function declaredLeafIds(
  columns: readonly ColumnDefNode[],
  columnId: string,
): string[] | null {
  for (const [index, column] of columns.entries()) {
    const id = deriveColumnId(column, index)
    if (column.columns?.length) {
      if (id === columnId) return leafIdsOf(column.columns)
      const nested = declaredLeafIds(column.columns, columnId)
      if (nested !== null) return nested
      continue
    }
    if (id === columnId) return [id]
  }
  return null
}
