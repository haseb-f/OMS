import { chromium, login, PERSONAS, BASE, mkdirSync } from "./lib.mjs";

const TAG = process.env.TAG ?? "states";
const OUT = `D:/Systems/OMS-r9-brand-grid/specs/round9-brand-grid/evidence/${TAG}`;
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
const b = await chromium.launch();

// ---- interaction states on Sales invoices (company), AR light desktop ----
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, PERSONAS.admin);
  await page.goto(`${BASE}/sales/invoices`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('[data-view-toggle] [data-view="grid"]').first().click();
  await page.waitForTimeout(900);
  const cards = page.locator("[data-record-grid] [data-record-card]");
  const card = cards.nth(1);
  const style = () =>
    card.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        transform: cs.transform,
        border: cs.borderTopColor,
        shadow: cs.boxShadow.length,
        outline: cs.outlineStyle,
        bg: cs.backgroundImage.slice(0, 60),
      };
    });
  const rest = await style();
  await card.screenshot({ path: `${OUT}/card-default.png` });
  await card.hover();
  await page.waitForTimeout(350);
  const hover = await style();
  await card.screenshot({ path: `${OUT}/card-hover.png` });
  check(
    "hover: elevation + stronger edge (paint-only)",
    hover.transform !== rest.transform && hover.border !== rest.border,
    `${hover.transform}`,
  );
  await page.mouse.move(3, 3);
  // keyboard focus: tab to the card's link
  await card.locator("[data-record-link]").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  const focus = await card.evaluate((el) => ({
    ring: getComputedStyle(el).outlineStyle + " " + getComputedStyle(el).outlineWidth,
    linkFocused: el.contains(document.activeElement),
  }));
  const bb = await card.boundingBox();
  await page.screenshot({
    path: `${OUT}/card-focus.png`,
    clip: {
      x: Math.max(0, bb.x - 10),
      y: Math.max(0, bb.y - 10),
      width: bb.width + 20,
      height: bb.height + 20,
    },
  });
  check(
    "focus: 2px ring around the whole card",
    focus.linkFocused && /solid 2px/.test(focus.ring),
    JSON.stringify(focus),
  );
  // selection: the checkbox, not the card, selects; the strip shows count + scope
  const before = page.url();
  await card.locator('[role="checkbox"]').click();
  await page.waitForTimeout(500);
  check("clicking the checkbox does NOT open the record", page.url() === before, page.url());
  check("selected card state is set", (await card.getAttribute("data-state")) === "selected", "");
  const strip = await page.locator("[data-bulk-strip]").count();
  check("bulk strip appears with the selection", strip > 0, `${strip}`);
  await page.screenshot({ path: `${OUT}/selected-with-bulk-strip.png` });
  // kebab never opens the record either
  await card.locator('button[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(400);
  check(
    "kebab menu opens without navigating",
    page.url() === before && (await page.locator('[role="menu"]').count()) > 0,
    "",
  );
  await page.screenshot({ path: `${OUT}/card-menu-open.png` });
  await page.keyboard.press("Escape");
  // body click opens the record (stretched link)
  await page
    .locator("[data-bulk-strip] button")
    .first()
    .waitFor({ timeout: 1000 })
    .catch(() => {});
  // empty state
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  const search = page
    .locator('input[type="search"], input[placeholder*="تصفية"], input[placeholder*="Filter"]')
    .first();
  await search.fill("zzzz-no-such-record-9");
  await page.waitForTimeout(1800);
  check(
    "grid keeps the chosen view after reload (per-user preference)",
    (await page.locator("[data-table-view='grid']").count()) > 0,
    "",
  );
  await page.screenshot({ path: `${OUT}/empty-state-grid.png` });
  await ctx.close();
}

// ---- loading skeleton (delay the list request) ----
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, PERSONAS.admin);
  await page.goto(`${BASE}/sales/customers`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator('[data-view-toggle] [data-view="grid"]').first().click();
  await page.route("**/partners**", async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  await page.locator('input[type="search"], input[placeholder*="تصفية"]').first().fill("A");
  await page.waitForTimeout(1200);
  const skeletons = await page.locator("[data-record-grid][aria-busy] [data-record-card]").count();
  check("loading state draws card skeletons", skeletons > 0, `${skeletons}`);
  await page.screenshot({ path: `${OUT}/loading-skeleton-grid.png` });
  await ctx.close();
}

// ---- responsive: 390 (AR light), 768, EN dark desktop ----
for (const [name, vp, locale, scheme, mobile] of [
  ["mobile-390", { width: 390, height: 844 }, "ar", "light", true],
  ["tablet-768", { width: 768, height: 1024 }, "ar", "light", false],
  ["en-dark-1440", { width: 1440, height: 900 }, "en", "dark", false],
]) {
  const ctx = await b.newContext({ viewport: vp, locale, colorScheme: scheme, isMobile: mobile });
  const page = await login(ctx, PERSONAS.admin);
  for (const route of ["/sales/orders", "/sales/customers", "/sales/invoices"]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1300);
    const toggle = page.locator('[data-view-toggle] [data-view="grid"]').first();
    if (await toggle.count()) await toggle.click();
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const g = document.querySelector("[data-record-grid]");
      const cols = g ? getComputedStyle(g).gridTemplateColumns.split(" ").length : 0;
      return {
        cols,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check(
      `${name} ${route}: no horizontal overflow, ${m.cols} column(s)`,
      m.overflow <= 0,
      JSON.stringify(m),
    );
    await page.screenshot({ path: `${OUT}/${name}${route.replace(/\//g, "-")}-grid.png` });
  }
  await ctx.close();
}
await b.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
