import type { RefRow } from "../prose"

/*
 * The reference tables, as data. Kept apart from the section that lays them
 * out so a new option is a one-line change here, and so the docs test can
 * walk the names. Wording follows the README's API tables; two entries the
 * README's tables omit — `selectableRowCount` and `filtersPanel` — are taken
 * from `useDataTable.ts` and `DataTable.tsx` directly.
 */

const link = (href: string, text: string) => <a href={href}>{text}</a>

/** `useDataTable(options)`: name, type, default, description. */
export const HOOK_OPTIONS: RefRow[] = [
  ["id", "string", "—", <><strong>Required.</strong> Unique per app; the key the layout is saved under.</>],
  ["data", "(TData | GroupRow)[]", "—", <>The rows. One page in server mode, group headers interleaved when grouped.</>],
  ["columns", "ColumnDef[]", "—", "TanStack column definitions."],
  ["mode", '"client" | "server"', '"client"', <>Server mode: <code>data</code> is one sorted page; see {link("#table-query", "the query contract")}.</>],
  ["storage", "LayoutStorage", "none", <>Where layouts live; see {link("#persistence", "Saving the layout")}.</>],
  ["initialLayout", "Partial<TableLayout>", "{}", "Applied on a user's first visit."],
  ["features", "DataTableFeatureFlags", "see below", <>Off switches for <code>sorting</code>, <code>resizing</code>, <code>reordering</code>, <code>pinning</code>, <code>hiding</code>, <code>heightGrip</code>, <code>grouping</code>; on switches for <code>selection</code>, <code>rowNumbers</code>, <code>statusBar</code>.</>],
  ["getRowId", "(row, index, parent?) => string", "—", "Stable row identity. Needed in server mode and by row selection."],
  ["onQueryChange", "(query: TableQuery) => void", "—", "Called on mount and after every change to the query."],
  ["rowCount", "number", "—", "Total rows across pages. Server mode; undefined until known."],
  ["unfilteredTotal", "number", "—", <>Rows before filters and search, for the {link("#status-bar", "status bar")}'s "X of Y".</>],
  ["selectableRowCount", "number", "—", <>Records a selection counts, when <code>rowCount</code> includes group headers.</>],
  ["startPath", "FilterValue[]", "[]", <>The open group the page's first row sits inside; see {link("#row-grouping", "Row grouping")}.</>],
  ["pagination", "boolean | PaginationOptions", "off (client) / on (server)", <><code>{"{ pageSize?, pageSizeOptions? }"}</code></>],
  ["filtering", "boolean | FilteringOptions", "on", <><code>{"{ debounceMs?, persist?, searchFields?, loadValues? }"}</code>; <code>false</code> turns filtering off.</>],
  ["onSelectionChange", "(selection: SelectionChange) => void", "—", <>The model, its query and the count; see {link("#row-selection", "Row selection")}.</>],
  ["getSubRows", "(row) => TData[]", "—", "Child rows, for tree data."],
  ["canExpand", "(row) => boolean", "all rows", "Which rows may open a detail panel."],
  ["rowHeight", "number", "40", <>Pixel height of a data row; also sets <code>--dt-row-height</code>.</>],
  ["getRowHeight", "(row) => number", "—", "Per-row height, known ahead of render. Pure; may be inline."],
  ["heightVersion", "string | number", "—", <>Changes when <code>getRowHeight</code> starts answering differently.</>],
  ["defaultColumnWidth", "number", "160", ""],
  ["minColumnWidth", "number", "60", ""],
  ["maxColumnWidth", "number", "800", ""],
  ["direction", '"ltr" | "rtl"', '"ltr"', "Which way a drag widens a column."],
]

/** `<DataTable>` props: name, type, default, description. */
export const TABLE_PROPS: RefRow[] = [
  ["instance", "DataTableInstance", "—", <><strong>Required.</strong> From <code>useDataTable</code>.</>],
  ["height", "number | string", "auto", "Starting height of the whole table; the rows scroll inside it. Virtualisation needs a height."],
  ["loading", "boolean", "false", "Skeleton rows with no rows yet; a progress bar once some are on screen."],
  ["error", "unknown", "—", <>A banner, with Retry when <code>onRetry</code> is given.</>],
  ["onRetry", "() => void", "—", "Called by the Retry button."],
  ["striped", "boolean", "false", "Shade alternate rows."],
  ["stickyHeader", "boolean", "true", "Keep the header in view while the body scrolls."],
  ["toolbar", "boolean", "true", "Show the toolbar."],
  ["toolbarContent", "ReactNode", "—", "At the toolbar's leading edge."],
  ["toolbarActions", "ReactNode", "—", "At the toolbar's trailing edge."],
  ["filtersPanel", "FiltersPanelSlot", "—", <>Your own fields in the Filters tab; see {link("#host-filters", "Your own filters")}.</>],
  ["renderSelectionActions", "(selection: SelectionSummary) => ReactNode", "—", "A bar above the table, only while rows are selected."],
  ["totals", "Record<string, ReactNode>", "—", <>A totals row keyed by column id; <code>{"{}"}</code> renders the caption only.</>],
  ["renderDetail", "(row) => ReactNode", "—", "Content under an expanded row."],
  ["onRowClick", "(row) => void", "—", ""],
  ["onRowContextMenu", "(row, event) => void", "—", <>A right-click on a data row; see {link("#row-context-menu", "Row context menu")}.</>],
  ["onCellEdit", "({ row, columnId, value, previous }) => void | Promise<void>", "—", <>Saves one cell; see {link("#cell-editing", "Cell editing")}.</>],
  ["emptyState", "ReactNode", "labels.empty", "Replaces both empty states, including the filtered one."],
  ["labels", "Partial<DataTableLabels>", "English", <>Every string; see {link("#labels", "Labels & i18n")}.</>],
  ["theme", '"light" | "dark"', "system", "Pin one table's colour scheme."],
  ["className", "string", "—", <>Added to <code>.dt-root</code>.</>],
  ["style", "CSSProperties", "—", <>Inline styles on <code>.dt-root</code> — where <code>muiTokens(theme)</code> goes.</>],
  ["footer", "boolean", "true", "Show the pagination footer when paging is on."],
  ["virtualize", "boolean", "true", <><code>false</code> renders every row.</>],
]

/** `columnDef.meta`: name, type, description. */
export const COLUMN_META: RefRow[] = [
  ["filter", 'FilterKind | false', <>The filter editor: <code>"text"</code>, <code>"number"</code>, <code>"date"</code>, <code>"boolean"</code>, <code>"list"</code>. Inferred when absent.</>],
  ["searchable", "boolean", "Whether quick search covers the column."],
  ["values", "FilterValueOption[]", "Fixed choices for a list filter and a list editor."],
  ["editable", "EditableKind | false | (row) => boolean", <>Opt the column into <a href="#cell-editing">cell editing</a>.</>],
  ["groupLabel", "(value) => string", "How a raw value reads as a group header."],
]
