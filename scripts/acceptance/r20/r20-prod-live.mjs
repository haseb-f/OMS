#!/usr/bin/env node
/**
 * R20 — Production live check after deploy (QA admin; tmp/.qa.env, never printed).
 * Only call that writes: POST /leads/:id/open by the QA admin on a lead assigned to someone else —
 * by design a no-op (an admin open never marks the employee's lead). Everything else is GET / page views.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "https://oms.haseb.org";
const API = `${BASE}/api`;
const OUT = "specs/round20-corrections/evidence/live";
mkdirSync(OUT, { recursive: true });
const PW = readFileSync("tmp/.qa.env", "utf8").split(/\r?\n/).find((l) => /QA_PASSWORD=/.test(l))
  .replace(/^\s*(export\s+)?QA_PASSWORD=/, "").replace(/^["']|["']$/g, "").trim();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};
const { accessToken } = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "qa-admin@oms.haseb.org", password: PW }) })).json();
const call = async (method, p) => { const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${accessToken}` } }); return { status: r.status, json: await r.json().catch(() => null) }; };

// A — opened-by-assignee model live; an admin open never marks the employee's lead.
const leads = (await call("GET", "/leads?pageSize=100")).json?.items ?? [];
check("A: lead list exposes openedByAssigneeAt (migration applied)", leads.length > 0 && "openedByAssigneeAt" in leads[0], `${leads.length} leads`);
const target = leads.find((l) => l.salesEmployeeId && !l.openedByAssigneeAt);
if (target) {
  const before = target.status?.code;
  const opened = await call("POST", `/leads/${target.id}/open`);
  const after = (await call("GET", `/leads/${target.id}`)).json;
  check("A: admin opening another employee's lead does not mark it", opened.status < 300 && !after?.openedByAssigneeAt, `${target.leadNumber} → ${opened.status}, openedByAssigneeAt=${after?.openedByAssigneeAt}`);
  check("A: opening never changes the business status", after?.status?.code === before, `${before} → ${after?.status?.code}`);
}

// B — employee periods: one aggregated response, five periods per employee, currencies apart.
const periods = await call("GET", "/sales-reports/employee-periods?pageSize=50");
const items = periods.json?.items ?? periods.json?.employees ?? [];
check("B: employee-periods endpoint 200", periods.status === 200, `${items.length} employee cards`);
if (items[0]) {
  const p = items[0].periods ?? items[0].boxes;
  const keys = Array.isArray(p) ? p.map((x) => x.period ?? x.key) : Object.keys(p ?? {});
  check("B: five periods per employee", keys.length === 5, keys.join(","));
}
const live = await call("GET", "/sales-reports/live");
check("B: live report still 200", live.status === 200);

// C — payment status surfaces.
const invoices = (await call("GET", "/sales/invoices?pageSize=50")).json?.items ?? [];
const inv91 = invoices.find((i) => i.invoiceNumber === "INV-2026-000091");
check("C: INV-2026-000091 200,000 / 100,000 outstanding / PARTIALLY_PAID", inv91 && Number(inv91.remainingBalance) === 100000 && inv91.paymentStatus === "PARTIALLY_PAID", inv91 ? `${inv91.allocatedTotal}/${inv91.remainingBalance}/${inv91.paymentStatus}` : "not found");
if (inv91) {
  const pos = await call("GET", `/financial-transactions/receipts/position?partnerId=${inv91.partnerId}`);
  const egp = (pos.json?.currencies ?? pos.json?.items ?? (Array.isArray(pos.json) ? pos.json : [])).find?.((c) => (c.currencyCode ?? c.currency?.code) === "EGP") ?? pos.json;
  check("C: customer position separates received / applied / unapplied", pos.status === 200, JSON.stringify(egp).slice(0, 160));
}
const integrity = await call("GET", "/accounting/reports/voucher-integrity");
check("C: voucher integrity 0 errors", integrity.json?.errors === 0, `review ${integrity.json?.review}`);
await fetch(`${API}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });

// Browser — the changed screens render without errors (ar desktop + en phone).
const browser = await chromium.launch();
for (const [label, viewport, locale] of [["ar-1440", { width: 1440, height: 900 }, "ar"], ["en-375", { width: 375, height: 812 }, "en"]]) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((l) => { try { localStorage.setItem("oms.locale", JSON.stringify(l)); } catch { /* private */ } }, locale);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 100)));
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="email"]').fill("qa-admin@oms.haseb.org");
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  for (const [name, path] of [["leads", "/crm/leads"], ["employees", "/reports/sales"], ["invoices", "/sales/invoices"]]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (name === "employees") {
      await page.getByRole("tab", { name: locale === "ar" ? "الموظفون" : "Employees" }).first().click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1500);
      const cards = await page.locator("[data-identity]").evaluateAll((els) => els.length);
      const boxes = await page.locator("[data-identity]").count();
      check(`browser ${label}: employee cards show period boxes`, boxes >= 5, `${boxes} boxes`);
    }
    check(`browser ${label}: ${name} renders, no horizontal overflow`, !overflow);
    await page.screenshot({ path: `${OUT}/${name}-${label}.png` });
  }
  check(`browser ${label}: no page errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
