import type { RowData } from "@tanstack/react-table"
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react"
import type { DropSide } from "../core/reorder"
import type { DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { ColumnsTab } from "./ColumnsTab"
import { FiltersTab } from "./FiltersTab"

/**
 * The side panel behind the "Columns" button.
 *
 * It owns what both tabs share — the outside-click and Escape handling, the
 * tab strip, and the one scrolling box — and nothing else. Which tab is
 * showing is the caller's state, so a header-menu item or a host's own control
 * can open the panel straight onto one of them.
 */

/** Which half of the panel is showing. */
export type PanelTab = "columns" | "filters"

const TABS: readonly PanelTab[] = ["columns", "filters"]

export interface TablePanelProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  labels: DataTableLabels
  onReorder: (draggedId: string, targetId: string, side: DropSide) => void
  onClose: () => void
  /** Which tab is showing. */
  tab: PanelTab
  onTabChange: (tab: PanelTab) => void
  /** On the Filters tab, open this column's editor and focus it. */
  focusColumnId?: string | undefined
  /**
   * Identifies this particular focus request. A host that wants a repeat
   * request for the SAME `focusColumnId` to be honoured again — not just the
   * first time that column is named — bumps this on every request; the
   * built-in shell does, from the header menu. Omit it and only the first
   * request for a given column takes effect while this component stays
   * mounted.
   */
  focusNonce?: number | undefined
}

/**
 * The tabbed side panel.
 *
 * @param props - See {@link TablePanelProps}.
 * @returns The panel dialog: a tab strip that stays put, and the one scrolling
 *   box under it holding whichever tab is showing.
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
  focusColumnId,
  focusNonce,
}: TablePanelProps<TData>) {
  const ref = useRef<HTMLDivElement>(null)
  const tabbed = instance.filtering.enabled
  // With filtering off there is no second tab, and no strip to choose it with.
  const current: PanelTab = tabbed ? tab : "columns"

  // Close on outside click and on Escape, the two things a user will try.
  useEffect(() => {
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
  }, [onClose])

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

  return (
    <div
      className="dt-panel"
      ref={ref}
      role="dialog"
      aria-label={current === "columns" ? labels.columnsTitle : labels.filtersTab}
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
        id={`${instance.id}-panel-${current}`}
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
