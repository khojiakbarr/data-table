import { createColumnHelper, type ColumnDef } from "@tanstack/react-table"
import type { DataTableFeatures } from "../useDataTable"
import type { Language } from "./playgroundState"
import { STATUS_LABELS } from "./statusLabels"
import { PARTNERS, type ServerReceipt } from "./fakeServer"

/** BCP-47 tag for each language, for date and number formatting. */
const LOCALE_TAG: Record<Language, string> = { en: "en-US", ru: "ru-RU", uz: "uz-UZ" }

const HEADERS: Record<Language, Record<keyof ServerReceipt, string>> = {
  en: { id: "Id", code: "Code", partner: "Partner", amount: "Amount", status: "Status", date: "Date", flagged: "Flagged" },
  ru: { id: "Id", code: "Код", partner: "Контрагент", amount: "Сумма", status: "Статус", date: "Дата", flagged: "Отмечено" },
  uz: { id: "Id", code: "Kod", partner: "Kontragent", amount: "Summa", status: "Holat", date: "Sana", flagged: "Belgilangan" },
}

/**
 * The two group headers the playground's columns nest under.
 *
 * Deliberately not over every column: half the set is grouped and half is
 * not, which is the shape that shows both what a group does to the header and
 * what the Columns panel makes of a tree that is only partly one.
 */
const GROUP_HEADERS: Record<Language, { document: string; payment: string }> = {
  en: { document: "Document", payment: "Payment" },
  ru: { document: "Документ", payment: "Оплата" },
  uz: { document: "Hujjat", payment: "Toʻlov" },
}

const FLAG_LABELS: Record<Language, [yes: string, no: string]> = {
  en: ["Yes", "No"],
  ru: ["Да", "Нет"],
  uz: ["Ha", "Yoʻq"],
}

/**
 * What a blank cell shows.
 *
 * An em dash rather than an empty cell, so a blank column is visibly blank
 * rather than indistinguishable from a rendering bug — and rather than
 * `Intl.NumberFormat.format(null)`, which silently prints `0` and would make
 * the rows a `blank` filter selects look like rows worth nothing.
 */
const BLANK_CELL = "—"

/**
 * The choices the `partner` cell editor offers.
 *
 * `meta.values` is the list editor's only source, and it feeds the filter too
 * wherever the filter is a list — `partner` filters as TEXT (inferred from its
 * values), so these reach the editor and nothing else.
 */
const PARTNER_OPTIONS = PARTNERS.map((partner) => ({ value: partner }))

const columnHelper = createColumnHelper<DataTableFeatures, ServerReceipt>()

/**
 * The playground's column set, translated for the given language.
 *
 * Headers, status text and the boolean display all change with the language
 * switcher; the underlying values the table filters and sorts by (raw status
 * codes, `YYYY-MM-DD` dates) do not, so a filter set under one language keeps
 * meaning the same thing under another.
 *
 * @param language - The language the language switcher is currently on.
 * @returns Column definitions ready for `useDataTable({ columns })`.
 */
// The `any` mirrors `useDataTable`'s own `columns` option: each column here
// carries its own value type (string, number, boolean), a single concrete
// type would reject the heterogeneous array, and the project's `declaration:
// true` requires an exported function's return type to be nameable — which
// rules out leaving it inferred, the same tradeoff the library's own option
// type already documents.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildReceiptColumns(language: Language): ColumnDef<DataTableFeatures, ServerReceipt, any>[] {
  const headers = HEADERS[language]
  const groups = GROUP_HEADERS[language]
  const statusLabels = STATUS_LABELS[language]
  const [yes, no] = FLAG_LABELS[language]
  const locale = LOCALE_TAG[language]
  const numberFormat = new Intl.NumberFormat(locale)
  const dateFormat = new Intl.DateTimeFormat(locale)

  return [
    columnHelper.group({
      id: "document",
      header: groups.document,
      columns: columnHelper.columns([
        /* Edits as text: the simplest of the five, and the one that proves
           the round trip without a parse in the way. */
        columnHelper.accessor("code", { header: headers.code, size: 130, meta: { editable: "text" } }),
        // Edits as a LIST: one of four known partners, or empty. The choices
        // are fixed rather than faceted, because a list editor asks which
        // values may be WRITTEN and a facet endpoint only knows which exist.
        columnHelper.accessor("partner", {
          header: headers.partner,
          size: 260,
          meta: { editable: "list", values: PARTNER_OPTIONS },
          // Both blank shapes render as nothing on their own — React skips
          // `null` and `""` alike — so the rows a `blank` filter selects would
          // look like a broken cell rather than an empty column.
          cell: (info) => {
            const partner: string | null = info.getValue()
            return partner === null || partner === "" ? BLANK_CELL : partner
          },
        }),
      ]),
    }),
    columnHelper.group({
      id: "payment",
      header: groups.payment,
      columns: columnHelper.columns([
        /*
         * Edits as a NUMBER, and only while the receipt is open: the predicate
         * form, where the column offers an editor and the row's own state
         * takes it away. A closed receipt's Edit item is disabled and says
         * which of the two refused it. The kind is not declared — there is no
         * `meta.filter` here either — so it is inferred the way the filter's
         * is, from the values: `number`.
         */
        columnHelper.accessor("amount", {
          header: headers.amount,
          size: 150,
          meta: { editable: (row: ServerReceipt) => row.status !== "closed" },
          cell: (info) => {
            const amount: number | null = info.getValue()
            return <span className="num">{amount === null ? BLANK_CELL : numberFormat.format(amount)}</span>
          },
        }),
        // In server mode there is nothing to facet from — one page is all the
        // client holds — so the values list comes from `loadValues`
        // (fakeServer's `fetchValues`), the same path a real server host takes.
        columnHelper.accessor("status", {
          header: headers.status,
          size: 140,
          // `groupLabel` mirrors the cell renderer below rather than sharing
          // it: a cell renderer returns a `ReactNode` and this has to return a
          // `string` — it is also the group row's accessible name, and the
          // two must not be free to diverge.
          meta: { filter: "list", groupLabel: (value) => statusLabels[String(value)] ?? String(value) },
          cell: (info) => statusLabels[info.getValue()] ?? info.getValue(),
        }),
      ]),
    }),
    // Left outside both groups on purpose: the header then has a grouped half
    // and a flat one, and the Columns panel a tree that is only partly nested.
    columnHelper.accessor("flagged", {
      header: headers.flagged,
      size: 110,
      meta: { filter: "boolean" },
      cell: (info) => <span>{info.getValue() ? yes : no}</span>,
    }),
    columnHelper.accessor("date", {
      header: headers.date,
      size: 130,
      meta: { filter: "date" },
      cell: (info) => dateFormat.format(new Date(`${info.getValue()}T00:00:00`)),
    }),
  ]
}

/** The partner's name, or a stand-in for the rows whose column is blank. */
const UNKNOWN_PARTNER: Record<Language, string> = {
  en: "an unnamed partner",
  ru: "неизвестного контрагента",
  uz: "nomaʼlum kontragent",
}

const DETAIL_COPY: Record<Language, (row: ServerReceipt, partner: string) => string> = {
  en: (row, partner) => `Receipt ${row.code} from ${partner}, recorded ${row.date}.`,
  ru: (row, partner) => `Квитанция ${row.code} от ${partner}, дата ${row.date}.`,
  uz: (row, partner) => `${partner}dan ${row.code} kvitansiyasi, sanasi ${row.date}.`,
}

/**
 * Content for a receipt's expanded row.
 *
 * Deliberately plain: the detail panel toggle exists to demonstrate that
 * `renderDetail` accepts anything, not to showcase a second table nested
 * inside — see `Demo.tsx`'s (removed) accordion example for that instead.
 *
 * @example
 * <DataTable instance={table} renderDetail={(row) => <ReceiptDetail row={row} language={language} />} />
 */
export function ReceiptDetail({ row, language }: { row: ServerReceipt; language: Language }) {
  const partner = row.partner === null || row.partner === "" ? UNKNOWN_PARTNER[language] : row.partner
  return <p className="pg-detail">{DETAIL_COPY[language](row, partner)}</p>
}
