import { useEffect, useMemo, useState } from "react"
import { formatCount } from "../core/formatCount"
import { DataTable, defaultLabels } from "../components/DataTable"
import { localStorageLayout } from "../core/persistence"
import type { TableQuery } from "../core/query"
import type { DataTableLabels } from "../types"
import { useDataTable } from "../useDataTable"
import { ruLabels } from "../labels/ru"
import { uzLabels } from "../labels/uz"
import { CHROME } from "./chrome"
import { FeatureControls } from "./FeatureControls"
import { PlaygroundHeader } from "./PlaygroundHeader"
import { ThemeControls } from "./ThemeControls"
import { buildReceiptColumns, LOCALE_TAG, ReceiptDetail } from "./receiptColumns"
import {
  fetchValues,
  flagReceipts,
  saveReceipt,
  type ServerReceipt,
  type ServerRow,
} from "./fakeServer"
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
 * Laid out as masthead / rail / stage. The table is the subject, so it gets
 * the whole of the right-hand column and every piece of chrome around it is
 * quieter than it is: the rail is a scroll region of its own so the knobs
 * never push the table down the page, and the stage is a plain card with no
 * decoration competing with the grid inside it.
 *
 * Server mode only, on purpose: this is how the table is actually used, and a
 * client/server switch would double every control for a comparison nobody
 * asked for. There is deliberately no CSS-export button either — see
 * {@link ThemeControls}'s docblock.
 *
 * The switcher moves the page as well as the table: the table reads the
 * shipped `DataTableLabels` sets, while the page's own chrome reads `CHROME`,
 * which is demo furniture and so lives here rather than in `src/labels/`.
 */
export function Playground() {
  const [language, setLanguage] = useState<Language>("en")
  const [features, setFeatures] = useState<FeatureState>(DEFAULT_FEATURES)
  const [theme, setTheme] = useState<ThemeTokenState>(DEFAULT_THEME)
  const [query, setQuery] = useState<TableQuery>()
  /**
   * The bulk write in flight, and the last one's result.
   *
   * Both states the 4-state rule asks for on an async surface that has no
   * skeleton to show: the buttons go disabled and say so while the server is
   * thinking, and what it answered — how many rows it actually changed — is
   * said afterwards rather than assumed from the count on screen.
   */
  const [bulkPending, setBulkPending] = useState(false)
  const [bulkDone, setBulkDone] = useState<number | null>(null)

  // The switcher moves the whole document, not just the words: `lang` is what
  // a screen reader reads pronunciation from, and `index.html` can only ever
  // ship one value for a page with three.
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const { page, loading, error, retry, failNext, setFailNext } = useReceiptsQuery(query)
  const columns = useMemo(() => buildReceiptColumns(language), [language])
  const chrome = CHROME[language]
  // The same locale the Amount column's own cells format with — see
  // `LOCALE_TAG`'s own docblock — so the totals row's number and the body's
  // never disagree about what a thousand looks like.
  const amountFormat = useMemo(() => new Intl.NumberFormat(LOCALE_TAG[language]), [language])

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
    // Same reasoning: the status bar's "X of Y" has nothing to show until a
    // page has actually answered.
    ...(page ? { unfilteredTotal: page.unfilteredTotal } : {}),
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
      rowNumbers: features.rowNumbers,
      selection: features.selection,
      statusBar: features.statusBar,
    },
    /*
     * The last write's result stands until the user picks something NEW.
     *
     * Not until the selection is cleared: a successful write clears it itself,
     * and that clear is announced here — so resetting on every announcement
     * wiped the report on the very tick it was written. Cleared on a non-empty
     * selection instead, which is the moment the number stops describing what
     * is on screen.
     */
    onSelectionChange: (change) => {
      if (change.mode === "all-matching" || (change.ids?.length ?? 0) > 0) setBulkDone(null)
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
      <PlaygroundHeader language={language} onLanguageChange={setLanguage} chrome={chrome} />

      <div className="pg-body">
        <aside className="pg-rail">
          <p className="pg-lede">{chrome.lede}</p>

          <section className="pg-panel">
            <h2 className="pg-panel-title">{chrome.features.groupLabel}</h2>
            <FeatureControls value={features} onChange={setFeatures} chrome={chrome} />
          </section>

          <section className="pg-panel">
            <h2 className="pg-panel-title">{chrome.theme.groupLabel}</h2>
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
          </section>

          <button
            type="button"
            className="pg-button pg-button-strong"
            onClick={() => {
              setFeatures(DEFAULT_FEATURES)
              setTheme(DEFAULT_THEME)
            }}
          >
            {chrome.resetAll}
          </button>
        </aside>

        <main className="pg-main">
          <div className="pg-stage-bar">
            <label className="pg-fail-toggle">
              <input
                type="checkbox"
                checked={failNext}
                onChange={(event) => setFailNext(event.target.checked)}
              />
              {chrome.failNext}
            </label>
            {/*
              What the bulk write actually changed, as the SERVER counted it —
              not the number the bar showed before it ran. Announced politely
              because by the time it appears the bar it replaces is gone, and a
              screen-reader user would otherwise have no report at all.
            */}
            <p className="pg-bulk-done" role="status">
              {bulkDone === null ? "" : chrome.bulk.done(formatCount(bulkDone), bulkDone)}
            </p>
          </div>

          <div className="pg-stage">
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
              renderDetail={
                features.detailPanel ? (row) => <ReceiptDetail row={row} language={language} /> : undefined
              }
              /*
               * A real round trip, the same as the bulk-action bar just below:
               * `amountTotal` is the fake server's own answer, summed over every
               * row the current query matches — not typed into the demo, and
               * not summed from the fifty rows on this page. `{}` while `page`
               * has not resolved yet keeps the row on screen with only its
               * caption, rather than having it pop into existence — and shift
               * the body down — the instant the first answer lands.
               */
              totals={
                features.totals
                  ? page
                    ? { amount: amountFormat.format(page.amountTotal) }
                    : {}
                  : undefined
              }
              /*
               * The bulk-action bar, and a REAL round trip behind it: the
               * whole published selection — the model and the query it is
               * relative to — goes to the fake server, which turns it into
               * `WHERE <the filters> AND id NOT IN (<excluded>)` and writes
               * every matching row. Ticking the header and pressing this
               * really does flag a hundred thousand receipts; the page is then
               * refetched, the same way the cell editor's own write is.
               */
              renderSelectionActions={
                features.selection
                  ? ({ mode, ids, excluded, query: selectionQuery, count, clear }) => {
                      const run = async (flagged: boolean): Promise<void> => {
                        setBulkPending(true)
                        try {
                          const { changed } = await flagReceipts({
                            mode,
                            ...(ids ? { ids } : {}),
                            ...(excluded ? { excluded } : {}),
                            query: selectionQuery,
                            flagged,
                          })
                          setBulkDone(changed)
                          clear()
                          // The rows on screen are stale the moment the write
                          // lands, so the host asks for its page again.
                          retry()
                        } finally {
                          setBulkPending(false)
                        }
                      }
                      return (
                        <>
                          <strong className="pg-bulk-count">
                            {chrome.bulk.selected(
                              count === undefined ? undefined : formatCount(count),
                              count,
                            )}
                          </strong>
                          <button
                            type="button"
                            className="pg-button pg-button-strong"
                            disabled={bulkPending}
                            onClick={() => void run(true)}
                          >
                            {bulkPending ? chrome.bulk.working : chrome.bulk.flag}
                          </button>
                          <button
                            type="button"
                            className="pg-button"
                            disabled={bulkPending}
                            onClick={() => void run(false)}
                          >
                            {chrome.bulk.unflag}
                          </button>
                          <button
                            type="button"
                            className="pg-button"
                            disabled={bulkPending}
                            onClick={clear}
                          >
                            {chrome.bulk.cancel}
                          </button>
                        </>
                      )
                    }
                  : undefined
              }
            />
          </div>
        </main>
      </div>
    </div>
  )
}
