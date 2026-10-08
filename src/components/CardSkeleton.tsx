import type { CardPlaces } from "../core/cardLayout"
import type { CardSlot } from "../types"

/** A skeleton card shows a card's first fields, not the whole list of them. */
const SKELETON_FIELDS = 3

type BarShape = "line" | "pill" | "action" | "avatar"

/**
 * One card while the first page is on its way, in the shape the table's cards
 * will take: drawn from the same places (`cardPlaces`), so a bar stands where
 * the code goes, a pill where the status does, the title and its subtitle on
 * the left with the amount and its note on the right, a line per field (the
 * first {@link SKELETON_FIELDS}), the chips and the trailing mark along the
 * foot. Each bar sits in the place's own element, in that place's type, so a
 * line of the skeleton is as tall as the line of text it stands for, and the
 * list does not jump when the rows arrive.
 *
 * A pill, the ⋮ and an avatar are the host's controls, whose size the library
 * cannot know: `--dt-card-skeleton-pill-height`, `--dt-card-skeleton-action-size`
 * and `--dt-card-skeleton-avatar-size` are there for a host to match its own.
 *
 * @param places - Which columns go where, as the cards will be laid out.
 */
export function CardSkeleton({ places }: { places: CardPlaces }) {
  const has = (slot: CardSlot): boolean => places[slot].length > 0
  const hasTop = has("code") || has("status") || has("actions")
  const hasMain = has("leading") || has("title") || has("subtitle") || has("amount") || has("amountNote")
  const fields = places.fields.slice(0, SKELETON_FIELDS)

  return (
    <div className="dt-card dt-card-skeleton" aria-hidden="true">
      {hasTop ? (
        <div className="dt-card-top">
          {has("code") ? <span className="dt-card-code"><Bar width="6em" /></span> : null}
          <span className="dt-spacer" />
          {has("status") ? <span className="dt-card-status"><Bar shape="pill" /></span> : null}
          {has("actions") ? <span className="dt-card-actions"><Bar shape="action" /></span> : null}
        </div>
      ) : null}
      {hasMain ? (
        <div className="dt-card-main">
          {has("leading") ? <span className="dt-card-leading"><Bar shape="avatar" /></span> : null}
          <div className="dt-card-heading">
            {has("title") ? <div className="dt-card-title"><Bar width="62%" /></div> : null}
            {has("subtitle") ? <div className="dt-card-subtitle"><Bar width="40%" /></div> : null}
          </div>
          {has("amount") || has("amountNote") ? (
            <div className="dt-card-figure">
              {has("amount") ? <div className="dt-card-amount"><Bar width="6.5em" /></div> : null}
              {has("amountNote") ? <div className="dt-card-note"><Bar width="5em" /></div> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {fields.length > 0 ? (
        <dl className="dt-card-fields">
          {fields.map((id) => (
            <div key={id} className="dt-card-field">
              <dt><Bar width="5em" /></dt>
              <dd><Bar width="40%" /></dd>
            </div>
          ))}
        </dl>
      ) : null}
      {has("chips") || has("trailing") ? (
        <div className="dt-card-foot">
          {has("chips") ? <span className="dt-card-chips"><Bar shape="pill" /></span> : null}
          <span className="dt-spacer" />
          {has("trailing") ? (
            <span className="dt-card-end">
              <span className="dt-card-trailing"><Bar shape="avatar" /></span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * A grey bar in a place's cell. It is a cell, so the rules that hide an empty
 * place keep this one; a line is its text's height, the rest the host's size.
 */
function Bar({ width, shape = "line" }: { width?: string; shape?: BarShape }) {
  return (
    <span className="dt-card-cell">
      <span className={`dt-card-bar dt-card-bar-${shape}`} style={width === undefined ? undefined : { width }} />
    </span>
  )
}
