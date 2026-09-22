import { flexRender, type CellContext, type Row, type RowData } from "@tanstack/react-table"
import type { CSSProperties } from "react"
import { isSameCell } from "../core/cellEditing"
import { classNames, insertAt } from "../core/classNames"
import { pinnedStyle } from "../core/pinning"
import { isRowNumberColumn, rowNumberAt } from "../core/rowNumbers"
import { isSelectionColumn } from "../core/selection"
import type { CellEditing } from "../core/useCellEditing"
import type { SelectionApi } from "../core/useSelection"
import type { DataTableFeatures } from "../useDataTable"
import type { DataTableLabels } from "../types"
import { CellEditor } from "./CellEditor"
import { DepthSpacer, ExpandToggle } from "./ExpandToggle"
import { SelectionCheckbox } from "./SelectionCheckbox"

interface BodyRowProps<TData extends RowData> {
  row: Row<DataTableFeatures, TData>
  /** Position among rows in render order; drives striping. */
  position: number
  /** Explicit height when the table has `getRowHeight`. */
  height?: number | undefined
  /** Header rows above the body, so `aria-rowindex` can count past them. */
  headerRowCount: number
  /**
   * Rows already on earlier pages, so `aria-rowindex` counts from the table
   * rather than restarting at the top of every page. Zero with pagination off.
   */
  rowIndexOffset: number
  /** Where the filler cell goes among the visible cells; see `fillerIndex`. */
  fillerAt: number
  labels: DataTableLabels
  /** Whether a detail panel can open under this row. */
  hasDetail: boolean
  /**
   * The column that holds the group values while the table is grouped, or
   * undefined when it is not. A record has nothing to show there — the column
   * it names left the body — so that cell carries the record's indent instead.
   */
  groupColumnId?: string | undefined
  /** How many grouping levels a record sits under, for its indent. */
  groupDepth?: number
  onRowClick?: ((row: TData) => void) | undefined
  /**
   * Cell editing, or undefined for a table that has none.
   *
   * One object rather than eight props: every cell asks it the same four
   * questions — is my menu open on me, is my editor, is my value standing in
   * for the host's, and what happens when I am right-clicked — and a row that
   * only forwards them has no business destructuring them.
   */
  editing?: CellEditing<TData> | undefined
  /**
   * The selection, for the one cell that draws a checkbox. Optional for the
   * reason `HeaderCell`'s own is: a shell that does not select rows mounts
   * this component unchanged.
   */
  selection?: SelectionApi | undefined
}

/**
 * One data row.
 *
 * The lead cell holds the expand toggle (or an indent spacer) beside the
 * value, in a flex wrapper INSIDE the cell: a `<td>` that is itself a flex
 * container cannot truncate its text with an ellipsis.
 *
 * Striping is keyed on `data-parity`, not `:nth-child`: with virtualisation
 * the DOM position of a row says nothing about its position in the data.
 * `aria-rowindex` says the same thing to assistive technology, which would
 * otherwise be told the table holds only the rows currently in the DOM.
 *
 * An explicit `height` also re-declares `--dt-row-height` on the row. The
 * stylesheet sizes cells from that token, and a `height` on the `<tr>` alone
 * is only a floor — a row asked to be shorter than the table's default would
 * render at the default while the virtualiser budgeted for the shorter one.
 */
export function BodyRow<TData extends RowData>({
  row,
  position,
  height,
  headerRowCount,
  rowIndexOffset,
  fillerAt,
  labels,
  hasDetail,
  groupColumnId,
  groupDepth = 0,
  onRowClick,
  editing,
  selection,
}: BodyRowProps<TData>) {
  const cells = row.getVisibleCells()
  const expandable = row.subRows.length > 0 || hasDetail
  const isExpanded = expandable && row.getIsExpanded()
  /*
   * The row's place in the whole result set, printed in the row-number cell
   * and — plus the header rows — announced as `aria-rowindex` below. One
   * expression for both: see {@link rowNumberAt}.
   */
  const number = rowNumberAt(position, rowIndexOffset)
  /*
   * Which cell leads the row's CONTENT, which is not always the first cell:
   * with `rowNumbers` on, the first cell is the number, and the expand toggle
   * belongs beside the row's first real value rather than beside its
   * position. Everything that used to ask `index === 0` asks this instead.
   */
  const leadIndex = cells.findIndex(
    (cell) => !isRowNumberColumn(cell.column.id) && !isSelectionColumn(cell.column.id),
  )

  const rendered = cells.map((cell, index) => {
    if (isSelectionColumn(cell.column.id)) {
      return (
        <td
          key={cell.id}
          className={classNames(
            "dt-td",
            "dt-selection-cell",
            cell.column.getIsPinned() && "dt-pinned",
          )}
          style={pinnedStyle(cell.column)}
          data-column-id={cell.column.id}
          /*
           * No cell menu, for the row-number column's reason: the column is
           * chrome and carries none of the host's data, so an Edit item here
           * would exist only to say no.
           */
        >
          {selection === undefined ? null : (
            <SelectionCheckbox
              checked={selection.isRowSelected(row.id)}
              label={labels.selectRow(number)}
              onChange={(selected) => selection.toggleRow(row.id, selected)}
            />
          )}
        </td>
      )
    }
    if (isRowNumberColumn(cell.column.id)) {
      return (
        <td
          key={cell.id}
          className={classNames("dt-td", "dt-row-number", cell.column.getIsPinned() && "dt-pinned")}
          style={pinnedStyle(cell.column)}
          data-column-id={cell.column.id}
          /*
           * No cell menu here, unlike every other cell: the column is chrome,
           * carries none of the host's data, and an Edit item explaining it
           * cannot be edited is a menu that exists only to say no.
           */
        >
          {number}
        </td>
      )
    }
    const isGroupCell = cell.column.id === groupColumnId
    const self = { rowId: row.id, columnId: cell.column.id }
    const isEditing = isSameCell(editing?.editor?.cell, self)
    /*
     * An optimistic value, while a write is in flight or while the host's own
     * data has not caught up with one that landed. Rendered THROUGH the
     * column's own cell renderer rather than beside it: a number column
     * formats its value and a status column translates it, and an optimistic
     * value shown raw would change how the cell reads as well as what it
     * says. Only the value the renderer is handed differs.
     */
    const override = isGroupCell ? undefined : editing?.overrideOf(row.id, cell.column.id, cell.getValue())
    const context = cell.getContext()
    /*
     * A grouped column has left the body: its value is on the group header
     * above, once, instead of being repeated on every record underneath. The
     * cell keeps its slot — the `<colgroup>` width and any pinned offset are
     * the column's, not the value's — and carries the record's indent, which
     * is what lines a record up under the group it belongs to.
     */
    const value = isGroupCell
      ? null
      : flexRender(
          cell.column.columnDef.cell,
          override === undefined ? context : withCellValue(context, override.value),
        )
    const content = isEditing && editing?.editor ? (
      <CellEditor
        kind={editing.editor.kind}
        value={editing.editor.previous}
        name={editing.editor.name}
        labels={labels}
        choices={editing.editor.choices}
        onCommit={editing.commit}
        onCancel={editing.cancel}
      />
    ) : (
      value
    )
    return (
      <td
        key={cell.id}
        className={classNames(
          "dt-td",
          cell.column.getIsPinned() && "dt-pinned",
          index === leadIndex && "dt-td-lead",
          isGroupCell && "dt-group-cell",
        )}
        style={pinnedStyle(cell.column)}
        data-column-id={cell.column.id}
        /*
         * A body cell is not in the Tab order — there is no cell focus model
         * yet — but the cell the menu was opened on has to be focusable for
         * Escape to give the focus back to it (WCAG 2.4.3), and `-1` is how a
         * programmatic focus target says so without joining the Tab order.
         */
        tabIndex={isSameCell(editing?.focusCell, self) ? -1 : undefined}
        /*
         * Handed to `useCellEditing` only for the one cell `focusCell` names,
         * so it has the DOM node to focus once a closing editor's own field is
         * gone (WCAG 2.4.3, the same rule `useMenuSurface` applies for the
         * menu). `openEditorAt` keeps `focusCell` in step with the editor
         * across a Tab hop, so this ref follows it there too.
         */
        ref={isSameCell(editing?.focusCell, self) ? editing?.registerFocusCell : undefined}
        data-dt-pending={override?.pending === true ? "" : undefined}
        /*
         * Tab out of an open editor commits it and moves on to the next
         * editable cell. Listened for here rather than in a wrapper element:
         * the event bubbles from the field, and a wrapper would be a box
         * inside the cell for the editor to be laid out against.
         */
        onKeyDown={isEditing ? editing?.onEditorKeyDown : undefined}
        onContextMenu={
          editing === undefined
            ? undefined
            : (event) => editing.onCellContextMenu(event, row, cell.column.id)
        }
      >
        {override?.pending === true ? <span className="dt-sr-only">{labels.editPending}</span> : null}
        {index === leadIndex || isGroupCell ? (
          <div className="dt-lead">
            {/*
              The detail/tree toggle belongs to the FIRST cell, the group
              indent to the group cell. They are usually different cells;
              when they are the same one both appear, toggle first, because
              each answers a different question about the row.
            */}
            {index === leadIndex &&
              (expandable ? (
                <ExpandToggle
                  expanded={isExpanded}
                  depth={row.depth}
                  /*
                   * Named with the row's own position, the way a GROUP row's
                   * toggle is named with its group. Both toggles answer "which
                   * row?" — a group row answers with its value, and a record
                   * row has no value of its own to give, so it answers with
                   * where it sits. `rowIndexOffset` counts the pages already
                   * behind this one, so the number is the row's place in the
                   * whole result and not in the fifty rows on screen. The
                   * colon form is `GroupBodyRow`'s, kept identical so the two
                   * read as one control rather than two.
                   */
                  label={`${isExpanded ? labels.collapseRow : labels.expandRow}: ${number}`}
                  onToggle={() => row.toggleExpanded()}
                />
              ) : (
                <DepthSpacer depth={row.depth} />
              ))}
            {isGroupCell ? <DepthSpacer depth={groupDepth} /> : null}
            <span className="dt-td-value">{content}</span>
          </div>
        ) : (
          content
        )}
      </td>
    )
  })

  return (
    <tr
      className={isExpanded ? "dt-tr dt-tr-expanded" : "dt-tr"}
      data-depth={row.depth}
      data-parity={position % 2 === 0 ? "even" : "odd"}
      aria-rowindex={number + headerRowCount}
      style={
        height === undefined
          ? undefined
          : ({ height, "--dt-row-height": `${height}px` } as CSSProperties)
      }
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
    >
      {insertAt(
        rendered,
        fillerAt,
        <td key="filler" className="dt-td dt-td-filler" role="presentation" />,
      )}
    </tr>
  )
}

/**
 * One cell's render context with a different value in it.
 *
 * What it is for: an optimistic value has to go through the COLUMN's own cell
 * renderer, or a number column stops formatting its value and a status column
 * stops translating it the moment a write is in flight — the cell would change
 * how it reads, not just what it says, and only while the server is thinking.
 *
 * Why it casts: TanStack types `getValue` as `Getter<TValue>`, which is a
 * GENERIC signature (`<T = TValue>() => T`) that no concrete function can
 * satisfy — the unsoundness is the library's own, and it is what lets a cell
 * renderer ask for its value as whatever type it declared. The value handed
 * back is the one this table put in, and the only caller is the renderer for
 * the very column it came from.
 */
function withCellValue<TData extends RowData>(
  context: CellContext<DataTableFeatures, TData, unknown>,
  value: unknown,
): CellContext<DataTableFeatures, TData, unknown> {
  const getter = <TValue,>(): TValue => value as TValue
  return { ...context, getValue: getter, renderValue: getter }
}
