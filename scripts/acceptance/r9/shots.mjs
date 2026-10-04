import { chromium, login, PERSONAS, BASE, mkdirSync } from "./lib.mjs";
const TAG = process.env.TAG ?? "after";
const OUT = `D:/Systems/OMS-r9-brand-grid/specs/round9-brand-grid/evidence/${TAG}`;
mkdirSync(OUT, { recursive: true });
const screens = (
  process.env.SCREENS ?? "sales/customers,sales/invoices,store-orders,products,crm/leads,agents"
).split(",");
const grid = process.env.GRID !== "0";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
const page = await login(ctx, PERSONAS[process.env.WHO ?? "admin"]);
for (const s of screens) {
  await page.goto(`${BASE}/${s}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1800);
  const name = s.replace(/\//g, "-");
  await page.screenshot({ path: `${OUT}/${name}-table.png` });
  if (grid) {
    const toggle = page.locator('[data-view-toggle] [data-view="grid"]').first();
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/${name}-grid.png` });
      await page.locator('[data-view-toggle] [data-view="table"]').first().click();
    } else console.log("no grid toggle on", s);
  }
}
await b.close();
console.log("done", TAG);
