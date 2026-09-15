import { useCallback, useEffect, useRef } from "react"
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
 * stop. A pending write is flushed on unmount and when the page is hidden, so
 * a layout is never lost by navigating away mid-gesture.
 *
 * The adapter is read through a ref rather than listed as a dependency: the
 * documented usage is `storage: localStorageLayout()` inline, a fresh object
 * on every render of the host. Keying the timer on that identity restarted
 * the wait on every unrelated re-render — a host re-rendering faster than the
 * delay never saved at all, one re-rendering slower re-saved an unchanged
 * layout each time.
 *
 * @param storage - Where to write.
 * @param id - The table's id.
 * @param layout - The current layout.
 * @param enabled - Whether `layout` holds a change the user made since mount.
 *   While false nothing is queued, so mounting does not re-save what was just
 *   loaded and a reset is not undone by the flush.
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

  const flush = useCallback(() => {
    if (!pending.current) return
    latest.current.storage.save(latest.current.id, pending.current)
    pending.current = null
  }, [])

  useEffect(() => {
    if (!enabled) {
      pending.current = null
      return
    }
    pending.current = layout
    const timer = setTimeout(flush, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [id, layout, enabled, flush])

  // A full navigation gives no unmount; `pagehide` is the last chance to write.
  useEffect(() => {
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [flush])
}
