# Changelog

Notable changes to `@khojiakbarr/data-table`. This file starts at 0.5.0; earlier
releases are summarised in one line rather than reconstructed.

## Unreleased

### Changed

- **The Columns tab shows the column tree** instead of a flat list of leaves.
  A group is a row of its own with its children indented beneath it, to
  whatever depth the columns nest, and it carries a checkbox that speaks for
  every leaf under it: ticking shows them all, unticking hides them all, and it
  is **indeterminate** when only some are visible. Each group collapses and
  expands, per group, expanded by default.
- **The Columns tab lists hidden columns too.** It was built from the visible
  columns alone, so unticking a column took its own row away with it and the
  only way back was Show all. A group keeps its row for the same reason, even
  once every leaf under it is hidden — while its header does leave the table,
  which is what hiding the columns means.
- Reordering is unchanged: `dropRegionOf` still owns the group boundary, a
  group row has no drag handle of its own, and both drag surfaces resolve every
  move against the same flat order they always did.
- **The playground's columns are grouped** — "Document" over Code and Partner,
  "Payment" over Amount and Status, with Flagged and Date left flat, so the
  header has a grouped half and a flat one.
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

- **`muiTokens(theme)` — a Material UI bridge**, exported from the package
  root. It maps a MUI theme's palette, typography and radius onto the
  `--dt-*` tokens and returns them as a style object to spread onto the
  table: `<DataTable instance={table} style={muiTokens(theme)} />`. The
  shadcn presets are stylesheets that point the tokens at the host's own
  custom properties, and a MUI **v5** application publishes none — there is
  nothing for a stylesheet to read — so this one reads the theme instead,
  which also covers v6's CSS-variables mode, where `theme.palette` holds the
  `var(--mui-…)` references. The library does not depend on MUI and does not
  import it, not even as a type: the parameter is typed structurally against
  the fields actually read, so a v5 theme, a v6 theme and a hand-written
  object all compile and no host needs MUI installed to typecheck. Scope is
  colour, type and radius — density and borders stay the table's own, which
  is what was asked for.
  - **The theme's `palette.mode` decides the table's mode**, deliberately: an
    inline style beats every stylesheet rule, so these tokens override the
    built-in `prefers-color-scheme` block *and* the `theme` prop. For that to
    be a rule rather than an accident, the function emits **every** token the
    base sheet swaps between its light and dark blocks — a partial map would
    leave a light MUI theme with dark borders on a machine set to dark — and
    every fallback comes in a light and a dark form, so a theme stating
    nothing but `mode: "dark"` still gets a dark table.
  - The two action tints are rebuilt rather than copied. MUI states
    `action.hover` and `action.selected` as translucent colours, and a cell
    here paints an opaque `--dt-bg` under a `position: sticky` pinned column,
    so a see-through hover would show the columns scrolling beneath it. The
    opacities are recomposited against the surface with `color-mix()` — MUI's
    own recipe, with an opaque result.
- **`style` on `<DataTable>`**, alongside the `className` it already had. It
  is where `muiTokens`' tokens go, since the base sheet declares every
  `--dt-*` on `.dt-root` itself and an override has to land on that same
  element. The table's own two inline values still win over it: the `height`
  the prop or the resize grip decided, and `--dt-row-height`, which has to
  stay equal to the virtualiser's row estimate.
- **A Row Groups zone in the side bar's Columns tab**, under the column tree —
  the control the grouping was built for. Dragging a column into it groups by
  that column; dragging a second nests it inside the first. Each level is a
  chip, outermost first, removable by its own button and draggable to renest,
  and an empty zone is a dashed area saying what it is for rather than an
  invisible target. The drop affordance is the slot the columns already use:
  the chip standing at the destination is outlined, and when the destination is
  past the last level a chip is drawn for the incoming column so there is
  something to outline. `ReorderInvariant.test.tsx` now checks the same
  "it lands where the slot was" property for this third target.
  - **Two drag sources.** A column's row in the Columns tree, and its own
    header. The header works because the shell hands the panel the column in
    flight — `dataTransfer` is unreadable during `dragover`, so a zone left to
    discover it at drop time could never draw a slot. It needs the panel open,
    since that is where the zone lives.
  - **A keyboard path, not an afterthought.** Every row in the Columns tab
    carries a group toggle (`Group rows by Status`, `Remove Status from row
    groups`), and a chip is renested with the keys the column list already
    uses: Space, the arrows, Space, Escape — each step announced through a
    live region.
  - **No zone where grouping is impossible.** `instance.grouping.enabled` is
    false on a client table, and the zone is then not rendered at all: a target
    that accepted a drop and did nothing is the failure this avoids.
  - **A floor under the group column's width.** The group column is a grouped
    column's own slot, sized for that column's values rather than for a
    chevron, a value and a count together. While grouped it is floored at 200px
    plus one indent step per extra level. It is a floor and not a clamp — a
    width the user set wins outright, so the resize handle is not fought — and
    it is derived rather than written into the layout, so removing the last
    chip restores the column exactly. Exported as `groupColumnMinWidth`.
  - New labels: `rowGroupsTitle`, `rowGroupsHint`, `groupByColumn`,
    `ungroupColumn`, `rowGroupLevel`, in all three shipped sets.
  - New exports: `RowGroupsZone`, `RowGroupsZoneProps`, `groupColumnMinWidth`.
    `ColumnsTab`, `TablePanel` and `TableSideBar` gain an optional
    `draggedColumnId`.
  - The playground's temporary grouping control is gone; the zone replaces it.

- **Server-side row grouping.** `TableQuery` carries `grouping` (column ids,
  outermost first) and `expanded` (the exact key paths of the open groups),
  and the answer is a page of the flattened visible rows: your records with
  `GroupRow` headers interleaved in the order the user would see them. The
  table recognises a header by its `kind` and hands one to no callback of
  yours, so an accessor written against your own row is never asked to read
  one. Grouping is server-side only, with no client-mode fallback: grouping
  one page of fifty rows out of a hundred thousand would report counts for the
  page as if they described the table.
- **`instance.grouping`** — `{ enabled, columns, isGrouped, has, columnId,
  set, add, remove, clear, expanded, isExpanded, toggle, collapseAll,
  startPath }`, shaped like `instance.filtering` and `instance.pagination`.
- **`startPath` on the answer, and as an option.** A page whose boundary falls
  inside an open group comes back as records with no header above them, and a
  record carries no path. Report the open group the page's first row sits
  inside and the table draws a "continued" header above them.
- **A grouped column leaves the body**, and its slot becomes the group column
  holding the chevron, the value and the count, with a mark in the header it
  keeps — so sorting it still reorders that level. Expansion reuses the row
  expansion the table already had, so `aria-expanded`, the focus ring and the
  reduced-motion rule are unchanged. A blank key is one group, named with the
  same "(Blanks)" the filter editors use.
- **Grouping and its open branches are part of the saved layout**, beside
  `sorting`. `pruneLayout` drops a group on a column that no longer exists —
  and then every open path with it, because a path's keys are positional and a
  removed level would silently re-read each key as belonging to the level
  above. `FORMAT_VERSION` deliberately does not move: both keys are additive,
  and a bump would discard every stored layout to gain slices nobody has set.
- **New labels**: `groupedBadge`, `groupCount`, `groupRow`, `groupContinued`
  and `clearGrouping`, in all three shipped sets. The grouped-empty state gets
  the same way out the filtered-empty state has.
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
- **`DataTableLabels.columnGroup`, `.expandGroup` and `.collapseGroup`** — the
  group checkbox's accessible name and the collapse control's, in all three
  label sets. Same recipe, same non-impact.
- **`ColumnGroupRow`**, the group's row, and the tree helpers behind it —
  `buildColumnTree`, `leafColumnsOfNode`, `groupVisibility` — exported for a
  panel of one's own.
- **`orderedLeafColumns(table)`**, the render order of every leaf column,
  hidden ones included. `renderedLeafColumns` is unchanged and still answers
  "what is on screen", which is what a `<colgroup>` wants.

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
