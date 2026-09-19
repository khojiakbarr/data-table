import type { FilterCondition, FilterValue, FilterValueOption } from "../core/filters"
import type { TableQuery, TableSearch } from "../core/query"

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

const PARTNERS = ["Oʻzbekiston Temir Yoʻllari", "Gʻallaorol Agro MChJ", "ООО «Северный Путь»", "Toshkent Kimyo Zavodi"]
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
 * A group header in the flattened page.
 *
 * It carries its identity and its size and nothing else: the value and the
 * count are what the group cell renders — `received (25 000)` — and
 * aggregations, AG Grid's Values zone, are deliberately outside this version.
 *
 * `path` is the key path from the outermost grouping level, so a group at the
 * second level is `["received", "Toshkent Kimyo Zavodi"]`. It is the same
 * shape `expanded` carries, which is what identifies a group without a
 * server-minted id and leaves room for a lazy, per-group fetch later.
 *
 * `count` is the number of **leaf** rows beneath it at every depth, not the
 * number of children at the next level down. An outer group's count is
 * therefore the sum of its children's counts, and a user reading
 * `received (25 000)` is being told how many receipts are in there — which is
 * the only reading of that number that survives opening the group.
 */
export interface GroupRow {
  kind: "group"
  /** The key path identifying this group, outermost first. */
  path: FilterValue[]
  /** How many leaf rows are under it, at every depth. */
  count: number
}

/**
 * One row of a flattened page: a group header, or an ordinary leaf.
 *
 * The union is the price of the flat page, and it is not free — every consumer
 * of `rows` now has to narrow before it can read a field, and a grouped page
 * has no `id` on half its rows for `getRowId` to return. That cost is real and
 * is the reason {@link fetchReceipts} still has an ungrouped overload: the
 * playground's own hook and page are written against `ServerReceipt[]` and
 * cannot see a union until they are migrated with the library.
 */
export type ServerRow = ServerReceipt | GroupRow

/**
 * Whether a flattened row is a group header rather than a receipt.
 *
 * The discriminant is `kind`, present only on a group row, so a leaf needs no
 * marker field and the wire stays exactly what it already was for leaves.
 *
 * @param row - One row off a flattened page.
 * @returns Whether it is a group, narrowing it.
 *
 * @example
 * const label = isGroupRow(row) ? `${row.path.at(-1)} (${row.count})` : row.code
 */
export function isGroupRow(row: ServerRow): row is GroupRow {
  return "kind" in row && row.kind === "group"
}

/**
 * The query with the two fields grouping adds, defined here first.
 *
 * Declared in the demo rather than in `core/query.ts` on purpose: the point of
 * implementing grouping on the fake server before the library is that the wire
 * shape gets validated by something that actually has to answer it. The
 * library adopts this verbatim afterwards — `grouping` is already reserved on
 * {@link TableQuery} and empty since stage 1; only `expanded` is new.
 */
export interface GroupedTableQuery extends TableQuery {
  /** Column ids to group by, outermost first. Empty means no grouping. */
  grouping: string[]
  /** Which group rows are open, as the key path from the outermost level. */
  expanded: FilterValue[][]
}

/**
 * One page of results, as `fetchReceipts` resolves it.
 *
 * Generic in its row so the ungrouped answer keeps the exact type it has
 * always had. `total` is the number of rows the pager is paging — the length
 * of the whole flattened list, group rows included — which is the leaf count
 * only when nothing is grouped.
 */
export interface ServerPage<TRow = ServerReceipt> {
  rows: TRow[]
  total: number
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
 * @returns Group rows and leaves interleaved, in visible order.
 */
function flattenGroups(nodes: GroupNode[], expanded: FilterValue[][], prefix: FilterValue[]): ServerRow[] {
  const out: ServerRow[] = []
  for (const node of nodes) {
    const path = [...prefix, node.key]
    out.push({ kind: "group", path, count: node.count })
    if (!isExpanded(expanded, path)) continue
    // A loop rather than `push(...rows)`: an open group here can hold
    // twenty-five thousand leaves, and spreading that many arguments is how a
    // call stack overflows on a page that was only ever going to show fifty.
    for (const row of node.children.length > 0 ? flattenGroups(node.children, expanded, path) : node.leaves) {
      out.push(row)
    }
  }
  return out
}

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
export function fetchReceipts(query: GroupedTableQuery, options?: FetchOptions): Promise<ServerPage<ServerRow>>
/**
 * The pre-grouping signature, kept while `buildQuery` still pins `grouping` to
 * `[]` and publishes no `expanded`: those callers get back the leaf rows they
 * are written against instead of a union they cannot yet narrow. A caller that
 * means to group passes `expanded` — `[]` when nothing is open — and gets the
 * honest row type.
 */
export function fetchReceipts(
  query: TableQuery & { expanded?: never },
  options?: FetchOptions,
): Promise<ServerPage>
export function fetchReceipts(
  query: TableQuery & { expanded?: FilterValue[][] },
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
      const visible: ServerRow[] =
        groupBy.length === 0
          ? sortLeaves(matched, sort)
          : flattenGroups(buildLevel(matched, groupBy, 0, sort), query.expanded ?? [], [])
      const { pageIndex, pageSize } = query.pagination
      // The total is what matched, not what exists: it is what the footer
      // counts and what the page clamp is measured against. Grouped, that is
      // the length of the flattened list — group rows are rows the pager pages
      // past, so a total of leaves alone would let the pager run off the end.
      resolve({ rows: visible.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize), total: visible.length })
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
 * @param columnId - The column whose values are wanted.
 * @param options - The editor's search box, and an abort signal.
 * @returns Every distinct value that matches, with its count.
 *
 * @example
 * const options = await fetchValues("status", { search: "", signal: controller.signal })
 */
export function fetchValues(
  columnId: string,
  options: { search: string; signal: AbortSignal },
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
      resolve([...counts].map(([value, count]) => ({ value, count })))
    }, VALUES_DELAY_MS)
    options.signal.addEventListener("abort", onAbort, { once: true })
  })
}
