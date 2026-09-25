import type { DocSection } from "../model"
import { Callout, ReadMore, RefTable, type RefRow } from "../prose"

const KEYS: RefRow[] = [
  ["Tab", "Moves between sort controls, resize handles, column menus, the side bar rail and selection checkboxes."],
  ["← / →", "On a focused resize handle: narrower / wider by 10px. Add Shift for 50px."],
  ["Enter", "On a focused resize handle: fit the column to its content."],
  ["↑ ↓ Home End", "Along the side bar's rail of tabs, without opening or closing the panel."],
  ["Space, arrows, Space", "In the Columns tab: pick a column's drag handle up, move it, put it down. Escape cancels."],
  ["Escape", "Closes a menu, a filter popover (discarding the draft) or, with focus inside it, the docked panel."],
  ["Space", "Ticks a focused selection checkbox."],
]

function Keyboard() {
  return (
    <>
      <p>Everything a pointer can rearrange has a keyboard path, with a visible focus ring:</p>
      <RefTable caption="Keyboard" head={["Keys", "Does"]} rows={KEYS} />
      <p>
        Row groups are built from the keyboard too: every row in the Columns tab carries a "Group rows by …" toggle,
        and a group chip moves with the same Space and arrow keys.
      </p>
    </>
  )
}

function ScreenReaders() {
  return (
    <ul>
      <li>
        Headers carry <code>aria-sort</code>, and each sort control names its column.
      </li>
      <li>
        The side bar's rail is a <code>tablist</code>; each tab reports both <code>aria-selected</code> and{" "}
        <code>aria-expanded</code>.
      </li>
      <li>
        The filter editor is a labelled <code>dialog</code> that keeps Tab inside it and returns focus to the column's
        ⋮ button.
      </li>
      <li>Quick search announces its result count politely and never steals focus.</li>
      <li>
        Selection checkboxes are real <code>{'<input type="checkbox">'}</code>s, each named with its row's place in
        the result set; the header's says how many rows it will take, and names no number until the server has
        answered.
      </li>
      <li>
        The status bar is a polite <code>role="status"</code> region; a column reorder announces each new position.
      </li>
      <li>Row toggles report <code>aria-expanded</code> and name themselves.</li>
      <li>
        Every spoken string is a label, so it is translated with the rest — see <a href="#labels">Labels &amp; i18n</a>.
      </li>
    </ul>
  )
}

function KnownGaps() {
  return (
    <>
      <Callout tone="warning">
        <strong>Cell editing is reachable by pointer only.</strong> A body cell cannot hold focus yet, so there is no
        cell for the ContextMenu key or Shift+F10 to open a menu on. Do not ship editing as the only route to something
        a keyboard user must be able to do.
      </Callout>
      <p>
        Transitions are disabled under <code>prefers-reduced-motion</code>, including the selection bar's entrance.
      </p>
      <ReadMore anchor="accessibility">Accessibility</ReadMore>
    </>
  )
}

export const accessibility: DocSection = {
  id: "accessibility",
  title: "Accessibility",
  summary: "What works from the keyboard, what a screen reader hears, and the one known gap.",
  topics: [
    { id: "keyboard", title: "Keyboard", Body: Keyboard },
    { id: "screen-readers", title: "Screen readers", Body: ScreenReaders },
    { id: "a11y-gaps", title: "Known gaps and motion", Body: KnownGaps },
  ],
}
