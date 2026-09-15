# @khojiakbarr/data-table

A React data table that lets people rearrange it — pin columns to either edge, drag to
reorder, drag to resize, sort, hide — and remembers how each person left it.

Built on [TanStack Table v9](https://tanstack.com/table). Ships as a hook plus an
optional styled shell, so you can take the behaviour and write your own markup.

```bash
npm i @khojiakbarr/data-table @tanstack/react-table
```

```tsx
import { DataTable, useDataTable, localStorageLayout } from "@khojiakbarr/data-table"
import "@khojiakbarr/data-table/styles.css"

function Receipts({ data, columns }) {
  const table = useDataTable({
    id: "receipts",              // required — see "Two tables on one page"
    data,
    columns,
    storage: localStorageLayout(),
    initialLayout: { columnPinning: { start: ["code"], end: ["status"] } },
  })

  return <DataTable instance={table} striped height={480} />
}
```

---

## What it does

| | |
|---|---|
| **Pin columns** | To the start edge, the end edge, or both. Pinned columns stay put while the rest scrolls, with a shadow marking the seam. |
| **Resize columns** | Drag the right edge of a header. Double-click it to go back to the declared width. |
| **Reorder columns** | Drag a header onto another; a caret shows which side it will land on. |
| **Sort** | Click a header: ascending, descending, off. Multi-sort shows its position. |
| **Hide columns** | From the **Columns** panel. |
| **Remember all of it** | Per table, per user, wherever you choose to put it. |

---

## Two tables on one page

This is the part most table wrappers get wrong, so it is worth being explicit.

Every `useDataTable()` call builds its own table with its own state. Two tables rendered
together share nothing — sorting one leaves the other alone.

The part that *can* go wrong is persistence. If both tables wrote their layout under one
key, rearranging either would clobber the other. That is why **`id` is required**: it is
the storage key.

```tsx
const receipts = useDataTable({ id: "receipts", /* … */ })
const products = useDataTable({ id: "products", /* … */ })
```

Give every table in your application a distinct `id` and the problem cannot occur.

---

## Persistence

By default nothing is stored — a table resets when it unmounts.

```tsx
import { localStorageLayout } from "@khojiakbarr/data-table"

useDataTable({ id: "receipts", storage: localStorageLayout(), /* … */ })
```

`localStorage` is per browser. In a multi-user application you usually want layouts on the
server so they follow the user across devices. Supply any object with three methods:

```tsx
const serverLayout: LayoutStorage = {
  load: (id) => cache.get(id) ?? null,
  save: (id, layout) => { void fetch(`/api/table-layout/${id}`, {
    method: "PUT", body: JSON.stringify(layout),
  }) },
  clear: (id) => { void fetch(`/api/table-layout/${id}`, { method: "DELETE" }) },
}
```

`load` is called once when the table mounts, so it must be synchronous — fetch layouts
alongside the rest of your page data and read them from your cache here.

**Columns that disappear.** When you remove a column from the code, stored layouts still
mention it. Those references are dropped on load, and columns added since are appended, so
an old layout never leaves a user with a phantom column or a missing one.

---

## Styling

Every colour and dimension is a CSS custom property with a working default, so the table
looks finished out of the box and restyles without touching its source:

```css
.my-app {
  --dt-header-bg: var(--table-header-bg);
  --dt-row-hover: var(--table-row-hover);
  --dt-accent: var(--primary);
  --dt-radius: 6px;
}
```

<details>
<summary>All tokens</summary>

| Token | Purpose |
|---|---|
| `--dt-bg` `--dt-fg` `--dt-muted-fg` | Surface and text |
| `--dt-border` `--dt-radius` | Edges |
| `--dt-header-bg` `--dt-header-fg` `--dt-header-height` | Header row |
| `--dt-row-hover` `--dt-row-stripe` `--dt-row-height` | Body rows |
| `--dt-accent` `--dt-focus-ring` | Interactive accents |
| `--dt-resize-handle` `--dt-resize-handle-active` | Resize handle |
| `--dt-drop-indicator` | Reorder caret |
| `--dt-pin-shadow-start` `--dt-pin-shadow-end` | Pinned column seams |
| `--dt-font` `--dt-font-size` | Typography |

</details>

Dark mode follows `prefers-color-scheme`. Pass `theme="light"` or `theme="dark"` to pin it.

---

## Headless use

`DataTable` is optional. The hook returns the TanStack instance plus this library's
additions, so you can render whatever markup you need and keep the behaviour:

```tsx
import { useDataTable, pinnedStyle } from "@khojiakbarr/data-table"

const { table } = useDataTable({ id: "receipts", data, columns })

table.getHeaderGroups() // …your own <thead>
<td style={{ width: cell.column.getSize(), ...pinnedStyle(cell.column) }} />
```

`pinnedStyle()` is the only piece worth borrowing rather than rewriting: a pinned column's
offset is the running total of every pinned column before it, and those widths change on
every frame while a resize handle is being dragged. It reads TanStack's memoised offset
map instead of recomputing.

---

## API

### `useDataTable(options)`

| Option | Type | Default | |
|---|---|---|---|
| `id` | `string` | — | **Required.** Unique per application; the persistence key. |
| `data` | `TData[]` | — | |
| `columns` | `ColumnDef[]` | — | Standard TanStack column definitions. |
| `storage` | `LayoutStorage` | none | Where layouts live. |
| `initialLayout` | `Partial<TableLayout>` | `{}` | Applied on a user's first visit. |
| `features` | `DataTableFeatureFlags` | all on | Turn off `sorting`, `resizing`, `reordering`, `pinning` or `hiding`. |
| `defaultColumnWidth` | `number` | `160` | |
| `minColumnWidth` | `number` | `60` | |
| `maxColumnWidth` | `number` | `800` | |

Returns `{ table, id, flags, resetLayout, isCustomised }`.

### `<DataTable />`

| Prop | Type | Default | |
|---|---|---|---|
| `instance` | `DataTableInstance` | — | **Required.** From `useDataTable`. |
| `striped` | `boolean` | `false` | |
| `height` | `number \| string` | auto | Fixed height; header and pinned columns stay put while scrolling. |
| `toolbar` | `boolean` | `true` | |
| `toolbarContent` | `ReactNode` | — | Rendered before the Columns button. |
| `emptyState` | `ReactNode` | `labels.empty` | |
| `labels` | `Partial<DataTableLabels>` | English | Every string, for translation. |
| `theme` | `"light" \| "dark"` | system | |
| `onRowClick` | `(row: TData) => void` | — | |

---

## Accessibility

- Headers carry `aria-sort`, and each sort control names its column, so a screen reader
  announces "Amount: sort ascending" rather than three identical buttons.
- Sort controls, the resize handle and the Columns panel are all reachable by keyboard
  with a visible focus ring.
- The Columns panel closes on `Escape` and on an outside click.
- Reordering is drag-only today. If you need a keyboard path, the panel is the place to
  add it — see [#1](https://github.com/khojiakbarr/data-table/issues).
- `prefers-reduced-motion` disables transitions.

---

## Requirements

React 18 or 19, and `@tanstack/react-table` v9 as a peer dependency.

## Licence

MIT
