import { CodeBlock } from "../CodeBlock"
import type { DocSection } from "../model"
import { Callout, ReadMore } from "../prose"

function LabelsProp() {
  return (
    <>
      <p>
        Every string the table shows or speaks is a key of <code>DataTableLabels</code>. <code>{"<DataTable>"}</code>{" "}
        takes a <code>Partial</code> of it, so change only the words you need:
      </p>
      <CodeBlock
        language="tsx"
        code={'<DataTable instance={table} labels={{ empty: "No receipts yet", search: "Search receipts" }} />'}
      />
      <p>
        Some labels are functions, because they carry a number or a name — <code>selectRow(row)</code>,{" "}
        <code>range(from, to, total)</code>, <code>statusBarRows(count, raw)</code>. Counts arrive pre-formatted as{" "}
        <code>count</code>; <code>raw</code> is the number behind it, for languages that agree a noun with its
        count.
      </p>
      <p>
        The parts you can mount on your own — <code>TablePagination</code>, <code>QuickSearch</code> — take the full{" "}
        <code>DataTableLabels</code>, so spread <code>defaultLabels</code> under your overrides there.
      </p>
    </>
  )
}

function ShippedTranslations() {
  return (
    <>
      <p>
        Russian and Uzbek translations of the whole set ship with the package. Pass one straight through, or keep it
        and change the wording that is yours:
      </p>
      <CodeBlock
        language="tsx"
        code={`
import { DataTable, ruLabels, uzLabels } from "@hojiakbar_dev/data-table"

<DataTable instance={table} labels={ruLabels} />
<DataTable instance={table} labels={{ ...ruLabels, empty: "Накладных пока нет" }} />`}
      />
      <p>
        Both are typed as the full <code>DataTableLabels</code>, so a key added in a later release fails to compile in
        the package rather than staying English in your app. The live <a href="./">playground</a> switches between all
        three.
      </p>
      <ReadMore anchor="headless-use">Headless use</ReadMore>
    </>
  )
}

function I18nLibraries() {
  return (
    <>
      <p>
        <code>labels</code> is a plain object, so any i18n library plugs in the same way: build the object from your
        translation function, and keep a shipped set underneath for the keys you have not translated. With next-intl:
      </p>
      <CodeBlock
        language="tsx"
        code={`
import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { DataTable, defaultLabels, type DataTableLabels } from "@hojiakbar_dev/data-table"

function ReceiptsTable({ table }) {
  const t = useTranslations("ReceiptsTable")
  const labels = useMemo<Partial<DataTableLabels>>(
    () => ({
      empty: t("empty"),
      search: t("search"),
      selectRow: (row) => t("selectRow", { row }),
    }),
    [t],
  )
  return <DataTable instance={table} labels={labels} />
}`}
      />
      <p>
        With react-i18next it is the same shape — take <code>t</code> from <code>useTranslation()</code> and write the
        interpolation your catalogue expects:
      </p>
      <CodeBlock
        language="tsx"
        code={`
const { t } = useTranslation()
const labels = useMemo<Partial<DataTableLabels>>(
  () => ({ empty: t("receipts.empty"), selectRow: (row) => t("receipts.selectRow", { row }) }),
  [t],
)`}
      />
      <Callout>
        The library does not depend on either package. A function label is called with its arguments at render time,
        so your library's plural and number rules apply as they do anywhere else in your app. Where you already ship
        Russian or Uzbek, start from <code>ruLabels</code> or <code>uzLabels</code> and override only your own
        wording.
      </Callout>
    </>
  )
}

export const labels: DocSection = {
  id: "labels",
  title: "Labels & i18n",
  summary: "Change any string the table shows, use the shipped Russian and Uzbek sets, or wire in your i18n library.",
  topics: [
    { id: "labels-prop", title: "The labels prop", Body: LabelsProp },
    { id: "shipped-translations", title: "Russian and Uzbek", Body: ShippedTranslations },
    { id: "i18n-libraries", title: "next-intl and react-i18next", Body: I18nLibraries },
  ],
}
