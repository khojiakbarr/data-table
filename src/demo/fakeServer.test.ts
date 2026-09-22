import type { Row } from "@tanstack/react-table"
import { describe, expect, it } from "vitest"
import { filterFn_dt } from "../core/filterFn"
import { rebuildCondition, type FilterCondition } from "../core/filters"
import type { TableQuery } from "../core/query"
import type { DataTableFeatures } from "../useDataTable"
import {
  fetchReceipts,
  fetchValues,
  isGroupRow,
  matchesFilter,
  type ServerReceipt,
  type ServerRow,
} from "./fakeServer"

/**
 * Drives the fake server directly, one case per operator — and then checks its
 * answers against `filterFn_dt`'s on the same conditions.
 *
 * The agreement suite is the point of this file. The demo's own correctness is
 * worth little; what is worth knowing is whether the published query contract
 * can be implemented twice — once in the client and once in a backend that
 * shares none of its code — and still select the same rows. Where the two
 * disagree, one of them is wrong about the contract, and the contract is what
 * every host will build against.
 *
 * Every test scopes to an exact list of ten codes first — rows 0–9, a
 * deterministic slice of the 100 000 generated rows — so each operator's
 * result set is exact and small. Naming them by an exact `in` list rather than
 * a `code` prefix: `"KR-1000"` is also a prefix of six-digit codes like
 * `KR-100026` (index 90 026), so a `startsWith` scope silently pulls in far
 * more than rows 0–9.
 *
 * Those ten rows contain blanks on purpose — `partner` is null in one and `""`
 * in the next, `amount` is null in a third — so every operator's expected set
 * below also states the blank rule, rather than passing vacuously against a
 * table where no column is ever null:
 *
 * | code     | partner                    | amount  | status     | date       | flagged |
 * |----------|----------------------------|---------|------------|------------|---------|
 * | KR-10000 | Oʻzbekiston Temir Yoʻllari |  310000 | open       | 2026-01-01 | true    |
 * | KR-10001 | Gʻallaorol Agro MChJ       | 1228233 | in_process | 2026-02-02 | false   |
 * | KR-10002 | ООО «Северный Путь»        | 2146466 | received   | 2026-03-03 | false   |
 * | KR-10003 | Toshkent Kimyo Zavodi      | 3064699 | closed     | 2026-04-04 | false   |
 * | KR-10004 | Oʻzbekiston Temir Yoʻllari | 3982932 | open       | 2026-05-05 | false   |
 * | KR-10005 | null                       | 4901165 | in_process | 2026-06-06 | false   |
 * | KR-10006 | ""                         | 5819398 | received   | 2026-07-07 | false   |
 * | KR-10007 | Toshkent Kimyo Zavodi      | 6737631 | closed     | 2026-08-08 | true    |
 * | KR-10008 | Oʻzbekiston Temir Yoʻllari | null    | open       | 2026-09-09 | false   |
 * | KR-10009 | Gʻallaorol Agro MChJ       | 8574097 | in_process | 2026-10-10 | false   |
 */
const SCOPE_CODES = Array.from({ length: 10 }, (_, index) => `KR-${10_000 + index}`)
const SCOPE: FilterCondition = { kind: "list", field: "code", op: "in", values: SCOPE_CODES }

/** The two rows whose `partner` is blank, and the one whose `amount` is. */
const BLANK_PARTNER = ["KR-10005", "KR-10006"]
const BLANK_AMOUNT = ["KR-10008"]
const NON_BLANK_PARTNER = SCOPE_CODES.filter((code) => !BLANK_PARTNER.includes(code))
const NON_BLANK_AMOUNT = SCOPE_CODES.filter((code) => !BLANK_AMOUNT.includes(code))

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

/**
 * The receipt codes of a page, in order.
 *
 * Narrows away the group rows a flattened page can hold: `ServerRow` is a
 * union now that the library carries grouping, and an ungrouped page's rows
 * are all leaves but the TYPE cannot know that.
 */
function codes(rows: ServerRow[]): string[] {
  return rows.filter((row): row is ServerReceipt => !isGroupRow(row)).map((row) => row.code)
}

async function codesFor(filter: FilterCondition): Promise<string[]> {
  const page = await fetchReceipts(query([SCOPE, filter]), { delayMs: 0 })
  return codes(page.rows).sort()
}

describe("fetchReceipts — text operators (case-insensitive)", () => {
  it("contains", async () => {
    expect(await codesFor({ kind: "text", field: "partner", op: "contains", value: "kimyo" })).toEqual([
      "KR-10003",
      "KR-10007",
    ])
  })

  it("notContains keeps every non-blank non-match, and no blank", async () => {
    expect(await codesFor({ kind: "text", field: "partner", op: "notContains", value: "kimyo" })).toEqual([
      "KR-10000",
      "KR-10001",
      "KR-10002",
      "KR-10004",
      "KR-10008",
      "KR-10009",
    ])
  })

  it("equals", async () => {
    expect(
      await codesFor({ kind: "text", field: "partner", op: "equals", value: "toshkent kimyo zavodi" }),
    ).toEqual(["KR-10003", "KR-10007"])
  })

  it("notEquals keeps every non-blank non-match, and no blank", async () => {
    expect(
      await codesFor({ kind: "text", field: "partner", op: "notEquals", value: "toshkent kimyo zavodi" }),
    ).toEqual(["KR-10000", "KR-10001", "KR-10002", "KR-10004", "KR-10008", "KR-10009"])
  })

  it("startsWith", async () => {
    expect(await codesFor({ kind: "text", field: "partner", op: "startsWith", value: "tosh" })).toEqual([
      "KR-10003",
      "KR-10007",
    ])
  })

  it("endsWith", async () => {
    expect(await codesFor({ kind: "text", field: "partner", op: "endsWith", value: "zavodi" })).toEqual([
      "KR-10003",
      "KR-10007",
    ])
  })
})

describe("fetchReceipts — number operators", () => {
  it("eq", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "eq", value: 310_000 })).toEqual(["KR-10000"])
  })

  it("ne keeps every non-blank non-match, and no blank", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "ne", value: 310_000 })).toEqual([
      "KR-10001",
      "KR-10002",
      "KR-10003",
      "KR-10004",
      "KR-10005",
      "KR-10006",
      "KR-10007",
      "KR-10009",
    ])
  })

  it("lt", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "lt", value: 2_000_000 })).toEqual([
      "KR-10000",
      "KR-10001",
    ])
  })

  it("lte is inclusive at the boundary", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "lte", value: 2_146_466 })).toEqual([
      "KR-10000",
      "KR-10001",
      "KR-10002",
    ])
  })

  it("gt", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "gt", value: 8_000_000 })).toEqual(["KR-10009"])
  })

  it("gte is inclusive at the boundary, and still drops the blank amount", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "gte", value: 6_737_631 })).toEqual([
      "KR-10007",
      "KR-10009",
    ])
  })

  it("between is inclusive on both ends", async () => {
    expect(
      await codesFor({ kind: "number", field: "amount", op: "between", from: 1_228_233, to: 3_064_699 }),
    ).toEqual(["KR-10001", "KR-10002", "KR-10003"])
  })

  it("between treats a null bound as unbounded without letting a blank through", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "between", from: null, to: 1_228_233 })).toEqual([
      "KR-10000",
      "KR-10001",
    ])
    expect(await codesFor({ kind: "number", field: "amount", op: "between", from: 6_000_000, to: null })).toEqual([
      "KR-10007",
      "KR-10009",
    ])
  })
})

describe("fetchReceipts — date range: from inclusive, before exclusive", () => {
  it("keeps the lower bound and drops the upper", async () => {
    expect(
      await codesFor({ kind: "date", field: "date", op: "range", from: "2026-03-03", before: "2026-06-06" }),
    ).toEqual(["KR-10002", "KR-10003", "KR-10004"])
  })

  it("supports a null (unbounded) start", async () => {
    expect(await codesFor({ kind: "date", field: "date", op: "range", from: null, before: "2026-02-02" })).toEqual([
      "KR-10000",
    ])
  })
})

describe("fetchReceipts — boolean and list operators", () => {
  it("boolean is", async () => {
    expect(await codesFor({ kind: "boolean", field: "flagged", op: "is", value: true })).toEqual([
      "KR-10000",
      "KR-10007",
    ])
  })

  it("list in", async () => {
    expect(await codesFor({ kind: "list", field: "status", op: "in", values: ["open", "closed"] })).toEqual([
      "KR-10000",
      "KR-10003",
      "KR-10004",
      "KR-10007",
      "KR-10008",
    ])
  })

  it("list notIn", async () => {
    expect(await codesFor({ kind: "list", field: "status", op: "notIn", values: ["open", "closed"] })).toEqual([
      "KR-10001",
      "KR-10002",
      "KR-10005",
      "KR-10006",
      "KR-10009",
    ])
  })
})

describe("fetchReceipts — blank / notBlank partition every column", () => {
  it("finds both shapes of a blank text column, null and the empty string", async () => {
    expect(await codesFor({ kind: "text", field: "partner", op: "blank" })).toEqual(BLANK_PARTNER)
    expect(await codesFor({ kind: "text", field: "partner", op: "notBlank" })).toEqual(NON_BLANK_PARTNER)
  })

  it("finds a blank number column", async () => {
    expect(await codesFor({ kind: "number", field: "amount", op: "blank" })).toEqual(BLANK_AMOUNT)
    expect(await codesFor({ kind: "number", field: "amount", op: "notBlank" })).toEqual(NON_BLANK_AMOUNT)
  })

  it("matches nothing on a column that is never blank", async () => {
    expect(await codesFor({ kind: "date", field: "date", op: "blank" })).toEqual([])
    expect(await codesFor({ kind: "boolean", field: "flagged", op: "notBlank" })).toEqual(SCOPE_CODES)
  })
})

describe("fetchReceipts — quick search: AND over tokens, OR over fields", () => {
  it("requires every token, letting different tokens match different fields", async () => {
    const page = await fetchReceipts(
      query([SCOPE], { search: { text: "kimyo 10007", fields: ["partner", "code"] } }),
      { delayMs: 0 },
    )
    expect(codes(page.rows)).toEqual(["KR-10007"])
  })

  it("matches nothing when one token matches no field at all", async () => {
    const page = await fetchReceipts(
      query([SCOPE], { search: { text: "kimyo zzzz", fields: ["partner", "code"] } }),
      { delayMs: 0 },
    )
    expect(page.rows).toEqual([])
  })

  it("never matches a blank column, and never excludes on one either", async () => {
    const page = await fetchReceipts(
      query([SCOPE], { search: { text: "10006", fields: ["partner", "code"] } }),
      { delayMs: 0 },
    )
    // The row's own `partner` is `""`; the token is found in `code` instead.
    expect(codes(page.rows)).toEqual(["KR-10006"])
  })
})

describe("fetchReceipts — sorting and pagination", () => {
  it("sorts by the requested column and direction", async () => {
    const page = await fetchReceipts(query([SCOPE], { sorting: [{ id: "amount", desc: false }] }), { delayMs: 0 })
    expect(codes(page.rows)[0]).toBe("KR-10000")
  })

  it("orders blanks above every value, so they land last ascending and first descending", async () => {
    const ascending = await fetchReceipts(query([SCOPE], { sorting: [{ id: "amount", desc: false }] }), {
      delayMs: 0,
    })
    const descending = await fetchReceipts(query([SCOPE], { sorting: [{ id: "amount", desc: true }] }), {
      delayMs: 0,
    })
    // Postgres' documented default: NULLs sort as greater than every value.
    expect(codes(ascending.rows).at(-1)).toBe("KR-10008")
    expect(codes(descending.rows)[0]).toBe("KR-10008")
    expect(codes(descending.rows)[1]).toBe("KR-10009")
  })

  it("slices by pageIndex/pageSize and reports the total that matched", async () => {
    const page = await fetchReceipts(query([SCOPE], { pagination: { pageIndex: 1, pageSize: 3 } }), { delayMs: 0 })
    expect(codes(page.rows)).toEqual(["KR-10003", "KR-10004", "KR-10005"])
    expect(page.total).toBe(10)
  })
})

describe("fetchReceipts — unfilteredTotal", () => {
  it("always answers it, matching total when nothing is narrowing the result", async () => {
    const page = await fetchReceipts(query([]), { delayMs: 0 })
    expect(page.unfilteredTotal).toBe(page.total)
    // The whole generated set — see `ROW_COUNT` — not a guess about it.
    expect(page.unfilteredTotal).toBe(100_000)
  })

  it("reports the wider count once a filter narrows the result", async () => {
    const page = await fetchReceipts(query([SCOPE]), { delayMs: 0 })
    expect(page.total).toBe(10)
    expect(page.unfilteredTotal).toBe(100_000)
  })

  it("groups the unfiltered count the same way total is grouped, rather than echoing ALL's raw length", async () => {
    // No filter, so `total` already IS the grouped, unfiltered answer: one
    // header per distinct status (four). `unfilteredTotal` has to walk the
    // same grouping pipeline over ALL and land on the same small number —
    // proving it, not the 100 000 raw records, is what got grouped.
    const page = await fetchReceipts(query([], { grouping: ["status"] }), { delayMs: 0 })
    expect(page.total).toBe(4)
    expect(page.unfilteredTotal).toBe(4)
  })

  it("keeps reflecting the grouping once a filter also narrows the result", async () => {
    const page = await fetchReceipts(query([SCOPE], { grouping: ["status"] }), { delayMs: 0 })
    // The ten SCOPE rows still cover every status, so the filtered header
    // count is four too — the meaningful assertion is that the unfiltered
    // side is still the grouped four, not the raw 100 000.
    expect(page.unfilteredTotal).toBe(4)
    expect(page.unfilteredTotal).toBeLessThan(100_000)
  })
})

describe("fetchReceipts — the injected failure", () => {
  it("rejects instead of resolving when fail is requested", async () => {
    await expect(fetchReceipts(query([SCOPE]), { fail: true, delayMs: 0 })).rejects.toThrow(
      "Simulated network failure",
    )
  })
})

describe("fetchReceipts — cancelling a superseded request", () => {
  it("rejects with AbortError when the signal aborts in flight", async () => {
    const controller = new AbortController()
    const pending = fetchReceipts(query([SCOPE]), { delayMs: 50, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  it("settles rather than hanging when the signal is already aborted", async () => {
    const controller = new AbortController()
    // A request superseded before it even started: the signal fires no `abort`
    // event, so a naive listener would leave this promise pending forever and
    // a caller that clears its loading flag on settle would spin indefinitely.
    controller.abort()
    await expect(
      fetchReceipts(query([SCOPE]), { delayMs: 0, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" })
  })

  it("still resolves normally when the signal never aborts", async () => {
    const controller = new AbortController()
    const page = await fetchReceipts(query([SCOPE]), { delayMs: 0, signal: controller.signal })
    expect(page.total).toBe(10)
  })
})

describe("fetchValues", () => {
  it("returns every distinct value with its count", async () => {
    const controller = new AbortController()
    const values = await fetchValues("status", { search: "", signal: controller.signal })
    const byValue = new Map(values.map((option) => [option.value, option.count]))
    expect(byValue.get("open")).toBe(25_000)
    expect(byValue.get("in_process")).toBe(25_000)
    expect(byValue.get("received")).toBe(25_000)
    expect(byValue.get("closed")).toBe(25_000)
  })

  it("filters distinct values by the editor's search box", async () => {
    const controller = new AbortController()
    const values = await fetchValues("status", { search: "clo", signal: controller.signal })
    expect(values.map((option) => option.value)).toEqual(["closed"])
  })

  it("offers no blank option, because a selection containing one would match nothing", async () => {
    const controller = new AbortController()
    const values = await fetchValues("partner", { search: "", signal: controller.signal })
    expect(values.map((option) => option.value)).not.toContain("")
    // Each of the four partners loses exactly one row per twenty to a blank.
    expect(values).toHaveLength(4)
    expect(values.every((option) => option.count === 20_000)).toBe(true)
  })

  it("keeps a value's own primitive type, so the condition it builds still matches", async () => {
    const controller = new AbortController()
    const values = await fetchValues("flagged", { search: "", signal: controller.signal })
    // `"true"` would look identical in the list and then select nothing: the
    // comparison at the far end is `===` against a real boolean.
    expect(values.every((option) => typeof option.value === "boolean")).toBe(true)
    expect(new Map(values.map((option) => [option.value, option.count])).get(true)).toBe(14_286)
  })

  it("rejects when the caller aborts an in-flight request", async () => {
    const controller = new AbortController()
    const pending = fetchValues("status", { search: "", signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow("Aborted")
  })

  it("rejects a signal that was already aborted before the call", async () => {
    const controller = new AbortController()
    controller.abort()
    // An already-aborted signal fires no `abort` event: a request superseded
    // before it started would otherwise never settle, and the editor's
    // spinner would never clear.
    await expect(fetchValues("status", { search: "", signal: controller.signal })).rejects.toThrow("Aborted")
  })

  it("labels the Status options in the caller's language, English by default", async () => {
    const controller = new AbortController()
    const values = await fetchValues("status", { search: "", signal: controller.signal })
    const byValue = new Map(values.map((option) => [option.value, option.label]))
    expect(byValue.get("closed")).toBe("Closed")
    expect(byValue.get("in_process")).toBe("In process")
  })

  it("labels the Status options in whichever language it is asked for", async () => {
    const controller = new AbortController()
    const values = await fetchValues("status", { search: "", signal: controller.signal }, "ru")
    const byValue = new Map(values.map((option) => [option.value, option.label]))
    expect(byValue.get("closed")).toBe("Закрыт")
  })

  it("leaves a column with no translation unlabelled", async () => {
    // `partner` values are already the text a user reads — there is nothing
    // for a label to translate them into.
    const controller = new AbortController()
    const values = await fetchValues("partner", { search: "", signal: controller.signal }, "ru")
    expect(values.every((option) => option.label === undefined)).toBe(true)
  })
})

/**
 * The library's filter function, called the way its own docblock prescribes
 * for a direct call: it reads the value off a row, and `getValue` is the only
 * member it or the TanStack built-ins it delegates to ever touch.
 */
interface TestRow {
  v: unknown
}
const rowWith = (value: unknown): Row<DataTableFeatures, TestRow> =>
  ({ getValue: () => value }) as unknown as Row<DataTableFeatures, TestRow>

function libraryMatches(condition: FilterCondition, value: unknown): boolean {
  return filterFn_dt(rowWith(value), "v", filterFn_dt.resolveFilterValue?.(condition) ?? condition)
}

/** Every operator of one kind, against values that column could really hold. */
interface AgreementCase {
  kind: string
  conditions: FilterCondition[]
  values: unknown[]
}

const BLANKS: unknown[] = [null, undefined, ""]

/**
 * `field` is `"v"` throughout, because {@link libraryMatches} reads the value
 * off a single-column stub row — the field name is what selects a column, and
 * both sides are already being handed the same value.
 */
const AGREEMENT: AgreementCase[] = [
  {
    kind: "text",
    conditions: (["contains", "notContains", "equals", "notEquals", "startsWith", "endsWith"] as const).map(
      (op) => ({ kind: "text", field: "v", op, value: "Kimyo" }),
    ),
    values: ["Toshkent Kimyo Zavodi", "toshkent kimyo zavodi", "Kimyo", "kimyo tail", "head Kimyo", "x", ...BLANKS],
  },
  {
    kind: "number",
    conditions: [
      ...(["eq", "ne", "lt", "lte", "gt", "gte"] as const).map(
        (op): FilterCondition => ({ kind: "number", field: "v", op, value: 2_146_466 }),
      ),
      { kind: "number", field: "v", op: "between", from: 1_228_233, to: 3_064_699 },
      { kind: "number", field: "v", op: "between", from: null, to: 3_064_699 },
      { kind: "number", field: "v", op: "between", from: 1_228_233, to: null },
    ],
    // `0` is not blank, and a `between` implemented over TanStack's own
    // `inNumberRange` with `-Infinity`/`+Infinity` ends is exactly where a
    // coerced blank would sneak back in as a zero.
    values: [0, -5, 310_000, 1_228_233, 2_146_466, 3_064_699, 8_574_097, ...BLANKS],
  },
  {
    kind: "date",
    conditions: [
      { kind: "date", field: "v", op: "range", from: "2026-03-03", before: "2026-06-06" },
      { kind: "date", field: "v", op: "range", from: null, before: "2026-06-06" },
      { kind: "date", field: "v", op: "range", from: "2026-03-03", before: null },
    ],
    // Day strings only. The library also accepts a `Date` and a timestamp for
    // a date column; this endpoint stores `YYYY-MM-DD` and says so, and a
    // shape it never serves is not a disagreement about the contract.
    values: ["2026-01-01", "2026-03-03", "2026-06-05", "2026-06-06", "2026-12-31", ...BLANKS],
  },
  {
    kind: "boolean",
    conditions: [
      { kind: "boolean", field: "v", op: "is", value: true },
      { kind: "boolean", field: "v", op: "is", value: false },
    ],
    values: [true, false, ...BLANKS],
  },
  {
    kind: "list",
    conditions: [
      { kind: "list", field: "v", op: "in", values: ["open", "closed"] },
      { kind: "list", field: "v", op: "notIn", values: ["open", "closed"] },
    ],
    values: ["open", "closed", "in_process", "OPEN", ...BLANKS],
  },
]

/**
 * A condition as it would actually arrive at a backend.
 *
 * Only canonical conditions reach the wire — `buildQuery` publishes what the
 * constructors returned, which orders reversed bounds and sorts a list's
 * `values`. Running each case through the same door is what lets
 * `matchesFilter` skip re-validating its input and still be comparable with
 * the client, and it fails loudly on a case that constrains nothing rather
 * than quietly comparing two "match everything" answers.
 *
 * @param condition - A condition written by hand in this file.
 * @returns Its canonical form.
 */
function canonical(condition: FilterCondition): FilterCondition {
  const rebuilt = rebuildCondition(condition)
  if (rebuilt === null) throw new Error(`not a publishable condition: ${JSON.stringify(condition)}`)
  return rebuilt
}

/** `blank` and `notBlank` are the same two operators on every kind. */
const BLANKNESS_OPS = ["blank", "notBlank"] as const

describe("the fake server and filterFn_dt agree on every operator", () => {
  for (const group of AGREEMENT) {
    it(`agrees on ${group.kind}`, () => {
      const disagreements: string[] = []
      for (const condition of group.conditions.map(canonical)) {
        for (const value of group.values) {
          const server = matchesFilter(value, condition)
          const client = libraryMatches(condition, value)
          if (server !== client) {
            disagreements.push(
              `${JSON.stringify(condition)} vs ${JSON.stringify(value) ?? "undefined"}: server ${server}, client ${client}`,
            )
          }
        }
      }
      expect(disagreements).toEqual([])
    })
  }

  it("agrees on blank and notBlank across every kind", () => {
    const disagreements: string[] = []
    for (const group of AGREEMENT) {
      for (const op of BLANKNESS_OPS) {
        const condition = canonical({ kind: group.kind, field: "v", op } as FilterCondition)
        for (const value of [...group.values, ...BLANKS]) {
          const server = matchesFilter(value, condition)
          const client = libraryMatches(condition, value)
          if (server !== client) {
            disagreements.push(`${group.kind}/${op} vs ${JSON.stringify(value) ?? "undefined"}`)
          }
        }
      }
    }
    expect(disagreements).toEqual([])
  })

  it("selects the same rows end to end as the client would from the same query", async () => {
    const conditions: FilterCondition[] = [
      { kind: "text", field: "partner", op: "notContains", value: "kimyo" },
      { kind: "text", field: "partner", op: "blank" },
      { kind: "number", field: "amount", op: "gte", value: 6_737_631 },
      { kind: "number", field: "amount", op: "between", from: null, to: 3_064_699 },
      { kind: "date", field: "date", op: "range", from: "2026-03-03", before: "2026-06-06" },
      { kind: "boolean", field: "flagged", op: "is", value: true },
      { kind: "list", field: "status", op: "notIn", values: ["open", "closed"] },
    ]
    const all = await fetchReceipts(query([SCOPE]), { delayMs: 0 })
    // Ungrouped, so every row is a receipt — narrowed once here rather than at
    // each read, since the page's TYPE is the union either way.
    const allLeaves = all.rows.filter((row): row is ServerReceipt => !isGroupRow(row))
    for (const condition of conditions.map(canonical)) {
      const server = await codesFor(condition)
      const client = allLeaves
        .filter((row) => libraryMatches(condition, row[condition.field as keyof ServerReceipt]))
        .map((row) => row.code)
        .sort()
      expect({ condition, codes: server }).toEqual({ condition, codes: client })
    }
  })
})

/**
 * Grouping: the wire shape of section 2, driven against the only thing that
 * has to answer it honestly.
 *
 * The same ten-row scope as every test above, so each group's membership can
 * be read straight off the table in this file's opening docblock:
 *
 * | code     | status     | partner                    |
 * |----------|------------|----------------------------|
 * | KR-10000 | open       | Oʻzbekiston Temir Yoʻllari |
 * | KR-10001 | in_process | Gʻallaorol Agro MChJ       |
 * | KR-10002 | received   | ООО «Северный Путь»        |
 * | KR-10003 | closed     | Toshkent Kimyo Zavodi      |
 * | KR-10004 | open       | Oʻzbekiston Temir Yoʻllari |
 * | KR-10005 | in_process | null                       |
 * | KR-10006 | received   | ""                         |
 * | KR-10007 | closed     | Toshkent Kimyo Zavodi      |
 * | KR-10008 | open       | Oʻzbekiston Temir Yoʻllari |
 * | KR-10009 | in_process | Gʻallaorol Agro MChJ       |
 */
const P_UZ = "Oʻzbekiston Temir Yoʻllari"
const P_GA = "Gʻallaorol Agro MChJ"
const P_RU = "ООО «Северный Путь»"
const P_TK = "Toshkent Kimyo Zavodi"

/** A query with the two grouping fields, as {@link TableQuery} carries them. */
function groupedQuery(overrides: Partial<TableQuery> = {}): TableQuery {
  return {
    sorting: [],
    filters: [SCOPE],
    search: null,
    grouping: [],
    expanded: [],
    pagination: { pageIndex: 0, pageSize: 50 },
    ...overrides,
  }
}

/**
 * A flattened page as one readable list.
 *
 * Asserting on strings rather than on objects because the thing under test is
 * an *order* of mixed rows: `["group open (3)", "leaf KR-10000", ...]` fails
 * with a diff a reader can act on, where an array of two different object
 * shapes does not.
 */
function describeRows(rows: ServerRow[]): string[] {
  return rows.map((row) =>
    isGroupRow(row) ? `group ${row.path.join(" / ")} (${row.count})` : `leaf ${row.code}`,
  )
}

async function flattened(overrides: Partial<TableQuery>): Promise<string[]> {
  const page = await fetchReceipts(groupedQuery(overrides), { delayMs: 0 })
  return describeRows(page.rows)
}

describe("fetchReceipts — grouping, one level", () => {
  it("returns one group row per distinct value, ordered by key, when nothing is open", async () => {
    expect(await flattened({ grouping: ["status"] })).toEqual([
      "group closed (2)",
      "group in_process (3)",
      "group open (3)",
      "group received (2)",
    ])
  })

  it("counts leaves, so the counts of a level sum to the rows that matched", async () => {
    const page = await fetchReceipts(groupedQuery({ grouping: ["status"] }), { delayMs: 0 })
    const total = page.rows.filter(isGroupRow).reduce((sum, row) => sum + row.count, 0)
    expect(total).toBe(10)
    // And the page's own total is the flattened list, not the leaves: four
    // group rows are four rows the pager has to page past.
    expect(page.total).toBe(4)
  })

  it("emits a group's leaves only when its path is open", async () => {
    expect(await flattened({ grouping: ["status"], expanded: [["open"]] })).toEqual([
      "group closed (2)",
      "group in_process (3)",
      "group open (3)",
      "leaf KR-10000",
      "leaf KR-10004",
      "leaf KR-10008",
      "group received (2)",
    ])
  })

  it("ignores a path that names no group, rather than failing or emptying the page", async () => {
    expect(await flattened({ grouping: ["status"], expanded: [["no-such-status"]] })).toEqual([
      "group closed (2)",
      "group in_process (3)",
      "group open (3)",
      "group received (2)",
    ])
  })
})

describe("fetchReceipts — grouping, two levels", () => {
  it("nests the second level inside the first, opening one branch at a time", async () => {
    expect(
      await flattened({ grouping: ["status", "partner"], expanded: [["in_process"], ["in_process", P_GA]] }),
    ).toEqual([
      "group closed (2)",
      "group in_process (3)",
      `group in_process / ${P_GA} (2)`,
      "leaf KR-10001",
      "leaf KR-10009",
      "group in_process /  (1)",
      "group open (3)",
      "group received (2)",
    ])
  })

  it("gives an outer group the leaves beneath it at every depth, so its children's counts sum to it", async () => {
    const page = await fetchReceipts(
      groupedQuery({
        grouping: ["status", "partner"],
        expanded: [["closed"], ["in_process"], ["open"], ["received"]],
      }),
      { delayMs: 0 },
    )
    const groups = page.rows.filter(isGroupRow)
    const outer = groups.filter((row) => row.path.length === 1)
    const inner = groups.filter((row) => row.path.length === 2)
    // What a user reads on `in_process (3)` is "three receipts in there",
    // which is only true if the number keeps meaning leaves at every depth.
    for (const parent of outer) {
      const children = inner.filter((row) => row.path[0] === parent.path[0])
      expect({ path: parent.path, count: parent.count }).toEqual({
        path: parent.path,
        count: children.reduce((sum, child) => sum + child.count, 0),
      })
    }
    expect(outer.reduce((sum, row) => sum + row.count, 0)).toBe(10)
  })

  it("leaves an open path inert while its parent is closed", async () => {
    // The child is not on the page at all, so "open" cannot describe it. A
    // client may hold the deep path across a collapse; it simply does nothing
    // until the parent is opened again.
    expect(await flattened({ grouping: ["status", "partner"], expanded: [["open", P_UZ]] })).toEqual([
      "group closed (2)",
      "group in_process (3)",
      "group open (3)",
      "group received (2)",
    ])
  })
})

describe("fetchReceipts — a blank group key", () => {
  it("collapses both shapes of blankness into one group, keyed by the empty string", async () => {
    // `FilterValue` excludes null deliberately, so a key path cannot carry
    // one; and `blank` matches null and "" alike, so splitting them here would
    // put two group rows beside a "(Blanks)" filter that counts them as one.
    expect(await flattened({ grouping: ["partner"] })).toEqual([
      `group ${P_GA} (2)`,
      `group ${P_UZ} (3)`,
      `group ${P_TK} (2)`,
      `group ${P_RU} (1)`,
      "group  (2)",
    ])
  })

  it("opens the blank group by the empty-string path, like any other", async () => {
    expect(await flattened({ grouping: ["partner"], expanded: [[""]] })).toEqual([
      `group ${P_GA} (2)`,
      `group ${P_UZ} (3)`,
      `group ${P_TK} (2)`,
      `group ${P_RU} (1)`,
      "group  (2)",
      "leaf KR-10005",
      "leaf KR-10006",
    ])
  })

  it("agrees with the blank filter over the whole table", async () => {
    const grouped = await fetchReceipts(
      { ...groupedQuery({ grouping: ["partner"] }), filters: [] },
      { delayMs: 0 },
    )
    const blankGroup = grouped.rows.filter(isGroupRow).find((row) => row.path[0] === "")
    const filtered = await fetchReceipts(
      query([{ kind: "text", field: "partner", op: "blank" }], { pagination: { pageIndex: 0, pageSize: 1 } }),
      { delayMs: 0 },
    )
    // One null and one "" per ten rows, counted once by each side.
    expect(blankGroup?.count).toBe(20_000)
    expect(filtered.total).toBe(20_000)
  })

  it("puts the blank group last ascending and first descending, as blanks sort everywhere else", async () => {
    const descending = await flattened({ grouping: ["partner"], sorting: [{ id: "partner", desc: true }] })
    expect(descending[0]).toBe("group  (2)")
    expect(descending.at(-1)).toBe(`group ${P_GA} (2)`)
  })
})

describe("fetchReceipts — sorting a grouped table: within a level", () => {
  it("gives the sorted column's own level the direction, and leaves the others ascending", async () => {
    expect(
      await flattened({ grouping: ["status"], sorting: [{ id: "status", desc: true }], expanded: [["open"]] }),
    ).toEqual([
      "group received (2)",
      "group open (3)",
      "leaf KR-10000",
      "leaf KR-10004",
      "leaf KR-10008",
      "group in_process (3)",
      "group closed (2)",
    ])
  })

  it("orders leaves inside their own group, never moving one between groups", async () => {
    expect(
      await flattened({ grouping: ["status"], sorting: [{ id: "amount", desc: true }], expanded: [["open"]] }),
    ).toEqual([
      // The group rows stay ascending: the sort names `amount`, which is no
      // level's column.
      "group closed (2)",
      "group in_process (3)",
      "group open (3)",
      // Blank amounts rank above every value, so KR-10008's null comes first
      // descending — the same rule the ungrouped page follows.
      "leaf KR-10008",
      "leaf KR-10004",
      "leaf KR-10000",
      "group received (2)",
    ])
  })

  it("sorts a grouped column's headers and not its leaves, which all share that value", async () => {
    const ascending = await flattened({ grouping: ["status"], expanded: [["open"]] })
    const descending = await flattened({
      grouping: ["status"],
      sorting: [{ id: "status", desc: true }],
      expanded: [["open"]],
    })
    const leaves = (rows: string[]): string[] => rows.filter((row) => row.startsWith("leaf"))
    expect(leaves(descending)).toEqual(leaves(ascending))
  })
})

describe("fetchReceipts — paging a flattened, grouped result", () => {
  /**
   * The flattened list this section pages, in full:
   *
   * `0 group closed`, `1 group in_process`, `2 group open`, `3 leaf KR-10000`,
   * `4 leaf KR-10004`, `5 leaf KR-10008`, `6 group received` — seven rows.
   */
  const PAGED = { grouping: ["status"], expanded: [["open"]] } satisfies Partial<TableQuery>

  it("pages the flattened rows and totals them, group rows included", async () => {
    const page = await fetchReceipts(
      groupedQuery({ ...PAGED, pagination: { pageIndex: 0, pageSize: 3 } }),
      { delayMs: 0 },
    )
    expect(describeRows(page.rows)).toEqual(["group closed (2)", "group in_process (3)", "group open (3)"])
    expect(page.total).toBe(7)
  })

  it("hands back a page of orphan leaves when the boundary falls inside a group", async () => {
    const page = await fetchReceipts(
      groupedQuery({ ...PAGED, pagination: { pageIndex: 1, pageSize: 3 } }),
      { delayMs: 0 },
    )
    /*
     * The ugly case, and the one `startPath` exists for. The page is three
     * receipts with no group row above them, and a leaf carries no `path`, so
     * nothing IN the rows says which group they belong to — the user would see
     * rows under nothing and a client could draw no "continued" header. The
     * page itself answers it instead.
     */
    expect(describeRows(page.rows)).toEqual(["leaf KR-10000", "leaf KR-10004", "leaf KR-10008"])
    expect(page.rows.every((row) => !isGroupRow(row))).toBe(true)
    expect(page.startPath).toEqual(["open"])
  })

  it("says a page's first row sits at the top level when it does", async () => {
    const page = await fetchReceipts(
      groupedQuery({ ...PAGED, pagination: { pageIndex: 0, pageSize: 3 } }),
      { delayMs: 0 },
    )
    // The first row is a top-level group header; it is inside nothing.
    expect(page.startPath).toEqual([])
  })

  it("says nothing about a container for an ungrouped page", async () => {
    const page = await fetchReceipts(groupedQuery({}), { delayMs: 0 })
    expect(page.startPath).toEqual([])
  })

  it("reports the innermost open group a nested page starts inside", async () => {
    /*
     * `received` open and `ООО «Северный Путь»` open inside it. Flattened:
     * `0 closed`, `1 in_process`, `2 open`, `3 received`, `4 ООО …`,
     * `5 leaf KR-10002`. A page starting at row 5 is one orphan leaf whose
     * container is the SECOND-level group, not the first.
     */
    const page = await fetchReceipts(
      groupedQuery({
        grouping: ["status", "partner"],
        expanded: [["received"], ["received", P_RU]],
        pagination: { pageIndex: 5, pageSize: 1 },
      }),
      { delayMs: 0 },
    )
    expect(describeRows(page.rows)).toEqual(["leaf KR-10002"])
    expect(page.startPath).toEqual(["received", P_RU])
  })

  it("lets a group row end a page and its children start the next", async () => {
    const first = await fetchReceipts(
      groupedQuery({ ...PAGED, pagination: { pageIndex: 2, pageSize: 1 } }),
      { delayMs: 0 },
    )
    const second = await fetchReceipts(
      groupedQuery({ ...PAGED, pagination: { pageIndex: 3, pageSize: 1 } }),
      { delayMs: 0 },
    )
    // Benign, unlike the case above: the header is visible on its own page and
    // the count on it already told the user what is coming.
    expect(describeRows(first.rows)).toEqual(["group open (3)"])
    expect(describeRows(second.rows)).toEqual(["leaf KR-10000"])
  })
})

describe("fetchReceipts — grouping composed with filtering and search", () => {
  it("filters before it groups, so a count never describes rows the filter removed", async () => {
    // Without the blank partner rows: KR-10005 leaves in_process and KR-10006
    // leaves received. Grouping first and filtering after would report
    // `in_process (3)` above two rows.
    expect(
      await flattened({
        filters: [SCOPE, { kind: "text", field: "partner", op: "notBlank" }],
        grouping: ["status"],
        expanded: [["in_process"]],
      }),
    ).toEqual([
      "group closed (2)",
      "group in_process (2)",
      "leaf KR-10001",
      "leaf KR-10009",
      "group open (3)",
      "group received (1)",
    ])
  })

  it("searches before it groups, and shows only the groups that survived", async () => {
    expect(
      await flattened({
        search: { text: "kimyo", fields: ["partner"] },
        grouping: ["status"],
        expanded: [["closed"]],
      }),
    ).toEqual(["group closed (2)", "leaf KR-10003", "leaf KR-10007"])
  })

  it("changes neither the filtering nor the ungrouped total", async () => {
    const ungrouped = await fetchReceipts(groupedQuery({}), { delayMs: 0 })
    const grouped = await fetchReceipts(
      groupedQuery({
        grouping: ["status"],
        expanded: [["closed"], ["in_process"], ["open"], ["received"]],
      }),
      { delayMs: 0 },
    )
    const leafCodes = (rows: ServerRow[]): string[] =>
      rows.filter((row) => !isGroupRow(row)).map((row) => (row as ServerReceipt).code).sort()
    // The same rows select, whatever they are grouped by; only their order and
    // the headers between them change.
    expect(leafCodes(grouped.rows)).toEqual(leafCodes(ungrouped.rows))
    expect(ungrouped.total).toBe(10)
  })

  it("groups nothing on a column this endpoint does not serve", async () => {
    // The same rule a condition on an unknown column follows: it constrains
    // nothing, rather than emptying the page or inventing a blank group.
    expect(await flattened({ grouping: ["no-such-column"] })).toEqual(
      describeRows((await fetchReceipts(groupedQuery({}), { delayMs: 0 })).rows),
    )
  })
})

describe("fetchReceipts — grouping at the size the playground actually holds", () => {
  it("opens a twenty-five-thousand-row group and still hands back fifty rows", async () => {
    const page = await fetchReceipts(
      {
        sorting: [],
        filters: [],
        search: null,
        grouping: ["status"],
        expanded: [["open"]],
        pagination: { pageIndex: 0, pageSize: 50 },
      },
      { delayMs: 0 },
    )
    // Four headers and every leaf of the open one: the flattened list is the
    // whole visible table, and the page is a window on it. Building it by
    // spreading the leaves into an array would overflow the call stack here,
    // which is why `flattenGroups` loops.
    expect(page.total).toBe(4 + 25_000)
    expect(page.rows).toHaveLength(50)
    expect(describeRows(page.rows.slice(0, 4))).toEqual([
      "group closed (25000)",
      "group in_process (25000)",
      "group open (25000)",
      "leaf KR-10000",
    ])
  })
})
