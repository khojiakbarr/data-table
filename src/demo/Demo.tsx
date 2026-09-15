import { createColumnHelper } from "@tanstack/react-table"
import { useMemo } from "react"
import { DataTable } from "../components/DataTable"
import { localStorageLayout } from "../core/persistence"
import { useDataTable, type DataTableFeatures } from "../useDataTable"
import { ServerDemo } from "./ServerDemo"

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

/** Same shape as `receipts`, cycled out to 100 000 rows for the virtualization demo. */
const hugeReceipts: Receipt[] = Array.from({ length: 100_000 }, (_, index) => ({
  ...receipts[index % receipts.length]!,
  code: `KR-${100_000 + index}`,
}))

const money = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2 })
const qty = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 3 })

const storage = localStorageLayout()

/** The accordion's rows; a stable array, so expanding one is not undone by a re-render. */
const detailProducts = products.slice(0, 8)

interface TreeNode {
  name: string
  kind: string
  qty: number
  children?: TreeNode[]
}

const tree: TreeNode[] = [
  {
    name: "Sement M400 — 1 tonna",
    kind: "Tayyor mahsulot",
    qty: 1,
    children: [
      {
        name: "Klinker",
        kind: "Yarim tayyor",
        qty: 0.8,
        children: [
          { name: "Ohaktosh", kind: "Xomashyo", qty: 1.2 },
          { name: "Gil", kind: "Xomashyo", qty: 0.3 },
        ],
      },
      { name: "Gips", kind: "Xomashyo", qty: 0.05 },
      {
        name: "Qadoqlash",
        kind: "Jarayon",
        qty: 1,
        children: [{ name: "Qop 50kg", kind: "Materiallar", qty: 20 }],
      },
    ],
  },
  {
    name: "Beton B25 — 1 m³",
    kind: "Tayyor mahsulot",
    qty: 1,
    children: [
      { name: "Sement M400", kind: "Yarim tayyor", qty: 0.32 },
      { name: "Qum yuvilgan", kind: "Xomashyo", qty: 0.6 },
      { name: "Shagʻal 5-20", kind: "Xomashyo", qty: 0.8 },
    ],
  },
]

const receiptCols = createColumnHelper<DataTableFeatures, Receipt>()
const productCols = createColumnHelper<DataTableFeatures, Product>()
const treeCols = createColumnHelper<DataTableFeatures, TreeNode>()

const treeColumns = [
  treeCols.accessor("name", { header: "Nomi", size: 320 }),
  treeCols.accessor("kind", { header: "Turi", size: 180 }),
  treeCols.accessor("qty", {
    header: "Miqdor",
    size: 120,
    cell: (info) => <span className="num">{info.getValue()}</span>,
  }),
]

interface Movement {
  date: string
  document: string
  change: number
}

const movementCols = createColumnHelper<DataTableFeatures, Movement>()
const movementColumns = [
  movementCols.accessor("date", { header: "Sana", size: 120 }),
  movementCols.accessor("document", { header: "Hujjat", size: 160 }),
  movementCols.accessor("change", {
    header: "Oʻzgarish",
    size: 120,
    cell: (info) => <span className="num">{info.getValue()}</span>,
  }),
]

/**
 * A detail panel that mounts its own table.
 *
 * Each expanded row renders this component, so each gets an independent table
 * with its own id — which is what keeps their layouts apart.
 */
function ProductDetail({ product }: { product: Product }) {
  const movements = useMemo<Movement[]>(
    () =>
      Array.from({ length: 4 }, (_, index) => ({
        date: `2026-0${index + 1}-1${index}`,
        document: `KR-10${index}${product.sku.slice(-1)}`,
        change: index % 2 === 0 ? 40 + index * 7 : -(12 + index * 3),
      })),
    [product.sku],
  )

  const table = useDataTable({
    id: `demo-movements-${product.sku}`,
    data: movements,
    columns: movementColumns,
  })

  return (
    <div>
      <b>
        {product.sku} · {product.name}
      </b>
      <p className="hint" style={{ margin: "4px 0 10px" }}>
        Har bir qatorning oʻz paneli. Ichida yana jadval — ichma-ich akkordeon.
      </p>
      <DataTable instance={table} toolbar={false} stickyHeader={false} />
    </div>
  )
}

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
    storage,
    initialLayout: { columnPinning: { start: ["code"], end: ["status"] } },
  })

  const hugeTable = useDataTable({ id: "demo-huge", data: hugeReceipts, columns: receiptColumns, storage })

  const productTable2 = useDataTable({
    id: "demo-detail",
    data: detailProducts,
    columns: productColumns,
    storage,
  })

  const treeTable = useDataTable({
    id: "demo-tree",
    data: tree,
    columns: treeColumns,
    storage,
    getSubRows: (row) => row.children,
  })

  const productTable = useDataTable({
    id: "demo-products",
    data: products,
    columns: productColumns,
    storage,
  })

  return (
    <main>
      <h1>@khojiakbarr/data-table</h1>
      <p className="lede">
        Drag a header to reorder. Drag its right edge to resize, double-click the edge to
        fit the column to its content. Click a header to sort, click again to reverse. Use{" "}
        <b>Columns</b> to pin or hide. Both tables remember their own layout — rearrange one,
        reload, and the other is exactly as you left it.
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
      <p className="hint">Independent layout, stored under its own key.</p>

      <h2>Server-side — 10 000 qator, 300 ms kechikish</h2>
      <ServerDemo />
      <p className="hint">Sort yoki sahifa o'zgarganda so'rov ketadi; javob kelguncha eski qatorlar xira turadi.</p>

      <h2>100 000 qator — client mode, virtualizatsiya</h2>
      <DataTable instance={hugeTable} height={400} striped />
      <p className="hint">DOM'da faqat ko'ringan qatorlar; scroll bar aniq.</p>

      <h2>Akkordeon — detail panel, nested inside</h2>
      <DataTable
        instance={productTable2}
        height={320}
        renderDetail={(row) => <ProductDetail product={row} />}
      />
      <p className="hint">
        The panel holds anything — here a second table, itself expandable.
      </p>

      <h2>Daraxt qatorlari — nested sub-rows</h2>
      <DataTable instance={treeTable} height={320} />
      <p className="hint">
        `getSubRows` makes rows expandable to any depth; children indent by level.
      </p>
    </main>
  )
}
