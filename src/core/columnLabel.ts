/**
 * A column's name, as a plain string.
 *
 * A header definition can be a string or a render function, and only a string
 * labels anything — an accessible name, a popover title, a row in the panel.
 * A column whose header is drawn (an icon, a checkbox) names itself with
 * `meta.label`. The id is the last resort: stable and unique, but it is a
 * developer's word — "pick", "actions" — not the user's.
 *
 * @param id - The column id.
 * @param header - Whatever `columnDef.header` holds.
 * @param label - `columnDef.meta.label`, the name of a column whose header is not a string.
 * @returns The header when it is a non-empty string, else the label when there is one, else the id.
 *
 * @example
 * columnLabel(column.id, column.columnDef.header, column.columnDef.meta?.label) // "Amount"
 */
export function columnLabel(id: string, header: unknown, label?: string): string {
  if (typeof header === "string" && header.length > 0) return header
  return label !== undefined && label.length > 0 ? label : String(id)
}
