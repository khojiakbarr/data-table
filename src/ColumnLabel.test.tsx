import { createColumnHelper } from "@tanstack/react-table"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { DataTable } from "./components/DataTable"
import { useDataTable, type DataTableFeatures } from "./useDataTable"

/**
 * A host's utility column draws its header — a checkbox, an icon — and so has
 * no text of its own. The Columns panel listed it by its id ("pick"), which is
 * a developer's word in front of a user; `meta.label` gives it a name.
 */

interface Row {
  id: string
  name: string
}

const helper = createColumnHelper<DataTableFeatures, Row>()

function Labelled() {
  const instance = useDataTable({
    id: "column-label",
    data: [{ id: "a", name: "Alpha" }],
    columns: [
      helper.display({ id: "pick", header: () => <span aria-hidden>☐</span>, meta: { label: "Choose", menu: false }, enableHiding: false }),
      helper.accessor("name", { header: "Name" }),
    ],
  })
  return <DataTable instance={instance} />
}

describe("a column whose header is drawn", () => {
  beforeEach(() => localStorage.clear())

  it("is listed in the Columns panel by its meta label, not its id", async () => {
    const user = userEvent.setup()
    render(<Labelled />)
    await user.click(screen.getByRole("tab", { name: "Columns" }))

    const panel = document.querySelector<HTMLElement>(".dt-panel")
    if (!panel) throw new Error("the panel is not open")
    expect(within(panel).getByRole("checkbox", { name: "Choose" })).toBeInTheDocument()
    expect(within(panel).queryByText("pick")).not.toBeInTheDocument()
  })
})
