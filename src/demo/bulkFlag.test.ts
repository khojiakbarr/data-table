import { describe, expect, it } from "vitest"
import type { FilterCondition } from "../core/filters"
import type { TableQuery } from "../core/query"
import {
  fetchReceipts,
  flagReceipts,
  isGroupRow,
  type ServerReceipt,
  type ServerRow,
} from "./fakeServer"

/**
 * The bulk action, end to end.
 *
 * `flagReceipts` is where the README's `WHERE <the filters> AND id NOT IN
 * (<excluded>)` is actually executed, so this is the file that says the
 * translation is real rather than described. It matters most for the case the
 * whole selection design exists for: the user ticks the header on page 1 of
 * 2000, and the write lands on every matching row in the table — not on the
 * fifty they could see.
 *
 * A file of its own, deliberately: `flagReceipts` writes to the fake server's
 * module-scope store, and `fakeServer.test.ts` reads `flagged` in its own
 * boolean-operator cases. Vitest gives each test FILE its own module instance,
 * so the writes here are invisible there.
 */

/** A deterministic slice of the generated rows: indices 0–9. */
const SCOPE_CODES = Array.from({ length: 10 }, (_, index) => `KR-${10_000 + index}`)
const SCOPE: FilterCondition = { kind: "list", field: "code", op: "in", values: SCOPE_CODES }
/** Their ids, which is what a selection actually carries. */
const SCOPE_IDS = Array.from({ length: 10 }, (_, index) => `rc-${index}`)

function query(filters: FilterCondition[], overrides: Partial<TableQuery> = {}): TableQuery {
  return {
    sorting: [],
    filters,
    search: null,
    grouping: [],
    expanded: [],
    pagination: { pageIndex: 0, pageSize: 20 },
    ...overrides,
  }
}

/** Which of the ten scoped receipts are flagged right now, by code. */
async function flaggedCodes(): Promise<string[]> {
  const page = await fetchReceipts(query([SCOPE]), { delayMs: 0 })
  return page.rows
    .filter((row: ServerRow): row is ServerReceipt => !isGroupRow(row))
    .filter((row) => row.flagged)
    .map((row) => row.code)
    .sort()
}

/** Put the ten scoped rows back to unflagged, whatever a case left behind. */
async function resetScope(): Promise<void> {
  await flagReceipts(
    { mode: "ids", ids: SCOPE_IDS, query: query([]), flagged: false },
    { delayMs: 0 },
  )
}

describe("an `ids` selection", () => {
  it("writes exactly the rows it names, and no others", async () => {
    await resetScope()
    const { changed } = await flagReceipts(
      { mode: "ids", ids: ["rc-1", "rc-3"], query: query([SCOPE]), flagged: true },
      { delayMs: 0 },
    )
    expect(changed).toBe(2)
    expect(await flaggedCodes()).toEqual(["KR-10001", "KR-10003"])
    await resetScope()
  })

  it("ignores the query's filters entirely", async () => {
    // `WHERE id = ANY($1)` and nothing else: the user named these rows, so a
    // filter that no longer matches one of them cannot un-name it. (A backend
    // that ANDed the filters in would silently drop rows from a selection the
    // user had made before narrowing the table.)
    await resetScope()
    const { changed } = await flagReceipts(
      {
        mode: "ids",
        ids: ["rc-1"],
        query: query([{ kind: "text", field: "code", op: "contains", value: "no-such-code" }]),
        flagged: true,
      },
      { delayMs: 0 },
    )
    expect(changed).toBe(1)
    expect(await flaggedCodes()).toEqual(["KR-10001"])
    await resetScope()
  })
})

describe("an `all-matching` selection", () => {
  it("writes every row the query matches, not the page that was on screen", async () => {
    await resetScope()
    // The selection was made on a page of two rows; the query matches ten.
    const { changed } = await flagReceipts(
      {
        mode: "all-matching",
        excluded: [],
        query: query([SCOPE], { pagination: { pageIndex: 0, pageSize: 2 } }),
        flagged: true,
      },
      { delayMs: 0 },
    )
    expect(changed).toBe(10)
    expect(await flaggedCodes()).toEqual([...SCOPE_CODES].sort())
    await resetScope()
  })

  it("takes the excluded rows back out — `AND id NOT IN (…)`", async () => {
    await resetScope()
    const { changed } = await flagReceipts(
      {
        mode: "all-matching",
        excluded: ["rc-0", "rc-9"],
        query: query([SCOPE]),
        flagged: true,
      },
      { delayMs: 0 },
    )
    expect(changed).toBe(8)
    const flagged = await flaggedCodes()
    expect(flagged).not.toContain("KR-10000")
    expect(flagged).not.toContain("KR-10009")
    expect(flagged).toHaveLength(8)
    await resetScope()
  })

  it("applies the search as well as the filters", async () => {
    await resetScope()
    const { changed } = await flagReceipts(
      {
        mode: "all-matching",
        excluded: [],
        query: query([SCOPE], { search: { text: "kimyo", fields: ["partner"] } }),
        flagged: true,
      },
      { delayMs: 0 },
    )
    // The two Toshkent Kimyo Zavodi rows in the scope.
    expect(changed).toBe(2)
    expect(await flaggedCodes()).toEqual(["KR-10003", "KR-10007"])
    await resetScope()
  })

  it("is unaffected by the sorting and the grouping", async () => {
    // Neither changes which rows match, only how they are presented — and a
    // bulk action acts on the rows.
    await resetScope()
    const { changed } = await flagReceipts(
      {
        mode: "all-matching",
        excluded: [],
        query: query([SCOPE], {
          sorting: [{ id: "amount", desc: true }],
          grouping: ["status"],
          expanded: [["open"]],
        }),
        flagged: true,
      },
      { delayMs: 0 },
    )
    expect(changed).toBe(10)
    await resetScope()
  })
})

describe("what the endpoint answers with", () => {
  it("counts the rows it actually changed, not the rows it selected", async () => {
    await resetScope()
    await flagReceipts(
      { mode: "ids", ids: ["rc-1"], query: query([SCOPE]), flagged: true },
      { delayMs: 0 },
    )
    // Ten rows selected, nine of them still to change: a client that assumed
    // its own count would report one row too many.
    const { changed } = await flagReceipts(
      { mode: "all-matching", excluded: [], query: query([SCOPE]), flagged: true },
      { delayMs: 0 },
    )
    expect(changed).toBe(9)
    await resetScope()
  })

  it("changes nothing when every selected row is already at the value", async () => {
    await resetScope()
    const { changed } = await flagReceipts(
      { mode: "all-matching", excluded: [], query: query([SCOPE]), flagged: false },
      { delayMs: 0 },
    )
    expect(changed).toBe(0)
  })
})
