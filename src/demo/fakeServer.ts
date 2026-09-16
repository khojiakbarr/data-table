import type { TableQuery } from "../core/query"

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
 * Sort, slice and reply after a delay — the way a real endpoint would.
 *
 * @param query - The current sort and page, built by {@link useDataTable}.
 * @param options - `fail` simulates a network error; `delayMs` simulates latency.
 * @returns The requested page of rows plus the total row count.
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
      const sorted = [...ALL]
      const [sort] = query.sorting
      if (sort) {
        const key = sort.id as keyof ServerReceipt
        sorted.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (sort.desc ? -1 : 1))
      }
      const { pageIndex, pageSize } = query.pagination
      resolve({ rows: sorted.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize), total: ALL.length })
    }, delayMs)
  })
}
