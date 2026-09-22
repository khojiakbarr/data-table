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
  /** The page header: what the LIBRARY is, and where to get it. */
  header: {
    /**
     * One line under the wordmark.
     *
     * Says what the package is, not what this page is — a visitor who has
     * never heard of it reads this before anything else. {@link lede} is the
     * other half of that job and describes the playground instead.
     */
    tagline: string
    /** Accessible name for the links landmark, since "GitHub"/"npm" carry no language. */
    nav: string
    links: { github: string; npm: string }
  }
  /** The paragraph over the controls explaining what the page is. */
  lede: string
  language: { legend: string; groupLabel: string }
  features: {
    groupLabel: string
    legends: Record<"interactions" | "data" | "layout", string>
    labels: Record<keyof FeatureState, string>
    hints: Record<
      "filtering" | "pagination" | "rowNumbers" | "selection" | "statusBar" | "detailPanel",
      string
    >
  }
  /**
   * The bulk-action bar the playground renders into `renderSelectionActions`.
   *
   * Three of these take a count, so they are functions rather than strings
   * with a number glued on: Russian agrees a counted noun with the numeral,
   * and `count` can be undefined outright while the fake server has not
   * answered — a state a template could only render as "undefined rows".
   * `raw` is the number behind the pre-formatted `count`, for that agreement.
   */
  bulk: {
    selected: (count: string | undefined, raw: number | undefined) => string
    flag: string
    unflag: string
    cancel: string
    working: string
    done: (count: string, raw: number) => string
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
    /**
     * The table-height field.
     *
     * Not in `sizes`: those keys are theme tokens the playground owns, and the
     * height is the LIBRARY's own layout slice — the same value the grip on
     * the table's bottom edge writes.
     */
    tableHeight: string
    reset: string
  }
  /** The control that arms the injected failure, so the error banner is reachable. */
  failNext: string
  resetAll: string
}

/**
 * Picks the Russian form a numeral governs — the playground's own copy of the
 * rule `labels/ru.ts` applies to the library's strings.
 *
 * Copied rather than imported: `src/labels/` is published surface and this
 * file is demo furniture that is deliberately kept out of the bundle, so a
 * shared export would have to live in one of the two and drag the other's
 * concerns with it. Six lines is the cheaper seam.
 *
 * @param count - The number governing the noun.
 * @param one - Form for 1, 21, 31 …
 * @param few - Form for 2-4, 22-24 …
 * @param many - Form for 0, 5-20, 25-30 …
 * @returns The form `count` governs.
 */
function ruPlural(count: number, one: string, few: string, many: string): string {
  const lastTwo = Math.abs(count) % 100
  if (lastTwo >= 11 && lastTwo <= 14) return many
  const last = lastTwo % 10
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

const en: ChromeStrings = {
  header: {
    tagline:
      "A headless-first React data table: nested column groups, server-side paging and a " +
      "token-driven theme.",
    nav: "Project links",
    links: { github: "GitHub", npm: "npm" },
  },
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
      rowNumbers: "Row numbers",
      selection: "Row selection",
      statusBar: "Status bar",
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
      rowNumbers: "Off by default, and group rows are numbered too",
      selection: "Off by default. The header box takes every matching row, not the fifty on screen",
      statusBar: "Off by default; the row count then moves here from the footer",
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
    tableHeight: "Table height",
    reset: "Reset theme",
  },
  bulk: {
    // English agrees a noun with the numeral too, in the one place it is easy
    // to forget: "1 rows selected" is the sort of thing a demo ships with.
    selected: (count, raw) =>
      count === undefined
        ? "All matching rows selected"
        : `${count} ${raw === 1 ? "row" : "rows"} selected`,
    flag: "Flag these",
    unflag: "Unflag these",
    cancel: "Cancel",
    working: "Working\u2026",
    done: (count, raw) => `${count} ${raw === 1 ? "receipt" : "receipts"} updated`,
  },
  failNext: "Fail the next request",
  resetAll: "Reset everything",
}

const ru: ChromeStrings = {
  header: {
    tagline:
      "React-\u0442\u0430\u0431\u043b\u0438\u0446\u0430 \u0441 headless-\u044f\u0434\u0440\u043e\u043c: \u0432\u043b\u043e\u0436\u0435\u043d\u043d\u044b\u0435 \u0433\u0440\u0443\u043f\u043f\u044b \u0441\u0442\u043e\u043b\u0431\u0446\u043e\u0432, \u0441\u0435\u0440\u0432\u0435\u0440\u043d\u0430\u044f \u0440\u0430\u0437\u0431\u0438\u0432\u043a\u0430 \u043d\u0430 " +
      "\u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b \u0438 \u0442\u0435\u043c\u0430 \u043d\u0430 \u0442\u043e\u043a\u0435\u043d\u0430\u0445.",
    nav: "\u0421\u0441\u044b\u043b\u043a\u0438 \u043f\u0440\u043e\u0435\u043a\u0442\u0430",
    links: { github: "GitHub", npm: "npm" },
  },
  lede:
    "Интерактивная песочница: каждый переключатель и каждый цвет ниже меняет настоящий проп " +
    "или опцию — всё по-настоящему. Таблица справа всегда обращается к фиктивному серверу " +
    "на 100 000 строк.",
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
      rowNumbers: "Номера строк",
      selection: "Выбор строк",
      statusBar: "Строка статуса",
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
      filtering: "Быстрый поиск включается вместе с фильтрацией",
      pagination:
        "Серверному режиму нужна разбивка на страницы — без неё видна одна страница из 50 строк, " +
        "а до остальных не добраться",
      rowNumbers: "По умолчанию выключены; строки групп тоже нумеруются",
      selection:
        "По умолчанию выключен. Флажок в шапке берёт все подходящие строки, а не 50 на экране",
      statusBar: "По умолчанию выключена; счётчик строк переходит сюда из нижней панели",
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
    tableHeight: "Высота таблицы",
    reset: "Сбросить тему",
  },
  bulk: {
    selected: (count, raw) =>
      count === undefined
        ? "Выбраны все подходящие строки"
        : `Выбрано ${count} ${ruPlural(raw ?? 0, "строка", "строки", "строк")}`,
    flag: "Отметить",
    unflag: "Снять отметку",
    cancel: "Отменить",
    working: "Выполняется\u2026",
    done: (count, raw) =>
      `Обновлено ${count} ${ruPlural(raw, "квитанция", "квитанции", "квитанций")}`,
  },
  failNext: "Сымитировать ошибку в следующем запросе",
  resetAll: "Сбросить всё",
}

const uz: ChromeStrings = {
  header: {
    tagline:
      "Headless asosidagi React jadvali: ichma-ich ustun guruhlari, serverli sahifalash va tokenlarga asoslangan mavzu.",
    nav: "Loyiha havolalari",
    links: { github: "GitHub", npm: "npm" },
  },
  lede:
    "Interaktiv sinov maydoni: quyidagi har bir kalit va har bir rang haqiqiy prop yoki opsiyani " +
    "boshqaradi, hech biri koʻrinish uchun emas. Oʻngdagi jadval doimo 100 000 qatorli soxta " +
    "serverga murojaat qiladi.",
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
      rowNumbers: "Qator raqamlari",
      selection: "Qatorlarni tanlash",
      statusBar: "Holat paneli",
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
      filtering: "Tezkor qidiruv filtrlash bilan birga yoqiladi",
      pagination:
        "Server rejimiga sahifalash kerak — oʻchirilganda 50 qatorlik bitta sahifa koʻrinadi, " +
        "qolgan qatorlarga yoʻl boʻlmaydi",
      rowNumbers: "Sukut boʻyicha oʻchiq; guruh qatorlari ham raqamlanadi",
      selection:
        "Sukut boʻyicha oʻchiq. Sarlavhadagi katakcha ekrandagi 50 tasini emas, mos keluvchi barcha qatorlarni oladi",
      statusBar: "Sukut boʻyicha oʻchiq; qatorlar soni bu yerga pastki paneldan koʻchadi",
      detailPanel: "Batafsil koʻrish uchun qatorni yoying",
    },
  },
  theme: {
    groupLabel: "Mavzu tokenlari",
    legends: { appearance: "Koʻrinish", colors: "Ranglar", sizing: "Oʻlchamlar" },
    appearance: "Asosiy mavzu",
    fontFamily: "Shrift",
    modes: { light: "Yorugʻ", dark: "Qorongʻi", system: "Tizim" },
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
      rowStripe: "Navbatma-navbat qator",
      detailBackground: "Tafsilotlar foni",
    },
    sizes: {
      headerHeight: "Sarlavha balandligi",
      rowHeight: "Qator balandligi",
      radius: "Burchak radiusi",
      fontSize: "Shrift oʻlchami",
    },
    tableHeight: "Jadval balandligi",
    reset: "Mavzuni tiklash",
  },
  bulk: {
    selected: (count) =>
      count === undefined
        ? "Mos keluvchi barcha qatorlar tanlandi"
        : `${count} ta qator tanlandi`,
    flag: "Belgilash",
    unflag: "Belgini olish",
    cancel: "Bekor qilish",
    working: "Bajarilmoqda\u2026",
    done: (count) => `${count} ta kvitansiya yangilandi`,
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
