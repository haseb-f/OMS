import { chromium, login, PERSONAS, BASE, mkdirSync } from "./lib.mjs";

const OUT = "D:/Systems/OMS-r8-home/specs/round8-home-dashboard/evidence";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const results = [];
const summary = (page) =>
  page.evaluate(() => {
    const sel =
      '[data-select-trigger], [data-button][data-variant="field"], [data-button][data-variant="menu"]';
    const inDialog = [
      ...document.querySelectorAll('[role="dialog"] ' + sel.split(", ").join(', [role="dialog"] ')),
    ];
    const by = {};
    for (const e of inDialog) {
      if (e.getBoundingClientRect().width === 0) continue;
      const k = `${e.getAttribute("data-toolbar-tone") ?? "default"} ${getComputedStyle(e).backgroundColor}`;
      by[k] = (by[k] || 0) + 1;
    }
    return by;
  });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
const page = await login(ctx, PERSONAS.admin);

// Create form: New product (many selects + searchable comboboxes).
await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1200);
const add = page
  .getByRole("button", { name: /(منتج جديد|إضافة منتج|New product|Add product)/i })
  .first();
if (await add.count()) {
  await add.click();
  await page.waitForTimeout(1200);
  results.push(["create: new product dialog", await summary(page)]);
  await page.screenshot({ path: `${OUT}/forms-create-product-ar-light.png` });
  await page.keyboard.press("Escape");
} else results.push(["create: new product dialog", "button not found"]);

// Edit form: first user row → edit.
await page.goto(`${BASE}/settings/users`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(1200);
const rowMenu = page.locator("table tbody tr").first().getByRole("button").last();
if (await rowMenu.count()) {
  await rowMenu.click();
  await page.waitForTimeout(400);
  const edit = page.getByRole("menuitem", { name: /(تعديل|Edit)/i }).first();
  if (await edit.count()) {
    await edit.click();
    await page.waitForTimeout(1400);
    results.push(["edit: user dialog", await summary(page)]);
    await page.screenshot({ path: `${OUT}/forms-edit-user-ar-light.png` });
  } else results.push(["edit: user dialog", "edit item not found"]);
} else results.push(["edit: user dialog", "row menu not found"]);
await b.close();
for (const [name, s] of results) console.log(name, JSON.stringify(s));
