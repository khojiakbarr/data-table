import type { FilterCondition, FilterValueOption, FilterKind } from "./core/filters"
import type {
  ColumnOrderState,
  ColumnPinningState,
  ColumnSizingState,
  ColumnVisibilityState,
  SortingState,
} from "@tanstack/react-table"

/**
 * Everything a user can rearrange about a table.
 *
 * Stored and restored as one object so a half-applied layout is impossible —
 * column order without the matching widths looks broken.
 */
export interface TableLayout {
  columnOrder: ColumnOrderState
  columnVisibility: ColumnVisibilityState
  columnPinning: ColumnPinningState
  columnSizing: ColumnSizingState
  sorting: SortingState
  /** One condition per filtered column, implicitly ANDed. */
  filters: FilterCondition[]
  /** Quick search, raw as the user typed it; `""` when off. */
  search: string
  /** Rows per page the user chose. Absent until they change it. */
  pageSize?: number
}

/**
 * Per-column filter configuration, read from `columnDef.meta`.
 *
 * Every member is written `?: T | undefined` because the repo runs
 * `exactOptionalPropertyTypes` and `meta: { filter: isNumeric ? "number" : undefined }`
 * is the natural call site.
 */
export interface DataTableColumnMeta {
  /** Which editor this column gets. `false` turns filtering off for it. */
  filter?: FilterKind | false | undefined
  /** Whether quick search covers this column. Default true for text-ish columns. */
  searchable?: boolean | undefined
  /** Fixed choices for a list filter; shown without counts. */
  values?: FilterValueOption[] | undefined
}

/**
 * Where a table's layout is kept between visits.
 *
 * The built-in adapter writes to `localStorage`, which is per-browser. Supply
 * your own to put layouts on a server so they follow the user across devices —
 * that is the usual choice in a multi-user application.
 *
 * Every method receives the table `id`, so one adapter serves every table in an
 * application.
 */
export interface LayoutStorage {
  /**
   * @param id - The table's `id`.
   * @returns The stored layout, or null when the table has never been arranged.
   */
  load(id: string): Partial<TableLayout> | null
  /**
   * @param id - The table's `id`.
   * @param layout - The complete current layout.
   */
  save(id: string, layout: TableLayout): void
  /**
   * @param id - The table's `id`.
   */
  clear(id: string): void
}

/** Which rearrangements the user is allowed to make. */
export interface DataTableFeatureFlags {
  /** Click a header to sort. Default true. */
  sorting?: boolean
  /** Drag a header edge to resize. Default true. */
  resizing?: boolean
  /** Drag a header to reorder. Default true. */
  reordering?: boolean
  /** Freeze a column to the left or right edge. Default true. */
  pinning?: boolean
  /** Hide columns. Default true. */
  hiding?: boolean
}

/** Text shown in the built-in shell, for translation. */
export interface DataTableLabels {
  columnsButton: string
  columnsTitle: string
  /**
   * The docked side bar's rail, named for a screen reader.
   *
   * It is the `tablist`'s accessible name, not anything drawn on screen: the
   * rail's own tabs carry their visible labels, and the group they form needs
   * one of its own so "Columns, tab, 1 of 2" is announced against something.
   */
  sideBar: string
  showAll: string
  reset: string
  pinStart: string
  pinEnd: string
  unpin: string
  hide: string
  sortAscending: string
  sortDescending: string
  clearSort: string
  empty: string
  dragHint: string
  /**
   * How the keyboard reorders a column, spoken on the drag handle: the
   * handle is the only route a user who cannot drag has, and a screen
   * reader has nowhere else to find the keys in time.
   */
  reorderHint: string
  /** Where a held column now sits, announced politely as it moves. */
  reorderPosition: (column: string, position: number, total: number) => string
  resizeColumn: string
  expandRow: string
  collapseRow: string
  columnActions: string
  autosize: string
  autosizeAll: string
  resetWidth: string
  /** Badge on an already-pinned column, as a state and not an action. */
  pinnedStartBadge: string
  pinnedEndBadge: string
  /**
   * A column group's checkbox in the Columns panel, named for a screen reader.
   *
   * The visible text beside it is the group's header alone, which a leaf
   * column could carry just as well; this says which of the two is being
   * ticked. The group's own name is kept at the front of the result so the
   * accessible name still begins with the visible one (WCAG 2.5.3).
   */
  columnGroup: (group: string) => string
  /** The collapse control, while the group is collapsed. */
  expandGroup: string
  /** The collapse control, while the group is expanded. */
  collapseGroup: string
  /** Footer: total rows. */
  rows: string
  rowsPerPage: string
  /** "1–50 of 1 000"; `total` is undefined while a server has not answered. */
  range: (from: number, to: number, total: number | undefined) => string
  /** "Page 3 of 20"; `count` is undefined while unknown. */
  page: (page: number, count: number | undefined) => string
  pageNumber: string
  /** Name of the pagination controls group. */
  pagination: string
  firstPage: string
  previousPage: string
  nextPage: string
  lastPage: string
  loading: string
  loadFailed: string
  retry: string

  /* Quick search. */
  /** Placeholder in the toolbar's search box. */
  search: string
  /** Accessible name of the search box; a placeholder is not a label. */
  searchLabel: string
  /** Empties the search box. */
  clearSearch: string
  /** Announced politely once a search settles; `count` is undefined while a server has not answered. */
  searchResults: (count: number | undefined) => string

  /* The column filter editor. */
  /** Header-menu item that opens the filter editor in a popover. */
  filter: string
  /** Header-menu item that opens the side panel's Filters tab on this column. */
  filterInPanel: string
  /** Accessible name of the filter popover, named after its column. */
  filterTitle: (column: string) => string
  /** Badge on an already-filtered column, as a state and not an action. */
  filteredBadge: string
  /** Commits the editor's draft. */
  apply: string
  /** Removes this column's condition. */
  clearFilter: string
  /** Accessible name of the operator select. */
  operator: string
  /** Accessible name of the single value field. */
  filterValue: string
  /** Accessible name of a range's lower end. */
  rangeFrom: string
  /** Accessible name of a range's upper end. */
  rangeTo: string

  /* Operator names. Flat, so `{ ...defaultLabels, ...mine }` overrides one of
     them the same way it overrides every other label. */
  opContains: string
  opNotContains: string
  opEquals: string
  opNotEquals: string
  opStartsWith: string
  opEndsWith: string
  opEq: string
  opNe: string
  opLt: string
  opLte: string
  opGt: string
  opGte: string
  opBetween: string
  /** The date editor's four modes; all four become one half-open range. */
  opDateIs: string
  opDateBefore: string
  opDateAfter: string
  opDateBetween: string
  opIsTrue: string
  opIsFalse: string
  opIn: string
  opNotIn: string
  /** Blankness is an operator on every kind, including a values list. */
  opBlank: string
  opNotBlank: string

  /* Values lists. */
  /** Search box inside a values list. */
  searchValues: string
  /** Ticks or unticks every choice at once. */
  selectAll: string
  /** The choice standing for a blank value, which is an operator and not a value. */
  blanks: string
  /** Shown when a column has no source of choices at all. */
  noValues: string
  /** Shown when a values request failed; its retry reuses `retry`. */
  valuesFailed: string

  /* The side panel's Filters tab. */
  filtersTab: string
  /** Marks a filtered column that is currently hidden. */
  hiddenColumn: string
  /** Shown in the Filters tab while nothing is filtered. */
  noFilters: string
  /** Clears every column filter and the search at once, from the panel. */
  clearAllFilters: string

  /* The filtered-empty state. */
  /** Shown instead of `empty` when a filter excluded every row. */
  noMatches: string
  /** The way out of the filtered-empty state. */
  clearFilters: string
}
