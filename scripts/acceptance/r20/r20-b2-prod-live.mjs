#!/usr/bin/env node
/** R20 B2 — read-only Production check of the employee cards (QA admin; tmp/.qa.env, never printed). */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const BASE = process.env.BASE ?? "https://oms.haseb.org";
const OUT = "specs/round20-corrections/evidence/b2/live";
mkdirSync(OUT, { recursive: true });
const PW = readFileSync("tmp/.qa.env", "utf8").split(/\r?\n/).find((l) => /QA_PASSWORD=/.test(l)).replace(/^\s*(export\s+)?QA_PASSWORD=/, "").replace(/^["']|["']$/g, "").trim();
const results = [];
const check = (n, ok, d = "") => { results.push({ name: n, ok: !!ok, detail: String(d) }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}  ${d}`); };
const browser = await chromium.launch();
for (const [label, viewport, locale, theme] of [["ar-light-1440", { width: 1440, height: 900 }, "ar", "light"], ["en-dark-1440", { width: 1440, height: 900 }, "en", "dark"], ["ar-light-375", { width: 375, height: 812 }, "ar", "light"]]) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme });
  await ctx.addInitScript(([l, t]) => { try { localStorage.setItem("oms.locale", JSON.stringify(l)); localStorage.setItem("theme", t); } catch { /* private */ } }, [locale, theme]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 100)));
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="email"]').fill("qa-admin@oms.haseb.org");
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.goto(`${BASE}/reports/sales`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("tab", { name: locale === "ar" ? "الموظفون" : "Employees" }).first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1800);
  const frames = await page.locator('[data-slot="insight-frame"]').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), rows: el.querySelectorAll("[data-identity]").length }; }));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(`${label}: employee cards with five period rows`, frames.length > 0 && frames.every((f) => f.rows >= 5), `${frames.length} cards`);
  if (viewport.width >= 1280 && frames.length >= 2) {
    const [a, b] = frames;
    check(`${label}: first two cards side by side, same size`, a.top === b.top && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1 && a.w < viewport.width * 0.5, `${a.w}×${a.h} | ${b.w}×${b.h}`);
  }
  if (viewport.width < 768) check(`${label}: one card per row`, frames.length < 2 || frames[1].top > frames[0].top, "");
  check(`${label}: no horizontal overflow`, !overflow);
  check(`${label}: no page errors`, errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: `${OUT}/employees-${label}.png` });
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
