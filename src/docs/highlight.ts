/**
 * A deliberately small syntax highlighter for the docs page's code blocks.
 *
 * Hand-written rather than a dependency: the page highlights five languages
 * in a few dozen short snippets, and every highlighter package worth using
 * ships grammars for hundreds more, which would land in the Pages bundle for
 * nothing. What it gives up is precision — it tokenises, it does not parse —
 * and a docs snippet is short and well-formed enough that nobody can tell.
 */

/** The languages a docs code block can be written in. */
export type CodeLanguage = "tsx" | "ts" | "json" | "sql" | "css" | "bash"

/** What a token is drawn as. `null` is plain text. */
export type TokenType = "comment" | "string" | "keyword" | "number" | "type" | "property" | null

/** One run of source text and how to colour it. */
export interface Token {
  type: TokenType
  text: string
}

interface Rule {
  type: TokenType
  /** Must carry the sticky flag: it is only ever tried at the current position. */
  pattern: RegExp
}

const words = (list: string, flags = "y") => new RegExp(`\\b(?:${list.split(" ").join("|")})\\b`, flags)

// A quoted string stops at a newline, so a stray apostrophe in prose colours
// one line rather than the rest of the block.
const DOUBLE_QUOTED = /"(?:[^"\\\n]|\\.)*"/y
const SINGLE_QUOTED = /'(?:[^'\\\n]|\\.)*'/y
const NUMBER = /\b\d[\d_]*(?:\.\d+)?\b/y
// Identifiers are consumed whole, so a keyword is never read out of the middle
// of a longer name (`constant`, `newValue`).
const IDENTIFIER = /[A-Za-z_$][\w$]*/y

const SCRIPT: Rule[] = [
  { type: "comment", pattern: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y },
  { type: "string", pattern: DOUBLE_QUOTED },
  { type: "string", pattern: SINGLE_QUOTED },
  { type: "string", pattern: /`(?:[^`\\]|\\[\s\S])*`/y },
  { type: "number", pattern: NUMBER },
  {
    type: "keyword",
    pattern: words(
      "const let var function return import from export type interface async await if else " +
        "new true false null undefined as typeof extends default void",
    ),
  },
  { type: "type", pattern: /\b[A-Z][\w$]*/y },
  { type: null, pattern: IDENTIFIER },
]

const RULES: Record<CodeLanguage, Rule[]> = {
  tsx: SCRIPT,
  ts: SCRIPT,
  json: [
    { type: "property", pattern: /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y },
    { type: "string", pattern: DOUBLE_QUOTED },
    { type: "number", pattern: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y },
    { type: "keyword", pattern: words("true false null") },
  ],
  sql: [
    { type: "comment", pattern: /--[^\n]*/y },
    { type: "string", pattern: /'(?:[^'\n]|'')*'/y },
    { type: "number", pattern: NUMBER },
    {
      type: "keyword",
      pattern: words(
        "select from where group by order and or not is null in update set count coalesce " +
          "nullif as any between text true false",
        "iy",
      ),
    },
    { type: null, pattern: IDENTIFIER },
  ],
  css: [
    { type: "comment", pattern: /\/\*[\s\S]*?\*\//y },
    { type: "property", pattern: /--[\w-]+/y },
    { type: "string", pattern: DOUBLE_QUOTED },
    { type: "number", pattern: /\b\d+(?:\.\d+)?(?:px|%|em|rem|vh)?/y },
    { type: null, pattern: /[A-Za-z_][\w-]*/y },
  ],
  bash: [
    { type: "comment", pattern: /(?<=^|\s)#[^\n]*/y },
    { type: "string", pattern: DOUBLE_QUOTED },
    { type: "keyword", pattern: words("npm pnpm yarn git") },
    { type: null, pattern: /[^\s#"]+/y },
  ],
}

/** The first rule that matches exactly at `index`, and what it matched. */
function matchAt(rules: Rule[], source: string, index: number): Token | null {
  for (const rule of rules) {
    rule.pattern.lastIndex = index
    const match = rule.pattern.exec(source)
    if (match && match[0].length > 0) return { type: rule.type, text: match[0] }
  }
  return null
}

/**
 * Splits source text into coloured runs.
 *
 * Joining every token's `text` gives back the source exactly — the renderer
 * relies on that, since it draws the tokens and nothing else.
 *
 * @param source - The code to highlight.
 * @param language - Which rule set to read it with.
 * @returns The tokens, with adjacent plain text merged into one.
 *
 * @example
 * highlight('const a = "b"', "ts")
 * // [{ type: "keyword", text: "const" }, { type: null, text: " a = " }, { type: "string", text: '"b"' }]
 */
export function highlight(source: string, language: CodeLanguage): Token[] {
  const rules = RULES[language]
  const tokens: Token[] = []
  const push = (token: Token) => {
    const last = tokens[tokens.length - 1]
    if (last && last.type === null && token.type === null) {
      tokens[tokens.length - 1] = { type: null, text: last.text + token.text }
    } else {
      tokens.push(token)
    }
  }

  let index = 0
  while (index < source.length) {
    const token = matchAt(rules, source, index) ?? { type: null, text: source.charAt(index) }
    push(token)
    index += token.text.length
  }
  return tokens
}
