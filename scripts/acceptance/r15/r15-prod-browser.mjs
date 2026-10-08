#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R15 — the READ-ONLY Production browser pass after the release (live user journeys by role, without
 * writing business data). Same per-page checks as r15-browser.mjs (error boundary, Access denied, console
 * errors, horizontal overflow, html dir, dark contrast, RTL date isolation, phrase direction, label wrap,
 * phone tables) on the R15 pages, as the Production QA personas:
 *
 *   admin        qa-admin (super admin)        Home «الشركاء», partners module, agents overview / agent
 *                                              overview / shipping agreement / New agent order dialog,
 *                                              inventory in-transit, system warehouses, store orders
 *                                              (stock column, New order dialog), a delivered order,
 *                                              company-wide sales report tabs
 *   finance      qa-finance                    agent overview with money, the delivered order's Collection
 *   sales        qa-sales-agent                own rank on the dashboard, New order dialog, no import menu,
 *                                              no sales reports
 *   manager      qa-sales-manager              company-wide dashboard ranking (reports.sales.view_all); the
 *                                              reports page still needs reports.sales.view (not held)
 *   shipping     qa-shipping                   store orders list + the delivered order's stock panel
 *   agent-admin  agent-a-admin.demo-agt        /agent landing, dashboard with team breakdown, import menu
 *   agent-sales  agent-a-sales1.demo-agt       own dashboard (no team, no admin name), shared order flow,
 *                                              no import menu
 *
 * Nothing is submitted: dialogs are opened and cancelled, the import wizard is never opened (it creates a
 * draft job), "Next" is pressed only on an empty customer step. Passwords: tmp/.qa.env (QA_PASSWORD,
 * AGENT_DEMO_PASSWORD), never printed. Evidence: specs/round15-completion/evidence/prod-browser/results.json
 * (labels and counts only — no customer data); screenshots in tmp/r15/prod-browser-shots/ (git-ignored).
 *
 *   node scripts/acceptance/r15/r15-prod-browser.mjs          ONLY=admin,sales …  runs a subset
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const ROOT = "D:/Systems/OMS";
const BASE = (process.env.BASE ?? "https://oms.haseb.org").replace(/\/$/, "");
const API = `${BASE}/api`;
// Results (no personal data) are evidence; screenshots show live records, so they stay in git-ignored tmp/.
const OUT = `${ROOT}/specs/round15-completion/evidence/prod-browser`;
const SHOTS = `${ROOT}/tmp/r15/prod-browser-shots`;
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY ? process.env.ONLY.split(",").map((s) => s.trim()) : null;
if (!ONLY) for (const f of readdirSync(SHOTS)) if (f.endsWith(".png")) rmSync(`${SHOTS}/${f}`);
const env = readFileSync(`${ROOT}/tmp/.qa.env`, "utf8");
const secret = (key) =>
  env
    .split(/\r?\n/)
    .find((l) => new RegExp(`${key}=`).test(l))
    ?.replace(new RegExp(`^\\s*(export\\s+)?${key}=`), "")
    .replace(/^["']|["']$/g, "")
    .trim();
const QA_PW = secret("QA_PASSWORD");
const AGENT_PW = secret("AGENT_DEMO_PASSWORD");
if (!QA_PW || !AGENT_PW) throw new Error("tmp/.qa.env needs QA_PASSWORD and AGENT_DEMO_PASSWORD");
const PERSONAS = {
  admin: ["qa-admin@oms.haseb.org", QA_PW],
  finance: ["qa-finance@oms.haseb.org", QA_PW],
  sales: ["qa-sales-agent@oms.haseb.org", QA_PW],
  manager: ["qa-sales-manager@oms.haseb.org", QA_PW],
  shipping: ["qa-shipping@oms.haseb.org", QA_PW],
  "agent-admin": ["agent-a-admin.demo-agt@oms.haseb.org", AGENT_PW],
  "agent-sales": ["agent-a-sales1.demo-agt@oms.haseb.org", AGENT_PW],
};

// ───────── fixtures through the API (GET only, as the QA admin; logged out afterwards) ─────────
async function apiLogin([email, password]) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) throw new Error(`fixture sign-in failed (${r.status})`);
  return j.accessToken;
}
const adminToken = await apiLogin(PERSONAS.admin);
const aget = async (path) =>
  (await fetch(API + path, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
const agentList = (await aget("/agents?page=1&pageSize=50")).items ?? [];
const agent = agentList.find((a) => a.agentNumber === "AG-0001");
if (!agent) throw new Error("AG-0001 missing on Production");
const agentAgreements = ((await aget(`/agents/${agent.id}/shipping-agreements`)).items ?? []).map(
  (x) => x.agreementNumber,
);
const agentUsers = await aget(`/agents/${agent.id}/users`);
const agentAdminName = (Array.isArray(agentUsers) ? agentUsers : (agentUsers.items ?? [])).find(
  (u) => u.email === PERSONAS["agent-admin"][0],
)?.fullName;
const orderList = (await aget("/store-orders?page=1&pageSize=50")).items ?? [];
const delivered = orderList.find((o) => o.internalOrderId === "STO-2026-000162") ?? null;
// Every other internal employee's name: none may appear on the salesperson's own-scope pages.
const usersRaw = await aget("/users?page=1&pageSize=100");
const users = Array.isArray(usersRaw) ? usersRaw : (usersRaw.items ?? []);
const salesSelf = users.find((u) => u.email === PERSONAS.sales[0])?.fullName ?? "";
const otherSellers = users
  .filter((u) => u.email !== PERSONAS.sales[0] && u.userType === "INTERNAL")
  .map((u) => u.fullName)
  .filter((n) => n && n.length > 3 && !salesSelf.includes(n));
if (otherSellers.length === 0) throw new Error("no other employee names to check — fixture broken");
await fetch(`${API}/auth/logout`, {
  method: "POST",
  headers: { Authorization: `Bearer ${adminToken}` },
});
const setup = {
  agent: agent.agentNumber,
  shippingAgreements: agentAgreements,
  agentAdminName: !!agentAdminName,
  deliveredOrder: delivered?.internalOrderId ?? null,
  otherSellers: otherSellers.length,
};
console.log("setup:", JSON.stringify(setup));

// ───────── results ─────────
const results = [];
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
  const [email, password] = PERSONAS[persona];
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
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
    await s.page.screenshot({ path: `${SHOTS}/${name}` });
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

// ═════════════════════════ Production page checks (read-only) ═════════════════════════
const P = {};

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
  check("partners list renders (list or empty state)", text.trim().length > 20);
  await generic(s);
  await shot(s, "company-partners-list");
};

P.agentsList = async (s) => {
  await visit(s, "/agents");
  const panel = s.page.locator('[role="region"][aria-labelledby="agents-overview"]');
  check("cross-agent overview panel present", await visible(panel));
  const cards = panel.locator('[data-slot="insight-card"]');
  await present(cards, 12000);
  check(
    "overview insight cards rendered",
    (await cards.count()) >= 3,
    `${await cards.count()} cards`,
  );
  await generic(s);
  await shot(s, "agents-list", s.page.locator("#agents-overview"));
};

P.agentOverview = async (s, { money }) => {
  await visit(s, `/agents/${agent.id}?tab=overview`, `/agents/${agent.agentNumber}?tab=overview`);
  const orders = s.page.locator('[role="region"][aria-labelledby="agent-overview-orders"]');
  check("orders & fulfilment panel present", await visible(orders));
  await s.page.waitForTimeout(600);
  const cards = await s.page.locator('main [data-slot="insight-card"]').count();
  check("overview uses shared insight cards", cards >= 3, `${cards} cards`);
  const sales = s.page.locator('[role="region"][aria-labelledby="agent-overview-sales"]');
  const position = s.page.locator('[role="region"][aria-labelledby="agent-overview-position"]');
  if (money)
    check(
      "money panels shown with agents.finance.view (sales + account position)",
      (await sales.count()) > 0 && (await position.count()) > 0,
      `sales ${await sales.count()} position ${await position.count()}`,
    );
  await generic(s);
  await shot(s, "agent-overview", orders);
};

P.agentSettings = async (s) => {
  await visit(s, `/agents/${agent.id}?tab=settings`, `/agents/${agent.agentNumber}?tab=settings`);
  const title = s.page.getByText(L(s, "اتفاقية الشحن", "Shipping agreement"), { exact: true });
  check("shipping agreement section present", await visible(title));
  await s.page.waitForTimeout(1000);
  const text = await s.page.locator("main").innerText();
  check(
    "migrated agreement number shown (ASA-…)",
    agentAgreements.some((n) => text.includes(n)),
    agentAgreements.join(","),
  );
  // Desktop: a service × destination table; phones: one card per destination with its services.
  check(
    "rates listed per service and destination",
    (s.v.mobile || (ar(s) ? /الوجهة/ : /Destination/).test(text)) &&
      (ar(s) ? /شركة شحن|مندوب داخلي/ : /Carrier|courier/i).test(text),
  );
  await generic(s);
  await shot(s, "agent-settings-shipping", title);
};

P.agentOrdersTab = async (s) => {
  await visit(s, `/agents/${agent.id}?tab=orders`, `/agents/${agent.agentNumber}?tab=orders`);
  const btn = s.page.getByRole("button", { name: L(s, "طلب جديد للوكيل", "New agent order") });
  let has = await visible(btn, s.v.mobile ? 5000 : 12000);
  if (!has && s.v.mobile) {
    const filters = s.page.getByRole("button", { name: /الفلاتر|Filters/ });
    if (await visible(filters, 4000)) {
      await filters.first().click();
      has = await visible(
        s.page
          .getByRole("dialog")
          .getByRole("button", { name: L(s, "طلب جديد للوكيل", "New agent order") }),
        4000,
      );
      if (has) {
        await s.page
          .getByRole("dialog")
          .getByRole("button", { name: L(s, "طلب جديد للوكيل", "New agent order") })
          .first()
          .click();
      }
    }
  } else if (has) await btn.first().click();
  check("'New agent order' button reachable on the Orders tab", has);
  if (!has) {
    await generic(s);
    return;
  }
  const open = await visible(s.page.locator('[data-testid="agent-order-entry-dialog"]'), 8000);
  check("button opens the shared order-entry dialog", open);
  if (open) {
    await s.page.waitForTimeout(700);
    await checkStepFlow(s, s.page.getByRole("dialog").last());
    if (s.v.mobile) {
      const fit = await dialogFits(s, s.page.getByRole("dialog").last());
      check("phone: dialog fits the viewport", fit.ok, fit.detail);
    }
    await shot(s, "agent-order-entry-dialog", s.page.getByRole("dialog"));
    check("dialog closes without saving", await closeDialog(s));
  }
  await generic(s);
};

P.inventoryStock = async (s) => {
  await visit(s, "/inventory/stock");
  if (!s.v.mobile) {
    const th = s.page.locator("table thead th", {
      hasText: ar(s) ? /^في الطريق$/ : /^In transit$/,
    });
    check("In transit column shown", await visible(th));
  } else {
    const text = await s.page.locator("main").innerText();
    check("phone: stock list renders", text.length > 50);
  }
  await generic(s);
  await shot(s, "inventory-stock");
};

P.warehouses = async (s) => {
  await visit(s, "/master-data/warehouses");
  await s.page.waitForTimeout(800);
  const text = await s.page.locator("main").innerText();
  for (const [code, badge] of [
    ["WH-TRANSIT", L(s, "بضاعة في الطريق", "Goods in transit")],
    ["WH-DAMAGED", L(s, "بضاعة تالفة", "Damaged goods")],
  ])
    check(
      `${code} listed with the '${badge}' role badge`,
      text.includes(code) && text.includes(badge),
    );
  await generic(s);
  await shot(s, "warehouses-roles");
};

P.storeOrdersList = async (s, { dialog = true } = {}) => {
  await visit(s, "/store-orders");
  const createBtn = s.page.getByRole("button", { name: L(s, "طلب جديد", "New order") });
  if (!s.v.mobile) {
    const th = s.page.locator("table thead th", { hasText: ar(s) ? /^المخزون$/ : /^Stock$/ });
    check("stock-status column in the list", await visible(th, 10000));
    const tbody = await textOf(s.page.locator("table tbody"));
    const labels = ar(s)
      ? ["محجوز", "ناقص", "في الطريق", "مُسلَّم", "لا يحتاج مخزوناً", "لم يُقيَّم بعد"]
      : ["Reserved", "Short", "In transit", "Delivered", "Not evaluated"];
    // A salesperson sees only their own orders (OWN scope); shipping.view never widens the generic list.
    const empty = /لا توجد طلبات متجر بعد|No store orders yet/.test(tbody);
    check(
      empty
        ? "list empty for this persona's scope (no orders of their own)"
        : "stock chips rendered in rows",
      empty || labels.some((l) => tbody.includes(l)),
      empty ? "" : labels.filter((l) => tbody.includes(l)).join(", "),
    );
  }
  await generic(s);
  await shot(s, "store-orders-list");
  if (!dialog || !(await visible(createBtn, 5000))) return;
  s.errors.length = 0;
  current.page = "/store-orders (New order dialog)";
  current.shot = null;
  await createBtn.first().click();
  const open = await visible(s.page.locator('[data-testid="store-order-create-dialog"]'), 8000);
  check("New order opens the shared order-entry dialog", open);
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
};

P.orderDetail = async (s, { collection }) => {
  if (!delivered) return check("the delivered order STO-2026-000162 exists", false);
  await visit(s, `/store-orders/${delivered.id}`, `/store-orders/${delivered.internalOrderId}`);
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
  );
  await generic(s);
  await shot(s, "order-stock-panel", panel);
  if (!collection) return;
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
  const t2 = await s.page.locator("main").innerText();
  check(
    "Collection panel shows the verified collection figure",
    t2.includes(L(s, "المحصّل (مؤكد)", "Collected (verified)")),
  );
  await generic(s);
  await shot(s, "order-collection", title);
};

P.salesDashboard = async (s) => {
  await visit(s, "/dashboard");
  const ranking = s.page.locator('[role="region"][aria-labelledby="dash-ranking"]');
  check("ranking panel present", await visible(ranking, 15000));
  await s.page.waitForTimeout(1200);
  const rtext = await textOf(ranking);
  const rankRe = ar(s)
    ? /ترتيبك[\s\S]*(\d+ من \d+|غير مُرتَّب بعد)/
    : /Your rank[\s\S]*(\d+ of \d+|Not ranked yet)/;
  check(
    "own rank card ('x of y' or not ranked)",
    rankRe.test(rtext),
    (rtext.match(rankRe)?.[1] ?? "").slice(0, 40),
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

P.noSalesReports = async (s) => {
  await visit(s, "/reports/sales");
  await s.page.waitForTimeout(1200);
  const path = new URL(s.page.url()).pathname;
  const text = await s.page.locator("body").innerText();
  const blocked =
    path !== "/reports/sales" || /الوصول مرفوض|Access Denied|لا تملك صلاحية/i.test(text);
  check("sales reports not opened without reports.sales.view", blocked, path);
  const leaked = otherSellers.filter((n) => text.includes(n));
  check("no other employee's name shown", leaked.length === 0, leaked.join(", "));
  await shot(s, "sales-reports-denied");
};

/** reports.sales.view_all: the dashboard ranking is company-wide (leaderboard or empty), never own-only. */
P.managerDashboard = async (s) => {
  await visit(s, "/dashboard");
  const ranking = s.page.locator('[role="region"][aria-labelledby="dash-ranking"]');
  check("ranking panel present", await visible(ranking, 15000));
  await s.page.waitForTimeout(1500);
  const rtext = await textOf(ranking);
  const rows = await ranking.locator("ol > li").count();
  check(
    "company-wide ranking (reports.sales.view_all), not the own-only card",
    !/تظهر أرقامك أنت فقط|Only your own figures are shown/.test(rtext),
    `${rows} leaderboard rows`,
  );
  await generic(s);
  await shot(s, "manager-dashboard-ranking", ranking);
};

P.managerReports = async (s) => {
  await visit(s, "/reports/sales");
  const tabs = s.page.getByRole("tab");
  await visible(tabs, 12000);
  await s.page.waitForTimeout(1500);
  const names = (await tabs.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  const wide = ar(s) ? ["الموظفون", "الفرق"] : ["Employees", "Teams"];
  check(
    "company-wide tabs (reports.sales.view_all)",
    wide.every((t) => names.includes(t)),
    names.join(" | "),
  );
  await generic(s);
  await shot(s, "sales-reports-company");
};

P.leadsImportMenu = async (s, { expected }) => {
  await visit(s, "/crm/leads");
  await s.page.waitForTimeout(1500);
  const trigger = s.page.locator('[data-slot="action-label"]', { hasText: /^استيراد$|^Import$/ });
  const count = await trigger.count();
  check(
    expected ? "Import menu visible" : "Import menu hidden without crm.leads.import",
    expected ? count > 0 : count === 0,
    `${count}`,
  );
  await generic(s);
  await shot(s, `leads-import-${expected ? "visible" : "hidden"}`);
};

P.agentDashboard = async (s, { team }) => {
  await visit(s, "/agent/dashboard");
  const orders = s.page.locator('[role="region"][aria-labelledby="agent-orders"]');
  check("orders panel present", await visible(orders));
  await s.page.waitForTimeout(800);
  const cards = await s.page.locator('main [data-slot="insight-card"]').count();
  check("shared insight cards rendered", cards >= 3, `${cards} cards`);
  const teamPanel = s.page.locator('[role="region"][aria-labelledby="agent-team"]');
  const text = await s.page.locator("main").innerText();
  if (team) check("team breakdown panel (agent.reports.view_team)", await visible(teamPanel, 8000));
  else {
    check("no team breakdown for an agent salesperson", (await teamPanel.count()) === 0);
    check("the agent admin's name is absent", !!agentAdminName && !text.includes(agentAdminName));
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

P.agentImportsMenu = async (s, { expected }) => {
  await visit(s, "/agent/imports");
  await s.page.waitForTimeout(1500);
  const trigger = s.page.locator('[data-slot="action-label"]', { hasText: /^استيراد$|^Import$/ });
  const has = (await trigger.count()) > 0;
  if (expected) {
    check("Import menu present (agent.leads.import / agent.orders.import)", has);
    if (has) {
      await trigger.first().click();
      const upload = s.page.getByRole("menuitem", {
        name: /رفع Excel\/CSV من الجهاز|Upload Excel\/CSV from Device/,
      });
      check(
        "menu offers Upload Excel/CSV (wizard not opened on Production)",
        await visible(upload, 5000),
      );
      await shot(s, "agent-import-menu");
      await s.page.keyboard.press("Escape");
    }
  } else {
    const body = await s.page.locator("body").innerText();
    check(
      "imports page gated without an import permission (Access denied, no menu)",
      !has && /الوصول مرفوض|Access Denied/i.test(body),
    );
  }
  await generic(s, { allowDenied: !expected });
};

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

const landing = (s, expected) => {
  current = {
    session: s.key,
    persona: s.persona,
    variant: s.variant,
    page: "login → landing",
    shot: null,
  };
  check(`login lands on ${expected}`, s.landing === expected, s.landing);
};

const SESSIONS = [
  [
    "admin-ar-desktop",
    "admin",
    "ar-desktop",
    async (s) => {
      await P.home(s);
      await P.partnersModule(s);
      await P.partnersList(s);
      await P.agentsList(s);
      await P.agentOverview(s, { money: true });
      await P.agentSettings(s);
      await P.agentOrdersTab(s);
      await P.inventoryStock(s);
      await P.warehouses(s);
      await P.storeOrdersList(s);
      await P.orderDetail(s, { collection: true });
      await P.managerReports(s);
    },
  ],
  [
    "admin-ar-mobile",
    "admin",
    "ar-mobile",
    async (s) => {
      await P.home(s);
      await P.agentsList(s);
      await P.agentSettings(s);
      await P.agentOrdersTab(s);
      await P.storeOrdersList(s);
      await P.orderDetail(s, { collection: true });
    },
  ],
  [
    "admin-en-desktop",
    "admin",
    "en-desktop",
    async (s) => {
      await P.home(s);
      await P.agentSettings(s);
      await P.storeOrdersList(s, { dialog: false });
      await P.orderDetail(s, { collection: true });
    },
  ],
  [
    "admin-ar-dark",
    "admin",
    "ar-dark",
    async (s) => {
      await P.agentsList(s);
      await P.agentSettings(s);
      await P.orderDetail(s, { collection: true });
    },
  ],
  [
    "finance-ar-desktop",
    "finance",
    "ar-desktop",
    async (s) => {
      await P.agentOverview(s, { money: true });
      await P.orderDetail(s, { collection: true });
    },
  ],
  ["finance-ar-dark", "finance", "ar-dark", async (s) => P.agentOverview(s, { money: true })],
  [
    "sales-ar-desktop",
    "sales",
    "ar-desktop",
    async (s) => {
      await P.salesDashboard(s);
      await P.storeOrdersList(s);
      await P.leadsImportMenu(s, { expected: false });
      await P.noSalesReports(s);
    },
  ],
  [
    "sales-ar-mobile",
    "sales",
    "ar-mobile",
    async (s) => {
      await P.salesDashboard(s);
      await P.storeOrdersList(s);
    },
  ],
  ["sales-en-desktop", "sales", "en-desktop", async (s) => P.salesDashboard(s)],
  [
    "manager-ar-desktop",
    "manager",
    "ar-desktop",
    async (s) => {
      await P.managerDashboard(s);
      await P.noSalesReports(s);
    },
  ],
  [
    "shipping-ar-desktop",
    "shipping",
    "ar-desktop",
    async (s) => {
      await P.storeOrdersList(s, { dialog: false });
      await P.orderDetail(s, { collection: false });
    },
  ],
  [
    "shipping-ar-mobile",
    "shipping",
    "ar-mobile",
    async (s) => P.orderDetail(s, { collection: false }),
  ],
  [
    "agent-admin-ar-desktop",
    "agent-admin",
    "ar-desktop",
    async (s) => {
      landing(s, "/agent");
      await P.agentDashboard(s, { team: true });
      await P.agentImportsMenu(s, { expected: true });
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
      landing(s, "/agent");
      await P.agentDashboard(s, { team: false });
      await P.agentNewOrder(s);
      await P.agentImportsMenu(s, { expected: false });
    },
  ],
  [
    "agent-sales-ar-mobile",
    "agent-sales",
    "ar-mobile",
    async (s) => {
      await P.agentDashboard(s, { team: false });
      await P.agentNewOrder(s);
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
    check("session completed", false, error?.message ?? String(error));
  } finally {
    // Sign out through the app's own API so the session row is revoked.
    if (s)
      await s.page
        .evaluate(async (api) => {
          const token = decodeURIComponent(
            document.cookie.match(/(?:^|; )oms_token=([^;]*)/)?.[1] ?? "",
          );
          if (token)
            await fetch(`${api}/auth/logout`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
            });
        }, API)
        .catch(() => {});
    await s?.context.close().catch(() => {});
  }
}
await browser.close();

writeFileSync(
  `${OUT}/results.json`,
  JSON.stringify({ base: BASE, at: new Date().toISOString(), setup, results }, null, 2),
);
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} passed, ${failed.length} failed`,
);
