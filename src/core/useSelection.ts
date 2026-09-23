import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { TableQuery } from "./query"
import {
  ALL_MATCHING_SELECTION,
  EMPTY_SELECTION,
  isRowSelected,
  isSelectionEmpty,
  pageHeaderState,
  selectionCount,
  selectionScopeOf,
  withPageRows,
  withRow,
  type SelectionHeaderScope,
  type SelectionModel,
} from "./selection"
import { warnOnce } from "./warnOnce"

/**
 * "This table's header checkbox reaches no page", at module scope.
 *
 * One frozen array rather than a fresh literal per render: a table in the
 * default header scope never looks at a page, and a new-but-empty array would
 * rebuild memos that have no reason to move.
 */
const NO_PAGE_ROWS: readonly string[] = Object.freeze([])

/**
 * What a host is told when the selection changes.
 *
 * The model, the query it is relative to, and how many rows that is. The
 * query is **not optional**: `{ mode: "all-matching", excluded: [] }` on its
 * own does not name a single row, and a host handed it without the filters it
 * was drawn against has nothing to translate into a `WHERE` clause.
 */
export interface SelectionChange {
  mode: "ids" | "all-matching"
  /** Present in `ids` mode: the rows the user picked. */
  ids?: readonly string[]
  /** Present in `all-matching` mode: the rows the user took back out. */
  excluded?: readonly string[]
  /** The query the selection is relative to. Meaningless without it. */
  query: TableQuery
  /** Undefined until a server has answered with a `rowCount`. */
  count: number | undefined
}

/**
 * A {@link SelectionChange} with the way out attached.
 *
 * What `renderSelectionActions` is handed. `clear` rides along so a host's own
 * "Cancel" does not have to reach back into the instance — the bar is usually
 * a leaf component that was given this object and nothing else.
 */
export interface SelectionSummary extends SelectionChange {
  /** Put the selection back to nothing. */
  clear: () => void
}

/** Everything a shell needs to render and edit the selection. */
export interface SelectionApi {
  /** Whether this table selects rows at all — the `selection` feature flag. */
  enabled: boolean
  /**
   * What the header checkbox reaches. `"all-matching"` unless the host asked
   * for `features.selection: { scope: "page" }`. It is what names that
   * checkbox — the two scopes do different things and must not say the same
   * sentence — and NOT the query scope a selection is cleared by.
   */
  headerScope: SelectionHeaderScope
  /** The selection itself. Always `EMPTY_SELECTION` while `enabled` is false. */
  model: SelectionModel
  /** How many rows are selected; undefined while `all-matching` has no count yet. */
  count: number | undefined
  /**
   * How many rows the query matches — what the header checkbox would take.
   *
   * Undefined until a server has answered. It is what names that checkbox,
   * and it is a different number from {@link SelectionApi.count}: one is what
   * a tick would select, the other what is selected now.
   */
  rowsMatching: number | undefined
  /** Nothing ticked, and nobody having said "all". */
  isEmpty: boolean
  /** Whether one row's checkbox is ticked. */
  isRowSelected: (rowId: string) => boolean
  /** Tick or untick one row. */
  toggleRow: (rowId: string, selected: boolean) => void
  /**
   * The header checkbox. In the default header scope `true` takes everything
   * the query matches; in `"page"` scope it takes the selectable rows of the
   * current page and adds them to whatever was already selected.
   */
  toggleAll: (selected: boolean) => void
  clear: () => void
  /**
   * The header checkbox is ticked: everything with nothing taken back out, or
   * — in `"page"` header scope — every selectable row of the current page.
   */
  headerChecked: boolean
  /**
   * Some of what the header checkbox reaches is selected, but not all of it.
   * In `"page"` scope that question is asked about THIS page alone.
   */
  headerIndeterminate: boolean
  /** The selection as a host reads it, with `clear` attached. */
  summary: SelectionSummary
}

/** Inputs to {@link useSelection}. */
export interface UseSelectionOptions {
  /** The table's id, for the dev warning. */
  id: string
  /** The `selection` feature flag. */
  enabled: boolean
  /**
   * The query the selection is relative to. Its identity is what the
   * query-change reset watches, so it must be the stable object
   * `useTableQuery` hands out rather than a fresh one per render.
   */
  query: TableQuery
  /**
   * Rows the query matches, across every page, or undefined while a server
   * has not answered. The `all-matching` count is derived from it.
   */
  rowCount: number | undefined
  /** Whether the host supplied `getRowId`; see the warning below. */
  hasRowId: boolean
  /**
   * What the header checkbox reaches — NOT the query scope of
   * `selectionScopeOf`. Omitted, it is `"all-matching"`: the behaviour this
   * library shipped with. See {@link SelectionHeaderScope}.
   */
  headerScope?: SelectionHeaderScope | undefined
  /**
   * The ids of the SELECTABLE rows on the current page, in page order — group
   * headers left out, because a group stands for children the browser does not
   * hold. Read only in `"page"` header scope, where it is what the header
   * checkbox ticks and what its three states are read over.
   */
  pageRowIds?: readonly string[] | undefined
  onSelectionChange?: ((selection: SelectionChange) => void) | undefined
}

/**
 * The selection: which rows are picked, and everything that follows from a
 * change to the query.
 *
 * Two things live here rather than in the components that draw checkboxes.
 *
 * **The query-change reset.** A change to the filters, the search or the
 * grouping clears the selection, and it is derived from the QUERY rather than
 * called from each mutator. The mutators were the obvious home — `updateFilters`,
 * `updateSearch` and `updateGrouping` in `useDataTable` each already reset the
 * page, and the reset belongs beside that one — but there are more ways to
 * change a query than there are mutators: `resetLayout` replaces every slice
 * at once, `filtering.setModel` restores a whole model from a URL, and a
 * stored layout arrives before any mutator has run. Every one of those routes
 * ends in a new `query` object, so watching the query catches them all and
 * cannot be forgotten by the next feature that changes one. The debounce is a
 * bonus rather than a cost: a keystroke does not clear the selection, the
 * query the keystroke eventually produces does, which is the exact moment
 * "everything matching" starts meaning something else.
 *
 * It is a render-phase adjustment and not an effect. An effect would leave one
 * commit in which the table renders a stale selection against the new query —
 * the window in which a bulk action could be fired at the wrong rows — and
 * React's own guidance for "reset state when a prop changes" is this pattern:
 * set during render, and the component re-renders before anything is painted
 * or any effect runs.
 *
 * **The header scope.** `headerScope` decides what the header checkbox
 * reaches, and nothing else — it is not the query scope of
 * `selectionScopeOf`, which decides when a selection is cleared and is
 * unchanged by it. `"page"` makes `all-matching` unreachable: `toggleAll`
 * answers in ids, and a model that arrived in that mode from outside is read
 * as nothing rather than honoured.
 *
 * **The publish.** `onSelectionChange` fires whenever any part of what a host
 * receives changes — the model, the query it is relative to, or the count —
 * and never on mount, where there is nothing to report and `onQueryChange` has
 * already announced the query. The cleared selection therefore reaches the
 * host as a real announcement rather than only as an empty checkbox: a model
 * only the table knows it has dropped is the failure the reset exists to
 * prevent, arriving one layer up.
 *
 * @param options - See {@link UseSelectionOptions}.
 * @returns Everything a shell needs to render and edit the selection.
 *
 * @example
 * const selection = useSelection({ id, enabled: flags.selection, query, rowCount, hasRowId: getRowId !== undefined })
 */
export function useSelection({
  id,
  enabled,
  query,
  rowCount,
  hasRowId,
  headerScope = "all-matching",
  pageRowIds = NO_PAGE_ROWS,
  onSelectionChange,
}: UseSelectionOptions): SelectionApi {
  const [model, setModel] = useState<SelectionModel>(EMPTY_SELECTION)

  /*
   * The scope this selection was made in. Memoised on the query's identity —
   * which `useTableQuery` changes exactly when the request would — so the
   * stringify runs once per real query change rather than once per render.
   */
  const scope = useMemo(() => selectionScopeOf(query), [query])
  const scopeRef = useRef(scope)
  if (scopeRef.current !== scope) {
    scopeRef.current = scope
    // Guarded, so a table nobody has selected anything in does not re-render
    // on every filter change for a state that is already empty.
    if (!isSelectionEmpty(model)) setModel(EMPTY_SELECTION)
  }

  /*
   * The page's ids, held by VALUE rather than by identity.
   *
   * The array arrives rebuilt on renders where the page did not change — a
   * row model recomputed, a host re-rendering — and it feeds the memo every
   * reader of this hook is handed. Keying the memos on the contents instead
   * means a table whose page has not moved hands back the same object, and a
   * table in the default header scope is given the module-level empty array
   * and so never keys on anything at all.
   */
  const pageKey = pageRowIds.join("\u001f")
  const pageKeyRef = useRef(pageKey)
  const pageIdsRef = useRef(pageRowIds)
  if (pageKeyRef.current !== pageKey) {
    pageKeyRef.current = pageKey
    pageIdsRef.current = pageRowIds
  }
  const pageIds = pageIdsRef.current

  /*
   * An `all-matching` model while the header checkbox only reaches a page.
   *
   * No control and no action in this header scope produces one — `toggleAll`
   * answers in ids — so it can only have been put here from outside: a host
   * flipping `scope` to "page" while an all-matching selection was live, or a
   * model restored from somewhere. Honouring it would show "all 5 000 rows
   * selected" to a user whose host can only act on ids, which is the exact
   * promise this header scope exists to stop the table making. So it is
   * treated as no selection, said out loud in development, and cleared from
   * state as a render-phase adjustment for the same reason the query-change
   * reset is one: an effect would leave a commit in which a bulk action could
   * fire against it.
   */
  const strayAllMatching = enabled && headerScope === "page" && model.mode === "all-matching"
  if (strayAllMatching) {
    setModel(EMPTY_SELECTION)
    if (process.env.NODE_ENV !== "production") {
      warnOnce(
        `useDataTable("${id}"): features.selection scope "page" was given an ` +
          `all-matching selection, which no header tick in this scope can produce — it would ` +
          `promise the user every matching row while the host can only act on the ids it holds, ` +
          `so it is being read as no selection.`,
      )
    }
  }

  /*
   * A selection switched off has none, whatever was ticked before the flag
   * moved. Read here rather than guarded at each mutator: this is the one
   * place every reader goes through, so there is no path that renders a
   * checkbox for a table that does not select.
   */
  const current = enabled && !strayAllMatching ? model : EMPTY_SELECTION

  const clear = useCallback(() => setModel(EMPTY_SELECTION), [])
  const toggleRow = useCallback(
    (rowId: string, selected: boolean) => setModel((prev) => withRow(prev, rowId, selected)),
    [],
  )
  const toggleAll = useCallback(
    (selected: boolean) =>
      setModel((prev) =>
        headerScope === "page"
          ? withPageRows(prev, pageIds, selected)
          : selected
            ? ALL_MATCHING_SELECTION
            : EMPTY_SELECTION,
      ),
    // `pageKey` and not `pageIds`: the contents are what this closure needs to
    // be rebuilt for, and the identity alone changes on renders that moved no
    // row. In the default header scope both are constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pageKey stands for pageIds
    [headerScope, pageKey],
  )

  const count = selectionCount(current, rowCount)

  const change = useMemo<SelectionChange>(
    () =>
      current.mode === "ids"
        ? { mode: "ids", ids: current.ids, query, count }
        : { mode: "all-matching", excluded: current.excluded, query, count },
    [current, query, count],
  )

  const summary = useMemo<SelectionSummary>(() => ({ ...change, clear }), [change, clear])

  /*
   * Held in a ref and refreshed on every commit, the way `useTableQuery` holds
   * its own callback: an inline arrow at the call site — which is the natural
   * way to write one — would otherwise re-announce the selection on every
   * render of the host.
   */
  const onSelectionChangeRef = useRef(onSelectionChange)
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  })

  const announcedRef = useRef(false)
  useEffect(() => {
    if (!enabled) return
    // Nothing is selected on mount and the query has just been announced by
    // `onQueryChange`; an opening report of "nothing, relative to this" is
    // noise a host would have to filter out.
    if (!announcedRef.current) {
      announcedRef.current = true
      return
    }
    onSelectionChangeRef.current?.(change)
  }, [enabled, change])

  /*
   * `getRowId` matters more here than anywhere else in the library.
   *
   * Without it TanStack keys a row by its POSITION, and a selection keyed by
   * position follows the slot rather than the record: sort the table — which
   * deliberately does not clear the selection, because sorting changes no row's
   * membership — and the ticks stay on rows three to seven while three to seven
   * are now different records. Nothing on screen says so, and the bulk action
   * runs on whatever ended up there. Both modes are affected, so unlike the
   * server-mode warning below this one does not ask what mode the table is in.
   *
   * `process.env.NODE_ENV` and not `import.meta.env.DEV`, bare and unguarded,
   * for the reasons the warnings in `useDataTable` spell out.
   */
  if (process.env.NODE_ENV !== "production" && enabled && !hasRowId) {
    warnOnce(
      `useDataTable("${id}"): features.selection without getRowId keys rows by position, ` +
        `so a selection follows the row's slot rather than the record — sorting or refetching ` +
        `moves the ticks onto different rows, and a bulk action then runs on those.`,
    )
  }

  /*
   * Memoised like `filteringApi` and `groupingApi` beside it: this object is
   * read by `<TableBody>` and by every `HeaderCell`, and a fresh one per
   * render would defeat any memo a shell of its own put in front of them.
   */
  return useMemo<SelectionApi>(() => {
    const empty = isSelectionEmpty(current)
    /*
     * The header checkbox's state, which is a different question in each
     * header scope. Reaching every matching row, it is ticked only for
     * everything with nothing taken back out. Reaching a page, it is ticked
     * when every selectable row of THIS page is selected — see
     * `pageHeaderState`, which is also why a user holding page 1's ids sees an
     * unchecked box on page 2 rather than an indeterminate one.
     */
    const page = headerScope === "page" ? pageHeaderState(current, pageIds) : null
    const headerChecked =
      page !== null ? page.checked : current.mode === "all-matching" && current.excluded.length === 0
    return {
      enabled,
      headerScope,
      model: current,
      count,
      rowsMatching: rowCount,
      isEmpty: empty,
      isRowSelected: (rowId: string) => isRowSelected(current, rowId),
      toggleRow,
      toggleAll,
      clear,
      headerChecked,
      /*
       * Something, but not everything — which covers BOTH halves of it: rows
       * ticked one at a time, and "everything except these". The second is the
       * one a mode-blind check misses, and it is the state a user is in right
       * after unticking one row of an all-matching selection.
       */
      headerIndeterminate: page !== null ? page.indeterminate : !empty && !headerChecked,
      summary,
    }
    // `pageKey` stands for `pageIds` here for the reason `toggleAll` gives.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pageKey stands for pageIds
  }, [enabled, current, count, rowCount, toggleRow, toggleAll, clear, summary, headerScope, pageKey])
}
