import { createColumnHelper } from "@tanstack/react-table"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "../components/DataTable"
import type { LayoutStorage, TableLayout } from "../types"
import {
  useDataTable,
  type DataTableFeatures,
  type DataTableInstance,
  type UseDataTableOptions,
} from "../useDataTable"
import { ROW_NUMBER_COLUMN_ID, rowNumberColumnWidth } from "./rowNumbers"
import { columnsToFit, fitBounds, type FitColumnsOnLoad } from "./useFitOnLoad"

/**
 * Fitting the columns to the first rows drawn.
 *
 * jsdom measures no text, so a canvas that charges a fixed width per
 * character stands in for one: without it every fitted column lands on the
 * table's 60px floor, and a test would pass with nothing measured at all.
 */

const CHAR_PX = 7

function installFakeCanvas(): () => void {
  const original = HTMLCanvasElement.prototype.getContext
  const fake = () => ({ font: "", measureText: (text: string) => ({ width: text.length * CHAR_PX }) })
  HTMLCanvasElement.prototype.getContext = fake as unknown as typeof original
  return () => {
    HTMLCanvasElement.prototype.getContext = original
  }
}

interface Row {
  code: string
  name: string
}

type Column = UseDataTableOptions<Row>["columns"][number]

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns: Column[] = [
  helper.accessor("code", { header: "Code", size: 100 }),
  helper.accessor("name", { header: "Name", size: 200 }),
]
const rows: Row[] = [{ code: "KR-1", name: "Apple Orchard Ltd" }]
/**
 * Header "Code" 4×7 + 46 chrome = 74 beats the cell "KR-1" at 4×7 + 28 = 56;
 * "Apple Orchard Ltd" 17×7 + 28 = 147 beats the header "Name" at 74.
 */
const FITTED = { code: 74, name: 147 }
/** Rows a later visit draws: a fit from these would come out wider. */
const widerRows: Row[] = [{ code: "KR-100000", name: "Apple Orchard Holdings International" }]

/** A storage that round-trips through JSON, as a real one does, and records every save. */
function memoryStorage(initial: Partial<TableLayout> | null = null) {
  const saves: TableLayout[] = []
  let stored: Partial<TableLayout> | null = initial
  const storage: LayoutStorage = {
    load: () => stored,
    save: (_id, layout) => {
      saves.push(layout)
      stored = JSON.parse(JSON.stringify(layout)) as Partial<TableLayout>
    },
    clear: () => {
      stored = null
    },
  }
  return { storage, saves, stored: () => stored }
}

interface HarnessProps {
  fit?: boolean | FitColumnsOnLoad
  data?: Row[]
  tableColumns?: Column[]
  storage?: LayoutStorage
  initialLayout?: Partial<TableLayout>
  totals?: Record<string, string>
  rowNumbers?: boolean
  rowCount?: number
}

let latest: DataTableInstance<Row> | null = null

function Harness({
  fit = true,
  data = rows,
  tableColumns = columns,
  storage,
  initialLayout,
  totals,
  rowNumbers = false,
  rowCount,
}: HarnessProps) {
  const instance = useDataTable<Row>({
    id: "fit",
    columns: tableColumns,
    data,
    features: { rowNumbers },
    ...(storage === undefined ? {} : { storage }),
    ...(initialLayout === undefined ? {} : { initialLayout }),
    ...(rowCount === undefined ? {} : { mode: "server" as const, rowCount }),
  })
  latest = instance
  return <DataTable instance={instance} fitColumnsOnLoad={fit} virtualize={false} {...(totals ? { totals } : {})} />
}

/** Widths as the table renders them: the fit's, under any the person set. */
const sizing = (): Record<string, number> => latest?.table.state.columnSizing ?? {}
const widthOf = (columnId: string): number | undefined => latest?.table.getColumn(columnId)?.getSize()
/** Write the debounced save now, the way leaving the page does. */
const flushSave = () => fireEvent(window, new Event("pagehide"))
/** Unmount and mount again against the same storage: the next visit. */
function revisit(props: HarnessProps) {
  cleanup()
  render(<Harness {...props} />)
}

let restoreCanvas: () => void
beforeEach(() => {
  restoreCanvas = installFakeCanvas()
  latest = null
})
afterEach(() => restoreCanvas())

describe("fitBounds", () => {
  it("caps a column at maxGrowth times its declared size", () => {
    expect(fitBounds({ min: 60, max: 800 }, 120, 2)).toEqual({ min: 60, max: 240 })
  })

  it("keeps a lower maxSize", () => {
    expect(fitBounds({ min: 60, max: 180 }, 120, 2)).toEqual({ min: 60, max: 180 })
  })

  it("falls back to TanStack's 150 only for a definition no size reached at all", () => {
    expect(fitBounds({ min: 20, max: 800 }, undefined, 2)).toEqual({ min: 20, max: 300 })
  })

  it("never puts the ceiling under the floor", () => {
    expect(fitBounds({ min: 60, max: 800 }, 20, 1)).toEqual({ min: 60, max: 60 })
  })
})

describe("columnsToFit", () => {
  const column = (id: string, canResize = true) => ({ id, getCanResize: () => canResize }) as never

  it("leaves a column already fitted, one that cannot be resized, and the row numbers", () => {
    const picked = columnsToFit(
      [column("code"), column("name"), column("actions", false), column(ROW_NUMBER_COLUMN_ID)],
      { name: 240 },
    )
    expect(picked.map((c: { id: string }) => c.id)).toEqual(["code"])
  })
})

describe("fitColumnsOnLoad", () => {
  it("fits every column to the first rows drawn, measured", async () => {
    render(<Harness />)
    await waitFor(() => expect(sizing()).toEqual(FITTED))
  })

  it("caps a column that declares no size at twice the table's default width, not TanStack's", async () => {
    const unsized: Column[] = [helper.accessor("code", { header: "Code" })]
    render(<Harness tableColumns={unsized} data={[{ code: "K".repeat(80), name: "" }]} />)
    // `defaultColumnWidth` is 160, so the ceiling is 320 — TanStack's 150 would have made it 300.
    await waitFor(() => expect(sizing()).toEqual({ code: 320 }))
  })

  it("does nothing while it is off", async () => {
    render(<Harness fit={false} />)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(sizing()).toEqual({})
  })
})

describe("fitColumnsOnLoad — the fit is the table's default, not an arrangement", () => {
  it("does not make the layout customised", async () => {
    render(<Harness />)
    await waitFor(() => expect(sizing()).toEqual(FITTED))
    expect(latest?.isCustomised).toBe(false)
  })

  it("stores the fitted widths apart from the person's own", async () => {
    const { storage, stored } = memoryStorage()
    render(<Harness storage={storage} />)
    await waitFor(() => expect(sizing()).toEqual(FITTED))
    flushSave()

    expect(stored()?.fittedSizing).toEqual(FITTED)
    expect(stored()?.columnSizing).toEqual({})
  })

  it("draws the stored fit on the next visit, uncustomised and not fitted again", async () => {
    const { storage } = memoryStorage()
    render(<Harness storage={storage} />)
    await waitFor(() => expect(sizing()).toEqual(FITTED))
    flushSave()

    revisit({ storage, data: widerRows })

    expect(sizing()).toEqual(FITTED)
    expect(latest?.isCustomised).toBe(false)
  })

  it("is still customised by a width the person sets", async () => {
    render(<Harness />)
    await waitFor(() => expect(sizing()).toEqual(FITTED))

    act(() => latest?.table.setColumnSizing((previous) => ({ ...previous, name: 300 })))

    expect(widthOf("name")).toBe(300)
    expect(latest?.isCustomised).toBe(true)
  })

  it("keeps a width the person already has over the fit", async () => {
    render(<Harness initialLayout={{ columnSizing: { name: 260 } }} />)
    await waitFor(() => expect(widthOf("code")).toBe(FITTED.code))
    expect(widthOf("name")).toBe(260)
    expect(latest?.isCustomised).toBe(false)
  })

  it("keeps a width dragged to exactly the declared size, and the next visit does not fit it again", async () => {
    const { storage, stored } = memoryStorage()
    render(<Harness storage={storage} />)
    await waitFor(() => expect(sizing()).toEqual(FITTED))

    // 200 is `name`'s declared size: a width that restated it was dropped, and the next load re-fitted the column.
    act(() => latest?.table.setColumnSizing((previous) => ({ ...previous, name: 200 })))
    expect(latest?.isCustomised).toBe(true)
    flushSave()
    expect(stored()?.columnSizing).toEqual({ name: 200 })

    revisit({ storage, data: widerRows })
    expect(widthOf("name")).toBe(200)
  })

  it("returns a column to its fitted width on Reset width, and the next visit keeps it there", async () => {
    const user = userEvent.setup()
    const { storage, stored } = memoryStorage()
    render(<Harness storage={storage} />)
    await waitFor(() => expect(sizing()).toEqual(FITTED))
    act(() => latest?.table.setColumnSizing((previous) => ({ ...previous, name: 300 })))

    await user.click(screen.getByRole("button", { name: /name: column actions/i }))
    await user.click(screen.getByRole("menuitem", { name: /reset width/i }))

    expect(widthOf("name")).toBe(FITTED.name)
    expect(latest?.isCustomised).toBe(false)
    flushSave()
    expect(stored()?.columnSizing).toEqual({})

    revisit({ storage, data: widerRows })
    expect(widthOf("name")).toBe(FITTED.name)
  })

  it("returns every column to its fitted width on Reset, and stores the fit again", async () => {
    const { storage, stored } = memoryStorage()
    render(<Harness storage={storage} />)
    await waitFor(() => expect(sizing()).toEqual(FITTED))
    act(() => latest?.table.setColumnSizing((previous) => ({ ...previous, code: 90, name: 300 })))
    flushSave()

    act(() => latest?.resetLayout())

    expect(sizing()).toEqual(FITTED)
    expect(latest?.isCustomised).toBe(false)
    flushSave()
    expect(stored()?.fittedSizing).toEqual(FITTED)
    expect(stored()?.columnSizing).toEqual({})

    revisit({ storage, data: widerRows })
    expect(sizing()).toEqual(FITTED)
    expect(latest?.isCustomised).toBe(false)
  })

  it("drops a stored fit once fitting is turned off", async () => {
    const { storage, stored } = memoryStorage({ columnSizing: {}, fittedSizing: FITTED })
    render(<Harness storage={storage} fit={false} />)

    expect(sizing()).toEqual({})
    expect(latest?.isCustomised).toBe(false)
    flushSave()
    expect(stored()?.fittedSizing).toEqual({})
  })
})

describe("fitColumnsOnLoad — what is measured", () => {
  it("leaves the row-number column at the width its row count gives it", async () => {
    // Measured, the header's screen-reader-only "Row number" read as 116px, and the digits
    // on screen as 60 — under the 65 that five digits need.
    render(<Harness rowNumbers rowCount={12_345} />)
    await waitFor(() => expect(sizing()).toEqual(FITTED))
    expect(widthOf(ROW_NUMBER_COLUMN_ID)).toBe(rowNumberColumnWidth(12_345))
  })

  it("leaves the row-number column at its own width on Fit all columns", async () => {
    const user = userEvent.setup()
    render(<Harness fit={false} rowNumbers rowCount={12_345} />)

    await user.click(screen.getByRole("button", { name: /name: column actions/i }))
    await user.click(screen.getByRole("menuitem", { name: /fit all columns/i }))

    expect(widthOf(ROW_NUMBER_COLUMN_ID)).toBe(rowNumberColumnWidth(12_345))
    expect(sizing()[ROW_NUMBER_COLUMN_ID]).toBeUndefined()
  })

  it("reads no screen-reader-only text in a header", async () => {
    const hinted: Column[] = [
      helper.accessor("code", {
        id: "code",
        size: 100,
        header: () => (
          <>
            Code<span className="dt-sr-only">, the receipt's number in the warehouse register</span>
          </>
        ),
      }),
    ]
    render(<Harness tableColumns={hinted} />)
    await waitFor(() => expect(sizing()).toEqual({ code: FITTED.code }))
  })

  it("measures the totals footer", async () => {
    const total = "12 345 678 901 234.56 UZS"
    render(<Harness totals={{ name: total }} />)
    // Wider than "Apple Orchard Ltd": the total would otherwise be cut under the fitted width.
    await waitFor(() => expect(widthOf("name")).toBe(total.length * CHAR_PX + 28))
  })

  it("widens the leaves under a group label the fit would cut", async () => {
    const grouped: Column[] = [
      helper.group({ id: "doc", header: "Delivery note, partner and amount", columns: helper.columns([...columns]) }),
    ]
    render(<Harness tableColumns={grouped} />)
    // The 33-character label needs 33×7 + 46 = 277; the leaves fit to 74 + 147 = 221, so each takes half of 56.
    await waitFor(() => expect(sizing()).toEqual({ code: 102, name: 175 }))
  })
})

describe("fitColumnsOnLoad — web fonts", () => {
  function stubFonts(ready: Promise<unknown>) {
    Object.defineProperty(document, "fonts", { configurable: true, value: { status: "loading", ready } })
    return () => {
      Reflect.deleteProperty(document, "fonts")
    }
  }

  it("waits for the fonts before measuring", async () => {
    let loaded: (value?: unknown) => void = () => undefined
    const restore = stubFonts(new Promise((resolve) => (loaded = resolve)))
    try {
      render(<Harness />)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      expect(sizing()).toEqual({})

      await act(async () => loaded())
      await waitFor(() => expect(sizing()).toEqual(FITTED))
    } finally {
      restore()
    }
  })

  it("does not wait forever for a font that never loads", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const restore = stubFonts(new Promise(() => undefined))
    try {
      render(<Harness />)
      expect(sizing()).toEqual({})

      act(() => vi.advanceTimersByTime(1000))
      expect(sizing()).toEqual(FITTED)
    } finally {
      restore()
      vi.useRealTimers()
    }
  })
})
