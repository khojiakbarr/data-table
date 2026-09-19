import type { RowData } from "@tanstack/react-table"
import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react"
import type { DropSide } from "../core/reorder"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { TablePanel, type PanelTab } from "./TablePanel"

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
  /** Which tabs the rail offers, in rail order. At least one. */
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
  /** See `TablePanelProps.focusNonce`. */
  focusNonce?: number | undefined
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
}: TableSideBarProps<TData>) {
  const railRef = useRef<HTMLDivElement>(null)
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
              <span className="dt-sidebar-tab-text">{labelOf(name)}</span>
            </button>
          )
        })}
      </div>

      {open ? (
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
        />
      ) : null}
    </div>
  )
}
