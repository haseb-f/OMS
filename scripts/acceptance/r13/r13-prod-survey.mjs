/**
 * R13 — READ-ONLY Production survey through the application API (direct Production DB reads are not used).
 *
 *   PHASE=pre  node scripts/acceptance/r13/r13-prod-survey.mjs   # before the R13 deploy: migration review list
 *   PHASE=post node scripts/acceptance/r13/r13-prod-survey.mjs   # after it: new routes/fields + integrity + same counts
 *
 * Only `POST /auth/login` and GET requests are sent — no business data is created or changed. The QA admin password is
 * read from tmp/.qa.env (QA_PASSWORD) and never printed. Output: specs/product-inventory-costing/evidence/prod/.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "../../..",
);
const PHASE = process.env.PHASE === "post" ? "post" : "pre";
const BASE = process.env.BASE ?? "https://oms.haseb.org";
const API = process.env.API ?? `${BASE}/api`;
const EMAIL = process.env.EMAIL ?? "qa-admin@oms.haseb.org";
const OUT = path.join(ROOT, "specs/product-inventory-costing/evidence/prod");

function qaPassword() {
  if (process.env.QA_PASSWORD) return process.env.QA_PASSWORD;
  const env = readFileSync(path.join(ROOT, "tmp/.qa.env"), "utf8");
  const line = env.split(/\r?\n/).find((l) => /^\s*(export\s+)?QA_PASSWORD=/.test(l));
  if (!line) throw new Error("QA_PASSWORD not found in tmp/.qa.env");
  return line
    .replace(/^\s*(export\s+)?QA_PASSWORD=/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

let token = null;
const checks = [];
const record = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function get(route) {
  const res = await fetch(`${API}${route}`, { headers: { Authorization: `Bearer ${token}` } });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}
const items = (json) => (Array.isArray(json) ? json : (json?.items ?? json?.data ?? []));

async function allProducts() {
  const rows = [];
  for (let page = 1; page < 500; page++) {
    const res = await get(`/products?page=${page}&pageSize=200`);
    if (res.status !== 200) throw new Error(`GET /products page ${page} → ${res.status}`);
    const batch = items(res.json);
    rows.push(...batch);
    const total = res.json?.total ?? res.json?.meta?.total;
    if (batch.length < 200 || (total != null && rows.length >= total)) break;
  }
  return rows;
}

const normBarcode = (b) => (b == null ? "" : String(b).trim().toLowerCase());
const brief = (p) => ({
  id: p.id,
  sku: p.sku,
  name: p.name,
  type: p.type,
  itemType: p.itemType ?? null,
  status: p.status,
});

async function main() {
  mkdirSync(OUT, { recursive: true });
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: qaPassword(), rememberMe: true }),
  }).then((r) => r.json());
  token = login.accessToken;
  record("API login (QA admin)", Boolean(token), EMAIL);
  if (!token) return finish({});

  const products = await allProducts();
  const byKey = (fn) =>
    products.reduce((acc, p) => {
      const k = fn(p);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});

  const barcodeGroups = {};
  for (const p of products) {
    const b = normBarcode(p.barcode);
    if (b) (barcodeGroups[b] ??= []).push(brief(p));
  }
  const barcodeDuplicates = Object.entries(barcodeGroups)
    .filter(([, rows]) => rows.length > 1)
    .map(([barcode, rows]) => ({ barcode, products: rows }));

  const manufactured = products.filter(
    (p) => p.type === "MANUFACTURED" || p.supplyMethod === "ASSEMBLED" || p.supplyMethod === "KIT",
  );
  const legacyBom = [];
  for (const p of manufactured) {
    const route = PHASE === "pre" ? `/products/${p.id}/components` : `/products/${p.id}/recipes`;
    const res = await get(route);
    legacyBom.push({
      ...brief(p),
      supplyMethod: p.supplyMethod ?? null,
      route,
      httpStatus: res.status,
      lines: res.status === 200 ? items(res.json).length : null,
    });
  }

  const stockCards = await get("/inventory/stock-cards");
  const cards = stockCards.status === 200 ? items(stockCards.json) : [];
  // Stock cards carry `averageCost` (the moving average); ownership comes from the product master (pre-R13 cards have none).
  const agentOwned = new Set(products.filter((p) => p.ownerAgentId).map((p) => p.id));
  const stockWithoutCost = cards
    .filter(
      (c) => Number(c.onHand ?? 0) > 0 && !agentOwned.has(c.productId) && c.averageCost == null,
    )
    .map((c) => ({ productId: c.productId, sku: c.sku, onHand: c.onHand }));

  const review = {
    phase: PHASE,
    at: new Date().toISOString(),
    totals: {
      products: products.length,
      byLegacyType: byKey((p) => p.type ?? "NULL"),
      byItemType: byKey((p) => p.itemType ?? "UNCLASSIFIED"),
      bySupplyMethod: byKey((p) => p.supplyMethod ?? "(pre-R13)"),
      agentOwned: products.filter((p) => p.ownerAgentId).length,
      stockCards: cards.length,
    },
    unclassifiedItemType: products.filter((p) => !p.itemType).map(brief),
    serviceButStockTracked: products
      .filter((p) => (p.itemType === "SERVICE" || p.type === "SERVICE") && p.isInventoryItem)
      .map(brief),
    manufacturedWithBom: legacyBom,
    barcodeDuplicates,
    stockWithoutCost,
    investmentFlagWouldBeBlocked: products
      .filter((p) => p.availableForInvestmentOpportunities)
      .filter(
        (p) =>
          p.ownerAgentId ||
          p.itemType === "SERVICE" ||
          p.type === "SERVICE" ||
          !p.isSellable ||
          p.status !== "ACTIVE",
      )
      .map(brief),
  };

  record("products readable", products.length > 0, `${products.length} products`);
  record("stock cards readable", stockCards.status === 200, `${cards.length} cards`);
  record(
    "no duplicate barcodes (unique index will be created)",
    barcodeDuplicates.length === 0,
    `${barcodeDuplicates.length} duplicate groups`,
  );

  if (PHASE === "post") {
    record(
      "products expose supplyMethod",
      products.every((p) => p.supplyMethod),
      "",
    );
    for (const route of ["/assembly?pageSize=5", "/inventory/integrity"]) {
      const res = await get(route);
      record(`GET ${route}`, res.status === 200, `status ${res.status}`);
      if (route === "/inventory/integrity" && res.status === 200) {
        review.integrity = (res.json?.invariants ?? res.json?.results ?? []).map((i) => ({
          id: i.id,
          status: i.status,
          violations: i.violationCount ?? i.violations?.length ?? 0,
        }));
        const failing = review.integrity.filter((i) => i.status === "FAIL");
        record(
          "integrity: no FAIL invariants",
          failing.length === 0,
          review.integrity.map((i) => `${i.id}:${i.status}`).join(" "),
        );
      }
    }
    if (products[0]) {
      for (const route of [
        `/products/${products[0].id}/effective-defaults`,
        `/products/${products[0].id}/investment-links`,
        `/products/similar-names?name=${encodeURIComponent(products[0].name)}`,
      ]) {
        const res = await get(route);
        record(
          `GET ${route.replace(products[0].id, ":id")}`,
          res.status === 200,
          `status ${res.status}`,
        );
      }
    }
  }
  finish(review);
}

function finish(review) {
  const failed = checks.filter((c) => !c.ok).length;
  const file = path.join(OUT, `r13-prod-survey-${PHASE}`);
  writeFileSync(`${file}.json`, JSON.stringify({ checks, review }, null, 2));
  const md = [
    `# R13 Production survey — ${PHASE}-deploy (${new Date().toISOString()})`,
    "",
    "Read-only (login + GET only) as the QA admin.",
    "",
    ...checks.map(
      (c) => `- ${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`,
    ),
    "",
    "## Review list",
    "",
    "```json",
    JSON.stringify(
      {
        ...review,
        unclassifiedItemType: review.unclassifiedItemType?.length,
        serviceButStockTracked: review.serviceButStockTracked,
        manufacturedWithBom: review.manufacturedWithBom,
        stockWithoutCost: review.stockWithoutCost?.length,
        investmentFlagWouldBeBlocked: review.investmentFlagWouldBeBlocked,
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
  writeFileSync(`${file}.md`, md);
  console.log(`\n${checks.length - failed}/${checks.length} checks passed → ${file}.{json,md}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  record("survey run", false, String(error?.message ?? error));
  finish({});
});
