import type { RowData } from "@tanstack/react-table"
import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { classNames, insertAt } from "../core/classNames"
import { fillerIndex, renderedLeafColumns } from "../core/pinning"
import { useDropSlot } from "../core/useDropSlot"
import { useAutosize } from "../core/useAutosize"
import { useIsomorphicLayoutEffect } from "../core/useIsomorphicLayoutEffect"
import { useAwaitingFirstPage } from "../core/useAwaitingFirstPage"
import { useUnboundedViewport } from "../core/useUnboundedViewport"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { HeaderMenu, type HeaderMenuPosition } from "./HeaderMenu"
import { TablePanel, type PanelTab } from "./TablePanel"
import { QuickSearch } from "./QuickSearch"
import { canFilterColumn } from "./FilterEditor"
import { FilterPopover } from "./FilterPopover"
import { HeaderCell } from "./HeaderCell"
import { TableBody } from "./TableBody"
import { TablePagination } from "./TablePagination"
import { SkeletonRows, TableStatus } from "./TableStatus"

/** English defaults; pass `labels` to translate. */
export const defaultLabels: DataTableLabels = {
  columnsButton: "Columns",
  columnsTitle: "Columns",
  showAll: "Show all",
  reset: "Reset",
  pinStart: "Pin to start",
  pinEnd: "Pin to end",
  unpin: "Unpin",
  hide: "Hide",
  sortAscending: "Sort ascending",
  sortDescending: "Sort descending",
  clearSort: "Clear sort",
  empty: "No rows",
  dragHint: "Drag to reorder",
  reorderHint: "Press Space to pick up, arrow keys to move, Space to drop, Escape to cancel",
  reorderPosition: (column, position, total) => `${column}: position ${position} of ${total}`,
  resizeColumn: "resize column",
  expandRow: "Expand row",
  collapseRow: "Collapse row",
  columnActions: "Column actions",
  autosize: "Fit this column",
  autosizeAll: "Fit all columns",
  resetWidth: "Reset width",
  pinnedStartBadge: "Start",
  pinnedEndBadge: "End",
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
  /** Extra toolbar content, rendered before the Columns button. */
  toolbarContent?: ReactNode
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
  emptyState,
  renderDetail,
  labels: labelOverrides,
  theme,
  className,
  onRowClick,
  footer = true,
  virtualize = true,
  loading = false,
  error,
  onRetry,
}: DataTableProps<TData>) {
  const { table, flags } = instance
  const [panelOpen, setPanelOpen] = useState<PanelState>({ open: false, tab: "columns" })
  // A plain counter, bumped only from the menu's own click handler — never
  // during render — so each "Filter in panel…" choice gets a fresh identity
  // for `PanelState.focusNonce` to carry.
  const focusNonceRef = useRef(0)
  const [menu, setMenu] = useState<{ columnId: string; at: HeaderMenuPosition } | null>(null)
  const [filterAt, setFilterAt] = useState<{ columnId: string; at: HeaderMenuPosition } | null>(null)
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
   * Resolved against the RENDERED order, which is what the user is looking at
   * and what `handleReorder` falls back to on the first drag. The dragged and
   * target columns are both unpinned — `HeaderCell` refuses a drag or a drop
   * on anything else — so the slot always resolves inside the centre section,
   * and the relative move it describes is the same one `moveColumn` performs
   * on the stored column order.
   */
  const drop = useDropSlot(leafColumns.map((column) => column.id))
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
   * Virtualisation needs something to scroll. A table nobody gave a height to
   * grows to fit its rows instead, and then renders all of them; this notices
   * that state and asks the stylesheet for a fallback bound. A table that is
   * already bounded — by the prop, by an ancestor, by anything — never enters
   * it. See {@link useUnboundedViewport}.
   */
  const unbounded = useUnboundedViewport({
    viewportRef,
    rows: rows.length,
    enabled: virtualize && !showSkeleton,
    id: instance.id,
  })
  /*
   * `--dt-row-height` is what the stylesheet sizes a row with, and the
   * virtualiser's estimate has to match it exactly — an unmeasured data row
   * whose real height differs by a pixel drags the scrollbar off by a pixel
   * per row. Publishing the instance's value here keeps the two in step.
   */
  const rootStyle = {
    ...(height === undefined ? undefined : { height }),
    "--dt-row-height": `${instance.rowHeight}px`,
  } as CSSProperties

  return (
    <div
      className={classNames("dt-root", className, isResizing && "dt-is-resizing")}
      style={rootStyle}
      data-dt-theme={theme}
    >
      {toolbar ? (
        <div className="dt-toolbar">
          {toolbarContent}
          {instance.filtering.enabled ? (
            <QuickSearch instance={instance} labels={labels} loading={loading} inputRef={searchInputRef} />
          ) : null}
          <span className="dt-spacer" />
          {flags.hiding || flags.pinning ? (
            <button
              type="button"
              className="dt-menu-button"
              aria-expanded={panelOpen.open}
              aria-haspopup="dialog"
              onClick={() => setPanelOpen((state) => ({ open: !state.open, tab: state.tab }))}
            >
              {labels.columnsButton}
            </button>
          ) : null}
        </div>
      ) : null}

      {panelOpen.open ? (
        <TablePanel
          instance={instance}
          labels={labels}
          onReorder={handleReorder}
          onClose={() => setPanelOpen((state) => ({ open: false, tab: state.tab }))}
          tab={panelOpen.tab}
          onTabChange={(tab) => setPanelOpen({ open: true, tab })}
          focusColumnId={panelOpen.focusColumnId}
          focusNonce={panelOpen.focusNonce}
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

      {filterAt ? (
        <FilterPopover
          instance={instance}
          column={table.getColumn(filterAt.columnId)!}
          position={filterAt.at}
          labels={labels}
          onClose={closeFilter}
        />
      ) : null}

      <TableStatus loading={showProgress} error={error} onRetry={onRetry} labels={labels} />

      <div
        className={classNames("dt-viewport", showProgress && "dt-loading")}
        data-dt-unbounded={unbounded ? "" : undefined}
        ref={viewportRef}
        /*
         * Not part of the Tab order — `-1` keeps it out of a sighted
         * keyboard user's normal path across the table — but a legal target
         * for the programmatic focus the "Clear filters" button below sends
         * here when there is no search box of ours to take it instead.
         */
        tabIndex={-1}
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

          <thead ref={headRef}>
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
                      onReorder={handleReorder}
                      onOpenMenu={(at) => setMenu({ columnId: header.column.id, at })}
                      onAutosize={autosize}
                      drop={drop}
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
            />
          )}
        </table>

        {showEmpty ? (
          <div className="dt-empty">
            {/*
              An empty state with no exit is the classic filter dead end: "No
              rows" is true of a table with no data and of a table filtered to
              nothing, and only one of them is something the user can undo.
              A host's own `emptyState` still wins over both.
            */}
            {emptyState ??
              (instance.filtering.isFiltered ? (
                <>
                  <p className="dt-empty-text">{labels.noMatches}</p>
                  <button
                    type="button"
                    className="dt-menu-button"
                    onClick={() => {
                      instance.filtering.clearAll()
                      /*
                       * This button disappears the instant the rows come
                       * back (`showEmpty` goes false), and React does not
                       * relocate focus for an element that unmounts under
                       * it — the same defect `QuickSearch`'s own clear
                       * button exists to avoid (WCAG 2.4.3; see its
                       * comment). The toolbar's search box is the natural
                       * landing spot when there is one; with `toolbar={false}`
                       * there is nothing of ours left on screen to hold
                       * focus, so it falls back to the viewport, which
                       * `tabIndex={-1}` makes a legal target without adding
                       * it to the Tab order.
                       */
                      const focusTarget = searchInputRef.current ?? viewportRef.current
                      focusTarget?.focus()
                    }}
                  >
                    {labels.clearFilters}
                  </button>
                </>
              ) : (
                labels.empty
              ))}
          </div>
        ) : null}
      </div>

      {footer ? <TablePagination instance={instance} labels={labels} /> : null}
    </div>
  )
}
