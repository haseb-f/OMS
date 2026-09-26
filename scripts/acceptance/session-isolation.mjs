#!/usr/bin/env node
/**
 * SEC-02 — client cache isolation across users in ONE tab + /new route access.
 *
 *   BASE=http://localhost:3001 PW_FILE=<path> node scripts/acceptance/session-isolation.mjs
 *   BASE=https://oms.haseb.org node scripts/acceptance/session-isolation.mjs   (QA_PASSWORD from tmp/.qa.env)
 *
 * One browser context, one page, no reloads between personas (client-side
 * navigation via the App Router instance, a window marker proves the JS
 * session survived):
 *   1. UI login as ADMIN_EMAIL; open /sales/orders (users lookup) and
 *      /sales/orders/new (customer picker + salesperson UserPicker) so the
 *      reference/lookup caches fill; record the admin-visible user emails.
 *   2. UI logout (profile menu) → every client cache reports empty.
 *   3. UI login as AGENT_EMAIL in the same tab; revisit the same screens.
 *      Asserts: no GET /users succeeds, the UserPicker/partner picker show
 *      none of the admin-only rows (user emails), window.__omsClientCacheStats
 *      shows a new identity with the users cache empty and no stale lookups.
 *   4. /new routes: allowed/denied for the agent exactly per its create grants
 *      (the SEC-02 override matrix in apps/web/src/navigation/route-access.ts).
 *
 * Env: BASE, API, ADMIN_EMAIL (qa-admin@oms.haseb.org), AGENT_EMAIL
 *      (qa-sales-agent@oms.haseb.org), PW / QA_PASSWORD, PW_FILE (optional
 *      per-run override: a local file holding the password — local runs only),
 *      ADMIN_PW / AGENT_PW (optional per-persona overrides), HEADED=1.
 * Passwords are never printed. Read-only: creates no records.
 */
/* global window, document */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
if (!process.env.RUN) process.env.RUN = `SEC02-ISOLATION-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
const { API, BASE, OUT, PW, createReport } = await import("./_tour-lib.mjs");

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "qa-admin@oms.haseb.org";
const AGENT_EMAIL = process.env.AGENT_EMAIL ?? "qa-sales-agent@oms.haseb.org";
const filePw = process.env.PW_FILE && existsSync(process.env.PW_FILE) ? readFileSync(process.env.PW_FILE, "utf8").trim() : "";
const ADMIN_PW = process.env.ADMIN_PW || filePw || PW;
const AGENT_PW = process.env.AGENT_PW || filePw || PW;
if (!ADMIN_PW || !AGENT_PW) {
  console.error("Password missing — set PW/QA_PASSWORD (tmp/.qa.env) or PW_FILE.");
  process.exit(2);
}

/** Mirror of CREATE_ROUTE_PERMISSIONS (apps/web/src/navigation/route-access.ts). */
const CREATE_ROUTES = {
  "/sales/quotations/new": ["sales.quotations.create"],
  "/sales/orders/new": ["sales.orders.create"],
  "/sales/invoices/new": ["sales.invoices.create"],
  "/sales/payments/new": ["sales.receipts.create"],
  "/purchasing/purchase-quotations/new": ["purchasing.quotations.create"],
  "/purchasing/purchase-orders/new": ["purchasing.orders.create"],
  "/purchasing/purchase-invoices/new": ["purchasing.invoices.create"],
  "/purchasing/payments/new": ["purchasing.payments.create"],
  "/purchasing/landed-cost/new": ["landed-cost.create"],
  "/finance/journal-entries/new": ["accounting.journal-entries.create"],
  "/hr/employees/new": ["hr.employees.create"],
  "/hr/kpi-templates/new": ["hr.kpi-templates.create"],
  "/hr/commission-plans/new": ["hr.commission-plans.create"],
  "/investors/opportunities/new": ["investment-opportunities.create"],
};
const ACCESS_DENIED = /الوصول مرفوض|Access Denied/;

const { check, assert, finish, report } = createReport("session-isolation", { admin: ADMIN_EMAIL, agent: AGENT_EMAIL });

const browser = await chromium.launch({ headless: !process.env.HEADED });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", locale: "ar-SA" });
await context.addInitScript(() => {
  try {
    if (!window.localStorage.getItem("oms.locale")) window.localStorage.setItem("oms.locale", JSON.stringify("ar"));
  } catch {
    /* storage blocked */
  }
});
const page = await context.newPage();
page.setDefaultTimeout(20000);

// ---------------------------------------------------------------- network log
let phase = "boot";
const responses = [];
page.on("response", async (res) => {
  if (!res.url().startsWith(API)) return;
  const path = res.url().slice(API.length);
  const entry = { phase, method: res.request().method(), status: res.status(), path };
  if (entry.method === "GET" && /^\/users(\?|$)/.test(path) && res.ok()) {
    try {
      const json = await res.json();
      const rows = Array.isArray(json) ? json : (json?.items ?? []);
      entry.emails = rows.map((u) => u.email).filter(Boolean);
    } catch {
      entry.emails = [];
    }
  }
  responses.push(entry);
});

// ---------------------------------------------------------------- helpers
async function settle(ms = 20000) {
  await page.waitForLoadState("networkidle", { timeout: ms }).catch(() => {});
  await page.waitForTimeout(600);
}
/** Client-side navigation (no reload) through the App Router instance. */
async function spa(path) {
  const ok = await page.evaluate((p) => {
    const router = window.next?.router;
    if (!router?.push) return false;
    router.push(p);
    return true;
  }, path);
  if (!ok) throw new Error("App Router instance (window.next.router) unavailable — cannot navigate without a reload");
  await page.waitForURL((u) => u.pathname === path.split("?")[0], { timeout: 30000 });
  await settle();
}
const marker = () => page.evaluate(() => window.__sec02Marker ?? null);
const stats = () =>
  page.evaluate(() => ({
    cache: window.__omsClientCacheStats?.() ?? null,
    lookups: typeof window.__omsLookupStats === "function" ? window.__omsLookupStats() : null,
    staleLookups: window.__omsLookupStats?.stale?.() ?? null,
  }));
async function uiLogin(email, password) {
  await page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.locator('input[name="email"], input[type="email"]').first().fill(email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
  await settle();
}
async function uiLogout() {
  await page.locator('button[aria-label="فتح قائمة الملف الشخصي"], button[aria-label="Open profile menu"]').first().click();
  await page.getByRole("menuitem", { name: /تسجيل الخروج|Log out/ }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.waitForTimeout(500);
}
/** Opens a combobox and returns the visible option texts, then closes it. */
async function optionTexts(trigger) {
  await trigger.click();
  const list = page.locator('[role="listbox"]:visible, [cmdk-list]:visible').last();
  await list.waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const texts = await page.locator('[role="option"]:visible, [cmdk-item]:visible').allInnerTexts().catch(() => []);
  await page.keyboard.press("Escape");
  return texts;
}
/** Customer PartnerPicker = first combobox in the editor; salesperson UserPicker behind "تفاصيل إضافية". */
async function exerciseEditorPickers() {
  const out = { partnerOptions: [], userOptions: [] };
  const combos = page.locator("main [role='combobox']");
  if ((await combos.count()) > 0) out.partnerOptions = await optionTexts(combos.first());
  const more = page.getByRole("button", { name: /تفاصيل إضافية|More details/ }).first();
  if (await more.count()) {
    await more.click();
    await page.waitForTimeout(500);
    const label = page.locator("label", { hasText: /مندوب المبيعات|البائع|Salesperson/ }).first();
    const forId = (await label.count()) ? await label.getAttribute("for") : null;
    const trigger = forId ? page.locator(`[id="${forId}"]`) : null;
    if (trigger && (await trigger.count()) && (await trigger.isEnabled())) out.userOptions = await optionTexts(trigger);
    else out.userPickerDisabled = true;
  }
  return out;
}
async function tokenPermissions() {
  const token = (await context.cookies()).find((c) => c.name === "oms_token")?.value;
  const res = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const me = await res.json();
  return { isSuperAdmin: !!me.isSuperAdmin, permissions: me.permissions ?? [], id: me.id };
}

// ---------------------------------------------------------------- run
try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await settle();
  await page.evaluate(() => {
    window.__sec02Marker = `m-${Date.now()}`;
  });
  const sessionMarker = await marker();

  // 1. admin
  phase = "admin";
  await uiLogin(ADMIN_EMAIL, ADMIN_PW);
  await spa("/sales/orders");
  await spa("/sales/orders/new");
  const adminPickers = await exerciseEditorPickers();
  const adminStats = await stats();
  const adminUserEmails = [...new Set(responses.filter((r) => r.phase === "admin" && r.emails).flatMap((r) => r.emails))];
  check("admin.cachesFilled", adminStats.cache?.caches?.users > 0 && adminStats.cache?.caches?.lookups > 0 ? "PASS" : "BLOCKED",
    `users=${adminStats.cache?.caches?.users} lookups=${adminStats.cache?.caches?.lookups} (precondition: admin caches must hold data)`,
    { caches: adminStats.cache?.caches, partnerOptions: adminPickers.partnerOptions.length, userOptions: adminPickers.userOptions.length });
  assert("admin.usersFetched", adminUserEmails.length > 0, `admin GET /users returned ${adminUserEmails.length} emails`);
  const adminIdentity = adminStats.cache?.identity;

  // 2. logout
  phase = "logout";
  await uiLogout();
  const afterLogout = await stats();
  assert("sameTab.afterLogout", (await marker()) === sessionMarker, "window marker survived → no reload between personas");
  const leftover = Object.entries(afterLogout.cache?.caches ?? {}).filter(([, n]) => n > 0);
  assert("logout.cachesEmpty", afterLogout.cache && leftover.length === 0 && afterLogout.staleLookups === 0,
    leftover.length ? `non-empty: ${JSON.stringify(leftover)}` : `identity=${afterLogout.cache?.identity} resets=${afterLogout.cache?.resets}`);
  const storageLeft = await page.evaluate(() =>
    ["oms.sales.recentCustomers", "oms.purchasing.recentSuppliers", "oms.sidebar.authorizedItems", "oms.sidebar.recentPages"].filter((k) => window.localStorage.getItem(k) !== null),
  );
  assert("logout.perUserStorageCleared", storageLeft.length === 0, storageLeft.join(", "));

  // 3. agent in the same tab
  phase = "agent";
  await uiLogin(AGENT_EMAIL, AGENT_PW);
  assert("sameTab.afterAgentLogin", (await marker()) === sessionMarker, "still the same JS session");
  const agent = await tokenPermissions();
  await spa("/sales/orders");
  await spa("/sales/orders/new");
  const agentPickers = await exerciseEditorPickers();
  const agentStats = await stats();

  const agentUsersOk = responses.filter((r) => r.phase === "agent" && r.method === "GET" && /^\/users(\?|$)/.test(r.path) && r.status < 300);
  const agentCanListUsers = agent.isSuperAdmin || agent.permissions.includes("settings.manage");
  if (agentCanListUsers) check("agent.noUsersRequest", "SKIP", "agent holds settings.manage — users list is legitimately visible");
  else assert("agent.noUsersRequest", agentUsersOk.length === 0, `${agentUsersOk.length} successful GET /users in agent phase`);

  const agentOwnEmail = AGENT_EMAIL.toLowerCase();
  const adminOnly = adminUserEmails.filter((e) => e.toLowerCase() !== agentOwnEmail);
  const shown = [...agentPickers.userOptions, ...agentPickers.partnerOptions].join("\n").toLowerCase();
  const leaked = agentCanListUsers ? [] : adminOnly.filter((e) => shown.includes(e.toLowerCase()));
  assert("agent.userPickerNoAdminRows", leaked.length === 0,
    `userOptions=${agentPickers.userOptions.length}${agentPickers.userPickerDisabled ? " (picker disabled)" : ""} leakedEmails=${leaked.length}`);
  assert("agent.cacheIdentityChanged", agentStats.cache?.identity && agentStats.cache.identity !== adminIdentity, "fingerprint differs from admin");
  assert("agent.usersCacheEmpty", agentCanListUsers || agentStats.cache?.caches?.users === 0, `users=${agentStats.cache?.caches?.users}`);
  assert("agent.noStaleLookups", agentStats.staleLookups === 0, `stale=${agentStats.staleLookups}`);

  // 4. /new route matrix for the agent
  phase = "routes";
  for (const [route, keys] of Object.entries(CREATE_ROUTES)) {
    const expected = agent.isSuperAdmin || keys.some((k) => agent.permissions.includes(k));
    await spa(route);
    await page.waitForTimeout(800);
    const text = (await page.locator("main").first().innerText().catch(() => "")) || "";
    const denied = ACCESS_DENIED.test(text.slice(0, 2000));
    assert(`route${route}`, denied === !expected, `${expected ? "expected ALLOWED" : "expected DENIED"} (${keys.join("|")}) → ${denied ? "denied" : "allowed"}`);
  }
  // Detail routes keep view: a view-less role must not reach them (agent has sales.orders.view → allowed shell).
} catch (error) {
  check("run.error", "FAIL", error instanceof Error ? error.message : String(error));
  await page.screenshot({ path: resolve(OUT, "session-isolation-error.png") }).catch(() => {});
} finally {
  report.network = responses.map(({ emails, ...r }) => ({ ...r, emailCount: emails?.length }));
  finish("session-isolation-report.json");
  await browser.close();
  process.exitCode = report.checks.some((c) => c.status === "FAIL") ? 1 : 0;
}
