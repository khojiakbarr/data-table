import { createColumnHelper } from "@tanstack/react-table"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import * as publicApi from "./index"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * Regression coverage for finding #29: a headless host reusing `TablePagination`
 * had no way to reuse the loading/error/skeleton surface too, and the
 * `labels` recipe shown in the README did not type-check against
 * `TablePagination`'s required `DataTableLabels`.
 */

interface Row {
  id: string
  name: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 100 })]

describe("public API surface", () => {
  it("exports TableStatus and SkeletonRows alongside TablePagination", () => {
    // Not merely typed as exported — actually present on the runtime barrel,
    // the way a `@khojiakbarr/data-table` import resolves for a consumer.
    expect(publicApi.TableStatus).toBeTypeOf("function")
    expect(publicApi.SkeletonRows).toBeTypeOf("function")
    expect(publicApi.TablePagination).toBeTypeOf("function")
    expect(publicApi.defaultLabels).toBeTypeOf("object")
  })

  it("renders TableStatus's error banner for a shell of its own", () => {
    const onRetry = () => undefined
    render(
      <publicApi.TableStatus
        loading={false}
        error="network down"
        onRetry={onRetry}
        labels={publicApi.defaultLabels}
      />,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load rows: network down")
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument()
  })

  it("renders SkeletonRows for a shell of its own", () => {
    render(
      <table>
        <publicApi.SkeletonRows widths={[100, 0]} count={3} />
      </table>,
    )
    expect(document.querySelectorAll("tr.dt-skeleton-row")).toHaveLength(3)
  })

  it("exports QuickSearch and renders it for a shell of its own", () => {
    // Not merely typed as exported — actually present on the runtime barrel.
    // `QuickSearch.test.tsx` imports it from `./components/QuickSearch`
    // directly, which proves nothing about the entry point at `src/index.ts`;
    // deleting the re-export there left the whole suite green.
    expect(publicApi.QuickSearch).toBeTypeOf("function")

    function Table() {
      const instance = useDataTable<Row>({
        id: "pub-quick-search",
        columns,
        data: [{ id: "r0", name: "Row 0" }],
        getRowId: (r) => r.id,
      })
      return <publicApi.QuickSearch instance={instance} labels={publicApi.defaultLabels} />
    }
    render(<Table />)
    expect(screen.getByRole("searchbox", { name: "Search rows" })).toBeInTheDocument()
  })

  it("accepts the README's `{ ...defaultLabels, ...overrides }` recipe for TablePagination's required labels", () => {
    function Table() {
      const instance = useDataTable<Row>({
        id: "pub-labels", columns, data: [{ id: "r0", name: "Row 0" }],
        pagination: true, getRowId: (r) => r.id,
      })
      const myLabels = { rowsPerPage: "Строк" }
      return <publicApi.TablePagination instance={instance} labels={{ ...publicApi.defaultLabels, ...myLabels }} />
    }
    render(<Table />)
    // The overridden key took, and every key `defaultLabels` filled in still renders.
    expect(screen.getByText("Строк")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "First page" })).toBeInTheDocument()
  })
})

describe("the filtering labels batch", () => {
  it("fills in every new key through the README's `{ ...defaultLabels, ...mine }` recipe", () => {
    // New required keys are a source break for a host that hand-builds a full
    // labels object rather than spreading `defaultLabels`, so the whole batch
    // lands at once and the break happens once.
    const mine = { noMatches: "Mos keladigan qator yo'q" }
    const labels: publicApi.DataTableLabels = { ...publicApi.defaultLabels, ...mine }

    expect(labels.noMatches).toBe("Mos keladigan qator yo'q")
    expect(labels.filterInPanel).toBe("Filter in panel…")
    expect(labels.opNotBlank).toBe("Is not blank")
    expect(labels.opDateBetween).toBe("Between")
    expect(labels.searchResults(3)).toBe("3 matching rows")
    expect(labels.searchResults(undefined)).toBe("Searching")
    expect(labels.filterTitle("Amount")).toBe("Filter Amount")
  })

  it("leaves no default blank", () => {
    for (const [key, value] of Object.entries(publicApi.defaultLabels)) {
      expect(typeof value === "function" || value !== "", `${key} is blank`).toBe(true)
    }
  })
})
