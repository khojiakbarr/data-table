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
import { fetchValues, saveReceipt, type ServerReceipt, type ServerRow } from "./fakeServer"
import {
  DEFAULT_FEATURES,
  DEFAULT_THEME,
  resolveThemeValues,
  THEME_CLASS,
  themeStyleRule,
  useBaseThemeMode,
  type FeatureState,
  type Language,
  type ThemeTokenState,
} from "./playgroundState"
import { useReceiptsQuery } from "./useReceiptsQuery"

const LABELS: Record<Language, DataTableLabels> = { en: defaultLabels, ru: ruLabels, uz: uzLabels }
const storage = localStorageLayout()
/**
 * The `height` prop the table starts at.
 *
 * Only the starting point: the grip on the bottom edge and the Sizing group's
 * height field both write an override into the saved layout, which is what the
 * table then renders at until "Reset" clears it.
 */
const START_HEIGHT = 620
const EMPTY: ServerRow[] = []

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

  // The controls show, and the table reads, the base theme's own value for
  // every token the user has not moved — so "System" on a dark OS starts the
  // pickers at the dark palette rather than at the light one it is not using.
  const baseMode = useBaseThemeMode(theme.theme)
  const themeValues = resolveThemeValues(theme, baseMode)

  const table = useDataTable<ServerReceipt>({
    id: "playground",
    columns,
    data: page?.rows ?? EMPTY,
    mode: "server",
    // `rowCount` stays unset — not `undefined` — until the first page
    // resolves, which is what `exactOptionalPropertyTypes` requires here.
    ...(page ? { rowCount: page.total } : {}),
    // Which open group the page's first row sits inside, so the table can draw
    // a "continued" header when a page boundary falls inside a group.
    ...(page ? { startPath: page.startPath } : {}),
    getRowId: (row) => row.id,
    onQueryChange: setQuery,
    storage,
    rowHeight: themeValues.rowHeight,
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
    // Wrapped rather than passed straight through so the Status list filter
    // gets its options' `label` in whichever language the switcher is on.
    filtering: features.filtering
      ? { loadValues: (columnId, options) => fetchValues(columnId, options, language) }
      : false,
  })

  return (
    <div className="pg-root">
      <aside className="pg-sidebar">
        {/* The package name is a proper noun — it is not translated. */}
        <h1>@khojiakbarr/data-table</h1>
        <p className="pg-lede">{chrome.lede}</p>
        <LanguageSwitcher value={language} onChange={setLanguage} chrome={chrome} />
        <FeatureControls value={features} onChange={setFeatures} chrome={chrome} />
        <ThemeControls
          value={theme}
          resolved={themeValues}
          onChange={setTheme}
          /*
           * The field and the table's own grip are one control in two places:
           * both read `instance.tableHeight` and both write through its
           * setter, so neither can show a height the other has moved past.
           * Until the first change there is no override, and the field shows
           * the `height` prop below — the value actually on screen.
           */
          tableHeight={table.tableHeight.value ?? START_HEIGHT}
          minTableHeight={table.tableHeight.min}
          onTableHeightChange={table.tableHeight.set}
          chrome={chrome}
        />

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
          height={START_HEIGHT}
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
          onCellEdit={async ({ row, columnId, value }) => {
            await saveReceipt({ id: row.id, columnId, value })
            /*
             * A write invalidates the page on screen, so the host asks for it
             * again — which is what a server-mode host does, and what makes
             * the round trip visible here rather than mocked at the last step.
             * `retry` is the hook's one "run the current query again" trigger;
             * the error banner is only its other caller.
             *
             * Until that answer lands the table goes on showing the value the
             * user typed, settled rather than pending, and steps aside the
             * moment the server's own answer replaces it.
             */
            retry()
          }}
          renderDetail={features.detailPanel ? (row) => <ReceiptDetail row={row} language={language} /> : undefined}
        />
      </main>
    </div>
  )
}
