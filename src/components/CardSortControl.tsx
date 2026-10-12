import type { SortingState } from "@tanstack/react-table"
import { useCallback, useRef, useState } from "react"
import { cardSortSummary, nextCardSorting, type CardSortChoice, type CardSortOption } from "../core/cardSort"
import { useMenuSurface } from "../core/useMenuSurface"
import type { DataTableLabels } from "../types"
import type { HeaderMenuPosition } from "./HeaderMenu"

/**
 * The sort control cards draw in the rail (0.17.0), where the header's sort
 * button is not drawn: a button naming the sort — «Срок годности ↑», or
 * «Сортировка» while there is none — and the menu it opens.
 *
 * It writes the table's own sorting, through the same `setSorting` a header
 * click reaches, so the page goes back to the first, the cards start over, a
 * server host's `onQueryChange` hears the new `sorting`, the layout keeps it,
 * and the table drawn again shows the same arrows. The menu is the library's
 * one menu (`useMenuSurface`, `.dt-menu`): placed in the viewport, closed by
 * Escape or a press outside, roved by the arrow keys, the focus handed back to
 * the button when it closes.
 */

export interface CardSortControlProps {
  /** The columns it offers, in order. At least one: with none it is not drawn. */
  options: readonly CardSortOption[]
  /** The table's sorting now. */
  sorting: SortingState
  /** Writes the table's sorting — the instance's own `table.setSorting`. */
  onSortingChange: (sorting: SortingState) => void
  /** A column's name by id, for a sort by a column the menu does not offer (hidden, say). */
  labelOf: (id: string) => string
  labels: DataTableLabels
}

/**
 * The rail's sort button and its menu.
 *
 * @param props - See {@link CardSortControlProps}.
 * @returns The button, and while open the menu beside it.
 *
 * @example
 * <CardSortControl options={options} sorting={table.getState().sorting}
 *   onSortingChange={table.setSorting} labelOf={labelOf} labels={labels} />
 */
export function CardSortControl({ options, sorting, onSortingChange, labelOf, labels }: CardSortControlProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [at, setAt] = useState<HeaderMenuPosition | null>(null)
  const summary = cardSortSummary(sorting, labelOf)
  const close = useCallback(() => setAt(null), [])
  /*
   * A press on the button while its menu is open closes the menu before the
   * click arrives — the focus leaving the menu, or a press outside it — so the
   * click would open it again. The press is remembered, and its click only
   * closes.
   */
  const pressedWhileOpen = useRef(false)

  const handleToggle = (): void => {
    if (at !== null || pressedWhileOpen.current) {
      pressedWhileOpen.current = false
      close()
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    setAt({ x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 2 })
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="dt-card-sort"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        data-dt-sorted={summary ? "" : undefined}
        onPointerDown={() => {
          pressedWhileOpen.current = at !== null
        }}
        onClick={handleToggle}
      >
        {summary ? (
          <>
            <span className="dt-sr-only">{labels.cardSort}:</span>{" "}
            <span className="dt-card-sort-label">{summary.label}</span>
            <span className="dt-card-sort-dir" aria-hidden="true">
              {summary.desc ? "↓" : "↑"}
              {summary.more > 0 ? ` +${summary.more}` : ""}
            </span>
            <span className="dt-sr-only">, {summary.desc ? labels.cardSortDescending : labels.cardSortAscending}</span>
          </>
        ) : (
          <span className="dt-card-sort-label">{labels.cardSort}</span>
        )}
      </button>
      {at !== null ? (
        <CardSortMenu
          at={at}
          options={options}
          sorting={sorting}
          labels={labels}
          returnFocusTo={buttonRef.current}
          onChoose={(choice) => {
            onSortingChange(nextCardSorting(sorting, choice))
            close()
          }}
          onClose={close}
        />
      ) : null}
    </>
  )
}

interface CardSortMenuProps {
  at: HeaderMenuPosition
  options: readonly CardSortOption[]
  sorting: SortingState
  labels: DataTableLabels
  returnFocusTo: HTMLElement | null
  onChoose: (choice: CardSortChoice) => void
  onClose: () => void
}

/**
 * The menu: the columns, then — once one is sorted — the two directions and
 * «no sorting». Each choice is a `menuitemradio` whose `aria-checked` says
 * what is in force, so a screen reader hears the current sort as it moves.
 */
function CardSortMenu({ at, options, sorting, labels, returnFocusTo, onChoose, onClose }: CardSortMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const placement = useMenuSurface(ref, { position: at, onDismiss: onClose, returnFocusTo })
  const first = sorting[0]

  return (
    <div
      className="dt-menu dt-card-sort-menu"
      ref={ref}
      role="menu"
      aria-label={labels.cardSort}
      style={{ left: placement.x, top: placement.y }}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="menuitemradio"
          className="dt-menu-item"
          aria-checked={first?.id === option.id}
          onClick={() => onChoose({ column: option.id })}
        >
          {option.label}
        </button>
      ))}
      {first !== undefined ? (
        <>
          <hr className="dt-menu-sep" />
          <button
            type="button"
            role="menuitemradio"
            className="dt-menu-item"
            aria-checked={!first.desc}
            onClick={() => onChoose({ desc: false })}
          >
            {labels.cardSortAscending}
          </button>
          <button
            type="button"
            role="menuitemradio"
            className="dt-menu-item"
            aria-checked={first.desc}
            onClick={() => onChoose({ desc: true })}
          >
            {labels.cardSortDescending}
          </button>
          <hr className="dt-menu-sep" />
          <button type="button" role="menuitem" className="dt-menu-item" onClick={() => onChoose("clear")}>
            {labels.cardSortClear}
          </button>
        </>
      ) : null}
    </div>
  )
}
