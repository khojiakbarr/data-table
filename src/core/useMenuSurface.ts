import { useEffect, useRef, type RefObject } from "react"
import { useClampedPlacement, type ClampedPoint } from "./useClampedPlacement"

/**
 * The behaviour every pop-up menu in this library shares: where it opens, how
 * it is dismissed, and where the focus is when it is gone.
 *
 * Extracted from `HeaderMenu`, which solved all of it first. The cell menu
 * needs the same four answers, and a second copy of them is exactly how two
 * menus come to disagree about whether Escape closes them — so the copy is
 * this hook, used by both, rather than a paste.
 */

/** How one menu behaves. */
export interface MenuSurfaceOptions {
  /** Where the caller wants the menu's top-left corner, in viewport pixels. */
  position: ClampedPoint
  /** Called for every dismissal: Escape, or a pointer pressed outside the menu. */
  onDismiss: () => void
  /**
   * Where the focus goes when the menu unmounts — the cell that was
   * right-clicked, typically.
   *
   * Left out by a caller whose menu is opened by an element that survives it
   * (a header's ⋮ button keeps the focus it already had). When it is given,
   * the focus is only taken back if the menu still had it: a user who clicked
   * into something else while the menu was open has already said where they
   * want to be.
   */
  returnFocusTo?: HTMLElement | null | undefined
}

/**
 * Place a menu, dismiss it, and hand the focus back.
 *
 * On mount the menu's first item takes the focus, so the menu is operable from
 * the keyboard the moment it opens.
 *
 * @param ref - The menu element. May still be null on the render that first
 *   calls this hook; it is picked up when it mounts.
 * @param options - Where to open, how to close, and where the focus returns to.
 * @returns The corner to render the menu at, clamped into the viewport.
 *
 * @example
 * const placement = useMenuSurface(ref, { position: at, onDismiss: onClose })
 */
export function useMenuSurface(
  ref: RefObject<HTMLElement | null>,
  { position, onDismiss, returnFocusTo }: MenuSurfaceOptions,
): ClampedPoint {
  const placement = useClampedPlacement(ref, position)

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      // `instanceof Node` rather than a cast: an event target is not
      // necessarily a node (a media element's own events are not), and
      // `contains` would throw on one.
      const target = event.target
      if (target instanceof Node && ref.current?.contains(target) === true) return
      onDismiss()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [ref, onDismiss])

  // Focus the first item so the menu is usable from the keyboard.
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus()
  }, [ref])

  /*
   * Latest-ref: the element to return the focus to is *read* when the menu
   * closes, never depended on. Depending on it would re-run the effect — and
   * so run its cleanup, which moves the focus — every time the caller passed a
   * different node, which is mid-life, not at the end of it.
   */
  const returnFocusRef = useRef(returnFocusTo)
  useEffect(() => {
    returnFocusRef.current = returnFocusTo
  })

  useEffect(() => {
    const menu = ref.current
    return () => {
      const target = returnFocusRef.current
      // A cell that scrolled out of a virtualised body, or a row that was
      // refetched away, is no longer in the document: focusing it does
      // nothing visible and drops the focus on `<body>` instead.
      if (!target || !target.isConnected) return
      const active = document.activeElement
      // Only take the focus back from the menu itself. `<body>` counts,
      // because that is where the focus lands when the focused menu item is
      // removed — which is precisely the close this exists for.
      const heldByMenu = active === null || active === document.body || menu?.contains(active) === true
      if (!heldByMenu) return
      target.focus()
    }
  }, [ref])

  return placement
}
