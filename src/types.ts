import type { ReactNode } from "react"
import type { EditableDeclaration } from "./core/cellEditing"
import type { FilterCondition, FilterValue, FilterValueOption, FilterKind } from "./core/filters"
import type { CellEditingLabels } from "./labels/editing"
import type { SelectionFeature } from "./core/selection"
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
  /**
   * Column ids the rows are grouped by, outermost first. Empty means no
   * grouping.
   *
   * It sits beside `sorting` because it is the same kind of thing: an
   * arrangement of the whole result set that the user chose, that the query
   * carries, and that they expect to find again on their next visit.
   */
  grouping: string[]
  /**
   * Which group rows are open, as key paths from the outermost level.
   *
   * Row expansion normally is NOT part of the layout — a detail panel is a
   * transient reading position, and restoring it would be surprising. A group
   * is different: with grouping computed server-side, which groups are open is
   * part of the query, and a grouping restored with every branch shut is not
   * the table the user left. It is saved with the `grouping` it describes and
   * dropped with it.
   */
  expanded: FilterValue[][]
  /** One condition per filtered column, implicitly ANDed. */
  filters: FilterCondition[]
  /** Quick search, raw as the user typed it; `""` when off. */
  search: string
  /** Rows per page the user chose. Absent until they change it. */
  pageSize?: number
  /**
   * How tall the whole table is, in pixels, after the user dragged the grip.
   *
   * Absent until they do, which is what leaves the `height` prop in charge:
   * the prop is the starting height, this overrides it, and `resetLayout`
   * drops it so the prop is back.
   */
  height?: number
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
  /**
   * Fixed choices for a list filter; shown without counts.
   *
   * The list EDITOR reads them too, and it is the only source it has — a
   * facet endpoint answers a filter's question ("which values exist, and how
   * many rows have each"), not an editor's ("which values may I write").
   */
  values?: FilterValueOption[] | undefined
  /**
   * Whether a cell in this column can be edited, and with what editor.
   *
   * Absent means no. Silence is not consent for something that writes to a
   * database, so a column says so explicitly or gets no Edit item.
   *
   * The kinds are the filter kinds deliberately: a column that filters as a
   * date edits as a date, and one vocabulary serves `filter` and `editable`
   * both. A predicate is the finer form — the column is editable, and this
   * row's own state decides — and it leaves the kind to the same inference
   * `filter` goes through. See {@link EditableDeclaration}.
   *
   * Nothing here writes to the data: an edit reaches the host as
   * `onCellEdit`, and a column that declares `editable` with no `onCellEdit`
   * on the table is a misconfiguration the table warns about in development.
   *
   * @example
   * meta: { editable: "number" }
   * meta: { editable: (row: Receipt) => row.status !== "closed" }
   */
  editable?: EditableDeclaration | undefined
  /**
   * How this column's raw value reads as a group header, once the table is
   * grouped by it.
   *
   * Absent means the group row shows the server's own value verbatim —
   * correct for a column that is already human text, wrong for the coded
   * enum a status or a category column usually is. The column's own CELL
   * renderer is never consulted for this: a cell renderer returns a
   * `ReactNode`, and a group's value also has to stand as the row's
   * accessible name, so the two must not be free to diverge the way a
   * renderer and its own `aria-label` sometimes do. This returns a plain
   * `string` instead, used for both.
   *
   * Called with `""` for a blank group — the grouping contract already
   * collapses a missing value and an empty one into that one key — so a
   * column whose blank means something in particular ("Unassigned") can
   * still say so. Leave it undefined and a blank group falls back to the
   * table's own "(Blanks)" label.
   *
   * @example
   * meta: { groupLabel: (value) => statusLabels[String(value)] ?? String(value) }
   */
  groupLabel?: ((value: FilterValue) => string) | undefined
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
  /**
   * Drag the grip on the bottom edge to change the table's height. Default true.
   *
   * Turn it off in a host that owns the height itself — a table sized by a
   * grid row or a pane splitter — where a grip would let the user set a height
   * the surrounding layout immediately overrides.
   */
  heightGrip?: boolean
  /**
   * A leading column numbering the rows. **Default false.**
   *
   * The odd one out here, and deliberately: every other flag turns OFF a
   * rearrangement the table has always offered, so `true` preserves what a
   * host already had. This one ADDS furniture nobody asked for, and a table
   * that grew a new column on a minor upgrade would be a breaking change
   * dressed as a small one.
   *
   * The number is the row's 1-based place in the WHOLE result set —
   * `pageIndex * pageSize + indexOnPage + 1` — not in the page, because a
   * count restarting at 1 on page 2 of a hundred thousand rows tells the user
   * nothing they did not already know.
   *
   * **Group rows are numbered too**, which is not what AG Grid does. Numbering
   * only the leaves needs to know how many group headers precede this page,
   * and no field on the wire carries that; numbering everything is computable
   * from the page offset alone and is truthful about position in the list
   * being looked at. The one row with no number is the "continued" header the
   * client draws from `startPath`, which the server never sent.
   *
   * The column is chrome, not data: pinned to the start, not unpinnable, not
   * sortable, filterable, groupable, editable, hideable or reorderable, and
   * absent from the Columns panel — a tick that could remove it would
   * contradict this very flag. It is resizable, and a width the user sets is
   * saved in the layout like any other.
   */
  rowNumbers?: boolean
  /**
   * A leading column of checkboxes, and the selection behind it. **Default
   * false**, for the reason {@link DataTableFeatureFlags.rowNumbers} is —
   * this adds a column rather than turning an interaction off — and for one
   * more of its own: a table that started selecting rows on a minor upgrade
   * would put a bulk action in front of users the host never meant to offer
   * one to.
   *
   * **The header checkbox means everything the current query matches**, not
   * the fifty rows on screen. A user approving 25 000 receipts must not have
   * to page through 500 screens, so the selection is a statement about the
   * query — "everything it matches, except these" — rather than a list of
   * ids. `onSelectionChange` publishes that statement, the query it is
   * relative to, and the count.
   *
   * **`{ scope: "page" }` narrows that header checkbox to the current page**,
   * for a backend that has no bulk-by-query endpoint: every write is one row
   * by id, so "everything the query matches" is a promise it cannot keep. In
   * that scope the header ticks the selectable rows of the page as
   * `{ mode: "ids" }`, ids gathered on earlier pages stay, and `all-matching`
   * is unreachable. `true` is exactly `{ scope: "all-matching" }`.
   *
   * **A change to the filters, the search or the grouping clears it.** Not a
   * change to the sorting or the page: neither changes which rows match, only
   * their order and which slice is on screen.
   *
   * **`getRowId` is effectively required.** Without it rows are keyed by
   * position and a selection follows the slot rather than the record; the
   * table says so once in development.
   *
   * Group rows are not selectable in this version — a group stands for
   * children the browser does not hold, so a tick on one could not honestly
   * mean anything yet — and their checkbox cell is empty.
   *
   * The column is chrome, not data: pinned to the start ahead of the
   * row-number column, not unpinnable, not sortable, filterable, groupable,
   * editable, hideable, reorderable or resizable, and absent from the Columns
   * panel. Nothing about a selection is ever written to `storage`.
   */
  selection?: SelectionFeature
  /**
   * A band under the table stating what the result set contains. **Default
   * false**, for the same reason {@link DataTableFeatureFlags.rowNumbers} is:
   * every other flag turns OFF a rearrangement the table has always offered,
   * so `true` preserves what a host already had, while this one adds a band
   * nobody asked for — a table that grew one on a minor upgrade would be a
   * breaking change dressed as a small one.
   *
   * `true` renders the built-in band: total rows, or the count labelled
   * "filtered" while a filter or the quick search is narrowing it, plus the
   * columns the table is grouped by. Pass a `ReactNode` instead to keep the
   * band but end it with content of your own — something this library has no
   * business knowing, the way `toolbarContent` lets a host add to the
   * toolbar. Same flag, two shapes, one decision.
   *
   * Read directly off `instance.flags.statusBar` by `<TablePagination>` too:
   * the row count moves OUT of the footer and into the band the moment this
   * is anything other than `false`, so the two never repeat a number that is
   * already on screen. A shell built on `useDataTable` alone gets that
   * hand-off for free just by flipping this flag, with no prop of its own to
   * keep in sync.
   */
  statusBar?: boolean | ReactNode
  /**
   * Row grouping. **Default true** — every existing server host keeps
   * grouping exactly as it already behaves; this flag exists to let a host
   * turn it OFF, not on, so `true` is the non-breaking default.
   *
   * Grouping is server-side only (see `useDataTable`'s own `groupingEnabled`),
   * so this flag has nothing to gate in client mode. Turn it off in a server
   * host whose backend cannot honour `query.grouping` at all — no group-by
   * support on its list endpoint — so the table does not claim a grouping the
   * rows do not have. With it off: no Row groups zone, no per-column group
   * toggle, `query.grouping` and `query.expanded` stay `[]`, and
   * `instance.grouping.add`/`toggle` refuse with the same dev warning client
   * mode already gives.
   */
  grouping?: boolean
}

/**
 * Text shown in the built-in shell, for translation.
 *
 * It extends {@link CellEditingLabels} rather than restating it: `CellEditor`
 * and `CellMenu` are usable on their own and declare the strings they need,
 * and a host that mounts the whole shell must pass ONE labels object, not two.
 * `defaultLabels` spreads `defaultCellEditingLabels`, and `ruLabels`/`uzLabels`
 * spread the two translations that sit beside them in `ru.ts` and `uz.ts`.
 */
export interface DataTableLabels extends CellEditingLabels {
  /** The Columns tab: its rail tab, and the heading inside the panel. */
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
  /**
   * On a disabled Hide: why this column's visibility is not the user's to set
   * right now. Spoken as part of the item's own accessible name, so a reason
   * a sighted user reads greyed out is a reason a screen reader also hears.
   */
  hideGrouped: string
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
  /**
   * The height grip, named for a screen reader.
   *
   * The grip is a bare handle with nothing written on it, so this is the only
   * name it has.
   */
  resizeTable: string
  /**
   * How the keyboard moves the grip, spoken on it.
   *
   * Same reasoning as {@link DataTableLabels.reorderHint}: dragging is the
   * only obvious route, so a user who cannot drag has nowhere else to find
   * the keys in time.
   */
  resizeTableHint: string
  /** The table's height after a keyboard step, announced politely. */
  tableHeight: (pixels: number) => string
  /**
   * The accessible name of the scrolling body region.
   *
   * It became a tab stop so the rows can be scrolled from the keyboard, and a
   * tab stop with no name is announced as an unlabelled group — so this is
   * what a screen reader reads on arriving there, not decoration.
   */
  tableBody: string
  /**
   * The row-number column's header, for a screen reader.
   *
   * The header is empty to the eye — a heading over a column of positions
   * would be noise a user reads once and then looks past — so this is the
   * only name the column has, and it is what every control in that header
   * (the resize handle) is named after.
   */
  rowNumber: string
  /**
   * A row's own checkbox in the selection column, named for a screen reader.
   *
   * The cell holds nothing but the box, so this is the only name it has, and
   * it has to say WHICH row — otherwise every row in the column is announced
   * identically. The row's 1-based place in the whole result set is what
   * identifies it, the same number {@link DataTableLabels.rowNumber}'s column
   * prints and the same one the expand toggle is named with.
   */
  selectRow: (row: number) => string
  /**
   * The selection column's header checkbox, which takes **everything the
   * query matches** rather than the rows on screen.
   *
   * `count` is those rows, pre-formatted the way every other count this table
   * speaks is — or **undefined while a server has not answered**, which is a
   * state this label has to have words for: the alternative is naming the
   * control after a number that is wrong. `raw` is the number behind it, for
   * a language that agrees a noun with the count it governs (Russian).
   */
  selectAllRows: (count: string | undefined, raw: number | undefined) => string
  /**
   * The same header checkbox in a `{ scope: "page" }` table, where it takes
   * the rows of the current page and nothing else.
   *
   * A sentence of its own rather than the count of {@link DataTableLabels.selectAllRows}
   * left out: the two controls do different things, and naming them alike
   * would tell a screen-reader user their tick reached 5 000 rows when it
   * reached the fifty in front of them. No number in it — the page's size is
   * on screen, and the count that matters afterwards is the one the selection
   * bar speaks.
   */
  selectAllRowsOnPage: string
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
  /**
   * "1–50 of 1 000"; `total` is "…" while a server has not answered.
   *
   * All three arrive pre-formatted — the same grouping `rows` renders with —
   * so this only has to place them in the sentence, never reformat them: a
   * host whose own text just interpolates the three has no way to land on
   * the footer's unformatted "1000" the way the table itself used to.
   */
  range: (from: string, to: string, total: string) => string
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
  /**
   * The host's active filters on the rail's Filters tab, spoken after the
   * tab's name ("Filters, 2 active"). The number is drawn beside the name;
   * this is what a screen reader hears instead of a bare digit.
   */
  activeFiltersCount: (count: number) => string
  /** Shown in the Filters tab while nothing is filtered. */
  noFilters: string
  /** Clears every column filter and the search at once, from the panel. */
  clearAllFilters: string

  /* The filtered-empty state. */
  /** Shown instead of `empty` when a filter excluded every row. */
  noMatches: string
  /** The way out of the filtered-empty state. */
  clearFilters: string

  /* Row grouping. */
  /** Badge on a grouped column's header, as a state and not an action. */
  groupedBadge: string
  /**
   * The count beside a group's value: `received (25 000)`.
   *
   * Nothing is spoken here — {@link DataTableLabels.groupRow} is what a screen
   * reader gets — so this is the number and its brackets, in whatever form the
   * language writes them.
   */
  groupCount: (count: number) => string
  /**
   * A group row named for a screen reader: its value and how many rows are in
   * it. The count is spoken, so a language with plural agreement agrees it.
   */
  groupRow: (value: string, count: number) => string
  /**
   * The header above a page that starts INSIDE a group, whose own header was
   * on the previous page. `path` is the group's key path, outermost first.
   */
  groupContinued: (path: string[]) => string
  /** The way out of the grouped-empty state, beside `clearFilters`. */
  clearGrouping: string

  /* The Row Groups zone in the side panel. */
  /** The zone's own heading. */
  rowGroupsTitle: string
  /** What an empty zone says it is for, so it is not an invisible target. */
  rowGroupsHint: string
  /**
   * The per-column control that sends a column to the zone, and the one that
   * takes it back. Both name the column: they are icon buttons, so the name is
   * the only thing a screen reader has to tell one row's control from another's.
   */
  groupByColumn: (column: string) => string
  ungroupColumn: (column: string) => string
  /**
   * A chip's place in the nesting, for a screen reader following a keyboard
   * move — the grouping's own {@link DataTableLabels.reorderPosition}. Level 1
   * is the outermost.
   */
  rowGroupLevel: (column: string, level: number, total: number) => string

  /* The status bar. See `DataTableFeatureFlags.statusBar`. */
  /**
   * Total rows, not narrowed by a filter or the quick search.
   *
   * `count` arrives pre-formatted — the same grouping `rows` prints in the
   * footer, so the two never disagree about what a thousand looks like.
   * `raw` is the number behind it, undefined while a server has not answered
   * yet, for a language that agrees a noun with the count it governs
   * (Russian); a language that does not is free to ignore it, the way
   * `uzLabels` ignores it everywhere else.
   */
  statusBarRows: (count: string, raw: number | undefined) => string
  /**
   * Rows narrowed by a filter or the quick search. `count`/`raw` describe
   * what matched, exactly as {@link DataTableLabels.statusBarRows} does.
   *
   * `total` is the pre-formatted count from BEFORE narrowing — see
   * `UseDataTableOptions.unfilteredTotal` — or undefined while the server has
   * not said. Absent is the honest, expected case for a server-side filter
   * whose backend has not implemented that field yet, not a hole to fill:
   * say only how many matched.
   */
  statusBarFiltered: (count: string, raw: number | undefined, total: string | undefined) => string
  /**
   * The columns rows are grouped by, outermost first — the same names the
   * Row Groups chips already speak, so the status bar never invents a second
   * way to say a column's name.
   */
  statusBarGroupedBy: (columns: string[]) => string
  /**
   * The totals row's leading cell, and the row's own accessible name.
   *
   * Both read this same string — see `TotalsFooter` — so a translation only
   * has one word to get right ("Total", "Итого", "Jami") rather than two that
   * could drift apart. A count is never spoken here: the row holds whatever
   * `<DataTable totals>` was given, and this label only says what the row IS,
   * not how many of anything there are.
   */
  totalsRow: string

  /* Cell editing, beyond the strings the editor and the menu carry themselves. */
  /**
   * Marks a cell whose edit is still in flight. Not drawn — the pending cell
   * is styled — so this is what a screen reader hears instead.
   */
  editPending: string
  /**
   * The write was refused. The reason the host's rejection carried is
   * appended after it, the way {@link DataTableLabels.loadFailed} appends one.
   */
  editFailed: (column: string) => string
  /**
   * An open editor's row left the page — scrolled out of a virtualised body,
   * or refetched away — so the edit was abandoned rather than written.
   */
  editCancelled: (column: string) => string
  /**
   * A saved edit moved its row out of what the filters match, so the row is
   * gone from the page. Correct, and indistinguishable from a bug unless
   * something says so.
   */
  editRowFiltered: (column: string) => string
  /** Closes a notice the user has finished reading. */
  dismiss: string
}

/**
 * A host's own filters, drawn inside the side bar's Filters tab.
 *
 * For a backend whose list endpoint takes fixed parameters — a role id, a
 * status — rather than the column conditions this table publishes. The host
 * draws those fields (its own pickers and selects, applying as they change)
 * and they sit where a user looks for filters, above any column filters.
 */
export interface FiltersPanelSlot {
  /** The host's filter fields, rendered at the top of the Filters tab. */
  content: ReactNode
  /**
   * How many of the host's filters are narrowing the list. Shown on the rail's
   * Filters tab while above 0 — the panel is usually closed, and the count is
   * what tells a user why a row they expect is missing.
   */
  activeCount?: number | undefined
}
