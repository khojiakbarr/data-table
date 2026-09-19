import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  type TouchEvent,
} from "react"
import type { DataTableLabels } from "../types"
import { clampTableHeight } from "../core/tableHeight"

/**
 * The grab handle along the bottom edge of the table.
 *
 * Shaped after the column resize handle rather than as a second mechanism: a
 * focusable control that drags with the pointer, steps with the arrow keys and
 * takes a coarse step with Shift held. What differs is only what it writes —
 * one height for the whole table instead of one column's width — and that it
 * announces the result, since a height has no visible thing beside it the way
 * a column's edge has the column.
 *
 * Its starting point is measured, not assumed. A table may be sized by the
 * `height` prop, by a class, by a grid row or by nothing at all, so a drag
 * starts from the root's rendered box; only once the user has moved it does
 * the stored value take over.
 */

/** Inputs to {@link HeightGrip}. */
export interface HeightGripProps {
  /** The `.dt-root` element, whose rendered height a drag starts from. */
  rootRef: RefObject<HTMLElement | null>
  /** The stored height in pixels, or undefined while the `height` prop rules. */
  value: number | undefined
  /** The table's row height, which sets the minimum a height is clamped to. */
  rowHeight: number
  /** One arrow press, in pixels. */
  step: number
  /** One arrow press with Shift held, in pixels. */
  coarseStep: number
  /** Commits a new height. */
  onChange: (pixels: number) => void
  labels: DataTableLabels
}

/**
 * A grip that resizes the table's height.
 *
 * @param props - See {@link HeightGripProps}.
 *
 * @example
 * <HeightGrip rootRef={rootRef} {...instance.tableHeight} rowHeight={instance.rowHeight} labels={labels} />
 */
export function HeightGrip({
  rootRef,
  value,
  rowHeight,
  step,
  coarseStep,
  onChange,
  labels,
}: HeightGripProps) {
  const [dragging, setDragging] = useState(false)
  const [announcement, setAnnouncement] = useState("")
  /*
   * Where the drag started, in a ref rather than in state: it is read by
   * document-level listeners that must not be torn down and re-attached, and
   * re-attaching a `mousemove` handler on every pixel of movement is how a
   * drag starts dropping frames.
   */
  const dragFrom = useRef<{ pointerY: number; height: number } | null>(null)
  /*
   * The live props the drag listeners read. Same reason: the listeners are
   * attached once per gesture, so reading `onChange` or `rowHeight` out of the
   * closure would pin them to whatever they were at mousedown.
   */
  const commitRef = useRef<(pixels: number, announce: boolean) => void>(() => undefined)

  /**
   * The height the table is at right now.
   *
   * The stored value when there is one, and the root's rendered height
   * otherwise — because before the first drag the height came from somewhere
   * this component cannot read: the prop, a stylesheet, an ancestor.
   */
  const currentHeight = (): number =>
    value ?? Math.round(rootRef.current?.getBoundingClientRect().height ?? 0)

  /**
   * Commit a height, and for a keyboard step say what it became.
   *
   * Nothing is announced during a drag: the user is watching the edge move,
   * and a live region rewritten on every mousemove would queue a hundred
   * utterances for one gesture.
   */
  const commit = (pixels: number, announce: boolean): void => {
    const next = clampTableHeight(pixels, rowHeight)
    onChange(next)
    if (announce) setAnnouncement(labels.tableHeight(next))
  }
  commitRef.current = commit

  const startDrag = (pointerY: number): void => {
    dragFrom.current = { pointerY, height: currentHeight() }
    setDragging(true)
  }

  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>): void => {
    // Only the primary button. Its default action — focusing the handle and
    // starting a text selection across the table — is unwanted either way.
    if (event.button !== 0) return
    event.preventDefault()
    startDrag(event.clientY)
  }

  const handleTouchStart = (event: TouchEvent<HTMLButtonElement>): void => {
    const touch = event.touches[0]
    if (!touch) return
    startDrag(touch.clientY)
  }

  /*
   * The drag lives on the document, not on the handle: a pointer moving faster
   * than the layout follows leaves a 10px grip within the first frame, and a
   * handler bound to the element would simply stop hearing about it. The
   * listeners exist only while a drag is live, so an idle table listens to
   * nothing.
   */
  useEffect(() => {
    if (!dragging) return
    // The owning document, so a table in a popped-out window resizes there —
    // the same reason the column resizer takes the handle's own document.
    const owner = rootRef.current?.ownerDocument ?? document

    const moveTo = (pointerY: number): void => {
      const from = dragFrom.current
      if (!from) return
      commitRef.current(from.height + (pointerY - from.pointerY), false)
    }
    const onMouseMove = (event: globalThis.MouseEvent): void => moveTo(event.clientY)
    const onTouchMove = (event: globalThis.TouchEvent): void => {
      const touch = event.touches[0]
      if (touch) moveTo(touch.clientY)
    }
    const stop = (): void => {
      dragFrom.current = null
      setDragging(false)
    }

    owner.addEventListener("mousemove", onMouseMove)
    owner.addEventListener("mouseup", stop)
    owner.addEventListener("touchmove", onTouchMove)
    owner.addEventListener("touchend", stop)
    owner.addEventListener("touchcancel", stop)
    /*
     * A drag released outside the document — over the browser chrome, or
     * interrupted by an alt-tab — never fires `mouseup`, and without this the
     * table would go on resizing the next time the pointer crossed it.
     */
    owner.defaultView?.addEventListener("blur", stop)
    return () => {
      owner.removeEventListener("mousemove", onMouseMove)
      owner.removeEventListener("mouseup", stop)
      owner.removeEventListener("touchmove", onTouchMove)
      owner.removeEventListener("touchend", stop)
      owner.removeEventListener("touchcancel", stop)
      owner.defaultView?.removeEventListener("blur", stop)
    }
  }, [dragging, rootRef])

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    // Down grows the table and up shrinks it: the grip is on the bottom edge,
    // so a key moves that edge the way the pointer would.
    const distance = event.shiftKey ? coarseStep : step
    const delta = event.key === "ArrowDown" ? distance : event.key === "ArrowUp" ? -distance : 0
    if (delta === 0) return
    event.preventDefault()
    commit(currentHeight() + delta, true)
  }

  return (
    <>
      <button
        type="button"
        className="dt-grip"
        title={labels.resizeTable}
        aria-label={`${labels.resizeTable}. ${labels.resizeTableHint}`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onKeyDown={handleKeyDown}
      />
      {/*
        A window-wide shield for the duration of the drag. It holds the
        `row-resize` cursor while the pointer is far from the 10px handle, and
        stops the drag from selecting text across the page — both of which the
        column resizer gets from `.dt-is-resizing` on the root, which cannot
        work here because the pointer leaves the table entirely.
      */}
      {dragging ? <div className="dt-grip-shield" aria-hidden="true" /> : null}
      {/*
        The handle carries only its name; what the height BECAME travels here,
        politely, so a keyboard step is not a silent one. Mirrors the Columns
        tab's reorder announcement.
      */}
      <span className="dt-sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  )
}
