import type { RowData } from "@tanstack/react-table"
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react"
import { classNames, insertAt } from "../core/classNames"
import { buildColumnTree, siblingOrderOf, type ColumnTreeNode } from "../core/columnTree"
import { fillerIndex, renderedLeafColumns } from "../core/pinning"
import type { CellEditHandler } from "../core/cellEditing"
import { useCellEditing } from "../core/useCellEditing"
import type { SelectionSummary } from "../core/useSelection"
import { useDropSlot } from "../core/useDropSlot"
import { useAutosize } from "../core/useAutosize"
import { useIsomorphicLayoutEffect } from "../core/useIsomorphicLayoutEffect"
import { useAwaitingFirstPage } from "../core/useAwaitingFirstPage"
import { useUnboundedViewport } from "../core/useUnboundedViewport"
import type { DataTableInstance } from "../useDataTable"
import { defaultCellEditingLabels } from "../labels/editing"
import type { DataTableLabels } from "../types"
import { CellEditNotice } from "./CellEditNotice"
import { CellMenu } from "./CellMenu"
import { HeaderMenu, type HeaderMenuPosition } from "./HeaderMenu"
import type { PanelTab } from "./TablePanel"
import { TableSideBar } from "./TableSideBar"
import { QuickSearch } from "./QuickSearch"
import { canFilterColumn } from "./FilterEditor"
import { FilterPopover } from "./FilterPopover"
import { HeaderCell } from "./HeaderCell"
import { HeightGrip } from "./HeightGrip"
import { StatusBar } from "./StatusBar"
import { TableBody } from "./TableBody"
import { TablePagination } from "./TablePagination"
import { SkeletonRows, TableStatus } from "./TableStatus"

/** English defaults; pass `labels` to translate. */
export const defaultLabels: DataTableLabels = {
  /* The fifteen strings `CellEditor` and `CellMenu` render, folded in so a
     host passes one labels object rather than two. */
  ...defaultCellEditingLabels,
  editPending: "Saving",
  editFailed: (column) => `Could not save ${column}`,
  editCancelled: (column) => `The edit to ${column} was cancelled: the row left the page`,
  editRowFiltered: (column) => `${column} was saved. The row no longer matches the filters`,
  dismiss: "Dismiss",
  columnsTitle: "Columns",
  sideBar: "Table side bar",
  showAll: "Show all",
  reset: "Reset",
  pinStart: "Pin to start",
  pinEnd: "Pin to end",
  unpin: "Unpin",
  hide: "Hide",
  hideGrouped: "Rows are grouped by this column",
  sortAscending: "Sort ascending",
  sortDescending: "Sort descending",
  clearSort: "Clear sort",
  empty: "No rows",
  dragHint: "Drag to reorder",
  reorderHint: "Press Space to pick up, arrow keys to move, Space to drop, Escape to cancel",
  reorderPosition: (column, position, total) => `${column}: position ${position} of ${total}`,
  resizeColumn: "resize column",
  resizeTable: "Resize table height",
  resizeTableHint: "Press the up and down arrows to resize, Shift for larger steps",
  tableHeight: (pixels) => `Table height ${pixels} pixels`,
  tableBody: "Table rows",
  rowNumber: "Row number",
  selectRow: (row) => `Select row ${row}`,
  // With no count yet, the control says what it does and leaves the number
  // out — naming it after a wrong one would be worse than naming it after none.
  selectAllRows: (count) => (count === undefined ? "Select all rows" : `Select all ${count} rows`),
  expandRow: "Expand row",
  collapseRow: "Collapse row",
  columnActions: "Column actions",
  autosize: "Fit this column",
  autosizeAll: "Fit all columns",
  resetWidth: "Reset width",
  pinnedStartBadge: "Start",
  pinnedEndBadge: "End",
  columnGroup: (group) => `${group} column group`,
  expandGroup: "Expand group",
  collapseGroup: "Collapse group",
  rows: "Rows",
  rowsPerPage: "Rows per page",
  range: (from, to, total) => `${from}–${to} of ${total ?? "…"}`,
  page: (page, count) => `Page ${page} of ${count ?? "…"}`,
  pageNumber: "Page number",
  pagination: "Pagination",
  firstPage: "First page",
  previousPage: "Previous page",
  nextPage: "Next page",
  lastPage: "Last page",
  loading: "Loading",
  loadFailed: "Could not load rows",
  retry: "Retry",
  search: "Search",
  searchLabel: "Search rows",
  clearSearch: "Clear search",
  searchResults: (count) => (count === undefined ? "Searching" : `${count} matching rows`),
  filter: "Filter…",
  filterInPanel: "Filter in panel…",
  filterTitle: (column) => `Filter ${column}`,
  filteredBadge: "Filtered",
  apply: "Apply",
  clearFilter: "Clear filter",
  operator: "Operator",
  filterValue: "Value",
  rangeFrom: "From",
  rangeTo: "To",
  opContains: "Contains",
  opNotContains: "Does not contain",
  opEquals: "Equals",
  opNotEquals: "Does not equal",
  opStartsWith: "Starts with",
  opEndsWith: "Ends with",
  opEq: "Equals",
  opNe: "Does not equal",
  opLt: "Less than",
  opLte: "Less than or equal",
  opGt: "Greater than",
  opGte: "Greater than or equal",
  opBetween: "Between",
  opDateIs: "Is",
  opDateBefore: "Before",
  opDateAfter: "After",
  opDateBetween: "Between",
  opIsTrue: "True",
  opIsFalse: "False",
  opIn: "Is any of",
  opNotIn: "Is none of",
  opBlank: "Is blank",
  opNotBlank: "Is not blank",
  searchValues: "Search values",
  selectAll: "Select all",
  blanks: "(Blanks)",
  noValues: "No values to choose from",
  valuesFailed: "Could not load values",
  filtersTab: "Filters",
  hiddenColumn: "Hidden",
  noFilters: "No filters applied",
  clearAllFilters: "Clear all filters",
  noMatches: "No rows match the current filters",
  clearFilters: "Clear filters",
  groupedBadge: "Grouped",
  groupCount: (count) => `(${count})`,
  groupRow: (value, count) => `${value}, ${count === 1 ? "1 row" : `${count} rows`}`,
  groupContinued: (path) => `${path.join(" › ")} (continued)`,
  clearGrouping: "Clear grouping",
  rowGroupsTitle: "Row groups",
  rowGroupsHint: "Drag a column here to group rows by it",
  groupByColumn: (column) => `Group rows by ${column}`,
  ungroupColumn: (column) => `Remove ${column} from row groups`,
  rowGroupLevel: (column, level, total) => `${column}: group level ${level} of ${total}`,
  statusBarRows: (count) => `${count} rows total`,
  statusBarFiltered: (count, _raw, total) =>
    total === undefined ? `Filtered: ${count} rows` : `Filtered: ${count} of ${total} rows`,
  statusBarGroupedBy: (columns) => `Grouped by: ${columns.join(", ")}`,
}

/**
 * Whether the side panel is open, which tab it is on, and — for a shell that
 * opens it on one column — whose filter to expand.
 *
 * `focusNonce` gives a focus request its own identity, separate from
 * `focusColumnId`'s value: the header menu's "Filter in panel…" item can ask
 * for the SAME column twice in a row (open Amount, collapse it, ask for
 * Amount again), and a value-only comparison cannot tell that repeat apart
 * from an unrelated re-render — `focusColumnId` would already equal the
 * previous request. Bumping the nonce on every menu choice makes each
 * request distinguishable even when the column does not change.
 */
interface PanelState {
  open: boolean
  tab: PanelTab
  focusColumnId?: string | undefined
  focusNonce?: number | undefined
}

export interface DataTableProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  /** Shade alternate rows. */
  striped?: boolean
  /**
   * Fixed height for the whole table, toolbar included; the rows scroll inside it.
   *
   * Virtualisation needs a scroller, and the root has no height of its own:
   * with neither this nor an ancestor that has a height, the table grows to
   * fit its rows and every row renders. A table that ends up unbounded falls
   * back to `--dt-viewport-max-height` and warns in development, but the
   * height belongs here, where the layout is decided.
   *
   * This is the STARTING height. The grip on the bottom edge overrides it and
   * the override is part of the saved layout, so it survives a reload the way
   * a column width does; `instance.resetLayout()` drops it and this prop is
   * back in force. A host that owns the height itself turns the grip off with
   * `features: { heightGrip: false }`.
   */
  height?: number | string
  /**
   * Keep the header row(s) in view while the body scrolls. Default true.
   *
   * Turn it off for a short table inside a longer page, where a header that
   * follows the scroll is more distracting than useful.
   */
  stickyHeader?: boolean
  /** Hide the toolbar when the host application provides its own controls. */
  toolbar?: boolean
  /** Extra toolbar content, rendered at the toolbar's leading edge. */
  toolbarContent?: ReactNode
  /**
   * Actions for the rows that are selected, in a bar of their own above the
   * table — **rendered only while something is selected**.
   *
   * That is the whole difference from {@link DataTableProps.toolbarContent},
   * which is a static `ReactNode` and knows nothing about a selection. This
   * slot is for the thing that appears *because* rows were picked; a host that
   * wants a bar always on screen renders it from `toolbarContent` instead.
   *
   * It is handed the model, the query the selection is relative to, the count,
   * and `clear` — so a "Cancel" button does not have to reach back into the
   * instance. See the README's Row selection section for turning the model
   * into a `WHERE` clause.
   *
   * Explicitly `| undefined` under `exactOptionalPropertyTypes`: whether a
   * table offers bulk actions is usually a condition at the call site.
   *
   * @example
   * renderSelectionActions={({ count, clear }) => (
   *   <>
   *     <span>{count ?? "…"} selected</span>
   *     <button onClick={() => approve(selection).then(clear)}>Approve</button>
   *   </>
   * )}
   */
  renderSelectionActions?: ((selection: SelectionSummary) => ReactNode) | undefined
  /** Shown instead of rows when there are none. */
  emptyState?: ReactNode
  /**
   * Content revealed under an expanded row.
   *
   * Rendered in a full-width row beneath its parent. It may contain anything,
   * including another `<DataTable>` — nesting is not limited.
   *
   * Explicitly `| undefined` under `exactOptionalPropertyTypes`: whether a
   * table has detail panels is usually a condition at the call site
   * (`renderDetail={showDetail ? render : undefined}`), and an optional
   * property alone would reject that.
   */
  renderDetail?: ((row: TData) => ReactNode) | undefined
  labels?: Partial<DataTableLabels>
  /** Forces a theme instead of following the OS setting. */
  theme?: "light" | "dark"
  className?: string
  /**
   * Inline styles for the root element.
   *
   * This is where a design-system bridge goes — `style={muiTokens(theme)}`
   * spreads the `--dt-*` tokens straight onto the element that declares them.
   * An inline style beats every stylesheet rule, so tokens passed this way
   * also override the built-in dark-mode block and the `theme` prop above;
   * `muiTokens` documents what that means.
   *
   * The table's own two inline values win over anything here: `height`, which
   * the `height` prop and the resize grip own, and `--dt-row-height`, which
   * has to match the virtualiser's row estimate exactly (set it through
   * `rowHeight` / `getRowHeight` instead).
   */
  style?: CSSProperties | undefined
  onRowClick?: (row: TData) => void
  /** Show the pagination footer when paging is on. Default true. */
  footer?: boolean
  /** Render only the visible window of rows; `false` renders every row (printing, very small tables). Default true. */
  virtualize?: boolean
  /**
   * Rows are on their way. With no rows yet, skeleton rows show; with rows,
   * a progress bar and dimmed rows.
   *
   * In server mode this is also one of the four ways a host answers the query
   * the table announced — rows, a `rowCount`, an `error`, or `loading` turning
   * true. Until one of them arrives the table keeps its skeleton instead of
   * showing the empty state: `loading === false` on the commits before a host
   * can have started fetching means "nobody has asked yet", not "the server
   * has no rows". Report at least one, or the table has nothing to tell those
   * two apart.
   */
  loading?: boolean | undefined
  /**
   * Loading failed; rendered as a banner with a Retry button when `onRetry`
   * is given. Rows already on screen stay.
   */
  error?: unknown
  /** Called by the Retry button. */
  onRetry?: (() => void) | undefined
  /**
   * Save one cell's edit. Without it no column can be edited.
   *
   * This table never writes to its own data: an edit is a request, and the
   * rows it renders are the host's answer to one. Return a promise and the
   * cell shows the new value while it is in flight, marked as pending; a
   * rejection reverts the cell and says why. In server mode the host usually
   * refetches after a successful write, and the optimistic value steps aside
   * the moment that answer lands — including when the server normalised the
   * value into something else.
   *
   * A column opts in with `meta: { editable: "number" }`, or with a predicate
   * for a rule a row's own state decides. A column that declares `editable`
   * with no handler here is a misconfiguration, and the table says so once in
   * development.
   *
   * **Editing is pointer-only today.** A body cell cannot hold focus, so
   * there is nothing for the ContextMenu key or Shift+F10 to open a menu on.
   * A cell focus model is its own piece of work; until it lands, right-click
   * is the way in.
   *
   * @example
   * onCellEdit={async ({ row, columnId, value }) => {
   *   await api.patch(`/receipts/${row.id}`, { [columnId]: value })
   *   refetch()
   * }}
   */
  onCellEdit?: CellEditHandler<TData> | undefined
}

/** Elements a real Tab press stops on — the header's own Tab order below is built from these. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]'

/**
 * Whether `element` is actually reachable by Tab: focusable at all, and not
 * pulled out of the sequence with `tabindex="-1"`.
 */
function isTabbable(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  const explicit = element.getAttribute("tabindex")
  return explicit === null || Number(explicit) >= 0
}

/** Every element under `root` a real Tab press would stop on, in DOM order. */
function tabbableWithin(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isTabbable)
}

/**
 * The header's own focusable controls, in the order the columns are actually
 * drawn — a preorder walk of {@link ColumnTreeNode}, itself built from that
 * same rendered order (see `columnTree.ts`).
 *
 * A native `<table>` cannot put the controls in this order on its own: a
 * column outside any group spans every header row with `rowSpan` so one cell
 * can label it once, and a spanning cell has to live in the EARLIEST row it
 * covers — a browser has nowhere else to put it. That drags such a column's
 * controls ahead of a grouped column's in the DOM, and so in the default Tab
 * order, no matter which one is actually drawn further left (Defect C). This
 * is the corrected order; {@link DataTable}'s own `onKeyDown` is what steers
 * Tab into it.
 *
 * Matched to the tree by `data-column-id` and consumed one run at a time,
 * rather than assumed to already be in DOM order: a group split by a pinning
 * boundary (`columnTree.ts`) draws the same id twice, once per run, and each
 * run needs its own cell — the next one still waiting under that id, which is
 * why a match is shifted off the list rather than just read.
 */
function headerFocusOrder<TData extends RowData>(
  head: HTMLElement,
  nodes: readonly ColumnTreeNode<TData>[],
): HTMLElement[] {
  const cellsById = new Map<string, HTMLElement[]>()
  for (const cell of head.querySelectorAll<HTMLElement>("th[data-column-id]")) {
    const id = cell.getAttribute("data-column-id")
    if (id === null) continue
    const run = cellsById.get(id)
    if (run) run.push(cell)
    else cellsById.set(id, [cell])
  }

  const order: HTMLElement[] = []
  const visit = (level: readonly ColumnTreeNode<TData>[]): void => {
    for (const node of level) {
      const cell = cellsById.get(node.column.id)?.shift()
      if (cell) order.push(...tabbableWithin(cell))
      if (node.kind === "group") visit(node.children)
    }
  }
  visit(nodes)
  return order
}

/**
 * The batteries-included table.
 *
 * It renders {@link useDataTable}'s instance. The hook is exported separately,
 * so an application that wants different markup can keep the behaviour and
 * write its own shell.
 *
 * Two layout decisions are worth knowing about:
 *
 * - The toolbar sits OUTSIDE the scrolling viewport. Sticky headers stick to
 *   the top of whatever scrolls; a sticky toolbar in the same box would sit on
 *   top of them.
 * - Columns are never stretched to fill the container. The table is as wide
 *   as its container or as wide as its columns, whichever is larger, and any
 *   surplus goes to a blank filler column — the way AG Grid leaves space after
 *   its last column. Stretching would make every rendered width differ from
 *   `column.getSize()`, so dragging one handle would visibly resize them all
 *   and every pinned offset would be wrong.
 *
 * @example
 * const instance = useDataTable({ id: "receipts", data, columns })
 * <DataTable instance={instance} striped height={520} />
 */
export function DataTable<TData extends RowData>({
  instance,
  striped = false,
  height,
  stickyHeader = true,
  toolbar = true,
  toolbarContent,
  renderSelectionActions,
  emptyState,
  renderDetail,
  labels: labelOverrides,
  theme,
  className,
  style,
  onRowClick,
  footer = true,
  virtualize = true,
  loading = false,
  error,
  onRetry,
  onCellEdit,
}: DataTableProps<TData>) {
  const { table, flags } = instance
  const [panelOpen, setPanelOpen] = useState<PanelState>({ open: false, tab: "columns" })
  // A plain counter, bumped only from the menu's own click handler — never
  // during render — so each "Filter in panel…" choice gets a fresh identity
  // for `PanelState.focusNonce` to carry.
  const focusNonceRef = useRef(0)
  const [menu, setMenu] = useState<{ columnId: string; at: HeaderMenuPosition } | null>(null)
  const [filterAt, setFilterAt] = useState<{ columnId: string; at: HeaderMenuPosition } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLTableSectionElement>(null)
  // Where the "Clear filters" button in the empty state sends focus once it
  // clears itself out of existence — see the click handler below.
  const searchInputRef = useRef<HTMLInputElement>(null)
  const labels = { ...defaultLabels, ...labelOverrides }
  const { autosize, autosizeAll } = useAutosize(instance, tableRef)

  /*
   * The move itself belongs to the hook, not to this shell: a move can touch
   * two layout slices at once — `columnOrder` and, for a pinned column, the
   * pinning array that decides the order of its section — and only the hook
   * can land both in one state transition. See `reorderColumn`.
   */
  const handleReorder = instance.reorderColumn

  /*
   * §8.2 asks for focus to return to the menu item that opened the popover.
   * That item is gone — the menu closes as the popover opens — so focus goes
   * to the control that opened the menu instead: the column's ⋮ button, which
   * is the element still on screen in the same place.
   *
   * Which column to focus is recorded here and acted on one commit later, by
   * the layout effect below. Moving the focus from this callback would move it
   * while the popover is still mounted, and leaving the editor's value field
   * is exactly what commits a typed draft (FilterEditor.tsx) — so Escape would
   * apply the draft it exists to discard.
   */
  const restoreFocusRef = useRef<string | null>(null)
  const closeFilter = useCallback(() => {
    restoreFocusRef.current = filterAt?.columnId ?? null
    setFilterAt(null)
  }, [filterAt])

  useIsomorphicLayoutEffect(() => {
    const columnId = restoreFocusRef.current
    // Only once the popover is really gone, and only for a close this
    // component asked for: a first render, or the popover opening, must not
    // pull the focus anywhere.
    if (filterAt !== null || columnId === null) return
    restoreFocusRef.current = null
    /*
     * Matched by walking the headers rather than by a `[data-column-id="…"]`
     * selector: a column id is whatever the host's accessor or header string
     * produced, and quotes or brackets in one would make that selector throw.
     */
    for (const header of tableRef.current?.querySelectorAll("th[data-column-id]") ?? []) {
      if (header.getAttribute("data-column-id") !== columnId) continue
      header.querySelector<HTMLButtonElement>(".dt-kebab")?.focus()
      return
    }
  }, [filterAt])

  /**
   * Whether a column has a filter editor to offer at all.
   *
   * One gate for both of the menu's filter items, so the popover and the panel
   * route can never disagree about which columns are filterable. Task 17 uses
   * it again for the second item.
   */
  const canFilter = (columnId: string): boolean => {
    const column = table.getColumn(columnId)
    return column !== undefined && canFilterColumn(instance, column)
  }

  const rows = table.getRowModel().rows
  const leafColumns = renderedLeafColumns(table)
  const fillerAt = fillerIndex(table)
  /*
   * The header as a tree, rebuilt from the RENDERED order — which is what the
   * user is looking at, and what `handleReorder` falls back to on the first
   * drag.
   */
  const headerTree = buildColumnTree(leafColumns)
  /**
   * Steers Tab/Shift+Tab among the header's own controls into
   * {@link headerFocusOrder} instead of the DOM order a mixed
   * grouped/ungrouped `<table>` produces (Defect C).
   *
   * Never a positive `tabindex`: those are a well-known trap because they are
   * global, not scoped to a widget — they would reorder the whole document
   * around this one table's header. This intercepts the keypress instead. At
   * either end of the header's own order it hands off to whatever the
   * document's real focus order has right after — or before — the header,
   * found the same way a browser would if the header were already in the
   * right order, so leaving it behaves exactly like leaving any other widget.
   */
  const handleHeaderTabKey = (event: ReactKeyboardEvent<HTMLTableSectionElement>): void => {
    if (event.key !== "Tab") return
    const head = headRef.current
    const active = document.activeElement
    if (head === null || !(active instanceof HTMLElement) || !head.contains(active)) return

    const order = headerFocusOrder(head, headerTree)
    const at = order.indexOf(active)
    if (at === -1) return

    const forward = !event.shiftKey
    const withinHeader = order[at + (forward ? 1 : -1)]
    if (withinHeader) {
      event.preventDefault()
      withinHeader.focus()
      return
    }

    // Off either end of the header's own order: the header's controls run
    // out, not the document's, so the next stop is whatever the document's
    // real Tab order puts right after (or before) wherever this end's
    // control actually sits in the DOM.
    const boundary = order[forward ? order.length - 1 : 0]
    if (!boundary) return
    const documentOrder = tabbableWithin(document)
    const boundaryAt = documentOrder.indexOf(boundary)
    const next = boundaryAt === -1 ? undefined : documentOrder[boundaryAt + (forward ? 1 : -1)]
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }
  /*
   * A drag moves a column among its SIBLINGS and nowhere else, so that is the
   * order each slot is resolved against: a leaf steps past the leaves beside
   * it, a group header past the whole groups beside it. Resolving a group's
   * move in the flat leaf order would answer with a leaf halfway through the
   * group being dragged, because a six-column move does not land on
   * one-column steps.
   *
   * Both are the same `dropSlotId` over the same kind of array, which is why
   * the slot a group draws and the slot a leaf draws keep the same promise —
   * and why `HeaderCell` can go on asking one question, "is the slot me".
   *
   * The dragged and target columns are both unpinned — `HeaderCell` refuses a
   * drag or a drop on anything else — so a slot always resolves inside the
   * centre section, and the relative move it describes is the one
   * `reorderColumn` performs on the stored column order.
   */
  const drop = useDropSlot((draggedId) => siblingOrderOf(headerTree, draggedId))
  /**
   * The column in flight, when it is one the rows have values in.
   *
   * A group header is draggable too, and a group is not such a column: the
   * Row Groups zone below would mint a ghost chip for a level the grouping can
   * never hold. Asked of the table rather than of the tree so it stays true
   * for a column the header is not currently showing.
   */
  const draggedLeafId =
    drop.draggedId !== null && table.getColumn(drop.draggedId)?.columns.length === 0
      ? drop.draggedId
      : null
  /*
   * Header rows are assembled per pinning section rather than from the merged
   * `getHeaderGroups()`. The merged tree keeps a group in one piece even when
   * only some of its leaves are pinned, so its header would have to choose
   * between sticking (on top of the columns that really are pinned) and
   * scrolling away from its pinned leaf. Built per section, a group that
   * straddles the seam gets one header on each side — which is how AG Grid
   * renders it too — and every header can be pinned the way its leaves are.
   */
  const headerSections = [
    table.getStartHeaderGroups(),
    table.getCenterHeaderGroups(),
    table.getEndHeaderGroups(),
  ] as const
  const headerRowCount = table.getHeaderGroups().length
  /*
   * `rows` is one page once pagination is on — client mode slices it via
   * TanStack's own paginated row model, server mode is handed one page to
   * begin with — so a row's position within `rows` restarts at 0 on every
   * page. `aria-rowindex` has to count from the table's start, not the
   * page's, so every row below adds this offset back on top of its position.
   * Zero with pagination off, where `rows` already is the whole table.
   */
  const rowIndexOffset = instance.pagination.enabled
    ? instance.pagination.pageIndex * instance.pagination.pageSize
    : 0
  /*
   * The real row total, across every page — what `aria-rowcount` reports,
   * offset by `headerRowCount` below. `rows.length` is only that total with
   * paging off; with it on, the true total is `instance.pagination.rowCount`,
   * which is `undefined` for a server table whose first page has not
   * answered yet. ARIA's own -1 ("unknown") is what a screen reader is told
   * to expect for exactly that case, standing for the whole attribute rather
   * than added to a header count.
   */
  const totalRowCount = instance.pagination.enabled ? instance.pagination.rowCount : rows.length
  const isResizing = Boolean(table.state.columnResizing?.isResizingColumn)
  /*
   * Cell editing. It is handed the rows it will be asked about and the labels
   * it will speak, and it is `undefined` for a table no column made editable —
   * which is what leaves the browser's own context menu alone over one (§2).
   */
  const cellEditing = useCellEditing({
    instance,
    rows,
    labels,
    onCellEdit,
    // A right-click during a drag is how a user gets out of the drag, not a
    // request for a menu on whatever cell the pointer is over.
    busy: isResizing || drop.draggedId !== null,
  })
  const editing = cellEditing.enabled ? cellEditing : undefined
  const hasError = error !== undefined && error !== null
  /*
   * A server table has asked for its first page and not been answered yet.
   * Those commits look identical to "the server has no rows" — nothing, no
   * error, not loading — so the empty state has to wait for them. See
   * {@link useAwaitingFirstPage}.
   */
  const awaitingFirstPage = useAwaitingFirstPage({
    server: instance.mode === "server",
    rows: rows.length,
    rowCount: instance.pagination.rowCount,
    loading,
    hasError,
  })
  const showSkeleton = (loading || awaitingFirstPage) && rows.length === 0 && !hasError
  const showEmpty = !loading && !awaitingFirstPage && !hasError && rows.length === 0
  /*
   * The skeleton already communicates "loading" on its own; a progress bar
   * and dimmed rows on top of it would be a second, redundant signal (and
   * there is no `tbody` of real rows to dim yet).
   */
  const showProgress = loading && !showSkeleton
  /*
   * Whether the empty state can offer anything to undo. An empty state with no
   * exit is the classic filter dead end: "No rows" is true of a table with no
   * data and of a table narrowed to nothing, and only the second is something
   * the user can undo. Grouping narrows the same way filtering does, so it
   * earns the same way out.
   */
  const hasEmptyWayOut = instance.filtering.isFiltered || instance.grouping.isGrouped
  /*
   * Virtualisation needs something to scroll. A table nobody gave a height to
   * grows to fit its rows instead, and then renders all of them; this notices
   * that state and asks the stylesheet for a fallback bound. A table that is
   * already bounded — by the prop, by an ancestor, by anything — never enters
   * it. See {@link useUnboundedViewport}.
   */
  /*
   * The height actually in force. The `height` prop is the starting height and
   * the grip overrides it; `resetLayout` drops the override, which puts the
   * prop back. Only one of the two is ever on the root, so the two can never
   * be half-applied.
   */
  const tableHeight = instance.tableHeight
  const resolvedHeight = tableHeight.value ?? height
  const unbounded = useUnboundedViewport({
    viewportRef,
    rows: rows.length,
    /*
     * A table with a height is bounded, however it got one — so a grip drag
     * takes it out of the rescue's scope the same way the prop does. Without
     * this the check would go on watching a table that has just been given a
     * height, and a table that had ALREADY latched (rendered tall, with no
     * height at all) would keep `--dt-viewport-max-height` clamping its
     * viewport to 70vh while the root stood at whatever the user dragged: the
     * rows would stop short of the bottom edge and the gap would grow with
     * every further drag. The latch never clears, so the attribute below is
     * gated on the same condition rather than on the latch alone.
     */
    enabled: virtualize && !showSkeleton && resolvedHeight === undefined,
    id: instance.id,
  })
  /*
   * `--dt-row-height` is what the stylesheet sizes a row with, and the
   * virtualiser's estimate has to match it exactly — an unmeasured data row
   * whose real height differs by a pixel drags the scrollbar off by a pixel
   * per row. Publishing the instance's value here keeps the two in step.
   *
   * The host's `style` is spread FIRST, so both of this table's own values
   * survive it: a `height` the prop or the grip decided, and the row height
   * the virtualiser is estimating with. Everything else a host passes —
   * `muiTokens`' tokens included — lands untouched.
   */
  const rootStyle = {
    ...style,
    ...(resolvedHeight === undefined ? undefined : { height: resolvedHeight }),
    "--dt-row-height": `${instance.rowHeight}px`,
  } as CSSProperties

  /*
   * Which tabs the rail offers, in rail order. Columns is the tab the panel
   * has always had, and it exists only where there is something to arrange;
   * Filters joins it only when filtering is on. An empty list means this
   * table has no side bar at all, and no rail is drawn — which is also the
   * only state in which the panel has no way in, because the rail IS the way
   * in since the toolbar's Columns button was dropped.
   */
  const sideBarTabs: PanelTab[] = []
  if (flags.hiding || flags.pinning) sideBarTabs.push("columns")
  /*
   * Independent of Columns: the header menu's "Filter in panel…" always
   * offers this tab when a column can be filtered, whether or not hiding or
   * pinning happen to be on, so its existence has to be independent of them
   * too — otherwise that item opens a panel that never renders (Defect D).
   */
  if (instance.filtering.enabled) sideBarTabs.push("filters")

  /**
   * Activating a rail tab: the tab already showing closes the panel, any other
   * switches to it.
   *
   * @param tab - The tab that was activated.
   */
  const toggleSideBarTab = (tab: PanelTab): void => {
    setPanelOpen((state) => ({ open: !(state.open && state.tab === tab), tab }))
  }

  /**
   * Close the side bar's panel, keeping the tab it was on so the rail reopens
   * where the user left it.
   */
  const closePanel = useCallback(() => {
    setPanelOpen((state) => ({ open: false, tab: state.tab }))
  }, [])

  /** Where focus goes when an empty-state button clears itself out of existence. */
  const restoreEmptyStateFocus = (): void => {
    const focusTarget = searchInputRef.current ?? viewportRef.current
    focusTarget?.focus()
  }

  return (
    <div
      ref={rootRef}
      className={classNames("dt-root", className, isResizing && "dt-is-resizing")}
      style={rootStyle}
      data-dt-theme={theme}
    >
      {/*
        The table's own column — toolbar, status, viewport, footer. It is one
        flex child of the root and the side bar is the other, so opening a
        panel takes width from here instead of painting over it. `min-width:
        0` in the stylesheet is what lets this column actually give that
        width up; without it a flex item refuses to shrink under its content
        and the side bar would push the table's right-hand columns out of
        the card.
      */}
      <div className="dt-main">
        {toolbar ? (
          <div className="dt-toolbar">
            {toolbarContent}
            {instance.filtering.enabled ? (
              <QuickSearch instance={instance} labels={labels} loading={loading} inputRef={searchInputRef} />
            ) : null}
            {/*
              The spacer stays although nothing follows it any more: it is
              what pushes a host's `toolbarContent` and the search box to the
              leading edge, and without it they would spread across the row.
            */}
            <span className="dt-spacer" />
          </div>
        ) : null}

        {/*
          The bulk-action bar. Mounted only while something is selected, which
          is the one thing that tells it apart from `toolbarContent`.

          It appears once, when the first row is ticked, and goes once, when
          the last is unticked — it does NOT come and go as the count changes,
          so the table is not pushed down and back on every tick. Its entrance
          animates `transform` and `opacity` only, and `styles.css` drops that
          under `prefers-reduced-motion`.
        */}
        {renderSelectionActions && !instance.selection.isEmpty ? (
          <div className="dt-selection-bar">{renderSelectionActions(instance.selection.summary)}</div>
        ) : null}

        <TableStatus loading={showProgress} error={error} onRetry={onRetry} labels={labels} />

        <CellEditNotice
          notice={cellEditing.notice}
          labels={labels}
          onDismiss={cellEditing.dismissNotice}
        />

        <div
          className={classNames("dt-viewport", showProgress && "dt-loading")}
          data-dt-unbounded={unbounded && resolvedHeight === undefined ? "" : undefined}
          ref={viewportRef}
          /*
           * A real Tab stop (Defect A): in the default configuration — no
           * `renderDetail`, so no per-row "Expand row" button — nothing
           * inside the body is itself focusable, and `tabIndex={-1}` used to
           * take the whole scroller out of the Tab order with it. That left
           * PageDown / ArrowDown / End with nothing focused to act on, so a
           * keyboard user could not reach rows the viewport was clipping —
           * most of them, past the first screenful. `0` restores Chrome's
           * (and other browsers') own "keyboard-focusable scroller" default:
           * a focused, overflowing element answers the scroll keys on its
           * own, no handler required here.
           *
           * Still the same legal target the "Clear filters" button below
           * sends the focus to programmatically when there is no search box
           * to take it instead — `.focus()` never depended on the element
           * being IN the Tab order, only on it being focusable at all, which
           * a non-negative `tabIndex` still is.
           *
           * `cell-focus-spec.md`'s future roving-tabindex grid replaces this
           * with per-cell tab stops — the viewport's own `tabIndex` would
           * revert to `-1` then, because the grid's cells would be the real
           * stops and entering one is what would scroll it into view. That
           * is a further step, not a reason to leave the table unscrollable
           * by keyboard until it ships.
           */
          tabIndex={0}
          aria-label={labels.tableBody}
        >
          <table
            ref={tableRef}
            className={classNames("dt-table", striped && "dt-striped")}
            style={{ width: "100%", minWidth: table.getTotalSize() }}
            /*
             * Only a window of rows is in the DOM — from virtualisation, and
             * from pagination once it is on, where `rows` is one page — so the
             * count a screen reader would infer from the DOM is wrong either
             * way. `aria-rowcount` states the real total across every page —
             * `totalRowCount`, header rows included, since `aria-rowindex`
             * counts them — or ARIA's own -1 ("unknown") outright while that
             * total has not arrived yet.
             */
            aria-rowcount={totalRowCount === undefined ? -1 : totalRowCount + headerRowCount}
          >
            {/*
              Under `table-layout: fixed` the browser takes column widths from the
              first row only — which, with grouped headers, is a row of spanning
              cells. A colgroup states the widths directly, so nested headers and
              resizing stop fighting each other. The filler has no width: it takes
              whatever the columns leave over, which is nothing once they overflow.
            */}
            <colgroup>
              {insertAt(
                leafColumns.map((column) => (
                  <col
                    key={column.id}
                    data-column-id={column.id}
                    style={{ width: column.getSize() }}
                  />
                )),
                fillerAt,
                <col key="filler" className="dt-col-filler" />,
              )}
            </colgroup>

            <thead ref={headRef} onKeyDown={handleHeaderTabKey}>
              {Array.from({ length: headerRowCount }, (_, depth) => {
                const [start, center, end] = headerSections.map((section) =>
                  (section[depth]?.headers ?? [])
                    /*
                     * TanStack marks a header that a taller cell above already
                     * covers with rowSpan 0. Rendering those would repeat every
                     * label once per header row.
                     */
                    .filter((header) => header.rowSpan > 0)
                    .map((header) => (
                      <HeaderCell
                        key={header.id}
                        header={header}
                        flags={flags}
                        labels={labels}
                        sticky={stickyHeader}
                        grouped={instance.grouping.has(header.column.id)}
                        groupColumnId={instance.grouping.columnId}
                        onReorder={handleReorder}
                        onOpenMenu={(at) => setMenu({ columnId: header.column.id, at })}
                        onAutosize={autosize}
                        drop={drop}
                        selection={instance.selection.enabled ? instance.selection : undefined}
                      />
                    )),
                )
                // The filler's header spans every header row and sits between
                // the scrolling and the end-pinned headers, like the column.
                const filler =
                  depth === 0 ? (
                    <th
                      key="filler"
                      className="dt-th dt-th-filler"
                      role="presentation"
                      rowSpan={headerRowCount > 1 ? headerRowCount : undefined}
                      style={stickyHeader ? { top: 0 } : undefined}
                    />
                  ) : null
                return (
                  <tr key={depth} aria-rowindex={depth + 1}>
                    {start}
                    {center}
                    {filler}
                    {end}
                  </tr>
                )
              })}
            </thead>

            {showSkeleton ? (
              <SkeletonRows
                widths={insertAt(
                  leafColumns.map((column) => column.getSize()),
                  fillerAt,
                  0,
                )}
                count={Math.min(instance.pagination.pageSize, 8)}
              />
            ) : (
              <TableBody
                instance={instance}
                rows={rows}
                viewportRef={viewportRef}
                headRef={headRef}
                fillerAt={fillerAt}
                columnCount={leafColumns.length + 1}
                headerRowCount={headerRowCount}
                rowIndexOffset={rowIndexOffset}
                labels={labels}
                virtualize={virtualize}
                renderDetail={renderDetail}
                onRowClick={onRowClick}
                editing={editing}
              />
            )}
          </table>

          {showEmpty ? (
            <div className="dt-empty">
              {/* A host's own `emptyState` wins over both branches below. */}
              {emptyState ??
                (hasEmptyWayOut ? (
                  <>
                    <p className="dt-empty-text">{labels.noMatches}</p>
                    {/*
                      Every button here disappears the instant the rows come
                      back (`showEmpty` goes false), and React does not
                      relocate focus for an element that unmounts under it —
                      the same defect `QuickSearch`'s own clear button exists
                      to avoid (WCAG 2.4.3; see its comment). The toolbar's
                      search box is the natural landing spot when there is
                      one; with `toolbar={false}` there is nothing of ours
                      left on screen to hold focus, so it falls back to the
                      viewport, which is a legal `.focus()` target whatever
                      its `tabIndex` happens to be.
                    */}
                    {instance.filtering.isFiltered ? (
                      <button
                        type="button"
                        className="dt-menu-button"
                        onClick={() => {
                          instance.filtering.clearAll()
                          restoreEmptyStateFocus()
                        }}
                      >
                        {/*
                          `clearAll` clears the search as well as the
                          conditions, so one button is the whole way out
                          either way — but it has to NAME the thing in the
                          way, the same rule the grouping button below
                          follows. A user who emptied the table by typing in
                          the search box is not looking for a filter to
                          clear, and being offered one reads as the table
                          having misunderstood them.
                        */}
                        {instance.filtering.conditions.length > 0
                          ? labels.clearFilters
                          : labels.clearSearch}
                      </button>
                    ) : null}
                    {/*
                      A grouping can empty a table on its own — a group on a
                      column the endpoint does not serve, or one whose every
                      key was filtered away — and then "Clear filters" is
                      either absent or does not help. The way out has to name
                      the thing that is actually in the way.
                    */}
                    {instance.grouping.isGrouped ? (
                      <button
                        type="button"
                        className="dt-menu-button"
                        onClick={() => {
                          instance.grouping.clear()
                          restoreEmptyStateFocus()
                        }}
                      >
                        {labels.clearGrouping}
                      </button>
                    ) : null}
                  </>
                ) : (
                  labels.empty
                ))}
            </div>
          ) : null}
        </div>

        {/*
          Anything but a bare `false` renders the band — see
          `DataTableFeatureFlags.statusBar`. Between the viewport and the
          footer, which is where AG Grid's own status bar sits relative to
          its pagination panel, and what lets `<TablePagination>` treat this
          as the surface that now owns the row count.
        */}
        {flags.statusBar !== false ? <StatusBar instance={instance} labels={labels} /> : null}

        {footer ? <TablePagination instance={instance} labels={labels} /> : null}
      </div>

      {sideBarTabs.length > 0 ? (
        <TableSideBar
          instance={instance}
          labels={labels}
          onReorder={handleReorder}
          tabs={sideBarTabs}
          open={panelOpen.open}
          tab={panelOpen.tab}
          onToggle={toggleSideBarTab}
          /*
           * Switching tabs drops any pending `focusColumnId`: it belongs to
           * the request that opened the Filters tab, and carrying it across a
           * round trip to Columns and back would re-expand an editor the user
           * had collapsed.
           */
          onTabChange={(tab) => setPanelOpen((state) => ({ open: state.open, tab }))}
          onClose={closePanel}
          /*
           * A header drag is a drag the panel cannot see the start of, and
           * `dataTransfer` is unreadable until the drop — so the column in
           * flight is handed over here, which is what lets the Row Groups zone
           * draw a slot for a column dragged straight off its header.
           *
           * Only a leaf: a group header is draggable too now, and a group has
           * no values of its own to group rows by — a ghost chip for one would
           * offer a level the grouping could never hold.
           */
          draggedColumnId={draggedLeafId}
          focusColumnId={panelOpen.focusColumnId}
          focusNonce={panelOpen.focusNonce}
        />
      ) : null}

      {tableHeight.enabled ? (
        <HeightGrip
          rootRef={rootRef}
          value={tableHeight.value}
          rowHeight={instance.rowHeight}
          step={tableHeight.step}
          coarseStep={tableHeight.coarseStep}
          onChange={tableHeight.set}
          labels={labels}
        />
      ) : null}

      {menu ? (
        <HeaderMenu
          column={table.getColumn(menu.columnId)!}
          position={menu.at}
          flags={flags}
          labels={labels}
          onAutosize={() => autosize(menu.columnId)}
          onAutosizeAll={autosizeAll}
          isGrouped={instance.grouping.has(menu.columnId)}
          onOpenFilter={
            canFilter(menu.columnId)
              ? () => setFilterAt({ columnId: menu.columnId, at: menu.at })
              : undefined
          }
          onOpenFilterInPanel={
            canFilter(menu.columnId)
              ? () =>
                  setPanelOpen({
                    open: true,
                    tab: "filters",
                    focusColumnId: menu.columnId,
                    focusNonce: ++focusNonceRef.current,
                  })
              : undefined
          }
          onClose={() => setMenu(null)}
        />
      ) : null}

      {cellEditing.menu ? (
        <CellMenu
          position={cellEditing.menu.at}
          labels={labels}
          notEditable={cellEditing.menu.notEditable}
          onEdit={cellEditing.openEditor}
          onClose={cellEditing.closeMenu}
          /* The cell it was opened on; `BodyRow` makes exactly that one
             focusable while the menu is up. */
          returnFocusTo={cellEditing.menu.anchor}
        />
      ) : null}

      {filterAt ? (
        <FilterPopover
          instance={instance}
          column={table.getColumn(filterAt.columnId)!}
          position={filterAt.at}
          labels={labels}
          onClose={closeFilter}
        />
      ) : null}
    </div>
  )
}
