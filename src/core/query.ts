import type { ColumnFiltersState, GroupingState, SortingState } from "@tanstack/react-table"

/**
 * Everything a server needs to produce one page of rows.
 *
 * Built by {@link useDataTable} from the current layout and page state and
 * handed to `onQueryChange`. The filter and grouping fields are reserved for
 * later stages and are always empty for now, so the shape a backend is
 * written against does not change when those stages land.
 */
export interface TableQuery {
  sorting: SortingState
  columnFilters: ColumnFiltersState
  globalFilter: string
  grouping: GroupingState
  pagination: { pageIndex: number; pageSize: number }
}

export interface QueryInputs {
  sorting: SortingState
  pageIndex: number
  pageSize: number
}

/**
 * Assemble a query from the table's state.
 *
 * @param inputs - The state slices that feed the query.
 * @returns A new query object.
 */
export function buildQuery({ sorting, pageIndex, pageSize }: QueryInputs): TableQuery {
  return {
    sorting,
    columnFilters: [],
    globalFilter: "",
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
 */
export function queriesEqual(a: TableQuery, b: TableQuery): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
