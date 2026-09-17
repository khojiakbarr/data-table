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

/**
 * A `ResizeObserverStub` that also counts how many times it is constructed,
 * observed, and disconnected — the signal for whether the hook's layout
 * effect re-ran on a render that did not actually move the requested point.
 */
class CountingResizeObserverStub extends ResizeObserverStub {
  static constructorCalls = 0
  static disconnectCalls = 0
  static reset() {
    CountingResizeObserverStub.constructorCalls = 0
    CountingResizeObserverStub.disconnectCalls = 0
  }
  constructor(callback: ObserverCallback) {
    super(callback)
    CountingResizeObserverStub.constructorCalls += 1
  }
  override disconnect() {
    CountingResizeObserverStub.disconnectCalls += 1
    super.disconnect()
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

  it("does not disconnect and reobserve on a render that passes fresh `requested`/`measure` identities", () => {
    // The shape a caller naturally writes: a new point object and a new
    // measure closure every render, both closing over component state (the
    // hook's own @example does the same for `requested`). The requested
    // point's *values* never change here, so the effect must not re-run.
    vi.stubGlobal("ResizeObserver", CountingResizeObserverStub)
    CountingResizeObserverStub.reset()

    function ChurningOverlay({ renderToken }: { renderToken: number }) {
      const ref = useRef<HTMLDivElement>(null)
      const placement = useClampedPlacement(ref, { x: NEAR.x, y: NEAR.y }, () => rect(200, 100))
      return (
        <div
          ref={ref}
          data-testid="overlay"
          data-render-token={renderToken}
          style={{ position: "fixed", left: placement.x, top: placement.y }}
        />
      )
    }

    const { rerender } = render(<ChurningOverlay renderToken={0} />)
    for (let renderToken = 1; renderToken <= 5; renderToken += 1) {
      rerender(<ChurningOverlay renderToken={renderToken} />)
    }

    // One observer for the component's whole lifetime, not one per render.
    expect(CountingResizeObserverStub.constructorCalls).toBe(1)
    expect(CountingResizeObserverStub.disconnectCalls).toBe(0)
  })

  it("does not keep re-rendering the host once a resize delivery reports the same size again", () => {
    // The functional-updater guard on `setPlacement` is the only thing that
    // keeps a real ResizeObserver from re-rendering the host once per
    // delivery forever. Counting render()-body calls is what actually
    // exercises it — asserting only the final style values (as the tests
    // above do) passes even with the guard deleted.
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    let renders = 0

    function CountingOverlay({ at, measure }: { at: ClampedPoint; measure: () => DOMRect }) {
      renders += 1
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

    render(<CountingOverlay at={FAR} measure={() => rect(200, 100)} />)
    const baseline = renders

    act(() => ResizeObserverStub.fire())
    const afterFirstDelivery = renders

    act(() => ResizeObserverStub.fire())
    const afterSecondDelivery = renders

    // React still calls the component once to learn the updater produced an
    // identical value before it bails out — real growth would be unbounded,
    // one extra render per delivery.
    expect(afterFirstDelivery).toBe(baseline + 1)
    expect(afterSecondDelivery).toBe(afterFirstDelivery)
  })
})
