import { describe, expect, it } from "vitest"
import {
  groupRowId,
  isGroupRow,
  isPathExpanded,
  normaliseExpanded,
  pathsEqual,
  pruneExpanded,
  pruneGrouping,
  togglePath,
  type GroupRow,
} from "./grouping"

/**
 * The small functions every consumer of a grouped page needs, tested on their
 * own because the interesting cases are not reachable from a rendered table:
 * a key containing the separator, a stored path deeper than the grouping, a
 * host row that happens to carry a `kind`.
 */

const group = (path: GroupRow["path"], count = 1): GroupRow => ({ kind: "group", path, count })

describe("isGroupRow", () => {
  it("recognises a group header and nothing else", () => {
    expect(isGroupRow(group(["open"]))).toBe(true)
    expect(isGroupRow({ id: "r0", name: "Agro" })).toBe(false)
    expect(isGroupRow(null)).toBe(false)
    expect(isGroupRow("group")).toBe(false)
  })

  it("refuses a row that carries the discriminant but not the shape", () => {
    // A host row with `kind: "group"` and no path is a host row. The
    // discriminant alone is not enough to start reading `path.at(-1)` off it.
    expect(isGroupRow({ kind: "group" })).toBe(false)
    expect(isGroupRow({ kind: "group", path: ["open"] })).toBe(false)
  })
})

describe("groupRowId", () => {
  it("is the key path, joined", () => {
    expect(groupRowId(["received", "Acme"])).toBe('"received"/"Acme"')
  })

  it("keeps two different paths apart when a key contains the separator", () => {
    // A bare join would make these the same id: one React key for two rows,
    // and one expansion target for two groups.
    expect(groupRowId(["a/b"])).not.toBe(groupRowId(["a", "b"]))
  })

  it("keeps a number apart from its own text", () => {
    expect(groupRowId([1])).not.toBe(groupRowId(["1"]))
  })

  it("is stable across refetches, being a pure function of the path", () => {
    expect(groupRowId(["open"])).toBe(groupRowId(["open"]))
  })
})

describe("pathsEqual / isPathExpanded", () => {
  it("compares element-wise", () => {
    expect(pathsEqual(["a", 1], ["a", 1])).toBe(true)
    expect(pathsEqual(["a"], ["a", 1])).toBe(false)
  })

  it("is exact, not by prefix: a child's path does not open its parent", () => {
    expect(isPathExpanded([["a", "b"]], ["a"])).toBe(false)
    expect(isPathExpanded([["a"]], ["a"])).toBe(true)
  })
})

describe("togglePath", () => {
  it("opens a closed group and closes an open one", () => {
    expect(togglePath([], ["open"])).toEqual([["open"]])
    expect(togglePath([["open"]], ["open"])).toEqual([])
  })

  it("closing a group drops the paths beneath it", () => {
    // Left behind they are inert — the server never emits a group whose parent
    // is shut — but they would ride on every query for ever.
    const open = [["a"], ["a", "b"], ["a", "b", "c"], ["z"]]
    expect(togglePath(open, ["a"])).toEqual([["z"]])
  })

  it("leaves a sibling alone", () => {
    expect(togglePath([["a"], ["ab"]], ["a"])).toEqual([["ab"]])
  })
})

describe("normaliseExpanded", () => {
  it("makes the array a function of the open SET, whatever order it was built in", () => {
    // `queriesEqual` stringifies the whole query, so opening A then B has to
    // produce the same array as opening B then A or a host refetches a page it
    // already has.
    expect(normaliseExpanded([["b"], ["a"]])).toEqual(normaliseExpanded([["a"], ["b"]]))
  })

  it("drops duplicates", () => {
    expect(normaliseExpanded([["a"], ["a"]])).toEqual([["a"]])
  })

  it("copies each path rather than aliasing the caller's array", () => {
    const path = ["a"]
    const [copied] = normaliseExpanded([path])
    expect(copied).toEqual(["a"])
    expect(copied).not.toBe(path)
  })
})

describe("pruneGrouping", () => {
  it("drops a group on a column the table no longer defines", () => {
    expect(pruneGrouping(["status", "ghost"], ["status", "partner"])).toEqual(["status"])
  })

  it("drops a repeated column, whose inner level would hold one key", () => {
    expect(pruneGrouping(["status", "status"], ["status"])).toEqual(["status"])
  })

  it("keeps the order, which is the nesting", () => {
    expect(pruneGrouping(["partner", "status"], ["status", "partner"])).toEqual([
      "partner",
      "status",
    ])
  })

  it("survives untrusted JSON", () => {
    expect(pruneGrouping(null, ["status"])).toEqual([])
    expect(pruneGrouping("status", ["status"])).toEqual([])
    expect(pruneGrouping([null, 3, "status"], ["status"])).toEqual(["status"])
  })
})

describe("pruneExpanded", () => {
  it("drops a path deeper than the grouping", () => {
    expect(pruneExpanded([["a"], ["a", "b"]], 1)).toEqual([["a"]])
  })

  it("drops a key that could not travel as JSON", () => {
    expect(pruneExpanded([["a"], [null], [{}]], 2)).toEqual([["a"]])
  })

  it("is empty for an ungrouped table, whatever was stored", () => {
    expect(pruneExpanded([["a"]], 0)).toEqual([])
  })

  it("survives untrusted JSON", () => {
    expect(pruneExpanded(null, 2)).toEqual([])
    expect(pruneExpanded(["a"], 2)).toEqual([])
    expect(pruneExpanded([[]], 2)).toEqual([])
  })
})
