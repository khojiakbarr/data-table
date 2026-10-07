import type { CardSlot } from "../types"

/** Every place of a card, in the order a card is read. */
export const CARD_SLOTS: readonly CardSlot[] = [
  "code",
  "status",
  "actions",
  "leading",
  "title",
  "subtitle",
  "amount",
  "amountNote",
  "fields",
  "chips",
  "trailing",
]

/** A column as the card sees it: its id, and the place its meta asks for. */
export interface CardColumn {
  id: string
  card?: CardSlot | false | undefined
}

/** The columns of each place of a card, in column order. */
export type CardPlaces = Record<CardSlot, string[]>

/**
 * Which column goes where on a card.
 *
 * A column that names a place takes it; `false` leaves the column off the
 * card. A column that names none is a field — "label: value" — so nothing a
 * table shows is lost on a phone because nobody placed it; but while no column
 * of the table is the `title`, the first unplaced one is, or a card would
 * have no name at all.
 *
 * The chrome columns — the selection, the row numbers, the timeline — are
 * the caller's to leave out: they are drawn by the card itself, or not at all.
 *
 * @param columns - The visible columns, in display order, chrome left out.
 * @returns Each place's column ids.
 *
 * @example
 * cardPlaces([{ id: "code", card: "code" }, { id: "name", card: undefined }, { id: "note", card: undefined }])
 * // { code: ["code"], title: ["name"], fields: ["note"], … }
 */
export function cardPlaces(columns: readonly CardColumn[]): CardPlaces {
  const places = Object.fromEntries(CARD_SLOTS.map((slot) => [slot, [] as string[]])) as CardPlaces
  let needsTitle = !columns.some((column) => column.card === "title")
  for (const column of columns) {
    if (column.card === false) continue
    if (column.card !== undefined) {
      // A place this version does not know (a typo in plain JS) is a field rather than a crash mid-render.
      const known: string[] | undefined = places[column.card]
      const place = known ?? places.fields
      place.push(column.id)
    } else if (needsTitle) {
      places.title.push(column.id)
      needsTitle = false
    } else {
      places.fields.push(column.id)
    }
  }
  return places
}

/**
 * Whether a cell's value is nothing to show: absent, an empty string, an
 * empty list. A card draws no line for it — an empty line, or a dash, is
 * noise the eye reads past on every card. A column with no value of its own
 * (a display column: a menu, a computed badge) is not asked this; its cell
 * decides what to draw.
 *
 * @param value - The cell's raw value.
 */
export function isBlankCardValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === "string") return value.trim() === ""
  if (Array.isArray(value)) return value.length === 0
  return false
}
