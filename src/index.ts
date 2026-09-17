import "./styles.css"

/* The batteries-included shell. */
export { DataTable, defaultLabels } from "./components/DataTable"
export type { DataTableProps } from "./components/DataTable"

/* The behaviour, for a shell of your own. */
export { useDataTable } from "./useDataTable"
export type {
  DataTableFeatures,
  DataTableInstance,
  FilteringOptions,
  PaginationOptions,
  TableMode,
  UseDataTableOptions,
} from "./useDataTable"
export type { TableQuery, TableSearch } from "./core/query"
export type { PaginationApi } from "./core/usePagination"

/*
 * The shell's own parts. Exported so a different layout can reuse the pieces
 * that are fiddly to get right — sticky offsets, drag carets, menu placement —
 * instead of reimplementing them.
 */
export { HeaderCell } from "./components/HeaderCell"
export { HeaderMenu } from "./components/HeaderMenu"
export type { HeaderMenuPosition } from "./components/HeaderMenu"
export { ColumnPanel } from "./components/ColumnPanel"
export { QuickSearch } from "./components/QuickSearch"
export { DepthSpacer, ExpandToggle } from "./components/ExpandToggle"
export { TablePagination } from "./components/TablePagination"
export { SkeletonRows, TableStatus } from "./components/TableStatus"

/*
 * The filter model. Conditions are built by these constructors and never by
 * hand: they fix each condition's key order and sort its values, which is what
 * keeps `instance.query` from changing identity for a filter that did not.
 */
export {
  addDays,
  booleanCondition,
  dateCondition,
  dayChoiceToCondition,
  isFilterValue,
  listCondition,
  numberCondition,
  pruneFilters,
  rebuildCondition,
  startOfLocalDay,
  textCondition,
  toIsoDay,
} from "./core/filters"
export type {
  BooleanCondition,
  DateCondition,
  DayChoice,
  FilterCondition,
  FilterKind,
  FilterModel,
  FilterValue,
  FilterValueOption,
  IsoDay,
  ListCondition,
  NumberCondition,
  TextCondition,
} from "./core/filters"

export { filterFn_dt, isBlankValue, resolveCondition } from "./core/filterFn"
export type { ResolvedCondition } from "./core/filterFn"
export { collectColumnFacts, collectFilterKinds, resolveFilterKind } from "./core/filterKinds"
export type { FilterColumnDefShape, FilterKindSource } from "./core/filterKinds"
export {
  collectSearchFields,
  filterFn_dtSearch,
  isSearchableColumn,
  pruneSearchFields,
  rowMatchesSearch,
  searchNeedle,
} from "./core/search"
export type { PrunedSearchFields, SearchFieldsResult, SearchNeedle } from "./core/search"
export { useDebouncedValue } from "./core/useDebouncedValue"

/* Helpers worth borrowing rather than rewriting. */
export { fillerIndex, headerPinning, pinnedStyle, renderedLeafColumns } from "./core/pinning"
export type { HeaderPinning } from "./core/pinning"
export { dropSideAt, moveColumn } from "./core/reorder"
export type { DropSide } from "./core/reorder"
export { measureColumnWidth, measureHeaderWidth } from "./core/autosize"
export type { AutosizeBounds } from "./core/autosize"
export { useAutosize } from "./core/useAutosize"
export type { AutosizeActions } from "./core/useAutosize"
export { useClampedPlacement } from "./core/useClampedPlacement"
export type { ClampedPoint } from "./core/useClampedPlacement"
export { clampColumnWidth, columnBounds } from "./core/sizing"
export type { ColumnBounds } from "./core/sizing"
export { localStorageLayout, noLayoutStorage, pruneLayout } from "./core/persistence"
export { useRowVirtualizer } from "./core/useRowVirtualizer"
export type { RowVirtualizerOptions, RowVirtualizerResult, RenderedItem } from "./core/useRowVirtualizer"
export { useUnboundedViewport } from "./core/useUnboundedViewport"
export type { UnboundedViewportOptions } from "./core/useUnboundedViewport"
export { buildDisplayList, displayItemKey, spacerSizes } from "./core/virtualRows"
export type { DisplayItem, SpacerSizes } from "./core/virtualRows"

export type {
  DataTableColumnMeta,
  DataTableFeatureFlags,
  DataTableLabels,
  LayoutStorage,
  TableLayout,
} from "./types"
