import { CodeBlock } from "../CodeBlock"
import type { DocTopic } from "../model"
import { Callout, ReadMore, RefTable } from "../prose"

function Cards() {
  return (
    <>
      <p>
        On a phone a table is a row of columns scrolled sideways. <code>layout="cards"</code> draws each row as a card
        instead; <code>layout="auto"</code> does it while the table itself is narrower than{" "}
        <code>cardBreakpoint</code> (640px), and switches live as the width changes.
      </p>
      <CodeBlock language="tsx" code={'<DataTable instance={table} layout="auto" />'} />
      <p>
        Each column says where it goes with <code>meta.card</code>. A column with no place is a "label: value" field,
        so a table nobody has placed loses nothing on a phone; while no column is the title, the first one is.
      </p>
      <RefTable
        caption="Places a column can take on a card"
        head={["Place", "Where"]}
        rows={[
          ["code", "top left, small and monospace"],
          ["status", "top right"],
          ["actions", "top right, last — the row's ⋮"],
          ["leading", "beside the title — an avatar"],
          ["title, subtitle", "the name and a line under it"],
          ["amount, amountNote", "on the right, and a line under it"],
          ["fields", "label: value lines (the default)"],
          ["chips", "the foot, wrapping"],
          ["trailing", "the foot's far end"],
          ["false", "not on the card"],
        ]}
      />
      <CodeBlock
        language="ts"
        code={`
col.accessor("code", { header: "Code", meta: { card: "code" } }),
col.accessor("partner", { header: "Partner", meta: { card: "title" } }),
col.accessor("total", { header: "Total", meta: { card: "amount" } }),`}
      />
      <p>
        A cell renders through the column's own <code>cell</code>. To say less on a card, call{" "}
        <code>useInCard()</code> in it; a cell that renders nothing there takes no room.
      </p>
      <p>
        On a paged table, cards scroll on: the pages seen are drawn one after another and the next is asked for as
        the last card comes into view, with no pager (<code>infiniteCards={"{false}"}</code> keeps it). Cards draw no
        header, so while sorting is on the rail offers the sort as a button that opens the table's own menu, and its
        Columns tab shows and hides the fields.
      </p>
      <Callout>
        A card keeps the selection, <code>onRowClick</code>, <code>renderDetail</code>, the totals, group headings and
        the side bar. It leaves the column menu, cell editing, the row context menu and the timeline to the table.
      </Callout>
      <ReadMore anchor="cards-on-a-narrow-screen">Cards on a narrow screen</ReadMore>
    </>
  )
}

/** The Features section's layout topics, in the order the page shows them. */
export const cardTopics: DocTopic[] = [{ id: "cards", title: "Cards on a narrow screen", Body: Cards }]
