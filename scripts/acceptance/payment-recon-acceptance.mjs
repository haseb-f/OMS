#!/usr/bin/env node
/**
 * QA-PDR — Browser acceptance for Sales payment declaration + dynamic
 * reconciliation + provider settlement + FX (specs/payment-declaration-reconciliation).
 *
 *   RUN=DEMO-PDR-20260927 BASE=https://oms.haseb.org node scripts/acceptance/payment-recon-acceptance.mjs
 *   BASE=http://localhost:3001 PW_FILE=<local password file> node scripts/acceptance/payment-recon-acceptance.mjs
 *
 * Every business step is a UI action in the Arabic UI as the real QA persona
 * (qa-admin, qa-sales-agent, qa-sales-manager, qa-finance, qa-shipping). The
 * API is used only to (a) look up ids for assertions, (b) read JE lines /
 * balances / counts, and (c) create tagged master data that has no UI
 * (ReceivingAccount — /finance/receiving-accounts is a "coming soon" page).
 *
 * Safety: every record is RUN-tagged (names, external order ids, references).
 * Existing payment methods, accounts, settings and FX rates are never edited;
 * FX overrides are created only for the RUN-tagged test currency; Google
 * Sheets is never written (the sheet step is BLOCKED unless a shared test
 * sheet is supplied). Sonner toast nodes are never removed — seen toasts are
 * only marked with a data attribute (see dismissToasts).
 *
 * Sessions: one UI login per persona per RUN (storageState in OUT/state).
 * Passwords are never printed. PW / QA_PASSWORD (tmp/.qa.env) or PW_FILE.
 *
 * Env: RUN (default DEMO-PDR-YYYYMMDD), BASE, API, PW_FILE, ONLY=<phase csv>,
 *      SKIP=<phase csv>, HEADED=1, PRODUCT_SKU, NO_RETRY=1.
 * Phases: preflight,setup,rates,c1,orders,c2,c3,s2,s1,c4,c6,c7,final
 * Output: OUT/payment-recon-report.json, OUT/summary.md, OUT/shots/*.png,
 *         OUT/network.log (JSONL), OUT/ctx.json (ids for re-runs).
 */
/* global document, window */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const pad2 = (n) => String(n).padStart(2, "0");
const ymdCompact = (d = new Date()) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
if (!process.env.RUN) process.env.RUN = `DEMO-PDR-${ymdCompact()}`;
if (!process.env.PW && process.env.PW_FILE && existsSync(process.env.PW_FILE)) {
  process.env.PW = readFileSync(process.env.PW_FILE, "utf8").trim();
}
const { chromium } = await import("playwright");
// _tour-lib reads RUN/PW at import time, so it is imported after the defaults are set.
const { API, BASE, OUT, PW, ROOT, RUN, apiClient, errText, items } = await import("./_tour-lib.mjs");

const SHOTS = resolve(OUT, "shots");
const STATE = resolve(OUT, "state");
for (const d of [SHOTS, STATE]) mkdirSync(d, { recursive: true });
const LOG = resolve(OUT, "network.log");
const CTX_FILE = resolve(OUT, "ctx.json");
const rel = (p) => (p ? p.replace(`${ROOT}\\`, "").replace(`${ROOT}/`, "").replace(/\\/g, "/") : null);
const log = (entry) => appendFileSync(LOG, `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);
const envList = (name) => (process.env[name] ? process.env[name].split(",").map((s) => s.trim()).filter(Boolean) : null);
const ONLY = envList("ONLY");
const SKIP = envList("SKIP") ?? [];
const want = (phase) => (!ONLY || ONLY.includes(phase)) && !SKIP.includes(phase);
const H = createHash("sha1").update(RUN).digest("hex");
const HNUM = String(parseInt(H.slice(0, 8), 16)).padStart(10, "0");
/** Tagged test currency code — deterministic per RUN, never a real ISO code. */
const XCODE = `PD${H.slice(0, 4).toUpperCase()}`;
const IS_PROD = /oms\.haseb\.org/.test(BASE);
/** FX_TAGGED=1 (local only): create a RUN-tagged test currency + manual daily rates instead of using a real currency. */
const FX_TAGGED = !!process.env.FX_TAGGED && !IS_PROD;
/** The foreign currency used for C6/C7 (a real currency with a resolvable rate, or the local tagged one). */
const xc = () => ctx.xccy?.code ?? "FX?";
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};
const TODAY = new Date();
const YESTERDAY = addDays(TODAY, -1);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The typed format EnterpriseDatePicker parses ("DD MMM YYYY"). */
const uiDate = (d) => `${pad2(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}`;
const num = (v) => Number(v ?? 0);
const r2 = (v) => Math.round(Number(v) * 100) / 100;
const near = (a, b, eps = 0.011) => Math.abs(Number(a) - Number(b)) <= eps;
const escRe = (t) => new RegExp(String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

// ------------------------------------------------------------------ context (persisted per RUN)
const ctx = (() => {
  try {
    return JSON.parse(readFileSync(CTX_FILE, "utf8"));
  } catch {
    return {};
  }
})();
ctx.orders ??= {};
const saveCtx = () => writeFileSync(CTX_FILE, JSON.stringify(ctx, null, 2));

// ------------------------------------------------------------------ report
const CRITERIA = {
  S0: "Setup & permissions (tagged master data, persona permissions)",
  C1: "Sales declarations — UNPAID / PARTIAL / FULL, one pending claim each, no JE",
  C2: "Fulfillment readiness — FULL prepaid ships before Finance; PARTIAL blocked; PICKUP; COD unchanged",
  C3: "Provider matching — CSV / manual / Sheets, suggestions, confirm & post to clearing; non-reconciled via Finance review",
  C4: "Batch settlement — 10 × 500: Dr Bank 4,500 / Dr Commission 500 / Cr Clearing 5,000; preview == posted; links",
  C5: "Retry safety — double-click / resubmit on declaration, match confirm, settle, re-import",
  C6: "Cross-currency settlement — explicit fee in claim currency, separate FX difference line",
  C7: "FX — CBE auto-import status/run, dated overrides apply only within range, overlap rejected, posted JE rates frozen",
  C8: "Reports / balances — provider balance card reconciles before/after settlement; GL shows clearing movements",
  S1: "Dispute — claim disputed after shipment → order discrepancy flag, shipment untouched",
  S2: "Ambiguous suggestion warning (same phone, same amount)",
  S3: "Currency / amount mismatch refused",
  S4: "Correction permissions — Sales cannot change a declaration after fulfillment; Finance can (audited)",
  S5: "Previously posted historical payments untouched (read-only check)",
};
const report = {
  tour: "payment-recon-acceptance",
  run: RUN,
  base: BASE,
  api: API,
  startedAt: new Date().toISOString(),
  environment: {},
  criteria: {},
  steps: [],
  created: [],
  journal: [],
  defects: [],
};
let seq = 0;
function created(type, number, url, extra = {}) {
  if (report.created.some((c) => c.type === type && c.number === number)) return;
  report.created.push({ type, number, url, ...extra });
}
function jeEvidence(label, je) {
  if (!je) return null;
  const lines = (je.lines ?? []).map((l) => ({
    account: `${l.account?.code ?? ""} ${l.account?.name ?? l.accountId ?? ""}`.trim(),
    accountId: l.accountId,
    debit: num(l.debit),
    credit: num(l.credit),
    description: l.description ?? "",
  }));
  const dr = r2(lines.reduce((a, l) => a + l.debit, 0));
  const cr = r2(lines.reduce((a, l) => a + l.credit, 0));
  const row = {
    label,
    id: je.id,
    number: je.entryNumber,
    date: String(je.entryDate ?? "").slice(0, 10),
    status: je.status,
    exchangeRate: je.exchangeRate,
    sourceType: je.sourceType,
    sourceId: je.sourceId,
    url: `${BASE}/finance/journal-entries/${je.id}`,
    lines,
    totalDebit: dr,
    totalCredit: cr,
    balanced: near(dr, cr),
  };
  report.journal.push(row);
  return row;
}
const jeLine = (row) => (row ? `${row.number} [${row.lines.map((l) => `${l.debit ? `Dr ${l.debit}` : `Cr ${l.credit}`} ${l.account}`).join(" / ")}] rate=${row.exchangeRate} date=${row.date}` : "no JE");

class NotTested extends Error {}
class Blocked extends Error {}
const notTested = (m) => {
  throw new NotTested(m);
};
const blocked = (m) => {
  throw new Blocked(m);
};
/** A RUN order another step depends on; BLOCKED (never a TypeError FAIL) when it was not created. */
const ord = (key) => ctx.orders?.[key] ?? blocked(`dependency: order ${key} was not created in this RUN`);

// ------------------------------------------------------------------ sessions
const isApi = (url) => url.startsWith(API);
const sessions = new Map();
let browser;
const EMAIL = (persona) => `${persona}@oms.haseb.org`;

function attachMonitor(page) {
  const mon = { console: [], failed: [], pageErrors: [] };
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text().slice(0, 300);
    mon.console.push(text);
    log({ kind: "console", url: page.url(), text });
  });
  page.on("pageerror", (e) => {
    mon.pageErrors.push(e.message.slice(0, 300));
    log({ kind: "pageerror", url: page.url(), text: e.message.slice(0, 300) });
  });
  page.on("response", async (res) => {
    if (!isApi(res.url())) return;
    const method = res.request().method();
    if (res.status() < 400 && method === "GET") return;
    let body = "";
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      body = "";
    }
    const entry = { method, status: res.status(), url: res.url().replace(API, ""), body: res.status() >= 400 ? body : undefined };
    if (res.status() >= 400) mon.failed.push(entry);
    log({ kind: "api", ...entry });
  });
  mon.reset = () => {
    mon.console = [];
    mon.failed = [];
    mon.pageErrors = [];
  };
  return mon;
}

async function session(persona) {
  if (sessions.has(persona)) return sessions.get(persona);
  const stateFile = resolve(STATE, `${persona}.json`);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    locale: "ar-SA",
    storageState: existsSync(stateFile) ? stateFile : undefined,
    acceptDownloads: false,
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("oms.locale", JSON.stringify("ar"));
      window.localStorage.setItem("theme", "light");
    } catch {
      /* storage blocked */
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(60000);
  const mon = attachMonitor(page);
  page.on("dialog", (d) => {
    log({ kind: "dialog", type: d.type(), message: d.message().slice(0, 200) });
    (d.type() === "beforeunload" ? d.accept() : d.dismiss()).catch(() => {});
  });
  let loginStatus = "reused-session";
  const tokenOf = async () => (await context.cookies()).find((c) => c.name === "oms_token")?.value;
  let token = await tokenOf();
  if (token) {
    try {
      const exp = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp * 1000;
      if (exp < Date.now() + 3600e3) token = null;
    } catch {
      token = null;
    }
  }
  if (!token) {
    if (!PW) throw new Error("password missing (PW / QA_PASSWORD / PW_FILE)");
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.locator('input[name="email"], input[type="email"]').first().fill(EMAIL(persona));
    await page.locator('input[name="password"], input[type="password"]').first().fill(PW);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 }),
      page.locator('button[type="submit"]').first().click(),
    ]);
    token = await tokenOf();
    if (!token) throw new Error(`UI login for ${persona} produced no oms_token cookie`);
    await context.storageState({ path: stateFile });
    loginStatus = "ui-login";
  }
  const s = { persona, context, page, mon, api: apiClient(token), loginStatus };
  sessions.set(persona, s);
  return s;
}
/** API client of qa-admin (lookups / evidence only). */
let adminApi;
const A = (...args) => adminApi(...args);
const Amust = (...args) => adminApi.must(...args);

// ------------------------------------------------------------------ ui helpers (same conventions as journey-audit.mjs)
const LOADING = /جارٍ التحميل|جار التحميل/;
async function settle(page, { maxMs = 25000 } = {}) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: maxMs }).catch(() => {});
  await page
    .waitForFunction(
      (src) => {
        const main = document.querySelector("main");
        const txt = main?.innerText ?? "";
        return !new RegExp(src).test(txt.slice(0, 4000)) && document.querySelectorAll('main [data-slot="skeleton"], main .animate-pulse').length === 0;
      },
      LOADING.source,
      { timeout: maxMs },
    )
    .catch(() => {});
  await page.waitForTimeout(400);
}
async function go(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await recoverCrash(page);
}
async function shot(page, name) {
  const path = resolve(SHOTS, `${name.replace(/[^\w؀-ۿ-]+/g, "_").slice(0, 110)}.png`);
  await page.screenshot({ path, fullPage: false }).catch(() => {});
  return path;
}
async function mainText(page) {
  return (await page.locator("main").first().innerText({ timeout: 5000 }).catch(() => "")) || (await page.locator("body").innerText().catch(() => ""));
}
function dialog(page) {
  return page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').filter({ hasNotText: "لوحة الأوامر" }).last();
}
async function toasts(page) {
  return page
    .locator("[data-sonner-toast]:not([data-audit-seen])")
    .evaluateAll((els) => els.map((e) => ({ type: e.getAttribute("data-type"), text: e.innerText.trim().slice(0, 300) })))
    .catch(() => []);
}
/**
 * Mark already-seen toasts so later checks ignore them. NEVER detach sonner's
 * <li> nodes (React owns them; removing one crashes the next toast render —
 * journey-audit D1).
 */
async function dismissToasts(page) {
  await page.evaluate(() => document.querySelectorAll("[data-sonner-toast]").forEach((e) => e.setAttribute("data-audit-seen", ""))).catch(() => {});
}
const crashes = [];
async function recoverCrash(page) {
  const txt = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  if (!/This page couldn.t load/.test(txt)) return false;
  crashes.push({ url: page.url(), at: new Date().toISOString() });
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await settle(page);
  return true;
}
/** Wait for a toast matching `re`; error toasts short-circuit. */
async function expectToast(page, re, ms = 20000, { acceptError = false } = {}) {
  const t0 = Date.now();
  let lastCrashCheck = 0;
  while (Date.now() - t0 < ms) {
    if (Date.now() - lastCrashCheck > 1500) {
      lastCrashCheck = Date.now();
      if (await recoverCrash(page)) return { ok: false, crashed: true, text: `UI CRASH "This page couldn't load" after the action (${page.url().replace(BASE, "")})`, all: [] };
    }
    const t = await toasts(page);
    const hit = t.find((x) => re.test(x.text));
    if (hit) return { ok: true, text: hit.text, type: hit.type, all: t };
    const err = t.find((x) => x.type === "error");
    if (err && !acceptError) return { ok: false, error: true, text: `error toast: ${err.text}`, all: t };
    await page.waitForTimeout(250);
  }
  const t = await toasts(page);
  return { ok: false, text: t.length ? `toasts: ${t.map((x) => x.text).join(" | ")}` : "no toast", all: t };
}
async function anyToast(page, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await toasts(page);
    if (t.length) return t;
    await page.waitForTimeout(250);
  }
  return [];
}
async function clickFirst(page, locators, what) {
  for (let round = 0; round < 2; round += 1) {
    for (const loc of locators) {
      const l = loc.first();
      if (await l.isVisible().catch(() => false)) {
        await l.click();
        return true;
      }
    }
    await page.waitForTimeout(1500);
  }
  notTested(`selector not found: ${what}`);
}
const btn = (scope, re) => scope.getByRole("button", { name: re });
/** Open a combobox/select trigger, optionally type a search, click the option. */
async function pick(page, trigger, { search, option }) {
  await trigger.click();
  await page.waitForTimeout(300);
  if (search) {
    const input = page.locator('[role="listbox"] input, [cmdk-input], [data-radix-popper-content-wrapper] input, [role="dialog"] input[role="combobox"]').last();
    if (await input.isVisible().catch(() => false)) await input.fill(search);
    else await page.keyboard.type(search, { delay: 30 }).catch(() => {});
    await page.waitForTimeout(900);
  }
  const opt = page.getByRole("option", { name: option ?? new RegExp(search ?? ".") }).first();
  if (!(await opt.isVisible().catch(() => false))) await page.waitForTimeout(1500);
  if (!(await opt.isVisible().catch(() => false))) {
    const first = page.getByRole("option").first();
    if (!option && (await first.isVisible().catch(() => false))) {
      await first.click();
      return;
    }
    const avail = await page.getByRole("option").allInnerTexts().catch(() => []);
    await page.keyboard.press("Escape").catch(() => {});
    notTested(`option ${option ?? search} not found (options: ${avail.slice(0, 8).join(" / ").replace(/\s+/g, " ")})`);
  }
  await opt.click();
  await page.waitForTimeout(300);
}
async function select(page, trigger, optionRe) {
  await trigger.click();
  await page.waitForTimeout(300);
  const opt = page.getByRole("option", { name: optionRe }).first();
  if (!(await opt.isVisible().catch(() => false))) await page.waitForTimeout(1200);
  if (!(await opt.isVisible().catch(() => false))) {
    await page.keyboard.press("Escape").catch(() => {});
    notTested(`select option ${optionRe} not found`);
  }
  await opt.click();
  await page.waitForTimeout(250);
}
const field = (scope, labelRe) => scope.getByLabel(labelRe).first();
/** Control that follows a plain (unassociated) <label> with the given text. */
function after(scope, labelText, kind = "input") {
  const sel = {
    input: "self::input[not(@type='hidden') and not(@type='checkbox')]",
    textarea: "self::textarea",
    combo: "self::button[@role='combobox'] or self::*[@role='combobox']",
    any: "self::input[not(@type='hidden')] or self::textarea or self::button[@role='combobox']",
  }[kind];
  return scope.locator(`xpath=.//label[normalize-space(.)="${labelText}" or normalize-space(.)="${labelText} *" or starts-with(normalize-space(.),"${labelText}")]/following::*[${sel}][1]`).first();
}
/** Type a date into an EnterpriseDatePicker input and commit it. */
async function typeDate(input, d) {
  await input.click();
  await input.fill(uiDate(d));
  await input.press("Enter");
  await input.blur().catch(() => {});
}
const uuidIn = (url) => (url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) ?? [])[0];
async function waitUrl(page, re, ms = 30000) {
  await page.waitForURL(re, { timeout: ms }).catch(() => {});
  await settle(page);
  await recoverCrash(page);
  return re.test(page.url());
}
/**
 * Resubmit/retry simulation: the FIRST matching request is forwarded to the
 * server (it is processed) but the browser sees a dropped connection, exactly
 * like a network failure after commit. Returns an info object + an unroute fn.
 */
async function dropFirstResponse(page, urlRe, method = "POST") {
  const info = { dropped: false, serverStatus: null, serverBody: null };
  const handler = async (route) => {
    if (info.dropped || route.request().method() !== method) return route.continue();
    info.dropped = true;
    try {
      const resp = await route.fetch();
      info.serverStatus = resp.status();
      info.serverBody = (await resp.text()).slice(0, 300);
    } catch (e) {
      info.serverStatus = `fetch failed: ${e.message}`;
    }
    log({ kind: "dropped-response", url: route.request().url().replace(API, ""), status: info.serverStatus });
    await route.abort("connectionreset").catch(() => {});
  };
  await page.route(urlRe, handler);
  return { info, off: () => page.unroute(urlRe, handler).catch(() => {}) };
}

// ------------------------------------------------------------------ step runner
const RETRY = !process.env.NO_RETRY;
async function step(crit, s, name, fn, { retry = RETRY } = {}) {
  if (!s) {
    return record({ crit, persona: "-", name, status: "BLOCKED", detail: "persona session unavailable" });
  }
  // A step that already PASSED in this RUN is replayed, not re-asserted: the records have
  // moved on in their lifecycle (claims posted, settled, disputed…), so re-checking the
  // "before" state would be meaningless. Set REASSERT=1 to force re-execution.
  const key = `${crit}|${name}`;
  ctx.passed ??= {};
  if (!process.env.REASSERT && ctx.passed[key]) {
    const p = ctx.passed[key];
    return record({ crit, persona: s.persona, name, status: "PASS", detail: `(PASS recorded ${p.at} in this RUN) ${p.detail}`, url: p.url, shot: p.shot, evidence: p.evidence, attempts: 0 });
  }
  let attempt = 0;
  let row;
  while (attempt < (retry ? 2 : 1)) {
    attempt += 1;
    s.mon.reset();
    let res = {};
    let status = "PASS";
    let detail = "";
    try {
      await dismissToasts(s.page);
      res = (await fn(s.page, s, attempt)) ?? {};
      status = res.status ?? "PASS";
      detail = res.detail ?? "";
      if (s.mon.pageErrors.length) detail += `; pageerror: ${s.mon.pageErrors[0].slice(0, 160)}`;
    } catch (e) {
      if (e instanceof NotTested) {
        status = "NOT TESTED";
        detail = `script limitation: ${e.message}`;
      } else if (e instanceof Blocked) {
        status = "BLOCKED";
        detail = e.message;
      } else {
        status = "FAIL";
        detail = String(e?.message ?? e).split("\n")[0];
      }
      res.shot = res.shot ?? (await shot(s.page, `zz-${crit}-${s.persona}-${name}-a${attempt}`));
    }
    row = { crit, persona: s.persona, name, status, detail, url: res.url ?? null, shot: res.shot, evidence: res.evidence, attempts: attempt, consoleErrors: s.mon.console.slice(0, 4).concat(s.mon.pageErrors.slice(0, 2)), failedApi: s.mon.failed.slice(0, 6) };
    if (status !== "FAIL" && status !== "NOT TESTED") break;
    if (attempt < (retry ? 2 : 1)) {
      console.log(`retry   ${crit} ${name} — ${detail.slice(0, 160)}`);
      await s.page.waitForTimeout(3000);
    }
  }
  if (row.status === "PASS") {
    ctx.passed[key] = { at: new Date().toISOString(), detail: String(row.detail ?? "").slice(0, 1400), url: row.url, shot: row.shot, evidence: row.evidence };
    saveCtx();
  }
  return record(row);
}
let currentPhase = "-";
function record(row) {
  seq += 1;
  row.phase = currentPhase;
  row.id = `P${String(seq).padStart(3, "0")}`;
  row.screenshot = rel(row.shot);
  delete row.shot;
  row.detail = String(row.detail ?? "").slice(0, 1500);
  report.steps.push(row);
  console.log(`${row.status.padEnd(10)} ${row.id} ${row.crit} [${row.persona}] ${row.name}${row.detail ? ` — ${row.detail.slice(0, 240)}` : ""}`);
  return row;
}
const note = (crit, name, status, detail, extra = {}) => record({ crit, persona: extra.persona ?? "-", name, status, detail, url: extra.url ?? null, shot: extra.shot, evidence: extra.evidence, attempts: 1 });

// ------------------------------------------------------------------ API lookups (assertions only)
async function getOrder(id) {
  return (await A("GET", `/store-orders/${id}`)).json;
}
async function orderByExternal(ext) {
  const r = await A("GET", `/store-orders?search=${encodeURIComponent(ext)}&pageSize=10`);
  return items(r.json).find((o) => String(o.externalOrderId ?? "").toLowerCase() === ext.toLowerCase()) ?? null;
}
const claimsOf = (o) => (o?.payments ?? []).filter((p) => !p.deletedAt);
async function trace(kind, id) {
  const r = await A("GET", `/traceability/${kind}/${id}`);
  return r.ok ? r.json : null;
}
const traceGroup = (t, key) => t?.groups?.find((g) => g.key === key)?.items ?? [];
async function getJE(id) {
  const r = await A("GET", `/journal-entries/${id}`);
  return r.ok ? r.json : null;
}
async function jesBySource(sourceType, sourceId) {
  const r = await A("GET", `/journal-entries?sourceType=${encodeURIComponent(sourceType)}&sourceId=${sourceId}&pageSize=50`);
  return items(r.json);
}
/** JEs linked to a store order (traceability JOURNAL_ENTRIES group). */
async function orderJEs(orderId) {
  return traceGroup(await trace("STORE_ORDER", orderId), "JOURNAL_ENTRIES");
}
/** The receipt JE of one payment claim (via PAYMENT traceability). */
async function paymentReceiptJE(paymentId) {
  const t = await trace("PAYMENT", paymentId);
  const jes = traceGroup(t, "JOURNAL_ENTRIES");
  const receipts = [...traceGroup(t, "PAYMENTS"), ...traceGroup(t, "DOCUMENTS")].filter((x) => x.kind === "CUSTOMER_RECEIPT");
  let je = null;
  for (const j of jes) {
    const full = await getJE(j.id);
    if (full && full.status === "POSTED" && !full.reversalOfEntryId) {
      je = full;
      break;
    }
  }
  return { je, receipts, jeCount: jes.length };
}
async function providerBalance(methodId) {
  const r = await A("GET", "/payment-settlements/provider-balances");
  return items(r.json).find((b) => b.paymentMethod?.id === methodId) ?? null;
}
async function methodLines(methodId, status) {
  const r = await A("GET", `/payment-reconciliation/methods/${methodId}/lines?pageSize=200${status ? `&status=${status}` : ""}`);
  return items(r.json);
}
async function settlementsOf(methodId) {
  return items((await A("GET", `/payment-settlements?paymentMethodId=${methodId}&pageSize=100`)).json);
}
async function currencyByCode(code) {
  const r = await A("GET", `/currencies?search=${encodeURIComponent(code)}&pageSize=50`);
  return items(r.json).find((c) => c.code === code) ?? null;
}
const orderUrl = (o) => `${BASE}/store-orders/${o.id}`;
const wsPath = () => `/finance/payment-reconciliation/${ctx.methods?.tamara?.id}`;

// ============================================================== PHASES
async function preflight() {
  const adm = await session("qa-admin");
  adminApi = adm.api;
  const need = {
    "qa-admin": [],
    "qa-sales-agent": ["store-orders.view", "store-orders.create", "store-orders.edit"],
    "qa-sales-manager": ["store-orders.view", "store-orders.edit"],
    "qa-finance": [
      "sales.receipts.view",
      "sales.receipts.create",
      "sales.receipts.confirm",
      "finance.payment-reconciliation.view",
      "finance.payment-reconciliation.import",
      "finance.payment-reconciliation.match",
      "finance.payment-reconciliation.settle",
      "finance.payment-reconciliation.correct",
      "exchange-rates.view",
      "exchange-rates.create",
      "exchange-rates.manage",
    ],
    "qa-shipping": ["store-orders.view", "shipping.edit"],
  };
  ctx.missingPerms = {};
  for (const [persona, keys] of Object.entries(need)) {
    await step("S0", persona === "qa-admin" ? adm : await session(persona).catch(() => null), `${persona}: UI login + /auth/me permissions`, async (page, s) => {
      const me = (await s.api("GET", "/auth/me")).json ?? {};
      const perms = new Set(me.permissions ?? []);
      const missing = me.isSuperAdmin ? [] : keys.filter((k) => !perms.has(k));
      ctx.missingPerms[persona] = missing;
      if (missing.length) blocked(`${persona} lacks permissions: ${missing.join(", ")} (seed with apps/api/prisma/scripts/ensure-qa-users.ts)`);
      return { detail: `login=${s.loginStatus}; superAdmin=${!!me.isSuperAdmin}; required ${keys.length} permissions present` };
    }, { retry: false });
  }
  // Functional currency, posting settings, product.
  await step("S0", adm, "environment: functional currency, commission/FX accounts, product", async () => {
    const ps = (await A("GET", "/accounting/posting-settings")).json ?? {};
    const cur = items((await A("GET", "/currencies?pageSize=500")).json);
    const func = cur.find((c) => c.id === ps.functionalCurrencyId);
    if (!func) return { status: "FAIL", detail: "functional currency not configured" };
    ctx.func = { id: func.id, code: func.code };
    report.environment.functionalCurrency = func.code;
    report.environment.commissionAccountConfigured = !!ps.paymentGatewayFeeAccountId;
    report.environment.exchangeDifferenceAccountConfigured = !!ps.exchangeDifferenceAccountId;
    ctx.commissionAccountId = ps.paymentGatewayFeeAccountId ?? null;
    ctx.fxDiffAccountId = ps.exchangeDifferenceAccountId ?? null;
    ctx.arAccountId = ps.accountsReceivableAccountId ?? null;
    ctx.bankParentOf = ps.bankAccountId ?? ps.cashAccountId ?? null;
    // Product: PRODUCT_SKU, else an ACTIVE sellable product.
    let product = null;
    if (process.env.PRODUCT_SKU) product = items((await A("GET", `/products?search=${encodeURIComponent(process.env.PRODUCT_SKU)}&pageSize=5`)).json).find((p) => p.sku === process.env.PRODUCT_SKU);
    if (!product && ctx.product) product = (await A("GET", `/products/${ctx.product.id}`)).json;
    if (!product) {
      const list = items((await A("GET", "/products?status=ACTIVE&pageSize=50")).json).filter((p) => p.isSellable && p.status === "ACTIVE" && !p.deletedAt);
      product = list.find((p) => !p.taxId) ?? list[0];
    }
    if (!product) return { status: "FAIL", detail: "no ACTIVE sellable product found" };
    ctx.product = { id: product.id, sku: product.sku, name: product.name, displayName: product.displayName ?? product.name };
    saveCtx();
    return { detail: `functional=${func.code}; commission account=${!!ps.paymentGatewayFeeAccountId}; FX-difference account=${!!ps.exchangeDifferenceAccountId}; product=${product.sku} ${product.name}; tagged currency code=${XCODE}` };
  }, { retry: false });
  {
    // Live read (the setup step above is replayed, not re-executed, on a resumed RUN).
    const psLive = (await A("GET", "/accounting/posting-settings")).json ?? {};
    report.environment.commissionAccountConfigured = !!psLive.paymentGatewayFeeAccountId;
    report.environment.fxDiffAccountConfigured = !!psLive.exchangeDifferenceAccountId;
    ctx.commissionAccountId = psLive.paymentGatewayFeeAccountId ?? ctx.commissionAccountId ?? null;
    ctx.fxDiffAccountId = psLive.exchangeDifferenceAccountId ?? ctx.fxDiffAccountId ?? null;
    if (!report.environment.commissionAccountConfigured) note("C4", "commission account configured", "BLOCKED", "Posting settings have no Payment Gateway Fees account — settlement refuses to post (not modified by this script)");
  }
  // Historical snapshot (read-only, S5).
  await step("S5", adm, "snapshot historical VERIFIED payments (before)", async () => {
    const r = await A("GET", "/payments?status=VERIFIED&pageSize=50");
    const total = r.json?.total ?? r.json?.meta?.total ?? null;
    // Oldest page first (stable historical records), then only rows untouched for > 24 h.
    const lastPage = total ? Math.max(1, Math.ceil(total / 50)) : 1;
    const old = lastPage > 1 ? items((await A("GET", `/payments?status=VERIFIED&pageSize=50&page=${lastPage}`)).json) : [];
    const cutoff = Date.now() - 24 * 3600e3;
    const list = [...old, ...items(r.json)].filter((p) => !String(p.referenceNumber ?? "").includes(RUN) && new Date(p.updatedAt).getTime() < cutoff);
    ctx.historical = {
      total,
      sample: list.slice(0, 25).map((p) => ({ id: p.id, paymentNumber: p.paymentNumber, amount: p.amount, status: p.status, updatedAt: p.updatedAt, receivingAccountId: p.receivingAccountId })),
      at: new Date().toISOString(),
    };
    for (const p of ctx.historical.sample.slice(0, 10)) {
      const t = await trace("PAYMENT", p.id);
      p.jes = traceGroup(t, "JOURNAL_ENTRIES").map((j) => j.id);
    }
    saveCtx();
    return { detail: `VERIFIED payments total=${ctx.historical.total}; sampled ${ctx.historical.sample.length} (with JE links for 10)` };
  }, { retry: false });
}

// ------------------------------------------------------------------ setup (qa-admin, UI)
async function findAccountByName(name) {
  const r = await A("GET", `/chart-of-accounts?search=${encodeURIComponent(name)}&pageSize=20`);
  return items(r.json).find((a) => a.name === name) ?? null;
}
async function createAccountUI(page, name) {
  const existing = await findAccountByName(name);
  if (existing) return { acct: existing, reused: true };
  // Parent: the ASSET group holding the configured bank/cash account.
  const bank = ctx.bankParentOf ? (await A("GET", `/chart-of-accounts/${ctx.bankParentOf}`)).json : null;
  const parent = bank?.parentAccountId ? (await A("GET", `/chart-of-accounts/${bank.parentAccountId}`)).json : null;
  if (!parent) notTested("cannot resolve an ASSET parent group (posting settings bank/cash account has no parent)");
  await go(page, "/finance/chart-of-accounts");
  await clickFirst(page, [btn(page, /^حساب جديد$/), btn(page, /حساب جديد/)], "حساب جديد");
  const dlg = dialog(page);
  await dlg.waitFor({ state: "visible" });
  await after(dlg, "الاسم").fill(name);
  await after(dlg, "الاسم بالإنجليزية").fill(name).catch(() => {});
  const typeTrigger = after(dlg, "نوع الحساب", "combo");
  await select(page, typeTrigger, /^أصول$/);
  await select(page, after(dlg, "طبيعة الحساب", "combo"), /حساب فرعي/);
  const parentTrigger = after(dlg, "الحساب الأب", "combo");
  // Picker options read "<name> <parent name>" (no code) — search and match by name.
  await pick(page, parentTrigger, { search: parent.name, option: new RegExp(`^${escRe(parent.name).source}`) });
  await shot(page, `setup-coa-${name}`);
  await btn(dlg, /^حفظ$/).click();
  let t = await expectToast(page, /تم الحفظ|تم/);
  let override = null;
  if (!t.ok && /مستخدمة من قبل/.test(t.text)) {
    // DEFECT D2: the proposed child code (parent code + max sibling suffix + 1) is not checked
    // against codes used elsewhere in the tree (e.g. "111" under "11") → duplicate-code error.
    // Workaround: the documented "custom code" override with a code verified free via the API.
    const used = new Set(items((await A("GET", `/chart-of-accounts?search=${encodeURIComponent(parent.code)}&pageSize=500`)).json).map((x) => x.code));
    for (let i = 90; i < 999 && !override; i += 1) {
      const c = `${parent.code}${i}`;
      if (!used.has(c) && !(items((await A("GET", `/chart-of-accounts?search=${c}&pageSize=5`)).json).some((x) => x.code === c))) override = c;
    }
    const ov = after(dlg, "كود مخصص", "input");
    if (!override || !(await ov.isVisible().catch(() => false))) return { acct: null, toast: t, parent, defect: "duplicate proposed code; override field unavailable" };
    await ov.fill(override);
    await dismissToasts(page);
    await btn(dlg, /^حفظ$/).click();
    t = await expectToast(page, /تم الحفظ|تم/);
    ctx.coaCodeDefect = (ctx.coaCodeDefect ?? []).concat([{ name, override }]);
    saveCtx();
  }
  await page.waitForTimeout(800);
  const acct = await findAccountByName(name);
  if (!acct) return { acct: null, toast: t };
  return { acct, toast: t, parent, override };
}
async function findMethodByName(name) {
  const r = await A("GET", `/payment-methods?search=${encodeURIComponent(name)}&pageSize=50`);
  return items(r.json).find((m) => m.name === name) ?? null;
}
async function createMethodUI(page, name, acct, requiresReconciliation) {
  const existing = await findMethodByName(name);
  if (existing) return { method: existing, reused: true };
  await go(page, "/master-data/payment-methods");
  await clickFirst(page, [btn(page, /^إضافة جديد$/), btn(page, /إضافة جديد/)], "إضافة جديد");
  const dlg = dialog(page);
  await dlg.waitFor({ state: "visible" });
  await field(dlg, /^الاسم/).fill(name);
  const desc = field(dlg, /^الوصف/);
  if (await desc.isVisible().catch(() => false)) await desc.fill(`${RUN} QA acceptance method — do not use`);
  const acctTrigger = dlg.getByRole("combobox").first();
  await pick(page, acctTrigger, { search: acct.name, option: new RegExp(`^${escRe(acct.name).source}`) });
  const recon = dlg.getByRole("checkbox", { name: /تتطلب مطابقة/ }).first();
  const reconBox = (await recon.isVisible().catch(() => false)) ? recon : dlg.locator("xpath=.//label[contains(normalize-space(.),'تتطلب مطابقة')]/preceding::button[@role='checkbox'][1]").first();
  const checked = (await reconBox.getAttribute("data-state")) === "checked" || (await reconBox.getAttribute("aria-checked")) === "true";
  if (checked !== requiresReconciliation) await reconBox.click();
  await shot(page, `setup-method-${name}`);
  await btn(dlg, /^حفظ$/).click();
  const t = await expectToast(page, /تم الحفظ|تم/);
  await page.waitForTimeout(800);
  return { method: await findMethodByName(name), toast: t };
}

async function setup() {
  const adm = await session("qa-admin");
  ctx.accounts ??= {};
  ctx.methods ??= {};
  const accts = [
    ["tamara", `${RUN} Tamara clearing`],
    ["bankTransfer", `${RUN} Bank transfer clearing`],
    ["bank", `${RUN} Settlement bank`],
  ];
  for (const [key, name] of accts) {
    await step("S0", adm, `Chart of accounts: tagged ASSET leaf "${name}"`, async (page) => {
      const r = await createAccountUI(page, name);
      if (!r.acct) return { status: "FAIL", detail: `account not found after save; toast=${r.toast?.text}`, shot: await shot(page, `setup-coa-fail-${key}`) };
      ctx.accounts[key] = { id: r.acct.id, code: r.acct.code, name: r.acct.name, accountType: r.acct.accountType, allowsPosting: r.acct.allowsPosting };
      saveCtx();
      created("ChartOfAccount", `${r.acct.code} ${name}`, `${BASE}/finance/chart-of-accounts`, { id: r.acct.id });
      const ok = r.acct.accountType === "ASSET" && r.acct.allowsPosting !== false;
      return { status: ok ? "PASS" : "FAIL", detail: `${r.reused ? "reused" : `created (${r.toast?.text})`}${r.override ? `; DEFECT D2 workaround: proposed code was already used elsewhere → custom code ${r.override}` : ""}; code=${r.acct.code}; type=${r.acct.accountType}; posting=${r.acct.allowsPosting}; parent=${r.parent?.code ?? "-"}`, url: `${BASE}/finance/chart-of-accounts` };
    });
  }
  const methods = [
    ["tamara", `${RUN} Tamara (QA)`, "tamara", true],
    ["bankTransfer", `${RUN} Bank transfer (QA)`, "bankTransfer", false],
  ];
  for (const [key, name, acctKey, recon] of methods) {
    await step("S0", adm, `Payment method "${name}" requiresReconciliation=${recon}`, async (page) => {
      const acct = ctx.accounts[acctKey];
      if (!acct) blocked(`tagged account ${acctKey} missing`);
      const r = await createMethodUI(page, name, acct, recon);
      if (!r.method) return { status: "FAIL", detail: `method not found after save; toast=${r.toast?.text}` };
      ctx.methods[key] = { id: r.method.id, name: r.method.name };
      saveCtx();
      created("PaymentMethod", name, `${BASE}/master-data/payment-methods`, { id: r.method.id });
      const ok = r.method.requiresReconciliation === recon && r.method.accountId === acct.id && r.method.isActive !== false;
      return { status: ok ? "PASS" : "FAIL", detail: `${r.reused ? "reused" : `created (${r.toast?.text})`}; requiresReconciliation=${r.method.requiresReconciliation}; account=${r.method.account?.code ?? r.method.accountId}; active=${r.method.isActive}`, url: `${BASE}/master-data/payment-methods` };
    });
  }
  await step("S0", adm, "Receiving account (bank) for settlement — API (no UI: /finance/receiving-accounts is 'coming soon')", async () => {
    if (!ctx.accounts.bank) blocked("tagged bank GL account missing");
    const code = `PDR-RA-${H.slice(0, 6).toUpperCase()}`;
    let ra = items((await A("GET", "/receiving-accounts")).json).find((x) => x.code === code);
    if (!ra) ra = await Amust("POST", "/receiving-accounts", { name: `${RUN} Settlement bank`, code, currencyId: ctx.func.id, chartOfAccountId: ctx.accounts.bank.id, notes: `${RUN} QA acceptance — do not use`, isActive: true });
    ctx.receivingAccount = { id: ra.id, name: ra.name, code };
    saveCtx();
    created("ReceivingAccount", `${code} ${ra.name}`, null, { id: ra.id });
    return { detail: `${ra.name} (${code}) → GL ${ctx.accounts.bank.code}, currency ${ctx.func.code}` };
  });
  if (!FX_TAGGED) return; // Production: never create a currency
  await step("S0", adm, `Tagged test currency ${XCODE} (master data UI, local FX_TAGGED only)`, async (page) => {
    let c = await currencyByCode(XCODE);
    let how = "reused";
    if (!c) {
      await go(page, "/master-data/currencies");
      await clickFirst(page, [btn(page, /^إضافة جديد$/), btn(page, /إضافة جديد/)], "إضافة جديد");
      const dlg = dialog(page);
      await dlg.waitFor({ state: "visible" });
      await field(dlg, /^الرمز|^الكود|^رمز العملة/).fill(XCODE);
      await field(dlg, /^الاسم/).fill(`${RUN} test currency`);
      await shot(page, "setup-currency-filled");
      await btn(dlg, /^حفظ$/).click();
      const t = await expectToast(page, /تم الحفظ|تم/);
      await page.waitForTimeout(800);
      c = await currencyByCode(XCODE);
      how = `created (${t.text})`;
    }
    if (!c) return { status: "FAIL", detail: "currency not found after save" };
    ctx.xccy = { id: c.id, code: c.code };
    saveCtx();
    created("Currency", `${XCODE} ${RUN} test currency`, `${BASE}/master-data/currencies`, { id: c.id });
    return { detail: `${how}; ${c.code}`, url: `${BASE}/master-data/currencies` };
  });
}

// ------------------------------------------------------------------ daily manual rates for the tagged currency (qa-finance UI)
const R1 = 2.0; // FX_TAGGED only: yesterday (statement/provider transaction date → receipt rate)
const R2 = 2.1; // FX_TAGGED only: today (settlement date)
/** Rates the FX service resolves for the C6 currency: yesterday (receipt = provider txn date) and today (settlement). */
const rY = () => ctx.xRates?.y ?? R1;
const rT = () => ctx.xRates?.t ?? R2;
async function resolveRate(currencyId, d) {
  const r = await A("GET", `/exchange-rates/resolve?currencyId=${currencyId}&asOf=${iso(d)}`);
  return r.ok && num(r.json?.rate) > 0 ? r.json : null;
}
/** CBE "تشغيل الآن" as qa-finance; PASS on SUCCESS/PARTIAL/SKIPPED or a visible FAILED run with a reason. */
async function cbeRunNow(fin, label) {
  return step("C7", fin, label, async (page) => {
    await go(page, "/finance/exchange-rates");
    const before = items((await A("GET", "/exchange-rates/sync/runs?pageSize=5")).json)[0]?.id;
    await clickFirst(page, [btn(page, /^تشغيل الآن$/)], "تشغيل الآن");
    const alert = page.getByRole("alertdialog").last();
    if (await alert.isVisible({ timeout: 2000 }).catch(() => false)) await alert.getByRole("button").filter({ hasNotText: /^(إغلاق|إلغاء)$/ }).last().click();
    const t = await anyToast(page, 90000);
    await settle(page);
    const last = items((await A("GET", "/exchange-rates/sync/runs?pageSize=5")).json)[0];
    const isNew = last && last.id !== before;
    // The card refreshes after the run returns; poll instead of reading once
    // (a single early read caught the pre-refresh state on Production).
    let visibleStatus = false;
    for (let i = 0; i < 20 && !visibleStatus; i += 1) {
      const text = (await mainText(page)).replace(/\s+/g, " ");
      visibleStatus = /آخر تشغيل\s*(ناجح|اكتمل مع تحذيرات|فشل|تم التخطي)/.test(text) || /ناجح|اكتمل مع تحذيرات|فشل|تم التخطي/.test(text);
      if (!visibleStatus) await page.waitForTimeout(500);
    }
    const ok = isNew && (["SUCCESS", "PARTIAL", "SKIPPED"].includes(last.status) || (last.status === "FAILED" && (last.error || last.details)));
    const expectedLocalFail = ctx.func?.code !== "EGP" && last?.status === "FAILED";
    ctx.cbeRuns = [...(ctx.cbeRuns ?? []), { at: new Date().toISOString(), status: last?.status, inserted: last?.insertedCount, error: last?.error ?? null }];
    saveCtx();
    return {
      status: ok && visibleStatus ? "PASS" : "FAIL",
      detail: `toast=${t.map((x) => `${x.type}:${x.text}`).join(" | ")}; run=${last?.status} trigger=${last?.trigger} rates date=${String(last?.effectiveDate ?? "").slice(0, 10)} inserted=${last?.insertedCount} skipped=${last?.skippedCount} error=${last?.error ?? JSON.stringify(last?.details?.reason ?? "")}; status visible in UI=${visibleStatus}${expectedLocalFail ? " (expected: non-EGP base fails closed)" : ""}`,
      url: `${BASE}/finance/exchange-rates`,
      shot: await shot(page, `c7-fx-run-now-${(ctx.cbeRuns ?? []).length}`),
    };
  }, { retry: false });
}
/** First real CBE import — runs BEFORE C6 so an existing foreign currency can resolve a rate. */
async function fxrun() {
  const fin = await session("qa-finance");
  if (ctx.cbeFirstRunDone) return note("C7", "first CBE run (before C6)", "PASS", `already done in this RUN: ${JSON.stringify(ctx.cbeRuns?.[0] ?? {})}`);
  const row = await cbeRunNow(fin, `CBE "تشغيل الآن" — first real import, before C6 (functional=${ctx.func?.code})`);
  if (row.status === "PASS") {
    ctx.cbeFirstRunDone = true;
    saveCtx();
  }
}
/** Pick the C6 currency: an EXISTING currency whose rate resolves today and yesterday. Never creates currencies or rates. */
async function fxccy() {
  if (FX_TAGGED) return rates();
  const adm = await session("qa-admin");
  await step("C6", adm, "choose C6 foreign currency (existing currency, rate resolvable today + yesterday; nothing is created)", async () => {
    const cands = (process.env.FX_CCY ? process.env.FX_CCY.split(",") : ["USD", "SAR", "EUR"]).map((c) => c.trim().toUpperCase()).filter((c) => c && c !== ctx.func?.code);
    const tried = [];
    for (const code of cands) {
      const c = await currencyByCode(code);
      if (!c) {
        tried.push(`${code}: not in currencies`);
        continue;
      }
      ctx.mismatchCcy ??= c.code;
      const t = await resolveRate(c.id, TODAY);
      const y = await resolveRate(c.id, YESTERDAY);
      if (!t || !y) {
        tried.push(`${code}: resolve today=${t?.rate ?? "none"} yesterday=${y?.rate ?? "none"}`);
        continue;
      }
      ctx.xccy = { id: c.id, code: c.code };
      ctx.xRates = { y: num(y.rate), t: num(t.rate), ySource: y.source, tSource: t.source, yEffective: String(y.effectiveDate ?? "").slice(0, 10), tEffective: String(t.effectiveDate ?? "").slice(0, 10) };
      ctx.xBlocked = null;
      saveCtx();
      return { detail: `${c.code}: ${iso(YESTERDAY)} → ${ctx.xRates.y} (${y.source}, effective ${ctx.xRates.yEffective}); ${iso(TODAY)} → ${ctx.xRates.t} (${t.source}, effective ${ctx.xRates.tEffective})${tried.length ? `; skipped ${tried.join("; ")}` : ""}` };
    }
    ctx.xccy = null;
    ctx.xBlocked = `no existing foreign currency resolves a rate for ${iso(YESTERDAY)} and ${iso(TODAY)} (${tried.join("; ")}) — C6 needs an official/imported rate; the script never creates manual rates for real currencies`;
    saveCtx();
    blocked(ctx.xBlocked);
  }, { retry: false });
}
async function rates() {
  const fin = await session("qa-finance");
  for (const [d, rate] of [
    [YESTERDAY, R1],
    [TODAY, R2],
  ]) {
    await step("C6", fin, `manual daily rate 1 ${XCODE} = ${rate} ${ctx.func?.code} on ${iso(d)} (exchange-rates UI)`, async (page) => {
      if (!ctx.xccy) blocked("tagged currency missing");
      ctx.xRates = { y: R1, t: R2, ySource: "MANUAL", tSource: "MANUAL" };
      saveCtx();
      const existing = items((await A("GET", `/exchange-rates?fromCurrencyId=${ctx.xccy.id}`)).json).find((x) => String(x.effectiveDate).slice(0, 10) === iso(d));
      if (existing) return { detail: `already present: ${existing.rate} (${existing.source})` };
      await go(page, "/finance/exchange-rates");
      await clickFirst(page, [btn(page, /^إضافة سعر صرف$/)], "إضافة سعر صرف");
      const dlg = dialog(page);
      await dlg.waitFor({ state: "visible" });
      await pick(page, field(dlg, /^من/), { search: XCODE, option: escRe(XCODE) });
      const to = field(dlg, /^إلى/);
      const toText = await to.innerText().catch(() => "");
      if (!toText.includes(ctx.func.code)) await pick(page, to, { option: escRe(ctx.func.code) }).catch(() => {});
      await field(dlg, /^السعر/).fill(String(rate));
      await typeDate(field(dlg, /^تاريخ السريان/), d);
      const notes = field(dlg, /^ملاحظات/);
      if (await notes.isVisible().catch(() => false)) await notes.fill(`${RUN} QA test rate`);
      await shot(page, `c6-rate-${iso(d)}-filled`);
      await btn(dlg, /^حفظ$/).click();
      const t = await expectToast(page, /تم حفظ|تم/);
      const after2 = items((await A("GET", `/exchange-rates?fromCurrencyId=${ctx.xccy.id}`)).json).find((x) => String(x.effectiveDate).slice(0, 10) === iso(d));
      return { status: t.ok && after2 && near(after2.rate, rate, 1e-6) ? "PASS" : "FAIL", detail: `${t.text}; stored=${after2?.rate} ${after2?.source ?? ""} date=${String(after2?.effectiveDate ?? "").slice(0, 10)}`, url: `${BASE}/finance/exchange-rates` };
    });
  }
}

// ------------------------------------------------------------------ store orders (qa-sales-agent UI)
function phoneFor(idx) {
  return `+2010${HNUM.slice(-6)}${pad2(idx)}`;
}
const ORDER_SPECS = {
  U1: { idx: 11, amount: 500, declare: "UNPAID" },
  P1: { idx: 12, amount: 500, declare: "UNPAID" }, // PARTIAL declared later from the order page (C1/C5)
  B01: { idx: 21, amount: 500, declare: "FULL", method: "tamara" },
  B02: { idx: 22, amount: 500, declare: "UNPAID" }, // FULL declared later with a dropped-response retry (C5)
  B03: { idx: 23, amount: 500, declare: "FULL", method: "tamara" },
  B04: { idx: 24, amount: 500, declare: "FULL", method: "tamara" },
  B05: { idx: 25, amount: 500, declare: "FULL", method: "tamara" },
  B06: { idx: 26, amount: 500, declare: "FULL", method: "tamara" },
  B07: { idx: 27, amount: 500, declare: "FULL", method: "tamara" },
  B08: { idx: 28, amount: 500, declare: "FULL", method: "tamara" },
  B09: { idx: 29, amount: 500, declare: "FULL", method: "tamara" },
  B10: { idx: 30, amount: 500, declare: "FULL", method: "tamara" },
  BK: { idx: 31, amount: 500, declare: "FULL", method: "bankTransfer" },
  COD: { idx: 32, amount: 500, declare: "UNPAID", cod: true },
  DSP: { idx: 33, amount: 500, declare: "FULL", method: "tamara" },
  A1: { idx: 34, amount: 300, declare: "FULL", method: "tamara" },
  A2: { idx: 34, amount: 300, declare: "FULL", method: "tamara" }, // same phone as A1 → ambiguous
  X1: { idx: 35, amount: 200, declare: "FULL", method: "tamara", x: true },
  X2: { idx: 36, amount: 200, declare: "FULL", method: "tamara", x: true },
  // FULL declared prepaid SHIPPING that is never on a statement: proves shipping
  // readiness strictly before (and independent of) Finance matching.
  RDY: { idx: 37, amount: 500, declare: "FULL", method: "tamara" },
};
const extOf = (key) => `${RUN}-${key}`;
const custOf = (key) => `${RUN} عميل ${key}`;
const KIND_AR = { UNPAID: /لم يدفع بعد/, FULL: /دفع كامل المبلغ/, PARTIAL: /دفع جزئي/ };

async function fillDocLine(page, { product, qty, price, priceLabel, index = 0 }) {
  const row = page.locator('[data-testid="document-line"]:visible').nth(index);
  await row.waitFor({ state: "visible" });
  const prodTrigger = row.locator('[role="combobox"]').filter({ hasText: /اختر منتجاً/ }).first();
  await pick(page, (await prodTrigger.isVisible().catch(() => false)) ? prodTrigger : row.locator('[role="combobox"]').first(), { search: product.sku, option: new RegExp(`${escRe(product.sku).source}|^\\s*${escRe(product.displayName ?? product.name).source}`) });
  await page.waitForTimeout(500);
  if (qty != null) await row.locator('input[type="number"]').first().fill(String(qty));
  if (price != null) {
    const pr = row.getByLabel(priceLabel).first();
    if (await pr.isVisible().catch(() => false)) await pr.fill(String(price));
    else await row.locator('input[type="number"]').nth(1).fill(String(price));
  }
  await page.keyboard.press("Tab").catch(() => {});
}
/** Fill the shared PaymentDeclarationFields inside a dialog. */
async function fillDeclaration(page, dlg, { kind, amount, methodName, reference }) {
  const radio = dlg.getByRole("radio", { name: KIND_AR[kind] }).first();
  if (await radio.isVisible().catch(() => false)) await radio.click();
  else await dlg.locator("label").filter({ hasText: KIND_AR[kind] }).first().click();
  await page.waitForTimeout(300);
  if (kind === "UNPAID") return;
  if (kind === "PARTIAL") await field(dlg, /^المبلغ المدفوع/).fill(String(amount));
  await pick(page, field(dlg, /^طريقة الدفع/), { search: methodName.slice(-18), option: escRe(methodName) });
  if (reference) {
    const ref = field(dlg, /^مرجع الدفع/);
    if (await ref.isVisible().catch(() => false)) await ref.fill(reference);
  }
}
async function createOrderUI(s, key) {
  const spec = ORDER_SPECS[key];
  const ext = extOf(key);
  let found = await orderByExternal(ext);
  let how = "reused";
  const page = s.page;
  if (!found && spec.x && !ctx.xccy) blocked(ctx.xBlocked ?? "C6 currency not chosen");
  if (!found && spec.method && !ctx.methods?.[spec.method]) blocked(`tagged payment method ${spec.method} missing (setup failed)`);
  if (!found) {
    await go(page, "/store-orders");
    await clickFirst(page, [btn(page, /^طلب جديد$/)], "طلب جديد");
    const dlg = dialog(page);
    await dlg.waitFor({ state: "visible" });
    await field(dlg, /^اسم العميل/).fill(custOf(key));
    await pick(page, field(dlg, /^الدولة/), { search: "مصر", option: /مصر/ });
    const phone = dlg.locator('input[name="customerName"]').locator("xpath=following::input[1]");
    await phone.fill(phoneFor(spec.idx));
    await phone.blur();
    await page.waitForTimeout(1200);
    await field(dlg, /^المدينة/).fill("القاهرة");
    await field(dlg, /^العنوان/).fill(`${RUN} عنوان ${key}`);
    await field(dlg, /^رقم الطلب الخارجي/).fill(ext);
    const ccy = spec.x ? ctx.xccy?.code : ctx.func.code;
    if (!ccy) blocked(ctx.xBlocked ?? "C6 currency not chosen");
    try {
      await pick(page, field(dlg, /^العملة/), { search: ccy, option: escRe(ccy) });
    } catch (e) {
      if (spec.x && e instanceof NotTested) {
        await page.keyboard.press("Escape").catch(() => {});
        blocked(`the store-order dialog does not offer currency ${ccy} (${e.message})`);
      }
      throw e;
    }
    if (spec.cod) await pick(page, field(dlg, /^نوع الدفع|^طريقة السداد|^نمط/), { option: /الدفع عند الاستلام/ });
    await fillDocLine(page, { product: ctx.product, qty: 1, price: spec.amount, priceLabel: /سعر الوحدة المتفق عليه/ });
    if (!spec.cod) {
      await fillDeclaration(page, dlg, { kind: spec.declare, methodName: spec.method ? ctx.methods[spec.method]?.name : undefined, reference: `${RUN}-REF-${key}` });
    }
    await shot(page, `order-${key}-create-filled`);
    await btn(dlg, /^إنشاء الطلب$/).click();
    const t = await expectToast(page, /تم إنشاء طلب المتجر/);
    await page.waitForTimeout(1200);
    found = await orderByExternal(ext);
    how = t.text;
    if (!found) return { order: null, how };
  }
  const o = await getOrder(found.id);
  ctx.orders[key] = { id: o.id, number: o.internalOrderId, total: num(o.total), currency: o.currency?.code, partnerId: o.partnerId };
  saveCtx();
  created(`StoreOrder ${key}`, o.internalOrderId, orderUrl(o), { id: o.id, ext });
  return { order: o, how };
}

async function declareOnOrderPage(s, key, decl, { mode = "click" } = {}) {
  const page = s.page;
  const o = ord(key);
  await go(page, `/store-orders/${o.id}`);
  await clickFirst(page, [btn(page, /^إبلاغ دفع العميل$/)], "إبلاغ دفع العميل");
  const dlg = dialog(page);
  await dlg.waitFor({ state: "visible" });
  await page.waitForTimeout(800);
  await fillDeclaration(page, dlg, { ...decl, methodName: decl.method ? ctx.methods[decl.method]?.name : undefined });
  await shot(page, `declare-${key}-${decl.kind}-${mode}`);
  const save = btn(dlg, /^حفظ الإبلاغ$/);
  let dropInfo = null;
  if (mode === "dblclick") {
    await save.dblclick();
  } else if (mode === "drop") {
    const d = await dropFirstResponse(page, /\/store-orders\/[^/]+\/payment-declaration/);
    dropInfo = d.info;
    await save.click();
    const first = await expectToast(page, /./, 15000, { acceptError: true });
    dropInfo.firstToast = first.text;
    await d.off();
    await dismissToasts(page);
    await page.waitForTimeout(500);
    // Dialog stays open after the failure — the user presses Save again (same idempotency key).
    if (await save.isVisible().catch(() => false)) await save.click();
    else dropInfo.note = "dialog closed after the dropped response — reopened";
  } else {
    await save.click();
  }
  const t = await expectToast(page, /تم الإبلاغ|تم تسجيل|تم حفظ هذا الإبلاغ/, 20000);
  await settle(page);
  return { toast: t, dropInfo };
}

async function assertDeclared(key, { status, amount, claims, noJE = true }) {
  const o = await getOrder(ord(key).id);
  const cl = claimsOf(o);
  const jes = noJE ? await orderJEs(o.id) : [];
  const problems = [];
  if (o.declaredPaymentStatus !== status) problems.push(`declaredPaymentStatus=${o.declaredPaymentStatus} (want ${status})`);
  if (amount != null && !near(o.declaredAmount, amount)) problems.push(`declaredAmount=${o.declaredAmount} (want ${amount})`);
  if (claims != null && cl.length !== claims) problems.push(`claims=${cl.length} (want ${claims})`);
  const pending = cl.filter((p) => p.status === "PENDING");
  if (claims && pending.length !== claims) problems.push(`pending claims=${pending.length}`);
  if (noJE && jes.length) problems.push(`JEs linked=${jes.map((j) => j.number).join(",")}`);
  return { o, cl, jes, problems, summary: `declared=${o.declaredPaymentStatus} ${o.declaredAmount}/${o.total} ${o.currency?.code}; claims=${cl.map((p) => `${p.paymentNumber}:${p.status}:${p.amount}:${p.origin}:${p.declarationKind ?? "-"}`).join(",") || "none"}; JEs=${jes.length}` };
}

async function c1() {
  const ag = await session("qa-sales-agent");
  const fin = await session("qa-finance");
  await step("C1", ag, "U1: create prepaid order declared UNPAID (create dialog)", async (page) => {
    const r = await createOrderUI(ag, "U1");
    if (!r.order) return { status: "FAIL", detail: `order not created: ${r.how}` };
    const a = await assertDeclared("U1", { status: "UNPAID", claims: 0 });
    await go(page, `/store-orders/${r.order.id}`);
    const text = await mainText(page);
    const badge = /لم يدفع العميل|غير مُبلَغ بالدفع/.test(text);
    return { status: a.problems.length || !badge ? "FAIL" : "PASS", detail: `${r.how}; ${a.summary}; badge "لم يدفع العميل"=${badge}${a.problems.length ? `; PROBLEMS: ${a.problems.join("; ")}` : ""}`, url: orderUrl(r.order), shot: await shot(page, "c1-U1-unpaid-detail") };
  });
  await step("C1", ag, "P1: create order, then declare PARTIAL 200 of 500 from the order page (double-click Save → C5)", async (page) => {
    const r = await createOrderUI(ag, "P1");
    if (!r.order) return { status: "FAIL", detail: `order not created: ${r.how}` };
    let before = await assertDeclared("P1", { status: "UNPAID", claims: 0 });
    let d = { toast: { text: "already declared (re-run)" } };
    if (before.o.declaredPaymentStatus === "UNPAID") d = await declareOnOrderPage(ag, "P1", { kind: "PARTIAL", amount: 200, method: "tamara", reference: `${RUN}-REF-P1` }, { mode: "dblclick" });
    const a = await assertDeclared("P1", { status: "PARTIALLY_PAID", amount: 200, claims: 1 });
    const text = await mainText(page);
    const badge = /أبلغ العميل بدفع جزئي|مُبلَغ جزئياً/.test(text);
    const awaiting = /بانتظار مطابقة المالية/.test(text);
    ctx.c5 ??= {};
    ctx.c5.declDoubleClick = { claims: a.cl.length };
    saveCtx();
    return { status: a.problems.length || !badge ? "FAIL" : "PASS", detail: `toast=${d.toast.text}; ${a.summary}; badge partial=${badge}; "awaiting Finance reconciliation"=${awaiting}${a.problems.length ? `; PROBLEMS: ${a.problems.join("; ")}` : ""}`, url: orderUrl(r.order), shot: await shot(page, "c1-P1-partial-detail") };
  });
  await step("C1", ag, "B01: create prepaid order declared FULL (amount defaults to total, Tamara QA)", async (page) => {
    const r = await createOrderUI(ag, "B01");
    if (!r.order) return { status: "FAIL", detail: `order not created: ${r.how}` };
    const a = await assertDeclared("B01", { status: "PAID", amount: num(r.order.total), claims: 1 });
    const claim = a.cl[0];
    await go(page, `/store-orders/${r.order.id}`);
    const text = await mainText(page);
    const badge = /أبلغ العميل بالدفع/.test(text);
    const awaiting = /بانتظار مطابقة المالية/.test(text);
    const methodOk = claim?.paymentMethodId === ctx.methods.tamara?.id;
    return { status: a.problems.length || !badge || !awaiting || !methodOk ? "FAIL" : "PASS", detail: `${r.how}; ${a.summary}; claim amount=${claim?.amount} == total ${r.order.total}; method=${methodOk ? "tagged Tamara" : claim?.paymentMethodId}; badge "أبلغ العميل بالدفع"=${badge}; "بانتظار مطابقة المالية"=${awaiting}${a.problems.length ? `; PROBLEMS: ${a.problems.join("; ")}` : ""}`, url: orderUrl(r.order), shot: await shot(page, "c1-B01-full-detail") };
  });
  await step("C5", ag, "B02: declare FULL from order page — first response dropped, user presses Save again", async (page) => {
    const r = await createOrderUI(ag, "B02");
    if (!r.order) return { status: "FAIL", detail: `order not created: ${r.how}` };
    const before = await assertDeclared("B02", { status: "UNPAID", claims: 0 });
    let d = { toast: { text: "already declared (re-run)" }, dropInfo: null };
    if (before.o.declaredPaymentStatus === "UNPAID") d = await declareOnOrderPage(ag, "B02", { kind: "FULL", method: "tamara", reference: `${RUN}-REF-B02` }, { mode: "drop" });
    const a = await assertDeclared("B02", { status: "PAID", amount: num(r.order.total), claims: 1 });
    const retryToast = /لم يتكرر شيء|مسبقاً/.test(d.toast.text);
    return {
      status: a.problems.length ? "FAIL" : "PASS",
      detail: `dropped first response (server ${d.dropInfo?.serverStatus}); first toast="${d.dropInfo?.firstToast ?? "-"}"; resubmit toast="${d.toast.text}" (retry message shown=${retryToast}); ${a.summary}${a.problems.length ? `; PROBLEMS: ${a.problems.join("; ")}` : ""}`,
      url: orderUrl(r.order),
      shot: await shot(page, "c5-B02-declare-retry"),
    };
  });
  await step("C5", ag, "P1: double-click Save produced exactly one claim", async () => {
    const a = await assertDeclared("P1", { status: "PARTIALLY_PAID", amount: 200, claims: 1 });
    return { status: a.problems.length ? "FAIL" : "PASS", detail: a.summary, url: orderUrl(ord("P1")) };
  });
  await step("C1", fin, "Finance sees declared vs verified separately (payment review lists B01 claim as reported, not posted)", async (page) => {
    const b01 = ord("B01");
    await go(page, "/finance/payment-review");
    const box = page.getByPlaceholder(/تصفية|بحث/).first();
    if (await box.isVisible().catch(() => false)) {
      await box.fill(b01.number);
      await page.waitForTimeout(1500);
      await settle(page);
    }
    const text = await mainText(page);
    const listed = text.includes(b01.number);
    const row = page.locator("main table tbody tr").filter({ hasText: b01.number }).first();
    const rowText = listed ? (await row.innerText().catch(() => "")).replace(/\s+/g, " ") : "";
    const confirmOffered = listed && (await row.getByTestId("payment-confirm-post").isVisible().catch(() => false));
    return {
      status: "PASS",
      detail: `B01 claim listed in Finance payment review=${listed}; row="${rowText.slice(0, 200)}"; direct "تأكيد وترحيل" offered for a reconciliation-enabled claim=${confirmOffered}${confirmOffered ? " (OBSERVATION: Finance can post a reconciliation-required claim without statement matching — confirm intended)" : ""}`,
      url: `${BASE}/finance/payment-review`,
      shot: await shot(page, "c1-finance-payment-review"),
    };
  });
}

async function orders() {
  const ag = await session("qa-sales-agent");
  for (const key of ["B03", "B04", "B05", "B06", "B07", "B08", "B09", "B10", "BK", "COD", "DSP", "A1", "A2", "X1", "X2"]) {
    const crit = key.startsWith("B") && key !== "BK" ? "C4" : key === "BK" ? "C3" : key === "COD" ? "C2" : key === "DSP" ? "S1" : key.startsWith("A") ? "S2" : "C6";
    await step(crit, ag, `order ${key}: create ${ORDER_SPECS[key].cod ? "COD" : `prepaid, declare ${ORDER_SPECS[key].declare}`} ${ORDER_SPECS[key].amount} ${ORDER_SPECS[key].x ? xc() : ctx.func?.code}`, async (page) => {
      const r = await createOrderUI(ag, key);
      if (!r.order) return { status: "FAIL", detail: `order not created: ${r.how}`, shot: await shot(page, `order-${key}-fail`) };
      const spec = ORDER_SPECS[key];
      const want = spec.cod ? "UNPAID" : spec.declare === "FULL" ? "PAID" : "UNPAID";
      const a = await assertDeclared(key, { status: want, claims: spec.declare === "FULL" && !spec.cod ? 1 : 0 });
      const totalOk = near(r.order.total, spec.amount);
      const ccyOk = r.order.currency?.code === (spec.x ? ctx.xccy?.code : ctx.func.code);
      return { status: a.problems.length || !totalOk || !ccyOk ? "FAIL" : "PASS", detail: `${r.how}; ${a.summary}; paymentType=${r.order.paymentType}${a.problems.length ? `; PROBLEMS: ${a.problems.join("; ")}` : ""}${totalOk ? "" : `; total ${r.order.total} ≠ ${spec.amount}`}`, url: orderUrl(r.order) };
    });
  }
}

// ------------------------------------------------------------------ C2 readiness
/** qa-admin: store-orders list → select the order row → bulk "تغيير حالة الشحن" → جاهز للشحن. */
async function bulkReady(page, number) {
  await go(page, "/store-orders");
  const search = page.getByPlaceholder(/رقم الطلب/).first();
  await search.fill(number);
  await page.waitForTimeout(2000);
  await settle(page);
  const row = page.locator("main table tbody tr").filter({ hasText: number }).first();
  if (!(await row.isVisible().catch(() => false))) notTested(`order ${number} not in store-orders list`);
  await row.hover();
  const cell = row.locator('[data-column-id="select"] button, [data-column-id="select"] input, [data-column-id="select"] [role="checkbox"]').first();
  if (await cell.isVisible().catch(() => false)) await cell.click();
  else {
    const n = await page.locator("main table tbody tr").count();
    if (n !== 1) notTested(`row checkbox not rendered and ${n} rows match — refusing select-all`);
    await page.getByRole("checkbox", { name: "تحديد كل الصفوف" }).or(page.getByRole("button", { name: "تحديد كل الصفوف" })).first().click();
  }
  await page.waitForTimeout(500);
  await clickFirst(page, [btn(page, /تغيير حالة الشحن/)], "تغيير حالة الشحن");
  const dlg = dialog(page);
  await dlg.waitFor({ state: "visible" });
  await select(page, dlg.locator('[role="combobox"]').first(), /جاهز للشحن/);
  await btn(dlg, /^تغيير الحالة$/).click();
  const alert = page.getByRole("alertdialog").last();
  if (await alert.isVisible({ timeout: 3000 }).catch(() => false)) await btn(alert, /تأكيد التغيير|تأكيد/).click();
  const t = await anyToast(page, 15000);
  await settle(page);
  return t;
}
const shipmentsOf = async (orderId) => items((await A("GET", `/store-orders/${orderId}/shipments`)).json);
const shipSig = (s) => (s ? `${s.id}|${s.shippingStatus?.code}|${s.updatedAt}` : "none");

async function c2() {
  const adm = await session("qa-admin");
  const shp = await session("qa-shipping");
  const agRdy = await session("qa-sales-agent");
  await step("C2", agRdy, "RDY: Sales creates a prepaid SHIPPING order declared paid in FULL (never on a statement)", async () => {
    const r = await createOrderUI(agRdy, "RDY");
    if (!r.order) return { status: "FAIL", detail: `order not created: ${r.how}` };
    const o = await getOrder(r.order.id);
    const claims = claimsOf(o);
    return {
      status: o.declaredPaymentStatus === "PAID" && claims.length === 1 && claims[0].status === "PENDING" ? "PASS" : "FAIL",
      detail: `${r.how ?? ""} ${o.orderNumber ?? o.number ?? ""}; declared=${o.declaredPaymentStatus}; claims=${claims.map((c) => c.status).join(",")}`,
      url: orderUrl(ord("RDY")),
    };
  });
  // B01's shipment signature is still recorded for the later "matching never alters shipments" check.
  {
    const b01 = ctx.orders?.B01;
    const b01Ships = b01 ? await shipmentsOf(b01.id) : [];
    if (b01Ships[0]) {
      ctx.b01Shipment = { id: b01Ships[0].id, status: b01Ships[0].shippingStatus?.code, sig: shipSig(b01Ships[0]) };
      saveCtx();
    }
  }
  await step("C2", adm, "RDY (FULL declared, SHIPPING): shipment can be created BEFORE Finance matching", async (page) => {
    const o = ord("RDY");
    if (!o) blocked("RDY missing");
    let ships = await shipmentsOf(o.id);
    let t = [];
    if (!ships.length) {
      t = await bulkReady(page, o.number);
      ships = await shipmentsOf(o.id);
    }
    const fresh = await getOrder(o.id);
    const verifiedClaims = claimsOf(fresh).filter((p) => p.status === "VERIFIED" || p.status === "MATCHED");
    // On a resumed RUN the claim may since have been matched/posted: the criterion is
    // that the shipment was created BEFORE Finance matched it — prove it by timestamps.
    const financeAt = verifiedClaims
      .map((p) => Date.parse(p.matchedAt ?? p.verifiedAt ?? ""))
      .filter(Number.isFinite)
      .sort((x, y) => x - y)[0];
    const shipAt = ships[0] ? Date.parse(ships[0].createdAt ?? "") : NaN;
    const beforeFinance = ships.length > 0 && (financeAt === undefined || (Number.isFinite(shipAt) && shipAt < financeAt));
    const sh = await shot(page, "c2-RDY-bulk-ready");
    return {
      status: beforeFinance ? "PASS" : "FAIL",
      detail: `toasts=${t.map((x) => `${x.type}:${x.text}`).join(" | ") || "(existing shipment)"}; shipments=${ships.length} status=${ships[0]?.shippingStatus?.code ?? "-"} createdAt=${ships[0]?.createdAt ?? "-"}; first Finance match/verify=${financeAt === undefined ? "none" : new Date(financeAt).toISOString()}; shipped before Finance=${beforeFinance}; paymentStatus now=${fresh.paymentStatus}`,
      url: orderUrl(o),
      shot: sh,
    };
  });
  await step("C2", shp, "RDY order page (shipping role): declared paid, Finance still 'بانتظار مطابقة المالية'", async (page) => {
    const o = ord("RDY");
    await go(page, `/store-orders/${o.id}`);
    const text = await mainText(page);
    const declared = /أبلغ العميل بالدفع/.test(text);
    const awaiting = /بانتظار مطابقة المالية/.test(text);
    return { status: declared && awaiting ? "PASS" : "FAIL", detail: `declared badge=${declared}; awaiting Finance reconciliation=${awaiting}`, url: orderUrl(o), shot: await shot(page, "c2-RDY-shipping-view") };
  });
  await step("C2", adm, "P1 (PARTIAL declared, prepaid SHIPPING): shipment blocked with the gate message", async (page) => {
    const o = ord("P1");
    if (!o) blocked("P1 missing");
    const t = await bulkReady(page, o.number);
    const ships = await shipmentsOf(o.id);
    await go(page, `/store-orders/${o.id}`);
    const text = await mainText(page);
    const hint = /الإبلاغ الجزئي لا يكفي|يصبح الطلب جاهزاً للشحن/.test(text);
    const failToast = t.some((x) => x.type === "error" || /تعذر/.test(x.text));
    return { status: !ships.length && (hint || failToast) ? "PASS" : "FAIL", detail: `toasts=${t.map((x) => `${x.type}:${x.text}`).join(" | ") || "none"}; shipments=${ships.length}; gate hint on order page=${hint}`, url: orderUrl(o), shot: await shot(page, "c2-P1-gate") };
  });
  await step("C2", adm, "COD order: shipment allowed without any declaration (COD unchanged)", async (page) => {
    const o = ord("COD");
    if (!o) blocked("COD missing");
    let ships = await shipmentsOf(o.id);
    let t = [];
    if (!ships.length) {
      t = await bulkReady(page, o.number);
      ships = await shipmentsOf(o.id);
    }
    const fresh = await getOrder(o.id);
    return { status: ships.length ? "PASS" : "FAIL", detail: `paymentType=${fresh.paymentType}; toasts=${t.map((x) => x.text).join(" | ") || "(existing)"}; shipments=${ships.length}; claims=${claimsOf(fresh).length}`, url: orderUrl(o), shot: await shot(page, "c2-COD-ready") };
  });
  await step("S1", adm, "DSP (FULL declared): shipment created before the dispute", async (page) => {
    const o = ord("DSP");
    if (!o) blocked("DSP missing");
    let ships = await shipmentsOf(o.id);
    if (!ships.length) {
      await bulkReady(page, o.number);
      ships = await shipmentsOf(o.id);
    }
    ctx.dspShipment = ships[0] ? { id: ships[0].id, status: ships[0].shippingStatus?.code, sig: shipSig(ships[0]), n: ships.length } : null;
    saveCtx();
    return { status: ships.length ? "PASS" : "FAIL", detail: `shipments=${ships.length} status=${ctx.dspShipment?.status}`, url: orderUrl(o) };
  });
  await pickupFlow();
}

async function pickupFlow() {
  const mg = await session("qa-sales-manager");
  const shp = await session("qa-shipping");
  const leadName = `${RUN} ليد استلام`;
  await step("C2", mg, "PICKUP: create lead + convert (prepaid, استلام من المقر, PARTIAL 100 of 500 declared in conversion)", async (page) => {
    if (ctx.pickup?.orderId) return { detail: `reused ${ctx.pickup.orderNumber}`, url: `${BASE}/store-orders/${ctx.pickup.orderId}` };
    let lead = items((await A("GET", `/leads?search=${encodeURIComponent(leadName)}&pageSize=5`)).json).find((l) => l.customerName === leadName);
    if (!lead) {
      await go(page, "/crm/leads");
      await clickFirst(page, [btn(page, /^إضافة جديد$/), btn(page, /ليد جديد/)], "إضافة جديد");
      const dlg = dialog(page);
      await dlg.waitFor({ state: "visible" });
      await dlg.getByRole("textbox", { name: /اسم العميل/ }).fill(leadName);
      await pick(page, dlg.locator('[role="combobox"]').first(), { search: "مصر", option: /مصر|Egypt/ });
      const phone = dlg.locator("input").last();
      await phone.fill(`10${HNUM.slice(-6)}40`);
      await phone.blur();
      await btn(dlg, /حفظ كعميل محتمل/).click();
      await expectToast(page, /تم/);
      await page.waitForTimeout(1000);
      lead = items((await A("GET", `/leads?search=${encodeURIComponent(leadName)}&pageSize=5`)).json).find((l) => l.customerName === leadName);
    }
    if (!lead) return { status: "FAIL", detail: "lead not created", shot: await shot(page, "c2-lead-fail") };
    ctx.pickup = { leadId: lead.id, leadNumber: lead.leadNumber };
    created("Lead (pickup)", `${lead.leadNumber} ${leadName}`, `${BASE}/crm/leads/${lead.id}`, { id: lead.id });
    await go(page, `/crm/leads/${lead.id}`);
    const conv = btn(page, /^تحويل إلى طلب$/).filter({ visible: true }).first();
    if (!(await conv.isVisible().catch(() => false))) notTested(`"تحويل إلى طلب" not visible for qa-sales-manager (lead owner ${lead.salesEmployee?.fullName ?? "-"})`);
    await conv.click();
    const dlg = dialog(page);
    await dlg.waitFor({ state: "visible" });
    await fillDocLine(page, { product: ctx.product, qty: 1, price: 500, priceLabel: /المبلغ المتفق عليه/ });
    await pick(page, after(dlg, "التنفيذ", "combo"), { option: /استلام من المقر/ });
    const cur = after(dlg, "العملة", "combo");
    if (await cur.isVisible().catch(() => false)) {
      const txt = await cur.innerText().catch(() => "");
      if (!txt.includes(ctx.func.code)) await pick(page, cur, { search: ctx.func.code, option: escRe(ctx.func.code) });
    }
    await fillDeclaration(page, dlg, { kind: "PARTIAL", amount: 100, methodName: ctx.methods.tamara.name, reference: `${RUN}-REF-PICKUP` });
    const addr = after(dlg, "العنوان", "textarea");
    if (await addr.isVisible().catch(() => false)) await addr.fill(`${RUN} استلام`).catch(() => {});
    await shot(page, "c2-pickup-convert-filled");
    await btn(dlg, /^الملخص$/).click();
    await page.waitForTimeout(800);
    await shot(page, "c2-pickup-convert-summary");
    await btn(dialog(page), /تأكيد وإنشاء الطلب/).click();
    const t = await expectToast(page, /تم إنشاء الطلب/);
    const ok = await waitUrl(page, /store-orders\/[0-9a-f-]{36}/);
    if (!ok) return { status: "FAIL", detail: `${t.text}; no redirect to the order`, shot: await shot(page, "c2-pickup-convert-fail") };
    const o = await getOrder(uuidIn(page.url()));
    ctx.pickup.orderId = o.id;
    ctx.pickup.orderNumber = o.internalOrderId;
    ctx.orders.PICK = { id: o.id, number: o.internalOrderId, total: num(o.total), currency: o.currency?.code };
    saveCtx();
    created("StoreOrder PICK (from lead)", o.internalOrderId, orderUrl(o), { id: o.id });
    const cl = claimsOf(o);
    const ok2 = o.fulfillmentMethod === "PICKUP" && o.declaredPaymentStatus === "PARTIALLY_PAID" && cl.length === 1 && cl[0].origin === "LEAD_CONVERSION";
    return { status: ok2 ? "PASS" : "FAIL", detail: `${t.text}; ${o.internalOrderId}; fulfillment=${o.fulfillmentMethod}; declared=${o.declaredPaymentStatus} ${o.declaredAmount}; claims=${cl.map((p) => `${p.status}/${p.origin}/${p.amount}`).join(",")}`, url: orderUrl(o), shot: await shot(page, "c2-pickup-order") };
  });
  await step("C2", shp, "PICKUP with PARTIAL declaration: collection not allowed (gate)", async (page) => {
    const o = ord("PICK");
    if (!o) blocked("pickup order missing");
    if (ctx.pickup?.gate) return { ...ctx.pickup.gate, detail: `(recorded in the first run of this RUN tag) ${ctx.pickup.gate.detail}` };
    await go(page, `/store-orders/${o.id}`);
    const ready = btn(page, /^جاهز للاستلام$/).first();
    let readyResult = "button not shown";
    if (await ready.isVisible().catch(() => false)) {
      if (await ready.isEnabled().catch(() => false)) {
        await ready.click();
        const t = await anyToast(page, 10000);
        readyResult = t.map((x) => `${x.type}:${x.text}`).join(" | ") || "no toast";
        await settle(page);
      } else readyResult = "disabled";
    }
    const collect = btn(page, /^تسجيل الاستلام$/).first();
    const collectVisible = await collect.isVisible().catch(() => false);
    const collectEnabled = collectVisible && (await collect.isEnabled().catch(() => false));
    const text = await mainText(page);
    const hint = /يمكن تسجيل الاستلام بعد الإبلاغ عن دفع كامل المبلغ/.test(text);
    const fresh = await getOrder(o.id);
    const res = { status: !collectEnabled && fresh.fulfillmentStatus?.code !== "COLLECTED" ? "PASS" : "FAIL", detail: `ready-for-pickup action → ${readyResult}; collect button visible=${collectVisible} enabled=${collectEnabled}; pickup hint=${hint}; fulfillment=${fresh.fulfillmentStatus?.code ?? "-"}; shipments=${(fresh.shipments ?? []).length}`, url: orderUrl(o), shot: await shot(page, "c2-pickup-partial-gate") };
    ctx.pickup.gate = { status: res.status, detail: res.detail, url: res.url };
    saveCtx();
    return res;
  });
  await step("C2", mg, "PICKUP: declare the remainder (FULL) → eligible, but never auto-collected", async (page) => {
    const o = ord("PICK");
    if (!o) blocked("pickup order missing");
    if (ctx.pickup?.full) return { ...ctx.pickup.full, detail: `(recorded in the first run of this RUN tag) ${ctx.pickup.full.detail}` };
    const before = await getOrder(o.id);
    let d = { toast: { text: "already fully declared" } };
    if (before.declaredPaymentStatus !== "PAID") d = await declareOnOrderPage(mg, "PICK", { kind: "FULL", method: "tamara", reference: `${RUN}-REF-PICKUP-2` });
    const fresh = await getOrder(o.id);
    const res = { status: fresh.declaredPaymentStatus === "PAID" && fresh.fulfillmentStatus?.code !== "COLLECTED" ? "PASS" : "FAIL", detail: `${d.toast.text}; declared=${fresh.declaredPaymentStatus} ${fresh.declaredAmount}/${fresh.total}; claims=${claimsOf(fresh).length}; fulfillment=${fresh.fulfillmentStatus?.code ?? "-"} (not COLLECTED)`, url: orderUrl(o), shot: await shot(page, "c2-pickup-full-declared") };
    ctx.pickup.full = { status: res.status, detail: res.detail, url: res.url };
    saveCtx();
    return res;
  });
  await step("C2", shp, "PICKUP: shipping staff marks ready and records collection (manual, no shipment/label)", async (page) => {
    const o = ord("PICK");
    if (!o) blocked("pickup order missing");
    await go(page, `/store-orders/${o.id}`);
    const steps = [];
    for (const [re, confirm] of [
      [/^جاهز للاستلام$/, false],
      [/^تسجيل الاستلام$/, true],
    ]) {
      const b = btn(page, re).first();
      if (!(await b.isVisible().catch(() => false))) {
        steps.push(`${re.source}: not offered`);
        continue;
      }
      if (!(await b.isEnabled().catch(() => false))) {
        steps.push(`${re.source}: disabled`);
        continue;
      }
      await dismissToasts(page);
      await b.click();
      if (confirm) {
        const alert = page.getByRole("alertdialog").last();
        if (await alert.isVisible({ timeout: 3000 }).catch(() => false)) await alert.getByRole("button").filter({ hasNotText: /^(إغلاق|إلغاء)$/ }).last().click();
      }
      const t = await expectToast(page, /تم تحديث حالة الاستلام/, 12000);
      steps.push(`${re.source}: ${t.text}`);
      await settle(page);
    }
    const fresh = await getOrder(o.id);
    return { status: fresh.fulfillmentStatus?.code === "COLLECTED" && !(fresh.shipments ?? []).length ? "PASS" : "FAIL", detail: `${steps.join(" | ")}; fulfillment=${fresh.fulfillmentStatus?.code}; shipments=${(fresh.shipments ?? []).length}; claims still ${claimsOf(fresh).map((p) => p.status).join(",")} (collection does not verify payments)`, url: orderUrl(o), shot: await shot(page, "c2-pickup-collected") };
  });
}

// ------------------------------------------------------------------ C3 matching (qa-finance)
function csvFor(keys, { date = YESTERDAY } = {}) {
  const header = "Transaction ID,Customer Name,Phone,Amount,Currency,Transaction Date,Status,Order Number,Fee,Net";
  const rows = keys.map((k) => {
    const o = ctx.orders[k];
    const spec = ORDER_SPECS[k];
    const fee = spec.x ? 10 : 25;
    return [`${RUN}-TXN-${k}`, custOf(k), phoneFor(spec.idx), o.total.toFixed(2), o.currency, iso(date), "PAID", o.number, fee.toFixed(2), (o.total - fee).toFixed(2)].map((v) => (/[,"]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",");
  });
  return `${header}\n${rows.join("\n")}\n`;
}
async function openTab(page, re) {
  const tab = page.getByRole("tab", { name: re }).first();
  await tab.click();
  await page.waitForTimeout(600);
  await settle(page);
}
async function importCsv(page, file) {
  await go(page, wsPath());
  await openTab(page, /^الكشف/);
  await clickFirst(page, [btn(page, /^استيراد ملف$/)], "استيراد ملف");
  const dlg = dialog(page);
  await dlg.waitFor({ state: "visible" });
  await dlg.locator('input[type="file"]').setInputFiles(file);
  await page.waitForTimeout(2500);
  await settle(page);
  const commit = btn(dlg, /^استيراد$/);
  await commit.waitFor({ state: "visible" });
  for (let i = 0; i < 20 && !(await commit.isEnabled().catch(() => false)); i += 1) await page.waitForTimeout(500);
  const previewText = (await dlg.innerText().catch(() => "")).replace(/\s+/g, " ");
  const sh = await shot(page, `c3-import-preview-${file.split(/[\\/]/).pop()}`);
  if (!(await commit.isEnabled().catch(() => false))) return { ok: false, text: `commit disabled; preview: ${previewText.slice(0, 300)}`, shot: sh };
  await commit.click();
  const t = await expectToast(page, /تم استيراد الكشف/, 30000);
  await settle(page);
  return { ok: t.ok, text: t.text, preview: previewText.slice(0, 600), shot: sh };
}
/** Select an unmatched line in the Matching tab and return the suggestions card. */
async function selectLine(page, ref) {
  await go(page, wsPath());
  await openTab(page, /^المطابقة/);
  const search = page.getByPlaceholder(/ابحث بالمرجع أو الطلب/).first();
  await search.fill(ref);
  await page.waitForTimeout(1500);
  await settle(page);
  const line = page.locator("main li button").filter({ hasText: ref }).first();
  if (!(await line.isVisible().catch(() => false))) notTested(`unmatched line ${ref} not listed in the Matching tab`);
  await line.click();
  await page.waitForTimeout(1200);
  await settle(page);
  const card = page.locator("main").locator("xpath=.//*[normalize-space(text())='المطالبات المقترحة']/ancestor::*[contains(@class,'rounded') or @data-slot='card'][1]").first();
  return card;
}
async function candidateFor(page, orderNumber) {
  const cand = page.locator("main div.rounded-sm.border").filter({ hasText: orderNumber }).filter({ has: page.getByRole("button") }).first();
  if (!(await cand.isVisible().catch(() => false))) return null;
  return cand;
}
async function confirmAllocation(page, mode = "click") {
  const dlg = dialog(page);
  await dlg.waitFor({ state: "visible" });
  await page.waitForTimeout(600);
  const confirm = btn(dlg, /^تأكيد المطابقة والترحيل$/);
  const dlgText = (await dlg.innerText().catch(() => "")).replace(/\s+/g, " ");
  let dropInfo = null;
  if (mode === "dblclick") await confirm.dblclick();
  else if (mode === "drop") {
    const d = await dropFirstResponse(page, /\/payment-reconciliation\/methods\/[^/]+\/matches$/);
    dropInfo = d.info;
    await confirm.click();
    const first = await expectToast(page, /./, 20000, { acceptError: true });
    dropInfo.firstToast = first.text;
    await d.off();
    await dismissToasts(page);
    await page.waitForTimeout(500);
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    else dropInfo.note = "allocation dialog closed after the dropped response";
  } else await confirm.click();
  const t = await expectToast(page, /تمت المطابقة|مسجّلة مسبقًا/, 30000);
  await settle(page);
  return { toast: t, dlgText, dropInfo };
}
/** Full UI match of one statement line (ref) to the claim of order `key`. */
async function matchLine(page, key, { mode = "click" } = {}) {
  const o = ord(key);
  const ref = `${RUN}-TXN-${key}`;
  await selectLine(page, ref);
  const cand = await candidateFor(page, o.number);
  const suggestionsText = (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ");
  if (!cand) return { ok: false, detail: `no suggestion for ${o.number}; panel: ${suggestionsText.slice(suggestionsText.indexOf("المطالبات المقترحة"), suggestionsText.indexOf("المطالبات المقترحة") + 300)}` };
  const reasons = (await cand.innerText()).replace(/\s+/g, " ");
  const quick = cand.getByRole("button", { name: /^تأكيد المطابقة والترحيل$/ });
  const allocate = cand.getByRole("button", { name: /^تخصيص…$/ });
  const quickShown = await quick.isVisible().catch(() => false);
  await (quickShown ? quick : allocate).click();
  const r = await confirmAllocation(page, mode);
  return { ok: r.toast.ok, reasons, quickShown, toast: r.toast.text, dropInfo: r.dropInfo, dlgText: r.dlgText };
}
async function verifyPosted(key, { expectDate, expectRate } = {}) {
  const o = await getOrder(ord(key).id);
  const claim = claimsOf(o).find((p) => p.paymentMethodId === ctx.methods.tamara.id && p.status !== "REJECTED" && p.status !== "DISPUTED") ?? claimsOf(o)[0];
  const { je, jeCount } = claim ? await paymentReceiptJE(claim.id) : {};
  const ev = je ? jeEvidence(`receipt ${key} ${o.internalOrderId}`, je) : null;
  const clearing = ctx.accounts.tamara.id;
  const dr = ev?.lines.find((l) => l.debit > 0);
  const cr = ev?.lines.find((l) => l.credit > 0);
  const problems = [];
  if (!claim) problems.push("no claim");
  if (claim?.status !== "VERIFIED") problems.push(`claim status=${claim?.status}`);
  if (claim?.settlementStatus !== "AWAITING_SETTLEMENT") problems.push(`settlementStatus=${claim?.settlementStatus}`);
  if (!ev) problems.push("no receipt JE");
  else {
    if (!ev.balanced) problems.push("JE not balanced");
    if (dr?.accountId !== clearing) problems.push(`debit account=${dr?.account} (want tagged clearing)`);
    if (cr?.accountId === clearing || !cr) problems.push(`credit account=${cr?.account}`);
    if (expectDate && ev.date !== iso(expectDate)) problems.push(`JE date=${ev.date} (want provider txn date ${iso(expectDate)})`);
    if (expectRate != null && !near(ev.exchangeRate, expectRate, 1e-6)) problems.push(`JE rate=${ev.exchangeRate} (want ${expectRate})`);
  }
  if (jeCount > 1) problems.push(`JEs linked to claim=${jeCount}`);
  return { o, claim, ev, problems, summary: `${claim?.paymentNumber} ${claim?.status}/${claim?.settlementStatus}; ${jeLine(ev)}` };
}

async function c3() {
  const fin = await session("qa-finance");
  const bKeys = ["B01", "B03", "B04", "B05", "B06", "B07", "B08", "B09", "B10", ...(ctx.orders.X1 && ctx.orders.X2 ? ["X1", "X2"] : [])];
  await step("C3", fin, "workspace list shows the reconciliation-enabled method only (Tamara QA, not Bank transfer QA)", async (page) => {
    await go(page, "/finance/payment-reconciliation");
    const text = await mainText(page);
    const tam = text.includes(ctx.methods.tamara.name);
    if (!ctx.methods?.tamara || !ctx.methods?.bankTransfer) blocked("tagged payment methods missing (setup failed)");
    const bank = text.includes(ctx.methods.bankTransfer.name);
    return { status: tam && !bank ? "PASS" : "FAIL", detail: `Tamara QA card=${tam}; Bank transfer QA card=${bank}`, url: `${BASE}/finance/payment-reconciliation`, shot: await shot(page, "c3-methods-list") };
  });
  await step("C3", fin, "Google Sheets connection", async (page) => {
    await go(page, wsPath());
    await openTab(page, /^الكشف/);
    const text = await mainText(page);
    const notConfigured = /غير مُعدّ على الخادم/.test(text);
    const shareWith = (text.match(/شارك الجدول \(صلاحية عرض\) مع:\s*(\S+@\S+)/) ?? [])[1];
    const sh = await shot(page, "c3-sheets-card");
    blocked(notConfigured ? "Google Sheets service account is NOT configured on this server — sync cannot be exercised" : `service account configured${shareWith ? ` (${shareWith})` : ""}; needs a shared test sheet — the script never creates or writes external sheets`);
    return { shot: sh };
  }, { retry: false });
  const csvPath = resolve(OUT, `statement-${RUN}.csv`);
  await step("C3", fin, `CSV statement import (${bKeys.length} rows: B01,B03–B10 in ${ctx.func?.code}, X1,X2 in ${xc()}; date ${iso(YESTERDAY)})`, async (page) => {
    if (bKeys.some((k) => !ctx.orders[k])) blocked(`orders missing: ${bKeys.filter((k) => !ctx.orders[k]).join(",")}`);
    writeFileSync(csvPath, csvFor(bKeys));
    const before = await methodLines(ctx.methods.tamara.id);
    const r = await importCsv(page, csvPath);
    const lines = await methodLines(ctx.methods.tamara.id);
    const mine = lines.filter((l) => String(l.providerReference ?? "").startsWith(`${RUN}-TXN-`));
    ctx.c5 ??= {};
    ctx.c5.linesAfterFirstImport = mine.length;
    saveCtx();
    created("Statement file", rel(csvPath), `${BASE}${wsPath()}`);
    const ok = r.ok && mine.filter((l) => bKeys.includes(String(l.providerReference).split("-TXN-")[1])).length === bKeys.length;
    return { status: ok || (before.length && mine.length >= bKeys.length) ? "PASS" : "FAIL", detail: `${r.text}; tagged lines now=${mine.length}; preview="${(r.preview ?? "").slice(0, 200)}"`, url: `${BASE}${wsPath()}`, shot: r.shot };
  });
  await step("C5", fin, "re-import the same CSV → duplicates only, no new lines", async (page) => {
    const before = (await methodLines(ctx.methods.tamara.id)).length;
    const r = await importCsv(page, csvPath);
    const after2 = (await methodLines(ctx.methods.tamara.id)).length;
    return { status: after2 === before ? "PASS" : "FAIL", detail: `${r.text}; lines before=${before} after=${after2}`, url: `${BASE}${wsPath()}`, shot: r.shot };
  });
  await step("C3", fin, "manual statement entry for B02 (authorized Finance user)", async (page) => {
    const o = ord("B02");
    const ref = `${RUN}-TXN-B02`;
    const exists = (await methodLines(ctx.methods.tamara.id)).find((l) => l.providerReference === ref);
    if (exists) return { detail: `already present (${exists.status})` };
    await go(page, wsPath());
    await openTab(page, /^الكشف/);
    await clickFirst(page, [btn(page, /^إضافة حركة$/)], "إضافة حركة");
    const dlg = dialog(page);
    await dlg.waitFor({ state: "visible" });
    await field(dlg, /^المبلغ/).fill(String(o.total));
    await pick(page, field(dlg, /^العملة/), { search: o.currency, option: escRe(o.currency) });
    await typeDate(field(dlg, /^تاريخ العملية/), YESTERDAY);
    await field(dlg, /^مرجع المزوّد/).fill(ref);
    await field(dlg, /^مرجع الطلب/).fill(o.number);
    await field(dlg, /^اسم العميل/).fill(custOf("B02"));
    await field(dlg, /^جوال العميل/).fill(phoneFor(ORDER_SPECS.B02.idx));
    await field(dlg, /^حالة المزوّد/).fill("PAID");
    const fee = field(dlg, /^الرسوم/);
    if (await fee.isVisible().catch(() => false)) await fee.fill("25");
    await shot(page, "c3-manual-line-filled");
    await btn(dlg, /^إضافة الحركة$/).click();
    const t = await expectToast(page, /تمت إضافة الحركة/);
    const line = (await methodLines(ctx.methods.tamara.id)).find((l) => l.providerReference === ref);
    return { status: t.ok && line ? "PASS" : "FAIL", detail: `${t.text}; line=${line?.id ?? "-"} source=${line?.sourceType ?? line?.source ?? "-"} status=${line?.status}`, url: `${BASE}${wsPath()}`, shot: await shot(page, "c3-manual-line-saved") };
  });
  // Match B01 — reasons + JE (Dr clearing / Cr AR at the provider transaction date).
  await step("C3", fin, "B01: suggestion reasons → Confirm match & post → JE Dr Tamara clearing / Cr AR (provider txn date)", async (page) => {
    const pre = await verifyPosted("B01");
    let r = { reasons: "(already matched)", toast: "-" };
    if (pre.claim?.status !== "VERIFIED") r = await matchLine(page, "B01");
    if (r.ok === false) return { status: "FAIL", detail: r.detail ?? r.toast, shot: await shot(page, "c3-B01-match-fail") };
    const v = await verifyPosted("B01", { expectDate: YESTERDAY, expectRate: 1 });
    let hasReason = /المرجع|الطلب/.test(r.reasons) && /المبلغ/.test(r.reasons);
    if (pre.claim?.status === "VERIFIED") {
      // Matched earlier in this RUN: judge the reasons stored on the real match record.
      const claimId = pre.claim?.id;
      const stored = (await methodLines(ctx.methods.tamara.id))
        .flatMap((l) => l.matches ?? [])
        .find((m) => m.status === "ACTIVE" && m.payment?.id === claimId);
      const signals = (Array.isArray(stored?.reasons) ? stored.reasons : []).map((x) => x.signal);
      hasReason = signals.some((sg) => sg === "REFERENCE" || sg === "ORDER") && signals.includes("AMOUNT");
      r.reasons = `(matched earlier; stored signals: ${signals.join(",") || "none"})`;
    }
    const ships = await shipmentsOf(ctx.orders.B01.id);
    const shipUnchanged = ships.length === 1 && shipSig(ships[0]) === ctx.b01Shipment?.sig;
    return {
      status: v.problems.length || !hasReason || !shipUnchanged ? "FAIL" : "PASS",
      detail: `reasons="${r.reasons.slice(0, 200)}"; quickConfirm=${r.quickShown}; toast=${r.toast}; ${v.summary}; shipment unchanged=${shipUnchanged}${v.problems.length ? `; PROBLEMS: ${v.problems.join("; ")}` : ""}`,
      url: `${BASE}${wsPath()}`,
      shot: await shot(page, "c3-B01-matched"),
      evidence: { je: v.ev?.number },
    };
  });
  await step("C3", fin, "B01 order page: verified & posted, awaiting provider settlement (declared vs verified shown separately)", async (page) => {
    await go(page, `/store-orders/${ctx.orders.B01.id}`);
    const text = await mainText(page);
    const verified = /تحققت المالية\/مرحّل/.test(text);
    const awaitingSettle = /بانتظار تسوية المزوّد/.test(text);
    return { status: verified ? "PASS" : "FAIL", detail: `"تحققت المالية/مرحّل"=${verified}; "بانتظار تسوية المزوّد"=${awaitingSettle}`, url: orderUrl(ctx.orders.B01), shot: await shot(page, "c3-B01-order-verified") };
  });
  await step("C5", fin, "B02 (manual line): Confirm match — first response dropped, confirm pressed again → one match / one receipt", async (page) => {
    const pre = await verifyPosted("B02");
    let r = { toast: "(already matched)" };
    if (pre.claim?.status !== "VERIFIED") r = await matchLine(page, "B02", { mode: "drop" });
    const v = await verifyPosted("B02", { expectDate: YESTERDAY });
    const lines = (await methodLines(ctx.methods.tamara.id)).filter((l) => l.providerReference === `${RUN}-TXN-B02`);
    return { status: v.problems.length || lines.length !== 1 ? "FAIL" : "PASS", detail: `dropped (server ${r.dropInfo?.serverStatus}); first="${r.dropInfo?.firstToast ?? "-"}"; resubmit="${r.toast}"; ${v.summary}; statement lines=${lines.length} status=${lines[0]?.status}${v.problems.length ? `; PROBLEMS: ${v.problems.join("; ")}` : ""}`, url: `${BASE}${wsPath()}`, shot: await shot(page, "c5-B02-match-retry") };
  });
  await step("C5", fin, "B03: double-click Confirm match & post → one match / one receipt JE", async (page) => {
    const pre = await verifyPosted("B03");
    let r = { toast: "(already matched)" };
    if (pre.claim?.status !== "VERIFIED") r = await matchLine(page, "B03", { mode: "dblclick" });
    const v = await verifyPosted("B03", { expectDate: YESTERDAY });
    return { status: v.problems.length ? "FAIL" : "PASS", detail: `toast=${r.toast}; ${v.summary}${v.problems.length ? `; PROBLEMS: ${v.problems.join("; ")}` : ""}`, url: `${BASE}${wsPath()}` };
  });
  for (const key of ["B04", "B05", "B06", "B07", "B08", "B09", "B10"]) {
    await step("C4", fin, `${key}: match & post (UI)`, async (page) => {
      const pre = await verifyPosted(key);
      let r = { toast: "(already matched)" };
      if (pre.claim?.status !== "VERIFIED") r = await matchLine(page, key);
      if (r.ok === false) return { status: "FAIL", detail: r.detail ?? r.toast };
      const v = await verifyPosted(key, { expectDate: YESTERDAY });
      return { status: v.problems.length ? "FAIL" : "PASS", detail: `${r.toast}; ${v.summary}${v.problems.length ? `; PROBLEMS: ${v.problems.join("; ")}` : ""}` };
    });
  }
  for (const key of ["X1", "X2"]) {
    await step("C6", fin, `${key} (${xc()}): match & post → receipt JE at the provider-transaction-date rate ${rY()}`, async (page) => {
      if (!ctx.orders[key]) blocked(ctx.xBlocked ?? `order ${key} missing`);
      const pre = await verifyPosted(key);
      let r = { toast: "(already matched)" };
      if (pre.claim?.status !== "VERIFIED") r = await matchLine(page, key);
      if (r.ok === false) return { status: "FAIL", detail: r.detail ?? r.toast, shot: await shot(page, `c6-${key}-match-fail`) };
      const v = await verifyPosted(key, { expectDate: YESTERDAY, expectRate: rY() });
      ctx.xReceipts ??= {};
      if (v.ev) ctx.xReceipts[key] = { jeId: v.ev.id, number: v.ev.number, exchangeRate: v.ev.exchangeRate, date: v.ev.date };
      saveCtx();
      return { status: v.problems.length ? "FAIL" : "PASS", detail: `${r.toast}; ${v.summary}${v.problems.length ? `; PROBLEMS: ${v.problems.join("; ")}` : ""}`, shot: await shot(page, `c6-${key}-matched`) };
    });
  }
  await step("C3", fin, "BK (non-reconciled Bank transfer QA): Finance payment review → Confirm & post → JE Dr bank-transfer account (no statement matching)", async (page) => {
    const o = ord("BK");
    if (!o) blocked("BK missing");
    let fresh = await getOrder(o.id);
    let claim = claimsOf(fresh)[0];
    let t = { text: "(already posted)" };
    if (claim && claim.status !== "VERIFIED") {
      await go(page, "/finance/payment-review");
      const box = page.getByPlaceholder(/تصفية|بحث/).first();
      if (await box.isVisible().catch(() => false)) {
        await box.fill(o.number);
        await page.waitForTimeout(1500);
        await settle(page);
      }
      const row = page.locator("main table tbody tr").filter({ hasText: o.number }).first();
      if (!(await row.isVisible().catch(() => false))) return { status: "FAIL", detail: `BK claim ${claim.paymentNumber} not listed in Finance payment review`, shot: await shot(page, "c3-BK-review-missing") };
      await shot(page, "c3-BK-review-row");
      await row.getByTestId("payment-confirm-post").click();
      const alert = page.getByRole("alertdialog").last();
      await alert.waitFor({ state: "visible" });
      await shot(page, "c3-BK-confirm-dialog");
      await btn(alert, /تأكيد وترحيل/).click();
      t = await expectToast(page, /تم/);
      await settle(page);
    }
    fresh = await getOrder(o.id);
    claim = claimsOf(fresh)[0];
    const { je } = claim ? await paymentReceiptJE(claim.id) : {};
    const ev = je ? jeEvidence(`receipt BK ${o.number} (non-reconciled)`, je) : null;
    const dr = ev?.lines.find((l) => l.debit > 0);
    const lines = await methodLines(ctx.methods.tamara.id);
    const inStatementQueue = lines.some((l) => l.orderReference === o.number);
    const ok = claim?.status === "VERIFIED" && dr?.accountId === ctx.accounts.bankTransfer.id && ev?.balanced && !inStatementQueue;
    return { status: ok ? "PASS" : "FAIL", detail: `${t.text}; claim ${claim?.paymentNumber} ${claim?.status}/${claim?.settlementStatus}; ${jeLine(ev)}; debit=tagged bank-transfer account ${dr?.accountId === ctx.accounts.bankTransfer.id}`, url: `${BASE}/finance/payment-review`, shot: await shot(page, "c3-BK-posted") };
  });
}

// ------------------------------------------------------------------ S2/S3 ambiguous + mismatch
async function addManualLine(page, { ref, amount, currency, orderRef, name, phone, date = YESTERDAY }) {
  const exists = (await methodLines(ctx.methods.tamara.id)).find((l) => l.providerReference === ref);
  if (exists) return { line: exists, reused: true };
  await go(page, wsPath());
  await openTab(page, /^الكشف/);
  await clickFirst(page, [btn(page, /^إضافة حركة$/)], "إضافة حركة");
  const dlg = dialog(page);
  await dlg.waitFor({ state: "visible" });
  await field(dlg, /^المبلغ/).fill(String(amount));
  await pick(page, field(dlg, /^العملة/), { search: currency, option: escRe(currency) });
  await typeDate(field(dlg, /^تاريخ العملية/), date);
  await field(dlg, /^مرجع المزوّد/).fill(ref);
  if (orderRef) await field(dlg, /^مرجع الطلب/).fill(orderRef);
  if (name) await field(dlg, /^اسم العميل/).fill(name);
  if (phone) await field(dlg, /^جوال العميل/).fill(phone);
  await field(dlg, /^حالة المزوّد/).fill("PAID");
  await btn(dlg, /^إضافة الحركة$/).click();
  const t = await expectToast(page, /تمت إضافة الحركة/);
  const line = (await methodLines(ctx.methods.tamara.id)).find((l) => l.providerReference === ref);
  return { line, toast: t };
}
async function s2s3() {
  const fin = await session("qa-finance");
  await step("S2", fin, "phone-only statement line (A1/A2 same phone, same amount) → ambiguous warning, one-click confirm disabled", async (page) => {
    if (!ctx.orders.A1 || !ctx.orders.A2) blocked("A1/A2 missing");
    const ref = `${RUN}-TXN-AMB`;
    const m = await addManualLine(page, { ref, amount: 300, currency: ctx.func.code, phone: phoneFor(ORDER_SPECS.A1.idx) });
    if (!m.line) return { status: "FAIL", detail: `manual line not saved: ${m.toast?.text}` };
    await selectLine(page, ref);
    const text = await mainText(page);
    const warn = /أكثر من مطالبة تطابق بنفس الدرجة/.test(text);
    const c1 = await candidateFor(page, ctx.orders.A1.number);
    const c2 = await candidateFor(page, ctx.orders.A2.number);
    const quick = c1 ? await c1.getByRole("button", { name: /^تأكيد المطابقة والترحيل$/ }).isVisible().catch(() => false) : null;
    const sh = await shot(page, "s2-ambiguous-warning");
    const matchesAfter = (await methodLines(ctx.methods.tamara.id)).find((l) => l.providerReference === ref)?.status;
    return { status: warn && c1 && c2 && !quick && matchesAfter === "UNMATCHED" ? "PASS" : "FAIL", detail: `ambiguous warning=${warn}; candidates A1=${!!c1} A2=${!!c2}; one-click confirm shown=${quick}; line status=${matchesAfter} (left unmatched)`, url: `${BASE}${wsPath()}`, shot: sh };
  });
  await step("S3", fin, `currency mismatch: line in ${ctx.xccy?.code ?? ctx.mismatchCcy ?? "?"} referencing A1 (${ctx.func?.code} claim) → match refused`, async (page) => {
    if (!ctx.orders.A1) blocked("A1 missing");
    const ref = `${RUN}-TXN-CCY`;
    const mc = ctx.xccy?.code ?? ctx.mismatchCcy;
    if (!mc) blocked("no second currency available");
    const m = await addManualLine(page, { ref, amount: 300, currency: mc, orderRef: ctx.orders.A1.number });
    if (!m.line) return { status: "FAIL", detail: `manual line not saved: ${m.toast?.text}` };
    await selectLine(page, ref);
    const text = (await mainText(page)).replace(/\s+/g, " ");
    const cand = await candidateFor(page, ctx.orders.A1.number);
    let outcome = "no candidate offered for the mismatched currency";
    let refused = !cand;
    if (cand) {
      const reasons = (await cand.innerText()).replace(/\s+/g, " ");
      await cand.getByRole("button", { name: /^تأكيد المطابقة والترحيل$|^تخصيص…$/ }).first().click();
      const dlg = dialog(page);
      await dlg.waitFor({ state: "visible" });
      const confirm = btn(dlg, /^تأكيد المطابقة والترحيل$/);
      if (!(await confirm.isEnabled().catch(() => false))) {
        refused = true;
        outcome = `confirm disabled; reasons=${reasons.slice(0, 120)}`;
      } else {
        await confirm.click();
        const t = await expectToast(page, /تمت المطابقة/, 12000);
        refused = !t.ok;
        outcome = `reasons=${reasons.slice(0, 120)}; result=${t.text}`;
      }
      await page.keyboard.press("Escape").catch(() => {});
    }
    const a1 = await getOrder(ctx.orders.A1.id);
    const claim = claimsOf(a1)[0];
    const lineStatus = (await methodLines(ctx.methods.tamara.id)).find((l) => l.providerReference === ref)?.status;
    const blockedReason = /العملة/.test(text.slice(text.indexOf("المطالبات المقترحة"), text.indexOf("المطالبات المقترحة") + 600));
    return { status: refused && claim?.status === "PENDING" && lineStatus === "UNMATCHED" ? "PASS" : "FAIL", detail: `${outcome}; currency flagged in panel=${blockedReason}; A1 claim=${claim?.status}; line=${lineStatus}`, url: `${BASE}${wsPath()}`, shot: await shot(page, "s3-currency-mismatch") };
  });
  await step("S3", fin, "amount mismatch: 350 line for A2's 300 claim → over-allocation refused", async (page) => {
    if (!ctx.orders.A2) blocked("A2 missing");
    const ref = `${RUN}-TXN-AMT`;
    const m = await addManualLine(page, { ref, amount: 350, currency: ctx.func.code, orderRef: ctx.orders.A2.number });
    if (!m.line) return { status: "FAIL", detail: `manual line not saved: ${m.toast?.text}` };
    await selectLine(page, ref);
    const cand = await candidateFor(page, ctx.orders.A2.number);
    if (!cand) return { status: "PASS", detail: "no candidate offered for the amount mismatch (refused at suggestion level)", shot: await shot(page, "s3-amount-mismatch") };
    const reasons = (await cand.innerText()).replace(/\s+/g, " ");
    const quickShown = await cand.getByRole("button", { name: /^تأكيد المطابقة والترحيل$/ }).isVisible().catch(() => false);
    await cand.getByRole("button", { name: /^تأكيد المطابقة والترحيل$|^تخصيص…$/ }).first().click();
    const dlg = dialog(page);
    await dlg.waitFor({ state: "visible" });
    const amt = dlg.getByRole("spinbutton", { name: /المبلغ/ }).or(dlg.getByLabel(/^المبلغ$/)).first();
    let outcome = "";
    if (await amt.isVisible().catch(() => false)) {
      await amt.fill("350");
      await page.waitForTimeout(500);
    }
    const confirm = btn(dlg, /^تأكيد المطابقة والترحيل$/);
    const dlgText = (await dlg.innerText()).replace(/\s+/g, " ");
    const clientErr = /يتجاوز المبلغ غير المخصّص للمطالبة/.test(dlgText);
    const sh = await shot(page, "s3-amount-mismatch-dialog");
    if (await confirm.isEnabled().catch(() => false)) {
      await confirm.click();
      const t = await expectToast(page, /تمت المطابقة/, 12000);
      outcome = `server result=${t.text}`;
    } else outcome = "confirm disabled";
    await page.keyboard.press("Escape").catch(() => {});
    const a2 = await getOrder(ctx.orders.A2.id);
    const claim = claimsOf(a2)[0];
    const refused = claim?.status === "PENDING";
    return { status: refused ? "PASS" : "FAIL", detail: `reasons=${reasons.slice(0, 140)}; quick confirm shown=${quickShown}; client error "exceeds claim"=${clientErr}; ${outcome}; A2 claim=${claim?.status} ${claim?.amount}`, url: `${BASE}${wsPath()}`, shot: sh };
  });
}

// ------------------------------------------------------------------ S1 dispute + S4 correction
async function s1s4() {
  const fin = await session("qa-finance");
  const ag = await session("qa-sales-agent");
  await step("S1", fin, "DSP: Finance disputes the claim from the Matching tab (reason) after shipment", async (page) => {
    const o = ord("DSP");
    if (!o) blocked("DSP missing");
    let fresh = await getOrder(o.id);
    let claim = claimsOf(fresh).find((p) => p.paymentMethodId === ctx.methods.tamara.id);
    let t = { text: "(already disputed)" };
    if (claim?.status !== "DISPUTED") {
      await go(page, wsPath());
      await openTab(page, /^المطابقة/);
      const search = page.getByPlaceholder(/ابحث في المطالبات/).first();
      if (await search.isVisible().catch(() => false)) {
        await search.fill(o.number);
        await page.waitForTimeout(1500);
      }
      const row = page.locator("main table tbody tr").filter({ hasText: o.number }).first();
      if (!(await row.isVisible().catch(() => false))) return { status: "FAIL", detail: `claim of ${o.number} not in "مطالبات هذه الطريقة"`, shot: await shot(page, "s1-claim-missing") };
      await row.getByRole("button", { name: /الاعتراض على المطالبة/ }).click();
      const dlg = dialog(page);
      await dlg.waitFor({ state: "visible" });
      await dlg.locator("textarea").first().fill(`${RUN} QA: provider reports no such payment`);
      await shot(page, "s1-dispute-dialog");
      await btn(dlg, /الاعتراض على المطالبة/).last().click();
      t = await expectToast(page, /تم الاعتراض/);
      await settle(page);
    }
    fresh = await getOrder(o.id);
    claim = claimsOf(fresh).find((p) => p.paymentMethodId === ctx.methods.tamara.id);
    const ships = await shipmentsOf(o.id);
    const shipOk = ships.length === (ctx.dspShipment?.n ?? 1) && shipSig(ships[0]) === ctx.dspShipment?.sig;
    return { status: claim?.status === "DISPUTED" && fresh.paymentDiscrepancy && shipOk ? "PASS" : "FAIL", detail: `${t.text}; claim=${claim?.status} reason="${claim?.disputeReason ?? ""}"; order.paymentDiscrepancy=${fresh.paymentDiscrepancy}; declared=${fresh.declaredPaymentStatus}; shipments unchanged=${shipOk}`, url: orderUrl(o), shot: await shot(page, "s1-disputed") };
  });
  await step("S1", ag, "DSP order page shows the payment discrepancy banner (Sales view)", async (page) => {
    const o = ord("DSP");
    await go(page, `/store-orders/${o.id}`);
    const text = await mainText(page);
    const banner = /تعارض في الدفع/.test(text);
    const disputed = /معترض عليه/.test(text);
    return { status: banner ? "PASS" : "FAIL", detail: `banner "تعارض في الدفع"=${banner}; disputed badge=${disputed}`, url: orderUrl(o), shot: await shot(page, "s1-discrepancy-banner") };
  });
  await step("S4", ag, "qa-sales-agent tries to re-declare DSP after fulfillment → refused (correction permission)", async (page) => {
    const o = ord("DSP");
    const before = claimsOf(await getOrder(o.id)).length;
    await go(page, `/store-orders/${o.id}`);
    const b = btn(page, /^إبلاغ دفع العميل$/).first();
    if (!(await b.isVisible().catch(() => false))) {
      return { status: "PASS", detail: `declare action not offered to Sales after fulfillment; claims=${before}`, url: orderUrl(o), shot: await shot(page, "s4-agent-no-action") };
    }
    await b.click();
    const dlg = dialog(page);
    await dlg.waitFor({ state: "visible" });
    await page.waitForTimeout(800);
    await fillDeclaration(page, dlg, { kind: "FULL", methodName: ctx.methods.tamara.name, reference: `${RUN}-REF-DSP-2` });
    await btn(dlg, /^حفظ الإبلاغ$/).click();
    const t = await expectToast(page, /تم الإبلاغ/, 15000);
    await page.keyboard.press("Escape").catch(() => {});
    const after2 = claimsOf(await getOrder(o.id)).length;
    const sh = await shot(page, "s4-agent-refused");
    return { status: !t.ok && after2 === before ? "PASS" : "FAIL", detail: `result=${t.text}; claims before=${before} after=${after2}`, url: orderUrl(o), shot: sh };
  });
  await step("S4", fin, "qa-finance (sales.receipts.confirm) records the audited correction on DSP", async (page) => {
    const o = ord("DSP");
    const fresh = await getOrder(o.id);
    const before = claimsOf(fresh).length;
    if (claimsOf(fresh).some((p) => p.status === "PENDING")) return { detail: `already corrected (pending claim exists); claims=${before}` };
    const d = await declareOnOrderPage(fin, "DSP", { kind: "FULL", method: "tamara", reference: `${RUN}-REF-DSP-FIN` });
    const o2 = await getOrder(o.id);
    const newClaim = claimsOf(o2).find((p) => p.status === "PENDING");
    return { status: d.toast.ok && newClaim ? "PASS" : "FAIL", detail: `${d.toast.text}; claims ${before}→${claimsOf(o2).length}; new claim origin=${newClaim?.origin}; declared=${o2.declaredPaymentStatus}`, url: orderUrl(o), shot: await shot(page, "s4-finance-correction") };
  });
}

// ------------------------------------------------------------------ settlement (C4/C6) + balances (C8)
async function balanceStep(label) {
  const fin = await session("qa-finance");
  return step("C8", fin, `provider balance card — ${label}`, async (page) => {
    const b = await providerBalance(ctx.methods.tamara.id);
    await go(page, wsPath());
    await openTab(page, /^بانتظار التسوية/);
    const text = await mainText(page);
    const card = /رصيد حساب التسوية الوسيط/.test(text) && /المطالبات غير المسوّاة/.test(text);
    const reconciled = /متطابق/.test(text) && !/لا يطابق/.test(text);
    ctx.balances ??= {};
    ctx.balances[label] = b ? { gl: b.glBalance, unsettled: b.unsettledCarrying, difference: b.difference } : null;
    saveCtx();
    return { status: b && near(b.glBalance, b.unsettledCarrying) && card ? "PASS" : "FAIL", detail: `GL clearing=${b?.glBalance} unsettled carrying=${b?.unsettledCarrying} difference=${b?.difference}; card shown=${card}; "متطابق"=${reconciled}; by currency=${JSON.stringify(b?.unsettledByCurrency?.map((x) => `${x.currency.code}:${x.count}:${x.remainingAmount}`) ?? [])}`, url: `${BASE}${wsPath()}`, shot: await shot(page, `c8-balance-${label}`) };
  });
}
async function settleUI(page, keys, { receivedAmount, receivedCurrency, fee, reference, mode = "click", filter }) {
  await go(page, wsPath());
  await openTab(page, /^بانتظار التسوية/);
  await page.waitForTimeout(800);
  const rowBox = (row) => row.getByRole("checkbox", { name: "تحديد الصف" }).first();
  const firstRow = page.locator("main table tbody tr").filter({ hasText: ctx.orders[keys[0]].number }).first();
  const perRow = await rowBox(firstRow).isVisible().catch(() => false);
  if (perRow) {
    for (const key of keys) {
      const row = page.locator("main table tbody tr").filter({ hasText: ctx.orders[key].number }).first();
      if (!(await row.isVisible().catch(() => false))) notTested(`awaiting-settlement row for ${key} not visible`);
      await rowBox(row).click();
      await page.waitForTimeout(150);
    }
  } else {
    // DEFECT workaround: EnterpriseDataTable renders EMPTY row-selection cells on desktop
    // (only the header "select all" checkbox works) — filter to exactly the target claims,
    // verify the visible rows, then use the header checkbox.
    const search = page.getByPlaceholder(/ابحث برقم المطالبة أو الطلب/).first();
    await search.fill(filter);
    await page.waitForTimeout(1500);
    await settle(page);
    const rowsText = await page.locator("main table tbody tr").allInnerTexts();
    const visible = keys.filter((k) => rowsText.some((t) => t.includes(ctx.orders[k].number)));
    if (visible.length !== keys.length || rowsText.length !== keys.length) notTested(`filter "${filter}" shows ${rowsText.length} rows (${visible.length}/${keys.length} targets) — refusing select-all`);
    await page.locator("main table thead").getByRole("checkbox").first().click();
    await page.waitForTimeout(400);
    ctx.rowSelectDefect = true;
  }
  const bar = (await mainText(page)).replace(/\s+/g, " ");
  const selectedSummary = (bar.match(/\d+ محددة · [^ ]+ ?[^ ]*/) ?? [""])[0];
  await clickFirst(page, [btn(page, /^تسوية$/)], "تسوية");
  const dlg = dialog(page);
  await dlg.waitFor({ state: "visible" });
  await page.waitForTimeout(800);
  if (receivedCurrency) {
    const cur = page.locator('[id="settle-currency"]');
    const txt = await cur.innerText().catch(() => "");
    if (!txt.includes(receivedCurrency)) await pick(page, cur, { search: receivedCurrency, option: escRe(receivedCurrency) });
  }
  await page.locator('[id="settle-received"]').fill(String(receivedAmount));
  const acct = page.locator('[id="settle-account"]');
  const acctText = await acct.innerText().catch(() => "");
  if (!acctText.includes(ctx.receivingAccount.name)) await pick(page, acct, { search: ctx.receivingAccount.name.slice(-16), option: escRe(ctx.receivingAccount.name) });
  await page.locator('[id="settle-reference"]').fill(reference);
  if (fee != null) await page.locator('[id="settle-fee"]').fill(String(fee));
  await shot(page, `settle-${reference}-inputs`);
  await btn(dlg, /^معاينة$/).click();
  await page.waitForTimeout(2000);
  await settle(page);
  const previewText = (await dialog(page).innerText().catch(() => "")).replace(/\s+/g, " ");
  const previewShot = await shot(page, `settle-${reference}-preview`);
  const confirm = btn(dialog(page), /^تأكيد وترحيل$/);
  if (!(await confirm.isVisible().catch(() => false))) return { ok: false, text: `preview not shown: ${previewText.slice(0, 400)}`, previewText, previewShot, selectedSummary };
  let dropInfo = null;
  if (mode === "dblclick") await confirm.dblclick();
  else if (mode === "drop") {
    const d = await dropFirstResponse(page, /\/payment-settlements$/);
    dropInfo = d.info;
    await confirm.click();
    const first = await expectToast(page, /./, 20000, { acceptError: true });
    dropInfo.firstToast = first.text;
    await d.off();
    await dismissToasts(page);
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
  } else await confirm.click();
  const t = await expectToast(page, /تم ترحيل التسوية|مرحّلة مسبقًا/, 30000);
  await settle(page);
  return { ok: t.ok, text: t.text, previewText, previewShot, dropInfo, selectedSummary };
}
function settlementLinesCheck(ev, expect) {
  const roleOf = (l) => (l.accountId === ctx.receivingAccountGl ? "BANK" : l.accountId === ctx.accounts.tamara.id ? "CLEARING" : l.accountId === ctx.commissionAccountId ? "COMMISSION" : l.accountId === ctx.fxDiffAccountId ? "FX_DIFFERENCE" : "OTHER");
  const byRole = {};
  for (const l of ev?.lines ?? []) {
    const r = roleOf(l);
    byRole[r] ??= { debit: 0, credit: 0 };
    byRole[r].debit = r2(byRole[r].debit + l.debit);
    byRole[r].credit = r2(byRole[r].credit + l.credit);
  }
  const problems = [];
  for (const [role, [side, amount]] of Object.entries(expect)) {
    const got = byRole[role]?.[side];
    if (amount === "any") {
      if (!got) problems.push(`${role} ${side} line missing`);
    } else if (!near(got ?? 0, amount)) problems.push(`${role} ${side}=${got ?? 0} (want ${amount})`);
  }
  if (byRole.OTHER) problems.push(`unexpected account lines ${JSON.stringify(byRole.OTHER)}`);
  if (ev && !ev.balanced) problems.push("JE not balanced");
  return { byRole, problems };
}
async function c4() {
  const fin = await session("qa-finance");
  const keys = ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B09", "B10"];
  ctx.receivingAccountGl = ctx.accounts?.bank?.id;
  await balanceStep("before-C4");
  await step("C4", fin, "awaiting-settlement table: individual claims can be selected (row checkboxes)", async (page) => {
    await go(page, wsPath());
    await openTab(page, /^بانتظار التسوية/);
    await page.waitForTimeout(800);
    const rows = page.locator("main table tbody tr");
    const n = await rows.count();
    const boxes = await page.locator("main table tbody").getByRole("checkbox").count();
    const header = await page.locator("main table thead").getByRole("checkbox").count();
    const emptyCells = await page.locator('main table tbody td[data-column-id="select"]').evaluateAll((els) => els.filter((e) => !e.innerHTML.trim()).length);
    const dataRows = await page.locator('main table tbody td[data-column-id="select"]').count();
    if (!dataRows && ctx.rowSelectResult) return { ...ctx.rowSelectResult, detail: `(recorded earlier in this RUN) ${ctx.rowSelectResult.detail}` };
    ctx.rowSelectResult = { status: dataRows && boxes >= dataRows ? "PASS" : "FAIL", detail: `rows=${dataRows}; row checkboxes=${boxes}; empty select cells=${emptyCells}` };
    saveCtx();
    void n;
    return { status: dataRows && boxes >= dataRows ? "PASS" : "FAIL", detail: `rows=${dataRows}; row checkboxes=${boxes}; header select-all=${header}; empty select cells=${emptyCells}${boxes < dataRows ? " — DEFECT: EnterpriseDataTable renders empty row-selection cells on desktop (auto-injected 'select' column is rendered with cell.renderValue() because columnsWithExplicitCell only lists caller columns — components/master-data/enterprise-data-table.tsx ~L759/L1322); Finance cannot pick a subset of claims except by filtering and using select-all" : ""}`, url: `${BASE}${wsPath()}`, shot: await shot(page, "c4-row-selection") };
  }, { retry: false });
  await step("C4", fin, `settle 10 matched claims (gross 5,000 ${ctx.func?.code}) → received 4,500 → fee 500; double-click Confirm (C5)`, async (page) => {
    {
      // Read live: the setup step may be replayed (not re-executed) on a resumed RUN.
      const psLive = (await A("GET", "/accounting/posting-settings")).json ?? {};
      report.environment.commissionAccountConfigured = !!psLive.paymentGatewayFeeAccountId;
      if (!report.environment.commissionAccountConfigured) blocked("no Payment Gateway Fees account configured in posting settings");
    }
    const existing = (await settlementsOf(ctx.methods.tamara.id)).find((s) => s.providerReference === `${RUN}-PAYOUT-1`);
    const pays = [];
    for (const k of keys) {
      const o = await getOrder(ctx.orders[k].id);
      pays.push(claimsOf(o).find((p) => p.paymentMethodId === ctx.methods.tamara.id && p.status === "VERIFIED"));
    }
    if (pays.some((p) => !p)) return { status: "FAIL", detail: `not all 10 claims are VERIFIED: ${keys.filter((k, i) => !pays[i]).join(",")}` };
    const gross = r2(pays.reduce((a, p) => a + num(p.amount), 0));
    const settlementsBefore = (await settlementsOf(ctx.methods.tamara.id)).length;
    let r = { text: "(already settled)", previewText: "" };
    if (!existing) r = await settleUI(page, keys, { receivedAmount: r2(gross * 0.9), reference: `${RUN}-PAYOUT-1`, mode: "dblclick", filter: "عميل B" });
    if (!existing && !r.ok) return { status: "FAIL", detail: `${r.text}; preview: ${r.previewText?.slice(0, 400)}`, shot: r.previewShot };
    const list = await settlementsOf(ctx.methods.tamara.id);
    const mine = list.filter((s) => s.providerReference === `${RUN}-PAYOUT-1`);
    const st = mine[0] ? (await A("GET", `/payment-settlements/${mine[0].id}`)).json : null;
    const jeId = st?.journalEntry?.id ?? st?.journalEntryId;
    const je = jeId ? await getJE(jeId) : null;
    const ev = jeEvidence(`settlement ${st?.settlementNumber} (C4 batch)`, je);
    const fee = r2(gross - r2(gross * 0.9));
    const chk = settlementLinesCheck(ev, { BANK: ["debit", r2(gross * 0.9)], COMMISSION: ["debit", fee], CLEARING: ["credit", gross] });
    // preview == posted: the preview's JE lines show the same amounts.
    const pv = r.previewText ?? "";
    const fmt = (n) => [n.toLocaleString("en-US", { minimumFractionDigits: 2 }), n.toFixed(2)];
    const previewHas = existing ? "n/a (re-run)" : [gross, r2(gross * 0.9), fee].every((n) => fmt(n).some((s) => pv.includes(s)) || pv.includes(String(n)));
    const lines = st?.lines ?? [];
    const linkedPays = lines.map((l) => l.paymentId ?? l.payment?.id);
    const allLinked = pays.every((p) => linkedPays.includes(p.id));
    const settled = [];
    for (const k of keys) settled.push(claimsOf(await getOrder(ctx.orders[k].id)).find((p) => p.paymentMethodId === ctx.methods.tamara.id && p.status === "VERIFIED")?.settlementStatus);
    const jeBySource = st ? await jesBySource("PAYMENT_SETTLEMENT", st.id) : [];
    ctx.settlement1 = st ? { id: st.id, number: st.settlementNumber, jeId } : null;
    saveCtx();
    if (st) created("PaymentSettlement (C4)", st.settlementNumber, `${BASE}${wsPath()}`, { id: st.id, je: ev?.number });
    const problems = [...chk.problems];
    if (mine.length !== 1) problems.push(`settlements with this reference=${mine.length}`);
    if (jeBySource.length !== 1) problems.push(`JEs by source=${jeBySource.length}`);
    if (!allLinked) problems.push("settlement lines do not link all 10 payments");
    if (settled.some((x) => x !== "SETTLED")) problems.push(`claim settlementStatus=${settled.join(",")}`);
    if (previewHas === false) problems.push("preview amounts not found in the dialog");
    if (!near(st?.grossAmount, gross) || !near(st?.feeAmount, fee)) problems.push(`settlement gross/fee=${st?.grossAmount}/${st?.feeAmount}`);
    return {
      status: problems.length ? "FAIL" : "PASS",
      detail: `toast=${r.text}; selected="${r.selectedSummary ?? ""}"; settlements for method ${settlementsBefore}→${list.length}; ${st?.settlementNumber} gross=${st?.grossAmount} received=${st?.receivedAmount} fee=${st?.feeAmount} fx=${st?.fxDifference}; ${jeLine(ev)}; preview amounts == posted: ${previewHas}; links settlement→${linkedPays.length} payments→orders ${keys.map((k) => ctx.orders[k].number).join(",")}${problems.length ? `; PROBLEMS: ${problems.join("; ")}` : ""}`,
      url: `${BASE}${wsPath()}`,
      shot: r.previewShot ?? (await shot(page, "c4-settled")),
      evidence: { settlement: st?.settlementNumber, je: ev?.number, byRole: chk.byRole },
    };
  });
  await step("C5", fin, "settle: double-click Confirm created exactly one settlement / one JE; claims not re-settlable", async (page) => {
    const mine = (await settlementsOf(ctx.methods.tamara.id)).filter((s) => s.providerReference === `${RUN}-PAYOUT-1`);
    const jes = mine[0] ? await jesBySource("PAYMENT_SETTLEMENT", mine[0].id) : [];
    await go(page, wsPath());
    await openTab(page, /^بانتظار التسوية/);
    const text = await mainText(page);
    const stillListed = keys.filter((k) => text.includes(ctx.orders[k].number));
    return { status: mine.length === 1 && jes.length === 1 && !stillListed.length ? "PASS" : "FAIL", detail: `settlements=${mine.length}; JEs=${jes.length}; B-claims still awaiting settlement=${stillListed.join(",") || "none"}`, url: `${BASE}${wsPath()}`, shot: await shot(page, "c5-settlement-once") };
  });
  await step("C4", fin, "Settlements tab: settlement detail links settlement → payments → orders → JE", async (page) => {
    if (!ctx.settlement1) blocked("no settlement");
    await go(page, wsPath());
    await openTab(page, /^التسويات/);
    const row = page.locator("main table tbody tr").filter({ hasText: ctx.settlement1.number }).first();
    if (!(await row.isVisible().catch(() => false))) return { status: "FAIL", detail: `${ctx.settlement1.number} not listed`, shot: await shot(page, "c4-settlements-list") };
    await row.getByRole("button", { name: /^إجراءات$/ }).or(row.locator("button").last()).first().click();
    await page.waitForTimeout(400);
    await page.getByRole("menuitem", { name: /^عرض$/ }).first().click();
    await page.waitForTimeout(2000);
    await settle(page);
    const sheet = page.locator('[role="dialog"]:visible').last();
    const text = (await sheet.innerText().catch(() => "")).replace(/\s+/g, " ");
    const hasJE = text.includes(report.journal.find((j) => j.id === ctx.settlement1.jeId)?.number ?? "@@");
    const orderLinks = ["B01", "B05", "B10"].filter((k) => text.includes(ctx.orders[k].number));
    return { status: hasJE && orderLinks.length === 3 ? "PASS" : "FAIL", detail: `detail shows JE=${hasJE}; order numbers visible=${orderLinks.join(",")}`, url: `${BASE}${wsPath()}`, shot: await shot(page, "c4-settlement-detail") };
  });
  await balanceStep("after-C4");
}
async function c6() {
  const fin = await session("qa-finance");
  const keys = ["X1", "X2"];
  ctx.receivingAccountGl = ctx.accounts?.bank?.id;
  await step("C6", fin, `cross-currency settle X1+X2 (400 ${xc()}, carrying @${rY()}) → received in ${ctx.func?.code} bank; fee 20 ${xc()} entered explicitly; settlement-date rate ${rT()}`, async (page) => {
    if (!ctx.xccy || !ctx.orders.X1 || !ctx.orders.X2) blocked(ctx.xBlocked ?? "X1/X2 orders missing");
    const existing = (await settlementsOf(ctx.methods.tamara.id)).find((s) => s.providerReference === `${RUN}-PAYOUT-X`);
    const gross = 400;
    const fee = 20;
    const rsPre = num((await resolveRate(ctx.xccy.id, TODAY))?.rate) || rT();
    const received = r2((gross - fee) * rsPre - 5); // provider paid slightly less → FX difference recognised separately
    let r = { text: "(already settled)", previewText: "" };
    if (!existing) r = await settleUI(page, keys, { receivedAmount: received, receivedCurrency: ctx.func.code, fee, reference: `${RUN}-PAYOUT-X`, mode: "drop", filter: "عميل X" });
    if (!existing && !r.ok) return { status: "FAIL", detail: `${r.text}; preview: ${r.previewText?.slice(0, 500)}`, shot: r.previewShot };
    const mine = (await settlementsOf(ctx.methods.tamara.id)).filter((s) => s.providerReference === `${RUN}-PAYOUT-X`);
    const st = mine[0] ? (await A("GET", `/payment-settlements/${mine[0].id}`)).json : null;
    const jeId = st?.journalEntry?.id ?? st?.journalEntryId;
    const je = jeId ? await getJE(jeId) : null;
    const ev = jeEvidence(`settlement ${st?.settlementNumber} (C6 cross-currency)`, je);
    // Carrying value = the frozen functional amounts of the posted receipt JEs.
    let carrying = 0;
    for (const k of keys) carrying += num(report.journal.find((j) => j.label.startsWith(`receipt ${k} `))?.totalDebit) || r2(num(ctx.orders[k].total) * rY());
    carrying = r2(carrying);
    // Settlement-date rate as the FX service resolves it (R2 unless an override already covers today on a re-run).
    const rs = num((await resolveRate(ctx.xccy.id, TODAY))?.rate) || rT();
    const commission = r2(fee * rs);
    const fxDiff = r2(received + commission - carrying);
    const chk = settlementLinesCheck(ev, { BANK: ["debit", received], COMMISSION: ["debit", commission], CLEARING: ["credit", carrying], FX_DIFFERENCE: [fxDiff >= 0 ? "credit" : "debit", Math.abs(fxDiff)] });
    const problems = [...chk.problems];
    if (mine.length !== 1) problems.push(`settlements with this reference=${mine.length} (retry duplicated?)`);
    if (st && !near(st.feeAmount, fee)) problems.push(`feeAmount=${st.feeAmount} (want ${fee} ${xc()}, never gross−received across currencies)`);
    ctx.settlementX = st ? { id: st.id, number: st.settlementNumber, jeId } : null;
    saveCtx();
    if (st) created("PaymentSettlement (C6 cross-currency)", st.settlementNumber, `${BASE}${wsPath()}`, { id: st.id, je: ev?.number });
    return {
      status: problems.length ? "FAIL" : "PASS",
      detail: `retry: first response dropped (server ${r.dropInfo?.serverStatus ?? "-"}), resubmitted → "${r.text}"; ${st?.settlementNumber} currency=${st?.currency?.code} received=${st?.receivedAmount} ${st?.receivedCurrency?.code} fee=${st?.feeAmount} fxDifference=${st?.fxDifference}; expected carrying=${carrying} commission=${commission} FX=${fxDiff}; ${jeLine(ev)}${problems.length ? `; PROBLEMS: ${problems.join("; ")}` : ""}`,
      url: `${BASE}${wsPath()}`,
      shot: r.previewShot ?? (await shot(page, "c6-settled")),
      evidence: { settlement: st?.settlementNumber, je: ev?.number, byRole: chk.byRole },
    };
  });
  await balanceStep("after-C6");
  await step("C8", fin, "GL: account statement of the tagged Tamara clearing account shows receipt + settlement movements", async (page) => {
    const acct = ctx.accounts.tamara;
    const r = await A("GET", `/accounting/reports/account-statement?accountId=${acct.id}&dateFrom=${iso(addDays(TODAY, -30))}&dateTo=${iso(TODAY)}`);
    const rows = r.json?.lines ?? r.json?.movements ?? r.json?.items ?? r.json?.rows ?? [];
    const count = Array.isArray(rows) ? rows.length : 0;
    await go(page, "/reports/finance?report=accountStatement");
    const acctTrigger = page.locator("main").getByRole("combobox").filter({ hasText: /اختر حساب/ }).first();
    let ui = "account picker not found";
    if (await acctTrigger.isVisible().catch(() => false)) {
      await pick(page, acctTrigger, { search: acct.name, option: new RegExp(`^${escRe(acct.name).source}`) }).catch((e) => {
        ui = `pick failed: ${e.message}`;
      });
      await page.waitForTimeout(2000);
      await settle(page);
      const text = await mainText(page);
      const jeNums = report.journal.filter((j) => j.lines.some((l) => l.accountId === acct.id)).map((j) => j.number);
      ui = `UI rows show JEs ${jeNums.filter((n) => text.includes(n)).length}/${jeNums.length} known clearing JEs (settlement ${ctx.settlement1?.number ?? "-"})`;
    }
    return { status: r.ok && count >= 3 ? "PASS" : "FAIL", detail: `API account statement ${acct.code}: status ${r.status}, movements=${count}; closing=${r.json?.closingBalance ?? r.json?.closing ?? "-"}; ${ui}`, url: `${BASE}/reports/finance?report=accountStatement`, shot: await shot(page, "c8-account-statement") };
  });
}

// ------------------------------------------------------------------ C7 FX
async function rangeSelect(page, dlg, from, to) {
  const trigger = dlg.getByRole("button", { name: /اختر الفترة|اختر نطاق|الفترة|\d{2} \w{3} \d{4}/ }).first();
  const trig = (await trigger.isVisible().catch(() => false)) ? trigger : dlg.locator("xpath=.//label[normalize-space(.)='الفترة']/following::button[1]").first();
  await trig.click();
  await page.waitForTimeout(500);
  const pop = page.locator("[data-radix-popper-content-wrapper]").last();
  const clickDay = async (d) => {
    // Navigate month by month (previous/next) until the day cell is visible — works for the 2019 window.
    for (let i = 0; i < 130; i += 1) {
      const cell = pop.locator(`[data-day="${iso(d)}"] button, button[data-day="${iso(d)}"]`).first();
      if (await cell.isVisible().catch(() => false)) {
        await cell.click();
        return;
      }
      const days = await pop.locator("[data-day]").evaluateAll((els) => els.map((e) => e.getAttribute("data-day")).filter(Boolean));
      const shownMid = days[Math.floor(days.length / 2)] ?? iso(TODAY);
      const goBack = iso(d) < shownMid;
      const nav = pop.getByRole("button", { name: goBack ? /previous|السابق/i : /next|التالي/i }).first();
      if (!(await nav.isVisible().catch(() => false))) notTested(`calendar ${goBack ? "previous" : "next"}-month button not found while looking for ${iso(d)}`);
      await nav.click();
      await page.waitForTimeout(120);
    }
    notTested(`day ${iso(d)} not reachable in calendar`);
  };
  await clickDay(from);
  await page.waitForTimeout(200);
  await clickDay(to);
  await page.waitForTimeout(200);
  await btn(pop, /^تطبيق$|^Apply$/).click();
  await page.waitForTimeout(300);
}
async function lookupRate(page, d) {
  await go(page, "/finance/exchange-rates");
  const card = page.locator('[data-testid="fx-rate-lookup"]');
  await pick(page, card.locator('[id="fx-lookup-currency"]'), { search: xc(), option: escRe(xc()) });
  await typeDate(card.locator('[id="fx-lookup-date"]'), d);
  await btn(card, /^استعلام$/).click();
  await page.waitForTimeout(1500);
  const res = card.locator('[data-testid="fx-lookup-result"]');
  const text = (await res.innerText().catch(async () => card.innerText())).replace(/\s+/g, " ");
  const api = (await A("GET", `/exchange-rates/resolve?currencyId=${ctx.xccy.id}&asOf=${iso(d)}`)).json;
  return { text, api };
}
/** Every posted JE whose frozen rate must never change (C3/C4/C6 receipts and settlements). */
async function watchedJEs() {
  const ids = {};
  for (const [k, v] of Object.entries(ctx.xReceipts ?? {})) ids[`receipt ${k}`] = v.jeId;
  if (ctx.settlementX?.jeId) ids["settlement C6"] = ctx.settlementX.jeId;
  if (ctx.settlement1?.jeId) ids["settlement C4"] = ctx.settlement1.jeId;
  for (const k of ["B01", "BK"]) {
    if (!ctx.orders[k]) continue;
    const p = claimsOf(await getOrder(ctx.orders[k].id)).find((x) => x.status === "VERIFIED");
    const { je } = p ? await paymentReceiptJE(p.id) : {};
    if (je) ids[`receipt ${k}`] = je.id;
  }
  const snap = {};
  for (const [k, id] of Object.entries(ids)) {
    const je = await getJE(id);
    if (je) snap[k] = { number: je.entryNumber, rate: je.exchangeRate, date: String(je.entryDate).slice(0, 10), lines: (je.lines ?? []).map((l) => `${l.debit}/${l.credit}`).join(",") };
  }
  return snap;
}
function compareSnap(label, before, now) {
  const diffs = [];
  for (const [k, v] of Object.entries(before)) {
    const n = now[k];
    if (!n || n.rate !== v.rate || n.lines !== v.lines) diffs.push(`${k}: ${JSON.stringify(v)} → ${JSON.stringify(n ?? null)}`);
  }
  const list = Object.entries(before).map(([k, v]) => `${k} ${v.number} rate ${v.rate}`).join("; ");
  return { status: Object.keys(before).length ? (diffs.length ? "FAIL" : "PASS") : "BLOCKED", detail: diffs.length ? `${label}: ${diffs.join("; ")}` : `${label}: identical — ${list || "no posted JEs"}` };
}
const OV_REASON = "DEMO-PDR acceptance cleanup";
async function overridesOf(currencyId, includeDeleted = false) {
  return items((await A("GET", `/exchange-rates/overrides?fromCurrencyId=${currencyId}${includeDeleted ? "&includeDeleted=true" : ""}`)).json);
}
async function c7() {
  const fin = await session("qa-finance");
  // 2019 window ONLY — never an override covering any date after 2019.
  const O1 = [new Date(2019, 0, 1), new Date(2019, 0, 20)];
  const O2 = [new Date(2019, 0, 19), new Date(2019, 0, 30)];
  const INSIDE = new Date(2019, 0, 10);
  const OUTSIDE = new Date(2019, 1, 5);
  for (const d of [...O1, ...O2]) if (d.getFullYear() > 2019) throw new Error("override window must stay in 2019");
  await step("C7", fin, "FX settings: CBE auto-import status card", async (page) => {
    await go(page, "/finance/exchange-rates");
    const text = (await mainText(page)).replace(/\s+/g, " ");
    const card = /الاستيراد اليومي التلقائي/.test(text);
    const st = (await A("GET", "/exchange-rates/sync/status")).json ?? {};
    return { status: card ? "PASS" : "FAIL", detail: `card=${card}; enabled=${st.settings?.enabled}; provider=${st.provider}; last run=${st.lastRun?.status} ${st.lastRun?.error ?? JSON.stringify(st.lastRun?.details?.reason ?? "")}; newest official=${st.newestEffectiveDate} (${st.newestAgeDays} d); next=${(st.nextRuns ?? []).join(",")}`, url: `${BASE}/finance/exchange-rates`, shot: await shot(page, "c7-fx-auto-import") };
  });
  // Frozen-rate check around a second "Run now" (the first real import ran before C6).
  const snap0 = await watchedJEs();
  ctx.jeRateSnapshot = snap0;
  saveCtx();
  note("C7", "posted JE rate snapshot (before the second CBE run)", Object.keys(snap0).length ? "PASS" : "BLOCKED", JSON.stringify(snap0).slice(0, 1400));
  await cbeRunNow(fin, `CBE "تشغيل الآن" again after postings (frozen-rate check; functional=${ctx.func?.code})`);
  {
    const r = compareSnap("after CBE run", snap0, await watchedJEs());
    note("C7", "posted JE rates unchanged after the CBE run", r.status, r.detail);
  }
  // Override pair: the C6 currency, else the first existing candidate currency.
  let oc = ctx.xccy;
  if (!oc) {
    for (const code of (process.env.FX_CCY ? process.env.FX_CCY.split(",") : ["USD", "SAR", "EUR"]).map((x) => x.trim().toUpperCase()).filter((x) => x && x !== ctx.func?.code)) {
      const c = await currencyByCode(code);
      if (c) {
        oc = { id: c.id, code: c.code };
        break;
      }
    }
  }
  if (!oc) return note("C7", "override tests", "BLOCKED", "no foreign currency available for the override pair");
  ctx.c7ccy = oc;
  saveCtx();
  const pickOc = (page, loc) => pick(page, loc, { search: oc.code, option: escRe(oc.code) });
  const ovFind = async () => (await overridesOf(oc.id)).find((o) => String(o.dateFrom).slice(0, 10) === iso(O1[0]) && String(o.dateTo).slice(0, 10) === iso(O1[1]) && !o.deletedAt);
  await step("C7", fin, `manual override ${oc.code}→${ctx.func?.code} ${iso(O1[0])}…${iso(O1[1])} = 9.5 (2019 window only)`, async (page) => {
    const existing = await ovFind();
    if (existing) {
      ctx.c7Override = { id: existing.id };
      saveCtx();
      return { detail: `already present (${existing.rate}, id ${existing.id})` };
    }
    await go(page, "/finance/exchange-rates");
    await clickFirst(page, [btn(page, /^إضافة سعر مخصص$/)], "إضافة سعر مخصص");
    const dlg = dialog(page);
    await dlg.waitFor({ state: "visible" });
    await pickOc(page, dlg.locator('[id="fx-override-currency"]'));
    await rangeSelect(page, dlg, O1[0], O1[1]);
    await dlg.locator('[id="fx-override-rate"]').fill("9.5");
    await dlg.locator('[id="fx-override-reason"]').fill(`${RUN} QA override test (2019 window only)`);
    await shot(page, "c7-override-1-filled");
    await btn(dlg, /^حفظ$/).click();
    const t = await expectToast(page, /تم حفظ السعر المخصص/);
    const ov = await ovFind();
    if (ov) {
      ctx.c7Override = { id: ov.id };
      saveCtx();
      created("ExchangeRateOverride (deleted at end of C7)", `${oc.code} ${iso(O1[0])}…${iso(O1[1])} @9.5`, `${BASE}/finance/exchange-rates`, { id: ov.id });
    }
    const inWindow = ov && String(ov.dateTo).slice(0, 4) === "2019";
    return { status: t.ok && ov && inWindow ? "PASS" : "FAIL", detail: `${t.text}; stored ${String(ov?.dateFrom ?? "").slice(0, 10)}…${String(ov?.dateTo ?? "").slice(0, 10)} rate=${ov?.rate}`, url: `${BASE}/finance/exchange-rates`, shot: await shot(page, "c7-override-1-saved") };
  });
  await step("C7", fin, `rate lookup inside (${iso(INSIDE)}) vs outside (${iso(OUTSIDE)}) the override range`, async (page) => {
    if (!ctx.c7Override) blocked("override not created");
    const saved = ctx.xccy;
    ctx.xccy = oc; // lookupRate uses the current pair
    let inside;
    let outside;
    try {
      inside = await lookupRate(page, INSIDE);
      outside = await lookupRate(page, OUTSIDE);
    } finally {
      ctx.xccy = saved;
    }
    const sh = await shot(page, "c7-lookup-outside");
    const inApi = await resolveRate(oc.id, INSIDE);
    const outApi = (await A("GET", `/exchange-rates/resolve?currencyId=${oc.id}&asOf=${iso(OUTSIDE)}`)).json;
    const inOk = /9\.5/.test(inside.text) && /مخصص/.test(inside.text) && near(inApi?.rate, 9.5, 1e-6);
    const outOk = !/يُطبق سعر يدوي مخصص/.test(outside.text) && !outApi?.overrideId;
    return { status: inOk && outOk ? "PASS" : "FAIL", detail: `inside: "${inside.text.slice(0, 160)}" (api rate=${inApi?.rate} source=${inApi?.source}); outside: "${outside.text.slice(0, 160)}" (api ${outApi?.rate ?? outApi?.code ?? JSON.stringify(outApi).slice(0, 80)} source=${outApi?.source ?? "-"})`, url: `${BASE}/finance/exchange-rates`, shot: sh };
  });
  await step("C7", fin, `overlapping override ${iso(O2[0])}…${iso(O2[1])} rejected with the conflict message`, async (page) => {
    if (!ctx.c7Override) blocked("override not created");
    const before = (await overridesOf(oc.id)).length;
    await go(page, "/finance/exchange-rates");
    await clickFirst(page, [btn(page, /^إضافة سعر مخصص$/)], "إضافة سعر مخصص");
    const dlg = dialog(page);
    await dlg.waitFor({ state: "visible" });
    await pickOc(page, dlg.locator('[id="fx-override-currency"]'));
    await rangeSelect(page, dlg, O2[0], O2[1]);
    await dlg.locator('[id="fx-override-rate"]').fill("9.7");
    await dlg.locator('[id="fx-override-reason"]').fill(`${RUN} QA overlap test (must be rejected)`);
    await btn(dlg, /^حفظ$/).click();
    await page.waitForTimeout(2500);
    const conflict = page.locator('[data-testid="fx-override-conflict"]');
    const shown = await conflict.isVisible().catch(() => false);
    const ctext = shown ? (await conflict.innerText()).replace(/\s+/g, " ") : "";
    const t = await toasts(page);
    const sh = await shot(page, "c7-override-overlap-rejected");
    await page.keyboard.press("Escape").catch(() => {});
    const afterList = await overridesOf(oc.id);
    const leaked = afterList.find((o) => String(o.dateFrom).slice(0, 10) === iso(O2[0]) && !o.deletedAt);
    return { status: (shown || t.some((x) => x.type === "error")) && afterList.length === before && !leaked ? "PASS" : "FAIL", detail: `conflict alert=${shown} "${ctext.slice(0, 200)}"; toasts=${t.map((x) => x.text).join(" | ")}; overrides ${before}→${afterList.length}`, url: `${BASE}/finance/exchange-rates`, shot: sh };
  });
  {
    const r = compareSnap("after override create", snap0, await watchedJEs());
    note("C7", "posted JE rates unchanged after the 2019 override was created", r.status, r.detail);
  }
  await step("C7", fin, `soft-delete the 2019 override (reason "${OV_REASON}") and assert deletion`, async (page) => {
    if (!ctx.c7Override) blocked("override not created");
    const live = await ovFind();
    if (live) {
      await go(page, "/finance/exchange-rates");
      const card = page.locator('[data-testid="fx-overrides"]');
      const row = card.locator("tr, li, [role='row']").filter({ hasText: RUN }).filter({ hasText: /2019/ }).first();
      if (!(await row.isVisible().catch(() => false))) notTested("override row not listed in the overrides card");
      await row.getByRole("button", { name: /^حذف$/ }).click();
      const dlg = page.getByRole("alertdialog").or(page.getByRole("dialog")).last();
      await dlg.waitFor({ state: "visible" });
      await dlg.locator('[id="fx-override-delete-reason"]').fill(OV_REASON);
      await shot(page, "c7-override-delete-dialog");
      await dlg.getByRole("button", { name: /^حذف$/ }).last().click();
      const t = await expectToast(page, /تم حذف السعر المخصص/);
      if (!t.ok) return { status: "FAIL", detail: `delete toast: ${t.text}`, shot: await shot(page, "c7-override-delete-fail") };
    }
    const all = await overridesOf(oc.id, true);
    const row = all.find((o) => o.id === ctx.c7Override.id);
    const stillActive = await ovFind();
    const api = (await A("GET", `/exchange-rates/resolve?currencyId=${oc.id}&asOf=${iso(INSIDE)}`)).json;
    const ok = !stillActive && (!row || row.deletedAt) && !api?.overrideId;
    return { status: ok ? "PASS" : "FAIL", detail: `override ${ctx.c7Override.id}: deletedAt=${row?.deletedAt ?? "(not returned)"} reason=${row?.deleteReason ?? row?.deletedReason ?? "-"}; active copies=${stillActive ? 1 : 0}; resolve ${iso(INSIDE)} after delete → ${api?.rate ?? api?.code ?? "-"} source=${api?.source ?? "-"}`, url: `${BASE}/finance/exchange-rates`, shot: await shot(page, "c7-override-deleted") };
  });
  {
    const r = compareSnap("after override delete", snap0, await watchedJEs());
    note("C7", "posted JE rates unchanged after the 2019 override was deleted", r.status, r.detail);
  }
}

// ------------------------------------------------------------------ final: S5 + summary counts
async function final() {
  const adm = await session("qa-admin");
  await step("S5", adm, "historical VERIFIED payments untouched (after)", async () => {
    const h = ctx.historical;
    if (!h) blocked("no before-snapshot");
    const r = await A("GET", "/payments?status=VERIFIED&pageSize=1");
    const totalNow = r.json?.total ?? r.json?.meta?.total ?? null;
    const changed = [];
    for (const p of h.sample) {
      const now = (await A("GET", `/payments/${p.id}`)).json;
      if (!now || now.status !== p.status || now.amount !== p.amount || now.updatedAt !== p.updatedAt) changed.push(`${p.paymentNumber}: ${p.status}/${p.updatedAt} → ${now?.status}/${now?.updatedAt}`);
      if (p.jes) {
        const t = await trace("PAYMENT", p.id);
        const jes = traceGroup(t, "JOURNAL_ENTRIES").map((j) => j.id);
        if (jes.length !== p.jes.length) changed.push(`${p.paymentNumber}: JEs ${p.jes.length} → ${jes.length}`);
      }
    }
    let ours = 0;
    for (const o of Object.values(ctx.orders)) ours += claimsOf(await getOrder(o.id)).filter((p) => p.status === "VERIFIED").length;
    const expectTotal = h.total != null ? `before ${h.total} + this run's verified ${ours} = ${h.total + ours}` : "n/a";
    return { status: changed.length ? "FAIL" : "PASS", detail: `sampled ${h.sample.length} historical payments unchanged=${!changed.length}${changed.length ? ` (${changed.join("; ")})` : ""}; VERIFIED total now=${totalNow} (${expectTotal}; other users may post concurrently)` };
  });
  await step("C1", adm, "no JE was created by any Sales declaration (U1, P1 before posting)", async () => {
    const jU = await orderJEs(ctx.orders.U1.id);
    const jP = await orderJEs(ctx.orders.P1.id);
    return { status: !jU.length && !jP.length ? "PASS" : "FAIL", detail: `U1 JEs=${jU.length}; P1 (partial claim still unposted) JEs=${jP.length}` };
  });
}

// ------------------------------------------------------------------ report
function rollup() {
  for (const [id, title] of Object.entries(CRITERIA)) {
    const rows = report.steps.filter((s) => s.crit === id);
    let status = rows.length ? "PASS" : "NOT RUN";
    if (rows.some((r) => r.status === "BLOCKED" || r.status === "NOT TESTED")) status = "BLOCKED";
    if (rows.some((r) => r.status === "FAIL")) status = "FAIL";
    const blockedOnly = rows.length && rows.every((r) => r.status === "BLOCKED");
    report.criteria[id] = { title, status: blockedOnly ? "BLOCKED" : status, pass: rows.filter((r) => r.status === "PASS").length, fail: rows.filter((r) => r.status === "FAIL").length, blocked: rows.filter((r) => r.status === "BLOCKED" || r.status === "NOT TESTED").length, steps: rows.map((r) => r.id) };
  }
  report.defects = report.steps.filter((s) => s.status === "FAIL").map((s) => ({ id: s.id, crit: s.crit, persona: s.persona, step: s.name, observed: s.detail, url: s.url, screenshot: s.screenshot, failedApi: s.failedApi }));
}
function writeReport() {
  // Partial re-runs (ONLY=...) merge with the previous report of this RUN: steps of phases
  // not executed now are kept, so summary.md always covers the whole RUN.
  const prevPath = resolve(OUT, "payment-recon-report.json");
  if (ONLY && existsSync(prevPath)) {
    try {
      const prev = JSON.parse(readFileSync(prevPath, "utf8"));
      const ran = new Set(report.steps.map((x) => x.phase));
      const kept = (prev.steps ?? []).filter((x) => x.phase && !ran.has(x.phase));
      const order = PHASES.map(([id]) => id);
      report.steps = [...kept, ...report.steps].sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase));
      report.steps.forEach((x, i) => (x.id = `P${String(i + 1).padStart(3, "0")}`));
      const jeKeys = new Set(report.journal.map((j) => j.id + j.label));
      report.journal = [...(prev.journal ?? []).filter((j) => !jeKeys.has(j.id + j.label)), ...report.journal];
      for (const c of prev.created ?? []) if (!report.created.some((x) => x.type === c.type && x.number === c.number)) report.created.push(c);
      report.mergedRuns = [...(prev.mergedRuns ?? [{ at: prev.startedAt, phases: "all" }]), { at: report.startedAt, phases: ONLY.join(",") }];
    } catch {
      /* first run */
    }
  }
  rollup();
  report.finishedAt = new Date().toISOString();
  report.crashes = crashes;
  const counts = {};
  for (const s of report.steps) counts[s.status] = (counts[s.status] ?? 0) + 1;
  report.summary = counts;
  writeFileSync(resolve(OUT, "payment-recon-report.json"), JSON.stringify(report, null, 2));
  const esc = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const shotLink = (p) => (p ? ` ([shot](${p.replace(`tmp/acceptance/${RUN}/`, "")}))` : "");
  const L = [
    `# Payment declaration & reconciliation acceptance — ${RUN}`,
    "",
    `Base: ${BASE} · API: ${API} · functional currency ${report.environment.functionalCurrency ?? "?"} · C6/C7 currency ${ctx.xccy?.code ?? "none"}${FX_TAGGED ? " (local tagged)" : ""}`,
    `Started ${report.startedAt} · finished ${report.finishedAt} · deployment SHA ${report.deployShaAtStart ?? "?"} → ${report.deployShaAtEnd ?? "?"}`,
    "",
    `Step counts: ${Object.entries(counts).map(([k, v]) => `**${k}** ${v}`).join(" · ")}`,
    "",
    "## Criteria",
    "",
    "| ID | Criterion | Status | Pass/Fail/Blocked | Steps |",
    "|---|---|---|---|---|",
  ];
  for (const [id, c] of Object.entries(report.criteria)) L.push(`| ${id} | ${esc(c.title)} | **${c.status}** | ${c.pass}/${c.fail}/${c.blocked} | ${c.steps.join(", ")} |`);
  L.push("", "## Steps", "", "| ID | Crit | Persona | Step | Status | Evidence | Record |", "|---|---|---|---|---|---|---|");
  for (const s of report.steps) L.push(`| ${s.id} | ${s.crit} | ${s.persona} | ${esc(s.name)} | ${s.status}${s.attempts > 1 ? ` (x${s.attempts})` : ""} | ${esc(s.detail).slice(0, 420)}${shotLink(s.screenshot)} | ${s.url ? `[link](${s.url})` : ""} |`);
  L.push("", "## Journal entry evidence", "");
  for (const j of report.journal) {
    L.push(`- **${esc(j.label)}** — [${j.number}](${j.url}) ${j.date} rate ${j.exchangeRate} ${j.status} balanced=${j.balanced} (Dr ${j.totalDebit} / Cr ${j.totalCredit})`);
    for (const l of j.lines) L.push(`  - ${l.debit ? `Dr ${l.debit}` : `Cr ${l.credit}`} — ${esc(l.account)}${l.description ? ` · ${esc(l.description)}` : ""}`);
  }
  L.push("", "## Created demo records", "", "| Type | Number | Link |", "|---|---|---|");
  for (const c of report.created) L.push(`| ${esc(c.type)} | ${esc(c.number)} | ${c.url ?? ""} |`);
  L.push("", "## Defects (FAIL steps)", "");
  if (!report.defects.length) L.push("None observed in this run.");
  for (const d of report.defects) {
    L.push(`### ${d.id} — ${d.crit} › ${esc(d.step)} (${d.persona})`, "", `- Observed: ${esc(d.observed)}`);
    if (d.failedApi?.length) L.push(`- Failed API: ${d.failedApi.map((a) => `${a.method} ${a.url} → ${a.status} ${esc(a.body).slice(0, 180)}`).join("; ")}`);
    if (d.url) L.push(`- Record: ${d.url}`);
    if (d.screenshot) L.push(`- Screenshot: ${d.screenshot}`);
    L.push("");
  }
  if (crashes.length) L.push("", "## UI crashes", "", ...crashes.map((c) => `- ${c.at} ${c.url}`));
  writeFileSync(resolve(OUT, "summary.md"), L.join("\n"));
  console.log(`\nSteps ${JSON.stringify(counts)}`);
  for (const [id, c] of Object.entries(report.criteria)) console.log(`${id.padEnd(3)} ${c.status.padEnd(8)} ${c.title}`);
  console.log(`Report: ${resolve(OUT, "payment-recon-report.json")}\nSummary: ${resolve(OUT, "summary.md")}`);
}
function deployedSha() {
  if (!/oms\.haseb\.org/.test(BASE)) return "local";
  try {
    return execSync(`gh api "repos/{owner}/{repo}/deployments?environment=Production&per_page=1" --jq ".[0].sha"`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 }).trim();
  } catch {
    return "unknown";
  }
}

const PHASES = [
  ["preflight", preflight],
  ["setup", setup],
  ["fxrun", fxrun],
  ["fxccy", fxccy],
  ["c1", c1],
  ["orders", orders],
  ["c2", c2],
  ["c3", c3],
  ["s2", s2s3],
  ["s1", s1s4],
  ["c4", c4],
  ["c6", c6],
  ["c7", c7],
  ["final", final],
];

async function main() {
  report.deployShaAtStart = deployedSha();
  console.log(`RUN ${RUN} · BASE ${BASE} · API ${API} · OUT ${OUT}`);
  browser = await chromium.launch({ headless: !process.env.HEADED });
  try {
    adminApi = (await session("qa-admin")).api;
    // Always resolve environment basics (cheap) even when preflight is skipped.
    if (!want("preflight")) {
      const ps = (await A("GET", "/accounting/posting-settings")).json ?? {};
      const cur = items((await A("GET", "/currencies?pageSize=500")).json).find((c) => c.id === ps.functionalCurrencyId);
      ctx.func = cur ? { id: cur.id, code: cur.code } : ctx.func;
      report.environment.functionalCurrency = ctx.func?.code;
      report.environment.commissionAccountConfigured = !!ps.paymentGatewayFeeAccountId;
      ctx.commissionAccountId = ps.paymentGatewayFeeAccountId ?? null;
      ctx.fxDiffAccountId = ps.exchangeDifferenceAccountId ?? null;
    }
    for (const [id, fn] of PHASES) {
      if (!want(id)) continue;
      currentPhase = id;
      console.log(`\n=== ${id} ===`);
      try {
        await fn();
      } catch (e) {
        record({ crit: "S0", persona: "-", name: `phase ${id} crashed`, status: "FAIL", detail: String(e?.message ?? e).split("\n")[0], attempts: 1 });
      }
      saveCtx();
    }
  } finally {
    for (const s of sessions.values()) await s.context.storageState({ path: resolve(STATE, `${s.persona}.json`) }).catch(() => {});
    await browser.close().catch(() => {});
    report.deployShaAtEnd = deployedSha();
    writeReport();
  }
}

void errText;
void randomUUID;
main();
