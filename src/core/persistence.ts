import { pruneFilters, type FilterKind } from "./filters"
import { pruneExpanded, pruneGrouping } from "./grouping"
import type { LayoutStorage, TableLayout } from "../types"

/**
 * Persisting a table's layout.
 *
 * Every entry is keyed by the table's `id`. That is the whole reason `id` is a
 * required option: two tables rendered on one page have independent layouts,
 * and a shared storage key would let one silently overwrite the other's columns
 * the moment either is rearranged.
 */

const KEY_PREFIX = "data-table:layout:"

/** Layouts written by an older version of the library are discarded, not guessed at. */
const FORMAT_VERSION = 1

interface StoredLayout {
  v: number
  layout: Partial<TableLayout>
}

/**
 * Keep layouts in `localStorage`, scoped to the browser.
 *
 * Every access is guarded: private windows, disabled site data and full quotas
 * all throw, and a table that cannot remember its columns should still render.
 *
 * @param prefix - Key prefix, useful when several apps share an origin.
 * @returns A storage adapter for {@link useDataTable}.
 *
 * @example
 * useDataTable({ id: "receipts", storage: localStorageLayout(), ... })
 */
export function localStorageLayout(prefix = KEY_PREFIX): LayoutStorage {
  return {
    load(id) {
      try {
        const raw = localStorage.getItem(prefix + id)
        if (!raw) return null
        const parsed = JSON.parse(raw) as StoredLayout
        if (parsed.v !== FORMAT_VERSION) return null
        return parsed.layout
      } catch {
        return null
      }
    },
    save(id, layout) {
      try {
        const payload: StoredLayout = { v: FORMAT_VERSION, layout }
        localStorage.setItem(prefix + id, JSON.stringify(payload))
      } catch {
        // Quota or a blocked store. The layout still applies for this session.
      }
    },
    clear(id) {
      try {
        localStorage.removeItem(prefix + id)
      } catch {
        // Nothing to do — the entry is unreachable either way.
      }
    },
  }
}

/**
 * Discard layout changes when the table unmounts.
 *
 * The default, because silently remembering state a developer did not ask for
 * is surprising — and because a server-backed adapter is usually what a
 * multi-user application actually wants.
 *
 * @returns A storage adapter that stores nothing.
 */
export function noLayoutStorage(): LayoutStorage {
  return {
    load: () => null,
    save: () => undefined,
    clear: () => undefined,
  }
}

/**
 * Drop stored columns that the table no longer defines.
 *
 * Without this, removing a column from the code leaves it in every user's saved
 * layout forever, and a renamed column resurfaces as a phantom entry in the
 * column list.
 *
 * @param stored - Layout as it came out of storage.
 * @param knownColumnIds - Column IDs the table currently defines.
 * @param filterKinds - Each column's resolved filter kind; `false` where
 *   filtering is off for it. Optional because `pruneLayout` is a public export —
 *   omitted, a stored condition is still checked for an unknown column, an
 *   unknown kind and a shape its operator does not carry, but not against the
 *   column's current kind. {@link useDataTable} always passes it.
 * @returns The layout with unknown column references removed.
 */
export function pruneLayout(
  stored: Partial<TableLayout>,
  knownColumnIds: readonly string[],
  filterKinds?: ReadonlyMap<string, FilterKind | false> | undefined,
): Partial<TableLayout> {
  const known = new Set(knownColumnIds)
  const keepKeys = <TValue,>(
    record: Record<string, TValue> | undefined,
  ): Record<string, TValue> | undefined =>
    record
      ? Object.fromEntries(Object.entries(record).filter(([id]) => known.has(id)))
      : undefined

  const pruned: Partial<TableLayout> = {}

  // `stored` is untrusted JSON — a hand-edited `localStorage` entry or a server
  // response — so every array-shaped slice below is checked with `Array.isArray`
  // before `.filter` runs on it; a non-array throws `TypeError: ... is not a
  // function` (or "not iterable") from inside `useArrangement`'s `useState`
  // initialiser, which is an unrecoverable render crash: the bad entry is never
  // cleared, so it repeats on every subsequent mount.
  if (Array.isArray(stored.columnOrder)) {
    // Keep the stored order, then append columns added since it was saved.
    const ordered = stored.columnOrder.filter((id) => known.has(id))
    const missing = knownColumnIds.filter((id) => !ordered.includes(id))
    pruned.columnOrder = [...ordered, ...missing]
  }
  const visibility = keepKeys(stored.columnVisibility)
  if (visibility) pruned.columnVisibility = hiddenColumnsOnly(visibility)

  // A width that is not a finite positive number ends up as `width: NaN` on a
  // <col> and on the table itself; better to fall back to the declared size.
  const sizing = keepKeys(stored.columnSizing)
  if (sizing) {
    pruned.columnSizing = Object.fromEntries(
      Object.entries(sizing).filter(([, width]) => Number.isFinite(width) && width > 0),
    )
  }

  if (stored.columnPinning) {
    // `start`/`end` are read defensively too: a malformed entry like
    // `{ start: "oops" }` would otherwise reach `.filter` on a string.
    const start = stored.columnPinning.start
    const end = stored.columnPinning.end
    pruned.columnPinning = {
      start: (Array.isArray(start) ? start : []).filter((id) => known.has(id)),
      end: (Array.isArray(end) ? end : []).filter((id) => known.has(id)),
    }
  }
  if (Array.isArray(stored.sorting)) {
    // An element can be malformed as well as the container, and `sorting` is
    // the one slice whose elements are dereferenced (`entry.id`) rather than
    // only handed to `Set.has` — which quietly rejects a string or a number
    // but throws on null. `JSON.stringify([undefined])` is `"[null]"`, so
    // `[null]` is what a storage adapter actually puts on the wire.
    pruned.sorting = stored.sorting.filter(
      (entry) => typeof entry === "object" && entry !== null && known.has(entry.id),
    )
  }

  /*
   * Grouping, and the open branches of it.
   *
   * `pruneGrouping` drops a group on a column the table no longer defines —
   * the same rule one slice over, and for the same reason: nothing on screen
   * could take it off, and the query would go on asking a server to group by a
   * column this table has no chip for.
   *
   * When that prune actually changes the grouping, the open paths are dropped
   * WHOLESALE rather than trimmed. A path's keys are positional — index 0 is
   * the outermost level's key — so removing a level silently re-reads every
   * saved key as belonging to the level above it: a path saved as
   * `["received", "Acme"]` under `["status", "partner"]` would come back
   * meaning "the status group Acme" once `status` is gone. Reopening nothing
   * is the honest outcome; reopening the wrong branches is not.
   *
   * Both are ADDITIVE keys: `FORMAT_VERSION` deliberately does not move for
   * them, because a bump discards every stored layout — every user's column
   * widths, order and pinning — to gain slices they have never set.
   */
  if (Array.isArray(stored.grouping)) {
    const grouping = pruneGrouping(stored.grouping, knownColumnIds)
    pruned.grouping = grouping
    const kept = grouping.length === stored.grouping.length
    pruned.expanded = kept ? pruneExpanded(stored.expanded, grouping.length) : []
  }

  // Without this a deleted column's filter stays active forever with no UI able
  // to reach it: 40 rows out of 10 000 and no way to find out why.
  // `pruneFilters` itself re-checks `Array.isArray` — `stored.filters` is
  // untrusted JSON too — so the truthy check here is only an optimisation.
  if (stored.filters) {
    pruned.filters = pruneFilters(stored.filters, knownColumnIds, filterKinds)
  }
  // `pruneLayout` rebuilds from recognised keys, so a slice it does not copy is
  // a slice that never comes back from storage.
  if (typeof stored.search === "string") pruned.search = stored.search

  if (typeof stored.pageSize === "number" && Number.isFinite(stored.pageSize) && stored.pageSize > 0) {
    pruned.pageSize = stored.pageSize
  }

  /*
   * The table height the grip left behind. Only sanity is checked here — a
   * finite, positive number — and not the minimum, which depends on the
   * table's row height and so is not knowable from a layout alone;
   * `clampTableHeight` applies that where the height is used. An entry that
   * fails this check is dropped rather than repaired, which puts the `height`
   * prop back in charge instead of rendering `height: NaN` on the root.
   *
   * `height` is an ADDITIVE key: `FORMAT_VERSION` deliberately does not move
   * for it, because a bump discards every stored layout — every user's column
   * widths, order and pinning — to gain a slice they have never set.
   */
  if (typeof stored.height === "number" && Number.isFinite(stored.height) && stored.height > 0) {
    pruned.height = stored.height
  }

  return pruned
}

/**
 * A visibility map reduced to the only entries that carry information.
 *
 * TanStack reads a column missing from the map as visible, so `{ code: true }`
 * and `{}` draw the same table — but they are not the same VALUE, and the
 * layout decides "did the user change anything" by value. "Show all" used to
 * write `true` for every column, which turned an already-fully-visible table's
 * `{}` into `{ code: true, name: true, … }`: a change that changed nothing on
 * screen, yet enough to mark the layout customised, offer a Reset, and write a
 * save. Keeping only the `false` entries makes equal-looking tables equal
 * values, so that click is the no-op it looks like.
 *
 * Applied on write and on load, so a layout saved before this existed stops
 * reading as customised too.
 *
 * @param visibility - Column id to visible, as TanStack writes it.
 * @returns The same map with every `true` dropped.
 *
 * @example
 * hiddenColumnsOnly({ code: true, status: false }) // { status: false }
 */
export function hiddenColumnsOnly(visibility: Record<string, boolean>): Record<string, boolean> {
  return Object.fromEntries(Object.entries(visibility).filter(([, visible]) => visible === false))
}
