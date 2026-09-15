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
  /** Rows per page the user chose. Absent until they change it. */
  pageSize?: number
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
}
