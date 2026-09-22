import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import {
  draftFromValue,
  isUnchanged,
  parseDraft,
  type EditableKind,
  type ParsedDraft,
} from "../core/cellEditing"
import type { FilterValue, FilterValueOption } from "../core/filters"
import type { CellEditingLabels } from "../labels/editing"

/**
 * One cell's inline editor.
 *
 * Driven entirely by props and ignorant of the table: it is handed a kind, the
 * value the cell held when the editor opened, and two callbacks. That is what
 * lets it be tested on its own now and mounted inside a row later, and it is
 * what keeps the `previous` value honest — the value this component was opened
 * with is the one it compares against at commit time, never a value read back
 * from a row that may have been refetched in between.
 *
 * What it shares with `FilterEditor`: the five kinds, the "no-op commit must
 * not reach the callback" rule, and the composing-IME guard on Enter. What it
 * deliberately does not: a filter's discrete controls apply the moment they
 * change, because a filter is cheap and reversible, whereas an edit is a write
 * to somebody's database — so a `<select>` here records the choice and waits
 * for Enter or a blur like every other field. And a list filter picks several
 * values where this picks one, which is why it renders a `<select>` rather
 * than reusing `FilterValues`' checkbox list.
 */
export interface CellEditorProps {
  /** Which editor to render. */
  kind: EditableKind
  /**
   * The cell's value at the moment the editor opened. Captured by the caller
   * and held still for the editor's whole life: §4 asks for exactly this, so a
   * refetch between opening and committing cannot rewrite what the edit was
   * "from".
   */
  value: unknown
  /** The column's name, so the field says which column it belongs to. */
  name: string
  labels: CellEditingLabels
  /** The values a list editor offers. Ignored by every other kind. */
  choices?: readonly FilterValueOption[] | undefined
  /**
   * The edit was made. Called at most once, and never for a value equal to the
   * one the editor opened with — that is a cancel, not a write.
   */
  onCommit: (value: FilterValue | null) => void
  /** The edit was abandoned: Escape, or a commit that changed nothing. */
  onCancel: () => void
}

/**
 * The editor for one cell: opens with its value selected, commits on Enter or
 * blur, cancels on Escape, and refuses to commit a value it cannot parse.
 *
 * @param props - See {@link CellEditorProps}.
 * @returns The editor's field, and the refusal under it when there is one.
 *
 * @example
 * <CellEditor kind="number" value={row.amount} name="Amount" labels={labels}
 *   onCommit={(value) => save(value)} onCancel={close} />
 */
export function CellEditor({
  kind,
  value,
  name,
  labels,
  choices,
  onCommit,
  onCancel,
}: CellEditorProps) {
  const [draft, setDraft] = useState(() => draftFromValue(value, kind))
  const [refusal, setRefusal] = useState<Extract<ParsedDraft, { ok: false }>["reason"] | null>(null)
  const fieldRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null)
  const errorId = useId()
  /*
   * An editor settles once. Enter commits and the caller usually unmounts us,
   * but nothing in the props says it must — and a caller that keeps the editor
   * mounted would otherwise see the following blur commit the same edit a
   * second time, which in a server-first table is a second request.
   */
  const settledRef = useRef(false)

  useEffect(() => {
    const field = fieldRef.current
    if (!field) return
    field.focus()
    /*
     * §3: the value is selected on open, so typing replaces it. Only a text
     * input has a selection to make — the selection API applies to neither a
     * `<select>` nor `<input type="date">`, where the value is replaced
     * wholesale by a choice rather than by typing over it.
     */
    if (field instanceof HTMLInputElement && field.type === "text") field.select()
  }, [kind])

  const commit = () => {
    if (settledRef.current) return
    const field = fieldRef.current
    /*
     * A date input holding a half-typed day reports its value as `""`: the
     * browser will not guess at "2026-02-3", and the draft this component sees
     * is empty. Committing that would EMPTY the cell for a user whose only
     * mistake was pressing Enter a keystroke early — the silent loss of a
     * typed value §4 rules out. `badInput` is the input saying "there is
     * something in me that I cannot read", and it is the only way to tell that
     * apart from a cell the user deliberately cleared.
     */
    if (kind === "date" && field !== null && field.validity.badInput) {
      setRefusal("invalidDate")
      return
    }
    const parsed = parseDraft(draft, kind, choices)
    if (!parsed.ok) {
      // The editor stays open and says why. Escape is still the way out, and
      // a blur that could not commit has not thrown the typed value away.
      setRefusal(parsed.reason)
      return
    }
    settledRef.current = true
    if (isUnchanged(value, parsed.value, kind)) {
      onCancel()
      return
    }
    onCommit(parsed.value)
  }

  const cancel = () => {
    if (settledRef.current) return
    settledRef.current = true
    // Restored here as well as announced: a caller that leaves the editor
    // mounted after a cancel must not be showing the abandoned draft.
    setDraft(draftFromValue(value, kind))
    setRefusal(null)
    onCancel()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A composing IME's Enter confirms a candidate, not the edit — the same
    // guard `FilterEditor` carries, for the same reason: without it the
    // half-typed candidate is what gets written.
    if (event.nativeEvent.isComposing) return
    if (event.key === "Enter") {
      event.preventDefault()
      commit()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      /*
       * The menu that opened this editor listens for Escape on the document,
       * and so does any dialog the table is inside. Escape in an open editor
       * means "abandon this edit" and nothing further.
       */
      event.stopPropagation()
      cancel()
    }
    // Tab is left alone on purpose: it moves the focus, the field blurs, and
    // the blur commits. Moving on to the next editable cell is the table's
    // job, not this component's — it knows of no cell but its own.
  }

  const describedBy = refusal === null ? undefined : errorId
  const field = {
    className: kind === "boolean" || kind === "list" ? "dt-select" : "dt-filter-input",
    "aria-label": `${name}: ${labels.editValue}`,
    "aria-invalid": refusal !== null,
    "aria-describedby": describedBy,
    title: labels.editHint,
    onBlur: commit,
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value)
      // The refusal described a draft that no longer exists.
      setRefusal(null)
    },
  }

  return (
    <div className="dt-cell-editor" onKeyDown={handleKeyDown}>
      {kind === "boolean" || kind === "list" ? (
        <select
          {...field}
          ref={(node) => {
            fieldRef.current = node
          }}
          value={draft}
        >
          {/* Emptying a cell is an edit in its own right; a host that forbids
              it says so from `onCellEdit`, where its own rules live. */}
          <option value="">{labels.noValue}</option>
          {kind === "boolean" ? (
            <>
              <option value="true">{labels.booleanTrue}</option>
              <option value="false">{labels.booleanFalse}</option>
            </>
          ) : (
            (choices ?? []).map((choice) => (
              <option key={String(choice.value)} value={String(choice.value)}>
                {choice.label ?? String(choice.value)}
              </option>
            ))
          )}
        </select>
      ) : (
        <input
          {...field}
          ref={(node) => {
            fieldRef.current = node
          }}
          /*
           * A number is edited in a TEXT field, with the numeric keyboard
           * asked for rather than imposed. Two reasons, both load-bearing:
           * `<input type="number">` has no selection to make on open, so the
           * value could not be selected for typing to replace; and it silently
           * swallows what it considers non-numeric, which would make the
           * refusal below unreachable and hand the user a field that just
           * ignores keys instead of one that says what is wrong. `parseDraft`
           * decides what is a number, and says so when it is not.
           */
          type={kind === "date" ? "date" : "text"}
          inputMode={kind === "number" ? "decimal" : undefined}
          value={draft}
        />
      )}

      {refusal === null ? null : (
        <p className="dt-cell-editor-error" id={errorId} role="alert">
          {labels[refusal]}
        </p>
      )}
    </div>
  )
}
