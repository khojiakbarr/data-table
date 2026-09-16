import { useEffect, useLayoutEffect } from "react"

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server.
 *
 * A layout effect exists to read or correct the DOM before the browser paints.
 * There is no paint during server rendering, so React warns once per component
 * that uses one — noise a library has no business adding to its host's logs.
 * Choosing the hook at module scope keeps the pre-paint timing where it
 * matters and drops it where it cannot apply.
 *
 * @example
 * useIsomorphicLayoutEffect(() => {
 *   if (pageIndex > lastPage) setPageIndex(lastPage)
 * })
 */
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect
