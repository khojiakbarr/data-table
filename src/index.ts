import "./styles.css"

/* The batteries-included shell. */
export { DataTable, defaultLabels } from "./components/DataTable"
export type { DataTableProps } from "./components/DataTable"

/* The behaviour, for a shell of your own. */
export { useDataTable } from "./useDataTable"
export type {
  DataTableFeatures,
  DataTableInstance,
  UseDataTableOptions,
} from "./useDataTable"

/*
 * The shell's own parts. Exported so a different layout can reuse the pieces
 * that are fiddly to get right — sticky offsets, drag carets, menu placement —
 * instead of reimplementing them.
 */
export { HeaderCell } from "./components/HeaderCell"
export { HeaderMenu } from "./components/HeaderMenu"
export type { HeaderMenuPosition } from "./components/HeaderMenu"
export { ColumnPanel } from "./components/ColumnPanel"
export { DepthSpacer, ExpandToggle } from "./components/ExpandToggle"

/* Helpers worth borrowing rather than rewriting. */
export { fillerIndex, headerPinning, pinnedStyle, renderedLeafColumns } from "./core/pinning"
export type { HeaderPinning } from "./core/pinning"
export { dropSideAt, moveColumn } from "./core/reorder"
export type { DropSide } from "./core/reorder"
export { measureColumnWidth, measureHeaderWidth } from "./core/autosize"
export type { AutosizeBounds } from "./core/autosize"
export { useAutosize } from "./core/useAutosize"
export type { AutosizeActions } from "./core/useAutosize"
export { clampColumnWidth, columnBounds } from "./core/sizing"
export type { ColumnBounds } from "./core/sizing"
export { localStorageLayout, noLayoutStorage, pruneLayout } from "./core/persistence"

export type {
  DataTableFeatureFlags,
  DataTableLabels,
  LayoutStorage,
  TableLayout,
} from "./types"
