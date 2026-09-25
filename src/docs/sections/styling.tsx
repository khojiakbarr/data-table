import { CodeBlock } from "../CodeBlock"
import type { DocSection } from "../model"
import { Callout, ReadMore, RefTable, type RefRow } from "../prose"

const TOKENS: RefRow[] = [
  ["--dt-bg --dt-fg --dt-muted-fg", "Surface and text"],
  ["--dt-border --dt-radius", "Edges"],
  ["--dt-header-bg --dt-header-fg --dt-header-height", "Header row"],
  ["--dt-row-hover --dt-row-stripe --dt-row-height", "Body rows (set the height through rowHeight)"],
  ["--dt-accent", "Fill: focus ring, resize handle, drop indicator, pin badge — needs 3:1"],
  ["--dt-accent-fg", "Text printed on --dt-accent — needs 4.5:1"],
  ["--dt-accent-text", "The accent printed as text on --dt-bg — needs 4.5:1"],
  ["--dt-focus-ring", "Focus outline"],
  ["--dt-resize-handle --dt-resize-handle-active", "Resize handle"],
  ["--dt-drop-indicator", "Where a dragged column will land"],
  ["--dt-pin-shadow-start --dt-pin-shadow-end", "Pinned column seams"],
  ["--dt-pinned-bg", "Resting fill of a pinned body cell"],
  ["--dt-footer-bg --dt-footer-fg", "The pagination band — set as a pair"],
  ["--dt-indent --dt-detail-bg", "Nested rows and detail panels"],
  ["--dt-viewport-max-height", "Fallback height for a table nobody bounded"],
  ["--dt-font --dt-font-size", "Typography"],
  ["--dt-button-bg --dt-button-fg --dt-button-border --dt-button-radius --dt-button-hover-bg", "Toolbar, menu and pagination buttons, and the side bar rail tabs"],
  ["--dt-button-primary-bg --dt-button-primary-fg", "The one emphatic action on a surface — the filter editor's Apply"],
]

function Tokens() {
  return (
    <>
      <p>
        Every colour and size is a CSS custom property declared on <code>.dt-root</code>. Override them on that same
        element, with the class doubled so your rule wins whatever order the stylesheets load in:
      </p>
      <CodeBlock
        language="css"
        code={`
.dt-root.dt-root {
  --dt-header-bg: var(--table-header-bg);
  --dt-row-hover: var(--table-row-hover);
  --dt-accent: var(--primary);
  --dt-accent-text: var(--primary);
  --dt-radius: 6px;
}`}
      />
      <RefTable caption="Style tokens" head={["Token", "Purpose"]} rows={TOKENS} />
      <Callout tone="warning">
        <code>--dt-accent</code> is a fill and <code>--dt-accent-text</code> is the same colour used as text, which
        needs the stricter 4.5:1. Setting one does not set the other. Every colour must be opaque, tints included —
        mix a tint against its surface first, e.g.{" "}
        <code>color-mix(in oklab, var(--accent) 8%, var(--background))</code>.
      </Callout>
      <p>
        Dark mode follows <code>prefers-color-scheme</code>. Pass <code>theme="light"</code> or{" "}
        <code>theme="dark"</code> to pin one table.
      </p>
      <ReadMore anchor="styling">Styling</ReadMore>
    </>
  )
}

function Buttons() {
  return (
    <>
      <p>
        The table's own buttons draw from one group of tokens, so they restyle together. Every default reproduces
        what the buttons painted before the group existed, so setting none of them changes nothing:
      </p>
      <CodeBlock
        language="css"
        code={`
.dt-root.dt-root {
  --dt-button-bg: #fff;
  --dt-button-fg: #18181b;
  --dt-button-border: #e4e4e7;
  --dt-button-radius: 6px;
  --dt-button-hover-bg: #f4f4f5;
  --dt-button-primary-bg: #2563eb;   /* the emphatic one: Apply */
  --dt-button-primary-fg: #fff;
}`}
      />
      <p>
        <code>.dt-menu-button</code> is public: put it on your own buttons in <code>toolbarActions</code>,{" "}
        <code>toolbarContent</code> or <code>renderSelectionActions</code> and they match the table's, following the
        same tokens. Add <code>dt-menu-button-primary</code> for the emphatic one. The{" "}
        <a href="#row-selection">selection example</a> uses it for its Clear button.
      </p>
      <CodeBlock
        language="tsx"
        code={`
<DataTable
  instance={table}
  toolbarActions={
    <button type="button" className="dt-menu-button" onClick={exportRows}>
      Export
    </button>
  }
/>`}
      />
      <ReadMore anchor="buttons">Buttons</ReadMore>
    </>
  )
}

function Shadcn() {
  return (
    <>
      <p>
        Two presets map the tokens onto shadcn's variables. Import one after the base stylesheet and the table follows
        your palette, radius, font and dark mode:
      </p>
      <CodeBlock
        language="ts"
        code={`
import "@hojiakbar_dev/data-table/styles.css"
import "@hojiakbar_dev/data-table/themes/shadcn.css"      // complete colours: oklch(0.62 0.19 259)
// or
import "@hojiakbar_dev/data-table/themes/shadcn-hsl.css"  // channel triplets: 221 83% 53%`}
      />
      <p>
        Pick by how your variables are written — the wrong file produces no colour at all, not a warning. If your
        design system defines <code>--table-header-bg</code>, <code>--table-header-fg</code>,{" "}
        <code>--table-row-hover</code>, <code>--table-row-stripe</code>, <code>--table-pinned-bg</code>,{" "}
        <code>--table-footer-bg</code> or <code>--table-footer-fg</code>, both presets read those first. Both
        also map the button tokens onto shadcn's own button roles — <code>--secondary</code> for ordinary buttons,{" "}
        <code>--primary</code> for the emphatic one.
      </p>
      <p>
        To override a mapped token on top of a preset, repeat the class three times:{" "}
        <code>.dt-root.dt-root.dt-root</code>.
      </p>
      <ReadMore anchor="shadcnui">shadcn/ui</ReadMore>
    </>
  )
}

function MaterialUi() {
  return (
    <>
      <p>
        MUI publishes no CSS variables in v5, so it gets a function instead of a stylesheet. Pass the result as the
        table's <code>style</code>:
      </p>
      <CodeBlock
        language="tsx"
        code={`
import { useTheme } from "@mui/material"
import { muiTokens } from "@hojiakbar_dev/data-table"

const theme = useTheme()
return <DataTable instance={table} style={muiTokens(theme)} />`}
      />
      <p>
        It works with v5 and v6 themes and does not import MUI. The theme's <code>palette.mode</code> decides light or
        dark, so drop the <code>theme</code> prop. It maps colours, typography and radius — not row height or
        density. To override one token afterwards, put it later in the same object:{" "}
        <code>{'style={{ ...muiTokens(theme), "--dt-accent-text": "#1565c0" }}'}</code>.
      </p>
      <ReadMore anchor="material-ui">Material UI</ReadMore>
    </>
  )
}

export const styling: DocSection = {
  id: "styling",
  title: "Styling",
  summary: "Restyle the table with tokens, or hand it a shadcn/ui or Material UI theme.",
  topics: [
    { id: "tokens", title: "Tokens", Body: Tokens },
    { id: "buttons", title: "Buttons", Body: Buttons },
    { id: "shadcn", title: "shadcn/ui", Body: Shadcn },
    { id: "material-ui", title: "Material UI", Body: MaterialUi },
  ],
}
