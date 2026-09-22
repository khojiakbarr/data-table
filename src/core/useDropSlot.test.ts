import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useDropSlot } from "./useDropSlot"

/**
 * DEFECT D: the drag started by `drop.start()` must not survive a drop whose
 * own effect removes the dragged element before the browser gets to dispatch
 * `dragend` on it.
 *
 * `useDropSlot` cannot be handed a source that unmounts itself — it renders
 * nothing — so the failure is reproduced at the level the hook actually
 * controls: a `drop` (or `dragend`) event reaching `document`, with no
 * `drop.end()` ever called directly. That is exactly what happens to the
 * ORIGINATING surface's `drop` state when a different component (the Row
 * Groups zone) consumes the drop and its own state update unmounts the
 * dragged header or panel row — this hook has no way to know the drop
 * "belonged" to someone else, which is why the fix listens for the event
 * itself rather than for a call from the element.
 */
describe("useDropSlot", () => {
  it("clears the drag when a document-level `drop` fires, with no `dragend` on the source", () => {
    const { result } = renderHook(() => useDropSlot(["a", "b", "c"]))

    act(() => result.current.start("a"))
    expect(result.current.draggedId).toBe("a")

    // Simulates the source element having already been removed from the
    // document by the drop's own side effect: the browser never gets to fire
    // `dragend` on it, so nothing calls `drop.end()` directly. Dispatched on
    // `document` because a native `drop` on any still-mounted target bubbles
    // there regardless of which component consumed it.
    act(() => {
      document.dispatchEvent(new Event("drop", { bubbles: true }))
    })

    expect(result.current.draggedId).toBeNull()
    expect(result.current.slotId).toBeNull()
  })

  it("clears the drag when a document-level `dragend` fires", () => {
    const { result } = renderHook(() => useDropSlot(["a", "b", "c"]))

    act(() => result.current.start("a"))
    act(() => result.current.over("b", "end"))
    expect(result.current.draggedId).toBe("a")
    expect(result.current.slotId).not.toBeNull()

    act(() => {
      document.dispatchEvent(new Event("dragend", { bubbles: true }))
    })

    expect(result.current.draggedId).toBeNull()
    expect(result.current.slotId).toBeNull()
  })

  it("does not attach a document listener while nothing is being dragged", () => {
    const addSpy = vi.spyOn(document, "addEventListener")
    renderHook(() => useDropSlot(["a", "b"]))
    expect(addSpy).not.toHaveBeenCalledWith("drop", expect.anything(), expect.anything())
    expect(addSpy).not.toHaveBeenCalledWith("dragend", expect.anything(), expect.anything())
    addSpy.mockRestore()
  })

  it("removes its document listeners once the drag ends normally", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener")
    const { result, unmount } = renderHook(() => useDropSlot(["a", "b"]))

    act(() => result.current.start("a"))
    act(() => result.current.end())
    unmount()

    expect(removeSpy).toHaveBeenCalledWith("drop", expect.any(Function), { capture: true })
    expect(removeSpy).toHaveBeenCalledWith("dragend", expect.any(Function), { capture: true })
    removeSpy.mockRestore()
  })
})
