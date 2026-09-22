import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { CellEditor } from "./components/CellEditor"
import type { EditableKind } from "./core/cellEditing"
import type { FilterValue, FilterValueOption } from "./core/filters"
import { defaultCellEditingLabels } from "./labels/editing"

/**
 * The five inline cell editors, standing alone.
 *
 * Every test here drives the component through props only — no table, no row —
 * which is the whole point of building it this way: the behaviour §3 describes
 * is settled before anything is wired to it.
 */

const FIELD = "Amount: Value"

/** Renders one editor and records what it reported. */
function setup(
  kind: EditableKind,
  value: unknown,
  choices?: readonly FilterValueOption[],
) {
  const onCommit = vi.fn<(value: FilterValue | null) => void>()
  const onCancel = vi.fn<() => void>()
  render(
    <CellEditor
      kind={kind}
      value={value}
      name="Amount"
      labels={defaultCellEditingLabels}
      {...(choices ? { choices } : {})}
      onCommit={onCommit}
      onCancel={onCancel}
    />,
  )
  return { onCommit, onCancel, field: screen.getByLabelText(FIELD), user: userEvent.setup() }
}

/**
 * A cell that owns its value, so "Escape restores the old one" is observable
 * as the thing a user would see rather than as a callback that fired.
 */
function EditableCell({ kind, initial }: { kind: EditableKind; initial: unknown }) {
  const [value, setValue] = useState<unknown>(initial)
  const [editing, setEditing] = useState(true)
  return (
    <div>
      <span data-testid="cell">{value === null ? "—" : String(value)}</span>
      {editing ? (
        <CellEditor
          kind={kind}
          value={value}
          name="Amount"
          labels={defaultCellEditingLabels}
          onCommit={(next) => {
            setValue(next)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </div>
  )
}

describe("opening an editor", () => {
  it("selects a text value, so typing replaces it", async () => {
    const { field, user } = setup("text", "Ada")
    expect(field).toHaveFocus()
    expect((field as HTMLInputElement).selectionStart).toBe(0)
    expect((field as HTMLInputElement).selectionEnd).toBe(3)

    await user.keyboard("Grace")
    expect(field).toHaveValue("Grace")
  })

  it("selects a number value too — it is edited in a text field for exactly this", async () => {
    const { field, user } = setup("number", 42)
    expect(field).toHaveValue("42")
    expect((field as HTMLInputElement).selectionEnd).toBe(2)

    await user.keyboard("7")
    expect(field).toHaveValue("7")
  })

  it("opens a date on the cell's own day, focused", () => {
    const { field } = setup("date", new Date(2026, 0, 31, 23, 30))
    expect(field).toHaveValue("2026-01-31")
    expect(field).toHaveFocus()
  })

  it("opens a boolean on the option the cell holds", () => {
    const { field } = setup("boolean", false)
    expect(field).toHaveValue("false")
    expect(field).toHaveFocus()
  })

  it("opens a list on the cell's own value, and offers one choice at a time", () => {
    const choices = [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }]
    const { field } = setup("list", "closed", choices)
    // A single-value control, unlike the list *filter*, which ticks several.
    expect(field.tagName).toBe("SELECT")
    expect((field as HTMLSelectElement).multiple).toBe(false)
    expect(field).toHaveValue("closed")
  })
})

describe("committing", () => {
  it("commits text on Enter and reports the new value", async () => {
    const { field, user, onCommit, onCancel } = setup("text", "Ada")
    await user.keyboard("Grace{Enter}")
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Grace")
    expect(onCancel).not.toHaveBeenCalled()
    expect(field).toBeInTheDocument()
  })

  it("commits a number as a number, not as the text of one", async () => {
    const { user, onCommit } = setup("number", 42)
    await user.keyboard("12.5{Enter}")
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(12.5)
  })

  it("commits a date as the day it names", () => {
    const { field, onCommit } = setup("date", "2026-01-31")
    fireEvent.change(field, { target: { value: "2026-02-01" } })
    fireEvent.keyDown(field, { key: "Enter" })
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("2026-02-01")
  })

  it("commits a boolean as a boolean", async () => {
    const { field, user, onCommit } = setup("boolean", true)
    await user.selectOptions(field, "false")
    await user.keyboard("{Enter}")
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(false)
  })

  it("commits a list choice with the type the host gave it", async () => {
    const { field, user, onCommit } = setup("list", 1, [{ value: 1 }, { value: 2 }])
    await user.selectOptions(field, "2")
    await user.keyboard("{Enter}")
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(2)
  })

  it("commits on blur, because a user who clicks away has moved on", async () => {
    const { field, user, onCommit } = setup("text", "Ada")
    await user.keyboard("Grace")
    fireEvent.blur(field)
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Grace")
  })

  it("empties a cell rather than writing an empty string into it", async () => {
    const { user, onCommit } = setup("number", 42)
    // The value opened selected, so one Backspace is the whole cell.
    await user.keyboard("{Backspace}{Enter}")
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(null)
  })

  it("commits once, however many times the editor is asked to", async () => {
    const { field, user, onCommit } = setup("text", "Ada")
    await user.keyboard("Grace{Enter}")
    fireEvent.blur(field)
    fireEvent.keyDown(field, { key: "Enter" })
    expect(onCommit).toHaveBeenCalledOnce()
  })

  it("treats a commit that changed nothing as a cancel — an edit is a request", async () => {
    const { user, onCommit, onCancel } = setup("text", "Ada")
    await user.keyboard("{Enter}")
    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("leaves an IME's Enter to the IME", async () => {
    const { field, user, onCommit } = setup("text", "Ada")
    await user.keyboard("Grace")
    fireEvent.keyDown(field, { key: "Enter", isComposing: true })
    expect(onCommit).not.toHaveBeenCalled()
  })
})

describe("cancelling", () => {
  it("restores the old value on Escape and reports nothing", async () => {
    const { field, user, onCommit, onCancel } = setup("text", "Ada")
    await user.keyboard("Grace")
    await user.keyboard("{Escape}")
    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
    // Still mounted here, so the restore is visible: a caller that keeps the
    // editor open must not be left showing the abandoned draft.
    expect(field).toHaveValue("Ada")
  })

  it("leaves the cell's own value untouched", async () => {
    const user = userEvent.setup()
    render(<EditableCell kind="text" initial="Ada" />)
    await user.keyboard("Grace{Escape}")
    expect(screen.getByTestId("cell")).toHaveTextContent("Ada")
    expect(screen.queryByLabelText(FIELD)).not.toBeInTheDocument()
  })

  it("writes the committed value into the cell", async () => {
    const user = userEvent.setup()
    render(<EditableCell kind="text" initial="Ada" />)
    await user.keyboard("Grace{Enter}")
    expect(screen.getByTestId("cell")).toHaveTextContent("Grace")
    expect(screen.queryByLabelText(FIELD)).not.toBeInTheDocument()
  })

  it("keeps Escape to itself, so a menu or dialog around it does not also react", async () => {
    const onOuterEscape = vi.fn<() => void>()
    const user = userEvent.setup()
    render(
      <div
        onKeyDown={(event) => {
          if (event.key === "Escape") onOuterEscape()
        }}
      >
        <CellEditor
          kind="text"
          value="Ada"
          name="Amount"
          labels={defaultCellEditingLabels}
          onCommit={vi.fn()}
          onCancel={vi.fn()}
        />
      </div>,
    )
    await user.keyboard("{Escape}")
    expect(onOuterEscape).not.toHaveBeenCalled()
  })
})

describe("a value that cannot be committed", () => {
  it("refuses a number that is not one, and says why", async () => {
    const { field, user, onCommit } = setup("number", 42)
    await user.keyboard("12px{Enter}")
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number")
    // The editor stays, holding what was typed, and says the field is wrong.
    expect(field).toBeInTheDocument()
    expect(field).toHaveValue("12px")
    expect(field).toHaveAttribute("aria-invalid", "true")
    expect(field).toHaveAccessibleDescription("Enter a number")
  })

  it("refuses a half-typed date instead of emptying the cell", () => {
    const { field, onCommit } = setup("date", "2026-01-31")
    /*
     * What a real date input does with "2026-02-3": it reports `value` as ""
     * and raises `badInput`. jsdom implements the first half only (it
     * sanitises an unparseable value away, which is why the day is set here by
     * hand), so the flag is supplied — the branch under test is the one that
     * reads it, and without it this commit would clear the cell.
     */
    fireEvent.change(field, { target: { value: "" } })
    Object.defineProperty(field, "validity", { value: { badInput: true }, configurable: true })
    fireEvent.keyDown(field, { key: "Enter" })

    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a date as YYYY-MM-DD")
  })

  it("does not commit an invalid value on blur either", async () => {
    const { field, user, onCommit, onCancel } = setup("number", 42)
    await user.keyboard("12px")
    fireEvent.blur(field)
    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toBeInTheDocument()
  })

  it("takes the refusal back as soon as the draft changes", async () => {
    const { field, user, onCommit } = setup("number", 42)
    await user.keyboard("12px{Enter}")
    expect(screen.getByRole("alert")).toBeInTheDocument()

    await user.clear(field)
    await user.keyboard("13{Enter}")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(13)
  })

  it("still lets Escape out of an invalid value", async () => {
    const { user, onCommit, onCancel } = setup("number", 42)
    await user.keyboard("12px{Enter}")
    await user.keyboard("{Escape}")
    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
