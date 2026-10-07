/* eslint-disable no-console */
/**
 * Builds the clean, fictitious Arabic demonstration data used for the manual's screenshots.
 *
 *   node docs/user-manual/build/demo-data.mjs          (API on :3205, DB oms_r14_manual)
 *
 * Every business record is created THROUGH THE API as the personas a real company would use.
 * SQL is used only where no API exists (company/branch display names, the one super-admin
 * persona's password hash) and for read-only lookups. Steps are idempotent: a finished step
 * is recorded in tmp/r14-manual/state.json and skipped on re-run.
 * All names and phone numbers are invented (phones follow the obviously fictitious
 * +20 100 000 0xxx pattern). Persona passwords live only in tmp/r14-manual/.env.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ROOT, PW, call, must, login, psql, rows, one, lit, items } from "./lib/api.mjs";

const STATE_FILE = `${ROOT}/tmp/r14-manual/state.json`;
const S = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(S, null, 2));
async function step(key, fn) {
  if (S[key] !== undefined) return S[key];
  console.log(`→ ${key}`);
  const v = await fn();
  S[key] = v ?? true;
  save();
  return S[key];
}

const EMAIL = (k) => `${k}@oms-demo.local`;
const T = { admin: await login(EMAIL("admin")) };
const A = (m, p, b, l) => must(T.admin, m, p, b, l);

// ───────── reference data (read only) ─────────
const settings = await A("GET", "/accounting/posting-settings");
const currencyId = settings.functionalCurrencyId;
const eg = one(`select id from countries where code = 'EG'`);
const mainWh = one(`select id from warehouses where is_default and deleted_at is null`);
const unitPiece = one(`select id from units where name = 'قطعة'`);
const recvBank = one(`select id from receiving_accounts where name = 'البنك الرئيسي'`);
const recvCash = one(`select id from receiving_accounts where name = 'الصندوق الرئيسي'`);
const srcBank = one(`select id from payment_sources where name = 'تحويل بنكي'`);
const srcCash = one(`select id from payment_sources where name = 'نقداً'`);
const salesDept = one(`select id from departments where name = 'المبيعات'`);

// ───────── 1. company display names (no API exists for these) ─────────
await step("company-names", async () => {
  psql(`update companies set name = 'شركة الأفق للتجارة' where name = 'Acme Trading'`);
  psql(`update companies set name = 'متجر الأفق الإلكتروني' where name = 'Nova Retail'`);
  psql(`update branches set name = 'الفرع الرئيسي' where name = 'Main Branch'`);
  psql(`update branches set name = 'فرع المستودع' where name = 'Warehouse Branch'`);
  psql(`update branches set name = 'المكتب الرئيسي' where name = 'Head Office'`);
});

// Real carrier brands from the dev seed are archived; the demo uses an invented carrier.
await step("carriers", async () => {
  for (const c of rows(`select id, name from shipping_companies where deleted_at is null and name in ('Aramex','SMSA','DHL','FedEx')`))
    await A("POST", `/shipping-companies/${c.id}/archive`);
  const r = await A("POST", "/shipping-companies", { name: "شركة السهم للشحن السريع", nameEn: "Al-Sahm Express (demo)" });
  return r.id;
});

// ───────── 2. departments, job titles (templates), users ─────────
const PERMS = {
  sales: [
    "crm.leads.view", "crm.leads.create", "crm.leads.edit", "crm.leads.convert",
    "partners.view", "partners.create", "products.view",
    "store-orders.view", "store-orders.create", "store-orders.edit",
    "sales.invoices.view", "sales.returns.view", "customers.lookup_advanced",
  ],
  shipping: ["store-orders.view", "shipping.view", "shipping.edit", "shipping.assign_carrier", "shipping.print", "shipping.export", "products.view", "inventory.view"],
  accountant: [
    "accounting.journal-entries.view", "accounting.chart-of-accounts.view", "accounting.expense-payments.view",
    "accounting.expense-payments.create", "accounting.expense-payments.confirm", "sales.receipts.view", "sales.receipts.create",
    "sales.receipts.confirm", "sales.invoices.view", "sales.returns.view", "sales.returns.create", "sales.returns.confirm",
    "store-orders.view", "store-orders.generate_invoice", "reports.financial.view", "reports.sales.view",
    "reports.inventory.view", "inventory.view", "products.view", "customers.view_financials", "expenses.view",
    "company-partners.view", "company-partners.manage", "company-partners.close", "company-partners.pay",
    "masterdata.fixed-assets.view", "purchasing.invoices.view", "purchasing.payments.view",
  ],
};
const depts = await step("departments", async () => {
  const mk = async (name) => (await A("POST", "/departments", { name })).id;
  return { sales: salesDept.id, ops: await mk("العمليات والشحن"), finance: await mk("المالية") };
});
const titles = await step("job-titles", async () => {
  const mk = async (name, nameEn, perms) => {
    const jt = one(`select id from job_titles where name = ${lit(name)} and deleted_at is null`) ?? (await A("POST", "/job-titles", { name, nameEn }));
    await A("PUT", `/job-titles/${jt.id}/permissions`, { permissionNames: perms });
    return jt.id;
  };
  return {
    sales: await mk("موظف مبيعات", "Sales associate", PERMS.sales),
    shipping: await mk("مسؤول الشحن", "Shipping officer", PERMS.shipping),
    accountant: await mk("محاسب عام", "General accountant", PERMS.accountant),
  };
});
const users = await step("users", async () => {
  const mk = async (key, fullName, dept, title, mobile) => {
    const u = await A("POST", "/users", {
      email: EMAIL(key), username: { sales: "mona.adel", sales2: "youssef.kamal", shipping: "karim.fouad", accountant: "hala.morad" }[key], fullName, password: PW, mustChangePassword: false,
      departmentId: dept, jobTitleId: title, mobile, salesDistributionEligible: key.startsWith("sales"),
    });
    return u.id;
  };
  return {
    sales: await mk("sales", "منى عادل", depts.sales, titles.sales, "+201000000201"),
    sales2: await mk("sales2", "يوسف كمال", depts.sales, titles.sales, "+201000000202"),
    shipping: await mk("shipping", "كريم فؤاد", depts.ops, titles.shipping, "+201000000203"),
    accountant: await mk("accountant", "هالة مراد", depts.finance, titles.accountant, "+201000000204"),
  };
});
// Individual overrides for the permission chapter: يوسف gets one individual grant and one deny.
await step("overrides", async () => {
  await A("PUT", `/users/${users.sales2}/permission-overrides`, { grants: ["reports.sales.view"], denies: ["customers.lookup_advanced"] });
});
for (const k of ["sales", "sales2", "shipping", "accountant"]) T[k] = await login(EMAIL(k));

// ───────── 3. catalogue ─────────
const cats = await step("categories", async () => {
  const mk = async (name) => (await A("POST", "/product-categories", { name })).id;
  return { audio: await mk("إكسسوارات الهاتف"), power: await mk("الشواحن والكابلات"), services: await mk("خدمات") };
});
const prod = await step("products", async () => {
  const mk = async (name, extra) => {
    const p = await A("POST", "/products", {
      name, internalName: name, displayName: name, type: "PURCHASE_AND_SALE", status: "ACTIVE",
      unitId: unitPiece.id, preferredWarehouseId: mainWh.id, costingMethod: "AVERAGE", ...extra,
    });
    if (p.status !== "ACTIVE") await A("POST", `/products/${p.id}/activate`);
    return p.id;
  };
  const stocked = { isPurchasable: true, isSellable: true, isInventoryItem: true, weight: 0.3, width: 10, height: 6, length: 15 };
  return {
    headset: await mk("سماعة لاسلكية H200", { ...stocked, categoryId: cats.audio, salesPrice: 750, purchasePrice: 400 }),
    charger: await mk("شاحن سريع 20 واط", { ...stocked, categoryId: cats.power, salesPrice: 150, purchasePrice: 60 }),
    stand: await mk("حامل هاتف معدني", { ...stocked, categoryId: cats.audio, salesPrice: 120, purchasePrice: 45 }),
    cable: await mk("كابل USB-C بطول متر", { ...stocked, categoryId: cats.power, salesPrice: 90 }),
    gift: await mk("خدمة تغليف هدايا", { categoryId: cats.services, itemType: "SERVICE", isPurchasable: false, isSellable: true, isInventoryItem: false, salesPrice: 40 }),
  };
});
await step("kit", async () => {
  const kit = await A("POST", "/products", {
    name: "طقم الشحن المكتبي", internalName: "طقم الشحن المكتبي", displayName: "طقم الشحن المكتبي",
    type: "SALES_ONLY", status: "ACTIVE", supplyMethod: "KIT", categoryId: cats.power, unitId: unitPiece.id,
    isPurchasable: false, isSellable: true, isInventoryItem: false, salesPrice: 240,
  });
  const rc = await A("POST", `/products/${kit.id}/recipes`, {
    lines: [
      { componentProductId: prod.charger, quantity: "1", unitId: unitPiece.id },
      { componentProductId: prod.stand, quantity: "1", unitId: unitPiece.id },
    ],
  });
  if (rc?.status !== "ACTIVE" && rc?.id) await call(T.admin, "POST", `/recipes/${rc.id}/activate`);
  if (kit.status !== "ACTIVE") await call(T.admin, "POST", `/products/${kit.id}/activate`);
  prod.kit = kit.id;
  S.products.kit = kit.id;
  return kit.id;
});
prod.kit = S.kit;

// ───────── 3b. opening balance of FY 2026 (owner capital in the bank) ─────────
await step("opening-balance", async () => {
  const fy = one(`select id, to_char(start_date, 'YYYY-MM-DD') d from fiscal_years where deleted_at is null order by start_date limit 1`);
  const capital = one(`select id from chart_of_accounts where code = '311'`);
  await A("POST", "/accounting/opening-balances", {
    fiscalYearId: fy.id, openingDate: fy.d,
    lines: [
      { accountId: settings.bankAccountId, debit: 250000, description: "رصيد البنك الافتتاحي" },
      { accountId: capital.id, credit: 250000, description: "رأس مال الشركة" },
    ],
  });
});

// ───────── 4. supplier → purchase order → purchase invoice (stock in, cost set) ─────────
const supplier = await step("supplier", async () =>
  (await A("POST", "/partners", {
    name: "مؤسسة النيل للتوريدات", roles: ["SUPPLIER"], mobile: "+201000000301", email: "supplier@example.com",
    countryId: eg.id, city: "القاهرة", address: "شارع التجارة 10 (عنوان تجريبي)", currencyId,
  })).id);
async function advance(base, id, targets) {
  let doc = await A("GET", `${base}/${id}`);
  for (const s of ["submit", "approve", "confirm"]) {
    if (targets.includes(doc.status)) break;
    await call(T.admin, "POST", `${base}/${id}/${s}`);
    doc = await A("GET", `${base}/${id}`);
  }
  if (!targets.includes(doc.status)) throw new Error(`${base}/${id} stuck in ${doc.status}`);
  return doc;
}
await step("purchase", async () => {
  const line = (productId, quantity, unitPrice) => ({ productId, unitId: unitPiece.id, quantity, unitPrice, subtotal: quantity * unitPrice });
  const prev = one(`select pi.id pi, pi.purchase_order_id po from purchase_invoices pi where pi.deleted_at is null and pi.partner_id = ${lit(supplier)} limit 1`);
  if (prev) {
    await advance("/purchasing/invoices", prev.pi, ["CONFIRMED"]);
    const po2 = await A("POST", "/purchase-orders", { partnerId: supplier, currencyId, purchaseType: "INVENTORY", items: [line(prod.headset, 20, 395)] });
    return { po: prev.po, pi: prev.pi, po2: po2.id };
  }
  const po = await A("POST", "/purchase-orders", {
    partnerId: supplier, currencyId, purchaseType: "INVENTORY", referenceNumber: "عرض المورد 77",
    items: [line(prod.headset, 50, 400), line(prod.charger, 40, 60), line(prod.stand, 60, 45), line(prod.cable, 30, 25)],
  });
  await A("POST", `/purchase-orders/${po.id}/approve`);
  const pi = await A("POST", `/purchase-orders/${po.id}/convert-to-invoice`, { warehouseId: mainWh.id });
  const piId = pi.id ?? pi.purchaseInvoice?.id;
  await advance("/purchasing/invoices", piId, ["CONFIRMED"]);
  // A second, still-draft purchase order for the purchasing chapter.
  const po2 = await A("POST", "/purchase-orders", { partnerId: supplier, currencyId, purchaseType: "INVENTORY", items: [line(prod.headset, 20, 395)] });
  return { po: po.id, pi: piId, po2: po2.id };
});
// The cable must stay WITHOUT a cost (missing-cost demonstration) — its purchase line is removed
// from cost by recording it separately? No: the cable is bought, so give it a cost-less sibling instead.
const noCost = await step("no-cost-product", async () => {
  const p = await A("POST", "/products", {
    name: "غطاء حماية شفاف", internalName: "غطاء حماية شفاف", displayName: "غطاء حماية شفاف", type: "PURCHASE_AND_SALE",
    status: "ACTIVE", unitId: unitPiece.id, preferredWarehouseId: mainWh.id, categoryId: cats.audio, costingMethod: "AVERAGE",
    isPurchasable: true, isSellable: true, isInventoryItem: true, weight: 0.05, width: 8, height: 1, length: 16, salesPrice: 60,
  });
  if (p.status !== "ACTIVE") await A("POST", `/products/${p.id}/activate`);
  // Opening quantity without a unit cost → stock exists but the product has no cost.
  await A("POST", "/inventory/opening-balance", { productId: p.id, warehouseId: mainWh.id, quantity: 25, notes: "رصيد افتتاحي بدون تكلفة (للتوضيح)" });
  return p.id;
});

// ───────── 5. leads (sales persona) ─────────
const carrier = S.carriers;
await step("leads", async () => {
  const mk = (customerName, mobileNumber, productId, quantity, city) =>
    must(T.sales, "POST", "/leads", { customerName, mobileNumber, countryId: eg.id, city, address: "عنوان تجريبي", productId, quantity, currencyId, source: "MANUAL", salesEmployeeId: users.sales });
  const l1 = await mk("رنا سمير", "+201000000111", prod.headset, 1, "الجيزة");
  const l2 = await mk("طارق حمدي", "+201000000112", prod.charger, 2, "الإسكندرية");
  const l3 = await mk("سلمى نبيل", "+201000000113", prod.stand, 1, "القاهرة");
  return { l1: l1.id, l2: l2.id, l3: l3.id };
});

// ───────── 6. store orders (sales persona) ─────────
const PH = { laila: "+201000000101", mahmoud: "+201000000102", sara: "+201000000103", omar: "+201000000104", noha: "+201000000105", rana: "+201000000111" };
async function order(key, name, phone, city, lines, extra = {}) {
  const r = await must(T.sales, "POST", "/store-orders", {
    partner: { name, phone, countryId: eg.id, city, address: `${city} — عنوان تجريبي` },
    source: "MANUAL", currencyId, paymentType: extra.paymentType ?? "CASH_ON_DELIVERY",
    items: lines.map(([productId, quantity, unitPrice]) => ({ productId, quantity, unitPrice })),
    delivery: { countryId: eg.id, city, address: `${city} — عنوان تجريبي` },
    creationIdempotencyKey: `manual-${key}`,
    ...(extra.duplicateResolution ? { duplicateResolution: extra.duplicateResolution } : {}),
  }, `order ${key}`);
  return { id: r.id, number: r.internalOrderId, partnerId: r.partnerId };
}
const O = await step("orders", async () => ({
  a: await order("a", "ليلى حسن", PH.laila, "القاهرة", [[prod.headset, 2, 750], [prod.gift, 1, 40]]),
  b: await order("b", "محمود عبد الله", PH.mahmoud, "الجيزة", [[prod.kit, 1, 240]]),
  c: await order("c", "سارة يوسف", PH.sara, "الإسكندرية", [[prod.charger, 1, 150], [noCost, 1, 60]]),
  e: await order("e", "عمر خالد", PH.omar, "المنصورة", [[prod.stand, 2, 120]]),
  f: await order("f", "نهى إبراهيم", PH.noha, "طنطا", [[prod.charger, 2, 150]]),
}));
await step("order-repeat", async () => {
  O.d = await order("d", "ليلى حسن", PH.laila, "القاهرة", [[prod.stand, 1, 120]], { duplicateResolution: { decision: "INTENTIONAL_NEW_ORDER", customerId: O.a.partnerId } });
  S.orders.d = O.d;
});
O.d = S.orders.d;
// Lead → order conversion (رنا سمير).
await step("lead-convert", async () => {
  const r = await must(T.sales, "POST", `/leads/${S.leads.l1}/convert`, {
    items: [{ productId: prod.headset, quantity: 1, agreedAmount: 750 }], paymentType: "CASH_ON_DELIVERY", currencyId, city: "الجيزة", address: "الجيزة — عنوان تجريبي",
  });
  return r.storeOrder?.id ?? r.storeOrderId ?? true;
});

// ───────── 7. shipping (shipping persona) ─────────
const ship = (id, p, b) => must(T.shipping, "POST", `/store-orders/${id}/shipments/${p}`, b, `${p} ${id}`);
await step("ship-a", async () => {
  await ship(O.a.id, "shipping-company", { shippingCompanyId: carrier });
  await ship(O.a.id, "tracking-number", { trackingNumber: "SH-48213097" });
  await ship(O.a.id, "ship");
  await ship(O.a.id, "out-for-delivery");
  await ship(O.a.id, "deliver");
});
await step("ship-b", async () => {
  await ship(O.b.id, "shipping-company", { shippingCompanyId: carrier });
  await ship(O.b.id, "tracking-number", { trackingNumber: "SH-48213105" });
  await ship(O.b.id, "ship");
});
await step("ship-c", async () => {
  await ship(O.c.id, "shipping-company", { shippingCompanyId: carrier });
  await ship(O.c.id, "tracking-number", { trackingNumber: "SH-48213112" });
  await ship(O.c.id, "ship");
  await ship(O.c.id, "deliver");
});
await step("ship-e", async () => {
  await ship(O.e.id, "shipping-company", { shippingCompanyId: carrier });
  await ship(O.e.id, "tracking-number", { trackingNumber: "SH-48213120" });
  await ship(O.e.id, "ship");
  await ship(O.e.id, "deliver");
});

// Order F: shipped and delivered (a second recognised order). Note: RETURN_PENDING is reached only from a
// pickup marked RETURNED or a carrier status whose code contains RETURN (imports) — not demonstrated here.
await step("ship-f", async () => {
  await ship(O.f.id, "shipping-company", { shippingCompanyId: carrier });
  await ship(O.f.id, "tracking-number", { trackingNumber: "SH-48213138" });
  await ship(O.f.id, "ship");
  await ship(O.f.id, "deliver");
});

// ───────── 8. payment for order A (accountant verifies) ─────────
await step("payment-a", async () => {
  const rep = await A("POST", `/store-orders/${O.a.id}/report-payment`, {
    reportedAmount: 1540, reportedDate: new Date().toISOString().slice(0, 10), paymentSourceId: srcCash.id, receivingAccountId: recvCash.id,
    reference: "تحصيل عند الاستلام", senderName: "شركة السهم للشحن السريع", notes: "تحصيل نقدي من شركة الشحن",
  });
  await must(T.accountant, "POST", `/payments/${rep.payment.id}/confirm`);
  return rep.payment.id;
});

// ───────── 9. sales return of order E (accountant) ─────────
await step("return-e", async () => {
  const inv = one(`select id from sales_invoices where store_order_id = ${lit(O.e.id)} and deleted_at is null and status <> 'CANCELLED'`);
  const full = await A("GET", `/sales/invoices/${inv.id}`);
  const line = full.items[0];
  const ret = await must(T.accountant, "POST", "/sales/returns", {
    partnerId: full.partnerId, salesInvoiceId: inv.id, currencyId, referenceNumber: "مرتجع العميل عمر خالد", internalNotes: "قطعة واحدة معيبة",
    items: [{ productId: line.productId, warehouseId: line.warehouseId ?? mainWh.id, unitId: line.unitId ?? unitPiece.id, quantity: 1, unitPrice: Number(line.unitPrice), salesInvoiceItemId: line.id }],
  });
  for (const st of ["submit", "approve", "confirm"]) await call(T.admin, "POST", `/sales/returns/${ret.id}/${st}`);
  return ret.id;
});

// ───────── 10. expenses + fixed asset (accountant / admin) ─────────
await step("expenses", async () => {
  const acc = (code) => one(`select id from chart_of_accounts where code = ${lit(code)}`)?.id;
  const expAcc = rows(`select id, code, name from chart_of_accounts where account_type = 'EXPENSE' and allows_posting and deleted_at is null order by code`);
  const pick = (re) => expAcc.find((a) => re.test(a.name))?.id ?? settings.defaultExpenseAccountId;
  const today = new Date().toISOString().slice(0, 10);
  const mk = (expenseAccountId, amount, description, src, recv) =>
    must(T.accountant, "POST", "/financial-transactions/expense-payments/confirmed", {
      expenseAccountId, amount, description, currencyId, transactionDate: today, paymentSourceId: src.id, receivingAccountId: recv.id,
    });
  await mk(pick(/إيجار/), 3000, "إيجار المستودع — أكتوبر", srcBank, recvBank);
  await mk(pick(/كهرباء|مرافق/), 450, "فاتورة الكهرباء", srcCash, recvCash);
  await mk(pick(/تسويق|إعلان/), 1200, "حملة إعلانية على وسائل التواصل", srcBank, recvBank);
  return expAcc.length;
});
await step("fixed-asset", async () => {
  const acq = new Date().toISOString().slice(0, 10);
  const a = await A("POST", "/fixed-assets", { name: "حاسب محمول لقسم المحاسبة", acquisitionDate: acq, cost: 24000, usefulLifeMonths: 36, salvageValue: 0, depreciationStartDate: acq, receivingAccountId: recvBank.id, notes: "أصل تجريبي" });
  await A("POST", `/fixed-assets/${a.id}/capitalize`, { usefulLifeMonths: 36, salvageValue: 0, depreciationStartDate: acq, receivingAccountId: recvBank.id });
  return a.id;
});

// ───────── 11. agent (fulfilment partner) with an agent-admin user ─────────
const agent = await step("agent", async () => {
  const ag = await A("POST", "/agents", {
    name: "مؤسسة الواحة للتوزيع", legalName: "مؤسسة الواحة للتوزيع (تجريبية)", contactName: "ياسر نبيل",
    phone: "+201000000401", email: "agent@example.com", address: "أسيوط — عنوان تجريبي", countryId: eg.id, currencyId,
  });
  const today = new Date().toISOString().slice(0, 10);
  const agr = await A("POST", `/agents/${ag.id}/agreements`, {
    effectiveFrom: today, currencyId, productCommissionRatePercent: 10, serviceCommissionRatePercent: 5,
    shippingPolicy: "PREDETERMINED_CHARGE", commissionEarningEvent: "DELIVERED", returnCommissionTreatment: "REVERSE",
    customerShippingChargeOwner: "COMPANY", providerFeesBorneBy: "COMPANY", shippingFeePerShipment: 0, returnFeePerShipment: 0,
    serviceFeePerOrder: 0, allowAgentDestinations: false, payoutHoldDays: 7, notes: "اتفاقية تجريبية",
  });
  await A("PUT", `/agents/${ag.id}/agreements/${agr.id}/shipping-rates`, { countryId: eg.id, city: "", amount: 50 });
  await A("POST", `/agents/${ag.id}/agreements/${agr.id}/activate`);
  for (const pid of [prod.headset, prod.charger, prod.stand]) await call(T.admin, "POST", `/agents/${ag.id}/products/${pid}/link`);
  const u = await A("POST", `/agents/${ag.id}/users`, { email: EMAIL("agent"), username: "yasser.nabil", fullName: "ياسر نبيل", mobile: "+201000000402", agentRole: "ADMIN" });
  const uid = u.id ?? u.user?.id ?? one(`select id from users where email = ${lit(EMAIL("agent"))}`).id;
  // The persona password is set to the build password (same approach as prisma/scripts/ensure-agents-demo.ts).
  const hash = one(`select password_hash h from users where email = ${lit(EMAIL("admin"))}`).h;
  psql(`update users set password_hash = ${lit(hash)}, must_change_password = false where id = ${lit(uid)}`);
  return { id: ag.id, userId: uid };
});
T.agent = await login(EMAIL("agent"));
await step("agent-lead", async () => {
  const r = await must(T.agent, "POST", "/agent-portal/leads", {
    customerName: "حسام عادل", mobileNumber: "+201000000121", countryId: eg.id, city: "أسيوط", address: "أسيوط — عنوان تجريبي",
    source: "MANUAL",
  });
  return r.id;
});

// Agent-owned goods (بضاعة الوكيل): created by the company for the agent, received as stock without cost.
const agentGoods = await step("agent-goods", async () => {
  const mk = async (name, price, qty) => {
    const p = await A("POST", "/products", {
      name, internalName: name, displayName: name, type: "PURCHASE_AND_SALE", status: "ACTIVE", categoryId: cats.audio,
      unitId: unitPiece.id, isSellable: true, isPurchasable: true, isInventoryItem: true, itemType: "PRODUCT", salesPrice: price,
      preferredWarehouseId: mainWh.id, weight: 0.4, width: 8, height: 8, length: 12, ownerAgentId: agent.id,
    });
    await A("POST", "/inventory/opening-balance", { productId: p.id, warehouseId: mainWh.id, quantity: qty, notes: "استلام مخزون الوكيل" });
    return p.id;
  };
  return { perfume: await mk("عطر عود فاخر 50 مل", 450, 30), incense: await mk("بخور معطّر — علبة", 120, 50) };
});
await step("agent-order", async () => {
  const r = await must(T.agent, "POST", "/agent-portal/orders", {
    pricingMode: "SHIPPING_ADDED", paymentType: "CASH_ON_DELIVERY", fulfillmentMethod: "SHIPPING",
    customer: { name: "حسام عادل", mobile: "+201000000121", countryId: eg.id, city: "أسيوط", address: "أسيوط — عنوان تجريبي" },
    countryId: eg.id, city: "أسيوط", address: "أسيوط — عنوان تجريبي",
    lines: [{ productId: agentGoods.perfume, quantity: 1, lineAmount: 450 }, { productId: agentGoods.incense, quantity: 2, lineAmount: 240 }],
    idempotencyKey: "manual-agent-order-1",
  });
  return r.id ?? true;
});

// ───────── 12. company partners (accountant persona) ─────────
const partners = await step("company-partners", async () => {
  const mk = async (name, phone, ownershipPercent) => {
    const r = await must(T.accountant, "POST", "/company-partners/profiles", { name, phone, email: undefined, ownershipPercent, notes: "شريك تجريبي" });
    return r.partnerId ?? r.id;
  };
  return { a: await mk("خالد منصور", "+201000000501", 50), b: await mk("دينا فاروق", "+201000000502", 25) };
});
await step("partner-accounts", async () => {
  const eqParent = one(`select id from chart_of_accounts where code = '32'`);
  const liParent = one(`select id from chart_of_accounts where deleted_at is null and account_type = 'LIABILITY' and not allows_posting order by level desc, code limit 1`);
  const d = await A("POST", "/chart-of-accounts", { name: "توزيعات أرباح الشركاء", accountType: "EQUITY", parentAccountId: eqParent.id, allowsPosting: true, accountKind: "POSTING" });
  const p = await A("POST", "/chart-of-accounts", { name: "أرباح الشركاء المستحقة", accountType: "LIABILITY", parentAccountId: liParent.id, allowsPosting: true, accountKind: "POSTING" });
  await A("PATCH", "/accounting/posting-settings", { partnerProfitDistributionAccountId: d.id, partnerProfitPayableAccountId: p.id });
});
await step("partner-agreements", async () => {
  await must(T.accountant, "POST", "/company-partners/agreements", { partnerId: partners.a, profitSharePercent: 30, basis: "NET_PROFIT", effectiveFrom: "2026-09-01", frequency: "MONTHLY", activate: true });
  await must(T.accountant, "POST", "/company-partners/agreements", { partnerId: partners.b, profitSharePercent: 20, basis: "GROSS_PROFIT", effectiveFrom: "2026-09-01", frequency: "MONTHLY", activate: true });
});

// ───────── 13. B2B sale to a corporate customer + receipt ─────────
const b2b = await step("b2b-sale", async () => {
  const cust = await A("POST", "/partners", {
    name: "شركة الريادة للحلول المكتبية", roles: ["CUSTOMER"], mobile: "+201000000601", email: "orders@example.com",
    countryId: eg.id, city: "القاهرة", address: "التجمع الخامس — عنوان تجريبي", currencyId,
  });
  const inv = await A("POST", "/sales/invoices", {
    partnerId: cust.id, currencyId, referenceNumber: "أمر شراء العميل 5521",
    items: [{ productId: prod.headset, warehouseId: mainWh.id, unitId: unitPiece.id, quantity: 20, unitPrice: 750 }],
  });
  await advance("/sales/invoices", inv.id, ["CONFIRMED"]);
  const today = new Date().toISOString().slice(0, 10);
  const r = await A("POST", "/financial-transactions/receipts", {
    partnerId: cust.id, currencyId, transactionDate: today, paymentSourceId: srcBank.id, receivingAccountId: recvBank.id,
    amount: 10000, referenceNumber: "تحويل بنكي 88412", notes: "دفعة أولى", allocations: [{ invoiceId: inv.id, allocatedAmount: 10000 }],
  });
  await A("POST", `/financial-transactions/receipts/${r.id}/confirm`);
  return { customer: cust.id, invoice: inv.id };
});

// ───────── 14. September 2026 books (the month before the company started working in OMS) ─────────
// The accountant records September's trading as summary journal entries (sales and their cost) and pays
// September's expenses with expense vouchers dated in September — so September is a past, closable period.
await step("september-books", async () => {
  const gj = one(`select id from journals where type = 'GENERAL' and is_active and deleted_at is null order by created_at limit 1`);
  const je = async (entryDate, description, referenceNumber, lines) => {
    const e = await must(T.admin, "POST", "/journal-entries", { entryDate, journalId: gj.id, description, referenceNumber, currencyId, lines });
    await must(T.admin, "POST", `/journal-entries/${e.id}/post`);
    return e.id;
  };
  await je("2026-09-30", "مبيعات شهر سبتمبر (قيد إجمالي قبل بدء العمل على النظام)", "SEP-SALES", [
    { accountId: settings.bankAccountId, debit: 30000, description: "متحصلات مبيعات سبتمبر" },
    { accountId: settings.salesRevenueAccountId, credit: 30000, description: "مبيعات سبتمبر" },
  ]);
  await je("2026-09-30", "تكلفة البضاعة المباعة لشهر سبتمبر (قيد إجمالي)", "SEP-COGS", [
    { accountId: settings.costOfGoodsSoldAccountId, debit: 12000, description: "تكلفة مبيعات سبتمبر" },
    { accountId: settings.bankAccountId, credit: 12000, description: "مشتريات بضاعة بيعت في سبتمبر" },
  ]);
  const expAcc = rows(`select id, name from chart_of_accounts where account_type = 'EXPENSE' and allows_posting and deleted_at is null order by code`);
  const pick = (re) => expAcc.find((a) => re.test(a.name))?.id ?? settings.defaultExpenseAccountId;
  const ev = (date, expenseAccountId, amount, description) =>
    must(T.accountant, "POST", "/financial-transactions/expense-payments/confirmed", {
      expenseAccountId, amount, description, currencyId, transactionDate: date, paymentSourceId: srcBank.id, receivingAccountId: recvBank.id,
    });
  await ev("2026-09-05", pick(/إيجار/), 3000, "إيجار المستودع — سبتمبر");
  await ev("2026-09-20", pick(/كهرباء|مرافق/), 450, "فاتورة الكهرباء — سبتمبر");
  await ev("2026-09-25", pick(/تسويق|إعلان/), 1200, "حملة إعلانية — سبتمبر");
});

// ───────── 15. partner periods: September reviewed → closed → paid; October only reviewed (not ended yet) ─────────
await step("partner-close", async () => {
  const pv = await must(T.accountant, "POST", "/company-partners/periods", { periodFrom: "2026-09-01", periodTo: "2026-09-30" });
  const cl = await must(T.accountant, "POST", `/company-partners/periods/${pv.id}/close`);
  return { id: pv.id, status: cl.status };
});
await step("partner-payment", async () => {
  await must(T.accountant, "POST", "/company-partners/payments", {
    partnerId: partners.a, amount: 2000, date: new Date().toISOString().slice(0, 10), financialAccountId: settings.bankAccountId, reference: "تحويل بنكي 90311",
  });
});
await step("partner-review-october", async () => {
  const pv = await must(T.accountant, "POST", "/company-partners/periods", { periodFrom: "2026-10-01", periodTo: "2026-10-31" });
  const early = await call(T.accountant, "POST", `/company-partners/periods/${pv.id}/close`);
  if (early.ok) throw new Error("October closed before its end — the release should refuse this");
  return { id: pv.id, status: pv.status, earlyClose: early.j?.code ?? early.s };
});

// ───────── 16. a title change → the permissions review flag ─────────
await step("review-flag", async () => {
  const jt = await A("POST", "/job-titles", { name: "مشرف مبيعات", nameEn: "Sales supervisor" });
  await A("PUT", `/job-titles/${jt.id}/permissions`, { permissionNames: [...PERMS.sales, "reports.sales.view", "crm.leads.manage"] });
  await A("PATCH", `/users/${users.sales2}`, { jobTitleId: jt.id });
  return jt.id;
});

writeFileSync(`${ROOT}/tmp/r14-manual/state.json`, JSON.stringify(S, null, 2));
console.log("demo data complete");
export { S, T, A, prod, users, titles, supplier, noCost, currencyId, eg, mainWh, unitPiece, recvBank, recvCash, srcBank, srcCash, settings };
