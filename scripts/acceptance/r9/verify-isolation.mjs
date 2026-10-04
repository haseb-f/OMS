import { chromium, login, apiToken, PERSONAS, BASE, API, mkdirSync } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const OUT = "D:/Systems/OMS-r9-brand-grid/specs/round9-brand-grid/evidence";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};

const PERSONA = {
  "A admin": PERSONAS.agentAdmin,
  "A sales": PERSONAS.agentSales,
  "B admin": "agent-b-admin.demo-agt@oms.local",
};
const ROUTES = [
  "/agent/orders",
  "/agent/leads",
  "/agent/stock",
  "/agent/payouts",
  "/agent/statement",
];
const FORBIDDEN =
  /(هامش الربح|margin|تكلفة الشركة|company cost|internal cost|purchase price|سعر الشراء)/i;
const REFS = {
  "/agent/orders": /STO-[\w-]+/g,
  "/agent/leads": /LD-[\w-]+/g,
  "/agent/stock": /PRD-[\w-]+/g,
  "/agent/payouts": /APO-[\w-]+/g,
  "/agent/statement": /(?:STO|PAY|APO)-[\w-]+/g,
};

const b = await chromium.launch();
const seen = {};
for (const [who, email] of Object.entries(PERSONA)) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, email);
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1400);
    const toggle = page.locator('[data-view-toggle] [data-view="grid"]').first();
    if (!(await toggle.count())) {
      const denied = /(غير مصرح|لا تملك|Access denied|ليس لديك|لا يوجد صلاحية)/i.test(
        await page.locator("body").innerText(),
      );
      check(
        `${who} ${route}: no switch = the page is not permitted for this role`,
        denied,
        denied ? "access denied (permission)" : "NO SWITCH AND NOT DENIED",
      );
      continue;
    }
    const tableText = await page.evaluate(() => document.querySelector("table")?.innerText ?? "");
    await toggle.click();
    await page.waitForTimeout(900);
    const gridText = await page.evaluate(() =>
      [...document.querySelectorAll("[data-record-grid] [data-record-card]")]
        .map((c) => c.innerText)
        .join("\n"),
    );
    const REF = REFS[route];
    const refsT = new Set(tableText.match(REF) ?? []);
    const refsG = new Set(gridText.match(REF) ?? []);
    const same =
      refsT.size === refsG.size &&
      [...refsT].every((r) => refsG.has(r)) &&
      (refsT.size > 0 || /(لا توجد|No results|لا يوجد|empty)/i.test(tableText));
    check(
      `${who} ${route}: grid shows the same records as the table`,
      same,
      `table ${refsT.size} refs / grid ${refsG.size} refs`,
    );
    check(
      `${who} ${route}: no restricted cost/margin wording in cards`,
      !FORBIDDEN.test(gridText),
      (gridText.match(FORBIDDEN) ?? [""])[0],
    );
    seen[`${who}|${route}`] = refsG;
    await page
      .locator('[data-view-toggle] [data-view="table"]')
      .first()
      .click()
      .catch(() => {});
  }
  await ctx.close();
}
await b.close();
// Cross-agent: agent A and agent B never see each other's records, in the grid view.
for (const route of ROUTES) {
  const a = seen[`A admin|${route}`] ?? new Set();
  const bb = seen[`B admin|${route}`] ?? new Set();
  const overlap = [...a].filter((r) => bb.has(r));
  check(
    `agent A vs agent B ${route}: grid records are disjoint`,
    overlap.length === 0,
    `A ${a.size}, B ${bb.size}, shared ${overlap.length}`,
  );
}
// API level (authoritative): every page of the portal lists, per agent user.
const allIds = async (tok, path) => {
  const ids = new Set();
  for (let page = 1; page < 60; page += 1) {
    const r = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}page=${page}`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) return { status: r.status, ids };
    const j = await r.json();
    const items = j.items ?? [];
    items.forEach((it) => ids.add(it.id));
    if (items.length === 0 || ids.size >= (j.total ?? 0)) break;
  }
  return { status: 200, ids };
};
for (const path of ["/agent-portal/orders", "/agent-portal/leads"]) {
  const A = await allIds(await apiToken(PERSONA["A admin"]), path);
  const S = await allIds(await apiToken(PERSONA["A sales"]), path);
  const B = await allIds(await apiToken(PERSONA["B admin"]), path);
  const shared = [...A.ids].filter((id) => B.ids.has(id));
  check(
    `API ${path}: agent A and agent B share no record`,
    shared.length === 0,
    `A ${A.ids.size}, B ${B.ids.size}, shared ${shared.length}`,
  );
  check(
    `API ${path}: agent A sales (own scope) ⊆ agent A admin`,
    [...S.ids].every((id) => A.ids.has(id)),
    `sales ${S.ids.size} ⊆ admin ${A.ids.size}`,
  );
}
writeFileSync(`${OUT}/isolation-run.json`, JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
