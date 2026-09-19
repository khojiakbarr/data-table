# Changelog

Notable changes to `@khojiakbarr/data-table`. This file starts at 0.5.0; earlier
releases are summarised in one line rather than reconstructed.

## Unreleased

### Changed

- **The built-in shell docks the Columns and Filters panels in a side bar** on
  the table's inline-end edge, instead of floating them over it. A rail of
  vertical tabs is now always visible; opening a panel takes width from the
  table rather than covering it, which is what this table needed, since it
  scrolls horizontally and a floating panel hides columns the user cannot then
  scroll out from under it. The behaviour that goes with docking:
  - the active rail tab closes the panel, another switches to it;
  - `Escape` closes it **only while focus is inside it**, and hands focus back
    to the rail tab;
  - **an outside click no longer closes it.** A bar docked beside the table is
    furniture, and using the table is not a request to dismiss it.
  Below 640px the rail is withdrawn, the toolbar's Columns button stays the way
  in, and the panel overlays the card at full width as it did before.
- `DataTable` renders its toolbar, status, viewport and footer inside a new
  `.dt-main` element, the flex sibling of `.dt-sidebar`. A host that styled
  `.dt-root > .dt-toolbar`, `.dt-root > .dt-error` or any other direct-child
  selector has to drop one level; the class names themselves are unchanged.
- The `.dt-root:has(> .dt-panel)` z-index lift is now
  `.dt-root:has(> .dt-panel-floating)`. It exists for a panel that can be
  painted over by a later sibling table, which a docked panel — in flow, inside
  the card — cannot be.
- The toolbar's Columns button no longer claims `aria-haspopup="dialog"`: what
  it opens is the side bar's tab panel, in flow beside the table.

### Added

- **`TableSideBar`**, the rail and the docked panel, exported for a shell of
  its own.
- **`TablePanel` takes a `presentation` prop** — `"floating"` (the default,
  unchanged: a popover with its own tab strip, dismissed by an outside press
  and by `Escape` from anywhere) or `"docked"` (in flow, no tab strip of its
  own, the dismissal rules above). It is a declared prop and never inferred
  from where the panel is mounted, so the same markup in two places cannot
  behave two ways.
- `DataTableLabels.sideBar`, the rail's accessible name. Hosts using the
  documented `{ ...defaultLabels, ...mine }` recipe are unaffected.

### Unchanged

- **`ColumnPanel` behaves exactly as it always did.** It is still exported,
  still takes the same four props, still floats, still closes on an outside
  press and on `Escape`, and still opens on its Columns tab — it now passes
  `presentation="floating"` explicitly rather than relying on the default. The
  shell moved to a docked bar; this component did not change, so a host
  rendering it needs to do nothing.

## 0.5.0

### Breaking

- **`HeaderCell` takes a `drop` prop**, the shared drag returned by
  `useDropSlot`. The slot is drawn on the column at the DESTINATION, which is
  almost never the cell the pointer is over, so no cell can decide on its own
  whether it is wearing it. A shell of its own calls `useDropSlot` over its
  rendered leaf column ids and passes the result to every header cell.
- `DataTableLabels` gains `reorderHint` and `reorderPosition` for the keyboard
  reorder path. Hosts using the documented `{ ...defaultLabels, ...mine }`
  recipe are unaffected.
- **`TableQuery.columnFilters` and `TableQuery.globalFilter` are removed**, and
  replaced by `filters: FilterCondition[]` and `search: TableSearch | null`.
  Both removed fields had only ever been `[]` and `""`, so no host can have read
  anything meaningful out of them — but the rename is a compile error rather
  than a silent behaviour change, which is why it was done as a rename. Update
  any backend adapter that destructures the query.
- `TableQuery.filters` is **sorted by `field`**, and `TableQuery.search.fields`
  by id. A backend must not assume either array is in column order.
- `DataTableLabels` gains 48 required keys for filtering: the quick-search box,
  the filter editor and its operator names, values lists, the Filters tab and
  the filtered-empty state. Hosts using the documented
  `{ ...defaultLabels, ...mine }` recipe are unaffected; a host hand-building a
  complete labels object has to add them. Operator names are flat keys
  (`opContains`, `opBetween`, …) rather than a nested object, so overriding one
  of them works the same way as overriding any other label.

### Added

- The filter model: `FilterCondition` and its five kinds (`text`, `number`,
  `date`, `boolean`, `list`), each with an explicit operator, plus the
  constructors that build them — `textCondition`, `numberCondition`,
  `dateCondition`, `booleanCondition`, `listCondition` — and `rebuildCondition`
  for re-running an untrusted one through its constructor.
- `dayChoiceToCondition`, `startOfLocalDay`, `toIsoDay` and `addDays`: a date
  filter is always published as a half-open `[from, before)` range of calendar
  days, and every day is parsed in the viewer's own calendar.
- `filterFn_dt`, the single registered filter function that dispatches on a
  condition, with `resolveCondition` and `isBlankValue` beside it.
- Quick search in the toolbar (`QuickSearch`), published on a debounce, and a
  per-column filter editor reachable from the header menu (`FilterEditor`,
  `FilterPopover`) or from the side panel's new Filters tab (`TablePanel`,
  `ColumnsTab`, `FiltersTab`). `ColumnPanel` keeps the four props it always
  had and opens on the Columns tab.
- Values lists (`FilterValues`): distinct values with counts from the data in
  client mode, `filtering.loadValues` in server mode, `meta.values` in either,
  and an explanatory label rather than an empty list when a column has none.
- `instance.filtering`: `enabled`, `kinds`, `conditions`, `search`,
  `isFiltered`, `setCondition`, `clearColumn`, `clearAll`, `setSearch`,
  `getModel`, `setModel`, `loadValues`. Plus `columnLabel`,
  `useClampedPlacement` and the editors' draft helpers, for a shell of your own.
- A distinct empty state for "a filter excluded every row", with a way out of it.
- **Reordering shows a drop slot** instead of a caret on the seam: the column
  standing where the dragged one will land is outlined and tinted, in the
  header and in the Columns tab alike, so the preview is the destination rather
  than the gap. Built from `--dt-drop-indicator`, which every preset already
  maps; it opens with a 150ms transform/opacity animation and simply appears
  under `prefers-reduced-motion`. `dropSlotId`, `dropAtIndex`, `reachableRange`
  and `useDropSlot` are exported for a shell of your own.
- **Columns can be reordered from the keyboard.** The Columns tab's drag handle
  is in the Tab order: Space picks a column up, the arrows move the slot, Space
  drops it and Escape gives it back, with each position announced politely. The
  slot stops at a group or pinning boundary rather than promising a move the
  table would refuse.
- `ruLabels` and `uzLabels`: complete Russian and Uzbek translations of
  `DataTableLabels`, filtering keys included. Each is typed as the whole
  interface rather than a `Partial`, so `labels={ruLabels}` needs no
  `defaultLabels` spread under it. See the labels recipe under **Headless
  use** in the README.

## 0.4.0 and earlier

Nested column groups, expandable rows and tree data, column pinning, resizing,
reordering, sorting, per-table persisted layout, row virtualisation, the
server-side data model and pagination.
