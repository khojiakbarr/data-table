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

/** One page of results, as `fetchReceipts` resolves it. */
export interface ServerPage {
  rows: ServerReceipt[]
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
 * Filter, search, sort, slice and reply after a delay — the way a real
 * endpoint would.
 *
 * `signal` aborts a superseded request, the same way {@link fetchValues}
 * does: a query the table has already moved past must not still be able to
 * publish rows, and a slow first answer must not land on top of a faster
 * second one. Cancelling the work is stronger than ignoring its result — the
 * abandoned request stops occupying the (fake) server at all.
 *
 * @param query - The current filters, search, sort and page, built by {@link useDataTable}.
 * @param options - `fail` simulates a network error, `delayMs` simulates latency,
 *   `signal` cancels a request that has been superseded.
 * @returns The requested page of rows plus the total that matched.
 *
 * @example
 * const page = await fetchReceipts(query, { signal: controller.signal })
 */
export function fetchReceipts(
  query: TableQuery,
  options: { fail?: boolean; delayMs?: number; signal?: AbortSignal } = {},
): Promise<ServerPage> {
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
      const sorted = [...matched]
      const [sort] = query.sorting
      if (sort) {
        const read = FIELD_READERS[sort.id]
        if (read !== undefined) {
          sorted.sort((a, b) => compareValues(read(a), read(b)) * (sort.desc ? -1 : 1))
        }
      }
      const { pageIndex, pageSize } = query.pagination
      // The total is what matched, not what exists: it is what the footer
      // counts and what the page clamp is measured against.
      resolve({ rows: sorted.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize), total: matched.length })
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
