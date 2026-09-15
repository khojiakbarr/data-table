import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ServerDemo } from "./ServerDemo"
import type { ServerPage, ServerReceipt } from "./fakeServer"

/**
 * Regression coverage for the fail-next checkbox in {@link ServerDemo}.
 *
 * `fetchReceipts` is mocked so each test controls exactly when a request
 * resolves or rejects, independent of the real 300 ms delay — that is what
 * lets the "checked while a request is in flight" scenario be expressed
 * deterministically instead of racing a timer.
 */
vi.mock("./fakeServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fakeServer")>()
  return { ...actual, fetchReceipts: vi.fn() }
})

const { fetchReceipts: fetchReceiptsMock } = await import("./fakeServer")

/** A promise whose settlement a test can trigger on demand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** One page of fake rows, distinct per `from` so pages are told apart in assertions. */
function page(from: number, count: number): ServerPage {
  const rows: ServerReceipt[] = Array.from({ length: count }, (_, i) => ({
    id: `rc-${from + i}`,
    code: `KR-${10_000 + from + i}`,
    partner: "Partner",
    amount: 1,
    status: "open",
    date: "2026-01-01",
  }))
  return { rows, total: 10_000 }
}

describe("ServerDemo fail-next checkbox", () => {
  beforeEach(() => {
    vi.mocked(fetchReceiptsMock).mockReset()
  })

  it("recovers on retry instead of repeating the same failure forever", async () => {
    const user = userEvent.setup()
    const first = deferred<ServerPage>()
    vi.mocked(fetchReceiptsMock).mockReturnValueOnce(first.promise)
    const { container } = render(<ServerDemo />)

    expect(fetchReceiptsMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      first.resolve(page(0, 50))
    })
    expect(container.querySelector(".dt-progress")).toBeNull()

    const checkbox = screen.getByRole("checkbox")
    await user.click(checkbox)
    expect(checkbox).toBeChecked()

    // Advancing the page is the trigger for the next request.
    const failing = deferred<ServerPage>()
    vi.mocked(fetchReceiptsMock).mockReturnValueOnce(failing.promise)
    await user.click(screen.getByRole("button", { name: /next page/i }))

    // The flag is spent the moment the doomed request goes out, not when it
    // settles — so the box reflects "armed for the next request" correctly.
    expect(fetchReceiptsMock).toHaveBeenLastCalledWith(expect.anything(), { fail: true })
    expect(checkbox).not.toBeChecked()

    await act(async () => {
      failing.reject(new Error("Simulated network failure"))
    })
    expect(screen.getByRole("alert")).toHaveTextContent("Simulated network failure")

    // Before the fix: `failNext` was still `true` here (only ever cleared on
    // success), so Retry re-read it and failed again, forever.
    const retried = deferred<ServerPage>()
    vi.mocked(fetchReceiptsMock).mockReturnValueOnce(retried.promise)
    await user.click(screen.getByRole("button", { name: /retry/i }))

    expect(fetchReceiptsMock).toHaveBeenLastCalledWith(expect.anything(), { fail: false })
    await act(async () => {
      retried.resolve(page(50, 50))
    })
    expect(screen.queryByRole("alert")).toBeNull()
    expect(container.querySelector(".dt-progress")).toBeNull()
  })

  it("does not clear a checkbox ticked while an unrelated request is in flight", async () => {
    const user = userEvent.setup()
    const first = deferred<ServerPage>()
    vi.mocked(fetchReceiptsMock).mockReturnValueOnce(first.promise)
    render(<ServerDemo />)
    await act(async () => {
      first.resolve(page(0, 50))
    })

    const inFlight = deferred<ServerPage>()
    vi.mocked(fetchReceiptsMock).mockReturnValueOnce(inFlight.promise)
    await user.click(screen.getByRole("button", { name: /next page/i }))
    expect(fetchReceiptsMock).toHaveBeenLastCalledWith(expect.anything(), { fail: false })

    // Ticked *after* the (non-failing) request already left — must survive
    // that request's success.
    const checkbox = screen.getByRole("checkbox")
    await user.click(checkbox)
    expect(checkbox).toBeChecked()

    // Before the fix: the unconditional `setFailNext(false)` in `.then`
    // reverted this click when the unrelated response resolved.
    await act(async () => {
      inFlight.resolve(page(50, 50))
    })
    expect(checkbox).toBeChecked()

    const next = deferred<ServerPage>()
    vi.mocked(fetchReceiptsMock).mockReturnValueOnce(next.promise)
    await user.click(screen.getByRole("button", { name: /next page/i }))
    expect(fetchReceiptsMock).toHaveBeenLastCalledWith(expect.anything(), { fail: true })
  })
})
