import { createColumnHelper } from "@tanstack/react-table"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

interface Row { id: string; name: string }
const helper = createColumnHelper<DataTableFeatures, Row>()
const columns = [helper.accessor("name", { header: "Name", size: 100 }), helper.accessor("id", { header: "Id", size: 80 })]
const rows: Row[] = [{ id: "a", name: "Alpha" }]

function Table(props: { data?: Row[]; loading?: boolean; error?: unknown; onRetry?: () => void; pageSize?: number }) {
  const instance = useDataTable<Row>({
    id: "st",
    columns,
    data: props.data ?? [],
    mode: "server",
    rowCount: props.data?.length ?? 0,
    getRowId: (r) => r.id,
    ...(props.pageSize === undefined ? undefined : { pagination: { pageSize: props.pageSize } }),
  })
  return <DataTable instance={instance} loading={props.loading} error={props.error} onRetry={props.onRetry} virtualize={false} />
}

describe("loading states", () => {
  it("shows skeleton rows on first load", () => {
    const { container } = render(<Table loading />)
    expect(container.querySelectorAll("tr.dt-skeleton-row").length).toBeGreaterThan(0)
    expect(screen.queryByText("No rows")).toBeNull()
  })

  it("renders no progress bar while the skeleton shows", () => {
    const { container } = render(<Table loading />)
    expect(container.querySelector(".dt-progress")).toBeNull()
    expect(container.querySelector(".dt-viewport")?.classList.contains("dt-loading")).toBe(false)
  })

  it("caps skeleton rows at eight", () => {
    const { container: narrow } = render(<Table loading pageSize={5} />)
    expect(narrow.querySelectorAll("tr.dt-skeleton-row").length).toBe(5)

    const { container: wide } = render(<Table loading />)
    expect(wide.querySelectorAll("tr.dt-skeleton-row").length).toBe(8)
  })

  it("keeps rows visible and shows a progress bar while refetching", () => {
    const { container } = render(<Table data={rows} loading />)
    expect(screen.getByText("Alpha")).toBeInTheDocument()
    expect(container.querySelector(".dt-progress")).not.toBeNull()
    expect(container.querySelector(".dt-viewport")?.classList.contains("dt-loading")).toBe(true)
  })

  it("shows the error with a retry action, above any stale rows", async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const { container } = render(<Table data={rows} error={new Error("Boom")} onRetry={onRetry} />)
    expect(screen.getByRole("alert")).toHaveTextContent("Boom")
    expect(screen.getByText("Alpha")).toBeInTheDocument()
    // `.dt-main` is the table's own column inside the root, beside the side bar.
    expect(container.querySelector(".dt-main > .dt-error")).not.toBeNull()
    expect(container.querySelector(".dt-viewport .dt-error")).toBeNull()
    await user.click(screen.getByRole("button", { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("omits the retry button when onRetry is not given", () => {
    render(<Table data={rows} error={new Error("Boom")} />)
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull()
  })

  it("survives an error that cannot be stringified", () => {
    expect(() => render(<Table data={rows} error={Object.create(null)} />)).not.toThrow()
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load rows")
  })

  it("shows the empty state only when idle with no rows", () => {
    render(<Table />)
    expect(screen.getByText("No rows")).toBeInTheDocument()
  })

  it("prefers the error over the skeleton and the empty state", () => {
    const { container } = render(<Table loading error={new Error("Down")} />)
    expect(screen.getByRole("alert")).toHaveTextContent("Down")
    expect(container.querySelector("tr.dt-skeleton-row")).toBeNull()
    expect(screen.queryByText("No rows")).toBeNull()
  })
})
