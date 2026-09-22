#!/usr/bin/env node
/**
 * Acceptance tour — Investor Engine lifecycle, API-driven and API-verified.
 *
 *   # local
 *   BASE=http://localhost:3001 EMAIL=admin@oms.local PW=... node scripts/acceptance/investor-tour.mjs
 *   # production (password from tmp/.qa.env QA_PASSWORD)
 *   BASE=https://oms.haseb.org node scripts/acceptance/investor-tour.mjs
 *
 * Flow: RUN-tagged investment-eligible inventory product (+ opening stock/cost)
 * → ineligible product rejected by the Opportunity guard → investors →
 * opportunity (open) → subscriptions → capital contributions (confirm, JE)
 * → activate → real store orders for the product (paid, invoiced, delivered)
 * → per-order investment-sales allocation → approved expense → profit
 * estimate/snapshot/approve → distribution approve (JE) → payments confirm (JE)
 * → investor ledger/summary screens. Every expected amount is derived from the
 * records the API returned (order lines, funded unit cost, approved expenses,
 * configured share %) — never assumed.
 *
 * Safety: creates RUN-tagged records only, never deletes, never edits
 * non-demo records. The global "recalculate" allocation pass touches every
 * delivered order in the system, so it only runs when ALLOW_GLOBAL_RECALC=1.
 *
 * Output: tmp/acceptance/<RUN>/investor-tour-report.json and
 *         tmp/acceptance/<RUN>/demo-record-index.investors.json
 */
import {
  RUN,
  BASE,
  apiClient,
  appendIndex,
  createReport,
  errText,
  items,
  login,
  near,
  round2,
  today,
  webRouteFile,
} from "./_tour-lib.mjs";

const { report, check, assert, finish } = createReport("investor-tour");
const records = [];
const expected = {};
report.expected = expected;
report.records = records;

let api;

function addRecord(type, row, webPath, extra = {}) {
  if (!row?.id) return;
  const routeFile = webPath ? webRouteFile(webPath) : null;
  records.push({
    run: RUN,
    type,
    id: row.id,
    number: row.code ?? row.sku ?? row.internalOrderId ?? row.invoiceNumber ?? row.entryNumber ?? row.paymentNumber ?? null,
    name: row.name ?? row.nameAr ?? row.displayName ?? null,
    webUrl: webPath ? `${BASE}${webPath}` : null,
    webRouteVerified: webPath ? Boolean(routeFile) : null,
    ...extra,
  });
  if (webPath && !routeFile) check(`web route exists for ${type}`, "FAIL", `${webPath} has no page.tsx`);
}

async function jesForSource(sourceType, sourceId) {
  const r = await api("GET", `/journal-entries?pageSize=50&sourceType=${sourceType}&sourceId=${sourceId}`);
  return items(r.json).filter((je) => je.sourceType === sourceType && je.sourceId === sourceId && !je.reversalOfEntryId);
}

async function waitForJe(sourceType, sourceId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await jesForSource(sourceType, sourceId);
    if (found.length) return found[0];
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

/** Fetch a JE, assert balanced + POSTED, return summary for the index. */
async function verifyJe(label, sourceType, sourceId, expectAmount) {
  const je = await waitForJe(sourceType, sourceId);
  if (!je) {
    check(`${label}: journal entry posted`, "FAIL", `no ${sourceType} JE for ${sourceId}`);
    return null;
  }
  const full = (await api("GET", `/journal-entries/${je.id}`)).json ?? {};
  const lines = full.lines ?? [];
  const dr = round2(lines.reduce((s, l) => s + Number(l.debit), 0));
  const cr = round2(lines.reduce((s, l) => s + Number(l.credit), 0));
  const ok = near(dr, cr) && dr > 0 && full.status === "POSTED" && (expectAmount == null || near(dr, expectAmount));
  assert(
    `${label}: JE ${full.entryNumber} balanced/POSTED${expectAmount != null ? ` = ${expectAmount}` : ""}`,
    ok,
    `Dr ${dr} Cr ${cr} status=${full.status}`,
    lines.map((l) => `${l.account?.code ?? ""} ${l.account?.name ?? l.accountId} Dr ${l.debit} Cr ${l.credit}`),
  );
  addRecord("JournalEntry", { id: full.id, entryNumber: full.entryNumber }, `/finance/journal-entries/${full.id}`, {
    sourceType,
    sourceId,
    expectedAmount: expectAmount ?? dr,
  });
  return full;
}

/** Run a step; on unexpected error record FAIL and keep going. */
async function step(id, fn) {
  try {
    return await fn();
  } catch (error) {
    check(id, "FAIL", error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

async function main() {
  let token;
  try {
    token = await login();
  } catch (error) {
    check("login", "BLOCKED", error.message);
    return;
  }
  api = apiClient(token);
  check("login", "PASS", report.user);
  const me = (await api("GET", "/auth/me")).json;

  // ------------------------------------------------------------- master data
  const currencies = items((await api("GET", "/currencies?pageSize=200")).json);
  // Demo documents are in the company base (functional) currency — never a guessed one.
  const baseCurrencyId = (await api("GET", "/accounting/posting-settings")).json?.functionalCurrencyId;
  if (!baseCurrencyId) {
    check("base currency configured", "BLOCKED", "posting settings have no functionalCurrencyId");
    return;
  }
  const currency = currencies.find((c) => c.id === baseCurrencyId);
  const categories = items((await api("GET", "/product-categories?pageSize=100")).json).filter((c) => !c.deletedAt);
  const category = categories.find((c) => !/test|lookup|perm|qa|e2e|fx /i.test(c.name)) ?? categories[0];
  const units = items((await api("GET", "/units?pageSize=100")).json).filter((u) => !u.deletedAt);
  const unit = units.find((u) => !/test|lookup|perm|qa|e2e/i.test(u.name)) ?? units[0];
  const warehouses = items((await api("GET", "/warehouses?pageSize=100")).json).filter((w) => w.isActive !== false && !w.deletedAt);
  const warehouse = warehouses.find((w) => w.isDefault) ?? warehouses.find((w) => !/damag/i.test(w.name)) ?? warehouses[0];
  const receiving = items((await api("GET", "/receiving-accounts")).json).filter(
    (a) => a.isActive !== false && (!a.currencyId || a.currencyId === currency?.id) && !/test/i.test(a.name ?? ""),
  );
  const receivingAccount = receiving.find((a) => a.isDefault) ?? receiving[0];
  const sources = items((await api("GET", "/payment-sources?pageSize=50")).json).filter((s) => s.isActive !== false);
  const paymentSource = sources.find((s) => s.isDefault) ?? sources[0];
  const md = { currency: currency?.code, category: category?.name, unit: unit?.name, warehouse: warehouse?.name, receivingAccount: receivingAccount?.name, paymentSource: paymentSource?.name };
  const byName = [...warehouses].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))[0];
  if (warehouses.some((w) => w.isDefault) && byName && !byName.isDefault) {
    check(
      "store-order invoice default warehouse = Warehouse.isDefault",
      "INFO",
      `products without a preferred warehouse deliver from "${byName.name}" (first active by name), not the default "${warehouse.name}" — store-orders.service generateInvoice rule 7`,
    );
  }
  if (!(currency && category && unit && warehouse)) {
    check("master data available", "BLOCKED", JSON.stringify(md));
    return;
  }
  check("master data available", "PASS", JSON.stringify(md));

  // Investment accounting settings — the posting provider requires these.
  const acct = (await api("GET", "/investment-accounting-settings")).json ?? {};
  const posting = (await api("GET", "/accounting/posting-settings")).json ?? {};
  const requiredAccounts = {
    "PostingSettings.bankAccountId": posting.bankAccountId ?? acct.bankAccountId,
    "PostingSettings.investorFundingAccountId": acct.investorFundingAccountId ?? posting.investorFundingAccountId,
    "PostingSettings.investorProfitDistributionAccountId":
      acct.investorProfitDistributionAccountId ?? posting.investorProfitDistributionAccountId,
    "PostingSettings.investorProfitPayableAccountId": acct.investorProfitPayableAccountId ?? posting.investorProfitPayableAccountId,
  };
  const missingAccounts = Object.entries(requiredAccounts).filter(([, v]) => !v).map(([k]) => k);
  check(
    "investment accounting settings configured",
    missingAccounts.length ? "BLOCKED" : "PASS",
    missingAccounts.length ? `missing: ${missingAccounts.join(", ")} (Investors → Settings → Accounting)` : "funding/distribution/payable/bank mapped",
  );
  const bankAccountId = requiredAccounts["PostingSettings.bankAccountId"];

  // ------------------------------------------------------------- products
  const FUNDED_UNITS = 10;
  const FUNDED_UNIT_COST = 100;
  const OPENING_QTY = 20;
  const OPENING_COST = 100;
  const productBody = (suffix, flag) => ({
    name: `${RUN} ${suffix}`,
    nameEn: `${RUN} ${suffix}`,
    internalName: `${RUN} ${suffix}`,
    displayName: `${RUN} ${suffix}`,
    categoryId: category.id,
    unitId: unit.id,
    type: "PURCHASE_AND_SALE",
    status: "ACTIVE",
    isInventoryItem: true,
    isSellable: true,
    isPurchasable: true,
    availableForInvestmentOpportunities: flag,
    salesPrice: 300,
    purchasePrice: OPENING_COST,
    weight: 1,
    width: 10,
    height: 10,
    length: 10,
    // Invoice delivery warehouse: Product.preferredWarehouseId, else the
    // first active warehouse by NAME (not Warehouse.isDefault) — pin it.
    preferredWarehouseId: warehouse.id,
    internalNotes: `${RUN} acceptance demo`,
  });

  const product = await step("create eligible product", async () => {
    const created = await api.must("POST", "/products", productBody("Investment Product", true));
    const fresh = (await api("GET", `/products/${created.id}`)).json ?? created;
    addRecord("Product", fresh, `/products/${fresh.id}`, { availableForInvestmentOpportunities: fresh.availableForInvestmentOpportunities });
    check("create eligible product", "PASS", `${fresh.sku} ${fresh.displayName}`);
    assert(
      "product persists availableForInvestmentOpportunities=true",
      fresh.availableForInvestmentOpportunities === true,
      `returned ${JSON.stringify(fresh.availableForInvestmentOpportunities)}`,
    );
    const eligibleList = items((await api("GET", `/products?pageSize=50&investmentEligible=true&search=${encodeURIComponent(fresh.sku ?? RUN)}`)).json);
    assert("eligible product listed by investmentEligible=true filter", eligibleList.some((p) => p.id === fresh.id), `${eligibleList.length} hit(s)`);
    return fresh;
  });

  const ineligible = await step("create ineligible product", async () => {
    const created = await api.must("POST", "/products", productBody("Not-For-Investment Product", false));
    addRecord("Product", created, `/products/${created.id}`, { availableForInvestmentOpportunities: false, purpose: "ineligibility check" });
    check("create ineligible product", "PASS", created.sku);
    return created;
  });

  if (!product) return;

  await step("opening stock + cost", async () => {
    const mv = await api("POST", "/inventory/opening-balance", {
      productId: product.id,
      warehouseId: warehouse.id,
      quantity: OPENING_QTY,
      unitCost: OPENING_COST,
      notes: `${RUN} opening stock`,
    });
    assert("opening stock posted", mv.ok, mv.ok ? `${OPENING_QTY} @ ${OPENING_COST} into ${warehouse.name}` : `${mv.status} ${errText(mv.json)}`);
    if (mv.ok && mv.json?.id) records.push({ run: RUN, type: "InventoryMovement", id: mv.json.id, number: mv.json.movementNumber ?? null, webUrl: `${BASE}/inventory/movements`, webRouteVerified: Boolean(webRouteFile("/inventory/movements")) });
    const stockJson = (await api("GET", `/inventory/stock?productId=${product.id}&warehouseId=${warehouse.id}`)).json;
    const stockRows = Array.isArray(stockJson) || stockJson?.items ? items(stockJson) : [stockJson ?? {}];
    const onHand = stockRows.reduce((s, r) => s + Number(r.onHand ?? r.quantity ?? 0), 0);
    assert("stock on hand reflects opening balance", onHand >= OPENING_QTY, `onHand=${onHand} @ ${warehouse.name}`, stockRows.slice(0, 3));
    let cost = (await api("GET", `/product-cost/${product.id}`)).json;
    if (!(Number(cost?.currentCost ?? cost?.cost ?? 0) > 0)) {
      const rec = await api("POST", `/product-cost/${product.id}`, { cost: OPENING_COST, reason: `${RUN} opening cost` });
      check("record product cost", rec.ok ? "PASS" : "FAIL", rec.ok ? `${OPENING_COST}` : `${rec.status} ${errText(rec.json)}`);
      cost = (await api("GET", `/product-cost/${product.id}`)).json;
    }
    const currentCost = Number(cost?.currentCost ?? cost?.cost ?? cost?.snapshot?.currentCost ?? 0);
    expected.inventoryUnitCost = currentCost;
    assert("product current cost set", currentCost > 0, `currentCost=${currentCost}`);
  });

  // ------------------------------------------------------------- investors
  const investorTypes = items((await api("GET", "/investor-types?pageSize=50")).json).filter((t) => t.isActive !== false);
  let investorType = investorTypes[0];
  if (!investorType) {
    investorType = await step("create investor type", async () => {
      const t = await api.must("POST", "/investor-types", { name: `${RUN} Investor Type`, nameEn: `${RUN} Investor Type` });
      addRecord("InvestorType", t, "/investors/settings/investor-types");
      return t;
    });
  }
  const phoneSeed = String(Date.now()).slice(-7);
  const investors = [];
  for (const [i, label] of ["Investor A", "Investor B"].entries()) {
    const inv = await step(`create ${label}`, async () => {
      const created = await api.must("POST", "/investors", {
        name: `${RUN} ${label}`,
        entityType: "PERSON",
        phone: `+9665${phoneSeed}${i}`,
        investorTypeId: investorType?.id,
        notes: `${RUN} acceptance demo — no real communication`,
      });
      addRecord("Investor", created, `/investors/list/${created.id}`);
      check(`create ${label}`, "PASS", created.name);
      return created;
    });
    if (inv) investors.push(inv);
  }
  if (investors.length < 2) return;

  // ------------------------------------------------------------- opportunity
  const SHARE = 40;
  const start = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const oppBody = (products) => ({
    nameAr: `${RUN} فرصة استثمارية`,
    nameEn: `${RUN} Investment Opportunity`,
    description: `${RUN} acceptance demo`,
    currencyId: currency.id,
    startDate: start,
    endDate: end,
    investorNetProfitSharePercent: SHARE,
    products,
  });

  if (ineligible) {
    await step("ineligible product rejected on create", async () => {
      const r = await api("POST", "/investment-opportunities", oppBody([{ productId: ineligible.id, fundedUnits: 1, fundedUnitCost: 10 }]));
      assert(
        "ineligible product rejected on opportunity create (4xx)",
        r.status >= 400 && r.status < 500,
        `${r.status} ${errText(r.json)}`,
      );
      if (r.ok) addRecord("InvestmentOpportunity", r.json, `/investors/opportunities/${r.json.id}`, { purpose: "UNEXPECTED — ineligible product accepted" });
    });
  }

  const opp = await step("create opportunity", async () => {
    const created = await api.must(
      "POST",
      "/investment-opportunities",
      oppBody([{ productId: product.id, fundedUnits: FUNDED_UNITS, fundedUnitCost: FUNDED_UNIT_COST }]),
    );
    addRecord("InvestmentOpportunity", created, `/investors/opportunities/${created.id}`, {
      investorNetProfitSharePercent: SHARE,
      targetCapital: created.targetCapital,
    });
    expected.targetCapital = round2(FUNDED_UNITS * FUNDED_UNIT_COST);
    assert("create opportunity (target capital server-computed)", near(created.targetCapital, expected.targetCapital), `${created.code} target=${created.targetCapital} expected=${expected.targetCapital}`);
    return created;
  });
  if (!opp) return;

  if (ineligible) {
    await step("ineligible product rejected on update", async () => {
      const r = await api("PATCH", `/investment-opportunities/${opp.id}`, {
        products: [
          { productId: product.id, fundedUnits: FUNDED_UNITS, fundedUnitCost: FUNDED_UNIT_COST },
          { productId: ineligible.id, fundedUnits: 1, fundedUnitCost: 10 },
        ],
      });
      assert("ineligible product rejected when added to existing opportunity (4xx)", r.status >= 400 && r.status < 500, `${r.status} ${errText(r.json)}`);
    });
  }

  await step("open opportunity", async () => {
    const r = await api.must("POST", `/investment-opportunities/${opp.id}/open`);
    assert("open opportunity", r.status === "OPEN", r.status);
  });

  // ------------------------------------------------------------- funding
  const commitments = [round2(expected.targetCapital * 0.6), round2(expected.targetCapital * 0.4)];
  expected.funding = {};
  const subs = [];
  for (const [i, inv] of investors.entries()) {
    const sub = await step(`subscription ${inv.name}`, async () => {
      const s = await api.must("POST", "/investor-subscriptions", { investorId: inv.id, opportunityId: opp.id, committedAmount: commitments[i] });
      addRecord("InvestorSubscription", s, `/investors/opportunities/${opp.id}`, { investorId: inv.id, committedAmount: commitments[i] });
      check(`subscription ${inv.name}`, "PASS", `committed ${commitments[i]}`);
      return s;
    });
    if (!sub) continue;
    subs.push(sub);
    const contribution = await step(`contribution ${inv.name}`, async () => {
      const c = await api.must("POST", "/capital-contributions", {
        subscriptionId: sub.id,
        amount: commitments[i],
        contributionDate: today(),
        financialAccountId: bankAccountId || undefined,
        referenceNumber: `${RUN}-CC-${i + 1}`,
        notes: `${RUN} acceptance demo`,
      });
      const confirmed = await api("POST", `/capital-contributions/${c.id}/confirm`);
      if (!confirmed.ok) {
        const msg = errText(confirmed.json);
        check(`confirm contribution ${inv.name}`, /account|mapping|setting/i.test(msg) ? "BLOCKED" : "FAIL", `${confirmed.status} ${msg}`);
        addRecord("CapitalContribution", c, `/investors/opportunities/${opp.id}`, { amount: commitments[i], status: c.status });
        return null;
      }
      check(`confirm contribution ${inv.name}`, confirmed.json.status === "CONFIRMED" ? "PASS" : "FAIL", `${confirmed.json.status} ${commitments[i]}`);
      const je = await verifyJe(`contribution ${inv.name}`, "CAPITAL_CONTRIBUTION", c.id, commitments[i]);
      addRecord("CapitalContribution", c, `/investors/opportunities/${opp.id}`, { amount: commitments[i], status: "CONFIRMED", journalEntryIds: je ? [je.id] : [] });
      expected.funding[inv.id] = commitments[i];
      return confirmed.json;
    });
    void contribution;
  }

  await step("opportunity funded + activate", async () => {
    const before = (await api("GET", `/investment-opportunities/${opp.id}`)).json;
    check("opportunity auto-marked FUNDED at target capital", before.status === "FUNDED" ? "PASS" : "FAIL", `status=${before.status} funded=${before.totalFunded ?? before.confirmedFunding ?? "?"}`);
    const r = await api("POST", `/investment-opportunities/${opp.id}/activate`);
    assert("activate opportunity", r.ok && r.json.status === "ACTIVE", r.ok ? r.json.status : `${r.status} ${errText(r.json)}`);
  });

  // ------------------------------------------------------------- real sales
  const orderPlan = [
    { qty: 3, unitPrice: 300 },
    { qty: 2, unitPrice: 250 },
  ];
  const orders = [];
  for (const [i, plan] of orderPlan.entries()) {
    const label = `store order ${i + 1}`;
    const order = await step(label, async () => {
      const created = await api.must("POST", "/store-orders", {
        partner: { name: `${RUN} Customer ${i + 1}`, phone: `+9665${phoneSeed}${5 + i}` },
        currencyId: currency.id,
        paymentType: "PREPAID",
        notes: `${RUN} investor-tour sale`,
        items: [{ productId: product.id, quantity: plan.qty, unitPrice: plan.unitPrice }],
      });
      check(label, "PASS", `${created.internalOrderId} ${plan.qty} × ${plan.unitPrice}`);
      const rec = { order: created, plan, jeIds: [] };
      // pay — Finance Confirm & Post
      if (receivingAccount && paymentSource) {
        const pay = await api("POST", `/store-orders/${created.id}/payments`, {
          paymentDate: today(),
          amount: round2(plan.qty * plan.unitPrice),
          currencyId: currency.id,
          paymentSourceId: paymentSource.id,
          receivingAccountId: receivingAccount.id,
          senderName: `${RUN} Customer ${i + 1}`,
          referenceNumber: `${RUN}-PAY-${i + 1}`,
        });
        if (!pay.ok) check(`${label}: record payment`, "FAIL", `${pay.status} ${errText(pay.json)}`);
        else {
          const payment = pay.json.payment ?? pay.json;
          const conf = await api("POST", `/payments/${payment.id}/confirm`);
          assert(`${label}: payment confirm & post`, conf.ok, conf.ok ? `${payment.paymentNumber ?? payment.id}` : `${conf.status} ${errText(conf.json)}`);
          rec.paymentId = payment.id;
        }
      } else check(`${label}: record payment`, "BLOCKED", "no active receiving account / payment source");
      // invoice
      const inv = await api("POST", `/store-orders/${created.id}/generate-invoice`);
      const invoiceId = inv.json?.id ?? inv.json?.salesInvoice?.id ?? inv.json?.salesInvoiceId;
      assert(`${label}: sales invoice generated`, inv.ok && invoiceId, inv.ok ? inv.json?.invoiceNumber ?? invoiceId : `${inv.status} ${errText(inv.json)}`);
      if (invoiceId) {
        rec.invoiceId = invoiceId;
        const je = await verifyJe(`${label} invoice`, "SALES_INVOICE", invoiceId);
        if (je) {
          rec.jeIds.push(je.id);
          rec.postedCogs = round2(
            (je.lines ?? [])
              .filter((l) => (l.accountId ?? l.account?.id) === posting.costOfGoodsSoldAccountId)
              .reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0),
          );
        }
        const invoice = (await api("GET", `/sales/invoices/${invoiceId}`)).json;
        rec.invoice = invoice;
        addRecord("SalesInvoice", { id: invoiceId, invoiceNumber: invoice?.invoiceNumber ?? inv.json?.invoiceNumber }, `/sales/invoices/${invoiceId}`, {
          storeOrderId: created.id,
          journalEntryIds: je ? [je.id] : [],
          expectedSubtotal: round2(plan.qty * plan.unitPrice),
        });
      }
      // deliver
      for (const stepName of ["ship", "out-for-delivery", "deliver"]) {
        const r = await api("POST", `/store-orders/${created.id}/shipments/${stepName}`);
        if (!r.ok) {
          check(`${label}: shipment ${stepName}`, "FAIL", `${r.status} ${errText(r.json)}`);
          break;
        }
      }
      const fresh = (await api("GET", `/store-orders/${created.id}`)).json;
      rec.order = fresh;
      assert(`${label}: fulfillment DELIVERED`, fresh.fulfillmentStatus?.code === "DELIVERED", `fulfillment=${fresh.fulfillmentStatus?.code} payment=${fresh.paymentStatus}`);
      addRecord("StoreOrder", { id: created.id, internalOrderId: fresh.internalOrderId }, `/store-orders/${created.id}`, {
        salesInvoiceId: rec.invoiceId ?? null,
        paymentId: rec.paymentId ?? null,
        journalEntryIds: rec.jeIds,
        expectedRevenue: round2(plan.qty * plan.unitPrice),
        fulfillment: fresh.fulfillmentStatus?.code,
      });
      return rec;
    });
    if (order) orders.push(order);
  }

  // ------------------------------------------------------------- allocation
  for (const rec of orders) {
    await step(`allocate ${rec.order.internalOrderId}`, async () => {
      const r = await api("POST", `/investment-sales/allocate/${rec.order.id}`);
      assert(
        `allocate sales of ${rec.order.internalOrderId} to opportunity`,
        r.ok && r.json.unitsAllocated === rec.plan.qty,
        r.ok ? `unitsAllocated=${r.json.unitsAllocated} expected=${rec.plan.qty}` : `${r.status} ${errText(r.json)}`,
      );
      const again = await api("POST", `/investment-sales/allocate/${rec.order.id}`);
      assert(`allocation idempotent for ${rec.order.internalOrderId}`, again.ok && again.json.unitsAllocated === 0, `second run unitsAllocated=${again.json?.unitsAllocated}`);
    });
  }
  if (process.env.ALLOW_GLOBAL_RECALC === "1") {
    await step("global recalculate", async () => {
      const r = await api.must("POST", "/investment-sales/recalculate");
      check("global recalculate", "PASS", JSON.stringify(r));
    });
  } else {
    check("global recalculate (all delivered orders)", "SKIP", "touches non-demo allocations — set ALLOW_GLOBAL_RECALC=1 to include");
  }

  // Expected figures come from the actual order lines the API returned.
  let soldUnits = 0;
  let revenue = 0;
  for (const rec of orders.filter((o) => o.order.fulfillmentStatus?.code === "DELIVERED")) {
    for (const line of (rec.order.items ?? []).filter((l) => l.productId === product.id && !l.deletedAt)) {
      soldUnits += Number(line.quantity);
      revenue += Number(line.agreedAmount ?? line.lineTotal ?? Number(line.quantity) * Number(line.unitPrice));
    }
  }
  const allocUnits = Math.min(soldUnits, FUNDED_UNITS);
  expected.revenue = round2(soldUnits > 0 ? (revenue * allocUnits) / soldUnits : 0);
  expected.cogs = round2(allocUnits * FUNDED_UNIT_COST);
  expected.netSoldUnits = allocUnits;

  const allocations = items((await api("GET", `/investment-sales?opportunityId=${opp.id}&pageSize=100`)).json);
  for (const a of allocations) {
    records.push({ run: RUN, type: "OpportunitySaleAllocation", id: a.id, number: a.orderNumber, webUrl: `${BASE}/investors/opportunities/${opp.id}`, webRouteVerified: true, allocatedQuantity: a.allocatedQuantity, allocatedRevenue: a.allocatedRevenue });
  }

  const summary = await step("sales summary", async () => {
    const s = await api.must("GET", `/investment-sales/opportunities/${opp.id}/summary`);
    assert(
      "attributable revenue = delivered order lines (agreed amounts)",
      near(s.totals.attributableRevenue, expected.revenue),
      `api=${s.totals.attributableRevenue} expected=${expected.revenue}`,
    );
    assert("COGS = net sold units × funded unit cost", near(s.totals.cogs, expected.cogs), `api=${s.totals.cogs} expected=${expected.cogs} (${allocUnits} × ${FUNDED_UNIT_COST})`);
    assert("net sold units", s.totals.netSoldUnits === expected.netSoldUnits, `api=${s.totals.netSoldUnits} expected=${expected.netSoldUnits}`);
    return s;
  });
  void summary;

  // Cross-check revenue against the posted sales invoices (pre-tax subtotal).
  const invoiceSubtotal = round2(
    orders.reduce((s, o) => s + Number(o.invoice?.subtotal ?? o.invoice?.subTotal ?? o.invoice?.totalBeforeTax ?? NaN), 0),
  );
  if (Number.isFinite(invoiceSubtotal)) {
    assert("attributable revenue reconciles to sales invoice subtotals", near(invoiceSubtotal, expected.revenue), `invoices=${invoiceSubtotal} expected=${expected.revenue}`);
  } else {
    check("attributable revenue reconciles to sales invoice subtotals", "SKIP", "invoice subtotal field not exposed");
  }
  if (expected.inventoryUnitCost && posting.costOfGoodsSoldAccountId) {
    const postedCogs = round2(orders.reduce((s, o) => s + (o.postedCogs ?? 0), 0));
    assert(
      "inventory COGS posted on invoices = sold units × inventory cost",
      near(postedCogs, round2(soldUnits * expected.inventoryUnitCost)),
      `posted=${postedCogs} expected=${round2(soldUnits * expected.inventoryUnitCost)}`,
    );
  }
  if (expected.inventoryUnitCost) {
    check(
      "investment COGS basis vs inventory cost",
      near(expected.inventoryUnitCost, FUNDED_UNIT_COST) ? "PASS" : "INFO",
      `fundedUnitCost=${FUNDED_UNIT_COST} inventoryCost=${expected.inventoryUnitCost} (engine uses the opportunity's agreed funded cost by design)`,
    );
  }

  // ------------------------------------------------------------- costs
  const EXPENSE = 50;
  expected.expenses = 0;
  await step("opportunity expense", async () => {
    const e = await api.must("POST", "/investment-expenses", {
      opportunityId: opp.id,
      expenseDate: today(),
      category: "SHIPPING",
      description: `${RUN} demo shipping cost`,
      amount: EXPENSE,
      notes: `${RUN} acceptance demo`,
    });
    const ap = await api("POST", `/investment-expenses/${e.id}/approve`);
    assert("opportunity expense approved", ap.ok && ap.json.status === "APPROVED", ap.ok ? `${e.code ?? e.id} ${EXPENSE}` : `${ap.status} ${errText(ap.json)}`);
    if (ap.ok) expected.expenses = EXPENSE;
    addRecord("OpportunityExpense", e, `/investors/opportunities/${opp.id}`, { amount: EXPENSE, status: ap.json?.status });
  });

  // ------------------------------------------------------------- profit
  expected.netProfit = round2(expected.revenue - expected.cogs - expected.expenses);
  expected.investorPool = expected.netProfit > 0 ? round2(expected.netProfit * (SHARE / 100)) : 0;
  expected.companyPortion = round2(expected.netProfit - expected.investorPool);
  const totalFunded = Object.values(expected.funding).reduce((s, v) => s + v, 0);
  const fundedInvestors = investors.filter((i) => expected.funding[i.id]).sort((a, b) => (a.id < b.id ? -1 : 1));
  expected.shares = {};
  let acc = 0;
  fundedInvestors.forEach((inv, idx) => {
    const amt = idx === fundedInvestors.length - 1 ? round2(expected.investorPool - acc) : round2(expected.investorPool * (expected.funding[inv.id] / totalFunded));
    acc = round2(acc + amt);
    expected.shares[inv.id] = amt;
  });

  const compareBreakdown = (label, b) => {
    assert(`${label}: revenue`, near(b.revenue, expected.revenue), `api=${b.revenue} expected=${expected.revenue}`);
    assert(`${label}: COGS`, near(b.cogs, expected.cogs), `api=${b.cogs} expected=${expected.cogs}`);
    assert(`${label}: expenses`, near(b.expenses, expected.expenses), `api=${b.expenses} expected=${expected.expenses}`);
    assert(`${label}: net profit = revenue − COGS − expenses`, near(b.netProfit, expected.netProfit), `api=${b.netProfit} expected=${expected.netProfit}`);
    assert(`${label}: investor pool = net × ${SHARE}%`, near(b.investorProfitPool, expected.investorPool), `api=${b.investorProfitPool} expected=${expected.investorPool}`);
    assert(`${label}: company portion`, near(b.companyProfitPortion, expected.companyPortion), `api=${b.companyProfitPortion} expected=${expected.companyPortion}`);
    for (const inv of fundedInvestors) {
      const share = (b.investorShares ?? []).find((s) => s.investorId === inv.id);
      assert(
        `${label}: ${inv.name} share (funding ${expected.funding[inv.id]}/${totalFunded})`,
        share && near(share.profitShareAmount, expected.shares[inv.id]),
        `api=${share?.profitShareAmount} expected=${expected.shares[inv.id]} participation=${share?.participationPercent}%`,
      );
    }
    const sum = round2((b.investorShares ?? []).reduce((s, x) => s + Number(x.profitShareAmount), 0));
    assert(`${label}: Σ investor shares = pool`, near(sum, b.investorProfitPool), `Σ=${sum} pool=${b.investorProfitPool}`);
  };

  await step("profit estimate", async () => {
    const est = await api.must("GET", `/investment-profit/estimate?opportunityId=${opp.id}`);
    compareBreakdown("estimate", est);
  });

  const calc = await step("profit calculation", async () => {
    const c = await api.must("POST", `/investment-profit?opportunityId=${opp.id}`);
    compareBreakdown("snapshot", c);
    const ap = await api.must("POST", `/investment-profit/${c.id}/approve`);
    assert("approve profit calculation", ap.status === "APPROVED", ap.status);
    const again = await api("POST", `/investment-profit?opportunityId=${opp.id}`);
    assert("approved profit is immutable (re-calc rejected 4xx)", again.status >= 400 && again.status < 500, `${again.status} ${errText(again.json)}`);
    addRecord("ProfitCalculation", c, `/investors/opportunities/${opp.id}`, {
      status: "APPROVED",
      revenue: c.revenue,
      cogs: c.cogs,
      expenses: c.expenses,
      netProfit: c.netProfit,
      investorProfitPool: c.investorProfitPool,
    });
    return ap;
  });

  // ------------------------------------------------------------- distribution
  let distribution;
  if (calc && expected.investorPool > 0) {
    distribution = await step("profit distribution", async () => {
      const d = await api.must("POST", "/investment-distributions", { profitCalculationId: calc.id, notes: `${RUN} acceptance demo` });
      assert("distribution total = investor pool", near(d.totalInvestorProfit, expected.investorPool), `api=${d.totalInvestorProfit} expected=${expected.investorPool}`);
      const ap = await api("POST", `/investment-distributions/${d.id}/approve`);
      if (!ap.ok) {
        const msg = errText(ap.json);
        check("approve distribution", /account|mapping|setting/i.test(msg) ? "BLOCKED" : "FAIL", `${ap.status} ${msg}`);
        addRecord("ProfitDistribution", d, `/investors/opportunities/${opp.id}`, { status: d.status, totalInvestorProfit: d.totalInvestorProfit });
        return null;
      }
      check("approve distribution", ap.json.status === "APPROVED" ? "PASS" : "FAIL", ap.json.status);
      const je = await verifyJe("distribution", "INVESTOR_DISTRIBUTION", d.id, expected.investorPool);
      addRecord("ProfitDistribution", d, `/investors/opportunities/${opp.id}`, {
        status: ap.json.status,
        totalInvestorProfit: d.totalInvestorProfit,
        journalEntryIds: je ? [je.id] : [],
      });
      return ap.json;
    });
  } else if (calc) {
    check("profit distribution", "SKIP", `investor pool is ${expected.investorPool} (no positive profit to distribute)`);
  }

  if (distribution) {
    for (const row of distribution.investorDistributions ?? []) {
      await step(`pay ${row.investorName}`, async () => {
        if (!bankAccountId) {
          check(`pay ${row.investorName}`, "BLOCKED", "PostingSettings.bankAccountId not configured (payment financial account)");
          return;
        }
        const p = await api.must("POST", "/investment-payments", {
          investorDistributionId: row.id,
          amount: row.entitledAmount,
          paymentDate: today(),
          financialAccountId: bankAccountId,
          referenceNumber: `${RUN}-IPAY`,
          notes: `${RUN} acceptance demo — no real transfer`,
        });
        const conf = await api("POST", `/investment-payments/${p.id}/confirm`);
        assert(`confirm profit payment ${row.investorName}`, conf.ok && conf.json.status === "CONFIRMED", conf.ok ? `${row.entitledAmount}` : `${conf.status} ${errText(conf.json)}`);
        const je = conf.ok ? await verifyJe(`payment ${row.investorName}`, "INVESTOR_PROFIT_PAYMENT", p.id, row.entitledAmount) : null;
        addRecord("DistributionPayment", p, `/investors/opportunities/${opp.id}`, { amount: row.entitledAmount, investorId: row.investorId, journalEntryIds: je ? [je.id] : [] });
      });
    }
    await step("distribution fully paid", async () => {
      const d = await api.must("GET", `/investment-distributions/${distribution.id}`);
      assert("distribution fully paid", near(d.totalOutstanding, 0) && near(d.totalPaid, expected.investorPool), `paid=${d.totalPaid} outstanding=${d.totalOutstanding} status=${d.status}`);
    });
  }

  // ------------------------------------------------------------- investor screens
  for (const inv of fundedInvestors) {
    await step(`investor screens ${inv.name}`, async () => {
      const detail = await api.must("GET", `/investors/${inv.id}`);
      assert(`${inv.name}: profile total confirmed funding`, near(detail.totalConfirmedFunding, expected.funding[inv.id]), `api=${detail.totalConfirmedFunding} expected=${expected.funding[inv.id]}`);
      const stmt = await api.must("GET", `/investor-ledger/statement/${inv.id}?pageSize=100`);
      const rows = items(stmt).length ? items(stmt) : stmt.entries ?? stmt.lines ?? [];
      const mine = rows.filter((r) => !r.opportunityId || r.opportunityId === opp.id || r.opportunity?.id === opp.id);
      const byType = (t) => round2(mine.filter((r) => r.type === t).reduce((s, r) => s + Number(r.creditAmount ?? 0) - Number(r.debitAmount ?? 0), 0));
      assert(`${inv.name}: ledger CAPITAL_FUNDED`, near(byType("CAPITAL_FUNDED"), expected.funding[inv.id]), `ledger=${byType("CAPITAL_FUNDED")} expected=${expected.funding[inv.id]}`);
      const types = [...new Set(mine.map((r) => r.type))];
      const profitTypes = types.filter((t) => /PROFIT|DISTRIBUT/i.test(t) && !/PAY/i.test(t));
      const profitCredited = round2(profitTypes.reduce((s, t) => s + byType(t), 0));
      assert(
        `${inv.name}: realized profit visible in ledger`,
        distribution ? near(profitCredited, expected.shares[inv.id]) : true,
        `types=${types.join(",")} profit=${profitCredited} expected=${expected.shares[inv.id]}`,
      );
      const summaryRes = await api("GET", `/investor-ledger/summary/${inv.id}`);
      check(`${inv.name}: ledger summary`, summaryRes.ok ? "PASS" : "FAIL", JSON.stringify(summaryRes.json).slice(0, 400));
    });
  }
  await step("opportunity distribution summary", async () => {
    const s = await api.must("GET", `/investment-distributions/opportunity-summary?opportunityId=${opp.id}`);
    check("opportunity distribution summary", "PASS", JSON.stringify(s).slice(0, 500));
  });
  void me;
}

try {
  await main();
} catch (error) {
  check("unexpected error", "FAIL", error?.stack ?? String(error));
}
const indexPath = appendIndex("demo-record-index.investors.json", records);
report.recordIndex = indexPath;
finish("investor-tour-report.json");
process.exit(0);
