import type { FilterCondition, FilterValue, FilterValueOption } from "../core/filters"
import type { GroupRow } from "../core/grouping"
import type { TableQuery, TableSearch } from "../core/query"
import type { Language } from "./playgroundState"
import { STATUS_LABELS } from "./statusLabels"

/*
 * A group header is the LIBRARY's shape, re-exported here so this file's own
 * tests and the playground read it from the endpoint they are testing. It was
 * declared here first, on purpose: implementing grouping on the fake server
 * before the library is what let the wire be validated by something that
 * actually had to answer it — and `startPath` below is the field that work
 * turned up. The library has since adopted it verbatim.
 */
export { isGroupRow, type GroupRow } from "../core/grouping"

/**
 * One row as the fake backend would return it.
 *
 * `partner` and `amount` are nullable on purpose. A schema where every column
 * is NOT NULL can never exercise the rule the whole filter contract turns on —
 * that a blank value matches no operator except `blank`, negated operators
 * included — so the playground would demonstrate a filter model strictly
 * easier than the one a real host has.
 */
export interface ServerReceipt {
  id: string
  code: string
  partner: string | null
  amount: number | null
  status: string
  date: string
  /** Demonstrates the boolean filter kind end to end. */
  flagged: boolean
}

/**
 * The partners the generated rows are spread across.
 *
 * Exported because the playground's `partner` column edits as a LIST, and a
 * list editor's choices come from `meta.values` — the only source it has. A
 * facet endpoint answers the filter's question ("which values exist, and how
 * many rows have each"), not the editor's ("which values may I write").
 */
export const PARTNERS = ["Oʻzbekiston Temir Yoʻllari", "Gʻallaorol Agro MChJ", "ООО «Северный Путь»", "Toshkent Kimyo Zavodi"]
const STATUSES = ["open", "in_process", "received", "closed"]

/**
 * How many rows the playground holds.
 *
 * Large enough that virtualisation is the only thing keeping the DOM small —
 * the point the playground exists to demonstrate — rather than a token amount
 * that would render fine unvirtualised too.
 */
const ROW_COUNT = 100_000

/**
 * The two shapes of blankness, spread on a period of ten.
 *
 * Both forms the contract counts as blank appear — SQL `NULL` and the empty
 * string — because a host that only ever sees one of them will write a check
 * that misses the other. A period of ten means any contiguous run of ten rows
 * contains exactly the same blanks, so a test can scope to the first ten and
 * still be reasoning about the whole table's proportions.
 */
const NULL_PARTNER_IN_TEN = 5
const EMPTY_PARTNER_IN_TEN = 6
const NULL_AMOUNT_IN_TEN = 8

/** Generated once at module scope, never inside a component. */
const ALL: ServerReceipt[] = Array.from({ length: ROW_COUNT }, (_, index) => {
  const inTen = index % 10
  return {
    id: `rc-${index}`,
    code: `KR-${10_000 + index}`,
    partner:
      inTen === NULL_PARTNER_IN_TEN
        ? null
        : inTen === EMPTY_PARTNER_IN_TEN
          ? ""
          : (PARTNERS[index % PARTNERS.length] as string),
    amount: inTen === NULL_AMOUNT_IN_TEN ? null : ((index * 918_233) % 210_000_000) + 310_000,
    status: STATUSES[index % STATUSES.length] as string,
    date: `2026-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
    flagged: index % 7 === 0,
  }
})

/**
 * One row of a flattened page: a group header, or an ordinary leaf.
 *
 * The union is the price of the flat page, and it is not free — every consumer
 * of `rows` has to narrow before it can read a field, and a grouped page has
 * no `id` on half its rows for `getRowId` to return. The library carries that
 * cost where it belongs: it recognises a group row itself and hands one to no
 * host callback, so the playground's columns still read `ServerReceipt`.
 */
export type ServerRow = ServerReceipt | GroupRow

/**
 * One page of results, as {@link fetchReceipts} resolves it.
 *
 * `total` is the number of rows the pager is paging — the length of the whole
 * flattened list, group rows included — which is the leaf count only when
 * nothing is grouped.
 *
 * `startPath` is the open group the page's FIRST row sits inside, or `[]` when
 * that row is at the top level (and always, for an ungrouped page). It exists
 * because of a case only a real implementation turns up: with one group open
 * and a page boundary falling inside it, the page comes back as three leaf
 * rows and no group row at all, and nothing else on the wire says which group
 * they belong to — a leaf carries no path. The user would see rows indented
 * under nothing and a client could draw no "continued" header. The alternative
 * fix, a path on every leaf, costs an array per row to answer a question only
 * the first row of a page can ask: every later row's context is re-established
 * by the group row above it. One field per page is the smaller, sufficient
 * answer.
 */
export interface ServerPage<TRow = ServerReceipt> {
  rows: TRow[]
  total: number
  /** The open group path the first row of this page sits inside; `[]` at the top level. */
  startPath: FilterValue[]
}

/**
 * How to read each column the wire can name.
 *
 * A real backend has the same map, spelled as a column list or an ORM model:
 * a condition carries a column id, and something has to turn that into a
 * column. Spelled out here so nothing in this file has to cast a row.
 */
const FIELD_READERS: Record<string, (row: ServerReceipt) => unknown> = {
  code: (row) => row.code,
  partner: (row) => row.partner,
  amount: (row) => row.amount,
  status: (row) => row.status,
  date: (row) => row.date,
  flagged: (row) => row.flagged,
}

/** `(col IS NULL OR col::text = '')`, in one predicate. */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === ""
}

/** The two operators every kind shares, as their own type. */
type BlanknessCondition = Extract<FilterCondition, { op: "blank" | "notBlank" }>

/**
 * Whether a condition is one of the two blankness tests.
 *
 * A type predicate rather than an inline `condition.op === "blank"`, because
 * that check narrows nothing: each kind declares `op` as a *union* of literals,
 * and TypeScript can only eliminate a union member whose discriminant is a
 * single literal. Without this, every branch below would need its own
 * `"value" in condition` guard to see the value it has already established is
 * there — the same trap `textCondition` in `core/filters.ts` records.
 *
 * @param condition - Any condition.
 * @returns Whether it is `blank` or `notBlank`, narrowing the negative case to
 *   the operators that carry a value.
 */
function isBlanknessTest(condition: FilterCondition): condition is BlanknessCondition {
  return condition.op === "blank" || condition.op === "notBlank"
}

/**
 * One condition against one value, translated the way a backend would.
 *
 * Every rule here belongs to the contract rather than to this file: all six
 * text operators are case-insensitive, a blank value fails every comparison
 * rather than being coerced, `between` is inclusive on both ends, and a date
 * range is `[from, before)` — inclusive below, **exclusive** above, which is
 * what stops the last day of a range going missing.
 *
 * Written **independently of `filterFn_dt`** — no shared helper, no shared
 * resolver, not even a shared blankness predicate. That independence is the
 * whole value of `fakeServer.test.ts`'s agreement matrix: two implementations
 * that share their operator code cannot disagree, and so prove nothing about
 * whether the published contract is implementable twice.
 *
 * It does assume its input is **canonical** — what `buildQuery` publishes, and
 * what `rebuildCondition` would return unchanged. A real endpoint validates
 * first; this one takes the wire at its word, so a hand-written condition with
 * reversed bounds or a malformed day is outside what it promises to answer.
 *
 * @param value - The row's value for the condition's column.
 * @param condition - One canonical condition off the wire.
 * @returns Whether the value satisfies it.
 *
 * @example
 * matchesFilter("Toshkent Kimyo Zavodi", { kind: "text", field: "partner", op: "contains", value: "kimyo" })
 */
export function matchesFilter(value: unknown, condition: FilterCondition): boolean {
  if (isBlanknessTest(condition)) return isBlank(value) === (condition.op === "blank")
  /*
   * Blankness is the only operator that reaches a blank row. In SQL a
   * comparison against NULL is NULL rather than true, so every operator below
   * drops it — the negated ones included, which is exactly where a client
   * that implemented them as "the positive test, negated" would disagree.
   */
  if (isBlank(value)) return false

  switch (condition.kind) {
    case "text": {
      const text = String(value).toLowerCase()
      const needle = condition.value.toLowerCase()
      const { op } = condition
      if (op === "contains") return text.includes(needle)
      if (op === "notContains") return !text.includes(needle)
      if (op === "equals") return text === needle
      if (op === "notEquals") return text !== needle
      if (op === "startsWith") return text.startsWith(needle)
      return text.endsWith(needle)
    }
    case "number": {
      // Not `Number(value)`: a numeric column holds numbers, and coercing
      // whatever else arrived would make `amount BETWEEN 0 AND 100` match the
      // string "50" here while the library — and Postgres — reject it.
      if (typeof value !== "number" || Number.isNaN(value)) return false
      if (condition.op === "between") {
        return (
          (condition.from === null || value >= condition.from) &&
          (condition.to === null || value <= condition.to)
        )
      }
      const bound = condition.value
      const { op } = condition
      if (op === "eq") return value === bound
      if (op === "ne") return value !== bound
      if (op === "lt") return value < bound
      if (op === "lte") return value <= bound
      if (op === "gt") return value > bound
      return value >= bound
    }
    case "date": {
      // These rows store `YYYY-MM-DD`, which compares chronologically as a
      // string. A real `date` or `timestamptz` column compares as itself, with
      // the same two clauses.
      if (typeof value !== "string") return false
      return (
        (condition.from === null || value >= condition.from) &&
        (condition.before === null || value < condition.before)
      )
    }
    case "boolean":
      return value === condition.value
    case "list":
      return condition.op === "in"
        ? condition.values.some((member) => member === value)
        : !condition.values.some((member) => member === value)
  }
}

/**
 * One condition against one row: find the column, then apply the operator.
 *
 * @param row - The row being tested.
 * @param condition - One canonical condition off the wire.
 * @returns Whether the row satisfies it.
 */
function matchesCondition(row: ServerReceipt, condition: FilterCondition): boolean {
  const read = FIELD_READERS[condition.field]
  // A condition for a column this endpoint does not serve constrains nothing.
  if (read === undefined) return true
  return matchesFilter(read(row), condition)
}

/**
 * Quick search, translated the way a backend would.
 *
 * AND over tokens, OR over fields: every token must appear in at least one of
 * `fields`, and different tokens may match different columns. The naive
 * `includes(text)` across the fields disagrees with client mode the moment a
 * user types two words.
 *
 * @param row - The row being tested.
 * @param search - The search off the wire, or null when it is off.
 * @returns Whether the row satisfies it.
 */
function matchesSearch(row: ServerReceipt, search: TableSearch | null): boolean {
  if (search === null) return true
  const tokens = search.text.split(/\s+/).filter((token) => token !== "")
  return tokens.every((token) =>
    search.fields.some((field) => {
      const read = FIELD_READERS[field]
      if (read === undefined) return false
      // A blank column contributes nothing to any token, exactly as a NULL
      // does to an OR'd `ILIKE` — it never matches, and never excludes either.
      return String(read(row) ?? "").toLowerCase().includes(token.toLowerCase())
    }),
  )
}

/**
 * Order two values the way Postgres orders a sorted column.
 *
 * Blanks rank **above** every real value, which is what makes them last under
 * `ASC` and first under `DESC` — Postgres' documented default, and not what
 * `a < b` gives, since `null < 5` is true and would scatter them to the top of
 * an ascending page instead.
 */
function compareValues(a: unknown, b: unknown): number {
  const aBlank = isBlank(a)
  const bBlank = isBlank(b)
  if (aBlank || bBlank) return aBlank && bBlank ? 0 : aBlank ? 1 : -1
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

/**
 * The key every blank value groups under.
 *
 * `FilterValue` excludes `null` deliberately — blankness is an operator, not a
 * value — so a key path cannot carry one, and a grouped nullable column still
 * needs a key that travels as JSON. The empty string is that key, and **both**
 * shapes of blankness land on it: `null` and `""` group together.
 *
 * A literal `GROUP BY` would give two groups here, one for `NULL` and one for
 * `''`. This contract does not survive that split: `blank` matches both, so a
 * "(Blanks)" filter would report twenty thousand rows beside two group rows
 * that divide them — the filter and the counts disagreeing about the same
 * word. A backend writing this query groups on
 * `COALESCE(NULLIF(col::text, ''), '')` for the same reason.
 */
const BLANK_GROUP_KEY = ""

/**
 * The key a value groups under.
 *
 * @param value - The row's value for the grouped column.
 * @returns A JSON primitive: the value itself, or {@link BLANK_GROUP_KEY}.
 */
function groupKeyOf(value: unknown): FilterValue {
  if (isBlank(value)) return BLANK_GROUP_KEY
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  // Nothing this endpoint serves reaches here; a column that did would still
  // need a JSON primitive to travel as, and its text is the honest one.
  return String(value)
}

/** One node of the grouping tree, before it is flattened against `expanded`. */
interface GroupNode {
  key: FilterValue
  /** Leaves beneath it at every depth — not children at the next level. */
  count: number
  /** The next level down; empty at the innermost level. */
  children: GroupNode[]
  /** The rows themselves; populated only at the innermost level. */
  leaves: ServerReceipt[]
}

/** The one sort the wire carries, or undefined when the table is unsorted. */
type Sort = TableQuery["sorting"][number] | undefined

/**
 * Order leaf rows by the sort, the way the ungrouped page always has.
 *
 * @param rows - The rows of one innermost group, or the whole match set.
 * @param sort - The sort off the wire.
 * @returns A new, ordered array; the input unchanged when there is no sort.
 */
function sortLeaves(rows: ServerReceipt[], sort: Sort): ServerReceipt[] {
  if (sort === undefined) return rows
  const read = FIELD_READERS[sort.id]
  if (read === undefined) return rows
  return [...rows].sort((a, b) => compareValues(read(a), read(b)) * (sort.desc ? -1 : 1))
}

/**
 * Order the groups of one level.
 *
 * **The sorting rule for a grouped table, stated once**: a sort applies
 * *within a level*. Group rows are ordered by their own key; the level whose
 * column the sort names takes the sort's direction, and every other level
 * stays ascending. Leaves are ordered by the sort inside the innermost group
 * they belong to, and never move between groups.
 *
 * Two consequences worth naming. Sorting by a column that is itself grouped
 * reorders that level's headers and does nothing to the leaves, because every
 * leaf in such a group holds the same value for it. And blanks rank above
 * every value here exactly as they do for leaves, so the blank group is last
 * ascending and first descending — one rule for both kinds of row.
 */
function orderGroups(nodes: GroupNode[], field: string, sort: Sort): GroupNode[] {
  const descending = sort !== undefined && sort.id === field && sort.desc
  return [...nodes].sort((a, b) => compareValues(a.key, b.key) * (descending ? -1 : 1))
}

/**
 * Build one level of the grouping tree, and every level below it.
 *
 * @param rows - The rows this level must divide — already filtered and searched.
 * @param grouping - Column ids, outermost first, already reduced to ones this
 *   endpoint can read.
 * @param depth - Which of them this call groups by.
 * @param sort - The sort off the wire, applied within each level.
 * @returns The ordered groups of this level.
 */
function buildLevel(rows: ServerReceipt[], grouping: string[], depth: number, sort: Sort): GroupNode[] {
  const field = grouping[depth]
  const read = field === undefined ? undefined : FIELD_READERS[field]
  // Unreachable: `fetchReceipts` drops any id this endpoint cannot read before
  // it gets here. Guarded rather than asserted so no branch casts a row.
  if (field === undefined || read === undefined) return []

  const buckets = new Map<FilterValue, ServerReceipt[]>()
  for (const row of rows) {
    const key = groupKeyOf(read(row))
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [row])
    else bucket.push(row)
  }

  const isInnermost = depth === grouping.length - 1
  const nodes = [...buckets].map(([key, bucket]): GroupNode => ({
    key,
    // `bucket.length`, not the number of children: the count a group row
    // carries is its leaves at every depth, so an outer count is the sum of
    // its children's and does not change as the user opens the tree.
    count: bucket.length,
    children: isInnermost ? [] : buildLevel(bucket, grouping, depth + 1, sort),
    leaves: isInnermost ? sortLeaves(bucket, sort) : [],
  }))
  return orderGroups(nodes, field, sort)
}

/** Whether this exact key path is one of the open ones. */
function isExpanded(expanded: FilterValue[][], path: FilterValue[]): boolean {
  return expanded.some((open) => open.length === path.length && open.every((key, index) => key === path[index]))
}

/**
 * One row of the flattened list, with the group it sits inside.
 *
 * `container` is what {@link ServerPage.startPath} is read from for the first
 * row of a page: it is never sent for every row, which is the whole point of
 * that field, but it has to be KNOWN for every row to be read off one of them.
 */
interface FlatRow {
  row: ServerRow
  /** The open group this row sits inside, or `[]` at the top level. */
  container: FilterValue[]
}

/**
 * Flatten the tree into the rows a user with those groups open would see.
 *
 * A group's children are emitted only when the group itself is open, so a path
 * in `expanded` whose parent is closed is inert — it names a group that is not
 * on the page at all. That is the honest reading of "which group rows are
 * open", and it means a client may keep a deep path across a collapse and get
 * the same subtree back when the parent reopens.
 *
 * @param nodes - One level's groups, already ordered.
 * @param expanded - The open key paths off the wire.
 * @param prefix - The key path of the parent, empty at the outermost level.
 * @returns Group rows and leaves interleaved, in visible order, each with the
 *   group it sits inside.
 */
function flattenGroups(nodes: GroupNode[], expanded: FilterValue[][], prefix: FilterValue[]): FlatRow[] {
  const out: FlatRow[] = []
  for (const node of nodes) {
    const path = [...prefix, node.key]
    // A group row sits inside its PARENT, not inside itself: `startPath` says
    // what a page's first row is under, and a group header is under the group
    // above it.
    out.push({ row: { kind: "group", path, count: node.count }, container: prefix })
    if (!isExpanded(expanded, path)) continue
    // A loop rather than `push(...rows)`: an open group here can hold
    // twenty-five thousand leaves, and spreading that many arguments is how a
    // call stack overflows on a page that was only ever going to show fifty.
    if (node.children.length > 0) {
      for (const child of flattenGroups(node.children, expanded, path)) out.push(child)
    } else {
      for (const leaf of node.leaves) out.push({ row: leaf, container: path })
    }
  }
  return out
}

/** The top level: what a row sits inside when it sits inside nothing. */
const NO_PATH: FilterValue[] = []

/** What `fetchReceipts` accepts beside the query. */
export interface FetchOptions {
  fail?: boolean
  delayMs?: number
  signal?: AbortSignal
}

/**
 * Filter, search, sort, slice and reply after a delay — the way a real
 * endpoint would.
 *
 * `signal` aborts a superseded request, the same way {@link fetchValues}
 * does: a query the table has already moved past must not still be able to
 * publish rows, and a slow first answer must not land on top of a faster
 * second one. Cancelling the work is stronger than ignoring its result — the
 * abandoned request stops occupying the (fake) server at all.
 *
 * **Order of operations, and it matters**: filter and search, then group, then
 * sort within a level, then flatten against the open paths, then page. A
 * backend that groups before it filters returns counts that do not match the
 * rows under them — wrong in the way a user cannot see, which is the whole
 * reason the grouping travels with the query instead of happening in the
 * browser over fifty rows.
 *
 * @param query - The current filters, search, sort, grouping and page, built
 *   by {@link useDataTable}. `expanded` names the open key paths; absent means
 *   every group is closed.
 * @param options - `fail` simulates a network error, `delayMs` simulates latency,
 *   `signal` cancels a request that has been superseded.
 * @returns The requested page of the flattened visible rows, plus the total
 *   number of them — which is the leaf count only when nothing is grouped.
 *
 * @example
 * const page = await fetchReceipts(query, { signal: controller.signal })
 * const grouped = await fetchReceipts({ ...query, grouping: ["status"], expanded: [["open"]] })
 */
export function fetchReceipts(
  query: TableQuery,
  options: FetchOptions = {},
): Promise<ServerPage<ServerRow>> {
  const { fail = false, delayMs = 300, signal } = options
  return new Promise((resolve, reject) => {
    const abortError = (): DOMException => new DOMException("Aborted", "AbortError")
    // A signal that is already aborted fires no `abort` event, so a request
    // superseded before it even started would never settle — and a caller that
    // clears its in-flight state on settle would wait on it forever.
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      if (fail) {
        reject(new Error("Simulated network failure"))
        return
      }
      const matched = ALL.filter(
        (row) =>
          query.filters.every((condition) => matchesCondition(row, condition)) &&
          matchesSearch(row, query.search),
      )
      const [sort] = query.sorting
      // A group on a column this endpoint does not serve groups nothing, the
      // same way a condition on one constrains nothing.
      const groupBy = query.grouping.filter((id) => FIELD_READERS[id] !== undefined)
      const visible: FlatRow[] =
        groupBy.length === 0
          ? sortLeaves(matched, sort).map((row) => ({ row, container: NO_PATH }))
          : flattenGroups(buildLevel(matched, groupBy, 0, sort), query.expanded, [])
      const { pageIndex, pageSize } = query.pagination
      const from = pageIndex * pageSize
      const page = visible.slice(from, from + pageSize)
      // The total is what matched, not what exists: it is what the footer
      // counts and what the page clamp is measured against. Grouped, that is
      // the length of the flattened list — group rows are rows the pager pages
      // past, so a total of leaves alone would let the pager run off the end.
      resolve({
        rows: page.map((entry) => entry.row),
        total: visible.length,
        // Read off the FIRST row of the page, which is the only row whose
        // context nothing else on the page can establish — see
        // {@link ServerPage.startPath}.
        startPath: page[0]?.container ?? NO_PATH,
      })
    }, delayMs)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** How long a facet request takes, separately from a page request. */
const VALUES_DELAY_MS = 250

/**
 * Distinct values for one column, for a values filter in server mode.
 *
 * A facet request is not a page request: its own query, its own latency, its
 * own cache key. `signal` aborts a superseded one, which is what keeps a slow
 * first answer from landing on top of a faster second.
 *
 * Blank rows are counted by neither: `listCondition` drops `null` from a
 * selection because `NULL = ANY(...)` is never true, so blankness reaches the
 * wire as its own operator and the editor offers it as its own "(Blanks)" row.
 * Offering a blank option here would produce a selection that matches nothing.
 *
 * Values keep their own primitive type — a boolean column answers `true`, not
 * `"true"`. `FilterValue` is what goes back out in the `in`/`notIn` condition
 * the editor builds, and the comparison at the far end is `===`, so a
 * stringified boolean or number would select rows and then match none of them.
 *
 * `label` rides along for the Status column, in the caller's own language —
 * the same {@link STATUS_LABELS} the column's cell and its `meta.groupLabel`
 * read, so the list filter stops showing the raw `closed` / `in_process` a
 * real host would never put in front of a user. Every other column answers
 * with no `label` at all, and the editor falls back to `String(value)`.
 *
 * @param columnId - The column whose values are wanted.
 * @param options - The editor's search box, and an abort signal.
 * @param language - The playground's current language. Defaults to English,
 *   which is also what a caller that has not been told about languages at
 *   all — this file's own tests — gets.
 * @returns Every distinct value that matches, with its count.
 *
 * @example
 * const options = await fetchValues("status", { search: "", signal: controller.signal }, "ru")
 */
export function fetchValues(
  columnId: string,
  options: { search: string; signal: AbortSignal },
  language: Language = "en",
): Promise<FilterValueOption[]> {
  const read = FIELD_READERS[columnId]
  return new Promise((resolve, reject) => {
    const abortError = (): DOMException => new DOMException("Aborted", "AbortError")
    // A signal that is already aborted fires no `abort` event, so a request
    // superseded before it even started would hang here forever rather than
    // settle — and the editor, which clears its in-flight state on settle,
    // would keep showing a spinner that never resolves.
    if (options.signal.aborted) {
      reject(abortError())
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      options.signal.removeEventListener("abort", onAbort)
      if (read === undefined) {
        resolve([])
        return
      }
      const needle = options.search.toLowerCase()
      const counts = new Map<FilterValue, number>()
      for (const row of ALL) {
        const value = read(row)
        if (isBlank(value) || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) {
          continue
        }
        if (needle !== "" && !String(value).toLowerCase().includes(needle)) continue
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
      resolve(
        [...counts].map(([value, count]) => {
          const label =
            columnId === "status" && typeof value === "string" ? STATUS_LABELS[language][value] : undefined
          return label === undefined ? { value, count } : { value, count, label }
        }),
      )
    }, VALUES_DELAY_MS)
    options.signal.addEventListener("abort", onAbort, { once: true })
  })
}


/** How long a write takes, separately from a read. */
const WRITE_DELAY_MS = 400

/** One cell's write, as the endpoint receives it. */
export interface ReceiptWrite {
  /** The row's id, which is what a real endpoint would have in its path. */
  id: string
  /** The column being written, which a backend maps to one of its own. */
  columnId: string
  /** The new value. `null` empties the column. */
  value: unknown
}

/**
 * Validate and apply one cell's write, the way a real endpoint would.
 *
 * It rejects, and that is the point: a server that accepts everything makes an
 * optimistic table look correct when it is not. The rules here are the small
 * set a receipts table would really have — a receipt must have a code, an
 * amount cannot be negative, a status must be one the system knows — and each
 * is reachable from the playground by typing the wrong thing into a cell.
 *
 * The store is written by REPLACING the row rather than assigning into it:
 * every reader of `ALL` holds row objects, and mutating one in place would
 * change a row a page had already been built from.
 *
 * @param write - Which row, which column, what value.
 * @param options - `delayMs` simulates latency.
 * @returns The stored row, as the endpoint would echo it back.
 * @throws When the row, the column or the value is refused. The message is
 *   what the table puts after "Could not save …".
 *
 * @example
 * await saveReceipt({ id: "rc-3", columnId: "amount", value: 120_000 })
 */
export function saveReceipt(
  write: ReceiptWrite,
  options: { delayMs?: number } = {},
): Promise<ServerReceipt> {
  const { delayMs = WRITE_DELAY_MS } = options
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const index = ALL.findIndex((row) => row.id === write.id)
      const current = ALL[index]
      if (current === undefined) {
        reject(new Error(`No receipt ${write.id}`))
        return
      }
      const validate = FIELD_WRITERS[write.columnId]
      if (validate === undefined) {
        reject(new Error(`${write.columnId} cannot be written`))
        return
      }
      const checked = validate(write.value)
      if (typeof checked === "string") {
        reject(new Error(checked))
        return
      }
      const stored = { ...current, ...checked.row }
      ALL[index] = stored
      resolve(stored)
    }, delayMs)
  })
}

/** A validated write, or the sentence explaining the refusal. */
type WriteResult = { row: Partial<ServerReceipt> } | string

/**
 * One validator per writable column.
 *
 * The same shape as {@link FIELD_READERS} and for the same reason: a write
 * carries a column id, and something has to turn that into a column — and
 * into the rule that column enforces. `status` and `date` are deliberately
 * absent: this endpoint does not accept them, and a table that offers to edit
 * a column the server will not take is a table that lies.
 */
const FIELD_WRITERS: Record<string, (value: unknown) => WriteResult> = {
  code: (value) => {
    if (typeof value !== "string" || value.trim() === "") return "A receipt must have a code"
    return { row: { code: value } }
  },
  partner: (value) => {
    if (value === null) return { row: { partner: null } }
    if (typeof value !== "string") return "A partner is a name"
    return { row: { partner: value } }
  },
  amount: (value) => {
    if (value === null) return { row: { amount: null } }
    if (typeof value !== "number" || !Number.isFinite(value)) return "An amount is a number"
    if (value < 0) return "An amount cannot be negative"
    return { row: { amount: value } }
  },
  flagged: (value) => {
    if (value === null) return { row: { flagged: false } }
    if (typeof value !== "boolean") return "Flagged is yes or no"
    return { row: { flagged: value } }
  },
}
