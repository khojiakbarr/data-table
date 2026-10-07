import type { DataTableLabels } from "../types"
import { formatCount } from "./formatCount"
import type { SelectionApi } from "./useSelection"

/**
 * The name of the box that selects every row: the rows the QUERY matches —
 * or, in `"page"` header scope, the rows of this page, which is a different
 * sentence rather than the same one with a smaller number in it. The count is
 * formatted the way every other count of the table is spoken, and left out —
 * not "…" — while a server has not answered. The header's box and the cards'
 * select-all both say this.
 *
 * @param selection - The table's selection.
 * @param labels - The table's words.
 */
export function selectAllLabel(selection: SelectionApi | undefined, labels: DataTableLabels): string {
  if (selection?.headerScope === "page") return labels.selectAllRowsOnPage
  const matching = selection?.rowsMatching
  return labels.selectAllRows(matching === undefined ? undefined : formatCount(matching), matching)
}
