import type { Column, RowData } from "@tanstack/react-table"
import { useCallback, useEffect, useRef, useState } from "react"
import { columnLabel } from "../core/columnLabel"
import type { ListDraft } from "../core/filterDraft"
import { isFilterValue, type FilterValue, type FilterValueOption } from "../core/filters"
import { useDebouncedValue } from "../core/useDebouncedValue"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

/**
 * The checkbox list a `list` column is filtered with.
 *
 * Its choices come from exactly one source (§5.3): `meta.values` wherever it is
 * declared, otherwise client-side faceting with its free counts, otherwise
 * `loadValues` in server mode. A column with none of the three is disabled
 * with a label — never an empty list, which reads as "there is no data".
 */

/** How long a values search waits before the host is asked again. */
const VALUES_SEARCH_DEBOUNCE_MS = 300

/** Numeric-aware, so 9 sorts before 10 rather than after it. */
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

export interface FilterValuesProps<TData extends RowData> {
  instance: DataTableInstance<TData>
  column: Column<DataTableFeatures, TData, unknown>
  labels: DataTableLabels
  draft: ListDraft
  /** Ticking is a discrete act, so the new draft is applied at once (§6.2). */
  onDraft: (draft: ListDraft) => void
}

/**
 * One column's values list, wired to whichever source can supply it.
 *
 * @param props - The instance and column being edited, the labels, the list
 *   draft the editor holds, and the callback that records a new one.
 * @returns The search box and checkbox list, or the "no values" note when no
 *   source can supply choices.
 *
 * @example
 * <FilterValues instance={instance} column={column} labels={labels}
 *   draft={draft} onDraft={choose} />
 */
export function FilterValues<TData extends RowData>({
  instance,
  column,
  labels,
  draft,
  onDraft,
}: FilterValuesProps<TData>) {
  const [needle, setNeedle] = useState("")
  // Debounced only where it costs a request; the local filter below is instant.
  const search = useDebouncedValue(needle, VALUES_SEARCH_DEBOUNCE_MS)
  const name = columnLabel(column.id, column.columnDef.header)

  /*
   * One source, in §5.3's order. Faceting is deliberately not memoised: it is
   * already memoised inside TanStack, only one editor is open at a time, and a
   * dependency list here would have to name every filter on every other column
   * — the very thing `getFacetedRowModel()` narrows by.
   */
  const declared = column.columnDef.meta?.values
  const facets = declared === undefined && instance.mode === "client" ? facetOptions(column) : null
  const usesServer =
    declared === undefined &&
    facets === null &&
    instance.mode === "server" &&
    instance.filtering.loadValues !== undefined
  const loaded = useLoadedValues(instance, column.id, search, usesServer)

  const sourced = declared ?? facets?.options ?? loaded.options
  const hasSource = declared !== undefined || facets !== null || usesServer
  if (!hasSource) return <p className="dt-filter-note">{labels.noValues}</p>

  /*
   * A ticked value the current source no longer offers is unioned back in.
   * Without this, narrowing the source (a facet count going to zero under
   * another column's filter, a server answer that no longer includes it)
   * silently un-lists a member that is still active in the condition, and the
   * list shows nothing selected on a column that is filtering rows away — the
   * narrowing half of the Excel/AG Grid behaviour without the half that keeps
   * selected members present. No count is given for it, since the source that
   * would have supplied one does not carry it any more.
   */
  const missing: FilterValueOption[] = draft.values
    .filter((value) => !sourced.some((option) => option.value === value))
    .map((value) => ({ value }))
  const options: FilterValueOption[] = missing.length === 0 ? sourced : [...sourced, ...missing]

  /*
   * Filtered locally in both modes: server-side the host has already narrowed
   * the list, but the previous result stays on screen while a new one is in
   * flight, and it should narrow with the box rather than lag behind it.
   */
  const visible = options.filter(
    (option) =>
      needle === "" ||
      String(option.label ?? option.value)
        .toLowerCase()
        .includes(needle.toLowerCase()),
  )
  const visibleValues = visible.map((option) => option.value)
  const blankSelected = draft.op === "blank"
  const allSelected =
    visible.length > 0 && visibleValues.every((value) => draft.values.includes(value))
  /** A value set and blankness cannot both be carried, so choosing one drops the other. */
  const valueOp = draft.op === "blank" || draft.op === "notBlank" ? "in" : draft.op

  const toggleValue = (value: FilterValue, on: boolean) => {
    const values = on
      ? [...draft.values, value]
      : draft.values.filter((member) => member !== value)
    onDraft({ kind: "list", op: valueOp, values })
  }

  /*
   * Select all reads and writes the visible slice only, as a union/difference
   * over `draft.values` rather than a replacement of it. A plain "check ->
   * write the visible values, uncheck -> write []" silently discards whatever
   * the search box has hidden: ticking a new value under a search can drop an
   * already-selected one outside it, and unticking a fully-selected list under
   * a search can wipe out selections the user never touched or saw.
   */
  const toggleAll = (on: boolean) => {
    const values = on
      ? [...draft.values, ...visibleValues.filter((value) => !draft.values.includes(value))]
      : draft.values.filter((value) => !visibleValues.includes(value))
    onDraft({ kind: "list", op: valueOp, values })
  }

  return (
    <div className="dt-values">
      <input
        type="search"
        className="dt-filter-input"
        aria-label={`${name}: ${labels.searchValues}`}
        placeholder={labels.searchValues}
        value={needle}
        onChange={(event) => setNeedle(event.target.value)}
      />

      {loaded.failed ? (
        <p className="dt-values-failed">
          <span>{labels.valuesFailed}</span>
          <button type="button" className="dt-link" onClick={loaded.retry}>
            {labels.retry}
          </button>
        </p>
      ) : null}

      {/*
        The in-flight state, and the fourth of the four this surface owes: the
        previous answer stays on screen while a new one is requested (§6.3), so
        the list must say it is stale rather than go blank or silently lie.
        `aria-busy` carries both halves — assistive technology hears it, and the
        stylesheet dims the list off the same attribute, with the 0.6 opacity
        and 200ms ease `.dt-loading tbody` already uses for the rows.
      */}
      <ul className="dt-values-list" aria-busy={loaded.loading}>
        {/*
          "A source exists but produced nothing" is still the no-choices case
          §5.3 forbids showing as a bare, live checkbox list: a needle that
          matches nothing, or a first client render with no data yet, both
          read as "there is no data" without this note — and worse, a stray
          click on a live Select All there would write `values: []`, which
          `draftToCondition` turns into null and silently clears an existing
          filter. Loading is exempted: a fetch already in flight is its own
          state, carried by `aria-busy` on the list above.
        */}
        {visible.length === 0 && !loaded.loading ? (
          <li className="dt-values-item">
            <p className="dt-filter-note">{labels.noValues}</p>
          </li>
        ) : (
          <>
            <li className="dt-values-item">
              <label className="dt-values-label">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => toggleAll(event.target.checked)}
                />
                <span>{labels.selectAll}</span>
              </label>
            </li>

            <li className="dt-values-item">
              <label className="dt-values-label">
                <input
                  type="checkbox"
                  checked={blankSelected}
                  onChange={(event) =>
                    /*
                     * Blankness is an operator, not a member: `{ op: "in", values:
                     * [null] }` matches nullish rows on the client and returns
                     * nothing on the server, because `NULL = ANY(ARRAY[NULL])` is
                     * NULL and never true.
                     */
                    onDraft(
                      event.target.checked
                        ? { kind: "list", op: "blank", values: [] }
                        : { kind: "list", op: "in", values: [] },
                    )
                  }
                />
                <span>{labels.blanks}</span>
              </label>
              {facets === null || facets.blanks === 0 ? null : (
                <span className="dt-values-count">{facets.blanks}</span>
              )}
            </li>

            {visible.map((option) => (
              <li key={`${typeof option.value}:${String(option.value)}`} className="dt-values-item">
                <label className="dt-values-label">
                  <input
                    type="checkbox"
                    checked={draft.values.includes(option.value)}
                    onChange={(event) => toggleValue(option.value, event.target.checked)}
                  />
                  <span>{option.label ?? String(option.value)}</span>
                </label>
                {option.count === undefined ? null : (
                  <span className="dt-values-count">{option.count}</span>
                )}
              </li>
            ))}
          </>
        )}
      </ul>
    </div>
  )
}

/**
 * A column's distinct values and their counts, from client-side faceting.
 *
 * `getFacetedUniqueValues()` keys its Map on whatever the accessor returned —
 * a Date, an object, an array element — and a value outside `FilterValue`
 * cannot become a condition: `layoutSliceEqual` treats any two Dates as equal
 * (§3.4), so ticking a different date would be dropped as a no-op. A column
 * whose facets are not JSON primitives does not fall back to faceting at all.
 *
 * @param column - The column being edited.
 * @returns Its options and how many rows are blank, or null when the facets
 *   could never become conditions.
 */
function facetOptions<TData extends RowData>(
  column: Column<DataTableFeatures, TData, unknown>,
): { options: FilterValueOption[]; blanks: number } | null {
  const entries: [unknown, number][] = Array.from(column.getFacetedUniqueValues())
  const options: FilterValueOption[] = []
  let blanks = 0
  for (const [value, count] of entries) {
    // Blankness is an operator, not a member, so a nullish facet is counted
    // rather than listed.
    if (value === null || value === undefined || value === "") {
      blanks += count
      continue
    }
    if (!isFilterValue(value)) return null
    options.push({ value, count })
  }
  options.sort((a, b) => COLLATOR.compare(String(a.value), String(b.value)))
  return { options, blanks }
}

/** A values request's four states, as {@link useLoadedValues} tracks them. */
interface LoadedValues {
  options: FilterValueOption[]
  loading: boolean
  failed: boolean
  retry: () => void
}

/**
 * The host's answer for one column, kept across a new request.
 *
 * A facet request is not a page request and does not share its cache key. A
 * rejected one keeps whatever was already on screen and raises `failed`:
 * falling back to an empty list is the same "there is no data" lie §5.3
 * rejects for a column with no callback at all.
 *
 * `loadValues` itself is held in a ref rather than named as a dependency, the
 * same contract `useTableQuery`'s `onQueryChange` documents: a host wired as
 * `filtering={{ loadValues: (id, o) => api.facets(id, o) }}` — the shape the
 * README's own example uses — hands a fresh arrow to every render, and naming
 * it as a dependency would refetch (and abort the in-flight request) on every
 * one of the host's re-renders, not just the ones that actually change what
 * should be asked for.
 *
 * @param instance - The table instance, for its `loadValues`.
 * @param columnId - Which column's values to ask for.
 * @param search - The editor's search box, already debounced.
 * @param enabled - False when another source supplies the list.
 * @returns The options, whether one is in flight, whether the last one failed,
 *   and a retry.
 */
function useLoadedValues<TData extends RowData>(
  instance: DataTableInstance<TData>,
  columnId: string,
  search: string,
  enabled: boolean,
): LoadedValues {
  const { loadValues } = instance.filtering
  const [state, setState] = useState<{
    options: FilterValueOption[]
    loading: boolean
    failed: boolean
  }>({ options: [], loading: false, failed: false })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  // Refreshed on every render, unconditionally: this is what keeps the ref
  // current without making the callback's own identity a dependency below.
  const loadValuesRef = useRef(loadValues)
  useEffect(() => {
    loadValuesRef.current = loadValues
  })

  useEffect(() => {
    const currentLoadValues = loadValuesRef.current
    if (!enabled || currentLoadValues === undefined) return
    const controller = new AbortController()
    let cancelled = false
    setState((current) => ({ ...current, loading: true, failed: false }))
    currentLoadValues(columnId, { search, signal: controller.signal })
      .then((options) => {
        if (!cancelled) setState({ options, loading: false, failed: false })
      })
      .catch(() => {
        if (!cancelled) setState((current) => ({ ...current, loading: false, failed: true }))
      })
    return () => {
      cancelled = true
      // A superseded request is aborted, so a slow first answer cannot land
      // on top of a faster second one.
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadValues is read from
    // loadValuesRef.current on purpose (see the JSDoc above); naming it here would
    // reintroduce the refetch-on-every-host-render bug this ref exists to fix.
  }, [enabled, columnId, search, attempt])

  return { ...state, retry }
}
