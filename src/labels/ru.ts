import type { DataTableLabels } from "../types"
import type { CellEditingLabels } from "./editing"

/**
 * Picks the Russian form a numeral governs.
 *
 * Russian agrees a counted noun with the last digit, not with the number:
 * 1 строка, 2 строки, 5 строк — and the teens take the many-form whatever
 * their last digit is (11 строк, not 11 строка). A UI that ignores this reads
 * as machine-translated, which is why the counted labels below go through it
 * rather than concatenating a plural suffix.
 *
 * @param count - The number governing the noun.
 * @param one - Form for 1, 21, 31 … (nominative singular).
 * @param few - Form for 2–4, 22–24 … (genitive singular).
 * @param many - Form for 0, 5–20, 25–30 … (genitive plural).
 * @returns The form `count` governs.
 *
 * @example
 * plural(5, "строка", "строки", "строк") // "строк"
 */
function plural(count: number, one: string, few: string, many: string): string {
  const lastTwo = Math.abs(count) % 100
  if (lastTwo >= 11 && lastTwo <= 14) return many
  const last = lastTwo % 10
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

/**
 * Russian strings for the cell editors and the cell menu.
 *
 * A set of its own as well as part of {@link ruLabels}, which spreads it: a
 * shell that mounts `CellEditor` or `CellMenu` without the table needs these
 * fifteen and not the hundred the whole shell speaks. See `labels/editing.ts`.
 *
 * @example
 * <CellMenu labels={ruCellEditingLabels} … />
 */
export const ruCellEditingLabels: CellEditingLabels = {
  cellActions: "Действия с ячейкой",
  edit: "Изменить",
  editNotEditableColumn: "Этот столбец нельзя изменить",
  editNotEditableRow: "Эту строку нельзя изменить",
  editNotEditableGroup: "Группу строк нельзя изменить",
  editUnavailable: "Изменение недоступно",
  editValue: "Значение",
  editHint: "Enter — сохранить, Escape — отменить",
  invalidNumber: "Введите число",
  invalidDate: "Введите дату в формате ГГГГ-ММ-ДД",
  invalidChoice: "Выберите одно из предложенных значений",
  booleanTrue: "Да",
  booleanFalse: "Нет",
  noValue: "(пусто)",
}

/**
 * Russian labels for the built-in shell.
 *
 * Pass as `labels={ruLabels}`, or spread to override a few:
 * `labels={{ ...ruLabels, empty: "Ничего нет" }}`. Typed as the whole
 * `DataTableLabels` rather than a `Partial`, so a key added to the interface
 * fails to compile here instead of silently falling back to English.
 *
 * @example
 * <DataTable instance={table} labels={ruLabels} />
 */
export const ruLabels: DataTableLabels = {
  ...ruCellEditingLabels,
  editPending: "Сохранение",
  editFailed: (column) => `Не удалось сохранить «${column}»`,
  editCancelled: (column) => `Изменение «${column}» отменено: строка ушла со страницы`,
  editRowFiltered: (column) => `«${column}» сохранено. Строка больше не соответствует фильтрам`,
  dismiss: "Закрыть",
  columnsTitle: "Столбцы",
  sideBar: "Боковая панель таблицы",
  showAll: "Показать все",
  reset: "Сбросить",
  pinStart: "Закрепить слева",
  pinEnd: "Закрепить справа",
  unpin: "Открепить",
  hide: "Скрыть",
  hideGrouped: "Строки сгруппированы по этому столбцу",
  sortAscending: "Сортировать по возрастанию",
  sortDescending: "Сортировать по убыванию",
  clearSort: "Отменить сортировку",
  empty: "Нет строк",
  dragHint: "Перетащите, чтобы изменить порядок",
  reorderHint:
    "Пробел — взять, стрелки — переместить, пробел — отпустить, Escape — отменить",
  reorderPosition: (column, position, total) => `${column}: позиция ${position} из ${total}`,
  resizeColumn: "изменить ширину столбца",
  resizeTable: "Изменить высоту таблицы",
  resizeTableHint: "Стрелки вверх и вниз меняют высоту, Shift — крупный шаг",
  tableHeight: (pixels) =>
    `Высота таблицы ${pixels} ${plural(pixels, "пиксель", "пикселя", "пикселей")}`,
  expandRow: "Развернуть строку",
  collapseRow: "Свернуть строку",
  columnActions: "Действия со столбцом",
  autosize: "По содержимому",
  autosizeAll: "Все столбцы по содержимому",
  resetWidth: "Сбросить ширину",
  pinnedStartBadge: "Слева",
  pinnedEndBadge: "Справа",
  columnGroup: (group) => `${group}: группа столбцов`,
  expandGroup: "Развернуть группу",
  collapseGroup: "Свернуть группу",
  rows: "Строк",
  rowsPerPage: "Строк на странице",
  range: (from, to, total) => `${from}–${to} из ${total ?? "…"}`,
  page: (page, count) => `Страница ${page} из ${count ?? "…"}`,
  pageNumber: "Номер страницы",
  pagination: "Постраничная навигация",
  firstPage: "Первая страница",
  previousPage: "Предыдущая страница",
  nextPage: "Следующая страница",
  lastPage: "Последняя страница",
  loading: "Загрузка",
  loadFailed: "Не удалось загрузить строки",
  retry: "Повторить",
  search: "Поиск",
  searchLabel: "Поиск по строкам",
  clearSearch: "Очистить поиск",
  searchResults: (count) =>
    count === undefined ? "Идёт поиск" : `Найдено: ${count} ${plural(count, "строка", "строки", "строк")}`,
  filter: "Фильтр…",
  filterInPanel: "Фильтр в панели…",
  filterTitle: (column) => `Фильтр: ${column}`,
  filteredBadge: "Отфильтровано",
  apply: "Применить",
  clearFilter: "Очистить фильтр",
  operator: "Условие",
  filterValue: "Значение",
  rangeFrom: "От",
  rangeTo: "До",
  opContains: "Содержит",
  opNotContains: "Не содержит",
  opEquals: "Равно",
  opNotEquals: "Не равно",
  opStartsWith: "Начинается с",
  opEndsWith: "Заканчивается на",
  opEq: "Равно",
  opNe: "Не равно",
  opLt: "Меньше",
  opLte: "Меньше или равно",
  opGt: "Больше",
  opGte: "Больше или равно",
  opBetween: "В диапазоне",
  // The column is already a date one and its own name sits above this list, so
  // "Дата равна" repeats what the reader can see; the operator alone is enough.
  opDateIs: "Равно",
  opDateBefore: "До",
  opDateAfter: "После",
  opDateBetween: "В диапазоне",
  opIsTrue: "Да",
  opIsFalse: "Нет",
  opIn: "Одно из",
  opNotIn: "Ни одно из",
  opBlank: "Пусто",
  opNotBlank: "Не пусто",
  searchValues: "Поиск значений",
  selectAll: "Выбрать все",
  blanks: "(Пустые)",
  noValues: "Нет значений для выбора",
  valuesFailed: "Не удалось загрузить значения",
  filtersTab: "Фильтры",
  hiddenColumn: "Скрыт",
  noFilters: "Фильтры не заданы",
  clearAllFilters: "Очистить все фильтры",
  noMatches: "Нет строк, удовлетворяющих фильтрам",
  clearFilters: "Очистить фильтры",
  groupedBadge: "Сгруппировано",
  groupCount: (count) => `(${count})`,
  groupRow: (value, count) => `${value}, ${count} ${plural(count, "строка", "строки", "строк")}`,
  groupContinued: (path) => `${path.join(" › ")} (продолжение)`,
  clearGrouping: "Очистить группировку",
  rowGroupsTitle: "Группировка строк",
  rowGroupsHint: "Перетащите сюда столбец, чтобы сгруппировать строки по нему",
  groupByColumn: (column) => `Группировать строки по столбцу «${column}»`,
  ungroupColumn: (column) => `Убрать «${column}» из группировки строк`,
  rowGroupLevel: (column, level, total) => `${column}: уровень группировки ${level} из ${total}`,
}
