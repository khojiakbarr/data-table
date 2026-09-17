import type { RowData } from "@tanstack/react-table"
import { useRef } from "react"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

interface QuickSearchProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
}

/**
 * The toolbar's search box.
 *
 * A plain controlled input over `instance.filtering.search`, which holds the
 * raw text: what is debounced is everything downstream of it, so the field
 * keeps trailing spaces and a half-typed word the way any other input does.
 *
 * Exported for a shell of its own — a host rendering `toolbar={false}` can put
 * it wherever its own controls live. It gates on `instance.filtering.enabled`
 * itself, so it is safe to render even when the host has not checked that the
 * instance has filtering on: `updateSearch` swallows every keystroke in that
 * case, and a field that visibly accepts input but silently drops it is worse
 * than no field.
 */
export function QuickSearch<TData extends RowData>({ instance, labels }: QuickSearchProps<TData>) {
  const { filtering, pagination, table } = instance
  const inputRef = useRef<HTMLInputElement>(null)
  if (!filtering.enabled) return null

  // Drives the clear button: the raw, not-yet-debounced text, so the button
  // appears the instant there is something to clear.
  const typed = filtering.search.trim() !== ""
  // Drives the announcement: `query.search` is the debounced value, so this
  // is false for the whole pre-debounce window and true only once a search
  // has actually been published.
  const published = instance.query.search !== null
  /*
   * The count as the user would count it: every matching row, not the page
   * and not the expanded tree under it. `table.getRowModel()` (and, in client
   * mode, `pagination.rowCount`, which is `getPrePaginatedRowModel()`) are
   * both aliases for `getExpandedRowModel()` — TanStack's pipeline is core ->
   * filtered -> grouped -> sorted -> expanded -> paginated — so either one
   * re-flattens on every row expand/collapse and would fire this announcement
   * (with the wrong number) on a render the search never touched.
   * `getFilteredRowModel()` sits one stage earlier, right after filtering and
   * before expansion ever sees the rows, so its count holds steady across
   * expand/collapse. Server mode has no such model to read — `manualFiltering`
   * makes `getFilteredRowModel()` alias the *unfiltered* core model there — so
   * it keeps reading the host's own `pagination.rowCount` instead.
   */
  const matches = instance.mode === "server" ? pagination.rowCount : table.getFilteredRowModel().rows.length

  return (
    <div className="dt-search-box">
      <input
        ref={inputRef}
        type="search"
        className="dt-search"
        value={filtering.search}
        placeholder={labels.search}
        aria-label={labels.searchLabel}
        onChange={(event) => filtering.setSearch(event.target.value)}
      />
      {typed ? (
        <button
          type="button"
          className="dt-search-clear"
          aria-label={labels.clearSearch}
          title={labels.clearSearch}
          onClick={() => {
            // The button that was just clicked disappears once the search is
            // cleared (`typed` goes false), and React does not relocate focus
            // for an element that unmounts under it — without this, focus
            // would fall back to `<body>`, dumping a keyboard or screen-reader
            // user at the top of the document (WCAG 2.4.3).
            filtering.setSearch("")
            inputRef.current?.focus()
          }}
        >
          ×
        </button>
      ) : null}
      {/*
        Polite, and gated on the debounced `query.search` rather than the raw
        field: that is what stops a screen reader hearing the unfiltered total
        on the first keystroke and correcting itself 300ms later, so it hears
        one result count per settled search instead of one per keystroke. In
        server mode the count can still trail the host's answer for the
        duration of the in-flight request, because `pagination.rowCount`
        belongs to the last query the host actually answered, not the one on
        the wire — that residual staleness is a server-mode limitation, not
        something this gate can fix. It never moves focus.
      */}
      <span className="dt-sr-only" role="status" aria-live="polite">
        {published ? labels.searchResults(matches) : ""}
      </span>
    </div>
  )
}
