#!/usr/bin/env node
/**
 * R20 stream A — «لم يُفتح» journey on the LOCAL preview (never Production).
 *
 *   BASE=http://localhost:4801 API=http://localhost:4805 node scripts/acceptance/r20/r20-a-lead-opened-journey.mjs
 *
 * Demo clone oms_r20_a (personas *@oms-demo.local; manager@ from r20-a-seed-demo-manager.sql). The
 * password is read at runtime from D:\Systems\OMS\tmp\r15-manual\.env (PW_FILE) and never written out.
 *
 *  1. before: an unread NEW lead assigned to sales shows the badge for admin, manager and sales
 *     (table + grid);
 *  2. admin and manager open its detail screen → still unread for everyone;
 *  3. sales opens it → after: the badge is gone for sales, manager and admin (table + grid) and the
 *     status label is unchanged;
 *  4. reassignment: a second lead opened by sales is reassigned to sales2 → unread again everywhere;
 *     sales2 opens it → gone; the history keeps sales' open;
 *  5. agent portal: the agent's own lead loses the badge when the agent user opens it.
 * Screenshots: specs/round20-corrections/evidence/a/{before,after}/; checks → evidence/a/journey.json.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:4801").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:4805").replace(/\/$/, "");
const LEAD_MAIN = process.env.LEAD_MAIN ?? "LD-2026-000003";
const LEAD_REASSIGN = process.env.LEAD_REASSIGN ?? "LD-2026-000005";
const LEAD_AGENT = process.env.LEAD_AGENT ?? "LD-2026-000004";
const PW_FILE = process.env.PW_FILE ?? "D:/Systems/OMS/tmp/r15-manual/.env";
const PW = readFileSync(PW_FILE, "utf8").match(/MANUAL_PW=(.*)/)[1].trim();
const OUT = "specs/round20-corrections/evidence/a";
for (const phase of ["before", "after"]) mkdirSync(`${OUT}/${phase}`, { recursive: true });

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? "PASS" : "FAIL", name, detail);
};

// ── API helpers (lookups, verification, the reassignment) ────────────────────────────────────
const tokens = {};
async function token(email) {
  if (tokens[email]) return tokens[email];
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const json = await res.json();
  if (!res.ok || !json.accessToken) throw new Error(`login ${email} → ${res.status}`);
  return (tokens[email] = json.accessToken);
}
async function api(email, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${await token(email)}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}
async function leadByNumber(number) {
  const page = await api("admin@oms-demo.local", "GET", `/leads?search=${number}&pageSize=5&lifecycle=all`);
  const lead = page.items.find((row) => row.leadNumber === number);
  if (!lead) throw new Error(`lead ${number} not found`);
  return lead;
}
async function userId(email) {
  const me = await fetch(`${API}/auth/me`, { headers: { authorization: `Bearer ${await token(email)}` } });
  return (await me.json()).id;
}

// ── Browser helpers ──────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("oms.locale", JSON.stringify("ar"));
    } catch {
      // private mode — default locale
    }
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await settle(page);
  return { ctx, page };
}
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
}
async function shot(page, phase, name) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await page.screenshot({ path: `${OUT}/${phase}/${name}.png` });
      return;
    } catch (error) {
      if (attempt === 4 || !/EUNKNOWN|EBUSY|EPERM/.test(String(error))) throw error;
      await page.waitForTimeout(500 * attempt);
    }
  }
}
async function setView(page, view) {
  const name = view === "grid" ? /شبك|بطاق|Grid|Cards/ : /جدول|Table/;
  const toggle = page.getByRole("radio", { name }).first();
  if (await toggle.count()) {
    await toggle.click();
    await settle(page);
  }
}
/** Opens the list filtered to one lead and reports whether its row / card carries the badge. */
async function listState(page, path, number, view) {
  await page.goto(`${BASE}${path}`);
  await settle(page);
  await setView(page, view);
  const search = page.getByRole("searchbox").first();
  await search.fill(number);
  await settle(page);
  const item =
    view === "grid"
      ? page.locator("article", { hasText: number }).first()
      : page.locator('[data-slot="table-row"]', { hasText: number }).first();
  await item.waitFor({ timeout: 15000 });
  return {
    badge: (await item.locator("[data-new-to-you]").count()) > 0,
    text: (await item.innerText()).replace(/\s+/g, " ").slice(0, 200),
  };
}
async function views(label, page, path, number, phase, prefix, expectBadge) {
  for (const view of ["table", "grid"]) {
    const state = await listState(page, path, number, view);
    await shot(page, phase, `${prefix}-${label}-${view}`);
    check(
      `${prefix}: ${label} ${view} ${expectBadge ? "shows" : "hides"} «لم يُفتح»`,
      state.badge === expectBadge,
      state.text,
    );
  }
}
async function openDetail(page, id, phase, name) {
  await page.goto(`${BASE}/crm/leads/${id}`);
  await settle(page);
  await shot(page, phase, name);
}

const personas = {
  admin: "admin@oms-demo.local",
  manager: "manager@oms-demo.local",
  sales: "sales@oms-demo.local",
  sales2: "sales2@oms-demo.local",
};
const s = {};
for (const [key, email] of Object.entries(personas)) s[key] = await session(email);

try {
  const main = await leadByNumber(LEAD_MAIN);
  const statusBefore = main.status.code;
  check(`${LEAD_MAIN} starts unread`, main.openedByAssigneeAt === null, `status ${statusBefore}`);

  // 1 — before: every viewer sees it unread.
  for (const key of ["admin", "manager", "sales"]) {
    await views(key, s[key].page, "/crm/leads", LEAD_MAIN, "before", "1-unread", true);
  }

  // 2 — admin and manager open the detail screen: still unread.
  await openDetail(s.admin.page, main.id, "before", "2-admin-opens-detail");
  await openDetail(s.manager.page, main.id, "before", "2-manager-opens-detail");
  const afterManagers = await leadByNumber(LEAD_MAIN);
  check("manager / admin opens do not mark it", afterManagers.openedByAssigneeAt === null);
  await views("sales", s.sales.page, "/crm/leads", LEAD_MAIN, "before", "2-after-manager-open", true);

  // 3 — the assigned employee opens it.
  await openDetail(s.sales.page, main.id, "after", "3-sales-opens-detail");
  const opened = await leadByNumber(LEAD_MAIN);
  check("assignee open recorded", opened.openedByAssigneeAt !== null, opened.openedByAssigneeAt);
  check("business status unchanged", opened.status.code === statusBefore, opened.status.code);
  for (const key of ["sales", "manager", "admin"]) {
    await views(key, s[key].page, "/crm/leads", LEAD_MAIN, "after", "3-opened", false);
  }

  // 4 — reassignment: opened by sales, reassigned to sales2 → unread again; sales2 opens → gone.
  const second = await leadByNumber(LEAD_REASSIGN);
  await openDetail(s.sales.page, second.id, "after", "4a-sales-opens-second");
  check("second lead opened by sales", (await leadByNumber(LEAD_REASSIGN)).openedByAssigneeAt !== null);
  await api(personas.admin, "POST", `/leads/${second.id}/assignments`, {
    salesEmployeeId: await userId(personas.sales2),
  });
  const reassigned = await leadByNumber(LEAD_REASSIGN);
  check("reassigned lead is unread for the new owner", reassigned.openedByAssigneeAt === null);
  for (const key of ["admin", "manager", "sales2"]) {
    await views(key, s[key].page, "/crm/leads", LEAD_REASSIGN, "after", "4b-reassigned", true);
  }
  await openDetail(s.sales2.page, second.id, "after", "4c-sales2-opens");
  const reopened = await leadByNumber(LEAD_REASSIGN);
  check("new owner open recorded", reopened.openedByAssigneeAt !== null);
  check("status unchanged through reassignment", reopened.status.code === second.status.code, reopened.status.code);
  for (const key of ["sales2", "admin"]) {
    await views(key, s[key].page, "/crm/leads", LEAD_REASSIGN, "after", "4d-new-owner-opened", false);
  }

  // 5 — agent portal: the agent's own lead.
  const agent = await session("agent@oms-demo.local");
  const agentLead = await leadByNumber(LEAD_AGENT);
  if (agentLead.openedByAssigneeAt === null) {
    await views("agent", agent.page, "/agent/leads", LEAD_AGENT, "before", "5-agent-unread", true);
    await agent.page.goto(`${BASE}/agent/leads/${agentLead.id}`);
    await settle(agent.page);
    await shot(agent.page, "after", "5-agent-opens-detail");
    await views("agent", agent.page, "/agent/leads", LEAD_AGENT, "after", "5-agent-opened", false);
    const agentAfter = await leadByNumber(LEAD_AGENT);
    check("agent assignee open recorded", agentAfter.openedByAssigneeAt !== null);
    check("agent lead status unchanged", agentAfter.status.code === agentLead.status.code, agentAfter.status.code);
  } else {
    check(`${LEAD_AGENT} already opened (journey re-run) — agent step skipped`, true);
  }
  await agent.ctx.close();
} finally {
  for (const { ctx } of Object.values(s)) await ctx.close();
  await browser.close();
  writeFileSync(`${OUT}/journey.json`, JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} checks passed`);
  if (failed) process.exitCode = 1;
}
