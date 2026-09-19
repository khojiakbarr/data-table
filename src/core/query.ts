import type { GroupingState, SortingState } from "@tanstack/react-table"
import type { FilterCondition } from "./filters"

/**
 * What quick search asks for.
 *
 * Its own field rather than a synthetic condition, because it crosses columns
 * and a condition does not. The semantics are the contract, and are identical
 * client-side and server-side: split `text` on whitespace; every token must
 * appear, case-insensitively, in at least one of `fields` on that row; tokens
 * may match different columns.
 */
export interface TableSearch {
  /** The user's text, trimmed. Never empty — the field is `null` instead. */
  text: string
  /** Column ids the search covers, sorted by id. */
  fields: string[]
}

/**
 * Everything a server needs to produce one page of rows.
 *
 * Built by {@link useDataTable} from the current layout and page state and
 * handed to `onQueryChange`. Everything in it is JSON: dates are `YYYY-MM-DD`
 * strings, lists are arrays of JSON primitives, and an absent bound is `null`
 * rather than `undefined`, because {@link queriesEqual} compares by
 * `JSON.stringify` and a `Set`, a `Date` or an `undefined` would make two
 * different queries compare equal.
 *
 * `filters` is a flat array, implicitly ANDed. Cross-column OR, when it
 * arrives, will be a **new optional field** rather than a change to the element
 * type, so a backend written against this shape keeps working.
 */
export interface TableQuery {
  sorting: SortingState
  filters: FilterCondition[]
  search: TableSearch | null
  grouping: GroupingState
  pagination: { pageIndex: number; pageSize: number }
}

export interface QueryInputs {
  sorting: SortingState
  filters: readonly FilterCondition[]
  search: TableSearch | null
  pageIndex: number
  pageSize: number
}

/** Deterministic, locale-independent id order. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Assemble a query from the table's state.
 *
 * `filters` is sorted by `field` and `search.fields` by id, so each array is a
 * function of the filter set alone. Array order is as significant to
 * `JSON.stringify` as key order, and it is the reachable half: column order is
 * a layout slice the user drags, so filters emitted in column position order
 * would change the query string — and make a host refetch an identical result
 * set, with the page reset — every time a column moved.
 *
 * @param inputs - The state slices that feed the query.
 * @returns A new query object.
 */
export function buildQuery({ sorting, filters, search, pageIndex, pageSize }: QueryInputs): TableQuery {
  return {
    sorting,
    filters: [...filters].sort((a, b) => compareIds(a.field, b.field)),
    search: search === null ? null : { text: search.text, fields: [...search.fields].sort(compareIds) },
    grouping: [],
    pagination: { pageIndex, pageSize },
  }
}

/**
 * Structural equality for queries.
 *
 * Queries are JSON-shaped, so a stringify comparison is exact and cheap at
 * this size. {@link useTableQuery} calls this every render to decide whether
 * to keep its previous query object or replace it — which is what actually
 * keeps `instance.query` referentially stable between renders that changed
 * nothing, and, unlike a `useMemo` cache, does not depend on React choosing
 * not to discard one.
 *
 * It is exact only because everything in a query is JSON and every array in it
 * is in a fixed order: `buildQuery` sorts `filters` and `search.fields`, and
 * the condition constructors fix each condition's key order and sort `values`.
 */
export function queriesEqual(a: TableQuery, b: TableQuery): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
