import { createColumnHelper } from "@tanstack/react-table"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { TableQuery } from "../core/query"
import { useDataTable, type DataTableFeatures } from "../useDataTable"
import { DataTable } from "./DataTable"

/**
 * The sort button's accessible name against the direction it actually
 * dispatches — DEFECT A/B (see the useDataTable.ts `sortDescFirst` comment
 * and HeaderCell.tsx's `sortActionLabel`).
 *
 * Server mode is used throughout so each click's real effect is observable
 * as a `TableQuery.sorting` entry through `onQueryChange`, independent of how
 * the rows happen to be ordered — the same mechanism `ServerMode.test.tsx`
 * uses to inspect a query without reading the DOM for it.
 */

interface Row {
  code: string
  amount: number
}

const rows: Row[] = [
  { code: "KR-3", amount: 30 },
  { code: "KR-1", amount: 10 },
  { code: "KR-2", amount: 20 },
]

const helper = createColumnHelper<DataTableFeatures, Row>()

function renderServerTable(onQueryChange: (query: TableQuery) => void) {
  function Table() {
    const columns = [
      helper.accessor("code", { header: "Code", size: 100 }),
      helper.accessor("amount", { header: "Amount", size: 100 }),
      // Only this column overrides the table's ascending-first default, so
      // the other two prove the default rather than an accident of this
      // column's own values.
      helper.accessor("amount", {
        id: "amountDescFirst",
        header: "Amount Desc First",
        size: 100,
        sortDescFirst: true,
      }),
    ]
    const instance = useDataTable({ id: "sort-labels", data: rows, columns, mode: "server", rowCount: rows.length, onQueryChange })
    return <DataTable instance={instance} />
  }
  return render(<Table />)
}

/** The sort direction the button's own label promises for its next click. */
function labelledDirection(name: string): "asc" | "desc" | "clear" {
  if (/ascending/i.test(name)) return "asc"
  if (/descending/i.test(name)) return "desc"
  if (/clear/i.test(name)) return "clear"
  throw new Error(`unrecognised sort label: ${name}`)
}

describe("HeaderCell sort button label", () => {
  it("promises, and dispatches, the same direction at every step for a string column", async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    renderServerTable(onQueryChange)

    for (const _step of [0, 1, 2]) {
      const button = screen.getByRole("button", { name: /^code: (sort|clear)/i })
      const promised = labelledDirection(button.getAttribute("aria-label") ?? "")
      onQueryChange.mockClear()
      await user.click(button)
      const sorting = onQueryChange.mock.calls.at(-1)?.[0]?.sorting ?? []
      const entry = sorting.find((s) => s.id === "code")
      if (promised === "clear") {
        expect(entry).toBeUndefined()
      } else {
        expect(entry?.desc).toBe(promised === "desc")
      }
    }
  })

  it("promises, and dispatches, the same direction at every step for a numeric column", async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    renderServerTable(onQueryChange)

    for (const _step of [0, 1, 2]) {
      const button = screen.getByRole("button", { name: /^amount: (sort|clear)/i })
      const promised = labelledDirection(button.getAttribute("aria-label") ?? "")
      onQueryChange.mockClear()
      await user.click(button)
      const sorting = onQueryChange.mock.calls.at(-1)?.[0]?.sorting ?? []
      const entry = sorting.find((s) => s.id === "amount")
      if (promised === "clear") {
        expect(entry).toBeUndefined()
      } else {
        expect(entry?.desc).toBe(promised === "desc")
      }
    }
  })

  it("labels a column declared sortDescFirst as descending on its first click, and dispatches desc: true", async () => {
    const user = userEvent.setup()
    const onQueryChange = vi.fn<(query: TableQuery) => void>()
    renderServerTable(onQueryChange)

    const button = screen.getByRole("button", { name: /^amount desc first: (sort|clear)/i })
    expect(button).toHaveAccessibleName(/descending/i)

    await user.click(button)
    const sorting = onQueryChange.mock.calls.at(-1)?.[0]?.sorting ?? []
    expect(sorting.find((s) => s.id === "amountDescFirst")?.desc).toBe(true)
  })

  it("gives an ordinary column ascending-first, unaffected by a sibling column's autosniffed direction", () => {
    renderServerTable(() => {})
    // Code (string) and Amount (number) would sniff different directions
    // under TanStack's own per-column heuristic — string first-row values
    // read "asc", numbers read "desc" — which is exactly the divergence
    // `sortDescFirst: false` on the table exists to remove. Neither
    // overrides it on its own column definition, so both start ascending.
    expect(
      screen.getByRole("button", { name: /^code: (sort|clear)/i }),
    ).toHaveAccessibleName(/ascending/i)
    expect(
      screen.getByRole("button", { name: /^amount: (sort|clear)/i }),
    ).toHaveAccessibleName(/ascending/i)
  })
})
