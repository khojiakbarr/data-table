import type { RowData } from "@tanstack/react-table"
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
 * it wherever its own controls live.
 */
export function QuickSearch<TData extends RowData>({ instance, labels }: QuickSearchProps<TData>) {
  const { filtering, pagination, table } = instance
  const active = filtering.search.trim() !== ""
  /*
   * The count as the user would count it: every matching row, not the page.
   * `pagination.rowCount` is that total when paging is on (and undefined in
   * server mode until the host answers); with paging off the row model already
   * holds every row that matched.
   */
  const matches = pagination.enabled ? pagination.rowCount : table.getRowModel().rows.length

  return (
    <div className="dt-search-box">
      <input
        type="search"
        className="dt-search"
        value={filtering.search}
        placeholder={labels.search}
        aria-label={labels.searchLabel}
        onChange={(event) => filtering.setSearch(event.target.value)}
      />
      {active ? (
        <button
          type="button"
          className="dt-search-clear"
          aria-label={labels.clearSearch}
          title={labels.clearSearch}
          onClick={() => filtering.setSearch("")}
        >
          ×
        </button>
      ) : null}
      {/*
        Polite, and only while a search is active: the count lands after the
        debounce settles, so a screen reader hears one result count per search
        rather than one per keystroke. It never moves focus.
      */}
      <span className="dt-sr-only" role="status" aria-live="polite">
        {active ? labels.searchResults(matches) : ""}
      </span>
    </div>
  )
}
