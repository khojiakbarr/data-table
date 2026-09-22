import type { Row, RowData } from "@tanstack/react-table"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import {
  cellEditKey,
  cellEditability,
  draftFromValue,
  isSameCell,
  nextEditableCell,
  resolveEditable,
  type CellEditHandler,
  type CellRef,
  type EditableKind,
  type NotEditableReason,
} from "./cellEditing"
import { columnLabel } from "./columnLabel"
import type { FilterValue, FilterValueOption } from "./filters"
import { isGroupRow } from "./grouping"
import { renderedLeafColumns } from "./pinning"
import type { ClampedPoint } from "./useClampedPlacement"
import { warnOnce } from "./warnOnce"
import type { DataTableFeatures, DataTableInstance } from "../useDataTable"
import type { DataTableLabels } from "../types"

/**
 * Everything the table does around one cell's editor: which cell the menu is
 * on, which cell the editor is on, what a committed value looks like while the
 * host's promise is in flight, and what to say when one of those goes wrong.
 *
 * It lives here rather than in `DataTable.tsx` for the ordinary reason — that
 * shell is already the largest file in the library and this is a feature's
 * worth of state — and for one that is particular to editing: almost none of
 * this is render logic. The editability of a cell is decided in a pointer
 * handler, the next cell to tab into in a key handler, and the retirement of
 * an optimistic value in an effect. A hook can hold all three and be read in
 * one sitting; spread through a 900-line component they could not be.
 */

/** The cell whose menu is open, and what that menu should offer. */
export interface OpenCellMenu {
  cell: CellRef
  /** Where the pointer was, in viewport pixels. */
  at: ClampedPoint
  /** Why Edit is disabled, or undefined when it is not. */
  notEditable?: NotEditableReason | undefined
  /**
   * The cell element the menu was opened on, so Escape can give the focus
   * back to it (WCAG 2.4.3).
   *
   * Taken from the event rather than looked up afterwards: at the moment the
   * menu opens, the DOM still holds the previous commit — the `tabIndex` that
   * makes the cell focusable is not on it yet — and a lookup would find
   * nothing. The element may be gone by the time the menu closes, which
   * `useMenuSurface` already checks for.
   */
  anchor: HTMLElement | null
}

/** The cell whose editor is open, with everything the editor was opened on. */
export interface OpenCellEditor<TData> {
  cell: CellRef
  /** The row itself, held so a commit does not have to find it again. */
  row: TData
  kind: EditableKind
  /**
   * What the cell held when this editor opened, captured here and never read
   * back — §4: a refetch between opening and committing must not rewrite what
   * the edit was "from".
   */
  previous: unknown
  /** The column's name, for the field's accessible name and for any notice. */
  name: string
  choices?: readonly FilterValueOption[] | undefined
}

/** Something the user needs to be told about an edit. */
export interface EditNotice {
  /** An error is announced assertively; anything else politely. */
  tone: "error" | "info"
  text: string
}

/** An optimistic value standing in for a cell's own. */
export interface CellOverride {
  value: unknown
  /** True while the host's promise is still in flight. */
  pending: boolean
}

/** One committed edit, while it is still standing in for the host's data. */
interface EditRecord {
  cell: CellRef
  kind: EditableKind
  name: string
  value: unknown
  previous: unknown
  pending: boolean
}

/** What one body cell needs from the feature. */
export interface CellEditing<TData extends RowData> {
  /**
   * Whether any column declared `editable`, and so whether a right-click on a
   * body cell has anything to offer.
   *
   * §2: the browser's own context menu is suppressed only when it does. A
   * table nobody asked to be editable keeps the menu the browser gives it.
   */
  enabled: boolean
  /** Right-click on a body cell. */
  onCellContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    row: Row<DataTableFeatures, TData>,
    columnId: string,
  ) => void
  /** The menu's state, or null while it is closed. */
  menu: OpenCellMenu | null
  /**
   * The cell that should be able to hold focus: the one a menu or an editor is
   * open on, or the one the last of either was open on.
   *
   * It outlives both on purpose. A body cell is not focusable by default, and
   * the focus is handed back as the menu or the editor UNMOUNTS — by which
   * commit a cell that was only focusable "while open" would already have
   * lost its `tabIndex` and refused the focus, dropping it on `<body>`. Only
   * ever one cell carries it, so the table gains no focusable cell it did not
   * need. `openEditorAt` keeps this in step with the editor, including across
   * a Tab hop to a different cell.
   */
  focusCell: CellRef | null
  /**
   * Give the hook the DOM node for the cell {@link focusCell} names, so a
   * closing editor can be handed the focus back once its own field is gone
   * (WCAG 2.4.3) — the same rule `useMenuSurface` applies when its menu
   * unmounts.
   *
   * `<BodyRow>` passes this as the `ref` on the one cell whose `tabIndex` it
   * sets to `-1` — the same cell `focusCell` names — and nothing on every
   * other cell, so only that one node is ever tracked.
   */
  registerFocusCell: (node: HTMLElement | null) => void
  /** The menu's Edit item was chosen. */
  openEditor: () => void
  closeMenu: () => void
  /** The editor's state, or null while no cell is being edited. */
  editor: OpenCellEditor<TData> | null
  /** The editor committed a value. */
  commit: (value: FilterValue | null) => void
  /** The editor was abandoned — Escape, or a commit that changed nothing. */
  cancel: () => void
  /**
   * The open editor's row left the DOM without the table closing it: the user
   * scrolled it out of a virtualised body, or a refetch took the row away.
   */
  abandon: (cell: CellRef) => void
  /** Tab inside an open editor: commit, then step to the next editable cell. */
  onEditorKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  /** An optimistic value for one cell, or undefined when its own value stands. */
  overrideOf: (rowId: string, columnId: string, own: unknown) => CellOverride | undefined
  notice: EditNotice | null
  dismissNotice: () => void
}

/** What {@link useCellEditing} is given. */
export interface CellEditingOptions<TData extends RowData> {
  instance: DataTableInstance<TData>
  /** The rows currently in the row model, in render order. */
  rows: Row<DataTableFeatures, TData>[]
  labels: DataTableLabels
  onCellEdit?: CellEditHandler<TData> | undefined
  /**
   * True while a column drag or a resize is running.
   *
   * §4: a right-click during a drag is part of the drag — the usual way out of
   * one — and must not open a menu on whatever cell the pointer happens to be
   * over.
   */
  busy: boolean
}

/**
 * Wire the cell menu, the cell editor and `onCellEdit` to one table.
 *
 * @param options - The instance, its rows, the labels, the host's handler and
 *   whether a drag is running.
 * @returns Everything `<DataTable>` and its body rows need; see {@link CellEditing}.
 *
 * @example
 * const editing = useCellEditing({ instance, rows, labels, onCellEdit, busy: isResizing })
 */
export function useCellEditing<TData extends RowData>({
  instance,
  rows,
  labels,
  onCellEdit,
  busy,
}: CellEditingOptions<TData>): CellEditing<TData> {
  const [menu, setMenu] = useState<OpenCellMenu | null>(null)
  const [focusCell, setFocusCell] = useState<CellRef | null>(null)
  const [editor, setEditor] = useState<OpenCellEditor<TData> | null>(null)
  const [edits, setEdits] = useState<ReadonlyMap<string, EditRecord>>(() => new Map())
  const [notice, setNotice] = useState<EditNotice | null>(null)

  /**
   * The DOM node for whichever cell {@link focusCell} currently names, kept by
   * `<BodyRow>` through {@link registerFocusCell}.
   *
   * A ref rather than state: nothing here needs to re-render when a click
   * moves the anchor from one cell to another, only to read the current node
   * at the moment an editor closes.
   */
  const anchorRef = useRef<HTMLElement | null>(null)
  const registerFocusCell = useCallback((node: HTMLElement | null) => {
    anchorRef.current = node
  }, [])

  /*
   * Latest-ref for everything that changes identity every render. `labels` is
   * rebuilt by `<DataTable>` on each one (`{ ...defaultLabels, ...overrides }`)
   * and so is the row array, so a callback that depended on either would be a
   * new function every render — and these callbacks are read from an effect
   * cleanup and from a blur handler, where a stale closure is not a
   * performance question but a correctness one.
   */
  const latest = useRef({ instance, rows, labels, onCellEdit, busy })
  latest.current = { instance, rows, labels, onCellEdit, busy }
  const editorRef = useRef(editor)
  editorRef.current = editor
  const editsRef = useRef(edits)
  editsRef.current = edits
  const menuRef = useRef(menu)
  menuRef.current = menu

  /**
   * Whether any column declared `editable` at all.
   *
   * Asked of the leaf columns rather than of the host's definitions so a
   * column added at runtime counts, and memoised on the column array because
   * a right-click is not the moment to walk every column definition.
   */
  const columns = instance.table.getAllLeafColumns()
  const enabled = useMemo(
    () =>
      columns.some((column) => {
        const declared = column.columnDef.meta?.editable
        return declared !== undefined && declared !== false
      }),
    [columns],
  )
  // Read by handlers that are created once and must not be rebuilt for it.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return
    if (!enabled || onCellEdit !== undefined) return
    warnOnce(
      `<DataTable> ("${instance.id}"): a column declares meta.editable but the table has no onCellEdit, ` +
        "so there is nowhere to send an edit. Pass onCellEdit, or drop meta.editable.",
    )
  }, [enabled, onCellEdit, instance.id])

  /**
   * An optimistic value for one cell, or undefined when the cell's own stands.
   *
   * A PENDING edit always shows: the write is still in flight and the value on
   * screen is the one the user asked for. A SETTLED one steps aside the moment
   * the host's own data moves off the value the editor opened with — which is
   * exactly the refetch a server-mode host runs after a successful write. That
   * is what keeps the optimistic value from fighting the answer that replaces
   * it (§3): whatever the server finally says is what renders, including a
   * value the server normalised into something else.
   */
  const overrideOf = useCallback(
    (rowId: string, columnId: string, own: unknown): CellOverride | undefined => {
      const record = editsRef.current.get(cellEditKey({ rowId, columnId }))
      if (record === undefined) return undefined
      if (!record.pending && !namesSameValue(own, record.previous, record.kind)) return undefined
      return { value: record.value, pending: record.pending }
    },
    [],
  )

  /**
   * Whether one cell can be edited, and why not when it cannot.
   *
   * Called from pointer and key handlers only, never during a render: a host's
   * `editable` predicate is host code, and running it on every cell of every
   * commit would make a table's render cost a function of how expensive
   * somebody else's rule is.
   */
  const editabilityOf = useCallback((row: Row<DataTableFeatures, TData>, columnId: string) => {
    const { instance: table, onCellEdit: handler } = latest.current
    // Answered before the predicate is reached, not merely before
    // `cellEditability` reports it: a group row is not one of the host's, and
    // handing one to `(row) => row.status !== "closed"` is how a predicate
    // throws on a shape it was never written for.
    if (isGroupRow(row.original)) return cellEditability({ declared: undefined, hasHandler: true, isGroupRow: true })
    const column = table.table.getColumn(columnId)
    /*
     * The grouped column has left the body: its cell on a record carries the
     * record's indent and no value at all (see `BodyRow`), so there is nothing
     * in it to edit whatever the column declared.
     */
    const isGroupColumn = table.grouping.isGrouped && columnId === table.grouping.columnId
    const { declared, rowAllows } = resolveEditable(
      isGroupColumn ? false : column?.columnDef.meta?.editable,
      { row: row.original, filterKind: table.filtering.kinds.get(columnId) },
    )
    return cellEditability({ declared, hasHandler: handler !== undefined, rowAllows })
  }, [])

  const onCellContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, row: Row<DataTableFeatures, TData>, columnId: string) => {
      // Nothing to offer, so nothing is taken away: the browser's own menu
      // opens over a table that was never made editable, and over one whose
      // drag the user is trying to escape from.
      if (!enabledRef.current || latest.current.busy) return
      event.preventDefault()
      const verdict = editabilityOf(row, columnId)
      setFocusCell({ rowId: row.id, columnId })
      setMenu({
        cell: { rowId: row.id, columnId },
        at: { x: event.clientX, y: event.clientY },
        anchor: event.currentTarget,
        ...(verdict.editable ? {} : { notEditable: verdict.reason }),
      })
    },
    [editabilityOf],
  )

  const closeMenu = useCallback(() => setMenu(null), [])

  /**
   * Open the editor on one cell, reading everything it needs to be opened
   * with — the kind, the value, the column's name and a list editor's choices.
   *
   * @returns Whether the cell turned out to be editable after all.
   */
  const openEditorAt = useCallback((cell: CellRef): boolean => {
    const { instance: table, rows: current } = latest.current
    const row = current.find((candidate) => candidate.id === cell.rowId)
    if (row === undefined || isGroupRow(row.original)) return false
    const verdict = editabilityOf(row, cell.columnId)
    if (!verdict.editable) return false
    const column = table.table.getColumn(cell.columnId)
    const own = cellValue(row, cell.columnId)
    // The value the user is looking at, which is the optimistic one when an
    // earlier edit to this cell has not been answered yet. Editing from the
    // stored value instead would silently undo it.
    const shown = overrideOf(cell.rowId, cell.columnId, own)
    setEditor({
      cell,
      row: row.original,
      kind: verdict.kind,
      previous: shown === undefined ? own : shown.value,
      name: columnLabel(cell.columnId, column?.columnDef.header),
      choices: column?.columnDef.meta?.values,
    })
    /*
     * Keeps `focusCell` — and so the anchor `registerFocusCell` tracks — on
     * the cell the editor is ACTUALLY open on. Without this a Tab hop (see
     * `settle` below) would leave both naming the cell the menu was first
     * opened on, and a later Escape would hand the focus back to the wrong
     * cell.
     */
    setFocusCell(cell)
    return true
  }, [editabilityOf, overrideOf])

  const openEditor = useCallback(() => {
    const open = menuRef.current
    if (open === null || open.notEditable !== undefined) return
    openEditorAt(open.cell)
  }, [openEditorAt])

  /**
   * Which way Tab is travelling, while the blur it triggered is committing.
   *
   * Null at every other moment. It is a ref and not state because it is set
   * and consumed inside one synchronous keydown — `field.blur()` runs the
   * editor's commit, which runs {@link settle}, which reads this.
   */
  const tabDirection = useRef<1 | -1 | null>(null)

  /**
   * What happens to the editor once it has committed or cancelled: it closes,
   * or Tab moves it on to the next editable cell.
   */
  const settle = useCallback(() => {
    const direction = tabDirection.current
    tabDirection.current = null
    const open = editorRef.current
    if (direction === null || open === null) {
      setEditor(null)
      return
    }
    const grid = editableGrid(latest.current.instance, latest.current.rows, editabilityOf)
    const target = nextEditableCell(grid, open.cell, direction)
    if (target === undefined || !openEditorAt(target)) setEditor(null)
  }, [editabilityOf, openEditorAt])

  const commit = useCallback(
    (value: FilterValue | null) => {
      const open = editorRef.current
      const handler = latest.current.onCellEdit
      settle()
      if (open === null || handler === undefined) return
      const key = cellEditKey(open.cell)
      const record: EditRecord = {
        cell: open.cell,
        kind: open.kind,
        name: open.name,
        value,
        previous: open.previous,
        pending: true,
      }
      setEdits((current) => new Map(current).set(key, record))

      const settled = (): void => {
        setEdits((current) => {
          const held = current.get(key)
          // Reconciliation may have retired the record already, and a second
          // edit to the same cell may have replaced it. Neither is ours to
          // mark settled.
          if (held !== record) return current
          return new Map(current).set(key, { ...record, pending: false })
        })
        // A success answers the failure the user was looking at. Anything else
        // they have not read yet stays until they dismiss it.
        setNotice((current) => (current?.tone === "error" ? null : current))
      }
      const failed = (reason: unknown): void => {
        setEdits((current) => {
          if (current.get(key) !== record) return current
          const next = new Map(current)
          next.delete(key)
          return next
        })
        const message = failureMessage(reason)
        const said = latest.current.labels.editFailed(open.name)
        setNotice({ tone: "error", text: message === "" ? said : `${said}: ${message}` })
      }

      let result: void | Promise<void>
      try {
        result = handler({
          row: open.row,
          columnId: open.cell.columnId,
          value,
          previous: open.previous,
        })
      } catch (reason: unknown) {
        // A handler that throws synchronously has refused the write as surely
        // as one that rejects, and the cell must revert either way.
        failed(reason)
        return
      }
      if (!isThenable(result)) {
        settled()
        return
      }
      result.then(settled, failed)
    },
    [settle],
  )

  const cancel = useCallback(() => {
    settle()
  }, [settle])

  const abandon = useCallback((cell: CellRef) => {
    const open = editorRef.current
    /*
     * The editor's row left the DOM. When the table closed it — a commit, a
     * cancel, a Tab onto the next cell — the state has already moved on by the
     * time this cleanup runs, and there is nothing to report. When it has not,
     * the row went away underneath an open editor, and §4 rules out losing the
     * typed value in silence.
     */
    if (!isSameCell(open?.cell, cell)) return
    setEditor(null)
    setNotice({ tone: "info", text: latest.current.labels.editCancelled(open?.name ?? cell.columnId) })
  }, [])

  /*
   * Hand the focus back to the cell an editor just closed on: `settle`
   * closing it outright (Escape, Enter with nothing left to Tab into), a
   * commit the host later rejects (already closed by the time `commit` calls
   * `settle`, so the revert itself needs no separate handling here), and
   * `abandon`. Watched on `editor` rather than called from each closer
   * directly so there is exactly one place this can happen from, and so it
   * runs after the closing cell's own re-render — with the editor's field
   * already gone and `tabIndex={-1}` already back on the `<td>` — rather than
   * racing that commit.
   *
   * Skipped on the transition INTO an open editor, and on every render where
   * one was already closed: `wasEditingRef` marks the ONE render where it
   * just went from open to closed.
   */
  const wasEditingRef = useRef(false)
  useEffect(() => {
    const wasOpen = wasEditingRef.current
    wasEditingRef.current = editor !== null
    if (editor !== null || !wasOpen) return
    const anchor = anchorRef.current
    /*
     * Not connected when the editor closed because its ROW left a
     * virtualised body (`abandon`) or was refetched away: there is no longer
     * a cell here to give the focus to, and focusing a detached node does
     * nothing — so the focus is left wherever the browser already put it
     * (ordinarily `<body>`, the same place it would have landed without this
     * effect) rather than this hook guessing at a replacement.
     */
    if (anchor !== null && anchor.isConnected) anchor.focus()
  }, [editor])

  const onEditorKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || event.nativeEvent.isComposing) return
    const field = event.target
    if (!(field instanceof HTMLElement)) return
    event.preventDefault()
    tabDirection.current = event.shiftKey ? -1 : 1
    /*
     * Blur is what commits (`CellEditor`, §3), so Tab blurs rather than
     * committing a second way of its own — one commit path, and the guard
     * against committing twice stays where it already is.
     */
    field.blur()
    if (tabDirection.current === null) return
    /*
     * `settle` did not run, so the editor refused the draft and stayed open.
     * §3: an invalid value does not commit, and Tab must not carry the focus
     * away from the field that is explaining why.
     */
    tabDirection.current = null
    field.focus()
  }, [])

  const dismissNotice = useCallback(() => setNotice(null), [])

  /*
   * Retire the optimistic values the host's own data has caught up with, and
   * say so when an edit moved its row out of the page.
   *
   * Keyed on `rows` alone: a new row array is the only thing that can change
   * either answer, and everything else this reads is on the latest-ref. A
   * pending record is never touched — its write is still in flight, and the
   * value on screen is the one the user asked for.
   */
  const pageRef = useRef(instance.pagination.pageIndex)
  useEffect(() => {
    const { instance: table, labels: said } = latest.current
    const samePage = pageRef.current === table.pagination.pageIndex
    pageRef.current = table.pagination.pageIndex

    const retired: EditRecord[] = []
    let vanished: EditRecord | undefined
    for (const record of editsRef.current.values()) {
      if (record.pending) continue
      const row = rows.find((candidate) => candidate.id === record.cell.rowId)
      if (row === undefined) {
        retired.push(record)
        /*
         * §4: an edit that changes what a filter matches takes its row out of
         * the result set on the next refetch. That is correct, and it looks
         * exactly like a row that disappeared for no reason — so it is said
         * out loud. Only for a refetch of the same page: a row is absent from
         * the next page for the ordinary reason too.
         */
        if (samePage && table.filtering.isFiltered && vanished === undefined) vanished = record
        continue
      }
      if (!namesSameValue(cellValue(row, record.cell.columnId), record.previous, record.kind)) {
        retired.push(record)
      }
    }
    if (retired.length === 0) return
    setEdits((current) => {
      const next = new Map(current)
      for (const record of retired) {
        if (next.get(cellEditKey(record.cell)) === record) next.delete(cellEditKey(record.cell))
      }
      return next
    })
    if (vanished !== undefined) setNotice({ tone: "info", text: said.editRowFiltered(vanished.name) })
  }, [rows])

  return {
    enabled,
    onCellContextMenu,
    menu,
    focusCell,
    registerFocusCell,
    openEditor,
    closeMenu,
    editor,
    commit,
    cancel,
    abandon,
    onEditorKeyDown,
    overrideOf,
    notice,
    dismissNotice,
  }
}

/**
 * One cell's value off a row, without `row.getValue`'s throw.
 *
 * `getValue` raises for a column with no accessor — a display column, and the
 * grouped column on a page that has one — and a retired optimistic value is
 * not worth a crash.
 */
function cellValue<TData extends RowData>(
  row: Row<DataTableFeatures, TData>,
  columnId: string,
): unknown {
  return row.getAllCells().find((cell) => cell.column.id === columnId)?.getValue()
}

/**
 * Whether two values name the same cell value, for this kind of editor.
 *
 * Compared through {@link draftFromValue} rather than with `Object.is`, for
 * the same reason `isUnchanged` is: a refetched Date is a new object holding
 * the same day, and an identity comparison would call that a change and retire
 * an optimistic value the server has not answered yet.
 */
function namesSameValue(a: unknown, b: unknown, kind: EditableKind): boolean {
  return draftFromValue(a, kind) === draftFromValue(b, kind)
}

/**
 * Every editable cell on the page, in render order.
 *
 * Built on demand — inside the Tab handler, once — rather than kept in state:
 * it is rows × columns host predicates, which is not a thing to run on every
 * render for a key nobody may ever press.
 */
function editableGrid<TData extends RowData>(
  instance: DataTableInstance<TData>,
  rows: Row<DataTableFeatures, TData>[],
  editabilityOf: (row: Row<DataTableFeatures, TData>, columnId: string) => { editable: boolean },
): CellRef[] {
  const columns = renderedLeafColumns(instance.table)
  const grid: CellRef[] = []
  for (const row of rows) {
    if (isGroupRow(row.original)) continue
    for (const column of columns) {
      if (editabilityOf(row, column.id).editable) grid.push({ rowId: row.id, columnId: column.id })
    }
  }
  return grid
}

/** Whether a value can be awaited, without assuming it is a native promise. */
function isThenable(value: unknown): value is PromiseLike<void> {
  if (typeof value !== "object" || value === null) return false
  const then: unknown = Reflect.get(value, "then")
  return typeof then === "function"
}

/**
 * A rejection rendered as text to put after "Could not save Amount".
 *
 * The same three-step read `TableStatus` does for the load error, including
 * the `try` around `String()`: a value made with `Object.create(null)` has no
 * `toString` to inherit, and a banner explaining a failed write must not fail
 * itself.
 */
function failureMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  if (typeof reason === "string") return reason
  try {
    return String(reason)
  } catch {
    return ""
  }
}
