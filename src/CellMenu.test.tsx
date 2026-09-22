import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useRef, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { CellMenu } from "./components/CellMenu"
import type { NotEditableReason } from "./core/cellEditing"
import { defaultCellEditingLabels } from "./labels/editing"

/**
 * The cell's context menu, standing alone.
 *
 * jsdom lays nothing out, so the menu measures 0×0 here and the viewport clamp
 * reduces to "no further than the edge minus the margin" — enough to prove the
 * clamp runs in both axes, which is the same bargain `HeaderMenuPlacement`
 * strikes for the menu this one shares its placement with.
 */

const MENU_MARGIN_PX = 8

function open(
  props: Partial<{ x: number; y: number; notEditable: NotEditableReason }> = {},
) {
  const onEdit = vi.fn<() => void>()
  const onClose = vi.fn<() => void>()
  render(
    <CellMenu
      position={{ x: props.x ?? 120, y: props.y ?? 40 }}
      labels={defaultCellEditingLabels}
      {...(props.notEditable ? { notEditable: props.notEditable } : {})}
      onEdit={onEdit}
      onClose={onClose}
    />,
  )
  return { onEdit, onClose, menu: screen.getByRole("menu"), user: userEvent.setup() }
}

/**
 * A cell that owns the menu, so "Escape closes it and gives the focus back" is
 * testable end to end: the real close unmounts the menu, which is when the
 * focus has to land somewhere.
 */
function CellWithMenu() {
  const cellRef = useRef<HTMLTableCellElement>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <table>
        <tbody>
          <tr>
          {/* tabIndex only so this test has something the focus can return
              to. Body cells are not focusable in the library today — see the
              note in CellMenu's own docs. */}
            <td
              ref={cellRef}
              tabIndex={-1}
              onContextMenu={(event) => {
                event.preventDefault()
                setAt({ x: event.clientX, y: event.clientY })
              }}
            >
              120
            </td>
          </tr>
        </tbody>
      </table>
      {at ? (
        <CellMenu
          position={at}
          labels={defaultCellEditingLabels}
          returnFocusTo={cellRef.current}
          onEdit={() => undefined}
          onClose={() => setAt(null)}
        />
      ) : null}
    </>
  )
}

describe("where the cell menu opens", () => {
  it("opens where it was told to", () => {
    const { menu } = open({ x: 120, y: 40 })
    expect(menu.style.left).toBe("120px")
    expect(menu.style.top).toBe("40px")
  })

  it("stays inside the window when the pointer is near its edge", () => {
    const { menu } = open({ x: window.innerWidth + 500, y: window.innerHeight + 500 })
    expect(menu.style.left).toBe(`${window.innerWidth - MENU_MARGIN_PX}px`)
    expect(menu.style.top).toBe(`${window.innerHeight - MENU_MARGIN_PX}px`)
  })

  it("is a menu, named as one", () => {
    const { menu } = open()
    expect(menu).toHaveAccessibleName("Cell actions")
  })
})

describe("the Edit item", () => {
  it("comes first, takes the focus, and runs", async () => {
    const { onEdit, onClose, user } = open()
    const edit = screen.getByRole("menuitem", { name: /edit/i })
    expect(edit).toHaveFocus()

    await user.click(edit)
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("is offered but disabled, with the reason on it, for a cell that cannot be edited", async () => {
    const { onEdit, onClose, user } = open({ notEditable: "column" })
    const edit = screen.getByRole("menuitem", { name: /edit/i })
    expect(edit).toHaveAttribute("aria-disabled", "true")
    expect(edit).toHaveTextContent("This column cannot be edited")

    await user.click(edit)
    expect(onEdit).not.toHaveBeenCalled()
    // A refusal is not a choice: the menu stays where it is.
    expect(onClose).not.toHaveBeenCalled()
  })

  it("stays focusable while disabled, so the reason is announced rather than skipped", () => {
    open({ notEditable: "group" })
    const edit = screen.getByRole("menuitem", { name: /edit/i })
    expect(edit).not.toHaveAttribute("disabled")
    expect(edit).toHaveFocus()
  })

  it("speaks each reason in its own words", () => {
    const reasons: [NotEditableReason, string][] = [
      ["column", "This column cannot be edited"],
      ["row", "This row cannot be edited"],
      ["group", "A group row cannot be edited"],
      ["unavailable", "Editing is not available"],
    ]
    for (const [reason, text] of reasons) {
      const { unmount } = render(
        <CellMenu
          position={{ x: 10, y: 10 }}
          labels={defaultCellEditingLabels}
          notEditable={reason}
          onEdit={() => undefined}
          onClose={() => undefined}
        />,
      )
      expect(screen.getByRole("menuitem", { name: /edit/i })).toHaveTextContent(text)
      unmount()
    }
  })

  it("leaves room after itself for the row actions to come", () => {
    render(
      <CellMenu
        position={{ x: 10, y: 10 }}
        labels={defaultCellEditingLabels}
        onEdit={() => undefined}
        onClose={() => undefined}
      >
        <button type="button" role="menuitem" className="dt-menu-item">
          Delete row
        </button>
      </CellMenu>,
    )
    const items = screen.getAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual(["Edit", "Delete row"])
  })
})

describe("dismissing the cell menu", () => {
  it("closes on Escape", async () => {
    const { onClose, user } = open()
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("closes on a pointer pressed outside it, and not on one inside", () => {
    const { onClose, menu } = open()
    fireEvent.pointerDown(menu)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("gives the focus back to the cell it was opened on", async () => {
    const user = userEvent.setup()
    render(<CellWithMenu />)
    const cell = screen.getByRole("cell")

    fireEvent.contextMenu(cell, { clientX: 30, clientY: 30 })
    expect(screen.getByRole("menuitem", { name: /edit/i })).toHaveFocus()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(cell).toHaveFocus()
  })

  it("does not steal the focus back from wherever the user went instead", async () => {
    const user = userEvent.setup()
    render(
      <>
        <CellWithMenu />
        <button type="button">Elsewhere</button>
      </>,
    )
    fireEvent.contextMenu(screen.getByRole("cell"), { clientX: 30, clientY: 30 })
    // A click outside both closes the menu AND moves the focus; the close must
    // not then drag the focus back to the cell the user just left.
    await user.click(screen.getByRole("button", { name: "Elsewhere" }))
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus()
  })
})
