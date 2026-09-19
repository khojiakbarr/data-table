import type { RowData } from "@tanstack/react-table"
import { useRef, type RefObject } from "react"
import { useAnsweredQuery } from "../core/useAnsweredQuery"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

interface QuickSearchProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  /**
   * The host's `loading` prop, forwarded by `<DataTable>`. Server mode only,
   * where it is one of the signals that the host has moved on to the query
   * the table last announced — see {@link useAnsweredQuery}.
   */
  loading?: boolean | undefined
  /**
   * Receives the search `<input>` element, for a caller that needs to move
   * focus onto it — `<DataTable>`'s "Clear filters" button does, since that
   * button unmounts the instant the rows come back and has nowhere else of
   * its own to send focus.
   */
  inputRef?: RefObject<HTMLInputElement | null> | undefined
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
export function QuickSearch<TData extends RowData>({
  instance,
  labels,
  loading = false,
  inputRef: externalInputRef,
}: QuickSearchProps<TData>) {
  const { filtering, pagination, table } = instance
  // A host-supplied ref (see `inputRef` above) takes the DOM node directly;
  // otherwise this component still needs one for its own clear-button
  // handoff below, so it keeps its own.
  const ownInputRef = useRef<HTMLInputElement>(null)
  const inputRef = externalInputRef ?? ownInputRef
  /*
   * What the announced count answers to, and nothing else: the search text
   * and fields, plus the column filters. `useTableQuery` mints a fresh query
   * object for a page index, a page size and a sort order too, so a latch
   * keyed on the whole query went back to "Searching" on every page turn and
   * every sort — two spurious announcements each, for a number none of them
   * can move. Compared by value, as a JSON key, for the same reason
   * `queriesEqual` is: everything in a query is JSON, and `buildQuery` fixes
   * the order of both arrays, so a stringify compare is exact.
   */
  const matchKey = JSON.stringify({ search: instance.query.search, filters: instance.query.filters })
  /*
   * Whether the host has answered the query on the wire. Only server mode
   * consults it — a client table filters its own rows, so its count is always
   * this render's — but the hook is called unconditionally, ahead of the
   * `filtering.enabled` gate below, because hook order cannot depend on props.
   */
  const answered = useAnsweredQuery({
    query: matchKey,
    data: table.options.data,
    rowCount: pagination.rowCount,
    loading,
  })
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
  const server = instance.mode === "server"
  const matches = server ? pagination.rowCount : table.getFilteredRowModel().rows.length
  /*
   * What the live region says. In server mode the count belongs to the last
   * query the *host* answered, and `published` flips true one commit before
   * `onQueryChange` has even fired — so on a first search `pagination.rowCount`
   * is still the unfiltered total, and reading it out would be the same defect
   * the `published` gate above fixes for client mode. Until the host has
   * answered, the count of the current search is simply not known yet, and
   * `labels.searchResults(undefined)` ("Searching") is the honest string for
   * it.
   */
  const announcement = !published
    ? ""
    : server && !answered
      ? labels.searchResults(undefined)
      : labels.searchResults(matches)

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
        one result count per settled search instead of one per keystroke. See
        `announcement` above for the server-mode half of the same rule.
      */}
      <span className="dt-sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  )
}
