import { chromium, login, PERSONAS, BASE, mkdirSync } from "./lib.mjs";
const TAG = process.env.TAG ?? "palette";
const OUT = `D:/Systems/OMS-r9-brand-grid/specs/round9-brand-grid/evidence/${TAG}`;
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
for (const [locale, scheme] of [
  ["ar", "light"],
  ["en", "dark"],
]) {
  const ctx = await b.newContext({
    viewport: { width: 1440, height: 900 },
    locale,
    colorScheme: scheme,
  });
  const page = await login(ctx, PERSONAS.admin);
  for (const [name, path] of [
    ["store-orders", "/store-orders"],
    ["shipping", "/shipping"],
    ["report", "/reports/finance"],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${name}-${locale}-${scheme}.png` });
  }
  await page.goto(`${BASE}/settings/users`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);
  const add = page.getByRole("button", { name: /(مستخدم جديد|New user|Add user)/i }).first();
  if (await add.count()) {
    await add.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/dialog-user-${locale}-${scheme}.png` });
  }
  await ctx.close();
}
await b.close();
console.log("done");
