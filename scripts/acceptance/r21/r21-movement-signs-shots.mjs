#!/usr/bin/env node
/**
 * Movement signs / colours — screenshots + checks on the local build (admin@oms-demo.local; password from
 * tmp/r15-manual/.env, never printed). BASE=http://localhost:3001 OUT=… node scripts/acceptance/r21/r21-movement-signs-shots.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const BASE = (process.env.BASE ?? "http://localhost:3001").replace(/\/$/, "");
const OUT = process.env.OUT ?? "specs/round21-movement-signs/evidence/after";
mkdirSync(OUT, { recursive: true });
const PW = process.env.PW ?? readFileSync("tmp/r15-manual/.env", "utf8").match(/MANUAL_PW=(.*)/)[1].trim();
const EMAIL = process.env.EMAIL ?? "admin@oms-demo.local";
const results = [];
const check = (n, ok, d = "") => { results.push({ name: n, ok: !!ok, detail: String(d) }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}  ${d}`); };
const browser = await chromium.launch();
for (const [label, viewport, locale, theme] of [["ar-light-1440", { width: 1440, height: 900 }, "ar", "light"], ["en-dark-1440", { width: 1440, height: 900 }, "en", "dark"], ["ar-light-375", { width: 375, height: 812 }, "ar", "light"]]) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme });
  await ctx.addInitScript(([l, t]) => { try { localStorage.setItem("oms.locale", JSON.stringify(l)); localStorage.setItem("theme", t); } catch { /* private */ } }, [locale, theme]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.goto(`${BASE}/inventory/movements`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  const cells = await page.locator("[data-effect]").evaluateAll((els) => els.map((el) => ({ effect: el.getAttribute("data-effect"), text: el.textContent.replace(/\s+/g, " ").trim(), cls: el.className })));
  const by = (e) => cells.filter((c) => c.effect === e);
  check(`${label}: receipts green +`, by("in").length > 0 && by("in").every((c) => c.cls.includes("text-success") && /\+\d/.test(c.text)), `${by("in").length} rows`);
  check(`${label}: issues red −`, by("out").length > 0 && by("out").every((c) => c.cls.includes("text-destructive") && /−\d/.test(c.text)), `${by("out").length} rows`);
  check(`${label}: reservations blue, available −`, by("reserve").every((c) => c.cls.includes("text-info") && /−\d/.test(c.text) && !c.cls.includes("text-destructive")), `${by("reserve").length} rows · ${by("reserve")[0]?.text ?? ""}`);
  check(`${label}: releases blue, available +`, by("release").every((c) => c.cls.includes("text-info") && /\+\d/.test(c.text) && !c.cls.includes("text-success")), `${by("release").length} rows · ${by("release")[0]?.text ?? ""}`);
  check(`${label}: no horizontal overflow`, !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.screenshot({ path: `${OUT}/movements-table-${label}.png` });
  const gridToggle = page.getByRole("button", { name: /Grid|بطاقات|شبكة/ }).first();
  if (await gridToggle.count()) {
    await gridToggle.click().catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/movements-grid-${label}.png` });
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify({ base: BASE, results }, null, 2));
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
