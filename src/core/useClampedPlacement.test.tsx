import { render, screen } from "@testing-library/react"
import { act, useRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useClampedPlacement, type ClampedPoint } from "./useClampedPlacement"

/**
 * The clamp every overlay shares.
 *
 * jsdom lays nothing out, so a real `getBoundingClientRect()` is all zeros and
 * a re-clamp cannot be told from no clamp at all — which is why the hook takes
 * an injectable `measure`. The window is jsdom's default 1024 x 768.
 */

type ObserverCallback = (entries: ResizeObserverEntry[]) => void

/**
 * A ResizeObserver whose callbacks the test fires by hand.
 *
 * Copied rather than imported from `VirtualizationBounds.test.tsx`: importing
 * one test file from another would run that file's suites here too.
 */
class ResizeObserverStub {
  static callbacks = new Set<ObserverCallback>()
  static fire() {
    for (const callback of ResizeObserverStub.callbacks) callback([])
  }
  private readonly callback: ObserverCallback
  constructor(callback: ObserverCallback) {
    this.callback = callback
  }
  observe() {
    ResizeObserverStub.callbacks.add(this.callback)
  }
  unobserve() {
    ResizeObserverStub.callbacks.delete(this.callback)
  }
  disconnect() {
    ResizeObserverStub.callbacks.delete(this.callback)
  }
}

const rect = (width: number, height: number): DOMRect => new DOMRect(0, 0, width, height)

function Overlay({ at, measure }: { at: ClampedPoint; measure?: (() => DOMRect) | undefined }) {
  const ref = useRef<HTMLDivElement>(null)
  const placement = useClampedPlacement(ref, at, measure)
  return (
    <div
      ref={ref}
      data-testid="overlay"
      style={{ position: "fixed", left: placement.x, top: placement.y }}
    />
  )
}

const FAR: ClampedPoint = { x: 2000, y: 2000 }
const NEAR: ClampedPoint = { x: 120, y: 40 }

afterEach(() => {
  ResizeObserverStub.callbacks.clear()
  vi.unstubAllGlobals()
})

describe("useClampedPlacement", () => {
  it("pulls an overlay back inside the window in both axes", () => {
    render(<Overlay at={FAR} measure={() => rect(200, 100)} />)

    const overlay = screen.getByTestId("overlay")
    expect(overlay.style.left).toBe("816px")
    expect(overlay.style.top).toBe("660px")
  })

  it("opens where it was asked to when there is room", () => {
    render(<Overlay at={NEAR} measure={() => rect(200, 100)} />)

    const overlay = screen.getByTestId("overlay")
    expect(overlay.style.left).toBe("120px")
    expect(overlay.style.top).toBe("40px")
  })

  it("measures the element itself when no measure is given", () => {
    render(<Overlay at={FAR} />)

    // Every jsdom rect is zeros, so the clamp reduces to "no further than the
    // edge minus the margin" — enough to prove it ran.
    expect(screen.getByTestId("overlay").style.left).toBe("1016px")
  })

  it("re-clamps when the overlay's own content resizes it", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    let tall = false
    render(<Overlay at={{ x: 120, y: 700 }} measure={() => (tall ? rect(200, 400) : rect(200, 100))} />)

    const overlay = screen.getByTestId("overlay")
    expect(overlay.style.top).toBe("660px")

    // Switching operator makes the popover taller; the layout effect has long
    // since run, so only the observer can notice.
    tall = true
    act(() => ResizeObserverStub.fire())

    expect(overlay.style.top).toBe("360px")
  })
})
