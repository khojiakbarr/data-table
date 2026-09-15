const warned = new Set<string>()

/**
 * Say a thing once per process.
 *
 * A hook runs on every render, and a misconfiguration that a render can see is
 * one every render can see. Without this, a warning meant to be read once
 * becomes a console that scrolls — which is how a real warning gets muted.
 *
 * @param message - The warning; identical messages are said once.
 *
 * @example
 * if (process.env.NODE_ENV !== "production" && isServer && !getRowId) {
 *   warnOnce(`useDataTable("${id}"): mode "server" without getRowId ...`)
 * }
 */
export function warnOnce(message: string): void {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(message)
}
