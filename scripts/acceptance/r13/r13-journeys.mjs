#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * R13 — Product, Inventory & Costing: end-to-end API journeys A–F (spec §9) plus
 * the cross-cutting checks (similar name, barcode, recipe cycle / mixed owner,
 * concurrent confirm) and the integrity invariants, against the LOCAL review
 * stack only. Every business record is created through the API as a real user;
 * SQL is read-only (assertions). Records are tagged "[R13-DEMO]".
 *
 *   API=http://localhost:4805 R13_DB=oms_r13_demo node scripts/acceptance/r13/r13-journeys.mjs
 *
 * Password: R7_PW from tmp/r7-final/.r7.env (never printed). Exit 1 on any FAIL.
 * Output: specs/product-inventory-costing/evidence/journeys/r13-journeys.{json,md}
 * and r13-journeys-context.json (ids reused by r13-browser.mjs).
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const API = (process.env.API ?? "http://localhost:4805").replace(/\/$/, "");
const DB = process.env.R13_DB ?? "oms_r13_demo";
if (DB === "oms") throw new Error("refusing the local `oms` database");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) throw new Error("local API only");
const ROOT = "D:/Systems/OMS";
const OUT = `${ROOT}/specs/product-inventory-costing/evidence/journeys`;
mkdirSync(OUT, { recursive: true });

function pw() {
  if (process.env.R7_PW) return process.env.R7_PW;
  const file = `${ROOT}/tmp/r7-final/.r7.env`;
  const line = existsSync(file)
    ? readFileSync(file, "utf8")
        .split(/\r?\n/)
        .find((l) => l.startsWith("R7_PW="))
    : null;
  if (!line) throw new Error("no demo password");
  return line.slice(6).trim();
}
const PW = pw();
const RUN = Date.now().toString(36).toUpperCase().slice(-6);
const TAG = "[R13-DEMO]";
const TODAY = new Date().toISOString().slice(0, 10);

const psql = (sql) =>
  execFileSync(
    "docker",
    ["exec", "oms-postgres", "psql", "-U", "oms", "-d", DB, "-At", "-F", "|", "-c", sql],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("|"));

// ── result bookkeeping ───────────────────────────────────────────────────────
const results = [];
let journey = "SETUP";
const check = (name, ok, expected = "", observed = "") => {
  results.push({ journey, name, ok: !!ok, expected: String(expected), observed: String(observed) });
  console.log(
    `${ok ? "PASS" : "FAIL"}  [${journey}] ${name}${observed !== "" ? `  -> ${observed}` : ""}`,
  );
};
const num = (v) => (v == null ? NaN : Number(v));
const near = (a, b, eps = 0.005) => Math.abs(num(a) - num(b)) <= eps;
const r2 = (n) => Math.round(Number(n) * 100) / 100;

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) throw new Error(`login ${email}: ${r.status}`);
  return j.accessToken;
}
let TOKEN = null;
async function call(method, path, body, { token = TOKEN, headers = {} } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* empty body */
  }
  return { s: r.status, ok: r.status >= 200 && r.status < 300, j };
}
class StepError extends Error {}
const errText = (j) =>
  j
    ? `${j.code ?? ""} ${typeof j.message === "string" ? j.message : JSON.stringify(j.message ?? j)}`.trim()
    : "";
async function must(method, path, body, opts) {
  const r = await call(method, path, body, opts);
  if (!r.ok) throw new StepError(`${method} ${path} -> ${r.s} ${errText(r.j)}`.slice(0, 600));
  return r.j;
}
const items = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));

// ── domain helpers ───────────────────────────────────────────────────────────
const ctx = { run: RUN, api: API, db: DB, ids: {} };
let PS, WH, UNIT, CAT, SAR, SUPPLIER, CUSTOMER;

async function stock(productId, warehouseId = WH) {
  const j = await must(
    "GET",
    `/inventory/stock?productId=${productId}${warehouseId ? `&warehouseId=${warehouseId}` : ""}`,
  );
  return {
    onHand: num(j.onHand),
    reserved: num(j.reserved),
    available: num(j.available),
    ownerAgentId: j.ownerAgentId,
  };
}
const avg = async (productId) =>
  num((await must("GET", `/inventory/stock-card/${productId}`)).averageCost);
const movements = async (q) => items(await must("GET", `/inventory/movements?${q}`));
async function journals(sourceType, sourceId) {
  const list = items(
    await must("GET", `/journal-entries?sourceType=${sourceType}&sourceId=${sourceId}&pageSize=50`),
  );
  const full = [];
  for (const e of list) full.push(e.lines ? e : await must("GET", `/journal-entries/${e.id}`));
  return full;
}
const lineSum = (entries, accountId, side) =>
  r2(
    entries
      .flatMap((e) => e.lines ?? [])
      .filter((l) => (l.accountId ?? l.account?.id) === accountId)
      .reduce((s, l) => s + num(l[side]), 0),
  );
const netDr = (entries, accountId) =>
  r2(lineSum(entries, accountId, "debit") - lineSum(entries, accountId, "credit"));
const balanced = (entries) =>
  entries.length > 0 &&
  entries.every((e) => {
    const d = (e.lines ?? []).reduce((s, l) => s + num(l.debit), 0);
    const c = (e.lines ?? []).reduce((s, l) => s + num(l.credit), 0);
    return near(d, c);
  });

async function product(label, extra = {}) {
  return must("POST", "/products", {
    name: `${TAG} ${label} ${RUN}`,
    nameEn: `${TAG} ${label} ${RUN}`,
    categoryId: CAT,
    unitId: UNIT,
    status: "ACTIVE",
    salesPrice: 100,
    preferredWarehouseId: WH,
    ...extra,
  });
}
async function purchaseInvoice(lines, label) {
  const inv = await must("POST", "/purchasing/invoices", {
    partnerId: SUPPLIER,
    currencyId: SAR,
    referenceNumber: `${TAG} ${label} ${RUN}`,
    items: lines.map((l) => ({
      productId: l.p.id,
      warehouseId: WH,
      unitId: UNIT,
      quantity: l.qty,
      unitPrice: l.price,
    })),
  });
  await must("POST", `/purchasing/invoices/${inv.id}/confirm`);
  return must("GET", `/purchasing/invoices/${inv.id}`);
}
async function salesInvoice(lines, label) {
  return must("POST", "/sales/invoices", {
    partnerId: CUSTOMER,
    currencyId: SAR,
    referenceNumber: `${TAG} ${label} ${RUN}`,
    items: lines.map((l) => ({
      productId: l.p.id,
      warehouseId: WH,
      unitId: UNIT,
      quantity: l.qty,
      unitPrice: l.price,
    })),
  });
}
async function salesReturn(invoice, lines, label) {
  const ret = await must("POST", "/sales/returns", {
    partnerId: CUSTOMER,
    salesInvoiceId: invoice.id,
    currencyId: SAR,
    referenceNumber: `${TAG} ${label} ${RUN}`,
    items: lines.map((l) => {
      const it = invoice.items.find((i) => i.productId === l.p.id);
      return {
        productId: l.p.id,
        warehouseId: WH,
        unitId: UNIT,
        quantity: l.qty,
        unitPrice: num(it.unitPrice),
        salesInvoiceItemId: it.id,
      };
    }),
  });
  await must("POST", `/sales/returns/${ret.id}/submit`);
  await must("POST", `/sales/returns/${ret.id}/approve`);
  await must("POST", `/sales/returns/${ret.id}/confirm`);
  return ret;
}
async function integrity(productIds) {
  const q = productIds?.length ? `?productIds=${productIds.join(",")}` : "";
  const rep = await must("GET", `/inventory/integrity${q}`);
  const by = Object.fromEntries(rep.invariants.map((i) => [i.id, i]));
  return { rep, by };
}
async function section(name, fn) {
  journey = name;
  console.log(`\n── ${name} ─────────────────────────────`);
  try {
    await fn();
  } catch (e) {
    check("journey completed without an unexpected error", false, "no error", e.message);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`R13 journeys — RUN ${RUN} — API ${API} — DB ${DB}`);
  TOKEN = await login("demo-r7-admin@oms.local");

  await section("SETUP", async () => {
    PS = await must("GET", "/accounting/posting-settings");
    SAR = PS.functionalCurrencyId;
    check("functional currency configured", !!SAR, "set", SAR);
    const whs = items(await must("GET", "/warehouses?pageSize=200")).filter(
      (w) => w.isActive !== false && !w.deletedAt,
    );
    WH = (whs.find((w) => w.code === "WH-MAIN") ?? whs.find((w) => w.isDefault) ?? whs[0]).id;
    const units = items(await must("GET", "/units?pageSize=200"));
    UNIT = (
      units.find((u) => u.name === "قطعة") ??
      (await must("GET", `/units?search=${encodeURIComponent("قطعة")}&pageSize=20`)).items?.find(
        (u) => u.name === "قطعة",
      ) ??
      units[0]
    ).id;
    const cat = await must("POST", "/product-categories", {
      name: `${TAG} Category ${RUN}`,
      defaultUnitId: UNIT,
    });
    CAT = cat.id;
    // Assembly cost account (direct-cost absorption, credited by an assembly with direct cost).
    // The local chart has no dedicated account, so a tagged postable EXPENSE account
    // "Applied assembly cost" is created next to 541 Inventory Adjustments (setup data, via the API).
    if (!PS.assemblyCostAccountId || process.env.R13_FORCE_ASSEMBLY_ACCOUNT === "1") {
      const label = `${TAG} Applied assembly cost`;
      const exp = items(
        await must("GET", "/chart-of-accounts?accountType=EXPENSE&postingOnly=true&pageSize=1000"),
      );
      let acct = exp.find((a) => a.nameEn === label);
      if (!acct) {
        const sibling = exp.find((a) => a.code === "541");
        acct = await must("POST", "/chart-of-accounts", {
          name: `${TAG} تكاليف التجميع المحمّلة`,
          nameEn: label,
          accountType: "EXPENSE",
          parentAccountId: sibling?.parentAccountId ?? undefined,
          allowsPosting: true,
          description:
            "R13 acceptance: credit side of assembly direct cost (absorbed into finished goods)",
        });
      }
      await must("PATCH", "/accounting/posting-settings", { assemblyCostAccountId: acct.id });
      PS = await must("GET", "/accounting/posting-settings");
    }
    ctx.assemblyCostAccountId = PS.assemblyCostAccountId;
    check(
      "PostingSettings.assemblyCostAccountId set",
      !!PS.assemblyCostAccountId,
      "set",
      PS.assemblyCostAccountId,
    );
    const sup = await must("POST", "/partners", {
      name: `${TAG} Supplier ${RUN}`,
      roles: ["SUPPLIER"],
      entityType: "ORGANIZATION",
    });
    const cus = await must("POST", "/partners", {
      name: `${TAG} Customer ${RUN}`,
      roles: ["CUSTOMER"],
      entityType: "ORGANIZATION",
    });
    SUPPLIER = sup.id;
    CUSTOMER = cus.id;
    const fy = items(await must("GET", "/accounting/fiscal-years"));
    const cover = fy.find(
      (y) => y.startDate.slice(0, 10) <= TODAY && y.endDate.slice(0, 10) >= TODAY,
    );
    check(
      "posting window: fiscal year for today is open (or none)",
      !cover || cover.status === "OPEN",
      "OPEN",
      cover ? `${cover.name} ${cover.status}` : "none",
    );
    Object.assign(ctx.ids, {
      warehouseId: WH,
      unitId: UNIT,
      categoryId: CAT,
      supplierId: SUPPLIER,
      customerId: CUSTOMER,
      currencyId: SAR,
    });
    check(
      "setup: warehouse, unit, category, supplier, customer",
      WH && UNIT && CAT && SUPPLIER && CUSTOMER,
      "all ids",
      `WH=${WH.slice(0, 8)}`,
    );
  });

  // ─── A: buy and sell the same product ──────────────────────────────────────
  await section("A", async () => {
    const p = await product("Buy-Sell Widget", {
      itemType: "PRODUCT",
      salesPrice: 25,
      purchasePrice: 10,
    });
    ctx.ids.productA = p.id;
    check(
      "one product is both purchasable and sellable, tracked",
      p.isPurchasable && p.isSellable && p.isInventoryItem && p.supplyMethod === "PURCHASED",
      "buy+sell+tracked, PURCHASED",
      `${p.isPurchasable}/${p.isSellable}/${p.isInventoryItem}/${p.supplyMethod}`,
    );

    const po = await must("POST", "/purchase-orders", {
      partnerId: SUPPLIER,
      currencyId: SAR,
      purchaseType: "INVENTORY",
      referenceNumber: `${TAG} PO ${RUN}`,
      items: [{ productId: p.id, quantity: 10, unitId: UNIT, unitPrice: 10, subtotal: 100 }],
    });
    await must("POST", `/purchase-orders/${po.id}/approve`);
    const draft = await must("POST", `/purchase-orders/${po.id}/convert-to-invoice`, {
      warehouseId: WH,
    });
    check(
      "PO converts to a draft purchase invoice",
      draft.status === "DRAFT" && draft.purchaseOrderId === po.id,
      "DRAFT linked to PO",
      `${draft.status} ${draft.invoiceNumber}`,
    );
    await must("POST", `/purchasing/invoices/${draft.id}/confirm`);
    const pi = await must("GET", `/purchasing/invoices/${draft.id}`);
    ctx.ids.purchaseInvoiceA = pi.id;
    const poAfter = await must("GET", `/purchase-orders/${po.id}`);
    check(
      "purchase invoice confirmed, PO closed",
      pi.status === "CONFIRMED" && poAfter.status === "CLOSED",
      "CONFIRMED / CLOSED",
      `${pi.status} / ${poAfter.status}`,
    );
    let s = await stock(p.id);
    check("receipt: on-hand 10", s.onHand === 10, 10, s.onHand);
    check("receipt: moving average 10", near(await avg(p.id), 10), 10, await avg(p.id));
    const recMv = await movements(`referenceId=${pi.id}`);
    check(
      "receipt movement PURCHASE_RECEIPT +10",
      recMv.length === 1 && recMv[0].type === "PURCHASE_RECEIPT" && recMv[0].quantity === 10,
      "1 × +10",
      recMv.map((m) => `${m.type}${m.quantity}`).join(","),
    );
    const jePI = await journals("PURCHASE_INVOICE", pi.id);
    check(
      "purchase journal Dr Inventory 100 / Cr AP 100, balanced",
      balanced(jePI) &&
        near(netDr(jePI, PS.inventoryAccountId), 100) &&
        near(netDr(jePI, PS.accountsPayableAccountId), -100),
      "Dr INV 100 · Cr AP 100",
      `INV ${netDr(jePI, PS.inventoryAccountId)} AP ${netDr(jePI, PS.accountsPayableAccountId)}`,
    );

    // B2B sales order → reserve
    const so = await must("POST", "/sales/orders", {
      partnerId: CUSTOMER,
      currencyId: SAR,
      referenceNumber: `${TAG} SO ${RUN}`,
      items: [{ productId: p.id, warehouseId: WH, unitId: UNIT, quantity: 4, unitPrice: 25 }],
    });
    await must("POST", `/sales/orders/${so.id}/confirm`);
    ctx.ids.salesOrderA = so.id;
    s = await stock(p.id);
    check(
      "order confirm reserves 4 (available 6)",
      s.onHand === 10 && s.reserved === 4 && s.available === 6,
      "10/4/6",
      `${s.onHand}/${s.reserved}/${s.available}`,
    );

    const soFull = await must("GET", `/sales/orders/${so.id}`);
    const invDraft = await must("POST", `/sales/orders/${so.id}/convert-to-invoice`, {
      items: [{ salesOrderItemId: soFull.items[0].id, quantity: 4 }],
    });
    await must("POST", `/sales/invoices/${invDraft.id}/confirm`);
    const si = await must("GET", `/sales/invoices/${invDraft.id}`);
    ctx.ids.salesInvoiceA = si.id;
    s = await stock(p.id);
    check(
      "invoice delivers: on-hand 6, reservation released, available 6",
      s.onHand === 6 && s.reserved === 0 && s.available === 6,
      "6/0/6",
      `${s.onHand}/${s.reserved}/${s.available}`,
    );
    const delMv = await movements(`referenceId=${si.id}`);
    check(
      "one SALES_DELIVERY −4 for the invoice",
      delMv.filter((m) => m.type === "SALES_DELIVERY").length === 1 &&
        delMv.find((m) => m.type === "SALES_DELIVERY")?.quantity === -4,
      "1 × −4",
      delMv.map((m) => `${m.type}${m.quantity}`).join(","),
    );
    check(
      "invoice line unit cost = average 10",
      near(si.items[0].unitCost, 10),
      10,
      si.items[0].unitCost,
    );
    const jeSI = await journals("SALES_INVOICE", si.id);
    check(
      "COGS = 4 × 10 = 40, Cr Inventory 40, journal balanced",
      balanced(jeSI) &&
        near(netDr(jeSI, PS.costOfGoodsSoldAccountId), 40) &&
        near(netDr(jeSI, PS.inventoryAccountId), -40),
      "COGS 40",
      `COGS ${netDr(jeSI, PS.costOfGoodsSoldAccountId)} INV ${netDr(jeSI, PS.inventoryAccountId)}`,
    );
    check(
      "revenue 100 posted",
      near(-netDr(jeSI, PS.salesRevenueAccountId), 100),
      100,
      -netDr(jeSI, PS.salesRevenueAccountId),
    );

    // landed cost after the partial sale: Q=10, O=6 → capitalized 18, variance 12
    const comps = items(await must("GET", "/cost-components?pageSize=100"));
    const comp =
      comps.find((c) => c.code === "INBOUND_SHIPPING") ??
      comps.find(
        (c) => c.capitalizable && !["FULFILLMENT", "TRANSACTION"].includes(c.accountingClass),
      );
    const lc = await must("POST", "/landed-cost-documents", {
      purchaseInvoiceId: pi.id,
      providerId: SUPPLIER,
      currencyId: SAR,
      referenceNumber: `${TAG} LC ${RUN}`,
      documentDate: TODAY,
      allocationMethod: "BY_QUANTITY",
      lines: [{ costComponentId: comp.id, description: `${TAG} freight`, netAmount: 30 }],
    });
    await must("POST", `/landed-cost-documents/${lc.id}/approve`);
    await must("POST", `/landed-cost-documents/${lc.id}/confirm`);
    const lcDoc = await must("GET", `/landed-cost-documents/${lc.id}`);
    ctx.ids.landedCostA = lc.id;
    const al = lcDoc.allocations?.[0] ?? {};
    check(
      "landed cost split: capitalized = 30 × min(10,6)/10 = 18",
      near(al.capitalizedAmount, 18),
      18,
      al.capitalizedAmount,
    );
    check(
      "landed cost split: COGS variance = 12",
      near(al.cogsVarianceAmount, 12),
      12,
      al.cogsVarianceAmount,
    );
    check(
      "landed cost document has a frozen exchange rate",
      lcDoc.exchangeRate != null,
      "not null",
      lcDoc.exchangeRate,
    );
    const jeLC = await journals("LANDED_COST", lc.id);
    check(
      "landed cost journal Dr Inventory 18 / Dr COGS 12 / Cr 30, balanced",
      balanced(jeLC) &&
        near(netDr(jeLC, PS.inventoryAccountId), 18) &&
        near(netDr(jeLC, PS.costOfGoodsSoldAccountId), 12),
      "18 / 12",
      `INV ${netDr(jeLC, PS.inventoryAccountId)} COGS ${netDr(jeLC, PS.costOfGoodsSoldAccountId)}`,
    );
    check(
      "average moves only by the capitalized part: (6×10+18)/6 = 13",
      near(await avg(p.id), 13, 0.0001),
      13,
      await avg(p.id),
    );

    // sales return of 1 → back at the snapshot cost 10 (current average is 13)
    const ret = await salesReturn(si, [{ p, qty: 1 }], "Return A");
    ctx.ids.salesReturnA = ret.id;
    s = await stock(p.id);
    check("return: on-hand 7", s.onHand === 7, 7, s.onHand);
    const jeRet = await journals("SALES_RETURN", ret.id);
    check(
      "return restores at snapshot cost 10 (not current 13): Dr INV 10 / Cr COGS 10",
      balanced(jeRet) &&
        near(netDr(jeRet, PS.inventoryAccountId), 10) &&
        near(netDr(jeRet, PS.costOfGoodsSoldAccountId), -10),
      "10 / −10",
      `INV ${netDr(jeRet, PS.inventoryAccountId)} COGS ${netDr(jeRet, PS.costOfGoodsSoldAccountId)}`,
    );
    const expAvg = (6 * 13 + 10) / 7;
    check(
      "average after return blends the snapshot: (78+10)/7 = 12.5714",
      near(await avg(p.id), expAvg, 0.0001),
      expAvg.toFixed(4),
      await avg(p.id),
    );

    // concurrent double-click of invoice confirm → delivered once
    const dup = await salesInvoice([{ p, qty: 1, price: 25 }], "Concurrent");
    ctx.ids.concurrentInvoice = dup.id;
    const [c1, c2] = await Promise.all([
      call("POST", `/sales/invoices/${dup.id}/confirm`),
      call("POST", `/sales/invoices/${dup.id}/confirm`),
    ]);
    const okCount = [c1, c2].filter((r) => r.ok).length;
    check(
      "concurrent confirm: at least one succeeds, the other is refused or a no-op",
      okCount >= 1,
      "≥1 OK",
      `${c1.s} / ${c2.s}`,
    );
    const dupMv = (await movements(`referenceId=${dup.id}`)).filter(
      (m) => m.type === "SALES_DELIVERY",
    );
    check(
      "concurrent confirm delivers once (1 movement, −1)",
      dupMv.length === 1 && dupMv[0].quantity === -1,
      "1 × −1",
      dupMv.map((m) => m.quantity).join(","),
    );
    const dupJe = await journals("SALES_INVOICE", dup.id);
    check(
      "concurrent confirm posts one journal",
      dupJe.filter((e) => e.status === "POSTED").length === 1,
      1,
      dupJe.length,
    );
    s = await stock(p.id);
    check("on-hand after concurrent confirm = 6", s.onHand === 6, 6, s.onHand);

    // one product record for purchase and sale
    const sameName = psql(
      `select count(*) from products where name = '${p.name.replace(/'/g, "''")}' and deleted_at is null`,
    )[0][0];
    const refs = psql(
      `select count(distinct product_id) from inventory_movements where reference_id in ('${pi.id}','${si.id}','${ret.id}','${dup.id}')`,
    )[0][0];
    check(
      "no second product record: purchase, sale and return reference the same product",
      sameName === "1" && refs === "1",
      "1 product",
      `named=${sameName} referenced=${refs}`,
    );
    const integ = await integrity([p.id]);
    check(
      "integrity I1–I3 PASS for the product",
      ["I1", "I2", "I3"].every((k) => integ.by[k].status === "PASS"),
      "PASS",
      ["I1", "I2", "I3"].map((k) => `${k}=${integ.by[k].status}`).join(" "),
    );
  });

  // ─── B: assemble and sell ─────────────────────────────────────────────────
  await section("B", async () => {
    const A = await product("Component A", { itemType: "PRODUCT", salesPrice: 30 });
    const B = await product("Component B", { itemType: "PRODUCT", salesPrice: 40 });
    const FG = await product("Assembled FG", {
      itemType: "PRODUCT",
      supplyMethod: "ASSEMBLED",
      salesPrice: 120,
    });
    Object.assign(ctx.ids, { compA: A.id, compB: B.id, assembled: FG.id });
    check(
      "ASSEMBLED product is stock-tracked",
      FG.isInventoryItem === true && FG.supplyMethod === "ASSEMBLED",
      "tracked ASSEMBLED",
      `${FG.isInventoryItem} ${FG.supplyMethod}`,
    );
    const rec = await must("POST", `/products/${FG.id}/recipes`, {
      outputQuantity: "1",
      directCostEstimate: "5",
      notes: `${TAG} recipe`,
      lines: [
        { componentProductId: A.id, quantity: "2", unitId: UNIT },
        { componentProductId: B.id, quantity: "1", unitId: UNIT },
      ],
    });
    check(
      "recipe created as DRAFT v1",
      rec.status === "DRAFT" && rec.version === 1,
      "DRAFT v1",
      `${rec.status} v${rec.version}`,
    );
    const act = await must("POST", `/recipes/${rec.id}/activate`);
    check("recipe activated", act.status === "ACTIVE", "ACTIVE", act.status);
    ctx.ids.recipeFG = rec.id;
    const pi = await purchaseInvoice(
      [
        { p: A, qty: 4, price: 10 },
        { p: B, qty: 2, price: 15 },
      ],
      "Components AB",
    );
    check(
      "components received at A=10, B=15",
      near(await avg(A.id), 10) && near(await avg(B.id), 15),
      "10 / 15",
      `${await avg(A.id)} / ${await avg(B.id)}`,
    );
    const est = await must("GET", `/products/${FG.id}/recipe-cost-estimate`);
    check(
      "recipe cost estimate = 2×10 + 1×15 + 5 = 40 (labelled estimate)",
      est.isEstimate === true && near(est.totalEstimate, 40),
      40,
      `${est.totalEstimate} isEstimate=${est.isEstimate}`,
    );
    const prev = await must(
      "GET",
      `/assembly/preview?productId=${FG.id}&warehouseId=${WH}&quantity=1`,
    );
    check(
      "preview: can assemble, max 2",
      prev.canAssemble === true && prev.maximumQuantity === 2,
      "true / 2",
      `${prev.canAssemble} / ${prev.maximumQuantity}`,
    );

    const key = `r13-${RUN}-asm-1`;
    const body = {
      productId: FG.id,
      warehouseId: WH,
      quantity: 1,
      directCost: "5",
      notes: `${TAG} assembly`,
    };
    const first = await call("POST", "/assembly", body, { headers: { "Idempotency-Key": key } });
    check(
      "assembly created (201)",
      first.s === 201,
      201,
      `${first.s} ${errText(first.s >= 300 ? first.j : null)}`,
    );
    const o = first.j;
    ctx.ids.assembly1 = o.id;
    const retry = await call("POST", "/assembly", body, { headers: { "Idempotency-Key": key } });
    check(
      "idempotent retry returns the same order (200)",
      retry.s === 200 && retry.j?.id === o.id,
      `200 ${o.assemblyNumber}`,
      `${retry.s} ${retry.j?.assemblyNumber}`,
    );
    check(
      "FG unit cost 40 (component 35 + direct 5)",
      near(o.unitCost, 40) && near(o.componentCost, 35) && near(o.totalCost, 40),
      "40",
      `unit ${o.unitCost} comp ${o.componentCost} total ${o.totalCost}`,
    );
    const [sA, sB, sF] = [await stock(A.id), await stock(B.id), await stock(FG.id)];
    check(
      "stock after assembly: A 2 (−2), B 1 (−1), FG 1 (+1) — retry did not double",
      sA.onHand === 2 && sB.onHand === 1 && sF.onHand === 1,
      "2/1/1",
      `${sA.onHand}/${sB.onHand}/${sF.onHand}`,
    );
    check("FG moving average 40", near(await avg(FG.id), 40), 40, await avg(FG.id));
    const asmMv = await movements(`referenceId=${o.id}`);
    check(
      "consumption + output movements (PRODUCTION_CONSUMPTION ×2, PRODUCTION_OUTPUT ×1)",
      asmMv.filter((m) => m.type === "PRODUCTION_CONSUMPTION").length === 2 &&
        asmMv.filter((m) => m.type === "PRODUCTION_OUTPUT").length === 1,
      "2 + 1",
      asmMv.map((m) => `${m.type}${m.quantity}`).join(","),
    );
    check(
      "consumption movements trace the recipe (recipeId / parentProductId)",
      asmMv
        .filter((m) => m.type === "PRODUCTION_CONSUMPTION")
        .every((m) => m.recipeId === rec.id || m.parentProductId === FG.id),
      "stamped",
      asmMv
        .map((m) => `${(m.recipeId ?? "-").slice(0, 8)}/${(m.parentProductId ?? "-").slice(0, 8)}`)
        .join(","),
    );
    const je = await journals("ASSEMBLY_ORDER", o.id);
    const lines = je.flatMap((e) => e.lines);
    const invCredits = lines
      .filter((l) => l.accountId === PS.inventoryAccountId && num(l.credit) > 0)
      .map((l) => r2(l.credit))
      .sort((a, b) => a - b);
    check(
      "journal Dr FG 40 / Cr A 20 / Cr B 15 / Cr assembly cost 5, balanced",
      balanced(je) &&
        near(lineSum(je, PS.inventoryAccountId, "debit"), 40) &&
        JSON.stringify(invCredits) === "[15,20]" &&
        near(lineSum(je, PS.assemblyCostAccountId, "credit"), 5),
      "40 / 20 / 15 / 5",
      `Dr INV ${lineSum(je, PS.inventoryAccountId, "debit")} Cr INV ${invCredits} Cr ASM ${lineSum(je, PS.assemblyCostAccountId, "credit")}`,
    );

    // second assembly → reverse
    const second = await must("POST", "/assembly", {
      productId: FG.id,
      warehouseId: WH,
      quantity: 1,
      directCost: "5",
      notes: `${TAG} assembly to reverse`,
    });
    ctx.ids.assembly2 = second.id;
    const rev = await must("POST", `/assembly/${second.id}/reverse`, {
      reason: `${TAG} reversal check`,
    });
    check("second assembly reversed", rev.status === "REVERSED", "REVERSED", rev.status);
    const [rA, rB, rF] = [await stock(A.id), await stock(B.id), await stock(FG.id)];
    check(
      "reversal restores stock: A 2, B 1, FG 1",
      rA.onHand === 2 && rB.onHand === 1 && rF.onHand === 1,
      "2/1/1",
      `${rA.onHand}/${rB.onHand}/${rF.onHand}`,
    );
    const je2 = await journals("ASSEMBLY_ORDER", second.id);
    const all2 = je2.flatMap((e) => e.lines);
    const net2 = r2(all2.reduce((s, l) => s + num(l.debit) - num(l.credit), 0));
    const invNet2 = netDr(je2, PS.inventoryAccountId) + netDr(je2, PS.assemblyCostAccountId);
    check(
      "reversed assembly journal nets to zero (original + engine reversal)",
      je2.length >= 2 && near(net2, 0) && near(invNet2, 0),
      "2 entries, net 0",
      `${je2.length} entries, INV+ASM net ${r2(invNet2)}`,
    );

    // insufficient stock names the component
    const short = await call("POST", "/assembly", {
      productId: FG.id,
      warehouseId: WH,
      quantity: 5,
    });
    check(
      "insufficient stock refused, message names the component",
      short.s === 422 &&
        short.j?.code === "ASSEMBLY_INSUFFICIENT_STOCK" &&
        String(short.j?.message).includes(A.sku),
      `422 ASSEMBLY_INSUFFICIENT_STOCK naming ${A.sku}`,
      `${short.s} ${short.j?.code} ${String(short.j?.message).slice(0, 140)}`,
    );

    // sell FG → COGS 40, components not costed again
    const si = await salesInvoice([{ p: FG, qty: 1, price: 120 }], "Sell FG");
    await must("POST", `/sales/invoices/${si.id}/confirm`);
    ctx.ids.salesInvoiceFG = si.id;
    const siFull = await must("GET", `/sales/invoices/${si.id}`);
    const jeS = await journals("SALES_INVOICE", si.id);
    check(
      "FG sale COGS = 40",
      near(siFull.items[0].unitCost, 40) && near(netDr(jeS, PS.costOfGoodsSoldAccountId), 40),
      40,
      `${siFull.items[0].unitCost} / ${netDr(jeS, PS.costOfGoodsSoldAccountId)}`,
    );
    const sMv = await movements(`referenceId=${si.id}`);
    check(
      "components NOT costed/moved again on the FG sale",
      sMv.length === 1 && sMv[0].productId === FG.id,
      "only FG −1",
      sMv.map((m) => `${m.product?.sku}${m.quantity}`).join(","),
    );
    const integ = await integrity([A.id, B.id, FG.id]);
    check(
      "integrity I4 PASS (assembly cost, consumption, journal)",
      integ.by.I4.status === "PASS" && integ.by.I4.checked >= 2,
      "PASS",
      `${integ.by.I4.status} checked=${integ.by.I4.checked} ${integ.by.I4.violations.map((v) => v.rule).join(",")}`,
    );
    void pi;
  });

  // ─── C: sell a kit ─────────────────────────────────────────────────────────
  await section("C", async () => {
    const C1 = await product("Kit Part 1", { itemType: "PRODUCT", salesPrice: 20 });
    const C2 = await product("Kit Part 2", { itemType: "PRODUCT", salesPrice: 10 });
    const K = await product("Gift Kit", {
      itemType: "PRODUCT",
      supplyMethod: "KIT",
      salesPrice: 60,
    });
    Object.assign(ctx.ids, { kitPart1: C1.id, kitPart2: C2.id, kit: K.id });
    check(
      "KIT holds no stock (isInventoryItem=false)",
      K.isInventoryItem === false && K.supplyMethod === "KIT",
      "false / KIT",
      `${K.isInventoryItem} / ${K.supplyMethod}`,
    );
    const forced = await call("POST", "/products", {
      name: `${TAG} Kit tracked ${RUN}`,
      categoryId: CAT,
      unitId: UNIT,
      supplyMethod: "KIT",
      isInventoryItem: true,
    });
    check(
      "KIT with track stock refused (PRODUCT_KIT_NOT_STOCKED)",
      forced.s === 422 && forced.j?.code === "PRODUCT_KIT_NOT_STOCKED",
      "422",
      `${forced.s} ${forced.j?.code}`,
    );
    const rec = await must("POST", `/products/${K.id}/recipes`, {
      outputQuantity: "1",
      lines: [
        { componentProductId: C1.id, quantity: "1", unitId: UNIT },
        { componentProductId: C2.id, quantity: "2", unitId: UNIT },
      ],
    });
    await must("POST", `/recipes/${rec.id}/activate`);
    ctx.ids.recipeKit = rec.id;
    await purchaseInvoice(
      [
        { p: C1, qty: 5, price: 8 },
        { p: C2, qty: 6, price: 3 },
      ],
      "Kit parts",
    );
    let av = await must("GET", `/products/${K.id}/kit-availability?warehouseId=${WH}`);
    check(
      "kit availability = min(5/1, 6/2) = 3, limited by part 2",
      av.available === 3 && av.limiting?.productId === C2.id,
      "3 (part 2)",
      `${av.available} (${av.limiting?.name})`,
    );

    const so = await must("POST", "/sales/orders", {
      partnerId: CUSTOMER,
      currencyId: SAR,
      referenceNumber: `${TAG} Kit SO ${RUN}`,
      items: [{ productId: K.id, warehouseId: WH, unitId: UNIT, quantity: 2, unitPrice: 60 }],
    });
    await must("POST", `/sales/orders/${so.id}/confirm`);
    ctx.ids.salesOrderKit = so.id;
    const [r1, r2s] = [await stock(C1.id), await stock(C2.id)];
    check(
      "order confirm reserves components: part1 2, part2 4",
      r1.reserved === 2 && r2s.reserved === 4,
      "2 / 4",
      `${r1.reserved} / ${r2s.reserved}`,
    );
    const resMv = (await movements(`referenceId=${so.id}`)).filter((m) => m.type === "RESERVATION");
    check(
      "reservations traced to the kit (parentProductId + recipeId)",
      resMv.length === 2 && resMv.every((m) => m.parentProductId === K.id && m.recipeId === rec.id),
      "2 stamped",
      resMv.map((m) => `${m.product?.sku}:${m.quantity}`).join(","),
    );
    av = await must("GET", `/products/${K.id}/kit-availability?warehouseId=${WH}`);
    check("kit availability after reservation = 1", av.available === 1, 1, av.available);

    const soFull = await must("GET", `/sales/orders/${so.id}`);
    const inv = await must("POST", `/sales/orders/${so.id}/convert-to-invoice`, {
      items: [{ salesOrderItemId: soFull.items[0].id, quantity: 2 }],
    });
    await must("POST", `/sales/invoices/${inv.id}/confirm`);
    const si = await must("GET", `/sales/invoices/${inv.id}`);
    ctx.ids.salesInvoiceKit = si.id;
    const dMv = await movements(`referenceId=${si.id}`);
    const del = dMv.filter((m) => m.type === "SALES_DELIVERY");
    check(
      "invoice delivers components only: part1 −2, part2 −4",
      del.length === 2 &&
        del.find((m) => m.productId === C1.id)?.quantity === -2 &&
        del.find((m) => m.productId === C2.id)?.quantity === -4,
      "−2 / −4",
      del.map((m) => `${m.product?.sku}${m.quantity}`).join(","),
    );
    check(
      "deliveries stamped parentProductId=kit and recipeId",
      del.every((m) => m.parentProductId === K.id && m.recipeId === rec.id),
      "stamped",
      "",
    );
    const kMv = await movements(`productId=${K.id}`);
    const kS = await stock(K.id);
    check(
      "no movement and no stock for the kit itself",
      kMv.length === 0 && kS.onHand === 0,
      "0 / 0",
      `${kMv.length} / ${kS.onHand}`,
    );
    const [d1, d2] = [await stock(C1.id), await stock(C2.id)];
    check(
      "components after delivery: part1 3 (0 reserved), part2 2 (0 reserved)",
      d1.onHand === 3 && d1.reserved === 0 && d2.onHand === 2 && d2.reserved === 0,
      "3/0 · 2/0",
      `${d1.onHand}/${d1.reserved} · ${d2.onHand}/${d2.reserved}`,
    );
    const line = si.items[0];
    check(
      "kit line unit cost = Σ components = 1×8 + 2×3 = 14, snapshot stored",
      near(line.unitCost, 14) &&
        line.fulfillmentSnapshot?.recipeId === rec.id &&
        line.fulfillmentSnapshot?.components?.length === 2,
      "14 + snapshot",
      `${line.unitCost} snapshot=${!!line.fulfillmentSnapshot}`,
    );
    const je = await journals("SALES_INVOICE", si.id);
    check(
      "COGS once = 2 × 14 = 28, Cr Inventory 28, balanced",
      balanced(je) &&
        near(netDr(je, PS.costOfGoodsSoldAccountId), 28) &&
        near(netDr(je, PS.inventoryAccountId), -28),
      28,
      `COGS ${netDr(je, PS.costOfGoodsSoldAccountId)} INV ${netDr(je, PS.inventoryAccountId)}`,
    );

    const ret = await salesReturn(si, [{ p: K, qty: 1 }], "Kit return");
    ctx.ids.salesReturnKit = ret.id;
    const rMv = (await movements(`referenceId=${ret.id}`)).filter((m) => m.type === "SALES_RETURN");
    check(
      "kit return returns components: part1 +1, part2 +2",
      rMv.length === 2 &&
        rMv.find((m) => m.productId === C1.id)?.quantity === 1 &&
        rMv.find((m) => m.productId === C2.id)?.quantity === 2,
      "+1 / +2",
      rMv.map((m) => `${m.product?.sku}+${m.quantity}`).join(","),
    );
    const jeR = await journals("SALES_RETURN", ret.id);
    check(
      "kit return at snapshot cost 14: Dr INV 14 / Cr COGS 14",
      balanced(jeR) &&
        near(netDr(jeR, PS.inventoryAccountId), 14) &&
        near(netDr(jeR, PS.costOfGoodsSoldAccountId), -14),
      14,
      `INV ${netDr(jeR, PS.inventoryAccountId)} COGS ${netDr(jeR, PS.costOfGoodsSoldAccountId)}`,
    );
    const integ = await integrity([K.id, C1.id, C2.id]);
    check(
      "integrity I5 PASS (kit deliveries + COGS once)",
      integ.by.I5.status === "PASS" && integ.by.I5.checked >= 1,
      "PASS",
      `${integ.by.I5.status} checked=${integ.by.I5.checked} ${integ.by.I5.violations.map((v) => v.rule).join(",")}`,
    );
  });

  // ─── D: sell a service / course ───────────────────────────────────────────
  await section("D", async () => {
    const S = await product("Online Course", { itemType: "SERVICE", salesPrice: 500 });
    ctx.ids.service = S.id;
    check(
      "SERVICE: not tracked, sell-only, PURCHASED",
      S.isInventoryItem === false &&
        S.isSellable === true &&
        S.isPurchasable === false &&
        S.supplyMethod === "PURCHASED",
      "false/true/false",
      `${S.isInventoryItem}/${S.isSellable}/${S.isPurchasable}/${S.supplyMethod}`,
    );
    const bad = await call("PATCH", `/products/${S.id}`, { isInventoryItem: true });
    check(
      "tracking a SERVICE refused (PRODUCT_SERVICE_RULE)",
      bad.s === 422 && bad.j?.code === "PRODUCT_SERVICE_RULE",
      "422",
      `${bad.s} ${bad.j?.code}`,
    );
    const si = await salesInvoice([{ p: S, qty: 1, price: 500 }], "Course sale");
    await must("POST", `/sales/invoices/${si.id}/confirm`);
    ctx.ids.salesInvoiceService = si.id;
    const mv = await movements(`referenceId=${si.id}`);
    check("zero inventory movements", mv.length === 0, 0, mv.length);
    const je = await journals("SALES_INVOICE", si.id);
    check(
      "zero COGS / inventory lines",
      near(lineSum(je, PS.costOfGoodsSoldAccountId, "debit"), 0) &&
        near(lineSum(je, PS.inventoryAccountId, "credit"), 0),
      "0",
      `COGS ${lineSum(je, PS.costOfGoodsSoldAccountId, "debit")}`,
    );
    check(
      "revenue 500 posted (Dr AR 500 / Cr revenue 500), balanced",
      balanced(je) &&
        near(-netDr(je, PS.salesRevenueAccountId), 500) &&
        near(netDr(je, PS.accountsReceivableAccountId), 500),
      500,
      `REV ${-netDr(je, PS.salesRevenueAccountId)} AR ${netDr(je, PS.accountsReceivableAccountId)}`,
    );
  });

  // ─── E: agent-owned product ───────────────────────────────────────────────
  let agentProduct = null;
  await section("E", async () => {
    const agentTok = await login("agent-a-admin.demo-agt@oms.local");
    const me = await must("GET", "/agent-portal/me", null, { token: agentTok });
    const agentId = me.agent?.id;
    ctx.ids.agentId = agentId;
    const rate =
      me.agreement?.shippingRates?.find((r) => !r.city) ?? me.agreement?.shippingRates?.[0];
    check(
      "demo agent A has an active agreement with a shipping rate",
      !!me.agreement && !!rate,
      "agreement + rate",
      `${me.agreement?.agreementNumber} ${rate?.country?.code} ${rate?.amount}`,
    );
    const P = await product("Agent Item", {
      itemType: "PRODUCT",
      ownerAgentId: agentId,
      salesPrice: 200,
    });
    agentProduct = P;
    ctx.ids.agentProduct = P.id;
    check(
      "product created owned by the agent",
      P.ownerAgentId === agentId,
      agentId,
      P.ownerAgentId,
    );
    const ob = await must("POST", "/inventory/opening-balance", {
      productId: P.id,
      warehouseId: WH,
      quantity: 5,
      unitCost: 50,
      notes: `${TAG} agent stock`,
    });
    check(
      "agent stock received (movement owner = agent)",
      ob.ownerAgentId === agentId && ob.quantity === 5,
      "owner agent, +5",
      `${ob.ownerAgentId?.slice(0, 8)} +${ob.quantity}`,
    );
    const obJe = psql(`select count(*) from journal_entries where source_id = '${ob.id}'`)[0][0];
    check("no company journal for the agent stock receipt", obJe === "0", 0, obJe);
    const compCards = await must("GET", "/inventory/stock-cards?owner=COMPANY");
    const agCards = await must("GET", "/inventory/stock-cards?owner=AGENT");
    check(
      "company valuation (owner=COMPANY) excludes the agent item; owner=AGENT shows it",
      !items(compCards).some((c) => c.productId === P.id) &&
        items(agCards).some((c) => c.productId === P.id && c.ownerAgentId === agentId),
      "excluded / included",
      `${items(compCards).some((c) => c.productId === P.id)} / ${items(agCards).some((c) => c.productId === P.id)}`,
    );

    const portalProducts = await must(
      "GET",
      `/agent-portal/products?search=${encodeURIComponent(P.sku)}&pageSize=10`,
      null,
      { token: agentTok },
    );
    const pj = JSON.stringify(portalProducts);
    check(
      "agent portal product list shows the item without any cost field",
      items(portalProducts).some((x) => x.id === P.id) &&
        !/currentCost|averageCost|unitCost|lastCost|stockValue/.test(pj),
      "listed, no cost",
      `listed=${items(portalProducts).some((x) => x.id === P.id)}`,
    );

    const order = await must(
      "POST",
      "/agent-portal/orders",
      {
        pricingMode: "SHIPPING_ADDED",
        lines: [{ productId: P.id, quantity: 1, lineAmount: 200 }],
        fulfillmentMethod: "SHIPPING",
        paymentType: "CASH_ON_DELIVERY",
        countryId: rate.country.id,
        city: rate.city ?? "City",
        address: `${TAG} address ${RUN}`,
        customer: {
          name: `${TAG} Agent customer ${RUN}`,
          mobile: `+2010${String(Date.now()).slice(-8)}`,
          countryId: rate.country.id,
          city: "City",
          address: `${TAG} street`,
        },
        notes: `${TAG} agent order`,
      },
      { token: agentTok, headers: { "Idempotency-Key": `r13-${RUN}-agent-order` } },
    );
    ctx.ids.agentOrder = order.id;
    check(
      "agent order created through the agent API",
      !!order.id && order.lines?.length === 1,
      "created",
      order.internalOrderId,
    );
    const oj = JSON.stringify(order);
    check(
      "agent order response exposes no cost",
      !/currentCost|averageCost|unitCost|cogs/i.test(oj),
      "no cost",
      "",
    );

    let shipped = await call("POST", `/store-orders/${order.id}/shipments/ship`);
    if (!shipped.ok) {
      await call("POST", `/store-orders/${order.id}/shipments/label`, {
        fileUrl: `https://example.invalid/${RUN}-label.pdf`,
        fileName: `${RUN}-label.pdf`,
      });
      shipped = await call("POST", `/store-orders/${order.id}/shipments/ship`);
    }
    check(
      "internal fulfillment dispatches the agent order (ship)",
      shipped.ok,
      "200",
      `${shipped.s} ${shipped.ok ? "" : errText(shipped.j)}`,
    );
    const out = await call("POST", `/store-orders/${order.id}/shipments/out-for-delivery`);
    const dl = await call("POST", `/store-orders/${order.id}/shipments/deliver`);
    check("agent order delivered", dl.ok, "200", `${out.s}/${dl.s} ${dl.ok ? "" : errText(dl.j)}`);
    const s = await stock(P.id);
    check(
      "agent stock issued on dispatch: 5 → 4",
      s.onHand === 4 && s.ownerAgentId === agentId,
      4,
      s.onHand,
    );
    const mv = (await movements(`productId=${P.id}`)).filter((m) => m.type === "SALES_DELIVERY");
    check(
      "delivery movement carries the agent as owner",
      mv.length === 1 && mv[0].ownerAgentId === agentId,
      "1, owner agent",
      mv.map((m) => `${m.quantity}:${m.ownerAgentId?.slice(0, 8)}`).join(","),
    );

    const ledger = items(
      await must(
        "GET",
        `/agent-finance/agents/${agentId}/ledger?storeOrderId=${order.id}&pageSize=100`,
      ),
    );
    const types = ledger.map((e) => e.entryType);
    const commission = r2(
      ledger.filter((e) => e.entryType === "COMMISSION").reduce((t, e) => t + num(e.debit), 0),
    );
    const expectedRate = Number(
      me.agreement.productCommissionRatePercent ?? me.agreement.commissionRatePercent,
    );
    check(
      `commission line per policy (${expectedRate}% of 200)`,
      near(commission, r2((200 * expectedRate) / 100)),
      r2((200 * expectedRate) / 100),
      `${commission} [${types.join(",")}]`,
    );
    check(
      "shipping fee line per policy (flat fee per shipment)",
      me.agreement.shippingPolicy !== "FLAT_FEE_PER_SHIPMENT" || types.includes("SHIPPING_FEE"),
      "SHIPPING_FEE",
      types.join(","),
    );
    const st = await must("GET", `/agent-portal/statement?from=${TODAY}&to=${TODAY}`, null, {
      token: agentTok,
    });
    const stLines = (st.lines ?? []).filter(
      (l) =>
        l.references?.storeOrderId === order.id ||
        l.references?.orderNumber === order.internalOrderId,
    );
    check(
      "agent statement (portal) shows the order's lines",
      stLines.length >= 1,
      "≥1",
      `${stLines.length} lines: ${stLines.map((l) => l.entryType).join(",")}`,
    );
    check(
      "agent statement never exposes cost",
      !/currentCost|averageCost|unitCost|cogs/i.test(JSON.stringify(st)),
      "no cost",
      "",
    );

    const refIds = [order.id, ...mv.map((m) => m.id), ob.id].map((x) => `'${x}'`).join(",");
    const glInv = psql(
      `select count(*) from journal_entry_lines l join journal_entries e on e.id=l.journal_entry_id where e.source_id in (${refIds}) and l.account_id in ('${PS.inventoryAccountId}','${PS.costOfGoodsSoldAccountId}')`,
    )[0][0];
    const invoices = psql(
      `select count(*) from sales_invoices where store_order_id='${order.id}'`,
    )[0][0];
    check(
      "NO company GL inventory/COGS posting and no company invoice for the agent goods",
      glInv === "0" && invoices === "0",
      "0 / 0",
      `${glInv} / ${invoices}`,
    );
    const integ = await integrity([P.id]);
    check(
      "integrity I7 PASS (agent stock outside company books)",
      integ.by.I7.status === "PASS",
      "PASS",
      `${integ.by.I7.status} ${integ.by.I7.violations.map((v) => v.rule).join(",")}`,
    );
  });

  // ─── F: investor-eligible product ─────────────────────────────────────────
  await section("F", async () => {
    const P = await product("Investable Item", { itemType: "PRODUCT", salesPrice: 50 });
    ctx.ids.investProduct = P.id;
    await purchaseInvoice([{ p: P, qty: 5, price: 20 }], "Investable stock");
    const on = await call("PATCH", `/products/${P.id}`, {
      availableForInvestmentOpportunities: true,
    });
    check(
      "company PRODUCT, sellable, ACTIVE → eligibility enabled",
      on.ok && on.j?.availableForInvestmentOpportunities === true,
      "200 true",
      `${on.s} ${on.j?.availableForInvestmentOpportunities}`,
    );
    if (agentProduct) {
      const ag = await call("PATCH", `/products/${agentProduct.id}`, {
        availableForInvestmentOpportunities: true,
      });
      check(
        "agent-owned product refused: 422 PRODUCT_INVESTMENT_NOT_ALLOWED reason AGENT_OWNED",
        ag.s === 422 &&
          ag.j?.code === "PRODUCT_INVESTMENT_NOT_ALLOWED" &&
          ag.j?.reason === "AGENT_OWNED",
        "422 AGENT_OWNED",
        `${ag.s} ${ag.j?.code} ${ag.j?.reason}`,
      );
    }
    if (ctx.ids.service) {
      const sv = await call("PATCH", `/products/${ctx.ids.service}`, {
        availableForInvestmentOpportunities: true,
      });
      check(
        "service product refused: reason SERVICE",
        sv.s === 422 &&
          sv.j?.code === "PRODUCT_INVESTMENT_NOT_ALLOWED" &&
          sv.j?.reason === "SERVICE",
        "422 SERVICE",
        `${sv.s} ${sv.j?.code} ${sv.j?.reason}`,
      );
    }
    const inv = await must("POST", "/investors", {
      name: `${TAG} Investor ${RUN}`,
      entityType: "PERSON",
      phone: `+9665${String(Date.now()).slice(-8)}`,
      notes: `${TAG} demo`,
    });
    const start = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const opp = await must("POST", "/investment-opportunities", {
      nameAr: `${TAG} فرصة ${RUN}`,
      nameEn: `${TAG} Opportunity ${RUN}`,
      currencyId: SAR,
      startDate: start,
      endDate: end,
      investorNetProfitSharePercent: 40,
      products: [{ productId: P.id, fundedUnits: 2, fundedUnitCost: 20 }],
    });
    ctx.ids.opportunity = opp.id;
    check("opportunity created with the eligible product", !!opp.id, "created", opp.code);
    const links = await must("GET", `/products/${P.id}/investment-links`);
    check(
      "product investment-links shows the opportunity",
      links.eligible === true && (links.opportunities ?? []).some((o) => o.id === opp.id),
      "eligible + linked",
      `${links.eligible} ${(links.opportunities ?? []).map((o) => o.code).join(",")}`,
    );

    // lifecycle: open → subscribe → fund → activate → delivered sale → allocation
    const steps = [];
    let ok = true;
    const tryStep = async (label, fn) => {
      if (!ok) return null;
      try {
        const r = await fn();
        steps.push(`${label}✓`);
        return r;
      } catch (e) {
        ok = false;
        steps.push(`${label}✗(${e.message.slice(0, 160)})`);
        return null;
      }
    };
    await tryStep("open", () => must("POST", `/investment-opportunities/${opp.id}/open`));
    const sub = await tryStep("subscribe", () =>
      must("POST", "/investor-subscriptions", {
        investorId: inv.id,
        opportunityId: opp.id,
        committedAmount: 40,
      }),
    );
    const cc = await tryStep("contribute", () =>
      must("POST", "/capital-contributions", {
        subscriptionId: sub.id,
        amount: 40,
        contributionDate: TODAY,
        financialAccountId: PS.bankAccountId ?? undefined,
        referenceNumber: `${TAG} CC ${RUN}`,
      }),
    );
    await tryStep("confirm-funding", () => must("POST", `/capital-contributions/${cc.id}/confirm`));
    await tryStep("activate", () => must("POST", `/investment-opportunities/${opp.id}/activate`));
    const ras = items(await must("GET", "/receiving-accounts")).filter(
      (a) => a.isActive !== false && (!a.currencyId || a.currencyId === SAR),
    );
    const srcs = items(await must("GET", "/payment-sources?pageSize=50")).filter(
      (x) => x.isActive !== false,
    );
    const so = await tryStep("store-order", () =>
      must("POST", "/store-orders", {
        partner: {
          name: `${TAG} Investor-sale customer ${RUN}`,
          phone: `+9665${String(Date.now() + 7).slice(-8)}`,
        },
        currencyId: SAR,
        paymentType: "PREPAID",
        notes: `${TAG} investor sale`,
        items: [{ productId: P.id, quantity: 1, unitPrice: 50 }],
      }),
    );
    if (so) ctx.ids.investorStoreOrder = so.id;
    const pay = await tryStep("payment", () =>
      must("POST", `/store-orders/${so.id}/payments`, {
        paymentDate: TODAY,
        amount: 50,
        currencyId: SAR,
        paymentSourceId: (srcs.find((x) => x.isDefault) ?? srcs[0])?.id,
        receivingAccountId: (ras.find((a) => a.isDefault) ?? ras[0])?.id,
        senderName: `${TAG} Investor-sale customer ${RUN}`,
        referenceNumber: `${TAG} PAY ${RUN}`,
      }),
    );
    await tryStep("payment-confirm", () =>
      must("POST", `/payments/${(pay.payment ?? pay).id}/confirm`),
    );
    const gi = await tryStep("generate-invoice", () =>
      must("POST", `/store-orders/${so.id}/generate-invoice`),
    );
    if (gi) ctx.ids.investorInvoice = gi.id;
    for (const st of ["ship", "out-for-delivery", "deliver"])
      await tryStep(st, () => must("POST", `/store-orders/${so.id}/shipments/${st}`));
    const alloc = await tryStep("allocate", () =>
      must("POST", `/investment-sales/allocate/${so.id}`),
    );
    check(
      "lifecycle open → fund → activate → delivered sale → allocation",
      ok && alloc?.unitsAllocated === 1,
      "all steps, 1 unit allocated",
      `${steps.join(" ")} units=${alloc?.unitsAllocated}`,
    );

    const snap = () =>
      JSON.stringify(
        psql(
          `select id, allocated_quantity, allocated_revenue, status, opportunity_product_id from opportunity_sale_allocations where opportunity_id='${opp.id}' order by id`,
        ),
      );
    const before = snap();
    const allCount = psql(
      "select count(*), coalesce(sum(allocated_quantity),0) from opportunity_sale_allocations",
    )[0].join("/");
    const off = await call("PATCH", `/products/${P.id}`, {
      availableForInvestmentOpportunities: false,
    });
    const linksOff = await must("GET", `/products/${P.id}/investment-links`);
    const mid = snap();
    const on2 = await call("PATCH", `/products/${P.id}`, {
      availableForInvestmentOpportunities: true,
    });
    const after = snap();
    const allCount2 = psql(
      "select count(*), coalesce(sum(allocated_quantity),0) from opportunity_sale_allocations",
    )[0].join("/");
    check(
      "disabling eligibility: allowed, product no longer eligible, link kept",
      off.ok &&
        linksOff.eligible === false &&
        (linksOff.opportunities ?? []).some((o) => o.id === opp.id),
      "200, eligible=false, linked",
      `${off.s} eligible=${linksOff.eligible}`,
    );
    check(
      "enabling/disabling eligibility creates or rewrites no allocation",
      on2.ok && before === mid && mid === after && allCount === allCount2 && before !== "[]",
      "identical",
      `${JSON.parse(before).length} row(s); global ${allCount} → ${allCount2}`,
    );
  });

  // ─── X: cross-cutting rules ───────────────────────────────────────────────
  await section("X", async () => {
    const base = await product("Steel Water Bottle", {
      itemType: "PRODUCT",
      barcode: `R13${RUN}BC`,
    });
    ctx.ids.similarBase = base.id;
    const near1 = `${TAG} Steel Water Botle ${RUN}`;
    const sim = await must("GET", `/products/similar-names?name=${encodeURIComponent(near1)}`);
    const hit = (sim.items ?? []).find((i) => i.id === base.id);
    check(
      "similar-name warning lists the near-duplicate",
      !!hit,
      "listed",
      hit ? `${hit.sku} ${hit.match}` : JSON.stringify(sim).slice(0, 160),
    );
    const dupName = await call("POST", "/products", {
      name: near1,
      categoryId: CAT,
      unitId: UNIT,
      status: "ACTIVE",
    });
    check("near-duplicate name is non-blocking (created)", dupName.s === 201, 201, dupName.s);
    ctx.ids.similarDup = dupName.j?.id;
    const bc = await call("POST", "/products", {
      name: `${TAG} Barcode clash ${RUN}`,
      categoryId: CAT,
      unitId: UNIT,
      barcode: ` r13${RUN.toLowerCase()}bc `,
    });
    check(
      "barcode duplicate (case/space-insensitive) → 409 naming the other product",
      bc.s === 409 && bc.j?.code === "PRODUCT_BARCODE_DUPLICATE" && bc.j?.productId === base.id,
      `409 → ${base.sku}`,
      `${bc.s} ${bc.j?.code} ${bc.j?.sku}`,
    );
    ctx.ids.barcode = `R13${RUN}BC`;

    const X1 = await product("Cycle X", { itemType: "PRODUCT", supplyMethod: "ASSEMBLED" });
    const Y1 = await product("Cycle Y", { itemType: "PRODUCT", supplyMethod: "ASSEMBLED" });
    const rx = await must("POST", `/products/${X1.id}/recipes`, {
      lines: [{ componentProductId: Y1.id, quantity: "1", unitId: UNIT }],
    });
    await must("POST", `/recipes/${rx.id}/activate`);
    const ry = await must("POST", `/products/${Y1.id}/recipes`, {
      lines: [{ componentProductId: X1.id, quantity: "1", unitId: UNIT }],
    });
    const cyc = await call("POST", `/recipes/${ry.id}/activate`);
    check(
      "recipe cycle refused (RECIPE_CYCLE, names the path)",
      cyc.s === 422 && cyc.j?.code === "RECIPE_CYCLE" && Array.isArray(cyc.j?.path),
      "422 RECIPE_CYCLE",
      `${cyc.s} ${cyc.j?.code} ${String(cyc.j?.message).slice(0, 120)}`,
    );

    if (agentProduct) {
      const M = await product("Mixed Owner Kit", { itemType: "PRODUCT", supplyMethod: "KIT" });
      const rm = await must("POST", `/products/${M.id}/recipes`, {
        lines: [
          { componentProductId: agentProduct.id, quantity: "1", unitId: UNIT },
          { componentProductId: ctx.ids.kitPart1, quantity: "1", unitId: UNIT },
        ],
      });
      const mix = await call("POST", `/recipes/${rm.id}/activate`);
      check(
        "mixed-owner recipe refused (RECIPE_OWNER_MIXED)",
        mix.s === 422 && mix.j?.code === "RECIPE_OWNER_MIXED",
        "422 RECIPE_OWNER_MIXED",
        `${mix.s} ${mix.j?.code}`,
      );
    }
  });

  // ─── I: integrity on the whole DB (API + CLI) ─────────────────────────────
  await section("INTEGRITY", async () => {
    const { rep, by } = await integrity();
    writeFileSync(`${OUT}/integrity-api-${DB}.json`, JSON.stringify(rep, null, 2));
    const passIds = ["I1", "I2", "I3", "I4", "I5", "I7"];
    for (const k of passIds)
      check(
        `GET /inventory/integrity (whole DB): ${k} ${by[k].title} PASS`,
        by[k].status === "PASS",
        "PASS",
        `${by[k].status} checked=${by[k].checked} violations=${by[k].violationCount}`,
      );
    check(
      "GET /inventory/integrity (whole DB): I6 valuation vs GL is WARN only (pre-existing difference)",
      by.I6.status === "WARN",
      "WARN",
      `${by.I6.status} ${JSON.stringify(by.I6.metrics).slice(0, 300)}`,
    );
    ctx.integrityI6 = by.I6.metrics;
    if (process.env.R13_SKIP_CLI === "1") return;
    const json = `${OUT}/integrity-cli-${DB}.json`;
    const md = `${OUT}/integrity-cli-${DB}.md`;
    let code = 0;
    try {
      execSync(
        `pnpm --dir apps/api exec ts-node scripts/r13/r13-integrity.ts --json=${json} --out=${md} --fail-on=FAIL --quiet`,
        {
          cwd: ROOT,
          env: { ...process.env, DATABASE_URL: `postgresql://oms:oms@localhost:5434/${DB}` },
          stdio: ["ignore", "ignore", "pipe"],
          timeout: 300000,
        },
      );
    } catch (e) {
      code = e.status ?? 2;
    }
    const cli = existsSync(json) ? JSON.parse(readFileSync(json, "utf8")) : null;
    const cby = Object.fromEntries((cli?.invariants ?? []).map((i) => [i.id, i.status]));
    check(
      "CLI r13-integrity.ts (whole DB): I1–I5, I7 PASS, I6 WARN, exit 0",
      code === 0 && passIds.every((k) => cby[k] === "PASS") && cby.I6 === "WARN",
      "PASS×6 + WARN",
      `exit ${code} ${Object.entries(cby)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")}`,
    );
  });

  // ─── output ───────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  const byJourney = {};
  for (const r of results) {
    byJourney[r.journey] ??= { pass: 0, fail: 0 };
    byJourney[r.journey][r.ok ? "pass" : "fail"]++;
  }
  const meta = {
    generatedAt: new Date().toISOString(),
    run: RUN,
    api: API,
    db: DB,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    byJourney,
  };
  writeFileSync(`${OUT}/r13-journeys.json`, JSON.stringify({ ...meta, results }, null, 2));
  writeFileSync(`${OUT}/r13-journeys-context.json`, JSON.stringify(ctx, null, 2));
  const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const md = [
    `# R13 API journeys — run ${RUN}`,
    "",
    `Generated ${meta.generatedAt} against ${API} (database \`${DB}\`). **${meta.passed}/${meta.total} PASS**, ${meta.failed} FAIL.`,
    "",
    "| Journey | PASS | FAIL |",
    "| --- | ---: | ---: |",
    ...Object.entries(byJourney).map(([k, v]) => `| ${k} | ${v.pass} | ${v.fail} |`),
    "",
    "| Journey | Check | Expected | Observed | Result |",
    "| --- | --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.journey} | ${esc(r.name)} | ${esc(r.expected)} | ${esc(r.observed)} | ${r.ok ? "PASS" : "**FAIL**"} |`,
    ),
    "",
  ].join("\n");
  writeFileSync(`${OUT}/r13-journeys.md`, md);
  console.log(`\n${meta.passed}/${meta.total} passed (${meta.failed} failed) — evidence in ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(2);
});
