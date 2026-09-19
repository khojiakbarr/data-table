import { useMemo, useState } from "react"
import { DataTable, defaultLabels } from "../components/DataTable"
import { localStorageLayout } from "../core/persistence"
import type { TableQuery } from "../core/query"
import type { DataTableLabels } from "../types"
import { useDataTable } from "../useDataTable"
import { ruLabels } from "../labels/ru"
import { uzLabels } from "../labels/uz"
import { CHROME } from "./chrome"
import { FeatureControls } from "./FeatureControls"
import { LanguageSwitcher } from "./LanguageSwitcher"
import { ThemeControls } from "./ThemeControls"
import { buildReceiptColumns, ReceiptDetail } from "./receiptColumns"
import { fetchValues, type ServerReceipt } from "./fakeServer"
import {
  DEFAULT_FEATURES,
  DEFAULT_THEME,
  THEME_CLASS,
  themeStyleRule,
  type FeatureState,
  type Language,
  type ThemeTokenState,
} from "./playgroundState"
import { useReceiptsQuery } from "./useReceiptsQuery"

const LABELS: Record<Language, DataTableLabels> = { en: defaultLabels, ru: ruLabels, uz: uzLabels }
const storage = localStorageLayout()
const EMPTY: ServerReceipt[] = []

/**
 * The library's playground: one server-backed table, a language switcher, and
 * two control groups — feature toggles and theme tokens — that drive real
 * `useDataTable` options and `<DataTable>` props. Replaces the old demo page.
 *
 * Server mode only, on purpose: this is how the table is actually used, and a
 * client/server switch would double every control for a comparison nobody
 * asked for. There is deliberately no CSS-export button either — see
 * {@link ThemeControls}'s docblock.
 *
 * The switcher moves the page as well as the table: the table reads the
 * shipped `DataTableLabels` sets, while the sidebar reads `CHROME`, which is
 * demo furniture and so lives here rather than in `src/labels/`.
 */
export function Playground() {
  const [language, setLanguage] = useState<Language>("en")
  const [features, setFeatures] = useState<FeatureState>(DEFAULT_FEATURES)
  const [theme, setTheme] = useState<ThemeTokenState>(DEFAULT_THEME)
  const [query, setQuery] = useState<TableQuery>()

  const { page, loading, error, retry, failNext, setFailNext } = useReceiptsQuery(query)
  const columns = useMemo(() => buildReceiptColumns(language), [language])
  const chrome = CHROME[language]

  const table = useDataTable({
    id: "playground",
    columns,
    data: page?.rows ?? EMPTY,
    mode: "server",
    // `rowCount` stays unset — not `undefined` — until the first page
    // resolves, which is what `exactOptionalPropertyTypes` requires here.
    ...(page ? { rowCount: page.total } : {}),
    getRowId: (row) => row.id,
    onQueryChange: setQuery,
    storage,
    rowHeight: theme.rowHeight,
    features: {
      sorting: features.sorting,
      resizing: features.resizing,
      reordering: features.reordering,
      pinning: features.pinning,
      hiding: features.hiding,
    },
    pagination: features.pagination,
    // Quick search rides with filtering — turning the toggle off drops both,
    // which is also why `loadValues` only needs wiring in this one branch.
    filtering: features.filtering ? { loadValues: fetchValues } : false,
  })

  return (
    <div className="pg-root">
      <aside className="pg-sidebar">
        {/* The package name is a proper noun — it is not translated. */}
        <h1>@khojiakbarr/data-table</h1>
        <p className="pg-lede">{chrome.lede}</p>
        <LanguageSwitcher value={language} onChange={setLanguage} chrome={chrome} />
        <FeatureControls value={features} onChange={setFeatures} chrome={chrome} />
        <ThemeControls value={theme} onChange={setTheme} chrome={chrome} />
        <button
          type="button"
          className="pg-reset"
          onClick={() => {
            setFeatures(DEFAULT_FEATURES)
            setTheme(DEFAULT_THEME)
          }}
        >
          {chrome.resetAll}
        </button>
      </aside>

      <main className="pg-main">
        <label className="pg-fail-toggle">
          <input type="checkbox" checked={failNext} onChange={(event) => setFailNext(event.target.checked)} />
          {chrome.failNext}
        </label>

        <style>{themeStyleRule(theme)}</style>
        <DataTable
          instance={table}
          className={THEME_CLASS}
          height={620}
          striped={features.striped}
          toolbar={features.toolbar}
          footer={features.footer}
          virtualize={features.virtualize}
          stickyHeader={features.stickyHeader}
          // `theme` has no explicit `| undefined` in its own type — under
          // `exactOptionalPropertyTypes` the "follow the OS setting" case has
          // to omit the prop outright rather than pass it `undefined`.
          {...(theme.theme === "system" ? {} : { theme: theme.theme })}
          labels={LABELS[language]}
          loading={loading}
          error={error}
          onRetry={retry}
          renderDetail={features.detailPanel ? (row) => <ReceiptDetail row={row} language={language} /> : undefined}
        />
      </main>
    </div>
  )
}
