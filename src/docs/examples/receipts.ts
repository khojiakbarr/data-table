/** One receipt, as the docs examples render it. */
export interface Receipt {
  id: string
  code: string
  partner: string
  city: string
  date: string
  amount: number
  status: "open" | "in_process" | "received" | "closed"
}

const PARTNERS = ["Toshkent Kimyo Zavodi", "Gʻallaorol Agro MChJ", "Samarqand Tekstil", "Buxoro Neft"]
const CITIES = ["Tashkent", "Samarkand", "Bukhara", "Namangan", "Fergana"]
const STATUSES: Receipt["status"][] = ["open", "in_process", "received", "closed"]

/**
 * Sixty receipts, generated deterministically at module scope.
 *
 * The docs examples cannot share the playground's fake server: it builds a
 * hundred thousand rows on import, which is the playground's point and would
 * be dead weight on a page whose tables show a screenful. Deterministic, so
 * the page reads the same on every visit and a screenshot stays reproducible.
 */
export const receipts: Receipt[] = Array.from({ length: 60 }, (_, index) => ({
  id: `rc-${index + 1}`,
  code: `KR-${10_001 + index}`,
  partner: PARTNERS[index % PARTNERS.length]!,
  city: CITIES[(index * 3) % CITIES.length]!,
  date: `2026-03-${String((index % 28) + 1).padStart(2, "0")}`,
  amount: ((index * 7919) % 90_000) * 100 + 150_000,
  status: STATUSES[(index * 5) % STATUSES.length]!,
}))
