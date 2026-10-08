#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R15 — the browser acceptance pass (J1, J4, J6, J7 UI rows, J11, J12) against a LOCAL integrated build.
 *
 *   1  Company admin   /agents (cross-agent overview below the list), /agents/<id> Overview (money only with
 *                      agents.finance.view), Settings → shipping agreement, Orders → "New agent order" dialog
 *   2  Agent portal    agent admin /agent/dashboard (team breakdown); agent sales /agent/dashboard (own figures,
 *                      no colleague), /agent/orders/new (shared stepped flow), /agent/imports (wizard)
 *   3  Company sales   /store-orders New order dialog + stock chip/filter, /crm/leads Import menu (hidden for
 *                      r15-sales2), /store-orders/import, /dashboard own rank, /reports/sales own tabs
 *   4  Order detail    in-transit order as r15-shipping (stock panel, Record delivery + Receive returned goods
 *                      dialogs opened and cancelled), delivered COD order as r15-finance (Collection panel,
 *                      Return dialog opened and cancelled)
 *   5  Partner login   lands on /partner, /partner/overview, /partner/statement, /store-orders → /partner
 *   6  Partners        Home «الشركاء» tile + sidebar section, /modules/company-partners, /company-partners(/<id>)
 *   7  Inventory       /inventory/stock In transit / Damaged columns, /master-data/warehouses role badges
 *
 * Variants: Arabic RTL desktop 1440×900 (every page), Arabic mobile 390×844 (every page), English desktop
 * (subset), Arabic dark desktop (subset). Per page: no error boundary / not-found / "Access denied", no console
 * errors, no horizontal page overflow, html dir, dark class (dark variant), the page's key elements; one
 * screenshot per page/variant.
 *
 *   node scripts/acceptance/r15/seed-personas.mjs           # once (idempotent)
 *   BASE=http://localhost:4501 API=http://localhost:4505 node scripts/acceptance/r15/r15-browser.mjs
 *   ONLY=sales,partner …   runs only the sessions whose key starts with one of these
 *
 * Personas r15-*@oms.local (oms_r15_e2e); password read at runtime from tmp/r15/.r15.env (R15_PW), never
 * printed or written. The partner login r15-partner-browser@oms.local is created / re-enabled through the API
 * (as r15-finance, like journey J6) on an existing partner with an active agreement. Every dialog is opened
 * and cancelled; the one other write is the app's own: opening an import wizard ("Upload Excel/CSV") creates
 * a DRAFT import job (no rows) for r15-agent-sales (LEADS) and r15-sales (STORE_ORDERS) per desktop/mobile run.
 * Evidence: specs/round15-completion/evidence/browser/*.png + results.json (no tokens, no passwords).
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const ROOT = "D:/Systems/OMS";
const BASE = (process.env.BASE ?? "http://localhost:4501").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:4505").replace(/\/$/, "");
for (const url of [BASE, API])
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url))
    throw new Error("local servers only");
const DB = process.env.DB ?? "oms_r15_e2e";
if (!/^oms_r15_/.test(DB)) throw new Error("R15 verification databases only");
const OUT = `${ROOT}/specs/round15-completion/evidence/browser`;
mkdirSync(OUT, { recursive: true });
const ONLY_RAW = process.env.ONLY;
// A full run replaces the evidence; a partial run (ONLY) adds to it.
if (!ONLY_RAW) for (const f of readdirSync(OUT)) if (f.endsWith(".png")) rmSync(`${OUT}/${f}`);
const PW = readFileSync(`${ROOT}/tmp/r15/.r15.env`, "utf8")
  .match(/R15_PW=(.*)/)?.[1]
  ?.trim();
if (!PW) throw new Error("R15_PW missing in tmp/r15/.r15.env (run seed-personas.mjs)");
const ONLY = process.env.ONLY ? process.env.ONLY.split(",").map((s) => s.trim()) : null;
const PARTNER_EMAIL = "r15-partner-browser@oms.local";

// ───────── SQL (read-only) ─────────
const psql = (sql) =>
  execFileSync(
    "docker",
    ["exec", "oms-postgres", "psql", "-U", "oms", "-d", DB, "-At", "-c", sql],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  ).trim();
const rows = (sql) =>
  JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`) || "[]");
const one = (sql) => rows(sql)[0] ?? null;
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

// ───────── API (setup + order picking; tokens never leave this process) ─────────
async function apiCall(token, method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
      "User-Agent": "r15-browser",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    j = text;
  }
  return { s: r.status, j };
}
async function apiLogin(email, password = PW) {
  const r = await apiCall(null, "POST", "/auth/login", { email, password });
  return r.j?.accessToken ? { token: r.j.accessToken, mustChange: !!r.j.mustChangePassword } : null;
}
async function adopt(email, temporaryPassword) {
  const t = await apiLogin(email, temporaryPassword);
  if (!t) throw new Error(`temporary sign-in failed for ${email}`);
  const ch = await apiCall(t.token, "POST", "/auth/change-password", {
    currentPassword: temporaryPassword,
    newPassword: PW,
  });
  if (ch.s >= 300) throw new Error(`change-password ${email}: ${ch.s}`);
}

// ───────── results ─────────
const results = [];
const setup = {};
let current = { session: "-", persona: "-", variant: "-", page: "-", shot: null };
const check = (name, ok, detail = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({
    session: current.session,
    persona: current.persona,
    variant: current.variant,
    page: current.page,
    check: name,
    ok: !!ok,
    detail: (d ?? "").slice(0, 700),
    screenshot: current.shot,
  });
  console.log(
    `${ok ? "PASS" : "FAIL"}  [${current.persona} ${current.variant}] ${current.page} — ${name}${d ? "  -> " + d.slice(0, 260) : ""}`,
  );
  return !!ok;
};

// ───────── fixtures ─────────
const agent = one(
  `select id, name, agent_number from agents where name = 'R15 Acceptance Agent' and deleted_at is null limit 1`,
);
if (!agent) throw new Error("R15 Acceptance Agent missing — run r15-journeys.mjs first");
const agentAgreements = rows(
  `select agreement_number from agent_shipping_agreements where agent_id = ${lit(agent.id)} and deleted_at is null`,
).map((r) => r.agreement_number);
const agentAdminName = one(
  `select full_name from users where email = 'r15-agent-admin@oms.local'`,
)?.full_name;
const salesSelf =
  one(`select full_name from users where email = 'r15-sales@oms.local'`)?.full_name ?? "";
const otherSellers = [
  ...rows(
    `select full_name from users where email in ('r15-sales2@oms.local','r15-manager@oms.local','r15-viewall@oms.local','r15-browse@oms.local')`,
  ),
  ...rows(`select u.full_name from store_orders o join users u on u.id = o.employee_id where o.deleted_at is null
           and o.order_date >= date_trunc('month', now()) and u.email <> 'r15-sales@oms.local'
           group by u.full_name order by count(*) desc limit 15`),
]
  .map((r) => r.full_name)
  .filter((n) => n && n.length > 3 && !salesSelf.includes(n));
const wh = Object.fromEntries(
  rows(
    `select code, role from warehouses where code in ('WH-TRANSIT','WH-DAMAGED') and deleted_at is null`,
  ).map((w) => [w.code, w.role]),
);

const financeToken = (await apiLogin("r15-finance@oms.local"))?.token;
const shippingToken = (await apiLogin("r15-shipping@oms.local"))?.token;
if (!financeToken || !shippingToken)
  throw new Error("r15-finance / r15-shipping cannot sign in — run seed-personas.mjs");

// Partner login (as J6, through the API): reuse r15-partner-browser, else create it on a partner with an
// active agreement and closed periods.
async function ensurePartnerLogin() {
  let target =
    one(`select c.partner_id, p.name, u.is_active from users u join company_partner_profiles c on c.id = u.company_partner_id
                    join partners p on p.id = c.partner_id where u.email = ${lit(PARTNER_EMAIL)} limit 1`);
  if (!target) {
    target =
      one(`select c.partner_id, p.name from company_partner_profiles c join partners p on p.id = c.partner_id
                  join partner_agreements a on a.partner_id = c.partner_id and a.status = 'ACTIVE'
                  where not exists (select 1 from users u where u.company_partner_id = c.id)
                  order by (select count(*) from partner_entitlements e where e.agreement_id = a.id) desc, c.created_at limit 1`);
    if (!target) throw new Error("no company partner with an active agreement and no login");
    const r = await apiCall(
      financeToken,
      "POST",
      `/company-partners/profiles/${target.partner_id}/login`,
      {
        email: PARTNER_EMAIL,
        fullName: "R15 Browser Partner",
      },
    );
    if (r.s !== 201 || !r.j?.temporaryPassword)
      throw new Error(`partner login create: ${r.s} ${JSON.stringify(r.j)?.slice(0, 200)}`);
    await adopt(PARTNER_EMAIL, r.j.temporaryPassword);
    return { ...target, created: true };
  }
  if (target.is_active === false) {
    const e = await apiCall(
      financeToken,
      "POST",
      `/company-partners/profiles/${target.partner_id}/login/enable`,
    );
    if (e.s !== 200) throw new Error(`partner login enable: ${e.s}`);
  }
  const l = await apiLogin(PARTNER_EMAIL);
  if (!l || l.mustChange) {
    const rp = await apiCall(
      financeToken,
      "POST",
      `/company-partners/profiles/${target.partner_id}/login/reset-password`,
      {},
    );
    if (rp.s !== 200 || !rp.j?.temporaryPassword)
      throw new Error(`partner reset-password: ${rp.s}`);
    await adopt(PARTNER_EMAIL, rp.j.temporaryPassword);
  }
  return { ...target, created: false };
}
const partner = await ensurePartnerLogin();
setup.partner = {
  partnerId: partner.partner_id,
  name: partner.name,
  loginCreated: partner.created,
  email: PARTNER_EMAIL,
};

// Orders: an in-transit company order (shipment SHIPPED, goods receivable back) for r15-shipping and a delivered
// COD company order with money + returnable lines that r15-finance can open.
async function pickOrders() {
  const transit =
    rows(`select o.id, o.internal_order_id from store_orders o where o.deleted_at is null and o.agent_id is null
      and o.stock_status = 'IN_TRANSIT' and o.fulfillment_method <> 'PICKUP'
      and (select s.status from shipments s where s.store_order_id = o.id order by s.created_at desc limit 1) in ('SHIPPED','OUT_FOR_DELIVERY')
      order by o.updated_at desc limit 10`);
  let inTransit = null;
  for (const o of transit) {
    const st = await apiCall(shippingToken, "GET", `/store-orders/${o.id}/stock`);
    if (st.s === 200 && st.j?.canReceiveBack) {
      inTransit = { ...o, lines: st.j.lines?.length ?? 0 };
      break;
    }
  }
  const delivered =
    rows(`select o.id, o.internal_order_id from store_orders o where o.deleted_at is null and o.agent_id is null
      and o.stock_status = 'DELIVERED' and o.payment_type = 'CASH_ON_DELIVERY' order by o.updated_at desc limit 25`);
  let deliveredCod = null;
  for (const o of delivered) {
    const m = await apiCall(financeToken, "GET", `/store-orders/${o.id}/money`);
    const rt = await apiCall(financeToken, "GET", `/store-orders/${o.id}/returns`);
    const returnable = (rt.j?.invoices ?? []).some((i) =>
      i.lines.some((l) => l.returnableQuantity > 0),
    );
    if (m.s === 200 && returnable && Number(m.j?.figures?.withCarrier ?? 0) > 0) {
      deliveredCod = { ...o, figures: m.j.figures };
      break;
    }
  }
  // An order whose return was credited but not refunded yet (refund due > 0; the figure is hidden at zero).
  const returned =
    rows(`select o.id, o.internal_order_id from store_orders o where o.deleted_at is null and o.agent_id is null
      and exists (select 1 from sales_returns r where r.store_order_id = o.id) order by o.updated_at desc limit 40`);
  let refundDue = null;
  for (const o of returned) {
    const m = await apiCall(financeToken, "GET", `/store-orders/${o.id}/money`);
    if (m.s === 200 && Number(m.j?.figures?.refundDue ?? 0) > 0.005) {
      refundDue = { ...o, refundDue: m.j.figures.refundDue };
      break;
    }
  }
  return { inTransit, deliveredCod, refundDue };
}
const orders = await pickOrders();
setup.orders = {
  inTransit: orders.inTransit?.internal_order_id ?? null,
  deliveredCod: orders.deliveredCod?.internal_order_id ?? null,
  refundDue: orders.refundDue?.internal_order_id ?? null,
};
setup.agent = { number: agent.agent_number, shippingAgreements: agentAgreements };
console.log("setup:", JSON.stringify(setup));

// ───────── browser ─────────
const browser = await chromium.launch();
const VARIANTS = {
  "ar-desktop": {
    locale: "ar",
    scheme: "light",
    viewport: { width: 1440, height: 900 },
    mobile: false,
  },
  "ar-mobile": {
    locale: "ar",
    scheme: "light",
    viewport: { width: 390, height: 844 },
    mobile: true,
  },
  "en-desktop": {
    locale: "en",
    scheme: "light",
    viewport: { width: 1440, height: 900 },
    mobile: false,
  },
  "ar-dark": {
    locale: "ar",
    scheme: "dark",
    viewport: { width: 1440, height: 900 },
    mobile: false,
  },
};
const ar = (s) => s.v.locale === "ar";
const L = (s, arText, enText) => (ar(s) ? arText : enText);

async function openSession(key, persona, variant) {
  const v = VARIANTS[variant];
  const context = await browser.newContext({
    viewport: v.viewport,
    colorScheme: v.scheme,
    isMobile: v.mobile,
    hasTouch: v.mobile,
  });
  await context.addInitScript((value) => {
    try {
      if (!localStorage.getItem("oms.locale"))
        localStorage.setItem("oms.locale", JSON.stringify(value));
    } catch {
      // storage unavailable — the default locale applies
    }
  }, v.locale);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const s = { key, persona, variant, v, context, page, errors: [], failed: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") s.errors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (error) =>
    s.errors.push(`pageerror: ${String(error?.message ?? error).slice(0, 300)}`),
  );
  page.on("response", (response) => {
    const url = response.url();
    if (response.status() >= 400 && (url.startsWith(API) || url.startsWith(BASE)))
      s.failed.push(
        `${response.status()} ${response.request().method()} ${url.replace(API, "API").replace(BASE, "")}`,
      );
  });
  current = { session: key, persona, variant, page: "/login", shot: null };
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="email"]').fill(`r15-${persona}@oms.local`);
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  s.landing = new URL(page.url()).pathname;
  return s;
}

async function visit(s, path, label = path) {
  s.errors.length = 0;
  s.failed.length = 0;
  current = { session: s.key, persona: s.persona, variant: s.variant, page: label, shot: null };
  await s.page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await s.page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await s.page.waitForTimeout(900);
}

/** The generic per-page checks (call after the key elements were awaited). */
async function generic(s, { allowDenied = false } = {}) {
  const page = s.page;
  const body = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  const boundary =
    /Application error|client-side exception|This page could not be found|Internal Server Error/i.test(
      body,
    );
  check("no error boundary / not-found page", !boundary, boundary ? body.slice(0, 200) : "");
  if (!allowDenied) {
    const denied = /الوصول مرفوض|Access Denied/i.test(body);
    check("no Access denied", !denied);
  }
  check(
    "no console errors",
    s.errors.length === 0,
    s.errors.length
      ? `${s.errors.slice(0, 4).join(" || ")}${s.failed.length ? " || failed: " + s.failed.slice(0, 6).join(", ") : ""}`
      : "",
  );
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return { sw: el.scrollWidth, cw: el.clientWidth };
  });
  check(
    "no horizontal page overflow",
    overflow.sw <= overflow.cw + 1,
    `scrollWidth ${overflow.sw} / clientWidth ${overflow.cw}`,
  );
  const dir = await page.evaluate(() => document.documentElement.dir);
  check(`html dir = ${ar(s) ? "rtl" : "ltr"}`, dir === (ar(s) ? "rtl" : "ltr"), dir);
  if (s.v.scheme === "dark") {
    const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    check("dark theme applied", dark);
    // Text that stays near-black on a dark surface (a colour that ignores the theme) is unreadable.
    const unreadable = await page.evaluate(() => {
      const parse = (c) => {
        const n = (c.match(/-?\d*\.?\d+(e-?\d+)?%?/g) ?? []).map((v) =>
          v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v),
        );
        const alphaMatch = c.match(/\/\s*([\d.]+%?)/);
        let alpha = alphaMatch
          ? alphaMatch[1].endsWith("%")
            ? parseFloat(alphaMatch[1]) / 100
            : parseFloat(alphaMatch[1])
          : 1;
        let L;
        if (c.startsWith("rgb")) {
          if (n.length >= 4 && !alphaMatch) alpha = n[3];
          L = (0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2]) / 255;
        } else if (c.startsWith("oklch") || c.startsWith("oklab")) L = n[0] > 1 ? n[0] / 100 : n[0];
        else if (c.startsWith("lab") || c.startsWith("lch")) L = n[0] / 100;
        else if (c.startsWith("color(")) L = 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2];
        else return null;
        return { L, alpha };
      };
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        if (!el.getClientRects().length) continue;
        if (
          ![...el.childNodes].some((x) => x.nodeType === 3 && (x.nodeValue ?? "").trim().length > 1)
        )
          continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
        const fg = parse(cs.color);
        if (!fg || fg.L > 0.3) continue;
        let bg = null;
        for (let p = el; p && !bg; p = p.parentElement) {
          const b = parse(getComputedStyle(p).backgroundColor);
          if (b && b.alpha >= 0.5) bg = b;
        }
        if (!bg || bg.L < 0.4)
          out.push((el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60));
      }
      return [...new Set(out)];
    });
    check(
      "dark: no near-black text on a dark surface",
      unreadable.length === 0,
      unreadable.slice(0, 4).join(" | "),
    );
  }
  if (ar(s)) {
    // "08 Oct 2026" inside RTL text without LTR isolation renders as "Oct 2026 08" (the day number
    // detaches): flag every visible date whose previous strong character is Arabic / none.
    const bidi = await page.evaluate(() => {
      const re = /\d{1,2} [A-Za-z]{3,9}\.? \d{4}/g;
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = n.nodeValue ?? "";
        const bad = [...t.matchAll(re)].some((m) => {
          const head = t.slice(0, m.index);
          // Inside an open LRI (U+2066) … PDI (U+2069) run: isolated left-to-right, read correctly.
          if (head.split("\u2066").length > head.split("\u2069").length) return false;
          const before = head.replace(/[^A-Za-z؀-ۿ]/g, "");
          return before.length === 0 || /[؀-ۿ]$/.test(before);
        });
        if (!bad) continue;
        const el = n.parentElement;
        if (!el || el.getClientRects().length === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.direction !== "rtl" || cs.unicodeBidi === "plaintext") continue;
        out.push(t.trim().replace(/\s+/g, " ").slice(0, 70));
      }
      return [...new Set(out)];
    });
    check(
      "dates keep their reading order in RTL (no bidi reordering)",
      bidi.length === 0,
      bidi.slice(0, 4).join(" | "),
    );
    // A card value forced into an LTR number run (`num`) that holds Arabic words reorders
    // ("1 من 85" displays as "1 85 من").
    const mixed = await page.evaluate(() =>
      [...document.querySelectorAll('[data-slot="insight-value"]')]
        .filter(
          (v) =>
            v.getClientRects().length > 0 &&
            /[؀-ۿ]/.test(v.textContent ?? "") &&
            getComputedStyle(v).direction === "ltr",
        )
        .map((v) => (v.textContent ?? "").trim().slice(0, 40)),
    );
    check(
      "card values holding Arabic words are not forced LTR (word order kept)",
      mixed.length === 0,
      mixed.join(" | "),
    );
  }
  // Card labels squeezed by their scope chip break mid-word over 3+ lines.
  const squeezed = await page.evaluate(() =>
    [...document.querySelectorAll('[data-slot="insight-label"]')]
      .filter((l) => l.getClientRects().length > 0)
      .map((l) => {
        const r = l.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(l).lineHeight) || 18;
        return {
          t: (l.textContent ?? "").trim(),
          w: Math.round(r.width),
          lines: Math.round(r.height / lh),
        };
      })
      .filter((x) => x.lines > 2 || (x.w < 56 && x.t.length > 6))
      .map((x) => `${x.t} (${x.w}px, ${x.lines} lines)`),
  );
  check(
    "card labels not squeezed (≤ 2 lines, no mid-word break)",
    squeezed.length === 0,
    squeezed.slice(0, 4).join(" | "),
  );
  if (s.v.mobile) {
    // Responsive policy: tables adapt on phones (cards / stacked), never a sideways-scrolling table.
    const wide = await page.evaluate(() =>
      [...document.querySelectorAll("main table")]
        .filter((t) => t.getClientRects().length > 0)
        .map((t) => {
          let p = t.parentElement;
          while (p && p !== document.body && !/(auto|scroll)/.test(getComputedStyle(p).overflowX))
            p = p.parentElement;
          if (!p || p === document.body || p.scrollWidth <= p.clientWidth + 1) return null;
          const heads = [...t.querySelectorAll("thead th")]
            .map((th) => th.innerText.trim())
            .filter(Boolean);
          return `${heads.slice(0, 7).join("/")} (${p.scrollWidth}>${p.clientWidth}px)`;
        })
        .filter(Boolean),
    );
    check("phone: tables fit without sideways scrolling", wide.length === 0, wide.join(" || "));
  }
}

let shotSeq = 0;
async function shot(s, slug, focus) {
  shotSeq += 1;
  await s.page.waitForTimeout(450); // let open / close transitions settle
  const name = `${String(shotSeq).padStart(3, "0")}-${slug}-${s.persona}-${s.variant}.png`;
  try {
    if (focus && (await focus.count()))
      await focus
        .first()
        .evaluate(
          (el) => {
            if (el.closest('[role="dialog"]')) return;
            el.scrollIntoView({ block: "start" });
            // the sticky top bar covers the first ~64 px
            (document.scrollingElement ?? document.documentElement).scrollBy(0, -72);
            el.closest("main")?.scrollBy?.(0, -72);
          },
          null,
          { timeout: 3000 },
        )
        .catch(() => {});
    await s.page.screenshot({ path: `${OUT}/${name}` });
    current.shot = name;
    for (
      let i = results.length - 1;
      i >= 0 && results[i].page === current.page && results[i].session === current.session;
      i -= 1
    )
      results[i].screenshot ??= name;
  } catch (error) {
    check("screenshot taken", false, error?.message);
  }
  return name;
}

const visible = async (locator, timeout = 12000) => {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
};
const present = async (locator, timeout = 12000) => {
  try {
    await locator.first().waitFor({ state: "attached", timeout });
    return true;
  } catch {
    return false;
  }
};
const textOf = async (locator) =>
  (await locator.count())
    ? await locator
        .first()
        .innerText()
        .catch(() => "")
    : "";

/** The last open dialog fits the viewport width (phones). */
async function dialogFits(s, dialog) {
  const box = await dialog.boundingBox();
  const vw = s.v.viewport.width;
  return {
    ok: !!box && box.x >= -1 && box.x + box.width <= vw + 1,
    detail: box ? `x ${Math.round(box.x)} w ${Math.round(box.width)} / ${vw}` : "no box",
  };
}
async function closeDialog(s) {
  const page = s.page;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const confirm = page.getByRole("alertdialog");
  if (await confirm.count()) {
    await confirm
      .getByRole("button", { name: /^تجاهل$|^Discard$/ })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(300);
  }
  const still = await page.getByRole("dialog").count();
  if (still) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  return (await page.getByRole("dialog").count()) === 0;
}

const STEP_LABELS = {
  ar: ["العميل", "المنتجات", "التوصيل والدفع", "المراجعة"],
  en: ["Customer", "Products", "Delivery & payment", "Review"],
};
/** The shared four-step order-entry flow inside `root` (dialog or page card). */
async function checkStepFlow(s, root, { walk = false } = {}) {
  const labels = STEP_LABELS[s.v.locale];
  const listText =
    (await root
      .locator('[data-testid="step-flow-list"]')
      .first()
      .textContent()
      .catch(() => "")) ?? "";
  check(
    "shared flow shows the four steps (customer → products → delivery & payment → review)",
    labels.every((l) => listText.includes(l)),
    listText.slice(0, 160),
  );
  const order = labels.map((l) => listText.indexOf(l));
  check(
    "steps are in order",
    order.every((p, i) => i === 0 || p > order[i - 1]),
    JSON.stringify(order),
  );
  const step = await root
    .locator("[data-step]")
    .first()
    .getAttribute("data-step")
    .catch(() => null);
  check("flow opens on the customer step", step === "customer", String(step));
  if (s.v.mobile) {
    check(
      "phone: compact stepper visible",
      await visible(root.locator('[data-testid="step-flow-compact"]'), 4000),
    );
  } else {
    check(
      "desktop: step list visible",
      await visible(root.locator('[data-testid="step-flow-list"]'), 4000),
    );
  }
  const next = root.locator('[data-testid="step-flow-next"]');
  check("Next button visible", await visible(next, 4000));
  if (s.v.mobile && (await next.count())) {
    const box = await next.first().boundingBox();
    check(
      "phone: Next button inside the viewport",
      !!box &&
        box.y + box.height <= s.v.viewport.height + 1 &&
        box.x >= -1 &&
        box.x + box.width <= s.v.viewport.width + 1,
      box
        ? JSON.stringify({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width) })
        : "no box",
    );
  }
  const marks = await root.locator('[data-required-mark], [aria-required="true"]').count();
  check("required-field indicators present", marks > 0, `${marks}`);
  if (walk) {
    await next.first().click();
    await s.page.waitForTimeout(900);
    const after = await root
      .locator("[data-step]")
      .first()
      .getAttribute("data-step")
      .catch(() => null);
    const invalid = await root.locator('[aria-invalid="true"]').count();
    check(
      "Next on an empty customer step stays there with field errors",
      after === "customer" && invalid > 0,
      `step ${after}, invalid ${invalid}`,
    );
  }
}

// ═════════════════════════ page checks ═════════════════════════
const P = {};

P.agentsList = async (s) => {
  await visit(s, "/agents");
  const panel = s.page.locator('[role="region"][aria-labelledby="agents-overview"]');
  const ok = await visible(panel);
  check("cross-agent overview panel present", ok);
  const cards = panel.locator('[data-slot="insight-card"]');
  await present(cards, 12000);
  check(
    "overview insight cards rendered",
    (await cards.count()) >= 3,
    `${await cards.count()} cards`,
  );
  const rowsLoc = s.page.locator(
    'table tbody tr, [data-slot="mobile-row"], [data-slot="list-card"]',
  );
  if (!s.v.mobile && (await rowsLoc.count())) {
    const tBox = await s.page.locator("table").first().boundingBox();
    const pBox = await panel.first().boundingBox();
    check(
      "overview sits below the agent list",
      !!tBox && !!pBox && pBox.y > tBox.y,
      JSON.stringify({ table: tBox?.y, panel: pBox?.y }),
    );
  }
  await generic(s);
  await shot(s, "agents-list", s.page.locator("#agents-overview"));
};

P.agentOverview = async (s, { money }) => {
  await visit(s, `/agents/${agent.id}?tab=overview`, "/agents/<id>?tab=overview");
  const orders = s.page.locator('[role="region"][aria-labelledby="agent-overview-orders"]');
  check("orders & fulfilment panel present", await visible(orders));
  const sales = s.page.locator('[role="region"][aria-labelledby="agent-overview-sales"]');
  const position = s.page.locator('[role="region"][aria-labelledby="agent-overview-position"]');
  await s.page.waitForTimeout(600);
  const cards = await s.page.locator('main [data-slot="insight-card"]').count();
  check("overview uses shared insight cards", cards >= 3, `${cards} cards`);
  const hidden = await s.page
    .getByText(/تتطلب الأرقام المالية صلاحية عرض مالية الوكلاء|financial figures/i)
    .count();
  if (money) {
    check(
      "money panels shown with agents.finance.view (sales + account position)",
      (await sales.count()) > 0 && (await position.count()) > 0,
      `sales ${await sales.count()} position ${await position.count()}`,
    );
    check("no 'finance hidden' note for a finance viewer", hidden === 0);
  } else {
    check(
      "no account-position (money) panel without agents.finance.view",
      (await position.count()) === 0,
      `position ${await position.count()}`,
    );
    check("'finance figures need permission' note shown", hidden > 0);
  }
  await generic(s);
  await shot(s, "agent-overview", orders);
};

P.agentSettings = async (s) => {
  await visit(s, `/agents/${agent.id}?tab=settings`, "/agents/<id>?tab=settings");
  const title = s.page.getByText(L(s, "اتفاقية الشحن", "Shipping agreement"), { exact: true });
  check("shipping agreement section present", await visible(title));
  await s.page.waitForTimeout(800);
  const text = await s.page.locator("main").innerText();
  check(
    "current agreement number shown",
    agentAgreements.some((n) => text.includes(n)),
    agentAgreements.join(","),
  );
  check(
    "service × destination table (destination column + a service row)",
    (ar(s) ? /الوجهة/ : /Destination/).test(text) &&
      (ar(s) ? /شركة شحن · عند الاستلام|مندوب داخلي/ : /Carrier|courier/i).test(text),
  );
  check("agreement history section", (ar(s) ? /السجل/ : /History/).test(text));
  if (ar(s)) {
    // The activity log's details column (server text) in an Arabic session.
    const english =
      text.match(/(Activated|Deactivated|Draft [A-Z]+-\d{4}-\d+ created|rate\(s\))[^\n]*/g) ?? [];
    check(
      "activity log details are in Arabic in an Arabic session",
      english.length === 0,
      english.slice(0, 3).join(" | "),
    );
  }
  await generic(s);
  await shot(s, "agent-settings-shipping", title);
};

P.agentOrdersTab = async (s) => {
  await visit(s, `/agents/${agent.id}?tab=orders`, "/agents/<id>?tab=orders");
  const btn = s.page.getByRole("button", { name: L(s, "طلب جديد للوكيل", "New agent order") });
  let has = await visible(btn, s.v.mobile ? 5000 : 12000);
  check("'New agent order' button visible on the Orders tab", has);
  await generic(s);
  await shot(s, "agent-orders-tab");
  if (!has && s.v.mobile) {
    // The button is passed as the list's filterBar, which phones fold into the Filters sheet.
    const filters = s.page.getByRole("button", { name: /الفلاتر|Filters/ });
    if (await visible(filters, 4000)) {
      await filters.first().click();
      has = await visible(
        s.page
          .getByRole("dialog")
          .getByRole("button", { name: L(s, "طلب جديد للوكيل", "New agent order") }),
        4000,
      );
      check("phone: 'New agent order' only reachable inside the Filters sheet", has);
      if (has) await shot(s, "agent-orders-tab-filters-sheet", s.page.getByRole("dialog"));
      if (!has) await s.page.keyboard.press("Escape");
    }
  }
  if (!has) return;
  await btn.first().click();
  const dialog = s.page.locator('[data-testid="agent-order-entry-dialog"]');
  const open = await visible(s.page.getByRole("dialog"));
  check("button opens the shared order-entry dialog", open && (await present(dialog, 5000)));
  if (open) {
    await s.page.waitForTimeout(700);
    await checkStepFlow(s, s.page.getByRole("dialog").last());
    if (s.v.mobile) {
      const fit = await dialogFits(s, s.page.getByRole("dialog").last());
      check("phone: dialog fits the viewport", fit.ok, fit.detail);
    }
    const d2 = s.errors.length;
    check(
      "no console errors while the dialog is open",
      d2 === 0,
      s.errors.slice(0, 3).join(" || "),
    );
    await shot(s, "agent-order-entry-dialog", s.page.getByRole("dialog"));
    check("dialog closes without saving", await closeDialog(s));
  }
};

P.agentDashboard = async (s, { team }) => {
  await visit(s, "/agent/dashboard");
  const orders = s.page.locator('[role="region"][aria-labelledby="agent-orders"]');
  check("orders panel (own scope) present", await visible(orders));
  await s.page.waitForTimeout(600);
  const cards = await s.page.locator('main [data-slot="insight-card"]').count();
  check("shared insight cards rendered", cards >= 3, `${cards} cards`);
  const teamPanel = s.page.locator('[role="region"][aria-labelledby="agent-team"]');
  const text = await s.page.locator("main").innerText();
  if (team) {
    check("team breakdown panel (agent.reports.view_team)", await visible(teamPanel, 8000));
  } else {
    check("no team breakdown for an agent salesperson", (await teamPanel.count()) === 0);
    check(
      "another agent employee's name is absent",
      !!agentAdminName && !text.includes(agentAdminName),
      agentAdminName ?? "",
    );
  }
  await generic(s);
  await shot(s, "agent-dashboard", orders);
};

P.agentNewOrder = async (s) => {
  await visit(s, "/agent/orders/new");
  const card = s.page.locator('[data-testid="agent-order-entry"]');
  check("agent order entry renders the shared flow", await visible(card));
  await s.page.waitForTimeout(700);
  await checkStepFlow(s, card, { walk: !s.v.mobile });
  await generic(s);
  await shot(s, "agent-new-order", card);
};

async function openImportWizard(s) {
  const trigger = s.page.locator('[data-slot="action-label"]', { hasText: /^استيراد$|^Import$/ });
  if (!(await visible(trigger, 8000))) return { menu: false };
  await trigger.first().click();
  const upload = s.page.getByRole("menuitem", {
    name: /رفع Excel\/CSV من الجهاز|Upload Excel\/CSV from Device/,
  });
  const menu = await visible(upload, 5000);
  if (!menu) return { menu: true, items: false };
  await upload.first().click();
  const dialog = s.page.getByRole("dialog");
  return { menu: true, items: true, wizard: await visible(dialog, 8000) };
}

P.agentImports = async (s) => {
  await visit(s, "/agent/imports");
  const heading = s.page.getByRole("heading", { name: L(s, "الاستيراد", "Imports") });
  await visible(heading, 8000);
  const r = await openImportWizard(s);
  check("Import menu present (agent.leads.import / agent.orders.import)", r.menu);
  check("menu offers Upload Excel/CSV", r.items === true);
  check("import wizard opens", r.wizard === true);
  if (r.wizard) {
    if (s.v.mobile) {
      const fit = await dialogFits(s, s.page.getByRole("dialog").last());
      check("phone: wizard fits the viewport", fit.ok, fit.detail);
    }
    await shot(s, "agent-import-wizard", s.page.getByRole("dialog"));
    check("wizard closes", await closeDialog(s));
  }
  await generic(s);
  if (!r.wizard) await shot(s, "agent-imports");
};

P.storeOrdersList = async (s) => {
  await visit(s, "/store-orders");
  const createBtn = s.page.getByRole("button", { name: L(s, "طلب جديد", "New order") });
  check("'New order' button present", await visible(createBtn));
  if (!s.v.mobile) {
    const th = s.page.locator("table thead th", { hasText: ar(s) ? /^المخزون$/ : /^Stock$/ });
    check("stock-status column in the list", await visible(th, 8000));
    const labels = ar(s)
      ? [
          "محجوز",
          "ناقص",
          "في الطريق",
          "مُسلَّم جزئياً",
          "مُسلَّم",
          "لا يحتاج مخزوناً",
          "لم يُقيَّم بعد",
        ]
      : ["Reserved", "Short", "In transit", "Delivered"];
    const tbody = await textOf(s.page.locator("table tbody"));
    check(
      "stock chips rendered in rows",
      labels.some((l) => tbody.includes(l)),
      tbody.slice(0, 120),
    );
    const filter = s.page.locator("button[aria-expanded]", {
      hasText: ar(s) ? /^المخزون/ : /^Stock/,
    });
    const hasFilter = await visible(filter, 5000);
    check("stock-status filter in the toolbar", hasFilter);
    if (hasFilter) {
      await filter.first().click();
      const opt = s.page.locator("[cmdk-item]", { hasText: ar(s) ? "في الطريق" : "In transit" });
      check("filter lists the stock states", await visible(opt, 4000));
      await shot(s, "store-orders-stock-filter", filter);
      await s.page.keyboard.press("Escape");
    }
  } else {
    const filtersBtn = s.page.getByRole("button", { name: /الفلاتر|عوامل التصفية|Filters/ });
    if (await visible(filtersBtn, 5000)) {
      await filtersBtn.first().click();
      const sheetFilter = s.page.getByRole("dialog").locator("button", { hasText: /^المخزون/ });
      check("phone: stock-status filter in the filter sheet", await visible(sheetFilter, 4000));
      await s.page.keyboard.press("Escape");
      await s.page.waitForTimeout(300);
    } else check("phone: filter sheet button present", false);
  }
  await generic(s);
  await shot(s, "store-orders-list");
  // the New order dialog
  if (await createBtn.count()) {
    s.errors.length = 0;
    current.page = "/store-orders (New order dialog)";
    current.shot = null;
    await createBtn.first().click();
    const dialog = s.page.locator('[data-testid="store-order-create-dialog"]');
    const open = await visible(s.page.getByRole("dialog"));
    check("New order opens the shared order-entry dialog", open && (await present(dialog, 5000)));
    if (open) {
      await s.page.waitForTimeout(700);
      await checkStepFlow(s, s.page.getByRole("dialog").last(), { walk: !s.v.mobile });
      if (s.v.mobile) {
        const fit = await dialogFits(s, s.page.getByRole("dialog").last());
        check("phone: dialog fits the viewport", fit.ok, fit.detail);
      }
      check(
        "no console errors while the dialog is open",
        s.errors.length === 0,
        s.errors.slice(0, 3).join(" || "),
      );
      await shot(s, "store-order-new-dialog", s.page.getByRole("dialog"));
      check("dialog closes without saving", await closeDialog(s));
    }
  }
};

P.leadsImport = async (s, { expected }) => {
  await visit(s, "/crm/leads");
  await s.page.waitForTimeout(600);
  const trigger = s.page.locator('[data-slot="action-label"]', { hasText: /^استيراد$|^Import$/ });
  if (expected) check("Import menu visible (crm.leads.import)", await visible(trigger, 8000));
  else {
    await s.page.waitForTimeout(1500);
    check(
      "Import menu hidden without crm.leads.import",
      (await trigger.count()) === 0,
      `${await trigger.count()}`,
    );
  }
  await generic(s);
  await shot(s, `leads-import-${expected ? "visible" : "hidden"}`);
};

P.storeOrdersImport = async (s, { expected }) => {
  await visit(s, "/store-orders/import");
  const start = s.page.getByRole("button", { name: L(s, "بدء الاستيراد", "Start Import") });
  const has = await visible(start, 8000);
  if (expected) {
    check("'Start import' enabled (store-orders.import)", has && (await start.first().isEnabled()));
    if (has && (await start.first().isEnabled())) {
      await start.first().click();
      const open = await visible(s.page.getByRole("dialog"), 8000);
      check("import wizard opens", open);
      if (open) {
        if (s.v.mobile) {
          const fit = await dialogFits(s, s.page.getByRole("dialog").last());
          check("phone: wizard fits the viewport", fit.ok, fit.detail);
        }
        await shot(s, "store-orders-import-wizard", s.page.getByRole("dialog"));
        check("wizard closes", await closeDialog(s));
      }
    }
  } else {
    check(
      "'Start import' not available without store-orders.import",
      !has || !(await start.first().isEnabled()),
      has ? "visible" : "absent",
    );
  }
  await generic(s);
  await shot(s, "store-orders-import");
};

P.salesDashboard = async (s) => {
  await visit(s, "/dashboard");
  const ranking = s.page.locator('[role="region"][aria-labelledby="dash-ranking"]');
  const ok = await visible(ranking, 15000);
  check("ranking panel present", ok);
  await s.page.waitForTimeout(1200);
  const rtext = await textOf(ranking);
  const rankRe = ar(s)
    ? /ترتيبك[\s\S]*(\d+ من \d+|غير مُرتَّب بعد)/
    : /Your rank[\s\S]*(\d+ of \d+|Not ranked yet)/;
  check(
    "own rank card ('x of y' or not ranked)",
    rankRe.test(rtext),
    rtext.replace(/\s+/g, " ").slice(0, 160),
  );
  check(
    "no leaderboard rows in the ranking panel",
    (await ranking.locator("tbody tr").count()) === 0,
  );
  const text = await s.page.locator("main").innerText();
  const leaked = otherSellers.filter((n) => text.includes(n));
  check(
    "no other employee's name on the dashboard",
    leaked.length === 0,
    leaked.join(", ") || `checked ${otherSellers.length} names`,
  );
  await generic(s);
  await shot(s, "sales-dashboard-rank", ranking);
};

P.salesReports = async (s) => {
  await visit(s, "/reports/sales");
  const tabs = s.page.getByRole("tab");
  await visible(tabs, 12000);
  await s.page.waitForTimeout(1500);
  const names = (await tabs.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  const own = ar(s)
    ? ["تقارير Live", "أدائي", "طرق الدفع"]
    : ["Live", "My performance", "Payment mix"];
  const others = ar(s) ? ["الموظفون", "الفرق", "المقارنة"] : ["Employees", "Teams", "Comparison"];
  check(
    "own-scope tabs only (Live / My performance / Payment mix)",
    own.every((t) => names.includes(t)) && !others.some((t) => names.includes(t)),
    names.join(" | "),
  );
  const text = await s.page.locator("main").innerText();
  const leaked = otherSellers.filter((n) => text.includes(n));
  check("no other employee's name in the report", leaked.length === 0, leaked.join(", "));
  await generic(s);
  await shot(s, "sales-reports-own");
};

P.shippingOrder = async (s, { dialogs = true } = {}) => {
  if (!orders.inTransit)
    return check("an in-transit order with goods receivable back exists", false);
  await visit(
    s,
    `/store-orders/${orders.inTransit.id}`,
    `/store-orders/<in-transit ${orders.inTransit.internal_order_id}>`,
  );
  const panel = s.page.locator('main [data-slot="card-title"]', {
    hasText: new RegExp(`^${L(s, "المخزون", "Stock")}$`),
  });
  check("stock panel present", await visible(panel));
  await s.page.waitForTimeout(800);
  const text = await s.page.locator("main").innerText();
  const cols = ar(s)
    ? ["المحجوز", "في الطريق", "المُسلَّم"]
    : ["Reserved", "In transit", "Delivered"];
  check(
    "stock panel shows reserved / in transit / delivered",
    cols.every((c) => text.includes(c)),
    cols.join(","),
  );
  check("order stock chip shows In transit", (ar(s) ? /في الطريق/ : /In transit/).test(text));
  await generic(s);
  await shot(s, "order-in-transit-stock", panel);
  if (!dialogs) return;
  // Record delivery (header overflow menu) — open and cancel.
  s.errors.length = 0;
  current.page = `/store-orders/<in-transit> Record delivery`;
  current.shot = null;
  const more = s.page.locator('[data-testid="header-actions-more"]');
  if (await visible(more, 5000)) {
    await more.first().click();
    const item = s.page.locator('[data-testid="order-record-delivery"]');
    const hasItem = await visible(item, 4000);
    check("'Record delivery' action offered for a shipped parcel", hasItem);
    if (hasItem) {
      await item.first().click();
      const dialog = s.page.getByRole("dialog");
      const open = await visible(dialog, 6000);
      check(
        "Record delivery dialog opens",
        open && (await textOf(dialog.last())).includes(L(s, "تم التسليم", "Delivered")),
      );
      if (open) {
        await s.page.waitForTimeout(600);
        if (s.v.mobile) {
          const fit = await dialogFits(s, dialog.last());
          check("phone: dialog fits the viewport", fit.ok, fit.detail);
        }
        check(
          "no console errors in the dialog",
          s.errors.length === 0,
          s.errors.slice(0, 3).join(" || "),
        );
        await shot(s, "order-record-delivery-dialog", dialog);
        check("Record delivery dialog cancelled (nothing submitted)", await closeDialog(s));
      }
    } else await s.page.keyboard.press("Escape");
  } else check("header overflow menu present", false);
  // Receive returned goods — open and cancel.
  s.errors.length = 0;
  current.page = `/store-orders/<in-transit> Receive returned goods`;
  current.shot = null;
  const recv = s.page.locator('[data-testid="stock-receive-back"]');
  const hasRecv = await visible(recv, 5000);
  check("'Receive returned goods' action present", hasRecv);
  if (hasRecv) {
    await recv.first().click();
    const dialog = s.page.getByRole("dialog");
    const open = await visible(dialog, 6000);
    check(
      "Receive returned goods dialog opens",
      open &&
        (await textOf(dialog.last())).includes(
          L(s, "استلام البضاعة الراجعة", "Receive returned goods"),
        ),
    );
    if (open) {
      await s.page.waitForTimeout(500);
      if (s.v.mobile) {
        const fit = await dialogFits(s, dialog.last());
        check("phone: dialog fits the viewport", fit.ok, fit.detail);
      }
      check(
        "no console errors in the dialog",
        s.errors.length === 0,
        s.errors.slice(0, 3).join(" || "),
      );
      await shot(s, "order-receive-back-dialog", dialog);
      check("Receive returned goods dialog cancelled (nothing submitted)", await closeDialog(s));
    }
  }
};

/** Opens the order's payments section and returns the Collection panel title locator. */
async function openCollection(s) {
  const section = s.page.locator('[data-testid="section-payments"]');
  check("payments section present", await visible(section));
  if (await section.count()) {
    const toggle = section.first().locator("button[aria-expanded]").first();
    if ((await toggle.getAttribute("aria-expanded").catch(() => null)) !== "true")
      await toggle.click();
  }
  const title = s.page.locator('main [data-slot="card-title"]', {
    hasText: new RegExp(`^${L(s, "التحصيل", "Collection")}$`),
  });
  check("Collection panel present", await visible(title, 10000));
  await s.page.waitForTimeout(800);
  return title;
}

P.financeOrder = async (s, { dialogs = true } = {}) => {
  if (!orders.deliveredCod)
    return check("a delivered COD order with money + returnable lines exists", false);
  await visit(
    s,
    `/store-orders/${orders.deliveredCod.id}`,
    `/store-orders/<delivered COD ${orders.deliveredCod.internal_order_id}>`,
  );
  const title = await openCollection(s);
  const text = await s.page.locator("main").innerText();
  const figs = ar(s)
    ? ["المحصّل (مؤكد)", "لدى شركة الشحن"]
    : ["Collected (verified)", "Held by the carrier"];
  check(
    "Collection panel shows collected / with carrier (COD via carrier)",
    figs.every((f) => text.includes(f)),
    figs.filter((f) => !text.includes(f)).join(","),
  );
  await generic(s);
  await shot(s, "order-collection-cod", title);
  if (orders.refundDue) {
    await visit(
      s,
      `/store-orders/${orders.refundDue.id}`,
      `/store-orders/<refund due ${orders.refundDue.internal_order_id}>`,
    );
    const t2 = await openCollection(s);
    const text2 = await s.page.locator("main").innerText();
    check(
      "Collection panel shows the refund due figure",
      text2.includes(L(s, "مستحق الرد", "Refund due")),
    );
    check(
      "refund-pending notice shown (credit note ≠ refund)",
      (ar(s) ? /رد مستحق:/ : /Refund pending:/).test(text2),
    );
    await generic(s);
    await shot(s, "order-collection-refund-due", t2);
  } else check("an order with a refund due exists", false);
  if (!dialogs) return;
  await visit(
    s,
    `/store-orders/${orders.deliveredCod.id}`,
    `/store-orders/<delivered COD ${orders.deliveredCod.internal_order_id}>`,
  );
  await openCollection(s);
  s.errors.length = 0;
  current.page = `/store-orders/<delivered COD> Return`;
  current.shot = null;
  const ret = s.page.getByRole("button", { name: L(s, "إرجاع", "Return"), exact: true });
  const has = await visible(ret, 6000);
  check("'Return' action present (sales.returns.create, returnable lines)", has);
  if (has) {
    await ret.first().click();
    const dialog = s.page.getByRole("dialog");
    const open = await visible(dialog, 6000);
    check(
      "Return dialog opens",
      open && (await textOf(dialog.last())).includes(L(s, "إرجاع — الطلب", "Return")),
    );
    if (open) {
      await s.page.waitForTimeout(500);
      if (s.v.mobile) {
        const fit = await dialogFits(s, dialog.last());
        check("phone: dialog fits the viewport", fit.ok, fit.detail);
      }
      check(
        "no console errors in the dialog",
        s.errors.length === 0,
        s.errors.slice(0, 3).join(" || "),
      );
      await shot(s, "order-return-dialog", dialog);
      check("Return dialog cancelled (nothing submitted)", await closeDialog(s));
    }
  }
};

P.partnerLanding = async (s) => {
  current = {
    session: s.key,
    persona: s.persona,
    variant: s.variant,
    page: "login → landing",
    shot: null,
  };
  check("partner login lands on /partner", s.landing === "/partner", s.landing);
  await visit(s, "/partner");
  const tiles = s.page.locator('a[href="/partner/overview"], a[href="/partner/statement"]');
  check(
    "partner Home offers Overview + Statement",
    (await present(tiles)) && (await tiles.count()) >= 2,
    `${await tiles.count()}`,
  );
  await generic(s);
  await shot(s, "partner-home");
};

P.partnerOverview = async (s) => {
  await visit(s, "/partner/overview");
  const cards = s.page.locator('main [data-slot="insight-card"]');
  check(
    "overview cards rendered",
    (await present(cards)) && (await cards.count()) >= 3,
    `${await cards.count()}`,
  );
  const text = await s.page.locator("main").innerText();
  check(
    "partner's own agreement shown",
    (ar(s) ? /اتفاقيتك|نسبة الأرباح/ : /agreement|Profit share/i).test(text),
  );
  await generic(s);
  await shot(s, "partner-overview", cards);
};

P.partnerStatement = async (s) => {
  await visit(s, "/partner/statement");
  const table = s.page.locator('main table tbody tr, main [data-slot="mobile-row"]');
  await present(s.page.locator("main table, main [data-slot='mobile-row']"), 12000);
  await s.page.waitForTimeout(1000);
  const text = await s.page.locator("main").innerText();
  check(
    "per-period rows listed",
    (await table.count()) >= 1 ||
      (ar(s) ? /سبتمبر|أكتوبر|2026-0?9|2026-10/ : /Sep|Oct|2026-0?9|2026-10/).test(text),
    `${await table.count()} rows`,
  );
  check("estimate label shown", (ar(s) ? /تقديري/ : /Estimate/).test(text));
  check("approved label shown", (ar(s) ? /معتمد/ : /Approved/).test(text));
  await generic(s);
  await shot(s, "partner-statement");
};

P.partnerBlocked = async (s) => {
  s.errors.length = 0;
  current = {
    session: s.key,
    persona: s.persona,
    variant: s.variant,
    page: "/store-orders (partner)",
    shot: null,
  };
  await s.page.goto(`${BASE}/store-orders`);
  await s.page
    .waitForURL((url) => url.pathname.startsWith("/partner"), { timeout: 15000 })
    .catch(() => {});
  await s.page.waitForLoadState("networkidle").catch(() => {});
  const path = new URL(s.page.url()).pathname;
  check("visiting /store-orders redirects back to /partner", path.startsWith("/partner"), path);
  await shot(s, "partner-store-orders-redirect");
};

P.home = async (s) => {
  await visit(s, "/");
  const tile = s.page.locator('a[href="/modules/company-partners"]');
  check("«الشركاء» module tile on Home", await visible(tile));
  check(
    "tile label",
    (await textOf(tile)).includes(L(s, "الشركاء", "Partners")),
    await textOf(tile),
  );
  if (!s.v.mobile) {
    const side = s.page.locator('[data-sidebar="menu-button"]', {
      hasText: ar(s) ? /^الشركاء$/ : /^Partners$/,
    });
    check(
      "«الشركاء» is a top-level sidebar section",
      (await side.count()) >= 1,
      `${await side.count()}`,
    );
  }
  await generic(s);
  await shot(s, "home-partners-tile", tile);
};

P.partnersModule = async (s) => {
  await visit(s, "/modules/company-partners");
  const links = s.page.locator(
    'main a[href="/company-partners"], main a[href="/company-partners/periods"]',
  );
  check(
    "module overview lists the partners destinations",
    (await present(links)) && (await links.count()) >= 2,
    `${await links.count()}`,
  );
  await generic(s);
  await shot(s, "partners-module-overview");
};

P.partnersList = async (s) => {
  await visit(s, "/company-partners");
  await s.page.waitForTimeout(800);
  const text = await s.page.locator("main").innerText();
  check("partner list shows the logged-in partner", text.includes(partner.name), partner.name);
  await generic(s);
  await shot(s, "company-partners-list");
};

P.partnerDetail = async (s) => {
  await visit(s, `/company-partners/${partner.partner_id}`, "/company-partners/<id>");
  const loginTitle = s.page.getByText(L(s, "حساب دخول الشريك", "Partner login"), { exact: true });
  check("partner login card present", await visible(loginTitle));
  await s.page.waitForTimeout(800);
  const text = await s.page.locator("main").innerText();
  check("login card shows the linked login", text.includes(PARTNER_EMAIL));
  check(
    "per-period statement (estimate / approved labels)",
    (ar(s) ? /تقديري/ : /Estimate/).test(text) && (ar(s) ? /معتمد/ : /Approved/).test(text),
  );
  await generic(s);
  await shot(s, "company-partner-detail", loginTitle);
};

P.inventoryStock = async (s) => {
  await visit(s, "/inventory/stock");
  if (!s.v.mobile) {
    const th = s.page.locator("table thead th", {
      hasText: ar(s) ? /^في الطريق$/ : /^In transit$/,
    });
    check("In transit column shown", await visible(th));
    const cols = s.page.getByRole("button", { name: L(s, "الأعمدة", "Columns") });
    if (await visible(cols, 5000)) {
      await cols.first().click();
      const dmg = s.page.getByRole("menuitemcheckbox", { name: L(s, "تالف", "Damaged") });
      check(
        "Damaged column available (column chooser; hidden by default)",
        await visible(dmg, 4000),
      );
      await shot(s, "inventory-stock-columns", cols);
      await s.page.keyboard.press("Escape");
    } else check("column chooser present", false);
  } else {
    const text = await s.page.locator("main").innerText();
    check("phone: stock list renders", text.length > 50);
  }
  await generic(s);
  await shot(s, "inventory-stock");
};

P.warehouses = async (s) => {
  await visit(s, "/master-data/warehouses");
  const search = s.page.getByRole("searchbox").first();
  const hasSearch = await visible(search, 8000);
  check("warehouse list search present", hasSearch);
  for (const [code, badge] of [
    ["WH-TRANSIT", L(s, "بضاعة في الطريق", "Goods in transit")],
    ["WH-DAMAGED", L(s, "بضاعة تالفة", "Damaged goods")],
  ]) {
    if (hasSearch) {
      await search.fill(code);
      await s.page.waitForTimeout(1200);
      await s.page.waitForLoadState("networkidle").catch(() => {});
    }
    const text = await s.page.locator("main").innerText();
    check(
      `${code} listed with the '${badge}' role badge`,
      text.includes(code) && text.includes(badge),
      `role in DB: ${wh[code]}`,
    );
    if (code === "WH-TRANSIT") await shot(s, "warehouses-role-transit");
  }
  await generic(s);
  await shot(s, "warehouses-role-damaged");
};

// One page's exception is recorded on that page and never ends the session.
for (const [name, fn] of Object.entries(P)) {
  P[name] = async (s, ...rest) => {
    try {
      await fn(s, ...rest);
    } catch (error) {
      check("page checks completed without an exception", false, error?.message ?? String(error));
      await shot(s, `exception-${name}`).catch(() => {});
      await s.page.keyboard.press("Escape").catch(() => {});
    }
  };
}

// ═════════════════════════ sessions ═════════════════════════
const SESSIONS = [
  [
    "admin-ar-desktop",
    "admin",
    "ar-desktop",
    async (s) => {
      await P.agentsList(s);
      await P.agentOverview(s, { money: true });
      await P.agentSettings(s);
      await P.agentOrdersTab(s);
      await P.home(s);
      await P.partnersModule(s);
      await P.partnersList(s);
      await P.partnerDetail(s);
      await P.inventoryStock(s);
      await P.warehouses(s);
    },
  ],
  [
    "admin-ar-mobile",
    "admin",
    "ar-mobile",
    async (s) => {
      await P.agentsList(s);
      await P.agentSettings(s);
      await P.agentOrdersTab(s);
      await P.home(s);
      await P.partnersModule(s);
      await P.partnersList(s);
      await P.partnerDetail(s);
      await P.inventoryStock(s);
      await P.warehouses(s);
    },
  ],
  [
    "admin-en-desktop",
    "admin",
    "en-desktop",
    async (s) => {
      await P.agentsList(s);
      await P.agentSettings(s);
      await P.home(s);
      await P.partnerDetail(s);
      await P.inventoryStock(s);
    },
  ],
  [
    "admin-ar-dark",
    "admin",
    "ar-dark",
    async (s) => {
      await P.agentsList(s);
      await P.partnerDetail(s);
    },
  ],
  [
    "finance-ar-desktop",
    "finance",
    "ar-desktop",
    async (s) => {
      await P.agentOverview(s, { money: true });
      await P.financeOrder(s);
    },
  ],
  [
    "finance-ar-mobile",
    "finance",
    "ar-mobile",
    async (s) => {
      await P.agentOverview(s, { money: true });
      await P.financeOrder(s);
    },
  ],
  [
    "finance-ar-dark",
    "finance",
    "ar-dark",
    async (s) => {
      await P.agentOverview(s, { money: true });
      await P.financeOrder(s, { dialogs: false });
    },
  ],
  [
    "agview-ar-desktop",
    "agview",
    "ar-desktop",
    async (s) => {
      await P.agentOverview(s, { money: false });
    },
  ],
  [
    "agent-admin-ar-desktop",
    "agent-admin",
    "ar-desktop",
    async (s) => {
      current = {
        session: s.key,
        persona: s.persona,
        variant: s.variant,
        page: "login → landing",
        shot: null,
      };
      check("agent login lands on /agent", s.landing === "/agent", s.landing);
      await P.agentDashboard(s, { team: true });
    },
  ],
  [
    "agent-admin-ar-mobile",
    "agent-admin",
    "ar-mobile",
    async (s) => P.agentDashboard(s, { team: true }),
  ],
  [
    "agent-admin-en-desktop",
    "agent-admin",
    "en-desktop",
    async (s) => P.agentDashboard(s, { team: true }),
  ],
  [
    "agent-sales-ar-desktop",
    "agent-sales",
    "ar-desktop",
    async (s) => {
      await P.agentDashboard(s, { team: false });
      await P.agentNewOrder(s);
      await P.agentImports(s);
    },
  ],
  [
    "agent-sales-ar-mobile",
    "agent-sales",
    "ar-mobile",
    async (s) => {
      await P.agentDashboard(s, { team: false });
      await P.agentNewOrder(s);
      await P.agentImports(s);
    },
  ],
  [
    "sales-ar-desktop",
    "sales",
    "ar-desktop",
    async (s) => {
      await P.storeOrdersList(s);
      await P.leadsImport(s, { expected: true });
      await P.storeOrdersImport(s, { expected: true });
      await P.salesDashboard(s);
      await P.salesReports(s);
    },
  ],
  [
    "sales-ar-mobile",
    "sales",
    "ar-mobile",
    async (s) => {
      await P.storeOrdersList(s);
      await P.leadsImport(s, { expected: true });
      await P.storeOrdersImport(s, { expected: true });
      await P.salesDashboard(s);
      await P.salesReports(s);
    },
  ],
  [
    "sales-en-desktop",
    "sales",
    "en-desktop",
    async (s) => {
      await P.storeOrdersList(s);
      await P.salesDashboard(s);
      await P.salesReports(s);
    },
  ],
  [
    "sales2-ar-desktop",
    "sales2",
    "ar-desktop",
    async (s) => {
      await P.leadsImport(s, { expected: false });
      await P.storeOrdersImport(s, { expected: false });
    },
  ],
  ["shipping-ar-desktop", "shipping", "ar-desktop", async (s) => P.shippingOrder(s)],
  ["shipping-ar-mobile", "shipping", "ar-mobile", async (s) => P.shippingOrder(s)],
  ["shipping-ar-dark", "shipping", "ar-dark", async (s) => P.shippingOrder(s, { dialogs: false })],
  [
    "partner-ar-desktop",
    "partner-browser",
    "ar-desktop",
    async (s) => {
      await P.partnerLanding(s);
      await P.partnerOverview(s);
      await P.partnerStatement(s);
      await P.partnerBlocked(s);
    },
  ],
  [
    "partner-ar-mobile",
    "partner-browser",
    "ar-mobile",
    async (s) => {
      await P.partnerLanding(s);
      await P.partnerOverview(s);
      await P.partnerStatement(s);
      await P.partnerBlocked(s);
    },
  ],
  [
    "partner-en-desktop",
    "partner-browser",
    "en-desktop",
    async (s) => {
      await P.partnerOverview(s);
      await P.partnerStatement(s);
    },
  ],
  [
    "partner-ar-dark",
    "partner-browser",
    "ar-dark",
    async (s) => {
      await P.partnerOverview(s);
      await P.partnerStatement(s);
    },
  ],
];

for (const [key, persona, variant, fn] of SESSIONS) {
  if (ONLY && !ONLY.some((p) => key.startsWith(p))) continue;
  console.log(`\n=== ${key} ===`);
  let s = null;
  try {
    s = await openSession(key, persona, variant);
    await fn(s);
  } catch (error) {
    check("session completed without an exception", false, error?.message ?? String(error));
    if (s) await shot(s, "exception").catch(() => {});
  } finally {
    if (s) await s.context.close().catch(() => {});
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
const summary = {
  checks: results.length,
  pass: results.length - failed.length,
  fail: failed.length,
};
const pages = {};
for (const r of results) {
  const k = `${r.persona}|${r.variant}|${r.page}`;
  pages[k] ??= {
    persona: r.persona,
    variant: r.variant,
    page: r.page,
    screenshot: r.screenshot,
    pass: 0,
    fail: 0,
  };
  pages[k][r.ok ? "pass" : "fail"] += 1;
  pages[k].screenshot ??= r.screenshot;
}
writeFileSync(
  `${OUT}/results.json`,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      base: BASE,
      api: API,
      db: DB,
      variants: VARIANTS,
      setup,
      sideEffects: [
        "partner login r15-partner-browser@oms.local created / re-enabled through the API (finance) on the partner in setup.partner",
        "opening an import wizard creates a DRAFT import job (no rows): r15-agent-sales LEADS + r15-sales STORE_ORDERS, desktop and mobile",
      ],
      summary,
      pages: Object.values(pages),
      failures: failed,
      checks: results,
    },
    null,
    2,
  ),
);
console.log(`\n${summary.pass}/${summary.checks} passed, ${summary.fail} failed`);
process.exit(failed.length ? 1 : 0);
