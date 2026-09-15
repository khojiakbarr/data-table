import type { RowData } from "@tanstack/react-table"
import { useEffect, useState, type KeyboardEvent } from "react"
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
 */
export function TablePagination<TData extends RowData>({ instance, labels }: TablePaginationProps<TData>) {
  const { enabled, pageIndex, pageSize, pageSizeOptions, pageCount, rowCount, setPageIndex, setPageSize } =
    instance.pagination
  if (!enabled) return null

  const from = rowCount === 0 ? 0 : pageIndex * pageSize + 1
  const to = rowCount === undefined ? (pageIndex + 1) * pageSize : Math.min(rowCount, (pageIndex + 1) * pageSize)
  const canPrevious = pageIndex > 0
  const canNext = pageCount === undefined || pageIndex < pageCount - 1
  const lastIndex = pageCount === undefined ? pageIndex : pageCount - 1

  return (
    <div className="dt-footer">
      <span className="dt-footer-rows">
        {labels.rows}: {formatCount(rowCount)}
      </span>
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
      <span className="dt-footer-range">{labels.range(from, to, rowCount)}</span>
      <nav className="dt-footer-nav" aria-label={labels.page(pageIndex + 1, pageCount)}>
        <NavButton label={labels.firstPage} disabled={!canPrevious} onClick={() => setPageIndex(0)} glyph="«" />
        <NavButton label={labels.previousPage} disabled={!canPrevious} onClick={() => setPageIndex(pageIndex - 1)} glyph="‹" />
        <PageInput pageIndex={pageIndex} lastIndex={lastIndex} label={labels.pageNumber} onCommit={setPageIndex} />
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
    if (Number.isFinite(page)) onCommit(Math.max(0, Math.min(page - 1, lastIndex)))
    else setDraft(String(pageIndex + 1))
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
      max={lastIndex + 1}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}

/** "1 000" with a narrow no-break space (U+202F); "…" while unknown. */
function formatCount(count: number | undefined): string {
  if (count === undefined) return "…"
  return count.toLocaleString("en-US").replace(/,/g, " ")
}
