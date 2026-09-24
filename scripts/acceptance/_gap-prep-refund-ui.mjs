#!/usr/bin/env node
/** Prep one DEMO return left refundable for UI refund-dialog browser test. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { API, PW, RUN, ROOT, apiClient, items, login, today } from "./_tour-lib.mjs";

if (!PW) throw new Error("QA_PASSWORD required");
const token = await login("qa-admin@oms.haseb.org");
const api = apiClient(token);
const must = (res, label) => {
  if (!res.ok) throw new Error(`${label}: ${res.status} ${JSON.stringify(res.json).slice(0, 240)}`);
  return res.json;
};

const products = items((await api("GET", "/products?search=DEMO-GUIDE-20260924%20Book&pageSize=10")).json);
const book = products.find((p) => (p.name ?? "").includes("Book") && !(p.name ?? "").includes("Lab")) ?? products[0];
const wh = items((await api("GET", "/warehouses?pageSize=20")).json)[0];
const eg = items((await api("GET", "/countries?pageSize=300")).json).find((c) => c.code === "EG");
const ps = items((await api("GET", "/payment-sources?pageSize=50")).json).find((s) => s.isActive !== false);
const ra =
  items((await api("GET", "/receiving-accounts?pageSize=50")).json).find((a) => a.isDefault) ??
  items((await api("GET", "/receiving-accounts?pageSize=50")).json)[0];
const currency = items((await api("GET", "/currencies?pageSize=50")).json).find((c) => c.code === "EGP");
if (!book || !wh || !eg || !ps || !ra || !currency) throw new Error("missing master data");

const lead = must(
  await api("POST", "/leads", {
    customerName: `${RUN} Refund UI Customer C`,
    mobileNumber: `010${String(Date.now()).slice(-8)}`,
    countryId: eg.id,
    city: "Demo City",
    address: `${RUN} fictional address`,
    productId: book.id,
    quantity: 1,
    currencyId: currency.id,
    source: "MANUAL",
  }),
  "create lead",
);
const conv = must(
  await api("POST", `/leads/${lead.id}/convert`, {
    items: [{ productId: book.id, quantity: 1, agreedAmount: 200 }],
    paymentType: "PREPAID",
    currencyId: currency.id,
    city: "Demo City",
    address: `${RUN} fictional address`,
    notes: `${RUN} UI refund order`,
  }),
  "convert",
);
const orderId = conv.storeOrder?.id ?? conv.storeOrderId;
const order = must(await api("GET", `/store-orders/${orderId}`), "order");
const reported = must(
  await api("POST", `/store-orders/${orderId}/report-payment`, {
    reportedAmount: 200,
    reportedDate: today(),
    paymentSourceId: ps.id,
    receivingAccountId: ra.id,
    reference: `${RUN} pay`,
    senderName: `${RUN} sender`,
    notes: `${RUN} pay`,
  }),
  "report payment",
);
must(await api("POST", `/payments/${reported.payment.id}/confirm`), "confirm payment");
const invPayload = must(await api("POST", `/store-orders/${orderId}/generate-invoice`), "invoice");
const invId = invPayload.id ?? invPayload.salesInvoice?.id ?? invPayload.salesInvoiceId;
const inv = must(await api("GET", `/sales/invoices/${invId}`), "invoice get");

for (const step of ["ship", "out-for-delivery", "deliver"]) {
  const res = await api("POST", `/store-orders/${orderId}/shipments/${step}`);
  if (!res.ok) console.warn(`shipment ${step}: ${res.status} ${JSON.stringify(res.json).slice(0, 120)}`);
}

const line = (inv.items ?? [])[0];
if (!line) throw new Error(`invoice ${inv.invoiceNumber} has no items`);
const ret = must(
  await api("POST", "/sales/returns", {
    partnerId: order.partnerId ?? inv.partnerId,
    salesInvoiceId: invId,
    currencyId: currency.id,
    referenceNumber: `${RUN} UI refund return`,
    items: [
      {
        productId: book.id,
        warehouseId: wh.id,
        unitId: line.unitId ?? book.unitId,
        quantity: 1,
        unitPrice: 200,
        salesInvoiceItemId: line.id,
      },
    ],
  }),
  "return",
);
must(await api("POST", `/sales/returns/${ret.id}/confirm`), "confirm return");
const retFull = must(await api("GET", `/sales/returns/${ret.id}`), "return get");
const refundable = must(
  await api("GET", `/financial-transactions/refunds/refundable/${ret.id}`),
  "refundable",
);

const out = {
  run: RUN,
  api: API,
  lead: { id: lead.id, number: lead.leadNumber },
  order: { id: orderId, number: order.internalOrderId },
  invoice: { id: invId, number: inv.invoiceNumber },
  return: { id: retFull.id, number: retFull.returnNumber, status: retFull.status },
  refundable,
};
writeFileSync(resolve(ROOT, "docs/user-guide/evidence/gap-refundable-target.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
