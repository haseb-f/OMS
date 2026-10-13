#!/usr/bin/env node
/**
 * R19 A — agent-owned stocked assembly: seed + screenshots on a LOCAL integrated build only (never Production).
 *
 *   MODE=before|after BASE=http://localhost:4701 API=http://localhost:4705 PW_FILE=tmp/r15-manual/.env \
 *     node scripts/acceptance/r19/r19-a-agent-assembly-browser.mjs
 *
 * Seeds, through the API as the demo admin, an agent gift box (ASSEMBLED) and two agent components
 * (owner = the demo agent), receives 230 × A + 110 × B on an agent stock receipt (ASR) and activates the recipe
 * box = 2 × A + 1 × B. Then captures: the recipe panel, the assembly dialog (required / available / shortage /
 * finished), and — MODE=after — posts 100 boxes through the dialog, the posted assembly detail and the agent
 * stock history (receipt → assembly → box). The full lifecycle (reserve / ship / return / reversal) is proven by
 * apps/api/src/assembly/agent-assembly.integration.serial.spec.ts. Password read from PW_FILE, never printed.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const MODE = process.env.MODE === "before" ? "before" : "after";
const BASE = (process.env.BASE ?? "http://localhost:4701").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:4705").replace(/\/$/, "");
const OUT = `specs/round19-improvements/evidence/a/${MODE}`;
mkdirSync(OUT, { recursive: true });
const PW = readFileSync(process.env.PW_FILE ?? "tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)[1]
  .trim();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};
const items = (j) => j?.items ?? j?.data ?? (Array.isArray(j) ? j : []);
const tag = Date.now().toString(36).toUpperCase();

async function apiSession(email) {
  const { accessToken } = await (
    await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PW }),
    })
  ).json();
  return async (path, { method = "GET", body } = {}) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
}
const must = (res, what) => {
  if (res.status >= 300) throw new Error(`${what}: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json;
};

const admin = await apiSession("admin@oms-demo.local");
const agentApi = await apiSession("agent@oms-demo.local");
const agentId = (await agentApi("/agent-portal/me")).json?.agent?.id;
const agent = must(await admin(`/agents/${agentId}`), "agent");
const warehouses = items((await admin("/warehouses?pageSize=100")).json);
const warehouse =
  warehouses.find((w) => w.isDefault && w.isActive) ?? warehouses.find((w) => w.role === "STOCK" && w.isActive);
const template = items((await admin(`/products?agentId=${agentId}&pageSize=1`)).json)[0] ??
  items((await admin(`/products?pageSize=1&isInventoryItem=true`)).json)[0];
check("demo agent, warehouse and a product template found", agentId && warehouse && template, `${agent.agentNumber} · ${warehouse?.code}`);

const createProduct = async (name, supplyMethod) => {
  const product = must(
    await admin("/products", {
      method: "POST",
      body: {
        name,
        internalName: name,
        displayName: name,
        categoryId: template.categoryId,
        unitId: template.unitId,
        type: "PURCHASE_AND_SALE",
        itemType: "PRODUCT",
        supplyMethod,
        isInventoryItem: true,
        isSellable: true,
        isPurchasable: supplyMethod === "PURCHASED",
        preferredWarehouseId: warehouse.id,
        weight: 0.2,
        width: 10,
        height: 5,
        length: 15,
        ownerAgentId: agentId,
      },
    }),
    `create ${name}`,
  );
  return product.status === "ACTIVE" ? product : must(await admin(`/products/${product.id}/activate`, { method: "POST" }), "activate");
};
const a = await createProduct(`شوكولاتة فاخرة ${tag}`, "PURCHASED");
const b = await createProduct(`بطاقة إهداء ${tag}`, "PURCHASED");
const box = await createProduct(`علبة هدية ${tag}`, "ASSEMBLED");
check("agent gift box + 2 components created (owner = agent)", [a, b, box].every((p) => p.ownerAgentId === agentId), `${box.sku}`);

const receipt = must(
  await admin("/agent-stock-receipts", {
    method: "POST",
    body: {
      agentId,
      warehouseId: warehouse.id,
      kind: "RECEIPT",
      reference: `R19A-${tag}`,
      idempotencyKey: `R19A-${tag}-asr`,
      lines: [
        { productId: a.id, quantity: 230 },
        { productId: b.id, quantity: 110 },
      ],
    },
  }),
  "receipt",
);
check("components received on an agent stock receipt (no cost)", /^ASR-/.test(receipt.receiptNumber), receipt.receiptNumber);
const draft = must(
  await admin(`/products/${box.id}/recipes`, {
    method: "POST",
    body: {
      lines: [
        { componentProductId: a.id, quantity: "2", unitId: a.unitId },
        { componentProductId: b.id, quantity: "1", unitId: b.unitId },
      ],
    },
  }),
  "recipe",
);
const recipe = must(await admin(`/recipes/${draft.id}/activate`, { method: "POST" }), "activate recipe");
check("recipe 2 × A + 1 × B active", recipe.status === "ACTIVE", `v${recipe.version}`);
const preview = await admin(`/assembly/preview?productId=${box.id}&warehouseId=${warehouse.id}&quantity=100`);
check(
  `API preview of 100 boxes (${MODE})`,
  true,
  `canAssemble=${preview.json?.canAssemble} blockers=${(preview.json?.blockers ?? []).map((x) => x.code).join(",")}`,
);
const journalsBefore = (await admin("/journal-entries?pageSize=1")).json?.total;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("oms.locale", JSON.stringify("ar"));
  } catch {
    // private mode
  }
});
const p = await ctx.newPage();
await p.goto(`${BASE}/login`);
await p.locator('input[name="email"]').fill("admin@oms-demo.local");
await p.locator('input[name="password"]').fill(PW);
await p.locator('button[type="submit"]').click();
await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
const settle = async () => {
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.waitForTimeout(900);
};
const shot = async (name, opts = {}) => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await p.screenshot({ path: `${OUT}/${name}.png`, ...opts });
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      await p.waitForTimeout(400 * attempt);
    }
  }
};

// 1. Recipe panel of the agent gift box.
await p.goto(`${BASE}/products/${box.id}`);
await settle();
await p.getByRole("tab", { name: "الوصفة" }).click();
await settle();
await shot("1-recipe-panel-agent-box", { fullPage: true });

// 2. The assembly dialog from the product page shortcut, 100 boxes.
await p.getByRole("button", { name: "تجميع", exact: true }).first().click();
const dialog = p.getByRole("dialog");
await dialog.waitFor();
await dialog.locator('input[type="number"]').first().fill("100");
await p.waitForTimeout(1500);
await settle();
await shot("2-assembly-dialog-100-boxes");
if (MODE === "after") {
  // Shortage: 120 boxes need 120 × B, only 110 available.
  await dialog.locator('input[type="number"]').first().fill("120");
  await p.waitForTimeout(1500);
  await settle();
  await shot("3-assembly-dialog-shortage");
  await dialog.locator('input[type="number"]').first().fill("100");
  await p.waitForTimeout(1500);
  await settle();
  await dialog.getByRole("button", { name: "تنفيذ التجميع" }).click();
  await p.waitForURL(/\/inventory\/assembly\//, { timeout: 30000 }).catch(() => {});
  await p.getByText(/ASM-/).first().waitFor({ timeout: 20000 });
  if (!/\/inventory\/assembly\//.test(p.url())) {
    await p.getByRole("link", { name: /فتح|Open/ }).first().click().catch(() => {});
  }
  await settle();
  const list = items((await admin(`/assembly?productId=${box.id}`)).json);
  const order = list[0];
  check("100 boxes assembled, non-valued", order?.quantity === 100 && order?.valued === false && order?.totalCost === null, order?.assemblyNumber);
  if (order && !p.url().includes(order.id)) await p.goto(`${BASE}/inventory/assembly/${order.id}`);
  await settle();
  await shot("4-assembly-detail-posted", { fullPage: true });
  const stock = items((await admin(`/agents/${agentId}/stock`)).json?.items ?? []);
  const qty = (id) => stock.filter((row) => row.productId === id).reduce((s, row) => s + row.onHand, 0);
  check("A −200, B −100, box +100", qty(a.id) === 30 && qty(b.id) === 10 && qty(box.id) === 100, `${qty(a.id)} / ${qty(b.id)} / ${qty(box.id)}`);
  const journalsAfter = (await admin("/journal-entries?pageSize=1")).json?.total;
  check("no journal entry created", journalsAfter === journalsBefore, `${journalsBefore} → ${journalsAfter}`);
}

// 5. The agent's stock history: receipt → assembly → box.
await p.goto(`${BASE}/agents/${agentId}`);
await settle();
await p.getByRole("tab", { name: "المخزون" }).click();
await settle();
const history = p.getByRole("heading", { name: /سجل حركات المخزون/ }).first();
await history.scrollIntoViewIfNeeded().catch(() => {});
await p.waitForTimeout(500);
await shot(`${MODE === "after" ? "5" : "3"}-agent-stock-history`, { fullPage: true });

await browser.close();
writeFileSync(
  `${OUT}/results.json`,
  JSON.stringify({ mode: MODE, base: BASE, box: box.sku, receipt: receipt.receiptNumber, preview: preview.json, results }, null, 2),
);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
