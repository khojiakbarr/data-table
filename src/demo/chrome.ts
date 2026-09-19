import type { FeatureState, FontChoiceKey, Language, ThemeColorKey, ThemeSizeKey } from "./playgroundState"

/**
 * Every string the playground's own chrome says, for one language.
 *
 * Deliberately separate from `DataTableLabels`: those are library surface a
 * host translates for its users, these are demo furniture. Shipping the page's
 * sidebar copy from `src/labels/` would put "Fail the next request" in the
 * published bundle, where no host has any use for it.
 *
 * One flat-ish object per language rather than a key-per-file catalogue,
 * because the whole point is that a translator can read the page in one screen
 * and a missing key is a compile error rather than a silent English fallback.
 */
export interface ChromeStrings {
  /** The paragraph under the title explaining what the page is. */
  lede: string
  language: { legend: string; groupLabel: string }
  features: {
    groupLabel: string
    legends: Record<"interactions" | "data" | "layout", string>
    labels: Record<keyof FeatureState, string>
    hints: Record<"filtering" | "pagination" | "detailPanel", string>
  }
  theme: {
    groupLabel: string
    legends: Record<"appearance" | "colors" | "sizing", string>
    appearance: string
    fontFamily: string
    modes: Record<"light" | "dark" | "system", string>
    fonts: Record<FontChoiceKey, string>
    colors: Record<ThemeColorKey, string>
    sizes: Record<ThemeSizeKey, string>
    reset: string
  }
  /** The control that arms the injected failure, so the error banner is reachable. */
  failNext: string
  resetAll: string
}

const en: ChromeStrings = {
  lede:
    "A live playground: every toggle and every color below drives a real prop or option, nothing " +
    "is faked. The table on the right always talks to a fake server, 100 000 rows deep.",
  language: { legend: "Language", groupLabel: "Page and table language" },
  features: {
    groupLabel: "Feature toggles",
    legends: { interactions: "Interactions", data: "Data", layout: "Table appearance" },
    labels: {
      sorting: "Sorting",
      resizing: "Column resizing",
      reordering: "Column reordering",
      pinning: "Column pinning",
      hiding: "Column hiding",
      filtering: "Filtering",
      pagination: "Pagination",
      striped: "Striped rows",
      toolbar: "Toolbar",
      footer: "Footer",
      virtualize: "Virtualize",
      stickyHeader: "Sticky header",
      detailPanel: "Detail panel",
    },
    hints: {
      filtering: "Quick search rides with this",
      pagination: "Server mode needs paging — with it off you see one page of 50 and no way to the rest",
      detailPanel: "Expand a row for more",
    },
  },
  theme: {
    groupLabel: "Theme tokens",
    legends: { appearance: "Appearance", colors: "Colors", sizing: "Sizing" },
    appearance: "Base theme",
    fontFamily: "Font family",
    modes: { light: "Light", dark: "Dark", system: "System" },
    fonts: { system: "System UI", mono: "Monospace", serif: "Serif", sans: "Sans-serif" },
    colors: {
      background: "Background",
      foreground: "Foreground",
      accent: "Accent",
      accentText: "Accent text",
      border: "Border",
      headerBackground: "Header background",
      headerForeground: "Header foreground",
      rowHover: "Row hover",
      rowStripe: "Row stripe",
      detailBackground: "Detail background",
    },
    sizes: {
      headerHeight: "Header height",
      rowHeight: "Row height",
      radius: "Corner radius",
      fontSize: "Font size",
    },
    reset: "Reset theme",
  },
  failNext: "Fail the next request",
  resetAll: "Reset everything",
}

const ru: ChromeStrings = {
  lede:
    "Живая площадка: каждый переключатель и каждый цвет ниже меняет настоящий проп или опцию, " +
    "ничего не имитируется. Таблица справа всегда обращается к фиктивному серверу со 100 000 строк.",
  language: { legend: "Язык", groupLabel: "Язык страницы и таблицы" },
  features: {
    groupLabel: "Переключатели возможностей",
    legends: { interactions: "Взаимодействие", data: "Данные", layout: "Вид таблицы" },
    labels: {
      sorting: "Сортировка",
      resizing: "Изменение ширины столбцов",
      reordering: "Перестановка столбцов",
      pinning: "Закрепление столбцов",
      hiding: "Скрытие столбцов",
      filtering: "Фильтрация",
      pagination: "Постраничный вывод",
      striped: "Чередование строк",
      toolbar: "Панель инструментов",
      footer: "Нижняя панель",
      virtualize: "Виртуализация",
      stickyHeader: "Закреплённая шапка",
      detailPanel: "Панель подробностей",
    },
    hints: {
      filtering: "Быстрый поиск идёт вместе с ней",
      pagination:
        "Серверному режиму нужна постраничность — без неё видна одна страница из 50 строк, " +
        "а до остальных не добраться",
      detailPanel: "Разверните строку, чтобы увидеть больше",
    },
  },
  theme: {
    groupLabel: "Токены темы",
    legends: { appearance: "Оформление", colors: "Цвета", sizing: "Размеры" },
    appearance: "Базовая тема",
    fontFamily: "Шрифт",
    modes: { light: "Светлая", dark: "Тёмная", system: "Системная" },
    fonts: { system: "Системный", mono: "Моноширинный", serif: "С засечками", sans: "Без засечек" },
    colors: {
      background: "Фон",
      foreground: "Текст",
      accent: "Акцент",
      accentText: "Акцентный текст",
      border: "Границы",
      headerBackground: "Фон шапки",
      headerForeground: "Текст шапки",
      rowHover: "Строка под курсором",
      rowStripe: "Чередующаяся строка",
      detailBackground: "Фон подробностей",
    },
    sizes: {
      headerHeight: "Высота шапки",
      rowHeight: "Высота строки",
      radius: "Скругление углов",
      fontSize: "Размер шрифта",
    },
    reset: "Сбросить тему",
  },
  failNext: "Провалить следующий запрос",
  resetAll: "Сбросить всё",
}

const uz: ChromeStrings = {
  lede:
    "Jonli maydon: quyidagi har bir kalit va har bir rang haqiqiy prop yoki opsiyani boshqaradi, " +
    "hech narsa soxta emas. Oʻngdagi jadval doimo 100 000 qatorli soxta serverga murojaat qiladi.",
  language: { legend: "Til", groupLabel: "Sahifa va jadval tili" },
  features: {
    groupLabel: "Imkoniyat kalitlari",
    legends: { interactions: "Amallar", data: "Maʼlumotlar", layout: "Jadval koʻrinishi" },
    labels: {
      sorting: "Saralash",
      resizing: "Ustun kengligini oʻzgartirish",
      reordering: "Ustunlarni qayta tartiblash",
      pinning: "Ustunlarni mahkamlash",
      hiding: "Ustunlarni yashirish",
      filtering: "Filtrlash",
      pagination: "Sahifalash",
      striped: "Navbatma-navbat qatorlar",
      toolbar: "Asboblar paneli",
      footer: "Pastki panel",
      virtualize: "Virtualizatsiya",
      stickyHeader: "Mahkamlangan sarlavha",
      detailPanel: "Tafsilotlar paneli",
    },
    hints: {
      filtering: "Tezkor qidiruv shu bilan birga keladi",
      pagination:
        "Server rejimiga sahifalash kerak — oʻchirilganda 50 qatorlik bitta sahifa koʻrinadi, " +
        "qolganiga yoʻl qolmaydi",
      detailPanel: "Batafsil koʻrish uchun qatorni yoying",
    },
  },
  theme: {
    groupLabel: "Mavzu tokenlari",
    legends: { appearance: "Koʻrinish", colors: "Ranglar", sizing: "Oʻlchamlar" },
    appearance: "Asosiy mavzu",
    fontFamily: "Shrift",
    modes: { light: "Yorugʻ", dark: "Toʻq", system: "Tizim" },
    fonts: { system: "Tizim shrifti", mono: "Monospace", serif: "Serif", sans: "Sans-serif" },
    colors: {
      background: "Fon",
      foreground: "Matn",
      accent: "Urgʻu",
      accentText: "Urgʻu matni",
      border: "Chegara",
      headerBackground: "Sarlavha foni",
      headerForeground: "Sarlavha matni",
      rowHover: "Kursor ostidagi qator",
      rowStripe: "Navbatdagi qator",
      detailBackground: "Tafsilotlar foni",
    },
    sizes: {
      headerHeight: "Sarlavha balandligi",
      rowHeight: "Qator balandligi",
      radius: "Burchak radiusi",
      fontSize: "Shrift oʻlchami",
    },
    reset: "Mavzuni tiklash",
  },
  failNext: "Keyingi soʻrovni xatoga uchratish",
  resetAll: "Hammasini tiklash",
}

/**
 * The playground's own copy in all three languages, keyed the same way the
 * library's label sets are.
 *
 * @example
 * const chrome = CHROME[language]
 */
export const CHROME: Record<Language, ChromeStrings> = { en, ru, uz }
