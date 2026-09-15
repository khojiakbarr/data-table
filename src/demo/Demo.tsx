import { createColumnHelper } from "@tanstack/react-table"
import { useMemo } from "react"
import { DataTable } from "../components/DataTable"
import { localStorageLayout } from "../core/persistence"
import { useDataTable, type DataTableFeatures } from "../useDataTable"

/**
 * Development playground.
 *
 * Two tables on one page, on purpose: the one thing this library must get right
 * is that rearranging either leaves the other untouched, including after a
 * reload.
 */

interface Receipt {
  code: string
  partner: string
  warehouse: string
  quantity: number
  amount: number
  currency: string
  status: string
  date: string
}

interface Product {
  sku: string
  name: string
  group: string
  uom: string
  stock: number
  cost: number
}

const PARTNERS = [
  "Oʻzbekiston Temir Yoʻllari",
  "Gʻallaorol Agro MChJ",
  "ООО «Северный Путь»",
  "Toshkent Kimyo Zavodi",
  "Andijon Mashinasozlik",
  "ЗАО «Волга-Трейд»",
]

const receipts: Receipt[] = Array.from({ length: 60 }, (_, index) => ({
  code: `KR-${1000 + index}`,
  partner: PARTNERS[index % PARTNERS.length] as string,
  warehouse: index % 3 === 0 ? "Markaziy ombor" : "Chilonzor filiali",
  quantity: Number(((index * 37) % 1500) + 12.5),
  amount: Number(((index * 918_233) % 210_000_000) + 310_000),
  currency: "UZS",
  status: ["open", "in_process", "received", "closed"][index % 4] as string,
  date: `2026-0${(index % 9) + 1}-1${index % 9}`,
}))

const products: Product[] = Array.from({ length: 25 }, (_, index) => ({
  sku: `SKU-${4200 + index}`,
  name: ["Sement M400", "Armatura 12mm", "Gʻisht qizil", "Qum yuvilgan", "Shagʻal 5-20"][
    index % 5
  ] as string,
  group: index % 2 === 0 ? "Qurilish materiallari" : "Xomashyo",
  uom: index % 3 === 0 ? "tonna" : "dona",
  stock: ((index * 53) % 900) + 4,
  cost: ((index * 12_345) % 900_000) + 15_000,
}))

const money = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2 })
const qty = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 3 })

const receiptCols = createColumnHelper<DataTableFeatures, Receipt>()
const productCols = createColumnHelper<DataTableFeatures, Product>()

export function Demo() {
  const receiptColumns = useMemo(
    () => [
      receiptCols.accessor("code", { header: "Kod", size: 110 }),
      receiptCols.group({
        id: "document",
        header: "Hujjat",
        columns: receiptCols.columns([
          receiptCols.accessor("partner", { header: "Kontragent", size: 240 }),
          receiptCols.accessor("warehouse", { header: "Ombor", size: 170 }),
          receiptCols.accessor("date", { header: "Sana", size: 120 }),
        ]),
      }),
      receiptCols.group({
        id: "amounts",
        header: "Summalar",
        columns: receiptCols.columns([
          receiptCols.accessor("quantity", {
            header: "Miqdor",
            size: 130,
            cell: (info) => <span className="num">{qty.format(info.getValue())}</span>,
          }),
          receiptCols.group({
            id: "money",
            header: "Pul",
            columns: receiptCols.columns([
              receiptCols.accessor("amount", {
                header: "Summa",
                size: 170,
                cell: (info) => <span className="num">{money.format(info.getValue())}</span>,
              }),
              receiptCols.accessor("currency", { header: "Valyuta", size: 90 }),
            ]),
          }),
        ]),
      }),
      receiptCols.accessor("status", { header: "Holat", size: 130 }),
    ],
    [],
  )

  const productColumns = useMemo(
    () => [
      productCols.accessor("sku", { header: "SKU", size: 120 }),
      productCols.accessor("name", { header: "Nomi", size: 200 }),
      productCols.accessor("group", { header: "Guruh", size: 200 }),
      productCols.accessor("uom", { header: "Oʻlchov", size: 100 }),
      productCols.accessor("stock", {
        header: "Qoldiq",
        size: 120,
        cell: (info) => <span className="num">{info.getValue()}</span>,
      }),
      productCols.accessor("cost", {
        header: "Tannarx",
        size: 150,
        cell: (info) => <span className="num">{money.format(info.getValue())}</span>,
      }),
    ],
    [],
  )

  const receiptTable = useDataTable({
    id: "demo-receipts",
    data: receipts,
    columns: receiptColumns,
    storage: localStorageLayout(),
    initialLayout: { columnPinning: { start: ["code"], end: ["status"] } },
  })

  const productTable = useDataTable({
    id: "demo-products",
    data: products,
    columns: productColumns,
    storage: localStorageLayout(),
  })

  return (
    <main>
      <h1>@khojiakbarr/data-table</h1>
      <p className="lede">
        Drag a header to reorder. Drag its right edge to resize, double-click the edge to
        reset. Click a header to sort, click again to reverse. Use <b>Columns</b> to pin or
        hide. Both tables remember their own layout — rearrange one, reload, and the other
        is exactly as you left it.
      </p>

      <h2>Kirim hujjatlari — pinned start + end, 60 rows</h2>
      <DataTable
        instance={receiptTable}
        striped
        height={360}
        onRowClick={(row) => console.info("row", row.code)}
      />
      <p className="hint">
        <code>code</code> is pinned to the start and <code>status</code> to the end. Resize
        a middle column and watch the pinned edges hold their position.
      </p>

      <h2>Tovarlar — second instance, same page</h2>
      <DataTable instance={productTable} height={280} />
      <p className="hint">
        Independent layout, stored under its own key.
      </p>
    </main>
  )
}
