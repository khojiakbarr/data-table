import { createColumnHelper, type ColumnDef } from "@tanstack/react-table"
import type { DataTableFeatures } from "../useDataTable"
import type { Language } from "./playgroundState"
import type { ServerReceipt } from "./fakeServer"

/** BCP-47 tag for each language, for date and number formatting. */
const LOCALE_TAG: Record<Language, string> = { en: "en-US", ru: "ru-RU", uz: "uz-UZ" }

const HEADERS: Record<Language, Record<keyof ServerReceipt, string>> = {
  en: { id: "Id", code: "Code", partner: "Partner", amount: "Amount", status: "Status", date: "Date", flagged: "Flagged" },
  ru: { id: "Id", code: "Код", partner: "Контрагент", amount: "Сумма", status: "Статус", date: "Дата", flagged: "Отмечено" },
  uz: { id: "Id", code: "Kod", partner: "Kontragent", amount: "Summa", status: "Holat", date: "Sana", flagged: "Belgilangan" },
}

const STATUS_LABELS: Record<Language, Record<string, string>> = {
  en: { open: "Open", in_process: "In process", received: "Received", closed: "Closed" },
  ru: { open: "Открыт", in_process: "В процессе", received: "Получен", closed: "Закрыт" },
  uz: { open: "Ochiq", in_process: "Jarayonda", received: "Qabul qilingan", closed: "Yopilgan" },
}

const FLAG_LABELS: Record<Language, [yes: string, no: string]> = {
  en: ["Yes", "No"],
  ru: ["Да", "Нет"],
  uz: ["Ha", "Yo'q"],
}

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
  const statusLabels = STATUS_LABELS[language]
  const [yes, no] = FLAG_LABELS[language]
  const locale = LOCALE_TAG[language]
  const numberFormat = new Intl.NumberFormat(locale)
  const dateFormat = new Intl.DateTimeFormat(locale)

  return [
    columnHelper.accessor("code", { header: headers.code, size: 130 }),
    columnHelper.accessor("partner", { header: headers.partner, size: 260 }),
    columnHelper.accessor("amount", {
      header: headers.amount,
      size: 150,
      cell: (info) => <span className="num">{numberFormat.format(info.getValue())}</span>,
    }),
    // In server mode there is nothing to facet from — one page is all the
    // client holds — so the values list comes from `loadValues` (fakeServer's
    // `fetchValues`), the same path a real server host takes.
    columnHelper.accessor("status", {
      header: headers.status,
      size: 140,
      meta: { filter: "list" },
      cell: (info) => statusLabels[info.getValue()] ?? info.getValue(),
    }),
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

const DETAIL_COPY: Record<Language, (row: ServerReceipt) => string> = {
  en: (row) => `Receipt ${row.code} from ${row.partner}, recorded ${row.date}.`,
  ru: (row) => `Квитанция ${row.code} от контрагента «${row.partner}», дата ${row.date}.`,
  uz: (row) => `${row.partner} kontragentidan ${row.code} kvitansiyasi, sanasi ${row.date}.`,
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
  return <p className="pg-detail">{DETAIL_COPY[language](row)}</p>
}
