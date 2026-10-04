// Local review only: needs the demo stack (web :4601, API :4605, DB oms_r7_final) and tmp/r7-final/.r7.env. On Git Bash set MSYS_NO_PATHCONV=1 when passing /routes in env vars.
import { chromium, login, PERSONAS, BASE, mkdirSync } from "./lib.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const OUT = "D:/Systems/OMS-r9-brand-grid/specs/round9-brand-grid/evidence";
mkdirSync(OUT, { recursive: true });
const who = process.env.WHO ?? "admin";
const routes = (
  process.env.ROUTES
    ? process.env.ROUTES.split(",")
    : readFileSync("D:/Systems/OMS-r9-brand-grid/tmp/r9/routes.txt", "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
).filter((r) => !r.startsWith("/design-system"));
const shots = process.env.SHOTS === "1";

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
const page = await login(ctx, PERSONAS[who]);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
const results = [];
for (const route of routes) {
  errors.length = 0;
  const row = { route };
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1300);
    const toggle = page.locator('[data-view-toggle] [data-view="grid"]').first();
    row.toggle = (await toggle.count()) > 0;
    if (row.toggle) {
      await toggle.click();
      await page.waitForTimeout(900);
      const m = await page.evaluate(() => {
        const cards = document.querySelectorAll("[data-record-grid] [data-record-card]");
        const boxes = document.querySelectorAll(
          "[data-record-grid] [data-record-card] [role=checkbox]",
        );
        const empty = document.querySelector("[data-record-grid]") === null;
        const first = cards[0];
        return {
          cards: cards.length,
          checkboxes: boxes.length,
          noGrid: empty,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          text: first ? first.textContent.replace(/\s+/g, " ").slice(0, 90) : "",
        };
      });
      Object.assign(row, m);
      if (shots)
        await page.screenshot({ path: `${OUT}/coverage-${route.replace(/\//g, "-")}.png` });
      // back to the table so the saved preference never leaks into the next run
      await page
        .locator('[data-view-toggle] [data-view="table"]')
        .first()
        .click()
        .catch(() => {});
    }
  } catch (e) {
    row.error = String(e.message).slice(0, 100);
  }
  row.pageErrors = errors.length;
  results.push(row);
  console.log(JSON.stringify(row));
}
await b.close();
writeFileSync(`${OUT}/coverage-run-${who}.json`, JSON.stringify(results, null, 1));
const noToggle = results.filter((r) => !r.toggle);
const bad = results.filter((r) => r.toggle && (r.overflow > 0 || r.pageErrors > 0 || r.error));
console.log(
  `\n${results.length} routes; no switch: ${noToggle.map((r) => r.route).join(" ") || "none"}; problems: ${bad.map((r) => r.route).join(" ") || "none"}`,
);
