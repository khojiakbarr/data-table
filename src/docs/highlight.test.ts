import { describe, expect, it } from "vitest"
import { highlight, type CodeLanguage, type Token } from "./highlight"

/** The tokens of one type, as text, in order. */
const ofType = (tokens: Token[], type: Token["type"]) =>
  tokens.filter((token) => token.type === type).map((token) => token.text)

const SAMPLES: [CodeLanguage, string][] = [
  ["tsx", 'const table = useDataTable({ id: "receipts", data }) // one\n<DataTable instance={table} />'],
  ["json", '{ "kind": "number", "from": 1000000, "to": null }'],
  ["sql", "SELECT COUNT(*) FROM receipts -- all\nWHERE col IS NULL OR col::text = ''"],
  ["css", ".dt-root.dt-root {\n  --dt-radius: 6px; /* edges */\n}"],
  ["bash", "npm i @hojiakbar_dev/data-table # the table"],
]

describe("highlight", () => {
  it("loses no character of the source, in any language", () => {
    for (const [language, source] of SAMPLES) {
      expect(highlight(source, language).map((token) => token.text).join("")).toBe(source)
    }
  })

  it("marks TypeScript keywords, strings, comments and component names", () => {
    const tokens = highlight(SAMPLES[0]![1], "tsx")
    expect(ofType(tokens, "keyword")).toEqual(["const"])
    expect(ofType(tokens, "string")).toEqual(['"receipts"'])
    expect(ofType(tokens, "comment")).toEqual(["// one"])
    expect(ofType(tokens, "type")).toEqual(["DataTable"])
  })

  it("does not read a keyword out of the middle of an identifier", () => {
    const tokens = highlight("const constant = newValue", "ts")
    expect(ofType(tokens, "keyword")).toEqual(["const"])
  })

  it("stops a quoted string at the end of its line", () => {
    // An apostrophe in prose must not colour the rest of the block.
    const tokens = highlight("it's\nconst x = 1", "tsx")
    expect(ofType(tokens, "keyword")).toEqual(["const"])
  })

  it("lets a template literal span lines", () => {
    const tokens = highlight("`a\nb`", "ts")
    expect(ofType(tokens, "string")).toEqual(["`a\nb`"])
  })

  it("reads SQL keywords in either case and its own comment syntax", () => {
    const tokens = highlight("select 1 FROM t -- note", "sql")
    expect(ofType(tokens, "keyword")).toEqual(["select", "FROM"])
    expect(ofType(tokens, "comment")).toEqual(["-- note"])
    expect(ofType(tokens, "number")).toEqual(["1"])
  })

  it("marks JSON keys apart from JSON values", () => {
    const tokens = highlight(SAMPLES[1]![1], "json")
    expect(ofType(tokens, "property")).toEqual(['"kind"', '"from"', '"to"'])
    expect(ofType(tokens, "string")).toEqual(['"number"'])
    expect(ofType(tokens, "keyword")).toEqual(["null"])
  })

  it("marks CSS custom properties and comments", () => {
    const tokens = highlight(SAMPLES[3]![1], "css")
    expect(ofType(tokens, "property")).toEqual(["--dt-radius"])
    expect(ofType(tokens, "comment")).toEqual(["/* edges */"])
  })

  it("merges adjacent plain text into one token", () => {
    const tokens = highlight("a b c", "bash")
    expect(tokens).toEqual([{ type: null, text: "a b c" }])
  })
})
