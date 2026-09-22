import type { RowData } from "@tanstack/react-table"
import { useEffect, useState, type KeyboardEvent } from "react"
import { formatCount } from "../core/formatCount"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

interface TablePaginationProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
}

/**
 * The footer: total rows, rows per page, the current range, and page
 * navigation — in AG Grid's order. Rendered outside the scrolling viewport.
 *
 * It reads everything from `instance.pagination`, never from TanStack's own
 * `getPageCount()` / `getRowCount()`: in server mode those report -1 and the
 * current page's length while the total is still unknown. Exported for
 * shells of their own.
 *
 * **The row count moves out when the status bar is on.** `instance.flags.statusBar`
 * is the one signal both surfaces read — a shell reusing this component gets
 * the hand-off for free the moment it turns that flag on, with no prop of its
 * own to keep in sync. With it off (the default) this renders exactly as it
 * always has: total, page size, range, page controls.
 */
export function TablePagination<TData extends RowData>({ instance, labels }: TablePaginationProps<TData>) {
  const { enabled, pageIndex, pageSize, pageSizeOptions, pageCount, rowCount, setPageIndex, setPageSize } =
    instance.pagination
  if (!enabled) return null

  // Anything but a bare `false` means the status bar renders — see
  // `DataTableFeatureFlags.statusBar` — and it is what now states the total,
  // so repeating it here would be the very duplication the status bar exists
  // to remove.
  const showRowCount = instance.flags.statusBar === false

  const from = rowCount === 0 ? 0 : pageIndex * pageSize + 1
  const to = rowCount === undefined ? (pageIndex + 1) * pageSize : Math.min(rowCount, (pageIndex + 1) * pageSize)
  const canPrevious = pageIndex > 0
  const canNext = pageCount === undefined || pageIndex < pageCount - 1
  const lastIndex = pageCount === undefined ? pageIndex : pageCount - 1 // Last button target
  // The typed page has no ceiling while the total is unknown.
  const inputMax = pageCount === undefined ? Number.MAX_SAFE_INTEGER : lastIndex

  return (
    <div className="dt-footer">
      {showRowCount ? (
        <span className="dt-footer-rows">
          {labels.rows}: {formatCount(rowCount)}
        </span>
      ) : null}
      <span className="dt-spacer" />
      <label className="dt-footer-size">
        {labels.rowsPerPage}
        <select
          className="dt-select"
          value={pageSize}
          onChange={(event) => setPageSize(Number(event.target.value))}
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      {/*
        `formatCount` on all three: `rows` above already renders the total
        grouped, and a page's own numbers deserve the same treatment once
        they climb past 999 — "9 950–10 000" reads the way "10 000" already
        does two lines up, rather than sitting next to it unformatted.
      */}
      <span className="dt-footer-range">{labels.range(formatCount(from), formatCount(to), formatCount(rowCount))}</span>
      <nav className="dt-footer-nav" aria-label={labels.pagination}>
        <NavButton label={labels.firstPage} disabled={!canPrevious} onClick={() => setPageIndex(0)} glyph="«" />
        <NavButton label={labels.previousPage} disabled={!canPrevious} onClick={() => setPageIndex(pageIndex - 1)} glyph="‹" />
        <PageInput pageIndex={pageIndex} lastIndex={inputMax} label={labels.pageNumber} onCommit={setPageIndex} />
        <span className="dt-footer-page">{labels.page(pageIndex + 1, pageCount)}</span>
        <NavButton label={labels.nextPage} disabled={!canNext} onClick={() => setPageIndex(pageIndex + 1)} glyph="›" />
        <NavButton label={labels.lastPage} disabled={!canNext || pageCount === undefined} onClick={() => setPageIndex(lastIndex)} glyph="»" />
      </nav>
    </div>
  )
}

function NavButton({ label, disabled, onClick, glyph }: { label: string; disabled: boolean; onClick: () => void; glyph: string }) {
  return (
    <button type="button" className="dt-icon-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {glyph}
    </button>
  )
}

/** A page number the user can type; commits on Enter or blur, clamped. */
function PageInput({
  pageIndex, lastIndex, label, onCommit,
}: { pageIndex: number; lastIndex: number; label: string; onCommit: (index: number) => void }) {
  const [draft, setDraft] = useState(String(pageIndex + 1))
  useEffect(() => setDraft(String(pageIndex + 1)), [pageIndex])

  const commit = () => {
    const page = Number.parseInt(draft, 10)
    const next = Number.isFinite(page) ? Math.max(0, Math.min(page - 1, lastIndex)) : pageIndex
    onCommit(next)
    setDraft(String(next + 1))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      commit()
    }
  }

  return (
    <input
      type="number"
      className="dt-page-input"
      aria-label={label}
      min={1}
      max={lastIndex === Number.MAX_SAFE_INTEGER ? undefined : lastIndex + 1}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}
