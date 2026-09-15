/**
 * The control that opens a row.
 *
 * Rendered inside the first cell rather than in a column of its own: a
 * dedicated column would have to be pinned to stay next to the row it belongs
 * to, and would take a slot in every reorder and hide interaction for something
 * that is not really a column.
 */

interface ExpandToggleProps {
  expanded: boolean
  /** Nesting level; each one indents the toggle. */
  depth: number
  label: string
  onToggle: () => void
}

export function ExpandToggle({ expanded, depth, label, onToggle }: ExpandToggleProps) {
  return (
    <button
      type="button"
      className="dt-expand"
      aria-expanded={expanded}
      aria-label={label}
      style={depth > 0 ? { marginInlineStart: `calc(var(--dt-indent) * ${depth})` } : undefined}
      onClick={(event) => {
        // The row itself may be clickable; opening it is a separate intent.
        event.stopPropagation()
        onToggle()
      }}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={expanded ? "dt-expand-icon dt-expand-open" : "dt-expand-icon"}
      >
        <path d="M3 1.5 L7 5 L3 8.5" />
      </svg>
    </button>
  )
}

/** Indentation for a nested row that has no toggle of its own. */
export function DepthSpacer({ depth }: { depth: number }) {
  if (depth === 0) return null
  return (
    <span
      aria-hidden="true"
      className="dt-depth-spacer"
      style={{ width: `calc(var(--dt-indent) * ${depth})` }}
    />
  )
}
