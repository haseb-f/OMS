#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R12 — dropdown appearance audit. Visits the shell routes (plus the editor /
 * new pages), and for every selector trigger classifies where it sits:
 *   - toolbar  : inside a list toolbar / selector row (carries a tone)  -> must be strong blue
 *   - form     : data-surface="form"                                   -> must be very light
 *   - other    : a dark default-tone trigger outside any toolbar/form  -> a candidate to fix
 *
 *   BASE=http://localhost:4701 node scripts/acceptance/r12/dropdown-audit.mjs [extra routes...]
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:4701").replace(/\/$/, "");
const env = Object.fromEntries(
  readFileSync("D:/Systems/OMS/tmp/r7-final/.r7.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const routes = JSON.parse(readFileSync("D:/Systems/OMS/scripts/acceptance/r11/company-routes.json", "utf8"));
const extra = [
  "/sales/invoices/new",
  "/sales/quotations/new",
  "/sales/orders/new",
  "/purchasing/purchase-orders/new",
  "/purchasing/purchase-quotations/new",
  "/sales/payments/new",
  "/store-orders/import",
  "/settings/general",
  "/settings/users",
  "/profile",
  ...process.argv.slice(2),
];
const all = [...new Set([...routes.filter((r) => !r.includes("[")), ...extra])];

const lum = (rgb) => {
  if (/^oklab\(/.test(rgb)) return Number(rgb.match(/[\d.]+/)[0]) ** 3;
  const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
await ctx.addInitScript(() => {
  localStorage.setItem("oms.locale", JSON.stringify("ar"));
  localStorage.setItem("theme", "light");
});
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"], input[name="email"]').first().fill("demo-r7-admin@oms.local");
await page.locator('input[type="password"]').first().fill(env.R7_PW);
await page.locator('input[type="password"]').first().press("Enter");
while (new URL(page.url()).pathname.includes("/login")) await page.waitForTimeout(300);

const report = [];
for (const route of all) {
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-select-trigger]:not([data-variant="ghost"]), [data-button][data-variant="field"]')].map((el) => {
        const s = getComputedStyle(el);
        return {
          surface: el.getAttribute("data-surface"),
          tone: el.getAttribute("data-toolbar-tone"),
          bg: s.backgroundColor,
          inToolbar: !!el.closest('[data-slot="list-toolbar"], [data-slot="selector-row"]'),
          inForm: !!el.closest("form, [role=dialog]"),
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
        };
      }),
    );
    const summary = { route, total: rows.length, toolbar: 0, form: 0, other: [], lightToolbar: [], darkForm: [] };
    for (const r of rows) {
      const dark = lum(r.bg) < 0.25;
      if (r.surface === "form") {
        summary.form += 1;
        if (dark) summary.darkForm.push(r.label);
      } else if (r.tone || r.inToolbar) {
        summary.toolbar += 1;
        if (!dark) summary.lightToolbar.push(r.label);
      } else if (dark) summary.other.push(r.label);
    }
    report.push(summary);
    if (summary.other.length || summary.darkForm.length || summary.lightToolbar.length) {
      console.log(`${route}  total=${summary.total} toolbar=${summary.toolbar} form=${summary.form}  OTHER-DARK=${JSON.stringify(summary.other)} DARK-FORM=${JSON.stringify(summary.darkForm)} LIGHT-TOOLBAR=${JSON.stringify(summary.lightToolbar)}`);
    }
  } catch (error) {
    console.log(`${route}  ERROR ${String(error).slice(0, 80)}`);
  }
}
await browser.close();
writeFileSync("D:/Systems/OMS/specs/round12-contextual-ui/evidence/dropdown-audit.json", JSON.stringify(report, null, 2));
const tot = report.reduce((a, r) => ({ toolbar: a.toolbar + r.toolbar, form: a.form + r.form, other: a.other + r.other.length }), { toolbar: 0, form: 0, other: 0 });
console.log(`\nroutes=${report.length} toolbar-triggers=${tot.toolbar} form-triggers=${tot.form} dark-outside-toolbar/form=${tot.other}`);
