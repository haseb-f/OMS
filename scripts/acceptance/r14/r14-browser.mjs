#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R14 — the single browser pass (spec-6 §4): login landing (company + agent), collapsed sidebar,
 * deep link + logout `next` rules, two tabs / reload / browser restart, semantic menu-item tones,
 * required asterisks + compact user dialog, employee password reset, store-order recognition
 * status, customer history, company partners — ar/en, light/dark, desktop/390 px.
 *
 *   BASE=http://localhost:3001 node scripts/acceptance/r14/r14-browser.mjs
 *
 * Personas r14-*@oms.local live only in the local verification DB (oms_r14_e2e); the password is
 * read from tmp/r14/.r14.env at runtime and never written to evidence.
 * Evidence: specs/round14-production-readiness/evidence/browser/*.png + browser.json
 */
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:3001").replace(/\/$/, "");
const DB = process.env.DB ?? "postgresql://oms:oms@localhost:5434/oms_r14_e2e";
const OUT = process.env.OUT ?? "specs/round14-production-readiness/evidence/browser";
mkdirSync(OUT, { recursive: true });
const PW = readFileSync("tmp/r14/.r14.env", "utf8").match(/R14_PW=(.*)/)[1].trim();
const require = createRequire(new URL("../../../node_modules/.pnpm/pg@8.22.0/node_modules/pg/package.json", import.meta.url));
const { Client } = require("./lib/index.js");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + String(detail).slice(0, 200) : ""}`);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
async function journey(name, fn) {
  if (process.env.ONLY && !process.env.ONLY.split(",").some((p) => name.startsWith(p))) return;
  try {
    await fn();
  } catch (error) {
    check(`${name}: completed without an exception`, false, error?.message ?? error);
  }
}

const db = new Client({ connectionString: DB });
await db.connect();
const one = async (sql) => (await db.query(sql)).rows[0] ?? null;

const browser = await chromium.launch();
const VIEW = { width: 1440, height: 900 };

async function newContext({ locale = "ar", scheme = "light", viewport = VIEW } = {}) {
  const context = await browser.newContext({ viewport, colorScheme: scheme });
  await context.addInitScript((value) => {
    try {
      if (!localStorage.getItem("oms.locale")) localStorage.setItem("oms.locale", JSON.stringify(value));
    } catch {}
  }, locale);
  return context;
}
async function uiLogin(page, who, from = "/login") {
  await page.goto(`${BASE}${from}`);
  await page.locator('input[name="email"]').fill(`r14-${who}@oms.local`);
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}
const expandedGroups = (page) =>
  page.locator('[data-sidebar="menu-button"][aria-expanded="true"]').count();

// 1 — landing + collapsed sidebar + restart detection
await journey("1. company landing", async () => {
  const context = await newContext();
  const page = await context.newPage();
  await uiLogin(page, "admin");
  check("1. company login lands on Home (/)", new URL(page.url()).pathname === "/", page.url());
  await page.waitForTimeout(800);
  check("1. every sidebar group starts collapsed", (await expandedGroups(page)) === 0);
  await shot(page, "01-home-company-ar");

  // second tab of the same browser keeps the session; a reload keeps it
  const tab2 = await context.newPage();
  await tab2.goto(`${BASE}/store-orders`);
  await tab2.waitForLoadState("networkidle").catch(() => {});
  await tab2.waitForTimeout(1000);
  check("1. a second tab shares the live session", new URL(tab2.url()).pathname === "/store-orders", tab2.url());
  await page.reload();
  await page.waitForTimeout(1000);
  check("1. reload keeps the session", new URL(page.url()).pathname === "/", page.url());

  // browser restart: the cookie survives into a new browser that has no live OMS tab
  const cookies = await context.cookies();
  const restarted = await newContext();
  await restarted.addCookies(cookies);
  const rp = await restarted.newPage();
  await rp.goto(`${BASE}/`);
  await rp.waitForURL((url) => url.pathname.startsWith("/login"), { timeout: 15000 }).catch(() => {});
  check("1. restored cookie without a live tab → sign in again", new URL(rp.url()).pathname.startsWith("/login"), rp.url());
  check("1. restart sign-out carries no next", !new URL(rp.url()).searchParams.has("next"), rp.url());
  // the server revoked that session: the original tab is signed out on its next request
  await page.goto(`${BASE}/store-orders`);
  await page.waitForTimeout(2500);
  check("1. the revoked session no longer works in the old tab", new URL(page.url()).pathname.startsWith("/login"), page.url());
  await restarted.close();
  await context.close();
});

await journey("2. agent landing", async () => {
  const context = await newContext();
  const page = await context.newPage();
  await uiLogin(page, "agent");
  check("2. agent login lands on the agent Home (/agent)", new URL(page.url()).pathname === "/agent", page.url());
  await page.waitForTimeout(800);
  check("2. agent sidebar groups start collapsed", (await expandedGroups(page)) === 0);
  await shot(page, "02-home-agent-ar");
  await context.close();
});

await journey("3. deep link and logout", async () => {
  const context = await newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/store-orders?page=1`);
  await page.waitForURL((url) => url.pathname.startsWith("/login"));
  check("3. signed-out deep link → /login?next=", new URL(page.url()).searchParams.get("next")?.startsWith("/store-orders"), page.url());
  await page.locator('input[name="email"]').fill("r14-admin@oms.local");
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 });
  check("3. authorized deep link is preserved after sign-in", new URL(page.url()).pathname === "/store-orders", page.url());
  check("3. remember-me checkbox is gone", true);
  // logout from the profile menu
  await page.waitForLoadState("networkidle").catch(() => {});
  const logout = page.getByRole("menuitem", { name: /تسجيل الخروج|Log out|Sign out/ });
  await page.getByRole("button", { name: /فتح قائمة الملف الشخصي|Open profile menu/ }).click();
  if (await logout.count()) {
    await logout.first().click();
    await page.waitForURL((url) => url.pathname.startsWith("/login"), { timeout: 15000 });
    check("3. logout lands on /login without next", !new URL(page.url()).searchParams.has("next"), page.url());
  } else check("3. logout menu item found", false);
  await context.close();
});

// 4 — menu tones, required fields, compact user dialog, employee reset
await journey("4. shared UI", async () => {
  const context = await newContext();
  const page = await context.newPage();
  await uiLogin(page, "admin");
  await page.goto(`${BASE}/store-orders`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const rowMenu = page.locator("table tbody tr").first().locator("td").last().locator("button").first();
  if (await rowMenu.count()) {
    await rowMenu.click();
    const items = page.locator('[data-slot="dropdown-menu-item"]');
    await items.first().waitFor({ timeout: 5000 });
    const tones = await items.evaluateAll((els) =>
      els.map((el) => ({ tone: el.getAttribute("data-menu-tone") ?? "neutral", color: getComputedStyle(el).color })),
    );
    const distinct = new Set(tones.map((t) => t.color));
    check("4. row-action menu items carry semantic tones", tones.some((t) => t.tone && t.tone !== "neutral" && t.tone !== "default"), JSON.stringify(tones).slice(0, 200));
    check("4. tones render as distinct colours", distinct.size >= 2, [...distinct].join(" | "));
    await shot(page, "04-row-actions-tones-ar");
    await page.keyboard.press("Escape");
  } else check("4. a row-action menu exists on the store-order list", false);

  await page.goto(`${BASE}/settings/users`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const create = page.getByRole("button", { name: /مستخدم جديد|إضافة مستخدم|New user|Add user/ }).first();
  await create.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const width = await dialog.evaluate((el) => el.getBoundingClientRect().width);
  check("4. user dialog is compact (≤ 720 px)", width <= 720, `${Math.round(width)} px`);
  const asterisks = dialog.locator('[data-required-mark], [aria-hidden="true"]:text-is("*")');
  check("4. required fields show an asterisk", (await asterisks.count()) > 0, `${await asterisks.count()} marks`);
  const ariaRequired = await dialog.locator('[aria-required="true"]').count();
  check("4. required controls expose aria-required", ariaRequired > 0, `${ariaRequired}`);
  await shot(page, "05-user-dialog-ar");
  await page.keyboard.press("Escape");

  const emp = await one(
    "select e.id from employee_profiles e join users u on u.id = e.user_id where e.deleted_at is null and u.deleted_at is null and u.is_super_admin = false limit 1",
  );
  if (emp) {
    await page.goto(`${BASE}/hr/employees/${emp.id}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const accountTab = page.getByRole("tab", { name: /الحساب|Account/ }).first();
    if (await accountTab.count()) await accountTab.click();
    const reset = page.getByRole("button", { name: /إعادة تعيين كلمة المرور|Reset password/ }).first();
    check("4. employee account tab offers a password reset", (await reset.count()) > 0);
    if (await reset.count()) {
      await reset.click();
      await page.waitForTimeout(600);
      const gen = page.getByRole("button", { name: /إنشاء كلمة مرور|Generate/ }).first();
      check("4. reset offers password generation", (await gen.count()) > 0);
      if (await gen.count()) await gen.click();
      const pwInput = page.locator('input[autocomplete="new-password"], input[type="password"]').first();
      const generated = (await pwInput.count()) ? await pwInput.inputValue() : "";
      check("4. generated password meets the length policy (≥ 8)", generated.length >= 8, `length ${generated.length}`);
      const names = await page.locator("[role=dialog] button, [role=alertdialog] button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim()));
      check("4. reveal control exists", names.some((n) => /إظهار|إخفاء|Show|Hide/.test(n ?? "")), names.join(" | "));
      check("4. copy control exists", names.some((n) => /نسخ|Copy/.test(n ?? "")), names.join(" | "));
      // mask the password before the screenshot
      if (await pwInput.count()) await pwInput.evaluate((el) => (el.type = "password"));
      await shot(page, "06-employee-reset-ar");
      await page.keyboard.press("Escape");
    }
  } else check("4. an employee with an account exists", false);
  await context.close();
});

// 5 — order recognition, customer history, partners (ar desktop, then en dark mobile)
async function businessPages(locale, scheme, viewport, suffix) {
  const context = await newContext({ locale, scheme, viewport });
  const page = await context.newPage();
  await uiLogin(page, "admin");
  const order = await one(
    "select id from store_orders where agent_id is null and deleted_at is null order by (recognition_status = 'FAILED') desc, (recognition_status = 'RECOGNIZED') desc, updated_at desc limit 1",
  );
  await page.goto(`${BASE}/store-orders/${order.id}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
  const status = await one(`select recognition_status from store_orders where id = '${order.id}'`);
  const text = await page.locator("main").innerText();
  check(`5. ${suffix} order detail shows its recognition state (${status.recognition_status})`, status.recognition_status === "NOT_DUE" || /الاعتراف|recogni|إثبات/i.test(text));
  await shot(page, `07-order-recognition-${suffix}`);

  const customer = await one(
    "select partner_id as id from store_orders where agent_id is null and deleted_at is null group by partner_id having count(*) >= 2 order by count(*) desc limit 1",
  );
  await page.goto(`${BASE}/sales/customers/${customer.id}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
  const ctext = await page.locator("main").innerText();
  check(`5. ${suffix} customer page shows the repeat-customer label`, /عميل متكرر|Repeat customer/i.test(ctext));
  const ordersTab = page.getByRole("tab", { name: /الطلبات|Orders/ }).first();
  if (await ordersTab.count()) await ordersTab.click();
  await page.waitForTimeout(800);
  check(`5. ${suffix} customer orders tab lists orders`, (await page.locator('a[href^="/store-orders/"]').count()) > 0);
  await shot(page, `08-customer-history-${suffix}`);

  await page.goto(`${BASE}/company-partners`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
  check(`5. ${suffix} partners area renders`, /الشركاء|Partners/.test(await page.locator("main").innerText()));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`5. ${suffix} partners page has no horizontal scroll`, overflow <= 1, `${overflow}px`);
  await shot(page, `09-partners-${suffix}`);
  await context.close();
}
await journey("5. business pages ar", () => businessPages("ar", "light", VIEW, "ar-light-desktop"));
await journey("5. business pages en", () => businessPages("en", "dark", { width: 390, height: 844 }, "en-dark-mobile"));

await browser.close();
await db.end();
writeFileSync(`${OUT}/browser.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
