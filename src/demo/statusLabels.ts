import type { Language } from "./playgroundState"

/**
 * The four status codes' text, in each language the playground speaks.
 *
 * Shared between {@link buildReceiptColumns} — the Status column's cell and
 * its `meta.groupLabel` — and {@link fetchValues}'s list filter, so the raw
 * server enum (`open`, `in_process`, `received`, `closed`) reads the same
 * translated word everywhere the demo shows it, from one source rather than
 * three copies drifting apart.
 */
export const STATUS_LABELS: Record<Language, Record<string, string>> = {
  en: { open: "Open", in_process: "In process", received: "Received", closed: "Closed" },
  ru: { open: "Открыт", in_process: "В процессе", received: "Получен", closed: "Закрыт" },
  uz: { open: "Ochiq", in_process: "Jarayonda", received: "Qabul qilingan", closed: "Yopilgan" },
}
