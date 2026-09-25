import { CodeBlock } from "../CodeBlock"
import { MinimalExample } from "../examples/MinimalExample"
import minimalSource from "../examples/MinimalExample.tsx?raw"
import { LiveExample } from "../LiveExample"
import type { DocSection } from "../model"
import { Callout, ReadMore } from "../prose"

function Install() {
  return (
    <>
      <p>
        Install the package with its two peer dependencies. It runs on React 18 or 19, with{" "}
        <code>@tanstack/react-table</code> v9 and <code>@tanstack/react-virtual</code> v3.
      </p>
      <CodeBlock language="bash" code="npm i @hojiakbar_dev/data-table @tanstack/react-table @tanstack/react-virtual" />
      <p>
        Import the stylesheet once, anywhere in your app. Every colour and size in it is a CSS custom property, so
        you restyle the table by setting tokens rather than by overriding selectors — see{" "}
        <a href="#tokens">Tokens</a>.
      </p>
      <CodeBlock language="ts" code={'import "@hojiakbar_dev/data-table/styles.css"'} />
    </>
  )
}

function FirstTable() {
  return (
    <>
      <p>
        <code>useDataTable</code> builds the table from your rows and TanStack column definitions;{" "}
        <code>{"<DataTable>"}</code> renders it. This one is live — sort a header, drag one onto another, resize an
        edge, or open the ⋮ menu.
      </p>
      <LiveExample title="A minimal table" source={minimalSource} file="MinimalExample.tsx">
        <MinimalExample />
      </LiveExample>
      <ul>
        <li>
          <code>id</code> is required. It is the key the layout is saved under, so two tables on one page must not
          share one.
        </li>
        <li>
          <code>height</code> gives the rows something to scroll in. Rows are virtualised, and without a height — on
          the table or on an ancestor — every row goes into the DOM. See <a href="#large-data">Large data</a>.
        </li>
        <li>
          This table is in client mode: it sorts and filters the rows it was given. For a backend that pages, set{" "}
          <code>mode: "server"</code> — see <a href="#table-query">The query contract</a>.
        </li>
      </ul>
    </>
  )
}

function Persistence() {
  return (
    <>
      <p>
        Nothing is stored by default; a table resets when it unmounts. Pass <code>storage</code> to keep column
        order, widths, pinning, visibility, sorting, filters and page size between visits:
      </p>
      <CodeBlock
        language="tsx"
        code={`
import { localStorageLayout } from "@hojiakbar_dev/data-table"

useDataTable({ id: "receipts", data, columns, storage: localStorageLayout() })`}
      />
      <p>
        For layouts that follow a user across devices, pass any object with <code>load</code>, <code>save</code>{" "}
        and <code>clear</code>. <code>load</code> runs once on mount and must be synchronous, so fetch the layout
        with the rest of your page data and read it from a cache. <code>save</code> runs a short while after the
        user's last change — never on mount, never per frame of a drag.
      </p>
      <CodeBlock
        language="tsx"
        code={`
const serverLayout: LayoutStorage = {
  load: (id) => cache.get(id) ?? null,
  save: (id, layout) => { void fetch(\`/api/table-layout/\${id}\`, { method: "PUT", body: JSON.stringify(layout) }) },
  clear: (id) => { void fetch(\`/api/table-layout/\${id}\`, { method: "DELETE" }) },
}`}
      />
      <p>
        A stored layout that names a column you have since removed is cleaned on load, and new columns are appended.
        To keep filters and the search box out of storage, pass <code>filtering: {"{ persist: false }"}</code>.
      </p>
      <ReadMore anchor="persistence">Persistence</ReadMore>
    </>
  )
}

function LargeData() {
  return (
    <>
      <p>
        Only the rows in view, plus a few either side, are in the DOM. Row height is known up front —{" "}
        <code>rowHeight</code> (default 40) or <code>getRowHeight(row)</code> — so the scrollbar is exact without
        measuring. Pass <code>virtualize={"{false}"}</code> to render every row, for printing or a very small table.
      </p>
      <CodeBlock
        language="tsx"
        code={`
useDataTable({ id: "receipts", data, columns, rowHeight: 32 })

<DataTable instance={table} height={520} />            // the table's own box
<div style={{ height: "100%" }}><DataTable … /></div>  // or an ancestor's`}
      />
      <Callout tone="warning">
        Set the row height through <code>rowHeight</code> or <code>getRowHeight</code>, not with CSS.{" "}
        <code>{"<DataTable>"}</code> writes <code>--dt-row-height</code> inline on its root so the virtualiser and
        the stylesheet never disagree, and an inline style beats your stylesheet rule.
      </Callout>
      <p>
        If <code>getRowHeight</code> can change its answer for a narrow run of rows, pass a{" "}
        <code>heightVersion</code> that changes with it.
      </p>
      <ReadMore anchor="large-data">Large data</ReadMore>
    </>
  )
}

export const gettingStarted: DocSection = {
  id: "getting-started",
  title: "Getting started",
  summary: "Install the package, render a first table, and keep its layout between visits.",
  topics: [
    { id: "install", title: "Install", Body: Install },
    { id: "first-table", title: "Your first table", Body: FirstTable },
    { id: "persistence", title: "Saving the layout", Body: Persistence },
    { id: "large-data", title: "Large data", Body: LargeData },
  ],
}
