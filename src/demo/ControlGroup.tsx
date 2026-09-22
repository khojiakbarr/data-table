import type { ReactNode } from "react"

interface ControlGroupProps {
  /** The section's visible name, already translated. */
  legend: string
  /**
   * Whether the section starts expanded.
   *
   * Uncontrolled on purpose: React writes `open` once and then leaves the
   * element alone, so a section the visitor collapses stays collapsed across
   * a language switch or a theme edit.
   */
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * One collapsible section of the control rail — a heading the whole width of
 * the panel, and the controls under it.
 *
 * Built on `<details>` rather than a button plus state: the disclosure is then
 * the browser's own, which means Enter and Space work, the summary is a real
 * tab stop, and find-in-page can open a collapsed section. Nothing here needs
 * JavaScript.
 *
 * The body carries `role="group"` with the same name as the heading because
 * `<details>` is not a grouping role — without it a screen reader reads eight
 * checkboxes with no indication that they belong to "Interactions".
 *
 * @param props.legend - The section name, from `CHROME[language]`.
 * @param props.defaultOpen - Whether it starts expanded. Defaults to `true`.
 * @param props.children - The controls inside.
 *
 * @example
 * <ControlGroup legend={chrome.theme.legends.colors} defaultOpen={false}>
 *   {colorPickers}
 * </ControlGroup>
 */
export function ControlGroup({ legend, defaultOpen = true, children }: ControlGroupProps) {
  return (
    <details className="pg-group" open={defaultOpen}>
      <summary className="pg-group-summary">
        {/*
          Hidden from assistive tech: the summary's own text already names the
          disclosure, and `<details>` announces expanded/collapsed itself.
        */}
        <svg className="pg-chevron" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="pg-group-legend">{legend}</span>
      </summary>
      <div className="pg-group-body" role="group" aria-label={legend}>
        {children}
      </div>
    </details>
  )
}
