import type { Column, RowData } from "@tanstack/react-table"
import { useState, type ChangeEvent, type KeyboardEvent } from "react"
import { columnLabel } from "../core/columnLabel"
import {
  draftFromCondition,
  draftToCondition,
  emptyDraft,
  isBlankOperator,
  isRangeOperator,
  operatorChoices,
  withOperator,
  type FilterDraft,
} from "../core/filterDraft"
import { layoutSliceEqual } from "../core/useArrangement"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

/**
 * One column's filter, as a set of form controls.
 *
 * Both surfaces render this: the popover a header menu opens (§8.2) and the
 * inline editor in the side panel's Filters tab (§8.3). Neither holds
 * committed state of its own — the draft lives here, and it is discarded or
 * applied, never synced.
 */

export interface FilterEditorProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  column: Column<DataTableFeatures, TData, unknown>
  labels: DataTableLabels
  /** Called after the editor commits or clears, so a popover can close itself. */
  onCommit?: (() => void) | undefined
  /** Take the focus on mount. The popover does; the panel's inline editor does not. */
  autoFocus?: boolean
}

/**
 * Whether a column gets a filter editor at all.
 *
 * Three independent gates, and all three matter: `instance.filtering.enabled`
 * is `false` for a host that passed `filtering: false` — `filterKinds` is
 * resolved from the column definitions regardless, so it says nothing about
 * that on its own; TanStack's `getCanFilter()` covers the accessor and the
 * `enableColumnFilter*` flags but knows nothing about `meta.filter`; and
 * `meta: { filter: false }` is how a host turns filtering off for one column.
 *
 * @param instance - The table instance.
 * @param column - The column to test.
 * @returns True when filtering is on for the table and the column has both an
 *   accessor and a resolved kind.
 */
export function canFilterColumn<TData extends RowData>(
  instance: DataTableInstance<TData>,
  column: Column<DataTableFeatures, TData, unknown>,
): boolean {
  const kind = instance.filtering.kinds.get(column.id)
  return instance.filtering.enabled && column.getCanFilter() && kind !== undefined && kind !== false
}

/**
 * One column's filter, wired to the live instance.
 *
 * Remounted whenever `column` changes, through the `key` on the body below:
 * the draft `useState` seeds itself once from the column it opened with, and
 * nothing re-seeds it on a later render, so a caller that swaps `column`
 * prop on an already-mounted editor (nothing in this library does that today
 * — the popover and the panel both remount per column already — but nothing
 * in the exported type says a host may not) would otherwise be left showing
 * the previous column's draft under the new column's label and operators.
 */
export function FilterEditor<TData extends RowData>(props: FilterEditorProps<TData>) {
  return <FilterEditorBody key={props.column.id} {...props} />
}

function FilterEditorBody<TData extends RowData>({
  instance,
  column,
  labels,
  onCommit,
  autoFocus = false,
}: FilterEditorProps<TData>) {
  const { filtering } = instance
  const kind = filtering.kinds.get(column.id)
  const name = columnLabel(column.id, column.columnDef.header)
  const current = filtering.conditions.find((condition) => condition.field === column.id)
  /*
   * Seeded once and never synced: §8.3 makes a draft something that is
   * discarded or applied, and re-seeding it from `conditions` would wipe out
   * what the user is typing the moment any other surface committed anything.
   */
  const [draft, setDraft] = useState<FilterDraft>(() =>
    draftFromCondition(current, kind === undefined || kind === false ? "text" : kind),
  )

  // After the hook, so hook order never depends on which column this is or on
  // whether the host has filtering on at all.
  if (!filtering.enabled) return null
  if (kind === undefined || kind === false) return null

  const commit = (next: FilterDraft) => {
    const built = draftToCondition(next, column.id)
    /*
     * A no-op commit must not reach `filtering.setCondition`/`clearColumn`:
     * `updateFilters` resets the page unconditionally, so a blur that changed
     * nothing (an untouched, empty field; a value equal to what the column
     * already carries) would otherwise send the user back to page 1. `built`
     * and `current` both come out of the constructors in filters.ts, whose
     * whole contract is canonical key order, so a structural compare is exact.
     */
    if (built === null) {
      if (current !== undefined) filtering.clearColumn(column.id)
      return
    }
    if (!layoutSliceEqual(built, current)) filtering.setCondition(built)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    /*
     * Let a button run its own activation. A button's default action on
     * `keydown` IS its click — unlike Space, which activates on `keyup` — so
     * `preventDefault()` below would otherwise swallow that click and this
     * handler's own `commit(draft)` would run in its place. That is silently
     * wrong for Clear, which must never re-apply the draft it is meant to
     * discard, and only coincidentally right for Apply.
     */
    if (event.target instanceof HTMLButtonElement) return
    // A composing IME's Enter confirms a candidate, not the editor: the
    // native event carries `isComposing` for exactly this, and without the
    // check the half-typed candidate is committed as the filter value.
    if (event.nativeEvent.isComposing) return
    // Enter commits from anywhere in the editor. There is no <form> here: a
    // filter editor inside a table is not a submission, and a form element
    // would bring a page reload with it.
    if (event.key !== "Enter") return
    event.preventDefault()
    commit(draft)
    onCommit?.()
  }

  const handleOperator = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = withOperator(draft, event.target.value)
    setDraft(next)
    /*
     * Applied at once rather than on Apply: §6.2 counts choosing an operator,
     * ticking a value and picking a day as discrete, deliberate acts, where a
     * delay feels broken. Only typing waits — for blur, Enter or Apply.
     */
    commit(next)
  }

  const handleClear = () => {
    // Same no-op guard as `commit`: a column that carries no condition has
    // nothing to clear, and calling `clearColumn` anyway would still cost the
    // user their page position for changing nothing.
    if (current !== undefined) filtering.clearColumn(column.id)
    setDraft(emptyDraft(kind))
    onCommit?.()
  }

  const handleApply = () => {
    commit(draft)
    onCommit?.()
  }

  // The operator select takes the focus only when there is no field to type in.
  const focusSelect = autoFocus && (isBlankOperator(draft) || draft.kind === "boolean")

  return (
    <div className="dt-filter-editor" onKeyDown={handleKeyDown}>
      <select
        className="dt-select"
        aria-label={`${name}: ${labels.operator}`}
        value={draft.kind === "date" ? draft.mode : draft.op}
        onChange={handleOperator}
        autoFocus={focusSelect}
      >
        {operatorChoices(draft.kind).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {labels[choice.labelKey]}
          </option>
        ))}
      </select>

      <DraftFields
        draft={draft}
        name={name}
        labels={labels}
        autoFocus={autoFocus && !focusSelect}
        onDraft={setDraft}
        onCommit={commit}
      />

      <div className="dt-filter-actions">
        <button type="button" className="dt-link" onClick={handleClear}>
          {labels.clearFilter}
        </button>
        <span className="dt-spacer" />
        <button type="button" className="dt-menu-button" onClick={handleApply}>
          {labels.apply}
        </button>
      </div>
    </div>
  )
}

interface DraftFieldsProps {
  draft: FilterDraft
  /** The column's name, so every field says which column it belongs to. */
  name: string
  labels: DataTableLabels
  autoFocus: boolean
  onDraft: (draft: FilterDraft) => void
  onCommit: (draft: FilterDraft) => void
}

/**
 * The value controls one draft needs — which is none for some operators.
 *
 * Typing records and waits; picking a day records and applies. Both rules are
 * §6.2's, and the difference is what keeps a half-typed number out of the
 * query while a chosen date reaches it at once.
 */
function DraftFields({ draft, name, labels, autoFocus, onDraft, onCommit }: DraftFieldsProps) {
  /** A discrete choice: recorded and applied at once. */
  const choose = (next: FilterDraft) => {
    onDraft(next)
    onCommit(next)
  }

  if (draft.kind === "list") {
    /*
     * Task 18 replaces this with the real values list. Until then a list
     * column has no source of choices in either mode, which is exactly what
     * this line says: §5.3 refuses to show an empty checkbox list, because
     * silence there reads as "there is no data".
     */
    return <p className="dt-filter-note">{labels.noValues}</p>
  }
  if (isBlankOperator(draft) || draft.kind === "boolean") return null

  if (draft.kind === "date") {
    if (isRangeOperator(draft)) {
      return (
        <>
          <input
            type="date"
            className="dt-filter-input"
            aria-label={`${name}: ${labels.rangeFrom}`}
            value={draft.from}
            autoFocus={autoFocus}
            onChange={(event) => choose({ ...draft, from: event.target.value })}
          />
          <input
            type="date"
            className="dt-filter-input"
            aria-label={`${name}: ${labels.rangeTo}`}
            value={draft.to}
            onChange={(event) => choose({ ...draft, to: event.target.value })}
          />
        </>
      )
    }
    return (
      <input
        type="date"
        className="dt-filter-input"
        aria-label={`${name}: ${labels.filterValue}`}
        value={draft.day}
        autoFocus={autoFocus}
        onChange={(event) => choose({ ...draft, day: event.target.value })}
      />
    )
  }

  if (draft.kind === "number") {
    if (isRangeOperator(draft)) {
      return (
        <>
          <input
            type="number"
            className="dt-filter-input"
            aria-label={`${name}: ${labels.rangeFrom}`}
            value={draft.from}
            autoFocus={autoFocus}
            onChange={(event) => onDraft({ ...draft, from: event.target.value })}
            onBlur={() => onCommit(draft)}
          />
          <input
            type="number"
            className="dt-filter-input"
            aria-label={`${name}: ${labels.rangeTo}`}
            value={draft.to}
            onChange={(event) => onDraft({ ...draft, to: event.target.value })}
            onBlur={() => onCommit(draft)}
          />
        </>
      )
    }
    return (
      <input
        type="number"
        className="dt-filter-input"
        aria-label={`${name}: ${labels.filterValue}`}
        value={draft.value}
        autoFocus={autoFocus}
        onChange={(event) => onDraft({ ...draft, value: event.target.value })}
        onBlur={() => onCommit(draft)}
      />
    )
  }

  return (
    <input
      type="text"
      className="dt-filter-input"
      aria-label={`${name}: ${labels.filterValue}`}
      value={draft.value}
      autoFocus={autoFocus}
      onChange={(event) => onDraft({ ...draft, value: event.target.value })}
      onBlur={() => onCommit(draft)}
    />
  )
}
