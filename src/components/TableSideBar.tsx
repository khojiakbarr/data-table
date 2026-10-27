import type { RowData } from "@tanstack/react-table"
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { formatCount } from "../core/formatCount"
import type { DropSide } from "../core/reorder"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { TablePanel, type PanelTab } from "./TablePanel"
import type { FiltersPanelSlot } from "../types"

/**
 * The docked side bar: a rail of vertical tabs on the table's inline-end edge,
 * and the panel one of them opens.
 *
 * The rail is furniture — it is there whether or not a panel is open, the way
 * AG Grid's is — and opening a panel takes width from the table beside it
 * rather than covering it. That is the whole point of docking here: this table
 * scrolls horizontally, so a floating panel would sit on top of columns the
 * user cannot scroll out from under it.
 */

export interface TableSideBarProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
  /**
   * Which tabs the rail offers, in rail order. At least one — unless a
   * `sortControl` is drawn, which cards may hold with no tab at all.
   */
  tabs: readonly PanelTab[]
  /** Whether the panel beside the rail is showing. */
  open: boolean
  /** The current tab, open or not — the rail remembers it while closed. */
  tab: PanelTab
  /**
   * A tab was activated: the same tab closes the panel, another switches to
   * it. The rail states both halves through `aria-expanded`, so the toggle is
   * announced rather than merely discovered.
   */
  onToggle: (tab: PanelTab) => void
  /**
   * The arrow keys moved along the rail. This changes which tab is current
   * WITHOUT opening or closing the panel: arrowing past a rail is navigation,
   * and a drawer that flies open under the caret is not what the user asked
   * for.
   */
  onTabChange: (tab: PanelTab) => void
  /** The panel asked to close — its own Escape, from inside. */
  onClose: () => void
  /** On the Filters tab, open this column's editor and focus it. */
  focusColumnId?: string | undefined
  /** See `ColumnsTabProps.draggedColumnId`. */
  draggedColumnId?: string | null | undefined
  /** See `TablePanelProps.focusNonce`. */
  focusNonce?: number | undefined
  /** The host's own filters for the Filters tab; see `FiltersPanelSlot`. */
  filtersPanel?: FiltersPanelSlot | undefined
  /**
   * How many rows the cards draw of how many there are — «20/200» at the strip's
   * end on a phone, where the rail reads across. Absent, nothing is counted.
   */
  shown?: { count: number; total: number } | undefined
  /**
   * The cards' sort control (0.17.0), drawn after the tabs: at the row's end,
   * before the count, on a phone; under the tabs where the rail stands upright.
   * Outside the `tablist`, which holds tabs only.
   */
  sortControl?: ReactNode
}

/**
 * The rail, and the docked panel it controls.
 *
 * @param props - See {@link TableSideBarProps}.
 * @returns The side bar: a vertical `tablist` pinned to the table's
 *   inline-end edge, and — while open — the panel for the current tab.
 *
 * @example
 * <TableSideBar instance={instance} labels={labels} tabs={["columns", "filters"]}
 *   open={open} tab={tab} onToggle={toggle} onTabChange={setTab}
 *   onClose={close} onReorder={handleReorder} />
 */
export function TableSideBar<TData extends RowData>({
  instance,
  labels,
  onReorder,
  tabs,
  open,
  tab,
  onToggle,
  onTabChange,
  onClose,
  focusColumnId,
  focusNonce,
  draggedColumnId,
  filtersPanel,
  shown,
  sortControl,
}: TableSideBarProps<TData>) {
  const railRef = useRef<HTMLDivElement>(null)
  const activeCount = filtersPanel?.activeCount ?? 0
  const labelOf = (name: PanelTab): string =>
    name === "columns" ? labels.columnsTitle : labels.filtersTab

  /** Move the focus onto a rail tab, which is also how the rail rolls. */
  const focusRailTab = (name: PanelTab): void => {
    railRef.current?.querySelector<HTMLButtonElement>(`[data-rail-tab="${name}"]`)?.focus()
  }

  /*
   * Escape came from inside the panel, which is about to unmount with the
   * focus still in it — and React does not relocate focus out of a subtree it
   * removes, so it would land on <body> (WCAG 2.4.3). The rail tab is the
   * control that opened the panel and is still on screen, so focus goes there
   * FIRST: moving it while the panel is still mounted is what makes it stick.
   */
  const handleClose = (): void => {
    focusRailTab(tab)
    onClose()
  }

  /*
   * A vertical tablist moves with the vertical arrows, and the roving
   * `tabIndex` below is the other half of that pattern: Tab enters the rail
   * once rather than once per tab. Home and End are the ends of the rail,
   * which is cheap here and is what a screen-reader user will try.
   */
  const handleRailKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = tabs.indexOf(tab)
    if (index < 0) return
    const next =
      event.key === "ArrowDown"
        ? tabs[(index + 1) % tabs.length]
        : event.key === "ArrowUp"
          ? tabs[(index - 1 + tabs.length) % tabs.length]
          : event.key === "Home"
            ? tabs[0]
            : event.key === "End"
              ? tabs[tabs.length - 1]
              : undefined
    if (next === undefined) return
    event.preventDefault()
    onTabChange(next)
    focusRailTab(next)
  }

  return (
    <div className="dt-sidebar" data-dt-open={open ? "" : undefined}>
      {/*
        The rail and, on a phone, the count at its end: one row there, and no
        box at all where the rail stands upright (`display: contents`).
      */}
      <div className="dt-sidebar-head">
      {tabs.length > 0 ? (
      <div
        className="dt-sidebar-rail"
        ref={railRef}
        role="tablist"
        aria-orientation="vertical"
        aria-label={labels.sideBar}
        onKeyDown={handleRailKeyDown}
      >
        {tabs.map((name) => {
          const showing = open && tab === name
          return (
            <button
              key={name}
              type="button"
              role="tab"
              data-rail-tab={name}
              id={`${instance.id}-railtab-${name}`}
              className="dt-sidebar-tab"
              aria-selected={showing}
              /*
               * Both states, deliberately. `aria-selected` is which tab the
               * rail is on; `aria-expanded` is whether its panel is showing —
               * and a collapsible tablist needs both, or a screen-reader user
               * pressing the selected tab is never told the panel went away.
               */
              aria-expanded={showing}
              {...(showing ? { "aria-controls": `${instance.id}-panel-${name}` } : {})}
              tabIndex={tab === name ? 0 : -1}
              onClick={() => onToggle(name)}
            >
              {/*
                Rotated by `writing-mode` in the stylesheet, so this stays one
                run of real text: selectable, findable, and read out as a word
                rather than as a column of letters.
              */}
              {/* An upright glyph before the word (0.19.0): which tab is which at a glance. */}
              <RailTabIcon tab={name} />
              <span className="dt-sidebar-tab-text">{labelOf(name)}</span>
              {name === "filters" && activeCount > 0 ? (
                <>
                  {/*
                    The number is drawn for the eye and spoken as words: a bare
                    "2" after "Filters" is ambiguous read aloud.
                  */}
                  <span className="dt-sidebar-tab-count" aria-hidden="true">
                    {activeCount}
                  </span>
                  <span className="dt-sr-only">, {labels.activeFiltersCount(activeCount)}</span>
                </>
              ) : null}
            </button>
          )
        })}
      </div>
      ) : null}
      {sortControl}
      {shown ? (
        <span className="dt-sidebar-shown">
          {/* Drawn for the eye, spoken as words: «20/200» read aloud is a fraction. */}
          <span aria-hidden="true">{`${formatCount(shown.count)}/${formatCount(shown.total)}`}</span>
          <span className="dt-sr-only">{labels.shownOfTotal(shown.count, shown.total)}</span>
        </span>
      ) : null}
      </div>

      {open && tabs.length > 0 ? (
        <TablePanel
          instance={instance}
          labels={labels}
          presentation="docked"
          onReorder={onReorder}
          onClose={handleClose}
          tab={tab}
          onTabChange={onTabChange}
          focusColumnId={focusColumnId}
          focusNonce={focusNonce}
          draggedColumnId={draggedColumnId}
          filtersPanel={filtersPanel}
        />
      ) : null}
    </div>
  )
}

/**
 * A rail tab's glyph: three columns for Columns, a funnel for Filters. An SVG is
 * not turned by `writing-mode`, so it stays upright beside the rotated word.
 *
 * @param props.tab - Which tab it is drawn for.
 */
function RailTabIcon({ tab }: { tab: PanelTab }) {
  return (
    <svg
      className="dt-sidebar-tab-icon"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {tab === "columns" ? (
        <path d="M1.5 2.5 H12.5 V11.5 H1.5 Z M5.2 2.5 V11.5 M8.8 2.5 V11.5" />
      ) : (
        <path d="M1.5 2.5 H12.5 L8.3 7.4 V11.5 L5.7 10.3 V7.4 Z" />
      )}
    </svg>
  )
}
