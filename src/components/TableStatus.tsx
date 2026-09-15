import type { DataTableLabels } from "../types"

interface TableStatusProps {
  loading: boolean
  error: unknown
  onRetry?: (() => void) | undefined
  labels: DataTableLabels
}

/**
 * What sits at the top of the viewport while rows are on their way or failed.
 *
 * Error beats loading, loading beats empty — the same precedence AG Grid uses.
 */
export function TableStatus({ loading, error, onRetry, labels }: TableStatusProps) {
  if (error !== undefined && error !== null) {
    return (
      <div className="dt-error" role="alert">
        <span>{labels.loadFailed}: {errorMessage(error)}</span>
        {onRetry ? (
          <button type="button" className="dt-menu-button" onClick={onRetry}>
            {labels.retry}
          </button>
        ) : null}
      </div>
    )
  }
  if (loading) return <div className="dt-progress" role="progressbar" aria-label={labels.loading} />
  return null
}

/**
 * Placeholder rows while the first page loads.
 *
 * @param widths - Rendered column widths, in order, filler included (0 for the filler).
 * @param count - How many skeleton rows to render.
 */
interface SkeletonRowsProps {
  widths: number[]
  count: number
}

/** Placeholder rows while the first page loads. */
export function SkeletonRows({ widths, count }: SkeletonRowsProps) {
  return (
    <tbody>
      {Array.from({ length: count }, (_, rowIndex) => (
        <tr key={rowIndex} className="dt-skeleton-row" aria-hidden="true">
          {widths.map((width, cellIndex) => (
            <td key={cellIndex} className="dt-td">
              {width > 0 ? <span className="dt-skeleton" style={{ width: `${40 + ((rowIndex * 7 + cellIndex * 13) % 45)}%` }} /> : null}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

/**
 * Renders an unknown thrown value as display text.
 *
 * @param error - Whatever was thrown or passed as the `error` prop.
 * @returns The `Error#message`, the string itself, or a `String(error)` fallback.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return String(error)
}
