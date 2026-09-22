import type { Column, RowData } from "@tanstack/react-table"
import type { DataTableFeatures } from "../useDataTable"

/**
 * The column tree, rebuilt from the flat order the table renders in.
 *
 * TanStack keeps the nesting on the columns themselves — every leaf knows its
 * `parent`, and a group knows its children — but the panel cannot walk down
 * from `table.getAllColumns()`: that is declaration order, and the order the
 * table actually renders in is a different thing the moment anything is
 * reordered or pinned. So the tree is rebuilt UPWARDS instead, from the
 * rendered leaf order, by reading each leaf's ancestor chain and closing a
 * group as soon as the next leaf no longer belongs to it.
 *
 * Building it that way is not a shortcut, it is the only reading that matches
 * the header. TanStack splits a group whose leaves are no longer adjacent —
 * pin one leaf of a group and its header is drawn twice, once over the pinned
 * part and once over the rest (see `GroupedHeaders.test.tsx`). Grouping
 * consecutive runs reproduces exactly that, EXCEPT that "consecutive" is not
 * just adjacent in the array: the header renders one section (start-pinned,
 * centre, end-pinned) at a time, so a group whose leaves fall in two sections
 * is drawn twice even when nothing else sits between them in the flat leaf
 * order — the boundary itself has no entry of its own to make it visible.
 * `buildColumnTree` reads each leaf's OWN pin state for exactly that reason,
 * closing every open group on a section change even where the ancestor
 * chains still match, which is what keeps the panel and the header agreeing
 * about how many groups there are and where they start.
 */

type AnyColumn<TData extends RowData> = Column<DataTableFeatures, TData, unknown>

/**
 * One leaf column, at its place in the tree.
 *
 * No flat position is carried. There used to be an `index` here, described
 * first as the order reordering works in and then, once that was corrected,
 * as the flat leaf position — and by then nothing read it: a drag is a move
 * among siblings, so both the panel and the header resolve one against
 * {@link siblingOrderOf}. A caller that genuinely wants the flat position can
 * take it from the array `buildColumnTree` was given.
 */
export interface ColumnTreeLeaf<TData extends RowData> {
  kind: "leaf"
  column: AnyColumn<TData>
}

/** One group header, with whatever stands under it. */
export interface ColumnTreeGroup<TData extends RowData> {
  kind: "group"
  column: AnyColumn<TData>
  /**
   * What collapsed state is remembered against: the group column's own id.
   *
   * Per group, not per run. A group split by pinning is drawn twice and both
   * halves are the same group to the user, so collapsing either collapses the
   * group — the alternative is two rows with one name that disagree.
   */
  key: string
  /** Distinct per RUN, for a React key and DOM ids that survive a split group. */
  runKey: string
  /** Where this run's first leaf sits in the flat order. */
  index: number
  children: ColumnTreeNode<TData>[]
}

/** A row of the tree: a leaf column, or a group with its own children. */
export type ColumnTreeNode<TData extends RowData> =
  | ColumnTreeLeaf<TData>
  | ColumnTreeGroup<TData>

/**
 * A leaf's groups, outermost first.
 *
 * @param column - Any leaf column.
 * @returns Its ancestor group columns, root group first, immediate parent last.
 */
function ancestorsOf<TData extends RowData>(column: AnyColumn<TData>): AnyColumn<TData>[] {
  const chain: AnyColumn<TData>[] = []
  for (let parent = column.parent; parent; parent = parent.parent) chain.unshift(parent)
  return chain
}

/** Which section — start-pinned, centre, or end-pinned — draws this leaf. */
function pinSectionOf<TData extends RowData>(column: AnyColumn<TData>): "start" | "center" | "end" {
  const pinned = column.getIsPinned()
  return pinned === "start" || pinned === "end" ? pinned : "center"
}

/**
 * Rebuild the column tree from the order the table renders in.
 *
 * Nesting is honoured to whatever depth the columns declare: the depth comes
 * from each leaf's own ancestor chain, so nothing here assumes one level.
 *
 * @param leaves - Leaf columns, left to right, hidden ones included. Hidden
 *   leaves must be in the list or a group whose children are all hidden would
 *   vanish from the panel — taking with it the only control that shows them
 *   again.
 * @returns The top-level nodes, in the same left-to-right order.
 *
 * @example
 * buildColumnTree(orderedLeafColumns(table))
 * // [{ kind: "group", key: "document", children: [leaf, leaf] }, leaf]
 */
export function buildColumnTree<TData extends RowData>(
  leaves: readonly AnyColumn<TData>[],
): ColumnTreeNode<TData>[] {
  const roots: ColumnTreeNode<TData>[] = []
  /** The groups currently open, outermost first. */
  const open: ColumnTreeGroup<TData>[] = []
  /** The previous leaf's own section, to notice a boundary the leaves alone do not show. */
  let previousSection: "start" | "center" | "end" | null = null

  leaves.forEach((column, index) => {
    const section = pinSectionOf(column)
    /*
     * Force every open group shut on a section change, even where the
     * ancestor chain below would otherwise still match: start, centre and
     * end are rendered as separate header rows, so a group whose leaves
     * straddle that boundary is drawn twice there regardless of whether
     * anything else sits between them in this flat list (Defect E).
     */
    if (previousSection !== null && section !== previousSection) open.length = 0
    previousSection = section

    const path = ancestorsOf(column)

    // How much of the open chain this leaf still belongs to. Compared by
    // identity: two runs of one split group are the same column object, and
    // it is the position in the chain that tells them apart.
    let shared = 0
    while (
      shared < open.length &&
      shared < path.length &&
      open[shared]?.column === path[shared]
    ) {
      shared += 1
    }
    open.length = shared

    for (let depth = shared; depth < path.length; depth += 1) {
      const group = path[depth]
      if (!group) continue
      const node: ColumnTreeGroup<TData> = {
        kind: "group",
        column: group,
        key: group.id,
        runKey: `${group.id}#${index}`,
        index,
        children: [],
      }
      ;(open[depth - 1]?.children ?? roots).push(node)
      open.push(node)
    }

    const leaf: ColumnTreeLeaf<TData> = { kind: "leaf", column }
    ;(open[open.length - 1]?.children ?? roots).push(leaf)
  })

  return roots
}

/**
 * Every leaf column under a node, left to right.
 *
 * Read from the tree rather than from `column.getLeafColumns()`, so a group
 * split across a pinning boundary answers for ITS OWN run: ticking the half
 * of "Document" that stands over the pinned columns must not also show the
 * half that does not.
 *
 * @param node - A leaf or a group.
 * @returns The leaf columns it stands over; itself, for a leaf.
 */
export function leafColumnsOfNode<TData extends RowData>(
  node: ColumnTreeNode<TData>,
): AnyColumn<TData>[] {
  if (node.kind === "leaf") return [node.column]
  return node.children.flatMap(leafColumnsOfNode)
}

/**
 * The nodes standing at one column's own level, in render order.
 *
 * A drag is always a move among siblings — that is what `dropRegionOf` allows
 * and nothing else — so the order a drop slot is resolved against is this one,
 * not the flat run of leaves. For a leaf inside a group it is that group's
 * children; for a group it is whatever stands beside the group. Resolving a
 * group's drop in the leaf order instead would answer with a leaf halfway
 * through the group being moved, because the arithmetic would be measuring a
 * six-column move against one-column steps.
 *
 * @param nodes - The tree, from {@link buildColumnTree}.
 * @param columnId - The column whose level is wanted — a leaf or a group.
 * @returns The column ids at that level, left to right; empty when the column
 *   is not in this tree at all (hidden, or from another table).
 *
 * @example
 * siblingOrderOf(tree, "document") // ["id", "document", "payment"]
 * siblingOrderOf(tree, "number")   // ["number", "date"]
 */
export function siblingOrderOf<TData extends RowData>(
  nodes: readonly ColumnTreeNode<TData>[],
  columnId: string,
): string[] {
  const ids = nodes.map((node) => node.column.id)
  if (ids.includes(columnId)) return ids
  for (const node of nodes) {
    if (node.kind !== "group") continue
    const level = siblingOrderOf(node.children, columnId)
    if (level.length > 0) return level
  }
  return []
}

/** What a group's checkbox shows. */
export interface GroupVisibility {
  /** True only when every leaf under the group is visible. */
  checked: boolean
  /**
   * Some but not all. A DOM property, never an attribute and not reachable
   * from CSS, so whatever renders this has to put it on the element itself.
   */
  indeterminate: boolean
}

/**
 * Whether a group reads as shown, hidden, or partly shown.
 *
 * @param leaves - The leaf columns under the group.
 * @returns The checkbox state. An empty group is unchecked and determinate,
 *   which is the only answer that does not claim something about no columns.
 *
 * @example
 * const { checked, indeterminate } = groupVisibility(leafColumnsOfNode(node))
 */
export function groupVisibility<TData extends RowData>(
  leaves: readonly AnyColumn<TData>[],
): GroupVisibility {
  const visible = leaves.filter((leaf) => leaf.getIsVisible()).length
  return {
    checked: leaves.length > 0 && visible === leaves.length,
    indeterminate: visible > 0 && visible < leaves.length,
  }
}
