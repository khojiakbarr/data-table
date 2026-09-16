import { useCallback, useRef, useState } from "react"
import type { Updater } from "@tanstack/react-table"
import { pruneFilters, type FilterKind } from "./filters"
import { pruneLayout } from "./persistence"
import { useDebouncedSave } from "./useDebouncedSave"
import type { LayoutStorage, TableLayout } from "../types"

/** A layout with nothing arranged: every slice at TanStack's "natural" value. */
export const EMPTY_LAYOUT: TableLayout = {
  columnOrder: [],
  columnVisibility: {},
  columnPinning: { start: [], end: [] },
  columnSizing: {},
  sorting: [],
  filters: [],
  // Also what an absent global filter means to TanStack, so the off state is
  // unambiguous.
  search: "",
}

/**
 * The slices that hold filter state rather than column arrangement.
 *
 * They live in the layout so they persist and reset with it, but they are not
 * an *arrangement*: a search term must not light up the Columns tab's Reset
 * link, and with `filtering.persist: false` they must never reach storage.
 */
const FILTER_SLICES = new Set<keyof TableLayout>(["filters", "search"])

/** The layout plus what the table knows about where it came from. */
interface Arrangement {
  layout: TableLayout
  /** Differs from the declared layout, so a Reset control makes sense. */
  isCustomised: boolean
  /**
   * Changed by the user since mount, so worth writing. Distinct from
   * `isCustomised`: a layout read from storage is customised but has nothing
   * new to save, and re-saving it on mount is a pointless write — or a network
   * request, for a server-backed adapter.
   */
  hasUnsavedChanges: boolean
}

/** What {@link useArrangement} needs to load, prune and persist a layout. */
export interface UseArrangementOptions {
  id: string
  store: LayoutStorage
  initialLayout: Partial<TableLayout> | undefined
  /** Leaf column ids, so a stored layout can be pruned to live columns. */
  columnIds: readonly string[]
  /** Each column's resolved filter kind, so a stored condition can be checked against it. */
  filterKinds?: ReadonlyMap<string, FilterKind | false> | undefined
  /** Keep `filters` and `search` out of storage. Default true. */
  persistFilters?: boolean
}

/** TanStack state setters accept a value or an updater function. */
export function apply<T>(updater: T | ((old: T) => T), current: T): T {
  return typeof updater === "function" ? (updater as (old: T) => T)(current) : updater
}

/**
 * The persisted part of a table's state: what the user has arranged.
 *
 * Read from storage once per table id, written back debounced, and reset on
 * request. Every change goes through {@link UseArrangementResult.updateSlice},
 * which drops changes that leave a slice as it was, so a no-op does not mark
 * the table as customised or trigger a write.
 */
export function useArrangement({
  id,
  store,
  initialLayout,
  columnIds,
  filterKinds,
  persistFilters = true,
}: UseArrangementOptions) {
  // Read storage once per table id. Re-reading on every render would fight the
  // user: a change is saved, then immediately re-applied from disk.
  //
  // `columnOrder` starts empty rather than pre-seeded. TanStack reads it as
  // "natural order" when empty, and seeding it is how grouped tables break:
  // the ordering feature matches leaf ids, so a seeded list containing group
  // ids silently reorders every column that is not in it.
  const [arrangement, setArrangement] = useState<Arrangement>(() => {
    const stored = store.load(id)
    // `initialLayout` is a hand-written literal — a host's own default, or a
    // URL a caller pre-parsed — so it gets the same treatment a stored layout
    // does: `filters` is pruned and rebuilt in canonical key order (or an
    // unknown-column condition would reach the wire forever, and a
    // differently-ordered one would give `instance.query` a fresh identity on
    // the user's first click), and a non-string `search` cannot reach
    // `.trim()` in `filtering.isFiltered`.
    const seeded = { ...EMPTY_LAYOUT, ...initialLayout }
    seeded.filters = pruneFilters(seeded.filters, columnIds, filterKinds)
    if (typeof seeded.search !== "string") seeded.search = ""
    const storedOrEmpty = stored ?? {}
    const layout = { ...seeded, ...pruneLayout(storedOrEmpty, columnIds, filterKinds) }
    /*
     * The "nothing arranged" baseline to compare each slice against — not
     * `seeded` itself, because `pruneLayout` does more than filter to known
     * ids: an untouched `columnOrder: []` round-trips through storage as the
     * *explicit* natural order (every known id, in declaration order), since
     * a save persists the whole layout object, not only the slice that
     * changed. Comparing `layout.columnOrder` to bare `seeded.columnOrder`
     * would then read a search-only save as customised on the very next load
     * — the same bug this is fixing, one key over.
     *
     * So a slice is compared against its *own* natural value pushed through
     * that same normalisation, and only when storage actually held that key —
     * otherwise `layout` left it at `seeded`'s raw value too, and the two
     * would only coincidentally differ.
     */
    const naturalStored: Partial<TableLayout> = {}
    if ("columnOrder" in storedOrEmpty) naturalStored.columnOrder = seeded.columnOrder
    if ("columnVisibility" in storedOrEmpty) naturalStored.columnVisibility = seeded.columnVisibility
    if ("columnPinning" in storedOrEmpty) naturalStored.columnPinning = seeded.columnPinning
    if ("columnSizing" in storedOrEmpty) naturalStored.columnSizing = seeded.columnSizing
    if ("sorting" in storedOrEmpty) naturalStored.sorting = seeded.sorting
    const naturalLayout = { ...seeded, ...pruneLayout(naturalStored, columnIds, filterKinds) }
    return {
      layout,
      // A saved search or filter must not make the Columns tab offer a Reset
      // on the next visit either — only the arrangement slices count.
      isCustomised: (Object.keys(EMPTY_LAYOUT) as (keyof TableLayout)[]).some(
        (key) => !FILTER_SLICES.has(key) && !layoutSliceEqual(layout[key], naturalLayout[key]),
      ),
      hasUnsavedChanges: false,
    }
  })
  const initialRef = useRef(initialLayout)

  // Read through a ref so `updateSlice` below stays stable across renders.
  const persistFiltersRef = useRef(persistFilters)
  persistFiltersRef.current = persistFilters

  /*
   * What actually reaches storage.
   *
   * With `persist: false` the filter slices are blanked here, at the write
   * boundary, rather than narrowed out of the object that also feeds
   * `useTable`: `pruneLayout` runs only on load, and `LayoutStorage.save` is
   * typed to take a complete layout.
   *
   * Held in a ref and compared structurally, the way `useTableQuery` holds its
   * query: `useDebouncedSave` keys its timer on this object's identity, so a
   * fresh-but-equal one per keystroke would re-arm the 350 ms save with
   * identical content — one storage write, or one network request, per pause.
   */
  const candidate = persistFilters
    ? arrangement.layout
    : { ...arrangement.layout, filters: EMPTY_LAYOUT.filters, search: EMPTY_LAYOUT.search }
  const persistedRef = useRef<TableLayout | null>(null)
  if (persistedRef.current === null || !layoutSliceEqual(persistedRef.current, candidate)) {
    persistedRef.current = candidate
  }

  useDebouncedSave(store, id, persistedRef.current, arrangement.hasUnsavedChanges)

  /**
   * Record a change to one slice of the layout.
   *
   * A change that leaves the slice as it was is dropped: TanStack commits a
   * width on every mouseup, so a press-and-release on a resize handle would
   * otherwise mark the table as customised and write an identical layout.
   */
  const updateSlice = useCallback(
    <TKey extends keyof TableLayout>(
      key: TKey,
      updater: Updater<TableLayout[TKey]>,
      normalise: (slice: TableLayout[TKey]) => TableLayout[TKey] = (slice) => slice,
    ) => {
      setArrangement((previous) => {
        const next = normalise(apply(updater, previous.layout[key]))
        if (layoutSliceEqual(next, previous.layout[key])) return previous
        const isFilterSlice = FILTER_SLICES.has(key)
        return {
          layout: { ...previous.layout, [key]: next },
          // A search does not make a Reset link appear in the Columns tab for
          // a reason that has nothing to do with columns.
          isCustomised: previous.isCustomised || !isFilterSlice,
          hasUnsavedChanges:
            previous.hasUnsavedChanges || !isFilterSlice || persistFiltersRef.current,
        }
      })
    },
    [],
  )

  const resetLayout = useCallback(() => {
    store.clear(id)
    // Same normalisation as the mount initialiser above, and for the same
    // reason: `initialRef.current` is the same untrusted hand-written literal,
    // and without it a reset would re-introduce whatever unvalidated
    // conditions the mount-time prune above was written to keep out.
    const seeded = { ...EMPTY_LAYOUT, ...initialRef.current }
    seeded.filters = pruneFilters(seeded.filters, columnIds, filterKinds)
    if (typeof seeded.search !== "string") seeded.search = ""
    setArrangement({
      layout: seeded,
      isCustomised: false,
      hasUnsavedChanges: false,
    })
  }, [store, id, columnIds, filterKinds])

  return { layout: arrangement.layout, isCustomised: arrangement.isCustomised, updateSlice, resetLayout }
}

/** What {@link useArrangement} returns: the layout, its provenance flag, and the two ways to change it. */
export type UseArrangementResult = ReturnType<typeof useArrangement>

/**
 * Structural equality for a layout slice.
 *
 * Slices are JSON-shaped — arrays of ids, maps of primitives, `{ id, desc }`
 * pairs — so a plain recursive comparison is exact, and it is what tells a
 * genuine change from TanStack rebuilding an identical array.
 */
export function layoutSliceEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => layoutSliceEqual(item, b[index]))
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && layoutSliceEqual(a[key], b[key]))
    )
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
