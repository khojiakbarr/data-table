import { useCallback, useRef, useState } from "react"
import type { Updater } from "@tanstack/react-table"
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
}

/** The layout plus what the table knows about where it came from. */
interface Arrangement {
  layout: TableLayout
  /** Differs from the declared layout, so a Reset control makes sense. */
  isCustomised: boolean
  /**
   * Changed by the user since mount, so worth writing. A layout read from
   * storage is customised but has nothing new to save.
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
export function useArrangement({ id, store, initialLayout, columnIds }: UseArrangementOptions) {
  const [arrangement, setArrangement] = useState<Arrangement>(() => {
    const stored = store.load(id)
    return {
      layout: { ...EMPTY_LAYOUT, ...initialLayout, ...pruneLayout(stored ?? {}, columnIds) },
      isCustomised: stored !== null,
      hasUnsavedChanges: false,
    }
  })
  const initialRef = useRef(initialLayout)

  useDebouncedSave(store, id, arrangement.layout, arrangement.hasUnsavedChanges)

  const updateSlice = useCallback(
    <TKey extends keyof TableLayout>(
      key: TKey,
      updater: Updater<TableLayout[TKey]>,
      normalise: (slice: TableLayout[TKey]) => TableLayout[TKey] = (slice) => slice,
    ) => {
      setArrangement((previous) => {
        const next = normalise(apply(updater, previous.layout[key]))
        if (layoutSliceEqual(next, previous.layout[key])) return previous
        return {
          layout: { ...previous.layout, [key]: next },
          isCustomised: true,
          hasUnsavedChanges: true,
        }
      })
    },
    [],
  )

  const resetLayout = useCallback(() => {
    store.clear(id)
    setArrangement({
      layout: { ...EMPTY_LAYOUT, ...initialRef.current },
      isCustomised: false,
      hasUnsavedChanges: false,
    })
  }, [store, id])

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
