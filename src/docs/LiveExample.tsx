import type { ReactNode } from "react"
import { CodeBlock } from "./CodeBlock"

interface LiveExampleProps {
  /** Names the example for assistive tech and captions the code. */
  title: string
  /** The running example. */
  children: ReactNode
  /** The example's own module source, imported with `?raw`. */
  source: string
  /** The example's file name, shown over the code. */
  file: string
}

/**
 * A running `<DataTable>` with the code that produced it underneath.
 *
 * `source` is the example module itself, imported as text — so the code on
 * the page is, byte for byte, the code that is running above it, and a change
 * to the library that broke the example would break the page's build rather
 * than leave a snippet quietly lying.
 *
 * @param props.title - What the example shows.
 * @param props.children - The live table.
 * @param props.source - That table's module source.
 * @param props.file - Its file name.
 *
 * @example
 * <LiveExample title="Minimal table" source={minimalSource} file="MinimalExample.tsx">
 *   <MinimalExample />
 * </LiveExample>
 */
export function LiveExample({ title, children, source, file }: LiveExampleProps) {
  return (
    <figure className="docs-live">
      <figcaption className="docs-live-caption">
        <span className="docs-live-badge">Live</span>
        {title}
      </figcaption>
      <div className="docs-live-stage">{children}</div>
      <CodeBlock code={source} language="tsx" title={file} />
    </figure>
  )
}
