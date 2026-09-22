import type { ColumnDef, RowData } from "@tanstack/react-table"
import type { DataTableFeatures } from "../useDataTable"

/**
 * The leading column that numbers the rows.
 *
 * It is CHROME, not a column of data, and that one distinction decides
 * everything here: it is not one of the host's declarations, so it is absent
 * from `columnIds` and from `declaredLeafIds`; it is never written into the
 * stored order or the stored pinning, the way the group column is not; and it
 * is alone in its drop region, so no drag may pick it up and none may land
 * beside it. What it IS is a real TanStack column — not an extra cell the
 * shell draws — because every sticky offset a pinned column computes comes
 * from `column.getStart()`, and a width the table does not know about would
 * leave every one of those offsets short by exactly this column.
 */

/**
 * The id the row-number column carries.
 *
 * Prefixed so it cannot collide with an id {@link deriveColumnId} would mint
 * from a host's definition: an accessor key with two leading underscores and
 * this exact spelling is not an id anyone writes by accident, and it is the
 * only name this column is ever known by — the header, the body, the drop
 * region and the saved width all look it up by this constant.
 */
export const ROW_NUMBER_COLUMN_ID = "__dt_row_number"

/**
 * Whether a column is the row-number column.
 *
 * A named question rather than `id === ROW_NUMBER_COLUMN_ID` spelled out at
 * six call sites: the header asks it to name itself, the body asks it to draw
 * a number instead of a value, the panel asks it to leave the column out of
 * its tree, and `dropRegionOf` asks it to refuse every drag. One reading, so
 * they cannot drift apart.
 *
 * @param columnId - Any column id.
 * @returns True for the row-number column.
 *
 * @example
 * if (isRowNumberColumn(cell.column.id)) return <td className="dt-row-number" />
 */
export function isRowNumberColumn(columnId: string): boolean {
  return columnId === ROW_NUMBER_COLUMN_ID
}

/**
 * The number a row carries: its 1-based place in the WHOLE result set.
 *
 * `position` restarts at 0 on every page — it is an index into the rows this
 * page holds — and `rowIndexOffset` is what the pages before it already
 * accounted for (`pageIndex * pageSize`, zero with paging off). So this is
 * `pageIndex * pageSize + indexOnPage + 1`, computed from the two quantities
 * a row already has rather than from a third one derived somewhere else.
 *
 * It is deliberately the same expression `aria-rowindex` is built from —
 * `rowNumberAt(...) + headerRowCount` is that attribute — because a printed
 * number and an announced position that disagreed would be the same row
 * described two ways, and nothing on screen would say which one to believe.
 * Both readings go through here so they cannot.
 *
 * @param position - The row's index among the rows this page renders.
 * @param rowIndexOffset - Rows on the pages before this one.
 * @returns The row's 1-based position in the whole result set.
 *
 * @example
 * <td>{rowNumberAt(position, rowIndexOffset)}</td>
 */
export function rowNumberAt(position: number, rowIndexOffset: number): number {
  return position + rowIndexOffset + 1
}

/** The cell's own inline padding, both sides, from `styles.css`. */
const ROW_NUMBER_PADDING_PX = 20
/** Roughly one tabular digit at the default font size. */
const ROW_NUMBER_DIGIT_PX = 9
/**
 * The narrowest the column is ever declared.
 *
 * Also the table's own default `minColumnWidth`, so a three-digit table gets
 * a column the resizer can actually reach back to rather than one the bounds
 * silently widen.
 */
const ROW_NUMBER_MIN_WIDTH_PX = 60
/** Digits assumed before a server has said how many rows there are. */
const ROW_NUMBER_UNKNOWN_DIGITS = 3

/**
 * How wide the column is declared, for the largest number it can print.
 *
 * A width, not a measurement: the number in the last row is the widest thing
 * the column will ever hold, and how many digits that is follows from the row
 * count alone. With no count yet — a server table before its first answer —
 * three digits is assumed, which is the width a page of fifty rows needs and
 * the one the column would otherwise flicker away from on the first response.
 *
 * The user's own width wins outright, as it does for every other column:
 * this is what a column that has never been resized is declared at, and a
 * drag writes `columnSizing` over it.
 *
 * @param rowCount - Rows across every page, or undefined while unknown.
 * @returns A width in pixels, never below {@link ROW_NUMBER_MIN_WIDTH_PX}.
 *
 * @example
 * rowNumberColumnWidth(100_000) // 74
 */
export function rowNumberColumnWidth(rowCount: number | undefined): number {
  const digits =
    rowCount === undefined || !Number.isFinite(rowCount) || rowCount < 1
      ? ROW_NUMBER_UNKNOWN_DIGITS
      : String(Math.floor(rowCount)).length
  return Math.max(ROW_NUMBER_MIN_WIDTH_PX, ROW_NUMBER_PADDING_PX + digits * ROW_NUMBER_DIGIT_PX)
}

/**
 * The row-number column's definition.
 *
 * A DISPLAY column — no accessor — which is not an implementation detail but
 * most of the specification: TanStack's own `column_getCanSort` and
 * `column_getCanFilter` both end in `!!column.accessorFn`, so a column with
 * no accessor is already unsortable and unfilterable and there is no flag
 * here restating it. The two that do not follow from that are stated:
 * hiding, because a tick that could remove the column would contradict the
 * `rowNumbers` flag that put it there, and pinning, because the column is
 * pinned to the start by derivation and an Unpin that the next render undid
 * would be worse than no Unpin at all.
 *
 * It renders nothing. The number belongs to the ROW — see
 * {@link rowNumberAt} — and a cell renderer is handed neither the row's
 * position on the page nor the page's own offset, so computing it here would
 * mean deriving the offset a second time from `row.index`, which means
 * something different in client mode than in server mode. `BodyRow` and
 * `GroupBodyRow` draw the number instead, from the two numbers they already
 * carry.
 *
 * @param width - What {@link rowNumberColumnWidth} answered for this table.
 * @returns A definition to put at the front of the table's columns.
 *
 * @example
 * const tableColumns = [rowNumberColumnDef<Row>(width), ...columns]
 */
export function rowNumberColumnDef<TData extends RowData>(
  width: number,
): ColumnDef<DataTableFeatures, TData, unknown> {
  return {
    id: ROW_NUMBER_COLUMN_ID,
    /*
     * Empty to the eye. The header's accessible name comes from the
     * `rowNumber` label instead — `HeaderCell` reads it — because this
     * definition is built in `useDataTable`, which speaks no labels: they are
     * a `<DataTable>` prop, and a column definition that had to be rebuilt
     * whenever the language changed would rebuild every column with it.
     */
    header: "",
    cell: () => null,
    size: width,
    enableHiding: false,
    enablePinning: false,
  }
}
