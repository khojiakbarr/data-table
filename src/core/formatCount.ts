/**
 * "1 000" with a narrow no-break space (U+202F) as the group separator;
 * "…" while the count is unknown.
 *
 * Locale-independent on purpose: every number this table prints — the
 * footer's total, its range, and the status bar's counts — has to agree on
 * what a thousand looks like, so one function owns the answer rather than
 * each caller picking its own `toLocaleString` locale. Extracted from
 * `TablePagination`, which was the only caller until the status bar became a
 * second one that had to match it exactly.
 *
 * @param count - A row count, or undefined while a server has not said yet.
 * @returns The grouped digits, or "…" for undefined.
 *
 * @example
 * formatCount(1000) // "1 000"
 * formatCount(undefined) // "…"
 */
export function formatCount(count: number | undefined): string {
  if (count === undefined) return "…"
  return count.toLocaleString("en-US").replace(/,/g, " ")
}
