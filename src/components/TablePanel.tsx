import type { RowData } from "@tanstack/react-table"
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { classNames } from "../core/classNames"
import type { DropSide } from "../core/reorder"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { ColumnsTab } from "./ColumnsTab"
import { FiltersTab } from "./FiltersTab"

/**
 * The side panel behind the "Columns" button.
 *
 * It owns what both tabs share — the dismissal rules, the tab strip and the
 * one scrolling box — and nothing else. Which tab is showing is the caller's
 * state, so a header-menu item or a host's own control can open the panel
 * straight onto one of them.
 */

/** Which half of the panel is showing. */
export type PanelTab = "columns" | "filters"

/**
 * How the panel is presented, which is also what decides how it dismisses.
 *
 * It is a declared prop and never inferred from where the panel happens to be
 * mounted: the same markup in two places must not behave two ways.
 *
 * - `"floating"` — a popover over the table, with its own tab strip. It closes
 *   on a pointer press outside itself and on Escape from anywhere, because a
 *   popover that survives either is a trap. This is the default, and what
 *   {@link ColumnPanel} has always rendered.
 * - `"docked"` — furniture inside {@link TableSideBar}, in flow beside the
 *   table rather than over it. The side bar's rail supplies the tabs, so the
 *   panel renders none of its own; it does not close on an outside click (a
 *   docked bar is not dismissed by using the table it sits next to), and
 *   Escape closes it only while the focus is inside it.
 */
export type PanelPresentation = "floating" | "docked"

const TABS: readonly PanelTab[] = ["columns", "filters"]

export interface TablePanelProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
  onClose: () => void
  /** Which tab is showing. */
  tab: PanelTab
  onTabChange: (tab: PanelTab) => void
  /**
   * Popover or docked furniture, and with it the dismissal rules — see
   * {@link PanelPresentation}. Default `"floating"`.
   */
  presentation?: PanelPresentation | undefined
  /** On the Filters tab, open this column's editor and focus it. */
  focusColumnId?: string | undefined
  /**
   * Identifies this particular focus request. A host that wants a repeat
   * request for the SAME `focusColumnId` to be honoured again — not just the
   * first time that column is named — bumps this on every request; the
   * built-in shell does, from the header menu. Omit it and every *change* of
   * `focusColumnId` is still honoured; only naming the same column twice in a
   * row is then indistinguishable from a re-render, and does nothing.
   */
  focusNonce?: number | undefined
}

/**
 * The tabbed side panel.
 *
 * @param props - See {@link TablePanelProps}.
 * @returns The panel: floating, a dialog with a tab strip that stays put above
 *   its one scrolling box; docked, the tab panel the side bar's rail controls.
 *
 * @example
 * const [tab, setTab] = useState<PanelTab>("columns")
 * <TablePanel instance={instance} labels={labels} tab={tab} onTabChange={setTab}
 *   onReorder={handleReorder} onClose={close} />
 */
export function TablePanel<TData extends RowData>({
  instance,
  labels,
  onReorder,
  onClose,
  tab,
  onTabChange,
  presentation = "floating",
  focusColumnId,
  focusNonce,
}: TablePanelProps<TData>) {
  const ref = useRef<HTMLDivElement>(null)
  const docked = presentation === "docked"
  const tabbed = instance.filtering.enabled && !docked
  // With filtering off there is no second tab, and no strip to choose it with.
  const current: PanelTab = instance.filtering.enabled ? tab : "columns"

  // Close on outside click and on Escape, the two things a user will try of a
  // popover. A docked panel answers to neither — see `PanelPresentation`.
  useEffect(() => {
    if (docked) return
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [docked, onClose])

  /*
   * Arrow keys move between tabs, which is what a screen-reader user expects
   * of a tablist; the roving `tabIndex` below is the other half of that
   * pattern, so Tab enters the strip once rather than once per tab.
   */
  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const next = TABS[(TABS.indexOf(current) + delta + TABS.length) % TABS.length]
    if (next === undefined) return
    onTabChange(next)
    ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus()
  }

  /*
   * Docked, Escape is handled here rather than on `document`, which is exactly
   * what makes it fire only while the focus is inside the panel: a React
   * handler on this element sees a keydown only when it bubbles up from a
   * descendant. A descendant that spends the key on something of its own —
   * ColumnsTab cancelling a held column — stops it before it arrives.
   */
  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return
    event.stopPropagation()
    onClose()
  }

  const bodyId = `${instance.id}-panel-${current}`

  return (
    <div
      className={classNames("dt-panel", docked ? "dt-panel-docked" : "dt-panel-floating")}
      ref={ref}
      {...(docked
        ? {
            // The rail's tab is the accessible name and the control; naming
            // the panel again here would have a screen reader read the tab's
            // text twice on entering it.
            role: "tabpanel",
            id: bodyId,
            "aria-labelledby": `${instance.id}-railtab-${current}`,
            onKeyDown: handlePanelKeyDown,
          }
        : {
            role: "dialog",
            "aria-label": current === "columns" ? labels.columnsTitle : labels.filtersTab,
          })}
    >
      {tabbed ? (
        <div className="dt-panel-tabs" role="tablist" onKeyDown={handleTabKeyDown}>
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              data-tab={name}
              id={`${instance.id}-tab-${name}`}
              className="dt-panel-tab"
              aria-selected={current === name}
              aria-controls={`${instance.id}-panel-${name}`}
              tabIndex={current === name ? 0 : -1}
              onClick={() => onTabChange(name)}
            >
              {name === "columns" ? labels.columnsTitle : labels.filtersTab}
            </button>
          ))}
        </div>
      ) : null}

      {/* The one scrolling box: the strip above it stays put. */}
      <div
        className="dt-panel-body"
        {...(docked ? {} : { id: bodyId })}
        {...(tabbed
          ? { role: "tabpanel", "aria-labelledby": `${instance.id}-tab-${current}` }
          : {})}
      >
        {current === "filters" ? (
          <FiltersTab
            instance={instance}
            labels={labels}
            focusColumnId={focusColumnId}
            focusNonce={focusNonce}
          />
        ) : (
          <ColumnsTab instance={instance} labels={labels} onReorder={onReorder} />
        )}
      </div>
    </div>
  )
}
