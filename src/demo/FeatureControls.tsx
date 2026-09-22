import type { ChangeEvent } from "react"
import type { ChromeStrings } from "./chrome"
import { ControlGroup } from "./ControlGroup"
import type { FeatureState } from "./playgroundState"

/** Which hint, if any, a toggle carries under its label. */
type HintKey = keyof ChromeStrings["features"]["hints"]

interface ToggleDef {
  key: keyof FeatureState
  hint?: HintKey
}

/** One fieldset's worth of toggles, each mapped to a real option or prop. */
interface Group {
  legend: keyof ChromeStrings["features"]["legends"]
  toggles: ToggleDef[]
}

/**
 * The layout of the panel, with no copy in it.
 *
 * Only keys live here; every visible string comes from `chrome.features`, so
 * the panel follows the language switcher along with the table.
 */
const GROUPS: Group[] = [
  {
    legend: "interactions",
    toggles: [
      { key: "sorting" },
      { key: "resizing" },
      { key: "reordering" },
      { key: "pinning" },
      { key: "hiding" },
      // Not an interaction so much as furniture, but this fieldset is the one
      // whose toggles all reach `useDataTable({ features })`, and that is
      // what this flag is.
      { key: "rowNumbers", hint: "rowNumbers" },
      // Same reasoning again: furniture rather than an interaction, but a
      // `useDataTable({ features })` flag — and the one that puts the
      // bulk-action bar on screen.
      { key: "selection", hint: "selection" },
      // Same reasoning as `rowNumbers` just above: furniture rather than an
      // interaction, but still a `useDataTable({ features })` flag.
      { key: "statusBar", hint: "statusBar" },
    ],
  },
  {
    legend: "data",
    toggles: [
      { key: "filtering", hint: "filtering" },
      // Server mode with pagination off is a state `useDataTable` warns about
      // in the console; without the hint the truncated table reads as a bug.
      { key: "pagination", hint: "pagination" },
    ],
  },
  {
    legend: "layout",
    toggles: [
      { key: "striped" },
      { key: "toolbar" },
      { key: "footer" },
      { key: "virtualize" },
      { key: "stickyHeader" },
      { key: "detailPanel", hint: "detailPanel" },
    ],
  },
]

interface FeatureControlsProps {
  value: FeatureState
  onChange: (next: FeatureState) => void
  chrome: ChromeStrings
}

/**
 * Checkbox toggles for every feature flag and layout prop the playground
 * exposes — nothing here is faked: each one flows straight into
 * `useDataTable({ features, filtering, pagination })` or a `<DataTable>` prop.
 *
 * @param props.value - The whole feature state, as one object.
 * @param props.onChange - Called with a new state object; the old one is never mutated.
 * @param props.chrome - The page copy for the current language.
 *
 * @example
 * <FeatureControls value={features} onChange={setFeatures} chrome={CHROME[language]} />
 */
export function FeatureControls({ value, onChange, chrome }: FeatureControlsProps) {
  const toggle = (key: keyof FeatureState) => (event: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: event.target.checked })

  return (
    <div className="pg-controls" role="group" aria-label={chrome.features.groupLabel}>
      {GROUPS.map((group) => (
        <ControlGroup key={group.legend} legend={chrome.features.legends[group.legend]}>
          {group.toggles.map((def) => (
            <label key={def.key} className="pg-toggle">
              <input type="checkbox" checked={value[def.key]} onChange={toggle(def.key)} />
              <span className="pg-toggle-text">
                {chrome.features.labels[def.key]}
                {def.hint ? <small className="pg-hint">{chrome.features.hints[def.hint]}</small> : null}
              </span>
            </label>
          ))}
        </ControlGroup>
      ))}
    </div>
  )
}
