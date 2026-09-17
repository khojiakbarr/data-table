import { useEffect, useState } from "react"

/**
 * A value as it settles, rather than as it changes.
 *
 * Used for quick search, where the raw text belongs in state on the keystroke —
 * so the input stays a normal controlled field and the existing layout save
 * persists it — while everything downstream of it waits: `state.globalFilter`
 * and `search` on the wire. That placement is also why this needs no `pagehide`
 * flush of its own: nothing is being withheld from state that could be lost.
 *
 * The first value is published immediately, so a table restored from storage
 * with a search term does not start unfiltered for `delayMs`.
 *
 * @param value - The value to follow.
 * @param delayMs - How long the value must hold still before it is published.
 * @returns The last value that held still for `delayMs`, and the first one immediately.
 *
 * @example
 * const published = useDebouncedValue(layout.search.trim(), 300)
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    // A value that returns to the settled one mid-flight cancels the wait
    // rather than republishing what is already published.
    if (Object.is(value, settled)) return
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, settled, delayMs])

  return settled
}
