/**
 * The manual's screenshot list. Each entry:
 *   id        file name (chapter-number prefix), referenced from the chapter sources
 *   persona   admin | sales | shipping | accountant | agent | null (signed out)
 *   path      page to open;  before(page) optional interaction
 *   clip      CSS selector or (page) => locator for the captured region (default: viewport)
 *   callouts  [n, (page) => locator, side?] numbered boxes explained in the text
 *   sidebar   true keeps the sidebar expanded (default: collapsed icon rail)
 * IDs of demo records are resolved from the demo database by name/number.
 */
import { one } from "./lib/api.mjs";

const id = {
  order: (n) => one(`select id from store_orders where internal_order_id = 'STO-2026-${String(n).padStart(6, "0")}'`).id,
  partner: (name) => one(`select id from partners where name = '${name}'`).id,
  lead: (no) => one(`select id from leads where lead_number = '${no}'`).id,
  product: (name) => one(`select id from products where name = '${name}'`).id,
  doc: (table, col, no) => one(`select id from ${table} where ${col} = '${no}'`).id,
  agent: () => one(`select id from agents limit 1`).id,
};

const wrap = (f) => Object.assign(f, { first: () => wrap((p) => f(p).first()), last: () => wrap((p) => f(p).last()), nth: (i) => wrap((p) => f(p).nth(i)) });
const btn = (name, exact = false) => wrap((p) => p.getByRole("button", { name, exact }));
const txt = (t, exact = false) => wrap((p) => p.getByText(t, { exact }));
const lbl = (t) => wrap((p) => p.getByLabel(t));
const inDialog = (fn) => (p) => fn(p.getByRole("dialog").last());
const main = (p) => p.locator("main").first();
const tab = (name) => wrap((p) => p.getByRole("tab", { name }));
const col = (name) => wrap((p) => p.getByRole("columnheader", { name }));
const row = (re) => (p) => p.getByRole("row", { name: re });

async function openNewOrder(p, { settle }) {
  await p.getByRole("button", { name: "طلب جديد" }).first().click();
  await settle(p, 500);
}
async function fillCustomer(p, name, digits) {
  const dlg = p.getByRole("dialog");
  await dlg.locator("input[name=customerName]").fill(name);
  await dlg.getByRole("combobox").first().click();
  await p.keyboard.type("مصر");
  await p.waitForTimeout(500);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(300);
  await dlg.getByPlaceholder(/\d/).first().fill(digits);
  await p.keyboard.press("Tab");
  await p.waitForTimeout(2800);
}
async function expand(p, names) {
  for (const n of names) {
    const b = p.getByRole("button", { name: new RegExp(n) }).first();
    if (await b.count()) {
      const exp = await b.getAttribute("aria-expanded");
      if (exp !== "true") await b.click();
      await p.waitForTimeout(300);
    }
  }
}
const scrollTo = async (p, loc) => {
  await loc.first().evaluate((el) => el.scrollIntoView({ block: "start" }));
  await p.waitForTimeout(300);
};

export const SHOTS = [
  // ───────────── 2. Getting started ─────────────
  {
    id: "02-01-login",
    persona: null,
    path: "/login",
    before: async (p) => {
      await p.fill('input[name="email"]', "sales@oms-demo.local");
      await p.fill('input[name="password"]', "xxxxxxxxxx");
    },
    clip: (p) => p.locator("form").first().locator("xpath=ancestor::*[.//h1 or .//h2][1]"),
    clipPad: 24,
    callouts: [
      [1, (p) => p.locator('input[name="email"]')],
      [2, (p) => p.locator('input[name="password"]')],
      [3, txt("تنتهي الجلسة عند إغلاق المتصفح")],
      [4, txt("هل نسيت كلمة المرور؟")],
      [5, (p) => p.locator('button[type="submit"]')],
    ],
  },
  {
    id: "02-02-home",
    persona: "admin",
    path: "/",
    sidebar: true,
    callouts: [
      [1, (p) => p.locator("[data-slot=sidebar]")],
      [2, btn("الشركة النشطة")],
      [3, btn(/بحث…/), "below"],
      [4, btn("تغيير اللغة"), "below"],
      [5, btn("تغيير المظهر"), "below"],
      [6, btn("الإشعارات"), "below"],
      [7, btn("فتح قائمة الملف الشخصي"), "below"],
      [8, (p) => p.getByRole("link", { name: /لوحة التحكم/ }).last()],
      [9, txt("إجراءات سريعة", true)],
    ],
  },
  {
    id: "02-03-module",
    persona: "admin",
    path: "/modules/sales",
    clip: main,
    clipPad: 0,
    callouts: [[1, (p) => p.locator("main h1").first()], [2, (p) => p.locator("main").getByRole("link", { name: /طلبات المتجر/ })]],
  },
  {
    id: "02-04-profile-menu",
    persona: "admin",
    path: "/",
    before: async (p) => {
      await p.getByRole("button", { name: "فتح قائمة الملف الشخصي" }).click();
      await p.waitForTimeout(500);
    },
    clipRect: { x: 0, y: 0, width: 520, height: 300 },
    callouts: [[1, (p) => p.getByRole("menuitem", { name: /الملف الشخصي/ })], [2, (p) => p.getByRole("menuitem", { name: /تسجيل الخروج/ })]],
    after: async (p) => p.keyboard.press("Escape"),
  },
  { id: "02-05-mobile-home", persona: "sales", mobile: true, path: "/", callouts: [[1, btn("فتح التنقل")]] },

  // ───────────── 3. Sales ─────────────
  {
    id: "03-01-leads",
    persona: "sales",
    path: "/crm/leads",
    clip: main,
    clipPad: 0,
    callouts: [
      [1, (p) => p.locator("main").getByRole("button", { name: /جديد/ })],
      [2, (p) => p.locator("main").getByRole("searchbox")],
      [3, col(/رقم الليد|رقم العميل المحتمل/)],
    ],
  },
  {
    id: "03-02-lead-detail",
    persona: "sales",
    path: () => `/crm/leads/${id.lead("LD-2026-000002")}`,
    clip: main,
    clipPad: 0,
    callouts: [[1, btn("تحويل إلى طلب")], [2, btn("إضافة متابعة")], [3, tab("المتابعات")]],
  },
  {
    id: "03-03-order-customer",
    persona: "sales",
    path: "/store-orders",
    height: 900,
    before: async (p, ctx) => {
      await openNewOrder(p, ctx);
      await fillCustomer(p, "هشام جلال", "1000000131");
    },
    clip: "[role=dialog]",
    callouts: [
      [1, inDialog((d) => d.getByRole("radio", { name: "عميل جديد" }))],
      [2, inDialog((d) => d.locator("input[name=customerName]"))],
      [3, inDialog((d) => d.getByRole("combobox").first())],
      [4, inDialog((d) => d.getByPlaceholder(/\d/).first())],
      [5, inDialog((d) => d.getByRole("button", { name: "التالي" }))],
    ],
  },
  {
    id: "03-04-order-items",
    persona: "sales",
    path: null,
    before: async (p) => {
      const d = p.getByRole("dialog");
      await d.getByRole("button", { name: "التالي" }).click();
      await p.waitForTimeout(800);
      await d.getByRole("combobox").first().click();
      await p.keyboard.type("حامل");
      await p.waitForTimeout(1200);
      await p.getByRole("option").first().click();
      await p.waitForTimeout(600);
      const price = d.getByLabel("سعر الوحدة المتفق عليه").first();
      await price.fill("120");
      await p.keyboard.press("Tab");
      await p.waitForTimeout(400);
    },
    clip: "[role=dialog]",
    callouts: [
      [1, inDialog((d) => d.getByRole("combobox").first())],
      [2, inDialog((d) => d.getByLabel("سعر الوحدة المتفق عليه").first())],
      [3, inDialog((d) => d.getByRole("button", { name: "إضافة سطر" }))],
      [4, inDialog((d) => d.getByRole("button", { name: "استعراض المنتجات" }))],
    ],
  },
  {
    id: "03-05-order-delivery",
    persona: "sales",
    path: null,
    before: async (p) => {
      const d = p.getByRole("dialog");
      await d.getByRole("button", { name: "التالي" }).click();
      await p.waitForTimeout(900);
    },
    clip: "[role=dialog]",
    callouts: [
      [1, inDialog((d) => d.getByRole("combobox").nth(0))],
      [2, inDialog((d) => d.getByText("دولة توصيل مختلفة"))],
      [3, inDialog((d) => d.getByRole("combobox").nth(1))],
      [4, inDialog((d) => d.getByRole("combobox").nth(2))],
      [5, inDialog((d) => d.getByRole("radio", { name: "لم يدفع بعد" }).locator("xpath=.."))],
    ],
  },
  {
    id: "03-06-order-review",
    persona: "sales",
    path: null,
    before: async (p) => {
      const d = p.getByRole("dialog");
      await d.getByRole("button", { name: "التالي" }).click();
      await p.waitForTimeout(900);
    },
    clip: "[role=dialog]",
    callouts: [[1, inDialog((d) => d.getByRole("button", { name: /إنشاء|حفظ|تأكيد/ }).last())]],
    after: async (p) => {
      await p.keyboard.press("Escape");
      await p.waitForTimeout(400);
      const discard = p.getByRole("button", { name: /تجاهل|إغلاق دون حفظ|نعم/ });
      if (await discard.count()) await discard.first().click();
    },
  },
  {
    id: "03-07-duplicate",
    persona: "sales",
    path: "/store-orders",
    before: async (p, ctx) => {
      await openNewOrder(p, ctx);
      await fillCustomer(p, "ليلى حسن", "1000000101");
    },
    clip: "[role=dialog]",
    callouts: [
      [1, inDialog((d) => d.getByText("هذا العميل موجود بالفعل"))],
      [2, inDialog((d) => d.getByText(/عميل متكرر/))],
      [3, inDialog((d) => d.getByText(/طلب سابق يمكنك فتحه/))],
      [4, inDialog((d) => d.getByRole("button", { name: "إنشاء طلب جديد لنفس العميل" }))],
      [5, inDialog((d) => d.getByRole("button", { name: "إلغاء وعدم التكرار" }))],
      [6, inDialog((d) => d.getByRole("link", { name: /فتح الطلب الحالي/ }))],
    ],
    after: async (p) => {
      await p.keyboard.press("Escape");
      await p.waitForTimeout(300);
    },
  },
  {
    id: "03-08-lookup",
    persona: "sales",
    path: "/store-orders",
    height: 1000,
    before: async (p) => {
      await p.getByRole("button", { name: /بحث متقدم عن عميل/ }).click();
      await p.waitForTimeout(500);
      const d = p.getByRole("dialog");
      await d.getByRole("searchbox").fill("01000000101");
      await d.getByRole("button", { name: "بحث", exact: true }).click();
      await p.waitForTimeout(2000);
    },
    clip: "[role=dialog]",
    callouts: [
      [1, inDialog((d) => d.getByRole("searchbox"))],
      [2, inDialog((d) => d.getByRole("button", { name: "بحث", exact: true }))],
      [3, inDialog((d) => d.getByText(/تم العثور على/))],
      [4, inDialog((d) => d.getByText(/عميل متكرر/).first())],
      [5, inDialog((d) => d.getByText("مسند إليك").first())],
      [6, inDialog((d) => d.getByText("فتح", { exact: true }).first())],
    ],
    after: async (p) => p.keyboard.press("Escape"),
  },
  {
    id: "03-09-order-detail",
    persona: "sales",
    path: () => `/store-orders/${id.order(6)}`,
    clip: main,
    clipPad: 0,
    callouts: [
      [1, txt("STO-2026-000006").last()],
      [2, txt(/^الدفع:/)],
      [3, txt(/^التنفيذ:/)],
      [4, txt(/عميل متكرر/)],
      [5, btn("المزيد")],
      [6, btn(/سجل الشحن/)],
    ],
  },
  {
    id: "03-10-customer",
    persona: "sales",
    path: () => `/sales/customers/${id.partner("ليلى حسن")}`,
    clip: main,
    clipPad: 0,
    callouts: [
      [1, txt(/عميل متكرر/)],
      [2, txt("المشتريات المكتملة", true)],
      [3, tab("الطلبات")],
      [4, tab("السجل الزمني")],
    ],
  },
  {
    id: "03-11-customer-orders",
    persona: "sales",
    path: () => `/sales/customers/${id.partner("ليلى حسن")}`,
    before: async (p) => {
      await p.getByRole("tab", { name: "الطلبات" }).click();
      await p.waitForTimeout(1200);
    },
    clip: main,
    clipPad: 0,
    callouts: [[1, col(/رقم الطلب/)], [2, col(/التنفيذ/)], [3, col(/الدفع/)]],
  },
  {
    id: "03-12-customer-timeline",
    persona: "admin",
    path: () => `/sales/customers/${id.partner("ليلى حسن")}`,
    before: async (p) => {
      await p.getByRole("tab", { name: "السجل الزمني" }).click();
      await p.waitForTimeout(1200);
    },
    clip: main,
    clipPad: 0,
    callouts: [[1, txt("الرصيد المستحق", true)], [2, (p) => p.locator("main").getByText("طلب جديد", { exact: true })]],
  },

  // ───────────── 4. Shipping ─────────────
  {
    id: "04-01-shipping-list",
    persona: "shipping",
    path: "/shipping",
    clip: main,
    clipPad: 0,
    callouts: [
      [1, (p) => p.locator("main").getByRole("searchbox")],
      [2, (p) => p.locator("main").getByRole("combobox").first()],
      [3, col(/شركة الشحن/)],
      [4, col(/رقم التتبع/)],
      [5, col("الحالة")],
      [6, (p) => p.locator("main").getByRole("checkbox").first()],
    ],
  },
  {
    id: "04-02-ship-dialog",
    persona: "shipping",
    path: () => `/store-orders/${id.order(2)}`,
    before: async (p) => {
      await p.getByRole("button", { name: "تحديث الشحنة" }).click();
      await p.waitForTimeout(800);
    },
    clip: "[role=dialog]",
    callouts: [
      [1, inDialog((d) => d.getByRole("combobox").nth(0))],
      [2, inDialog((d) => d.getByRole("combobox").nth(1))],
      [3, inDialog((d) => d.getByPlaceholder("أدخل رقم التتبع…"))],
      [4, inDialog((d) => d.getByText("تكلفة الشحن", { exact: true }))],
      [5, inDialog((d) => d.getByRole("button", { name: "حفظ" }))],
    ],
    after: async (p) => p.keyboard.press("Escape"),
  },
  {
    id: "04-03-shipping-record",
    persona: "shipping",
    path: () => `/store-orders/${id.order(1)}`,
    height: 1100,
    before: async (p) => {
      await expand(p, ["سجل الشحن"]);
      await scrollTo(p, p.getByRole("button", { name: /سجل الشحن/ }));
    },
    clip: main,
    clipPad: 0,
    callouts: [[1, btn(/سجل الشحن/)], [2, col(/شركة الشحن/)], [3, col(/رقم التتبع/)], [4, (p) => p.locator("main").getByRole("button", { name: /تعديل الشحن/ })]],
  },

  // ───────────── 5. Inventory & costing ─────────────
  {
    id: "05-01-order-recognized",
    persona: "admin",
    path: () => `/store-orders/${id.order(1)}`,
    height: 1100,
    before: async (p) => {
      await expand(p, ["الدفعات والسجل المالي"]);
      await scrollTo(p, p.getByText("السجلات المرتبطة"));
      await p.evaluate(() => document.querySelectorAll("main, main *").forEach((el) => { if (el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== "visible") el.scrollTop -= 80; }));
      await p.waitForTimeout(300);
    },
    clip: (p) => p.getByText("السجلات المرتبطة").locator("xpath=ancestor::div[contains(@class,'border')][1]"),
    clipPad: 10,
    trim: false,
    callouts: [
      [1, txt(/^فاتورة مبيعات/).first()],
      [2, txt(/^دفعة/).first()],
      [3, txt(/^سند قبض/).first()],
      [4, txt(/^قيد يومية/).first()],
      [5, txt(/^شحنة/).first()],
      [6, txt("حجز", true).first()],
      [7, txt("فك حجز", true).first()],
      [8, txt("تسليم", true).first()],
    ],
  },
  {
    id: "05-00-order-chips",
    persona: "admin",
    path: () => `/store-orders/${id.order(1)}`,
    clipRect: { x: 0, y: 48, width: 1150, height: 110 },
    callouts: [[1, txt(/^الدفع:/)], [2, txt(/^التنفيذ:/)], [3, txt(/^إثبات البيع:/)]],
  },
  {
    id: "05-02-order-reserved",
    persona: "admin",
    path: () => `/store-orders/${id.order(2)}`,
    clipRect: { x: 0, y: 48, width: 1150, height: 380 },
    callouts: [[1, txt(/^إثبات البيع:/)], [2, txt(/^التنفيذ:/)]],
  },
  {
    id: "05-03-order-failed",
    persona: "admin",
    path: () => `/store-orders/${id.order(3)}`,
    clipRect: { x: 0, y: 48, width: 1150, height: 600 },
    callouts: [
      [1, txt(/^إثبات البيع:/)],
      [2, txt("تم حفظ التسليم، لكن تعذّر إثبات البيع")],
      [3, (p) => p.locator("main li").first()],
      [4, btn("إعادة محاولة الإثبات").last()],
    ],
  },
  {
    id: "05-04-stock",
    persona: "admin",
    path: "/inventory/stock",
    clip: main,
    clipPad: 0,
    callouts: [[1, (p) => p.locator("main").getByRole("combobox").first()], [2, col(/المتاح/)], [3, (p) => p.getByRole("row", { name: /حامل هاتف معدني/ }).getByRole("cell").nth(3)], [4, col(/قيمة المخزون/)], [5, txt("قيمة مخزون الشركة")]],
  },
  {
    id: "05-05-movements",
    persona: "admin",
    path: "/inventory/movements",
    clip: main,
    clipPad: 0,
    callouts: [[1, col("النوع")], [2, col(/المرجع/)], [3, col(/الكمية/)]],
  },
  {
    id: "05-06-kit",
    persona: "admin",
    path: () => `/products/${id.product("طقم الشحن المكتبي")}`,
    before: async (p) => {
      const t = p.getByRole("tab", { name: /الوصفة|المكونات|التجميع/ });
      if (await t.count()) {
        await t.first().click();
        await p.waitForTimeout(1000);
      }
    },
    clip: main,
    clipPad: 0,
    callouts: [[1, tab(/الوصفة/)], [2, txt(/^مجموعة: تُباع/)], [3, txt("المكوّن", true)], [4, txt("تقدير التكلفة")], [5, txt(/المجموعات المتاحة/).first()]],
  },
  {
    id: "05-07-sales-return",
    persona: "accountant",
    path: () => `/sales/returns/${id.doc("sales_returns", "return_number", "SR-2026-000001")}`,
    clip: main,
    clipPad: 0,
    callouts: [[1, txt("SR-2026-000001").last()], [2, txt(/INV-2026-000002/).first()], [3, txt(/MV\/10\/2026/).first()], [4, txt(/JV-2026/).first()]],
  },
  {
    id: "05-08-integrity",
    persona: "admin",
    path: "/inventory/integrity",
    width: 1680,
    height: 1000,
    clip: main,
    clipPad: 0,
    callouts: [[1, btn(/إعادة الفحص/)], [2, txt("غير سليمة", true).first()], [3, txt("سليمة", true).first()]],
  },

  // ───────────── 6. Purchasing ─────────────
  {
    id: "06-01-po-list",
    persona: "admin",
    path: "/purchasing/purchase-orders",
    clip: main,
    clipPad: 0,
    callouts: [[1, (p) => p.locator("main").getByRole("button", { name: /جديد/ })], [2, col(/الحالة/)]],
  },
  {
    id: "06-02-po-detail",
    persona: "admin",
    path: () => `/purchasing/purchase-orders/${id.doc("purchase_orders", "po_number", "PO-2026-000002")}`,
    clip: main,
    clipPad: 0,
    callouts: [[1, txt("مسودة", true).first()], [2, btn(/اعتماد/)], [3, btn("المزيد")], [4, txt("بنود المنتجات")]],
  },
  {
    id: "06-03-pi-detail",
    persona: "admin",
    path: () => `/purchasing/purchase-invoices/${id.doc("purchase_invoices", "invoice_number", "PI-2026-000001")}`,
    clip: main,
    clipPad: 0,
    callouts: [[1, (p) => p.locator("main h1").first()], [2, txt(/المستودع/).first()]],
  },

  // ───────────── 7. Finance ─────────────
  {
    id: "07-01-payment-review",
    persona: "accountant",
    path: "/finance/payment-review",
    clip: main,
    clipPad: 0,
    callouts: [[1, col(/الدفعة/)], [2, col(/المبلغ/)], [3, col(/الحالة/)]],
  },
  {
    id: "07-02-receipts",
    persona: "accountant",
    path: "/sales/payments",
    clip: main,
    clipPad: 0,
    callouts: [[1, col(/رقم السند/)], [2, col(/الحالة/)]],
  },
  {
    id: "07-03-journal-entries",
    persona: "accountant",
    path: "/finance/journal-entries",
    clip: main,
    clipPad: 0,
    callouts: [[1, col(/رقم القيد/)], [2, col(/إجمالي المدين/)], [3, col(/إجمالي الدائن/)]],
  },
  {
    id: "07-04-expenses",
    persona: "accountant",
    path: "/finance/expenses",
    clip: main,
    clipPad: 0,
    callouts: [[1, (p) => p.locator("main").getByText("مصروف جديد").first()], [2, col(/الوصف/)], [3, col(/الحالة/)], [4, txt(/الإجمالي \(بدون المعكوس\)/)]],
  },
  {
    id: "07-05-expense-new",
    persona: "accountant",
    path: "/finance/expenses",
    height: 1000,
    before: async (p) => {
      await p.locator("main").getByText("مصروف جديد").first().click();
      await p.waitForTimeout(1200);
    },
    clip: main,
    clipPad: 0,
    callouts: [
      [1, (p) => p.locator("main").getByRole("combobox").nth(0)],
      [2, (p) => p.locator("main").getByRole("combobox").nth(1)],
      [3, (p) => p.locator("main").getByPlaceholder("0.00").first()],
      [4, (p) => p.locator("main").getByRole("combobox").nth(2)],
      [5, (p) => p.locator("main").getByRole("combobox").nth(3)],
      [6, btn(/تأكيد وترحيل/)],
    ],
    after: async (p) => p.keyboard.press("Escape"),
  },
  {
    id: "07-06-trial-balance",
    persona: "accountant",
    path: "/reports/finance",
    clip: main,
    clipPad: 0,
    callouts: [[1, col(/الرصيد الافتتاحي/)], [2, col(/^مدين/)], [3, col(/^دائن/)]],
  },
  {
    id: "07-07-fixed-assets",
    persona: "admin",
    path: "/finance/fixed-assets",
    clip: main,
    clipPad: 0,
    callouts: [[1, col(/التكلفة/)], [2, col(/الحالة/)]],
  },

  // ───────────── 8. HR & users ─────────────
  {
    id: "08-01-users",
    persona: "admin",
    path: "/settings/users",
    clip: main,
    clipPad: 0,
    callouts: [[1, btn("مستخدم جديد")], [2, col(/المسمى الوظيفي/)], [3, (p) => p.getByRole("row", { name: /يوسف كمال/ }).getByText(/مراجعة/)], [4, (p) => p.getByRole("row", { name: /يوسف كمال/ }).getByRole("button", { name: "إجراءات" })]],
  },
  {
    id: "08-02-user-menu",
    persona: "admin",
    path: "/settings/users",
    before: async (p) => {
      await p.getByRole("row", { name: /يوسف كمال/ }).getByRole("button", { name: "إجراءات" }).click();
      await p.waitForTimeout(500);
    },
    clipRect: { x: 0, y: 380, width: 700, height: 300 },
    callouts: [[1, (p) => p.getByRole("menuitem", { name: "تعديل" })], [2, (p) => p.getByRole("menuitem", { name: "إعادة تعيين كلمة المرور" })], [3, (p) => p.getByRole("menuitem", { name: "قفل" })]],
    after: async (p) => p.keyboard.press("Escape"),
  },
  {
    id: "08-03-reset-password",
    persona: "admin",
    path: "/settings/users",
    before: async (p) => {
      await p.getByRole("row", { name: /يوسف كمال/ }).getByRole("button", { name: "إجراءات" }).click();
      await p.getByRole("menuitem", { name: "إعادة تعيين كلمة المرور" }).click();
      await p.waitForTimeout(600);
    },
    clip: "[role=alertdialog], [role=dialog]",
    callouts: [
      [1, (p) => p.locator('[role=alertdialog] input, [role=dialog] input').first()],
      [2, btn("إنشاء كلمة مرور قوية"), "below"],
      [3, btn("إظهار كلمة المرور"), "below"],
      [4, btn("نسخ كلمة المرور"), "below"],
      [5, (p) => p.getByRole("button", { name: "إعادة تعيين كلمة المرور" }).last()],
    ],
    after: async (p) => p.keyboard.press("Escape"),
  },
  {
    id: "08-04-user-editor",
    persona: "admin",
    path: "/settings/users",
    height: 1200,
    before: async (p) => {
      await p.getByRole("row", { name: /يوسف كمال/ }).getByRole("button", { name: "إجراءات" }).click();
      await p.getByRole("menuitem", { name: "تعديل" }).click();
      await p.waitForTimeout(900);
    },
    clip: "[role=dialog]",
    callouts: [
      [1, inDialog((d) => d.getByRole("combobox").nth(0))],
      [2, inDialog((d) => d.getByText("تغيّر المسمى الوظيفي"))],
      [3, inDialog((d) => d.getByText(/يرث الصلاحيات الافتراضية/))],
      [4, inDialog((d) => d.getByRole("button", { name: "حفظ" }))],
    ],
  },
  {
    id: "08-05-permission-sources",
    persona: "admin",
    path: null,
    height: 1200,
    before: async (p) => {
      const d = p.getByRole("dialog");
      await d.getByRole("searchbox").fill("");
      await p.waitForTimeout(300);
      await d.getByRole("button", { name: "الشركاء", exact: true }).first().click();
      await p.waitForTimeout(500);
      await d.getByText("منع فردي").last().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await p.waitForTimeout(300);
    },
    clip: "[role=dialog]",
    callouts: [
      [1, inDialog((d) => d.getByText(/يرث الصلاحيات الافتراضية/))],
      [2, inDialog((d) => d.getByText("منع فردي").last())],
      [3, inDialog((d) => d.getByRole("radio", { name: "منع" }).last())],
    ],
  },
  {
    id: "08-05b-permission-grant",
    persona: "admin",
    path: null,
    height: 1200,
    before: async (p) => {
      const d = p.getByRole("dialog");
      await d.getByRole("button", { name: "تقارير المبيعات", exact: true }).first().click();
      await p.waitForTimeout(500);
      await d.getByText("منحة فردية").last().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await p.waitForTimeout(300);
    },
    clip: (p) => p.getByRole("dialog").getByText("منحة فردية").last().locator("xpath=ancestor::*[contains(@class,'border')][2]"),
    clipPad: 6,
    trim: false,
    callouts: [[1, inDialog((d) => d.getByText("منحة فردية").last())], [2, inDialog((d) => d.getByRole("radio", { name: "منح" }).last())]],
    after: async (p) => p.keyboard.press("Escape"),
  },
  {
    id: "08-06-job-title-menu",
    persona: "admin",
    path: "/master-data/job-titles",
    before: async (p) => {
      await p.getByRole("row", { name: /موظف مبيعات/ }).getByRole("button").last().click();
      await p.waitForTimeout(500);
    },
    clipRect: { x: 0, y: 150, width: 700, height: 330 },
    callouts: [[1, (p) => p.getByRole("menuitem", { name: /الصلاحيات الافتراضية/ })]],
    after: async (p) => p.keyboard.press("Escape"),
  },
  {
    id: "08-07-job-title-permissions",
    persona: "admin",
    path: "/master-data/job-titles",
    height: 1100,
    before: async (p) => {
      await p.getByRole("row", { name: /موظف مبيعات/ }).getByRole("button").last().click();
      await p.getByRole("menuitem", { name: /الصلاحيات الافتراضية/ }).click();
      await p.waitForTimeout(1000);
    },
    clip: "[role=dialog]",
    callouts: [
      [1, inDialog((d) => d.getByText(/تُطبَّق فورًا/))],
      [2, inDialog((d) => d.getByText(/البدء من مستخدم/))],
      [3, inDialog((d) => d.getByRole("button", { name: "مراجعة الأثر" }))],
    ],
  },
  {
    id: "08-08-impact-preview",
    persona: "admin",
    path: null,
    height: 1100,
    before: async (p) => {
      const d = p.getByRole("dialog");
      await d.getByRole("searchbox").fill("تقارير المبيعات");
      await p.waitForTimeout(600);
      const m = d.getByRole("button", { name: "تقارير المبيعات", exact: true });
      if (await m.count()) await m.first().click();
      await p.waitForTimeout(400);
      const cb = d.getByRole("checkbox").last();
      await cb.click();
      await p.waitForTimeout(300);
      await d.getByRole("button", { name: "مراجعة الأثر" }).click();
      await p.waitForTimeout(1500);
    },
    clip: "[role=dialog]",
    callouts: [
      [1, inDialog((d) => d.getByText(/إضافة \d+ · إزالة/))],
      [2, inDialog((d) => d.getByText("يكتسب", { exact: true }))],
      [3, inDialog((d) => d.getByRole("button", { name: "حفظ وتطبيق" }))],
      [4, inDialog((d) => d.getByRole("button", { name: "رجوع" }))],
    ],
    after: async (p) => p.keyboard.press("Escape"),
  },

  // ───────────── 9. Partners ─────────────
  {
    id: "09-01-partners",
    persona: "accountant",
    path: "/company-partners",
    width: 1440,
    clip: main,
    clipPad: 0,
    callouts: [[1, btn("إضافة شريك")], [2, (p) => p.getByRole("link", { name: /فترات الأرباح/ })], [3, col(/نسبة الأرباح/)], [4, col(/أساس الاحتساب/)], [5, txt("المتبقي المستحق").first()], [6, txt("مدفوع مقدمًا").first()]],
  },
  {
    id: "09-02-partner-statement",
    persona: "accountant",
    path: () => `/company-partners/${id.partner("خالد منصور")}`,
    width: 1600,
    height: 1050,
    clip: main,
    clipPad: 0,
    callouts: [
      [1, txt("النسبة الحالية").first()],
      [2, txt("الاستحقاق التقديري").first()],
      [3, txt("الأرباح المعتمدة").first()],
      [4, txt("المدفوع", true).first()],
      [5, txt("الموقف حتى اليوم").last()],
      [6, btn("تسجيل دفعة")],
      [7, btn("تغيير النسبة")],
    ],
  },
  {
    id: "09-03-partner-agreements",
    persona: "accountant",
    path: () => `/company-partners/${id.partner("دينا فاروق")}`,
    width: 1600,
    height: 1050,
    before: async (p) => {
      await p.getByRole("tab", { name: "الاتفاقيات" }).click();
      await p.waitForTimeout(900);
      await scrollTo(p, p.getByRole("tab", { name: "الاتفاقيات" }));
    },
    clip: main,
    clipPad: 0,
    callouts: [[1, tab("الاتفاقيات")], [2, txt("مجمل الربح").last()], [3, txt("سارية").last()]],
  },
  {
    id: "09-04-periods",
    persona: "accountant",
    path: "/company-partners/periods",
    width: 1600,
    height: 1100,
    before: async (p) => {
      await p.getByRole("row", { name: /01 Oct 2026/ }).getByRole("button").last().click();
      await p.waitForTimeout(400);
      await p.getByRole("menuitem", { name: "عرض في التقدير" }).click();
      await p.waitForTimeout(1800);
    },
    clip: main,
    clipPad: 0,
    callouts: [
      [1, (p) => p.locator("main").getByRole("button", { name: /2026/ }).first()],
      [2, txt("التقدير المباشر — تقديري")],
      [3, txt("الاستحقاق التقديري").first()],
      [4, txt("الفترات المحفوظة")],
      [5, txt("مقفلة").last()],
    ],
  },
  {
    id: "09-05-payment-dialog",
    persona: "accountant",
    path: () => `/company-partners/${id.partner("خالد منصور")}`,
    width: 1600,
    before: async (p) => {
      await p.getByRole("button", { name: "تسجيل دفعة" }).click();
      await p.waitForTimeout(800);
    },
    clip: "[role=dialog]",
    callouts: [
      [1, inDialog((d) => d.getByText("المتبقي المستحق").last())],
      [2, inDialog((d) => d.locator("input").first())],
      [3, inDialog((d) => d.getByRole("combobox").first())],
      [4, inDialog((d) => d.getByRole("button", { name: "حفظ" }))],
    ],
    after: async (p) => p.keyboard.press("Escape"),
  },
  {
    id: "09-06-accounting-settings-partners",
    persona: "admin",
    path: "/finance/accounting-settings",
    height: 1000,
    before: async (p) => {
      const s = p.getByText("توزيع أرباح الشركاء (حقوق ملكية)");
      if (await s.count()) await scrollTo(p, s);
      await p.evaluate(() => window.scrollBy(0, -140));
    },
    clip: main,
    clipPad: 0,
    callouts: [[1, txt("توزيع أرباح الشركاء (حقوق ملكية)")], [2, txt("أرباح الشركاء المستحقة (التزامات)")]],
  },

  // ───────────── 10. Agent portal ─────────────
  { id: "10-01-agent-home", persona: "agent", path: "/agent", sidebar: true, callouts: [[1, (p) => p.locator("[data-slot=sidebar]")], [2, txt("الوحدات", true)]] },
  { id: "10-02-agent-dashboard", persona: "agent", path: "/agent/dashboard", clip: main, clipPad: 0, callouts: [] },
  { id: "10-03-agent-leads", persona: "agent", path: "/agent/leads", clip: main, clipPad: 0, callouts: [[1, (p) => p.locator("main").getByRole("button", { name: /جديد|إضافة/ })]] },
  { id: "10-04-agent-orders", persona: "agent", path: "/agent/orders", clip: main, clipPad: 0, callouts: [[1, (p) => p.locator("main").getByRole("button", { name: /جديد|إضافة/ })], [2, col(/حالة المالية/)], [3, col(/^التنفيذ/)]] },
  { id: "10-06-agent-stock", persona: "agent", path: "/agent/stock", clip: main, clipPad: 0, callouts: [[1, col(/الرصيد الفعلي/)], [2, col(/المحجوز/)]] },
  {
    id: "10-07-agent-new-order",
    persona: "agent",
    path: "/agent/orders/new",
    height: 1250,
    before: async (p) => {
      const m = p.locator("main");
      await m.locator("input").first().fill("سلوى رمضان");
      await m.getByRole("combobox").first().click();
      await p.keyboard.type("مصر");
      await p.waitForTimeout(500);
      await p.keyboard.press("Enter");
      await p.waitForTimeout(300);
      await m.getByPlaceholder(/\d/).first().fill("1000000122");
      await p.keyboard.press("Tab");
      await p.waitForTimeout(300);
      await p.locator("main").getByRole("combobox", { name: /اختر المنتج/ }).first().click().catch(() => p.locator("main").getByText("اختر المنتج").first().click());
      await p.keyboard.type("عطر");
      await p.waitForTimeout(1000);
      await p.getByRole("option", { name: /عطر/ }).first().click();
      await p.waitForTimeout(400);
      await p.locator("main").getByPlaceholder("مبلغ السطر").first().fill("450");
      await p.keyboard.press("Tab");
      await p.waitForTimeout(800);
    },
    clip: main,
    clipPad: 0,
    callouts: [
      [1, txt("العميل", true).first()],
      [2, txt("التنفيذ والدفع", true)],
      [3, txt("التسعير", true)],
      [4, txt("المنتجات", true).first()],
      [5, txt("تفصيل السعر", true)],
      [6, btn("إنشاء الطلب")],
    ],
  },
  { id: "10-05-agent-team", persona: "agent", path: "/agent/team", clip: main, clipPad: 0, callouts: [] },

  // ───────────── 11. Settings ─────────────
  { id: "11-01-numbering", persona: "admin", path: "/settings/document-numbering", clip: main, clipPad: 0, callouts: [[1, col(/القالب/)], [2, col(/معاينة الرقم التالي/)]] },
  { id: "11-02-carriers", persona: "admin", path: "/master-data/shipping-companies", clip: main, clipPad: 0, callouts: [[1, (p) => p.locator("main").getByRole("button", { name: /جديد|إضافة/ })]] },
  { id: "11-03-accounting-settings", persona: "admin", path: "/finance/accounting-settings", clip: main, clipPad: 0, callouts: [[1, txt("العملة الرئيسية للنظام والقوائم المالية")]] },
];

// Resolve lazy paths.
for (const s of SHOTS) if (typeof s.path === "function") s.path = s.path();
