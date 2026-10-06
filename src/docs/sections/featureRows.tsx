import { CodeBlock } from "../CodeBlock"
import { SelectionExample } from "../examples/SelectionExample"
import selectionSource from "../examples/SelectionExample.tsx?raw"
import { TimelineExample } from "../examples/TimelineExample"
import timelineSource from "../examples/TimelineExample.tsx?raw"
import { LiveExample } from "../LiveExample"
import type { DocTopic } from "../model"
import { Callout, ReadMore } from "../prose"

function RowSelection() {
  return (
    <>
      <p>
        Off by default. Turn it on with <code>features: {"{ selection: true }"}</code> and give rows a stable{" "}
        <code>getRowId</code> — without one, a selection follows row positions, and sorting moves the ticks onto
        different records.
      </p>
      <LiveExample title="Row selection with a bulk-action bar" source={selectionSource} file="SelectionExample.tsx">
        <SelectionExample />
      </LiveExample>
      <p>
        <strong>The header checkbox means every row the query matches</strong>, not the page on screen. So a
        selection is a statement about the query, never a long list of ids:
      </p>
      <CodeBlock
        language="ts"
        code={`
type SelectionModel =
  | { mode: "ids"; ids: readonly string[] }                   // picked one at a time
  | { mode: "all-matching"; excluded: readonly string[] }     // everything, minus these`}
      />
      <p>
        <code>onSelectionChange</code> and <code>renderSelectionActions</code> hand you the model, the{" "}
        <code>query</code> it is relative to, and the <code>count</code> — undefined until your server has answered
        with a <code>rowCount</code>. Translate it on the server:
      </p>
      <CodeBlock
        language="sql"
        code={`
-- ids
UPDATE receipts SET flagged = true WHERE id = ANY($1)
-- all-matching
UPDATE receipts SET flagged = true
WHERE <the query's filters and search> AND id NOT IN (<excluded>)`}
      />
      <h4 id="selection-page-scope">When your backend acts on ids only</h4>
      <p>
        If there is no bulk-by-query endpoint to send <code>all-matching</code> to, narrow the header checkbox to the
        current page:
      </p>
      <CodeBlock language="ts" code={'features: { selection: { scope: "page" } }'} />
      <p>
        The header then ticks the page's selectable rows as <code>{'{ mode: "ids" }'}</code>, ids survive a page
        turn so a selection is built page by page, and <code>all-matching</code> is unreachable.
      </p>
      <Callout>
        A change to the filters, the search or the grouping clears the selection, and the cleared selection is
        published. Sorting and paging do not clear it. A selection is never written to storage.
      </Callout>
      <ReadMore anchor="row-selection">Row selection</ReadMore>
    </>
  )
}

function RowNumbers() {
  return (
    <>
      <p>
        Off by default. <code>features: {"{ rowNumbers: true }"}</code> adds a leading column holding each row's
        1-based place in the whole result set — at 50 rows a page, the first row of page 2 is 51, not 1. The live selection
        example above has it on.
      </p>
      <p>
        The column is pinned to the start, cannot be hidden, sorted or moved, and is absent from the Columns panel.
        It can be resized. Its header is empty on screen and named by the <code>rowNumber</code> label for screen
        readers. Group rows are numbered too.
      </p>
      <ReadMore anchor="row-numbers">Row numbers</ReadMore>
    </>
  )
}

function StatusBar() {
  return (
    <>
      <p>
        Off by default. <code>features: {"{ statusBar: true }"}</code> adds a band that says how many rows there are,
        whether a filter is narrowing them, and what they are grouped by. Turning it on moves the row count out of
        the pagination footer, so the number is never on screen twice.
      </p>
      <p>
        To say "X of Y" while filtered in server mode, pass <code>unfilteredTotal</code> beside{" "}
        <code>rowCount</code>. Without it the bar states only the matched count. Pass a <code>ReactNode</code> instead
        of <code>true</code> to add content of your own at the band's end.
      </p>
      <ReadMore anchor="status-bar">Status bar</ReadMore>
    </>
  )
}

function TotalsFooter() {
  return (
    <>
      <p>A row under the body, aligned and pinned with the columns, holding totals you supply per column id:</p>
      <CodeBlock language="tsx" code={"<DataTable instance={table} totals={{ amount: formatMoney(page.amountTotal) }} />"} />
      <p>
        The library computes none of it — summing one page and calling it the total would be wrong. Answer the query
        for your own total. Pass <code>{"{}"}</code> while the total is loading: the row still renders with its
        caption, so it does not pop in and shift the body later. Leave <code>totals</code> out to render no footer.
      </p>
      <ReadMore anchor="totals-footer">Totals footer</ReadMore>
    </>
  )
}

function Timeline() {
  return (
    <>
      <p>
        <code>timeline</code> adds a time scale after your columns — a Gantt. Each row draws bars (a plan, the work
        done, the days past the plan) and points (a due day, a payment) under markers that run the height of the body
        (today, a deadline). It is one more column, so pinned columns stay put while it scrolls, and the tree, virtual
        rows and row heights are the table's own.
      </p>
      <LiveExample title="A project's stages on a timeline" source={timelineSource} file="TimelineExample.tsx">
        <TimelineExample />
      </LiveExample>
      <p>The library draws; your rows say what is drawn. Turn each row into items in <code>getItems</code>:</p>
      <CodeBlock
        language="ts"
        code={`
type TimelineItem =
  | { kind: "bar"; start: IsoDay; end: IsoDay;              // both inclusive
      variant: "plan" | "actual" | "overrun";
      tone?: "primary" | "success" | "danger" | "neutral";  // actual: under way, or done
      progress?: number;                                    // 0–100, fills an actual bar
      size?: "regular" | "thick"; title?: string }
  | { kind: "point"; date: IsoDay; shape: "dot" | "tick"; tone?: …; title?: string }`}
      />
      <p>
        <code>zoom</code> is <code>"day"</code> (30px a day, weekends shaded), <code>"week"</code> (14px, Mondays
        labelled) or <code>"month"</code> (5px); <code>dayWidth</code> changes any of them. A bar crossing the range is
        cut at the edge, never dropped. <code>scrollTo</code> brings a day into view when the pane appears and when
        the zoom or the range changes — never on an ordinary render.
      </p>
      <p>
        Give rows that head others a band with <code>{"<DataTable getRowTone>"}</code> — <code>"strong"</code> or{" "}
        <code>"soft"</code>. The whole row takes it, pinned cells and the timeline's cell included.
      </p>
      <Callout>
        Read-only: nothing is dragged. An item's <code>title</code> is its tooltip. With <code>onItemClick</code> each
        item is a button named by its title; without it a row's drawing is one image named by its items' titles. Month
        names come from the labels (<code>timelineMonth</code>), not <code>Intl</code>.
      </Callout>
      <ReadMore anchor="timeline-gantt">Timeline (Gantt)</ReadMore>
    </>
  )
}

/** The Features section's row topics, in the order the page shows them. */
export const rowTopics: DocTopic[] = [
  { id: "row-selection", title: "Row selection", Body: RowSelection },
  { id: "row-numbers", title: "Row numbers", Body: RowNumbers },
  { id: "status-bar", title: "Status bar", Body: StatusBar },
  { id: "totals-footer", title: "Totals footer", Body: TotalsFooter },
  { id: "timeline", title: "Timeline (Gantt)", Body: Timeline },
]
