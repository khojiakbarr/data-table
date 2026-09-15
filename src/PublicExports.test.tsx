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
