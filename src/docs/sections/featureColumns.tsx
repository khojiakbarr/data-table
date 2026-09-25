import { CodeBlock } from "../CodeBlock"
import { NestedColumnsExample } from "../examples/NestedColumnsExample"
import nestedSource from "../examples/NestedColumnsExample.tsx?raw"
import { LiveExample } from "../LiveExample"
import type { DocTopic } from "../model"
import { ReadMore } from "../prose"

function NestedColumns() {
  return (
    <>
      <p>
        Use TanStack's <code>group()</code> helper, and wrap each group's children in <code>columns()</code> so every
        column keeps its own value type. Groups nest to any depth; a column above the deepest level spans down to
        meet the rows on its own.
      </p>
      <LiveExample title="Nested column groups with pinning" source={nestedSource} file="NestedColumnsExample.tsx">
        <NestedColumnsExample />
      </LiveExample>
      <p>
        A group header has no sort control, but it is dragged and resized as a unit: dragging its edge scales every
        column under it, and dragging the header moves the whole group. A group moves only among its siblings — it
        is never dropped inside another group.
      </p>
      <ReadMore anchor="nested-columns">Nested columns</ReadMore>
    </>
  )
}

function Pinning() {
  return (
    <>
      <p>
        Users pin a column from its header menu (right-click, or the ⋮ button) to the start edge, the end edge, or
        unpin it. Set a first-visit default with <code>initialLayout</code>:
      </p>
      <CodeBlock
        language="ts"
        code={'useDataTable({ id, data, columns, initialLayout: { columnPinning: { start: ["code"], end: ["status"] } } })'}
      />
      <p>
        Pinned columns stay put while the rest scroll, with a shadow at the seam. To tint pinned body cells apart
        from the scrolling ones, set <code>--dt-pinned-bg</code>. Turn pinning off with{" "}
        <code>features: {"{ pinning: false }"}</code>.
      </p>
    </>
  )
}

function Resizing() {
  return (
    <>
      <p>
        Drag a header's right edge to resize; double-click it to fit the column to its content. Every column is
        exactly as wide as it says — columns are never stretched to fill the container, and spare room goes to a
        blank filler column instead.
      </p>
      <ul>
        <li>
          Keyboard: with a resize handle focused, ← / → change the width by 10px, Shift for 50px, Enter fits.
        </li>
        <li>
          Bounds: <code>minColumnWidth</code> (60), <code>maxColumnWidth</code> (800), or a column's own{" "}
          <code>minSize</code> / <code>maxSize</code>. The default width is <code>defaultColumnWidth</code> (160).
        </li>
        <li>
          Right-to-left: pass <code>direction: "rtl"</code> so a drag away from the column widens it there too.
        </li>
        <li>
          Fitting measures the rows currently rendered — on a virtualised table, the current viewport.
        </li>
      </ul>
      <ReadMore anchor="column-widths">Column widths</ReadMore>
    </>
  )
}

function Reordering() {
  return (
    <>
      <p>
        Drag a header onto another; the column it will land on is outlined. The same move works from the keyboard in
        the side bar's <strong>Columns</strong> tab: focus a row's drag handle, press Space to pick it up, the arrows
        to move, Space to drop, Escape to cancel. Each position is announced.
      </p>
      <p>
        A move never crosses a group or pinning boundary. Turn it off with{" "}
        <code>features: {"{ reordering: false }"}</code>; the same flag shape turns off <code>sorting</code>,{" "}
        <code>resizing</code>, <code>pinning</code>, <code>hiding</code> and the <code>heightGrip</code>.
      </p>
    </>
  )
}

/** The Features section's column topics, in the order the page shows them. */
export const columnTopics: DocTopic[] = [
  { id: "nested-columns", title: "Nested columns", Body: NestedColumns },
  { id: "pinning", title: "Pinning", Body: Pinning },
  { id: "resizing", title: "Resizing", Body: Resizing },
  { id: "reordering", title: "Reordering", Body: Reordering },
]
