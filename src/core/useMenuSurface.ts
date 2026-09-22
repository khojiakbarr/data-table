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
 *
 * `role="menu"` (which every caller sets on its own root) is a promise the
 * DOM tree alone does not keep: arrow keys have to rove the focus between
 * `role="menuitem"` children, the items have to form one `Tab` stop rather
 * than one apiece, and the whole surface has to close the moment focus lands
 * outside it — a screen reader in application mode hands arrow keys straight
 * to the menu, and a menu with no route out of it but Escape is a keyboard
 * trap in every practical sense. All three live here, driven off
 * `[role="menuitem"]` found under `ref` at call time rather than a list a
 * caller has to hand in, which is what lets `CellMenu`'s single "Edit" item
 * today, and `HeaderMenu`'s many, share this without either one describing
 * its own item list to the hook.
 */

/** Every `role="menuitem"` under `menu`, in DOM — i.e. visual — order. */
function menuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

/**
 * Moves the roving tab stop to `items[index]` and follows it with the focus.
 *
 * Setting every other item's `tabIndex` to `-1` is what makes the group a
 * single `Tab` stop instead of one per item — the other half of the
 * `role="menu"` contract arrow keys satisfy, and something no `<button>`
 * gets by default, since a plain button is always in the page's Tab order on
 * its own.
 */
function activate(items: HTMLElement[], index: number): void {
  items.forEach((item, itemIndex) => {
    item.tabIndex = itemIndex === index ? 0 : -1
  })
  items[index]?.focus()
}

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
      if (event.key === "Escape") {
        onDismiss()
        return
      }

      const menu = ref.current
      const target = event.target
      // Escape closes the menu no matter where the focus is (it is a
      // document listener for exactly that reason), but the arrow keys are
      // only this menu's to steer when a keypress actually originates
      // inside it — otherwise they would hijack arrow keys meant for
      // whatever else is focused on the page.
      if (menu === null || !(target instanceof Node) || !menu.contains(target)) return

      const items = menuItems(menu)
      if (items.length === 0) return
      const from = items.findIndex((item) => item === document.activeElement)
      const currentIndex = from === -1 ? 0 : from

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault()
          activate(items, (currentIndex + 1) % items.length)
          break
        case "ArrowUp":
          event.preventDefault()
          activate(items, (currentIndex - 1 + items.length) % items.length)
          break
        case "Home":
          event.preventDefault()
          activate(items, 0)
          break
        case "End":
          event.preventDefault()
          activate(items, items.length - 1)
          break
        default:
          break
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [ref, onDismiss])

  useEffect(() => {
    const menu = ref.current
    if (menu === null) return
    const onFocusOut = (event: FocusEvent) => {
      // `focusout` bubbles (unlike `blur`), so one listener on the menu
      // catches every item losing the focus. `relatedTarget` is the element
      // about to take it — still inside the menu for a roving-focus move
      // between items, `null` when nothing will (Tab ran off the end with no
      // next stop, or the focused item was just removed from the document).
      // Either way, once it is not still somewhere inside this menu, the
      // menu can no longer promise "no keyboard trap" (WCAG 2.1.2) or stay
      // painted over the table with nothing pointing at it.
      const next = event.relatedTarget
      if (next instanceof Node && menu.contains(next)) return
      onDismiss()
    }
    menu.addEventListener("focusout", onFocusOut)
    return () => menu.removeEventListener("focusout", onFocusOut)
  }, [ref, onDismiss])

  // Roving tabindex to the first item, which also gives it the initial
  // focus so the menu is usable from the keyboard the moment it opens.
  useEffect(() => {
    const menu = ref.current
    if (menu === null) return
    const items = menuItems(menu)
    if (items.length === 0) return
    activate(items, 0)
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
