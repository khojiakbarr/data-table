// @vitest-environment node
import { useEffect, useLayoutEffect } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect"

/**
 * Renders with a real absence of `window`, the only place in this suite
 * that does: every other test file runs under vitest's default `jsdom`
 * environment, where `window` is always defined, so `typeof window ===
 * "undefined"` never turns true anywhere else. Without the
 * `@vitest-environment node` pragma above, the hook's SSR branch has no test
 * that can reach it — see {@link useIsomorphicLayoutEffect}.
 *
 * The branch is verified by reference identity, not by React's
 * "useLayoutEffect does nothing on the server" console warning: as of React
 * 19, `react-dom/server`'s hooks dispatcher resolves BOTH `useEffect` and
 * `useLayoutEffect` to the same silent no-op during a server render (verified
 * against the installed `react-dom` package — the warning string does not
 * exist anywhere in its server bundles), so that warning is no longer a
 * signal a test can observe. `useIsomorphicLayoutEffect` is a plain
 * module-scope ternary, so which hook it resolved to is directly observable
 * as which function it *is*.
 */
function Probe() {
  useIsomorphicLayoutEffect(() => {})
  return null
}

describe("useIsomorphicLayoutEffect on the server", () => {
  it("runs in an environment with no window, where the SSR branch applies", () => {
    expect(typeof window).toBe("undefined")
  })

  it("resolves to useEffect, not useLayoutEffect, when there is no window", () => {
    expect(useIsomorphicLayoutEffect).toBe(useEffect)
    expect(useIsomorphicLayoutEffect).not.toBe(useLayoutEffect)
  })

  it("renders through react-dom/server without throwing", () => {
    expect(() => renderToString(<Probe />)).not.toThrow()
  })
})
