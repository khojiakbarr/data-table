import type { ReactNode } from "react"

const README_URL = "https://github.com/khojiakbarr/data-table#"

interface ReadMoreProps {
  /** The README heading's GitHub anchor, without the `#`. */
  anchor: string
  /** The README heading's text. */
  children: ReactNode
}

/**
 * A pointer to the README section that holds the long-form reasoning.
 *
 * The docs answer "how do I"; the README keeps the "why", and duplicating it
 * here would give the two a way to drift. Every topic that leaves something
 * out ends with one of these.
 *
 * @example
 * <ReadMore anchor="filters-on-the-wire">Filters on the wire</ReadMore>
 */
export function ReadMore({ anchor, children }: ReadMoreProps) {
  return (
    <p className="docs-readmore">
      Why it works this way:{" "}
      <a href={`${README_URL}${anchor}`} target="_blank" rel="noopener noreferrer">
        README — {children}{" "}
        <span className="docs-sr-only">(opens in a new tab)</span>
      </a>
    </p>
  )
}

/**
 * A short aside that must not be skimmed past — a rule that is easy to get
 * wrong, or a known limitation.
 *
 * @param props.tone - `"warning"` for something that bites; `"note"` otherwise.
 *
 * @example
 * <Callout tone="warning">Cell editing is pointer-only today.</Callout>
 */
export function Callout({ tone = "note", children }: { tone?: "note" | "warning"; children: ReactNode }) {
  return (
    <aside className="docs-callout" data-tone={tone}>
      <strong className="docs-callout-label">{tone === "warning" ? "Watch out" : "Note"}</strong>
      <div>{children}</div>
    </aside>
  )
}

/** One row of a {@link RefTable}: a name, then one cell per remaining column. */
export type RefRow = [name: string, ...cells: ReactNode[]]

interface RefTableProps {
  /** Column headings; the first is the name column. */
  head: string[]
  rows: RefRow[]
  /** Names the table for a screen reader. */
  caption: string
}

/**
 * A reference table — options, props, tokens, operators — that scrolls
 * sideways inside its own box on a narrow screen rather than widening the
 * page. The first column is set as code, because it is always an API name.
 *
 * @example
 * <RefTable caption="Operators" head={["Operator", "Means"]} rows={[["between", "Inclusive"]]} />
 */
export function RefTable({ head, rows, caption }: RefTableProps) {
  return (
    <div className="docs-table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table className="docs-table">
        <caption className="docs-sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, ...cells]) => (
            <tr key={name}>
              <th scope="row">
                <code>{name}</code>
              </th>
              {cells.map((cell, index) => (
                <td key={index}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
