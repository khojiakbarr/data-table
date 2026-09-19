/**
 * A column's name, as a plain string.
 *
 * A header definition can be a string or a render function, and only a string
 * labels anything — an accessible name, a popover title, a row in the panel.
 * The id is the fallback: not pretty, but stable and unique.
 *
 * @param id - The column id.
 * @param header - Whatever `columnDef.header` holds.
 * @returns The header when it is a non-empty string, otherwise the id.
 *
 * @example
 * columnLabel(column.id, column.columnDef.header) // "Amount"
 */
export function columnLabel(id: string, header: unknown): string {
  return typeof header === "string" && header.length > 0 ? header : String(id)
}
