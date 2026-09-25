import { CodeBlock } from "../CodeBlock"
import type { DocSection } from "../model"
import { ReadMore, RefTable } from "../prose"
import { COLUMN_META, HOOK_OPTIONS, TABLE_PROPS } from "./apiTables"

const OPTION_HEAD = ["Option", "Type", "Default", "Description"]

function HookOptions() {
  return (
    <>
      <RefTable caption="useDataTable options" head={OPTION_HEAD} rows={HOOK_OPTIONS} />
      <p>
        It returns the TanStack <code>table</code> plus this library's additions: <code>id</code>, <code>flags</code>,{" "}
        <code>query</code>, <code>pagination</code>, <code>filtering</code>, <code>grouping</code>,{" "}
        <code>selection</code>, <code>resetLayout</code>, <code>isCustomised</code>, <code>reorderColumn</code> and
        the row-height settings. Every <code>features</code> flag defaults to on except <code>selection</code>,{" "}
        <code>rowNumbers</code> and <code>statusBar</code>.
      </p>
    </>
  )
}

function TableProps() {
  return <RefTable caption="DataTable props" head={["Prop", "Type", "Default", "Description"]} rows={TABLE_PROPS} />
}

function ColumnMeta() {
  return (
    <>
      <p>
        Per-column settings live in TanStack's <code>meta</code>, typed as <code>DataTableColumnMeta</code>:
      </p>
      <RefTable caption="Column meta" head={["Key", "Type", "Description"]} rows={COLUMN_META} />
    </>
  )
}

function Exports() {
  return (
    <>
      <p>
        Beyond the hook and the shell, the package exports the pieces a table of your own markup needs — the headless
        route. The ones worth knowing first:
      </p>
      <CodeBlock
        language="ts"
        code={`
import {
  // Shell parts, for a layout of your own
  QuickSearch, TablePagination, StatusBar, TotalsFooter, TableSideBar, TablePanel, TableStatus, SkeletonRows,
  // Layout helpers
  pinnedStyle, headerPinning, renderedLeafColumns, fillerIndex, useAutosize, useRowVirtualizer,
  // Filter conditions — build them with these, never by hand
  textCondition, numberCondition, dateCondition, booleanCondition, listCondition,
  // Labels, persistence and theming
  defaultLabels, ruLabels, uzLabels, localStorageLayout, muiTokens,
} from "@hojiakbar_dev/data-table"`}
      />
      <ReadMore anchor="headless-use">Headless use</ReadMore>
    </>
  )
}

export const apiReference: DocSection = {
  id: "api",
  title: "API reference",
  summary: "Every hook option, every prop and every column setting, on one screen each.",
  topics: [
    { id: "api-use-data-table", title: "useDataTable(options)", Body: HookOptions },
    { id: "api-data-table", title: "<DataTable> props", Body: TableProps },
    { id: "api-column-meta", title: "Column meta", Body: ColumnMeta },
    { id: "api-exports", title: "Other exports", Body: Exports },
  ],
}
