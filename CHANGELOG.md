# Changelog

Notable changes to `@khojiakbarr/data-table`. This file starts at 0.5.0; earlier
releases are summarised in one line rather than reconstructed.

## 0.5.0

### Breaking

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

## 0.4.0 and earlier

Nested column groups, expandable rows and tree data, column pinning, resizing,
reordering, sorting, per-table persisted layout, row virtualisation, the
server-side data model and pagination.
