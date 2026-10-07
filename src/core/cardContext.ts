import { createContext, useContext } from "react"

/** True inside a card of a table drawn as cards (`CardList`); false in the table. */
export const CardContext = createContext(false)

/**
 * Whether the cell rendering now is on a card rather than in a table row —
 * for a cell that says less on a card: a figure a phone has no room for, or
 * the same sum in the base currency that a card in the base currency would
 * only repeat. A cell that renders nothing on a card takes no room there; its
 * place, or its field's line, goes with it.
 *
 * A column's `cell` is rendered as a component, so the hook may be called in
 * it directly.
 *
 * @returns True on a card.
 *
 * @example
 * cell: function TotalBase({ row }) {
 *   return useInCard() && row.original.currency === base ? null : formatMoney(row.original.total_base)
 * }
 */
export function useInCard(): boolean {
  return useContext(CardContext)
}
