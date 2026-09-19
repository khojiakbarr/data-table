import type { ChangeEvent } from "react"
import type { FeatureState } from "./playgroundState"

interface ToggleDef {
  key: keyof FeatureState
  label: string
  hint?: string
}

/** One fieldset's worth of toggles, each mapped to a real option or prop. */
interface Group {
  legend: string
  toggles: ToggleDef[]
}

const GROUPS: Group[] = [
  {
    legend: "Interactions",
    toggles: [
      { key: "sorting", label: "Sorting" },
      { key: "resizing", label: "Column resizing" },
      { key: "reordering", label: "Column reordering" },
      { key: "pinning", label: "Column pinning" },
      { key: "hiding", label: "Column hiding" },
    ],
  },
  {
    legend: "Data",
    toggles: [
      { key: "filtering", label: "Filtering", hint: "Quick search rides with this" },
      { key: "pagination", label: "Pagination" },
    ],
  },
  {
    legend: "Layout",
    toggles: [
      { key: "striped", label: "Striped rows" },
      { key: "toolbar", label: "Toolbar" },
      { key: "footer", label: "Footer" },
      { key: "virtualize", label: "Virtualize" },
      { key: "stickyHeader", label: "Sticky header" },
      { key: "detailPanel", label: "Detail panel", hint: "Expand a row for more" },
    ],
  },
]

interface FeatureControlsProps {
  value: FeatureState
  onChange: (next: FeatureState) => void
}

/**
 * Checkbox toggles for every feature flag and layout prop the playground
 * exposes — nothing here is faked: each one flows straight into
 * `useDataTable({ features, filtering, pagination })` or a `<DataTable>` prop.
 *
 * @example
 * <FeatureControls value={features} onChange={setFeatures} />
 */
export function FeatureControls({ value, onChange }: FeatureControlsProps) {
  const toggle = (key: keyof FeatureState) => (event: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: event.target.checked })

  return (
    <div className="pg-controls" aria-label="Feature toggles">
      {GROUPS.map((group) => (
        <fieldset key={group.legend} className="pg-fieldset">
          <legend>{group.legend}</legend>
          {group.toggles.map((def) => (
            <label key={def.key} className="pg-toggle">
              <input type="checkbox" checked={value[def.key]} onChange={toggle(def.key)} />
              <span>
                {def.label}
                {def.hint ? <small className="pg-hint">{def.hint}</small> : null}
              </span>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  )
}
