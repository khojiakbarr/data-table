import { useEffect, useRef } from "react"
import type { LayoutStorage, TableLayout } from "../types"

/** How long to wait after the last change before writing. */
const SAVE_DELAY_MS = 350

/**
 * Persist a layout, but not on every frame.
 *
 * Resizing runs in `onChange` mode, so a single drag produces a state update
 * per pointer move — sixty a second. Writing straight through means sixty
 * `JSON.stringify` calls and sixty synchronous `localStorage` writes per drag,
 * which is enough to make the column judder under the cursor on a modest
 * machine, and far worse for a storage adapter that talks to a server.
 *
 * Only the settled layout is worth keeping, so the write waits for the drag to
 * stop. A pending write is flushed on unmount, so a layout is never lost by
 * navigating away mid-gesture.
 *
 * @param storage - Where to write.
 * @param id - The table's id.
 * @param layout - The current layout.
 * @param enabled - False on the first render, so mounting does not re-save what
 *   was just loaded.
 */
export function useDebouncedSave(
  storage: LayoutStorage,
  id: string,
  layout: TableLayout,
  enabled: boolean,
): void {
  const pending = useRef<TableLayout | null>(null)
  const latest = useRef({ storage, id })
  latest.current = { storage, id }

  useEffect(() => {
    if (!enabled) return
    pending.current = layout

    const timer = setTimeout(() => {
      if (pending.current) {
        latest.current.storage.save(latest.current.id, pending.current)
        pending.current = null
      }
    }, SAVE_DELAY_MS)

    return () => clearTimeout(timer)
  }, [storage, id, layout, enabled])

  // Flush whatever the last timer did not get to.
  useEffect(() => {
    return () => {
      if (pending.current) {
        latest.current.storage.save(latest.current.id, pending.current)
        pending.current = null
      }
    }
  }, [])
}
