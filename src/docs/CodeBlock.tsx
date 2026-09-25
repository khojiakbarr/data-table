import { useMemo } from "react"
import { CopyButton } from "./CopyButton"
import { highlight, type CodeLanguage } from "./highlight"

interface CodeBlockProps {
  /** The source, exactly as it should be copied. Leading/trailing blank lines are trimmed. */
  code: string
  language: CodeLanguage
  /** A file name or caption shown above the code. Defaults to the language. */
  title?: string | undefined
}

/**
 * A highlighted, copyable code block.
 *
 * Tokens are rendered as React elements, never as an HTML string, so a
 * snippet containing markup (every TSX one) cannot inject anything. The
 * `<pre>` is a focusable scroll region: a long line scrolls inside the block
 * instead of widening the page, and a keyboard user can reach that scroll.
 *
 * @param props.code - The source to show and copy.
 * @param props.language - Which highlighter rules to apply.
 * @param props.title - Optional caption, e.g. a file name.
 *
 * @example
 * <CodeBlock language="bash" code="npm i @hojiakbar_dev/data-table" />
 */
export function CodeBlock({ code, language, title }: CodeBlockProps) {
  const source = code.replace(/^\s*\n/, "").trimEnd()
  const tokens = useMemo(() => highlight(source, language), [source, language])
  const caption = title ?? language

  return (
    <div className="docs-code">
      <div className="docs-code-bar">
        <span className="docs-code-title">{caption}</span>
        <CopyButton text={source} what={`${caption} code`} />
      </div>
      <pre className="docs-code-body" tabIndex={0} aria-label={`${caption} code`}>
        <code>
          {tokens.map((token, index) =>
            token.type === null ? (
              token.text
            ) : (
              <span key={index} className={`tok-${token.type}`}>
                {token.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </div>
  )
}
