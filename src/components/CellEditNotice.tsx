import { classNames } from "../core/classNames"
import type { EditNotice } from "../core/useCellEditing"
import type { DataTableLabels } from "../types"

/**
 * What the table says when an edit did not go the way the user expected.
 *
 * Three things end up here: a write the host refused, an editor abandoned
 * because its row left the page, and a saved edit that moved its row out of
 * what the filters match. All three are consequences of an action the user
 * took a moment ago and can no longer see, which is the one thing they have
 * in common and the reason they share a surface.
 *
 * Not `TableStatus`, although it is the same strip in the same slot.
 * `TableStatus` describes the table's LOADING state: it is derived from props,
 * it comes and goes with them, and it has no way to be dismissed because
 * there is nothing to dismiss — the state either holds or it does not. This
 * one reports something that already happened and then stayed true, so it
 * lives until the reader is done with it. §3 asks for exactly that: a
 * rejection "says so, and the message must survive long enough to read".
 *
 * There is deliberately no timer. A notice that removes itself is a notice
 * that removes itself while somebody is still reading it, and the only honest
 * duration — long enough for this reader, on this day — is not a number.
 */
export interface CellEditNoticeProps {
  notice: EditNotice | null
  labels: DataTableLabels
  onDismiss: () => void
}

/**
 * The edit notice strip, or nothing when there is nothing to say.
 *
 * @param props - See {@link CellEditNoticeProps}.
 * @returns The strip, announced assertively for a failure and politely
 *   otherwise.
 *
 * @example
 * <CellEditNotice notice={editing.notice} labels={labels} onDismiss={editing.dismissNotice} />
 */
export function CellEditNotice({ notice, labels, onDismiss }: CellEditNoticeProps) {
  if (notice === null) return null
  return (
    <div
      className={classNames("dt-edit-notice", notice.tone === "error" && "dt-edit-notice-error")}
      /*
       * A refused write interrupts: the value the user is looking at is about
       * to revert under them. A cancelled editor or a vanished row is already
       * done, and waiting for a pause in whatever the screen reader is saying
       * costs nothing.
       */
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <span>{notice.text}</span>
      <button type="button" className="dt-menu-button" onClick={onDismiss}>
        {labels.dismiss}
      </button>
    </div>
  )
}
