import { CodeBlock } from "../CodeBlock"
import type { DocTopic } from "../model"
import { Callout, ReadMore } from "../prose"

function CellEditing() {
  return (
    <>
      <p>
        A user right-clicks a body cell and chooses <strong>Edit</strong>. Enter or a click away saves, Escape
        cancels, Tab saves and moves to the next editable cell. A column opts in with <code>meta.editable</code>, and
        every commit goes to <code>onCellEdit</code> — you need both, or Edit stays disabled.
      </p>
      <CodeBlock
        language="tsx"
        code={`
const columns = [
  col.accessor("code", { header: "Code", meta: { editable: "text" } }),
  col.accessor("date", { header: "Date", meta: { editable: "date" } }),
  col.accessor("partner", {
    header: "Partner",
    meta: { editable: "list", values: PARTNERS.map((value) => ({ value })) },
  }),
  col.accessor("amount", {
    header: "Amount",
    meta: { editable: (row: Receipt) => row.status !== "closed" }, // this row decides
  }),
]

<DataTable
  instance={table}
  onCellEdit={async ({ row, columnId, value, previous }) => {
    await api.patch(\`/receipts/\${row.id}\`, { [columnId]: value })
    refetch()
  }}
/>`}
      />
      <p>
        The editor kinds are the filter kinds: <code>text</code>, <code>number</code>, <code>date</code>,{" "}
        <code>boolean</code>, <code>list</code>. The new value shows while your promise is pending; a rejection
        reverts it and shows the reason until dismissed. The table never writes to its own data.
      </p>
      <Callout tone="warning">
        Editing is pointer-only for now: a body cell cannot hold focus yet, so the ContextMenu key and Shift+F10 have
        nothing to open a menu on. Do not make cell editing the only way to do something a keyboard user must do.
      </Callout>
      <ReadMore anchor="editing-cells">Editing cells</ReadMore>
    </>
  )
}

function ExpandableRows() {
  return (
    <>
      <p>
        Two shapes, usable together. A <strong>detail panel</strong> under a row, which can hold anything — including
        another <code>{"<DataTable>"}</code> with its own <code>id</code>:
      </p>
      <CodeBlock language="tsx" code={"<DataTable instance={table} renderDetail={(row) => <MovementHistory sku={row.sku} />} />"} />
      <p>
        Or <strong>child rows</strong>, indented by depth, to any depth:
      </p>
      <CodeBlock language="ts" code={'useDataTable({ id: "bom", data, columns, getSubRows: (row) => row.children })'} />
      <p>
        <code>canExpand(row)</code> limits which rows may open a panel. Which rows are open is not saved with the
        layout — it is a reading position, not an arrangement.
      </p>
      <ReadMore anchor="expandable-rows">Expandable rows</ReadMore>
    </>
  )
}

function RowContextMenu() {
  return (
    <>
      <p>
        <code>onRowContextMenu</code> receives the row and the event when a data row is right-clicked — for a row
        menu of your own. Call <code>event.preventDefault()</code> when you open yours; leave the event alone and the
        browser's menu appears as usual.
      </p>
      <CodeBlock
        language="tsx"
        code={`
<DataTable
  instance={table}
  onRowContextMenu={(row, event) => {
    event.preventDefault()
    openRowMenu({ row, x: event.clientX, y: event.clientY })
  }}
/>`}
      />
      <p>
        Group rows and the totals row do not call it. <code>onRowClick(row)</code> is its left-click sibling.
      </p>
    </>
  )
}

function ToolbarSlots() {
  return (
    <>
      <p>Two slots put your own controls into the toolbar, one at each edge:</p>
      <CodeBlock
        language="tsx"
        code={`
<DataTable
  instance={table}
  toolbarContent={<ViewPicker />}                                  // beside the search
  toolbarActions={<button onClick={exportRows}>Export</button>}    // far right
/>`}
      />
      <p>
        With <code>toolbar={"{false}"}</code> neither renders and the row is yours: <code>QuickSearch</code>,{" "}
        <code>TablePagination</code>, <code>StatusBar</code>, <code>TotalsFooter</code> and <code>TableSideBar</code>{" "}
        are exported so you can rebuild it piece by piece.
      </p>
      <p>
        There is no built-in CSV export — in server mode the browser holds one page. Send{" "}
        <code>instance.query</code> to an endpoint that holds every row instead:
      </p>
      <CodeBlock
        language="ts"
        code={`
async function exportRows() {
  await fetch("/api/receipts/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // An export wants every matching row, not this page.
    body: JSON.stringify({ ...table.query, pagination: undefined }),
  })
}`}
      />
      <ReadMore anchor="your-own-buttons-in-the-toolbar">Your own buttons in the toolbar</ReadMore>
    </>
  )
}

/** The Features section's interaction topics, in the order the page shows them. */
export const interactionTopics: DocTopic[] = [
  { id: "cell-editing", title: "Cell editing", Body: CellEditing },
  { id: "expandable-rows", title: "Expandable rows", Body: ExpandableRows },
  { id: "row-context-menu", title: "Row context menu", Body: RowContextMenu },
  { id: "toolbar", title: "Toolbar slots", Body: ToolbarSlots },
]
