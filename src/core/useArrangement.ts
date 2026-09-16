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

/** A layout slice that holds filter state rather than column arrangement. */
type FilterSlice = "filters" | "search"

/** Every other layout slice: the arrangement proper. */
type ArrangementSlice = Exclude<keyof TableLayout, FilterSlice>

/**
 * The slices that hold filter state rather than column arrangement.
 *
 * They live in the layout so they persist and reset with it, but they are not
 * an *arrangement*: a search term must not light up the Columns tab's Reset
 * link, and with `filtering.persist: false` they must never reach storage.
 */
const FILTER_SLICES = new Set<keyof TableLayout>(["filters", "search"] satisfies FilterSlice[])

/**
 * Every other slice: what the table means by an *arrangement*.
 *
 * Written out as an object literal, because `satisfies Record<…>` is what
 * makes an omission a compile error — and an omission is exactly what went
 * wrong when this list was `Object.keys(EMPTY_LAYOUT)`: `pageSize` is optional
 * and so absent there, yet it is persisted, pruned and reset like any other
 * arrangement. A layout whose only change was rows-per-page came back from
 * storage reading as *not* customised, and the Columns tab's Reset link
 * disappeared on reload for a layout `resetLayout` would still have changed.
 *
 * `Object.keys` then flattens it to the list the loops want; its return is
 * typed `string[]` however narrow its argument, so the key type is restated.
 */
const ARRANGEMENT_SLICES = Object.keys({
  columnOrder: true,
  columnVisibility: true,
  columnPinning: true,
  columnSizing: true,
  sorting: true,
  pageSize: true,
} satisfies Record<ArrangementSlice, true>) as ArrangementSlice[]

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
  /**
   * Whether the filtering feature exists for this table at all.
   *
   * `false` keeps the filter slices empty on load — `initialLayout`'s and
   * storage's alike — so a table with no filter surfaces cannot publish a
   * condition nothing is able to clear. Mutation is gated at its own choke
   * point (`updateFilters` / `updateSearch` in `useDataTable`), which is the
   * only other way filter state reaches the layout. Default true.
   */
  filteringEnabled?: boolean
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
  filteringEnabled = true,
  persistFilters = true,
}: UseArrangementOptions) {
  /*
   * Whether any filter state may survive a visit. With the feature off there
   * is none to keep, whatever `persistFilters` says — and reading the two
   * flags separately is how `filtering: false` used to restore stored filters
   * it had just refused to seed.
   */
  const keepFilters = filteringEnabled && persistFilters

  // Read storage once per table id. Re-reading on every render would fight the
  // user: a change is saved, then immediately re-applied from disk.
  //
  // `columnOrder` starts empty rather than pre-seeded. TanStack reads it as
  // "natural order" when empty, and seeding it is how grouped tables break:
  // the ordering feature matches leaf ids, so a seeded list containing group
  // ids silently reorders every column that is not in it.
  const [arrangement, setArrangement] = useState<Arrangement>(() => {
    const stored = store.load(id)
    const seeded = seedLayout(initialLayout, columnIds, filterKinds, filteringEnabled)
    const storedOrEmpty = stored ?? {}
    const storedPruned = pruneLayout(storedOrEmpty, columnIds, filterKinds)
    if (!keepFilters) {
      /*
       * The read half of the opt-out. Enforcing it on the write side alone
       * left a table that already had filter state in storage restoring it on
       * every mount and never able to shed it: nothing rewrites that entry
       * unless a *column* also changes, so `persist: false` added in a later
       * release — or wired to a user preference — did nothing at all for every
       * returning user.
       */
      delete storedPruned.filters
      delete storedPruned.search
    }
    const layout = { ...seeded, ...storedPruned }
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
    for (const key of ARRANGEMENT_SLICES) {
      if (key in storedOrEmpty) copySlice(naturalStored, seeded, key)
    }
    const naturalLayout = { ...seeded, ...pruneLayout(naturalStored, columnIds, filterKinds) }
    return {
      layout,
      // A saved search or filter must not make the Columns tab offer a Reset
      // on the next visit either — only the arrangement slices count, which
      // is what `ARRANGEMENT_SLICES` is.
      isCustomised: ARRANGEMENT_SLICES.some(
        (key) => !layoutSliceEqual(layout[key], naturalLayout[key]),
      ),
      hasUnsavedChanges: false,
    }
  })
  const initialRef = useRef(initialLayout)

  // Read through a ref so `updateSlice` below stays stable across renders.
  const keepFiltersRef = useRef(keepFilters)
  keepFiltersRef.current = keepFilters

  /*
   * What actually reaches storage.
   *
   * When the filter slices are opted out — `persist: false`, or `filtering:
   * false`, which implies it — they are blanked here, at the write boundary,
   * rather than narrowed out of the object that also feeds `useTable`:
   * `pruneLayout` runs only on load, and `LayoutStorage.save` is typed to take
   * a complete layout.
   *
   * Held in a ref and compared structurally, the way `useTableQuery` holds its
   * query: `useDebouncedSave` keys its timer on this object's identity, so a
   * fresh-but-equal one per keystroke would re-arm the 350 ms save with
   * identical content — one storage write, or one network request, per pause.
   */
  const candidate = keepFilters
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
            previous.hasUnsavedChanges || !isFilterSlice || keepFiltersRef.current,
        }
      })
    },
    [],
  )

  const resetLayout = useCallback(() => {
    store.clear(id)
    setArrangement({
      layout: seedLayout(initialRef.current, columnIds, filterKinds, filteringEnabled),
      isCustomised: false,
      hasUnsavedChanges: false,
    })
  }, [store, id, columnIds, filterKinds, filteringEnabled])

  return { layout: arrangement.layout, isCustomised: arrangement.isCustomised, updateSlice, resetLayout }
}

/** What {@link useArrangement} returns: the layout, its provenance flag, and the two ways to change it. */
export type UseArrangementResult = ReturnType<typeof useArrangement>

/**
 * The declared starting layout, normalised.
 *
 * `initialLayout` is a hand-written literal — a host's own default, or a URL a
 * caller pre-parsed — so it gets the same treatment a stored layout does:
 * `filters` is pruned and rebuilt in canonical key order (or an unknown-column
 * condition would reach the wire forever, and a differently-ordered one would
 * give `instance.query` a fresh identity on the user's first click), and a
 * non-string `search` cannot reach `.trim()` in `filtering.isFiltered`. With
 * filtering off both slices are blanked outright: a condition declared there
 * would otherwise be published by a table that has no surface able to clear it.
 *
 * Shared by the mount initialiser and `resetLayout`, which restore the same
 * literal and so must reject exactly the same conditions.
 *
 * @param initialLayout - The caller's declared layout, or undefined.
 * @param columnIds - Leaf column ids a condition may name.
 * @param filterKinds - Each column's resolved filter kind, when known.
 * @param filteringEnabled - Whether filter state is allowed at all.
 * @returns A complete layout, safe to publish.
 */
function seedLayout(
  initialLayout: Partial<TableLayout> | undefined,
  columnIds: readonly string[],
  filterKinds: ReadonlyMap<string, FilterKind | false> | undefined,
  filteringEnabled: boolean,
): TableLayout {
  const seeded = { ...EMPTY_LAYOUT, ...initialLayout }
  seeded.filters = filteringEnabled ? pruneFilters(seeded.filters, columnIds, filterKinds) : []
  if (!filteringEnabled || typeof seeded.search !== "string") seeded.search = ""
  return seeded
}

/**
 * Copy one slice across, keeping the key's own type.
 *
 * A loop over a union of keys cannot write `target[key] = source[key]`
 * directly — the write slot narrows to `never` — while one generic key at a
 * time is exact.
 *
 * @param target - Layout being built.
 * @param source - Layout to read the slice from.
 * @param key - Which slice.
 */
function copySlice<TKey extends keyof TableLayout>(
  target: Partial<TableLayout>,
  source: TableLayout,
  key: TKey,
): void {
  target[key] = source[key]
}

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
