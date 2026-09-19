import type { FilterCondition, FilterValueOption } from "../core/filters"
import type { TableQuery, TableSearch } from "../core/query"

/** One row as the fake backend would return it. */
export interface ServerReceipt {
  id: string
  code: string
  partner: string
  amount: number
  status: string
  date: string
}

const PARTNERS = ["Oʻzbekiston Temir Yoʻllari", "Gʻallaorol Agro MChJ", "ООО «Северный Путь»", "Toshkent Kimyo Zavodi"]
const STATUSES = ["open", "in_process", "received", "closed"]

/** 10 000 rows, generated once. */
const ALL: ServerReceipt[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: `rc-${index}`,
  code: `KR-${10_000 + index}`,
  partner: PARTNERS[index % PARTNERS.length] as string,
  amount: ((index * 918_233) % 210_000_000) + 310_000,
  status: STATUSES[index % STATUSES.length] as string,
  date: `2026-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
}))

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
}

/** `(col IS NULL OR col::text = '')`, in one predicate. */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === ""
}

/**
 * One condition, translated the way a backend would.
 *
 * Every rule here belongs to the contract rather than to this file: all six
 * text operators are case-insensitive, a blank value fails every comparison
 * rather than being coerced, `between` is inclusive on both ends, and a date
 * range is `[from, before)` — inclusive below, **exclusive** above, which is
 * what stops the last day of a range going missing.
 *
 * @param row - The row being tested.
 * @param condition - One condition off the wire.
 * @returns Whether the row satisfies it.
 */
function matchesCondition(row: ServerReceipt, condition: FilterCondition): boolean {
  const read = FIELD_READERS[condition.field]
  // A condition for a column this endpoint does not serve constrains nothing.
  if (read === undefined) return true
  const value = read(row)

  if (condition.op === "blank") return isBlank(value)
  if (condition.op === "notBlank") return !isBlank(value)
  /*
   * Blankness is the only operator that reaches a blank row. In SQL a
   * comparison against NULL is NULL rather than true, so every operator below
   * drops it — the negated ones included, which is exactly where a client
   * that implemented them as "the positive test, negated" would disagree.
   */
  if (isBlank(value)) return false

  switch (condition.kind) {
    case "text": {
      if (!("value" in condition)) return true
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
      const amount = Number(value)
      if ("from" in condition) {
        return (
          (condition.from === null || amount >= condition.from) &&
          (condition.to === null || amount <= condition.to)
        )
      }
      if (!("value" in condition)) return true
      const bound = condition.value
      const { op } = condition
      if (op === "eq") return amount === bound
      if (op === "ne") return amount !== bound
      if (op === "lt") return amount < bound
      if (op === "lte") return amount <= bound
      if (op === "gt") return amount > bound
      return amount >= bound
    }
    case "date": {
      if (!("from" in condition)) return true
      // These rows store `YYYY-MM-DD`, which compares chronologically as a
      // string. A real `date` or `timestamptz` column compares as itself, with
      // the same two clauses.
      const day = String(value)
      return (
        (condition.from === null || day >= condition.from) &&
        (condition.before === null || day < condition.before)
      )
    }
    case "boolean":
      return !("value" in condition) || value === condition.value
    case "list":
      if (!("values" in condition)) return true
      return condition.op === "in"
        ? condition.values.some((member) => member === value)
        : !condition.values.some((member) => member === value)
  }
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
      return String(read(row) ?? "").toLowerCase().includes(token.toLowerCase())
    }),
  )
}

/**
 * Filter, search, sort, slice and reply after a delay — the way a real
 * endpoint would.
 *
 * @param query - The current filters, search, sort and page, built by {@link useDataTable}.
 * @param options - `fail` simulates a network error; `delayMs` simulates latency.
 * @returns The requested page of rows plus the total that matched.
 *
 * @example
 * const page = await fetchReceipts(query)
 */
export function fetchReceipts(
  query: TableQuery,
  options: { fail?: boolean; delayMs?: number } = {},
): Promise<ServerPage> {
  const { fail = false, delayMs = 300 } = options
  return new Promise((resolve, reject) => {
    setTimeout(() => {
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
        const key = sort.id as keyof ServerReceipt
        sorted.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (sort.desc ? -1 : 1))
      }
      const { pageIndex, pageSize } = query.pagination
      // The total is what matched, not what exists: it is what the footer
      // counts and what the page clamp is measured against.
      resolve({ rows: sorted.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize), total: matched.length })
    }, delayMs)
  })
}

/**
 * Distinct values for one column, for a values filter in server mode.
 *
 * A facet request is not a page request: its own query, its own latency, its
 * own cache key. `signal` aborts a superseded one, which is what keeps a slow
 * first answer from landing on top of a faster second.
 *
 * @param columnId - The column whose values are wanted.
 * @param options - The editor's search box, and an abort signal.
 * @returns Every distinct value that matches, with its count.
 */
export function fetchValues(
  columnId: string,
  options: { search: string; signal: AbortSignal },
): Promise<FilterValueOption[]> {
  const read = FIELD_READERS[columnId]
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (read === undefined) {
        resolve([])
        return
      }
      const needle = options.search.toLowerCase()
      const counts = new Map<string, number>()
      for (const row of ALL) {
        const value = String(read(row) ?? "")
        if (value === "") continue
        if (needle !== "" && !value.toLowerCase().includes(needle)) continue
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
      resolve([...counts].map(([value, count]) => ({ value, count })))
    }, 250)
    options.signal.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    })
  })
}
