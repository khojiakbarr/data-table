import { CodeBlock } from "../CodeBlock"
import type { DocSection } from "../model"
import { Callout, ReadMore, RefTable } from "../prose"

function TableQueryTopic() {
  return (
    <>
      <p>
        With <code>mode: "server"</code> the table stops sorting and paging. <code>data</code> is one page, already
        sorted, and the table tells you what it wants through a <code>TableQuery</code> — sorting, filters, quick
        search, row grouping and pagination — handed to <code>onQueryChange</code>. With TanStack Query:
      </p>
      <CodeBlock
        language="tsx"
        code={`
const EMPTY: Receipt[] = [] // stable identity: an empty page is not a new array every render
const [query, setQuery] = useState<TableQuery>()
const { data, isFetching, error, refetch } = useQuery({
  queryKey: ["receipts", query],
  queryFn: () => api.receipts(query!),
  enabled: query !== undefined,
  placeholderData: keepPreviousData,
})
const table = useDataTable({
  id: "receipts",
  columns,
  mode: "server",
  data: data?.rows ?? EMPTY,
  rowCount: data?.total,      // undefined until the first answer
  getRowId: (row) => row.id,
  onQueryChange: setQuery,
})

<DataTable instance={table} loading={isFetching} error={error} onRetry={refetch} />`}
      />
      <ul>
        <li>
          <code>onQueryChange</code> fires once on mount with the persisted sorting and page size, then on every
          change. <code>instance.query</code> holds the same object and changes identity only when its contents do.
        </li>
        <li>
          Pagination is on by default in server mode. Change it with{" "}
          <code>pagination: {"{ pageSize: 100, pageSizeOptions: [50, 100, 500] }"}</code>.
        </li>
        <li>
          <code>loading</code> with no rows shows skeleton rows; with rows it shows a progress bar. <code>error</code>{" "}
          shows a banner whose Retry calls <code>onRetry</code>.
        </li>
        <li>
          The empty state waits for your first answer — rows, a <code>rowCount</code> (<code>0</code> counts), an{" "}
          <code>error</code>, or <code>loading</code> turning true — so a server table never flashes "No rows"
          before its first skeleton.
        </li>
        <li>
          Optionally return <code>unfilteredTotal</code> — the count before filters and search — for the status
          bar's "X of Y".
        </li>
      </ul>
      <ReadMore anchor="server-side-data">Server-side data</ReadMore>
    </>
  )
}

const OPERATORS = [
  ["contains / notContains", "text", "Substring, case-insensitive"],
  ["equals / notEquals", "text", "Whole value, case-insensitive"],
  ["startsWith / endsWith", "text", "Case-insensitive"],
  ["eq ne lt lte gt gte", "number", "Comparison"],
  ["between", "number", <>Inclusive on both ends; <code>null</code> is unbounded</>],
  ["range", "date", <><code>from {"<="} value {"<"} before</code>; either bound may be <code>null</code></>],
  ["is", "boolean", "Equality"],
  ["in / notIn", "list", "Membership"],
  ["blank / notBlank", "every kind", "Nullish or empty, and its complement"],
] as const

function FiltersOnTheWire() {
  return (
    <>
      <p>
        A filter is a value you translate into SQL without interpreting anything. <code>filters</code> is a flat
        array, implicitly ANDed and sorted by <code>field</code>, so a column drag never changes the query string.
      </p>
      <CodeBlock
        language="json"
        title="query"
        code={`
{
  "sorting": [{ "id": "created", "desc": true }],
  "filters": [
    { "kind": "number", "field": "amount",  "op": "between",  "from": 1000000, "to": null },
    { "kind": "date",   "field": "created", "op": "range",    "from": "2026-03-01", "before": "2026-04-01" },
    { "kind": "text",   "field": "partner", "op": "contains", "value": "agro" },
    { "kind": "list",   "field": "status",  "op": "in",       "values": ["in_process", "open"] }
  ],
  "search": { "text": "KR-102", "fields": ["code", "partner", "status"] },
  "grouping": [],
  "expanded": [],
  "pagination": { "pageIndex": 0, "pageSize": 50 }
}`}
      />
      <RefTable
        caption="Filter operators"
        head={["Operator", "On", "Means"]}
        rows={OPERATORS.map(([op, on, means]) => [op, on, means])}
      />
      <p>The vocabulary is closed, and four rules are easy to get wrong:</p>
      <ol>
        <li>
          <strong>All six text operators are case-insensitive</strong>, <code>equals</code> included.
        </li>
        <li>
          <strong>
            <code>between</code> is inclusive on both ends.
          </strong>
        </li>
        <li>
          <strong>Negated operators never match a blank value</strong>, and neither do the number comparators.{" "}
          <code>blank</code> and <code>notBlank</code> partition every row:
        </li>
      </ol>
      <CodeBlock
        language="sql"
        code={`
-- blank
(col IS NULL OR col::text = '')
-- notBlank
(col IS NOT NULL AND col::text <> '')`}
      />
      <ol start={4}>
        <li>
          <strong>A date range is half-open</strong>: <code>from</code> inclusive, <code>before</code> exclusive. It
          is correct for both <code>date</code> and <code>timestamptz</code> columns:
        </li>
      </ol>
      <CodeBlock
        language="sql"
        code={`
(:from   IS NULL OR created >= :from)
AND (:before IS NULL OR created <  :before)`}
      />
      <p>
        <strong>Quick search is AND over tokens, OR over fields.</strong> Split <code>search.text</code> on
        whitespace; every token must appear, case-insensitively, in at least one of <code>search.fields</code>. Mark
        unindexed or sensitive columns <code>meta: {"{ searchable: false }"}</code> so they never reach{" "}
        <code>fields</code>. The published search is debounced by <code>filtering.debounceMs</code> (300 ms); column
        filters are not.
      </p>
      <Callout>
        Build conditions with the exported constructors — <code>textCondition</code>, <code>numberCondition</code>,{" "}
        <code>dateCondition</code>, <code>booleanCondition</code>, <code>listCondition</code> — never by hand. They
        fix key order and sort values, which <code>instance.query</code>'s identity depends on.
      </Callout>
      <p>
        <code>meta.filter</code> picks a column's editor (<code>"text"</code>, <code>"number"</code>,{" "}
        <code>"date"</code>, <code>"boolean"</code>, <code>"list"</code>, or <code>false</code>). Without it the kind
        is inferred from the column's first non-null value. A list filter's choices come from{" "}
        <code>meta.values</code>, else the data (client mode), else <code>filtering.loadValues</code> (server mode).
      </p>
      <ReadMore anchor="filters-on-the-wire">Filters on the wire</ReadMore>
    </>
  )
}

function HostFilters() {
  return (
    <>
      <p>
        If your endpoint takes a few fixed parameters instead of conditions, turn the column filters off with{" "}
        <code>meta: {"{ filter: false }"}</code> and draw your own fields inside the side bar's Filters tab:
      </p>
      <CodeBlock
        language="tsx"
        code={`
<DataTable
  instance={table}
  filtersPanel={{
    content: <RolePicker value={roleId} onChange={setRoleId} />,
    activeCount: roleId ? 1 : 0,
  }}
/>`}
      />
      <p>
        Your fields apply however you make them apply; reset the page when they change with{" "}
        <code>instance.pagination.resetPage()</code>. <code>activeCount</code> is shown on the rail's Filters tab
        while above zero.
      </p>
      <ReadMore anchor="your-own-filters-in-the-filters-tab">Your own filters in the Filters tab</ReadMore>
    </>
  )
}

function RowGrouping() {
  return (
    <>
      <p>
        Users group rows by dragging a column into the <strong>Row groups</strong> zone of the side panel, or from the
        keyboard. Grouping is computed by your server — grouping one page of fifty would present a partial answer as
        the whole table — so it exists only in server mode. Two fields go out:
      </p>
      <CodeBlock
        language="json"
        title="query"
        code={`
{
  "grouping": ["status", "partner"],
  "expanded": [["received"], ["received", "Toshkent Kimyo Zavodi"]]
}`}
      />
      <p>
        <code>grouping</code> is outermost first. <code>expanded</code> is the key paths of the groups the user has
        opened. Answer with a page of the <em>flattened visible rows</em>: your records interleaved with group
        headers, in visible order.
      </p>
      <CodeBlock
        language="ts"
        code={`
interface GroupRow {
  kind: "group"
  path: (string | number | boolean)[] // the group's key path, outermost first
  count: number                       // leaf rows under it, at every depth
}

useDataTable({ mode: "server", data: page.rows, rowCount: page.total, startPath: page.startPath, … })`}
      />
      <ul>
        <li>
          <code>rowCount</code> counts the whole flattened list, group headers included.
        </li>
        <li>
          <code>startPath</code> is the open group the page's first row sits inside (<code>[]</code> at the top
          level), so the table can draw a "continued" header when a page boundary falls inside a group.
        </li>
        <li>
          <code>kind: "group"</code> is reserved. The table hands a group row to none of your callbacks.
        </li>
      </ul>
      <p>
        Filter and search first, then group, then sort within a level, then flatten against the open paths, then
        page. A blank key is one group, keyed by <code>""</code>:
      </p>
      <CodeBlock
        language="sql"
        code={`
SELECT COALESCE(NULLIF(status::text, ''), '') AS key, COUNT(*) AS count
FROM receipts
WHERE <the filters and the search>
GROUP BY 1
ORDER BY (key = ''), key`}
      />
      <p>
        From code: <code>instance.grouping.add("status")</code>, <code>.toggle(["received"])</code>,{" "}
        <code>.clear()</code>. Grouping and its open groups are saved with the layout.
      </p>
      <ReadMore anchor="row-grouping">Row grouping</ReadMore>
    </>
  )
}

function GroupingFlag() {
  return (
    <>
      <p>
        If your list endpoint cannot group at all, turn the feature off so the table never offers a Row groups zone
        your backend cannot answer:
      </p>
      <CodeBlock
        language="ts"
        code={'useDataTable({ id: "receipts", data, columns, mode: "server", features: { grouping: false } })'}
      />
      <p>
        With it off there is no zone and no per-column group toggle, and <code>query.grouping</code> and{" "}
        <code>query.expanded</code> stay <code>[]</code>. It defaults to <code>true</code>. A grouping already saved in
        storage is kept, and picked back up if you turn the flag on again.
      </p>
    </>
  )
}

export const serverSide: DocSection = {
  id: "server-side",
  title: "Server-side data",
  summary: "Let your backend page, sort, filter and group — the table only describes what it wants.",
  topics: [
    { id: "table-query", title: "The query contract", Body: TableQueryTopic },
    { id: "filters-on-the-wire", title: "Filters on the wire", Body: FiltersOnTheWire },
    { id: "host-filters", title: "Your own filters", Body: HostFilters },
    { id: "row-grouping", title: "Row grouping", Body: RowGrouping },
    { id: "grouping-flag", title: "Turning grouping off", Body: GroupingFlag },
  ],
}
