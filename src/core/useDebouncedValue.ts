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
 * @param publishToken - Bump this to publish the current value at once; see below.
 * @returns The last value that held still for `delayMs`, and the first one immediately.
 *
 * @example
 * const published = useDebouncedValue(layout.search.trim(), 300)
 */
export function useDebouncedValue<T>(value: T, delayMs: number, publishToken: number = 0): T {
  const [settled, setSettled] = useState(value)
  /*
   * The token a settled value belongs to. A caller that writes `value`
   * programmatically rather than a keystroke at a time — "Clear all", a URL
   * restore — bumps `publishToken` in the same update, and this publishes the
   * new value with it instead of announcing the old one for another `delayMs`.
   * A keystroke leaves the token alone and debounces exactly as before.
   */
  const [publishedToken, setPublishedToken] = useState(publishToken)

  /*
   * Adjusted during render, not from an effect. An effect settling the value
   * would still let the commit in between reach everything downstream — for
   * quick search, `onQueryChange` — as a real, intermediate query, which is
   * the whole thing a settle-now is for. React re-runs the component with the
   * adjusted state before committing, so that commit never happens.
   */
  if (publishedToken !== publishToken) {
    setPublishedToken(publishToken)
    if (!Object.is(value, settled)) setSettled(value)
  }

  useEffect(() => {
    // A value that returns to the settled one mid-flight cancels the wait
    // rather than republishing what is already published.
    if (Object.is(value, settled)) return
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, settled, delayMs])

  return publishedToken === publishToken ? settled : value
}
