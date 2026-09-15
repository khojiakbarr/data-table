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

function Table(props: { data?: Row[]; loading?: boolean; error?: unknown; onRetry?: () => void }) {
  const instance = useDataTable<Row>({ id: "st", columns, data: props.data ?? [], mode: "server", rowCount: props.data?.length ?? 0, getRowId: (r) => r.id })
  return <DataTable instance={instance} loading={props.loading} error={props.error} onRetry={props.onRetry} virtualize={false} />
}

describe("loading states", () => {
  it("shows skeleton rows on first load", () => {
    const { container } = render(<Table loading />)
    expect(container.querySelectorAll("tr.dt-skeleton-row").length).toBeGreaterThan(0)
    expect(screen.queryByText("No rows")).toBeNull()
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
    render(<Table data={rows} error={new Error("Boom")} onRetry={onRetry} />)
    expect(screen.getByRole("alert")).toHaveTextContent("Boom")
    expect(screen.getByText("Alpha")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
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
