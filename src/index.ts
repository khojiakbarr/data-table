import "./styles.css"

/* The batteries-included shell. */
export { DataTable, defaultLabels } from "./components/DataTable"
export type { DataTableProps, FiltersPanelSlot } from "./components/DataTable"

/* Translated label sets. Each is typed as the whole `DataTableLabels`, not a
   `Partial`, so a key added to the interface fails to compile here instead of
   silently staying English. */
export { ruLabels } from "./labels/ru"
export { uzLabels } from "./labels/uz"

/*
 * Design-system bridges. The shadcn presets are stylesheets under
 * `@hojiakbar_dev/data-table/themes/*.css`; MUI needs a function instead,
 * because a MUI v5 host publishes no CSS variables for a stylesheet to read.
 */
export { muiTokens } from "./themes/mui"
export type { MuiThemeInput, TokenStyle } from "./themes/mui"

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
 * that are fiddly to get right — sticky offsets, the drop slot, menu placement —
 * instead of reimplementing them.
 */
export { HeaderCell } from "./components/HeaderCell"
export { HeaderMenu } from "./components/HeaderMenu"
export type { HeaderMenuPosition } from "./components/HeaderMenu"
export { HeightGrip } from "./components/HeightGrip"
export type { HeightGripProps } from "./components/HeightGrip"
export { ColumnPanel } from "./components/ColumnPanel"
export { TablePanel } from "./components/TablePanel"
export type { PanelPresentation, PanelTab, TablePanelProps } from "./components/TablePanel"
export { TableSideBar } from "./components/TableSideBar"
export type { TableSideBarProps } from "./components/TableSideBar"
export { ColumnsTab } from "./components/ColumnsTab"
export type { ColumnsTabProps } from "./components/ColumnsTab"
export { ColumnGroupRow } from "./components/ColumnGroupRow"
export type { ColumnGroupRowProps } from "./components/ColumnGroupRow"
export { RowGroupsZone } from "./components/RowGroupsZone"
export type { RowGroupsZoneProps } from "./components/RowGroupsZone"
export { FiltersTab } from "./components/FiltersTab"
export type { FiltersTabProps } from "./components/FiltersTab"
export { QuickSearch } from "./components/QuickSearch"
export { DepthSpacer, ExpandToggle } from "./components/ExpandToggle"
export { GroupBodyRow } from "./components/GroupBodyRow"
/*
 * Cell editing. The editor and the menu are the two pieces a shell of its own
 * would otherwise rebuild — `CellEditor` holds the five kinds, the commit
 * rules and the IME guard, `CellMenu` the placement and focus return it shares
 * with `HeaderMenu`. `useCellEditing` is what joins them to a table: the
 * optimistic value, the Tab walk and the notices are the parts that are hard
 * to get right twice.
 */
export { CellEditor } from "./components/CellEditor"
export type { CellEditorProps } from "./components/CellEditor"
export { CellMenu } from "./components/CellMenu"
export type { CellMenuProps } from "./components/CellMenu"
export { CellEditNotice } from "./components/CellEditNotice"
export type { CellEditNoticeProps } from "./components/CellEditNotice"
export {
  cellEditKey,
  cellEditability,
  draftFromValue,
  isSameCell,
  isUnchanged,
  nextEditableCell,
  notEditableLabelKey,
  parseDraft,
  resolveEditable,
} from "./core/cellEditing"
export type {
  CellEdit,
  CellEditHandler,
  CellRef,
  Editability,
  EditableDeclaration,
  EditableFacts,
  EditableKind,
  EditableRowPredicate,
  NotEditableReason,
  ParsedDraft,
} from "./core/cellEditing"
export { useCellEditing } from "./core/useCellEditing"
export type {
  CellEditing,
  CellEditingOptions,
  CellOverride,
  EditNotice,
  OpenCellEditor,
  OpenCellMenu,
} from "./core/useCellEditing"
export { defaultCellEditingLabels } from "./labels/editing"
export type { CellEditingLabels } from "./labels/editing"
export { ruCellEditingLabels } from "./labels/ru"
export { uzCellEditingLabels } from "./labels/uz"
export { useMenuSurface } from "./core/useMenuSurface"
export type { MenuSurfaceOptions } from "./core/useMenuSurface"

export { canFilterColumn, FilterEditor } from "./components/FilterEditor"
export type { FilterEditorProps } from "./components/FilterEditor"
export { FilterPopover } from "./components/FilterPopover"
export type { FilterPopoverProps } from "./components/FilterPopover"
export { FilterValues } from "./components/FilterValues"
export type { FilterValuesProps } from "./components/FilterValues"
export { TablePagination } from "./components/TablePagination"
export { StatusBar } from "./components/StatusBar"
export type { StatusBarProps } from "./components/StatusBar"
export { SkeletonRows, TableStatus } from "./components/TableStatus"
export { TotalsFooter } from "./components/TotalsFooter"
export type { TotalsFooterProps } from "./components/TotalsFooter"

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

/*
 * Server-side row grouping. `GroupRow` is the shape a flattened page carries
 * beside the host's own rows; the rest is what a shell needs to read a key
 * path — `groupRowId` is the id the table gives a group row, and the two
 * prune helpers are the gate a stored or hand-written grouping goes through.
 */
export {
  groupColumnMinWidth,
  groupRowId,
  isGroupRow,
  isPathExpanded,
  normaliseExpanded,
  pathsEqual,
  pruneExpanded,
  pruneGrouping,
  togglePath,
} from "./core/grouping"
export type { GroupRow } from "./core/grouping"

/*
 * The row-number column, for a shell of your own. `BodyRow` and
 * `GroupBodyRow` draw the number rather than a cell renderer, because the
 * number is a property of the ROW — where it sits on the page, plus the pages
 * before it — so a body written from scratch needs the same two answers:
 * which cell is the number's, and what goes in it.
 */
export { ROW_NUMBER_COLUMN_ID, isRowNumberColumn, rowNumberAt } from "./core/rowNumbers"

/*
 * Row selection. The model and its four reducers are exported because a host
 * has to translate `all-matching` into its own `WHERE` clause, and a shell of
 * its own has to answer the same two questions the built-in body does: which
 * cell is the checkbox's, and whether this row is in the selection.
 * `useSelection` is the hook behind `instance.selection`, including the
 * query-change reset that makes the whole thing safe. `headerScopeOf`,
 * `pageHeaderState` and `withPageRows` are the page-scoped header checkbox:
 * what it reaches, how it draws itself, and what one tick does.
 */
export {
  ALL_MATCHING_SELECTION,
  EMPTY_SELECTION,
  SELECTION_COLUMN_ID,
  SELECTION_COLUMN_WIDTH,
  headerScopeOf,
  isRowSelected,
  isSelectionColumn,
  isSelectionEmpty,
  isSelectionEnabled,
  pageHeaderState,
  selectionColumnDef,
  selectionCount,
  selectionScopeOf,
  withPageRows,
  withRow,
} from "./core/selection"
export type {
  SelectionFeature,
  SelectionHeaderScope,
  SelectionModel,
  SelectionOptions,
} from "./core/selection"
export { useSelection } from "./core/useSelection"
export type {
  SelectionApi,
  SelectionChange,
  SelectionSummary,
  UseSelectionOptions,
} from "./core/useSelection"
export { SelectionCheckbox } from "./components/SelectionCheckbox"
export type { SelectionCheckboxProps } from "./components/SelectionCheckbox"
export { useIndeterminate } from "./core/useIndeterminate"

export { filterFn_dt, isBlankValue, resolveCondition } from "./core/filterFn"
export type { ResolvedCondition } from "./core/filterFn"
export { collectColumnFacts, collectFilterKinds, resolveFilterKind } from "./core/filterKinds"
export type { FilterColumnDefShape, FilterKindSource } from "./core/filterKinds"
export {
  conditionToDayChoice,
  describeCondition,
  draftFromCondition,
  draftToCondition,
  emptyDraft,
  isBlankOperator,
  isRangeOperator,
  operatorChoices,
  withOperator,
} from "./core/filterDraft"
export type {
  BooleanDraftOp,
  FilterDraft,
  KindOperatorChoice,
  ListDraft,
  OperatorChoice,
  OperatorLabelKey,
} from "./core/filterDraft"
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
export {
  fillerIndex,
  headerPinning,
  orderedLeafColumns,
  pinnedStyle,
  renderedLeafColumns,
} from "./core/pinning"
export type { HeaderPinning } from "./core/pinning"
export { buildColumnTree, groupVisibility, leafColumnsOfNode } from "./core/columnTree"
export type {
  ColumnTreeGroup,
  ColumnTreeLeaf,
  ColumnTreeNode,
  GroupVisibility,
} from "./core/columnTree"
export { columnLabel } from "./core/columnLabel"
export { dropAtIndex, dropSideAt, dropSlotId, moveColumn, reachableRange } from "./core/reorder"
export type { DropSide } from "./core/reorder"
export { useDropSlot } from "./core/useDropSlot"
export type { DropSlot } from "./core/useDropSlot"
export { measureColumnWidth, measureHeaderWidth } from "./core/autosize"
export type { AutosizeBounds } from "./core/autosize"
export { useAutosize } from "./core/useAutosize"
export type { AutosizeActions } from "./core/useAutosize"
export { useClampedPlacement } from "./core/useClampedPlacement"
export type { ClampedPoint } from "./core/useClampedPlacement"
export { clampColumnWidth, columnBounds } from "./core/sizing"
export type { ColumnBounds } from "./core/sizing"
export { clampTableHeight, minTableHeight, tableHeightStep } from "./core/tableHeight"
export { formatCount } from "./core/formatCount"
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
