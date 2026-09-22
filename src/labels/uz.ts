import type { DataTableLabels } from "../types"
import type { CellEditingLabels } from "./editing"

/**
 * Uzbek strings for the cell editors and the cell menu.
 *
 * A set of its own as well as part of {@link uzLabels}, which spreads it: a
 * shell that mounts `CellEditor` or `CellMenu` without the table needs these
 * fifteen and not the hundred the whole shell speaks. See `labels/editing.ts`.
 * The same orthography binds them, and `editingLabels.test.ts` holds that line.
 *
 * @example
 * <CellMenu labels={uzCellEditingLabels} … />
 */
export const uzCellEditingLabels: CellEditingLabels = {
  cellActions: "Katak amallari",
  edit: "Oʻzgartirish",
  editNotEditableColumn: "Bu ustunni oʻzgartirib boʻlmaydi",
  editNotEditableRow: "Bu qatorni oʻzgartirib boʻlmaydi",
  editNotEditableGroup: "Guruh qatorini oʻzgartirib boʻlmaydi",
  editUnavailable: "Oʻzgartirish imkoni yoʻq",
  editValue: "Qiymat",
  editHint: "Enter — saqlash, Escape — bekor qilish",
  invalidNumber: "Son kiriting",
  invalidDate: "Sanani YYYY-MM-DD koʻrinishida kiriting",
  invalidChoice: "Taklif etilgan qiymatlardan birini tanlang",
  booleanTrue: "Ha",
  booleanFalse: "Yoʻq",
  noValue: "(boʻsh)",
}

/**
 * Uzbek labels for the built-in shell.
 *
 * Pass as `labels={uzLabels}`, or spread to override a few:
 * `labels={{ ...uzLabels, empty: "Hech narsa yoʻq" }}`. Typed as the whole
 * `DataTableLabels` rather than a `Partial`, so a key added to the interface
 * fails to compile here instead of silently falling back to English.
 *
 * No plural helper, unlike {@link ruLabels}: a numeral in Uzbek governs the
 * bare singular, so it is `5 qator`, never `5 qatorlar`. That rule binds only a
 * noun a numeral actually governs — `searchResults` — and not a standalone
 * noun that happens to sit beside a number, which is why `rows` is the plural
 * `Qatorlar` (the footer reads "Qatorlar: 100 000", a heading and its count).
 *
 * Orthography: Uzbek Latin writes oʻ/gʻ with the modifier letter turned comma
 * ʻ (U+02BB) and the glottal stop with the modifier letter apostrophe ʼ
 * (U+02BC), never the ASCII quote. A test in `labels.test.ts` holds the line,
 * because an ASCII apostrophe typed by hand looks identical in most editors.
 *
 * @example
 * <DataTable instance={table} labels={uzLabels} />
 */
export const uzLabels: DataTableLabels = {
  ...uzCellEditingLabels,
  editPending: "Saqlanmoqda",
  editFailed: (column) => `«${column}» saqlanmadi`,
  editCancelled: (column) => `«${column}» oʻzgarishi bekor qilindi: qator sahifadan chiqib ketdi`,
  editRowFiltered: (column) => `«${column}» saqlandi. Qator endi filtrlarga mos kelmaydi`,
  dismiss: "Yopish",
  columnsTitle: "Ustunlar",
  sideBar: "Jadvalning yon paneli",
  showAll: "Hammasini koʻrsatish",
  reset: "Tiklash",
  pinStart: "Chapga mahkamlash",
  pinEnd: "Oʻngga mahkamlash",
  unpin: "Mahkamlashni bekor qilish",
  hide: "Yashirish",
  hideGrouped: "Qatorlar shu ustun boʻyicha guruhlangan",
  sortAscending: "Oʻsish boʻyicha saralash",
  sortDescending: "Kamayish boʻyicha saralash",
  clearSort: "Saralashni bekor qilish",
  empty: "Qator yoʻq",
  dragHint: "Tartibni oʻzgartirish uchun torting",
  reorderHint:
    "Probel — olish, strelkalar — koʻchirish, probel — qoʻyish, Escape — bekor qilish",
  reorderPosition: (column, position, total) => `${column}: ${total} tadan ${position}-oʻrin`,
  resizeColumn: "ustun kengligini oʻzgartirish",
  resizeTable: "Jadval balandligini oʻzgartirish",
  resizeTableHint:
    "Balandlikni oʻzgartirish uchun yuqoriga va pastga strelkalar, Shift bilan katta qadam",
  tableHeight: (pixels) => `Jadval balandligi ${pixels} piksel`,
  tableBody: "Jadval qatorlari",
  rowNumber: "Qator raqami",
  selectRow: (row) => `${row}-qatorni tanlash`,
  selectAllRows: (count) =>
    count === undefined ? "Barcha qatorlarni tanlash" : `Barcha ${count} ta qatorni tanlash`,
  expandRow: "Qatorni ochish",
  collapseRow: "Qatorni yopish",
  columnActions: "Ustun amallari",
  autosize: "Ustunni moslash",
  autosizeAll: "Barcha ustunlarni moslash",
  resetWidth: "Kenglikni tiklash",
  pinnedStartBadge: "Chapda",
  pinnedEndBadge: "Oʻngda",
  columnGroup: (group) => `${group} ustunlar guruhi`,
  expandGroup: "Guruhni yoyish",
  collapseGroup: "Guruhni yigʻish",
  rows: "Qatorlar",
  rowsPerPage: "Sahifadagi qatorlar",
  range: (from, to, total) => `${from}–${to} / ${total ?? "…"}`,
  page: (page, count) => `${page}-sahifa, jami ${count ?? "…"} ta`,
  pageNumber: "Sahifa raqami",
  pagination: "Sahifalash",
  firstPage: "Birinchi sahifa",
  previousPage: "Oldingi sahifa",
  nextPage: "Keyingi sahifa",
  lastPage: "Oxirgi sahifa",
  loading: "Yuklanmoqda",
  loadFailed: "Qatorlarni yuklab boʻlmadi",
  retry: "Qayta urinish",
  search: "Qidirish",
  searchLabel: "Qatorlar ichidan qidirish",
  clearSearch: "Qidiruvni tozalash",
  searchResults: (count) => (count === undefined ? "Qidirilmoqda" : `${count} ta qator topildi`),
  filter: "Filtr…",
  filterInPanel: "Panelda filtrlash…",
  filterTitle: (column) => `Filtr: ${column}`,
  filteredBadge: "Filtrlangan",
  apply: "Qoʻllash",
  clearFilter: "Filtrni tozalash",
  operator: "Shart",
  filterValue: "Qiymat",
  // Screen-reader names for the two range inputs, spoken as "Summa: Boshlanishi".
  // The suffixes -dan/-gacha would be the words a sentence uses, but they never
  // stand alone, so the bound forms give way to free-standing verbal nouns.
  rangeFrom: "Boshlanishi",
  rangeTo: "Tugashi",
  opContains: "Oʻz ichiga oladi",
  opNotContains: "Oʻz ichiga olmaydi",
  opEquals: "Teng",
  opNotEquals: "Teng emas",
  opStartsWith: "Shu bilan boshlanadi",
  opEndsWith: "Shu bilan tugaydi",
  opEq: "Teng",
  opNe: "Teng emas",
  // Bare "Kichik"/"Katta" read as the adjectives small/big. Uzbek states the
  // comparison with a -dan complement the operator list cannot carry, so the
  // symbol does that work: the label is read out with the value after it.
  opLt: "Kichik (<)",
  opLte: "Kichik yoki teng (≤)",
  opGt: "Katta (>)",
  opGte: "Katta yoki teng (≥)",
  opBetween: "Oraligʻida",
  opDateIs: "Shu kuni",
  opDateBefore: "Shu kungacha",
  opDateAfter: "Shu kundan keyin",
  opDateBetween: "Oraligʻida",
  opIsTrue: "Ha",
  opIsFalse: "Yoʻq",
  opIn: "Shulardan biri",
  opNotIn: "Shulardan hech biri",
  opBlank: "Boʻsh",
  opNotBlank: "Boʻsh emas",
  searchValues: "Qiymatlarni qidirish",
  selectAll: "Hammasini tanlash",
  blanks: "(Boʻsh)",
  noValues: "Tanlash uchun qiymat yoʻq",
  valuesFailed: "Qiymatlarni yuklab boʻlmadi",
  filtersTab: "Filtrlar",
  hiddenColumn: "Yashirilgan",
  noFilters: "Filtr qoʻyilmagan",
  clearAllFilters: "Barcha filtrlarni tozalash",
  noMatches: "Filtrlarga mos qator topilmadi",
  clearFilters: "Filtrlarni tozalash",
  groupedBadge: "Guruhlangan",
  groupCount: (count) => `(${count})`,
  // A numeral governs the bare singular in Uzbek: `5 ta qator`, never
  // `qatorlar` — the same rule `searchResults` follows above.
  groupRow: (value, count) => `${value}, ${count} ta qator`,
  groupContinued: (path) => `${path.join(" › ")} (davomi)`,
  clearGrouping: "Guruhlashni tozalash",
  rowGroupsTitle: "Qatorlar guruhlanishi",
  rowGroupsHint: "Qatorlarni ustun boʻyicha guruhlash uchun ustunni shu yerga torting",
  groupByColumn: (column) => `Qatorlarni «${column}» ustuni boʻyicha guruhlash`,
  ungroupColumn: (column) => `«${column}» ustunini guruhlashdan olib tashlash`,
  rowGroupLevel: (column, level, total) =>
    `${column}: guruhlash darajasi ${level} / ${total}`,
  // A numeral governs the bare singular in Uzbek — the same rule
  // `searchResults` follows above — so `raw` is read by no branch here.
  statusBarRows: (count) => `Jami ${count} ta qator`,
  statusBarFiltered: (count, _raw, total) =>
    total === undefined ? `Filtrlangan: ${count} ta qator` : `Filtrlangan: ${count} / ${total} ta qator`,
  statusBarGroupedBy: (columns) => `Guruhlangan: ${columns.join(", ")}`,
  totalsRow: "Jami",
}
