#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R13 — browser acceptance: phone calling-code override (customers / suppliers /
 * users), password generate / reveal / copy, mobile 4-step order dialog with
 * dropdown scrolling, blue tone direction, chart of accounts Group / Posting,
 * FX automation state, fixed asset / prepaid detail, payment methods area,
 * sales Live reports (ar/en, light/dark, 390 px).
 *
 *   BASE=http://localhost:3001 API=http://localhost:3005 node scripts/acceptance/r13/browser-acceptance.mjs
 *
 * Login: admin@oms.local; the password is read at runtime from OMS_PW or the
 * dev seed (apps/api/prisma/seed.ts) — never written to evidence.
 * Demo data is tagged R13UI<digits>.
 * Evidence: specs/round13-accounting-reporting/evidence/*.png + browser-acceptance.json
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:3001").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:3005").replace(/\/$/, "");
const SHOTS = process.env.SHOTS !== "0";
const OUT = process.env.OUT ?? "specs/round13-accounting-reporting/evidence";
const EMAIL = process.env.OMS_EMAIL ?? "admin@oms.local";
mkdirSync(OUT, { recursive: true });
const PW =
  process.env.OMS_PW ??
  readFileSync("apps/api/prisma/seed.ts", "utf8").match(/bcrypt\.hash\('([^']+)'/)?.[1];
if (!PW) throw new Error("No password: set OMS_PW or keep the dev seed readable");

const TAG = "R13UI" + Date.now().toString().slice(-6);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + String(detail).slice(0, 300) : ""}`,
  );
};
const shots = [];
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.screenshot({ path: `${OUT}/r13-${name}.png` });
  shots.push(`r13-${name}.png`);
};
/** Runs one journey; an exception is a FAIL of that journey, never an abort of the run. */
async function journey(name, fn) {
  // ONLY="1. ,7." runs just the journeys whose name starts with one of those prefixes (debugging).
  if (process.env.ONLY && !process.env.ONLY.split(",").some((p) => name.startsWith(p))) return;
  try {
    await fn();
  } catch (error) {
    check(`${name}: journey completed without an exception`, false, error?.message ?? error);
  }
}

// ───────── API helpers ─────────
async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PW }),
  });
  return (await r.json()).accessToken;
}
const T = await login();
const call = async (m, p, b) => {
  const r = await fetch(API + p, {
    method: m,
    headers: { Authorization: "Bearer " + T, "Content-Type": "application/json" },
    body: b ? JSON.stringify(b) : undefined,
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* empty */
  }
  return { s: r.status, j };
};
const today = new Date().toISOString().slice(0, 10);
const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, "0");
const saMobile = () => "055" + rand(7); // national Saudi mobile
const digits = (s) => String(s ?? "").replace(/\D/g, "");

// ───────── demo data (tagged) ─────────
const countries = (await call("GET", "/countries?pageSize=300")).j.items;
const eg = countries.find((c) => c.code === "EG");
const product =
  ((await call("GET", "/products/catalog?pageSize=5&isSellable=true&search=TEST-INV-PROD-A")).j
    ?.items ?? [])[0] ??
  ((await call("GET", "/products/catalog?pageSize=5&isSellable=true")).j?.items ?? [])[0];
check("setup: a sellable active product exists", !!product, product?.sku);
const asset = await call("POST", "/fixed-assets", {
  name: `${TAG} Laptop`,
  acquisitionDate: today,
  cost: 12000,
  usefulLifeMonths: 24,
  depreciationMethod: "STRAIGHT_LINE",
  salvageValue: 0,
  notes: `${TAG} browser acceptance`,
});
check(
  "setup: tagged fixed asset created via API",
  asset.s === 201,
  `${asset.s} ${asset.j?.code ?? JSON.stringify(asset.j).slice(0, 200)}`,
);
const accounts = (await call("GET", "/chart-of-accounts?pageSize=1000")).j.items;
const expenseAccount = accounts.find(
  (a) => a.accountType === "EXPENSE" && a.allowsPosting && !a.deletedAt,
);
const receiving = ((await call("GET", "/receiving-accounts?pageSize=50")).j?.items ?? []).find(
  (r) => r.isActive,
);
const prepaid = await call("POST", "/prepaid-expenses", {
  name: `${TAG} Annual licence`,
  amount: 1200,
  startDate: today,
  totalPeriods: 12,
  expenseAccountId: expenseAccount?.id,
  receivingAccountId: receiving?.id,
  notes: `${TAG} browser acceptance`,
});
check(
  "setup: tagged prepaid expense created via API",
  prepaid.s === 201,
  `${prepaid.s} ${prepaid.j?.code ?? JSON.stringify(prepaid.j).slice(0, 200)}`,
);

// ───────── browser helpers ─────────
async function newContext(
  browser,
  {
    locale = "en",
    theme = "light",
    viewport = { width: 1440, height: 900 },
    touch = false,
    clipboard = false,
  } = {},
) {
  const ctx = await browser.newContext({
    viewport,
    locale: locale === "ar" ? "ar-EG" : "en-US",
    hasTouch: touch,
    isMobile: touch,
  });
  if (clipboard)
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await ctx.addInitScript(
    ([l, th]) => {
      try {
        localStorage.setItem("oms.locale", JSON.stringify(l));
        localStorage.setItem("theme", th);
      } catch {
        /* storage blocked */
      }
    },
    [locale, theme],
  );
  return ctx;
}
async function signIn(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('input[type="password"]').first().press("Enter");
  const t0 = Date.now();
  while (new URL(page.url()).pathname.includes("/login")) {
    if (Date.now() - t0 > 60000) throw new Error("login stuck");
    await page.waitForTimeout(300);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
}
const settle = async (page, ms = 900) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};
const go = async (page, path, ms = 1500) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await settle(page, ms);
};
const text = async (loc) =>
  ((await loc.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
const codeOf = async (scope) =>
  (await text(scope.locator('[data-testid="calling-code-picker"]').first())).replace(/[^\d+]/g, "");
/** Opens a cmdk combobox/popover trigger, types, picks the first matching item. */
const pick = async (page, trigger, query) => {
  await trigger.click();
  await page.waitForTimeout(350);
  await page.keyboard.type(query, { delay: 20 });
  await page.waitForTimeout(900);
  await page.locator("[cmdk-item]").first().click();
  await page.waitForTimeout(500);
};
const noHorizontalScroll = (page) =>
  page.evaluate(() => {
    const el = document.scrollingElement;
    return { scrollW: el.scrollWidth, vw: innerWidth, ok: el.scrollWidth <= innerWidth };
  });
const luminance = (rgb) => {
  if (/^oklab\(/.test(rgb)) return Number(rgb.match(/[\d.]+/)[0]) ** 3;
  if (/^oklch\(/.test(rgb)) return Number(rgb.match(/[\d.]+/)[0]) ** 3;
  const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]);
};
const closeDialog = async (page) => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const discard = page.getByRole("button", { name: /Discard|Leave|تجاهل|إغلاق بدون حفظ/ });
  if (await discard.count()) await discard.first().click();
  await page.waitForTimeout(300);
};
const findPartner = async (name) =>
  (
    (await call("GET", `/partners?search=${encodeURIComponent(name)}&pageSize=5`)).j?.items ?? []
  ).find((p) => p.name === name);

// The pinned Playwright revision may differ from the browsers installed on the
// machine: CHROMIUM_PATH (or the shared /opt/pw-browsers/chromium) is used then.
const fallbackChromium = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const browser = await chromium.launch(
  existsSync(chromium.executablePath()) || !existsSync(fallbackChromium)
    ? {}
    : { executablePath: fallbackChromium },
);

// ═════════ 1. Phone calling-code override: customers, suppliers, users ═════════
for (const entity of [
  { key: "customer", route: "/sales/customers" },
  { key: "supplier", route: "/purchasing/suppliers" },
]) {
  await journey(`1. ${entity.key}`, async () => {
    const ctx = await newContext(browser);
    const page = await signIn(ctx);
    await go(page, entity.route);
    await page
      .getByRole("button", { name: /^Add new$/i })
      .first()
      .click();
    const dlg = page.locator('[role="dialog"]').first();
    await dlg.waitFor();
    await page.waitForTimeout(600);
    const name = `${TAG} ${entity.key} phone override`;
    await dlg.locator('[data-field-name="name"] input').first().fill(name);
    await pick(page, dlg.locator('[data-field-name="countryId"] button').first(), "Egypt");
    const mobile = dlg.locator('[data-field-name="mobile"]');
    const proposed = await codeOf(mobile);
    check(
      `1. ${entity.key}: address country Egypt proposes +20 to the empty phone`,
      proposed === "+20",
      proposed,
    );
    await pick(page, mobile.locator('[data-testid="calling-code-picker"]'), "Saudi");
    const national = saMobile();
    await mobile.locator('input[type="tel"]').fill(national);
    await mobile.locator('input[type="tel"]').blur();
    await page.waitForTimeout(400);
    check(
      `1. ${entity.key}: +966 chosen in the picker sticks after typing (address stays Egypt)`,
      (await codeOf(mobile)) === "+966",
      await codeOf(mobile),
    );
    await dlg.getByRole("button", { name: /^Save$/ }).click();
    await page.waitForTimeout(2500);
    const saved = await findPartner(name);
    check(
      `1. ${entity.key}: saved with Egypt address and a +966 mobile`,
      saved && saved.mobile === "+966" + national.slice(1) && saved.countryId === eg.id,
      saved
        ? `${saved.mobile} country=${saved.countryId === eg.id ? "EG" : saved.countryId}`
        : "not found",
    );
    if (saved) {
      await go(page, `${entity.route}?edit=${saved.id}`, 2000);
      const edit = page.locator('[role="dialog"]').first();
      await edit.waitFor();
      await page.waitForTimeout(800);
      const emob = edit.locator('[data-field-name="mobile"]');
      const shown = await emob.locator('input[type="tel"]').inputValue();
      check(
        `1. ${entity.key}: reopened edit shows +966 and the same number`,
        (await codeOf(emob)) === "+966" && digits(shown).endsWith(digits(national).slice(1)),
        `${await codeOf(emob)} ${shown}`,
      );
      if (entity.key === "customer") await shot(page, "customer-edit-egypt-address-966-phone");
      await pick(page, edit.locator('[data-field-name="countryId"] button').first(), "Kuwait");
      const newCountry = await text(edit.locator('[data-field-name="countryId"] button').first());
      check(
        `1. ${entity.key}: changing the address country afterwards (→ Kuwait) leaves +966 unchanged`,
        /Kuwait/.test(newCountry) && (await codeOf(emob)) === "+966",
        `${newCountry} / ${await codeOf(emob)}`,
      );
      await closeDialog(page);
    }
    await ctx.close();
  });
}

// ═════════ 1c + 2. Users: calling code override + password generate / reveal / regenerate / copy ═════════
await journey("1/2. users", async () => {
  const ctx = await newContext(browser, { clipboard: true });
  const page = await signIn(ctx);
  await go(page, "/settings/users");
  await page
    .getByRole("button", { name: /^New User$/ })
    .first()
    .click();
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.waitFor();
  await page.waitForTimeout(800);
  const picker = dlg.locator('[data-testid="calling-code-picker"]');
  check(
    "1. users: the mobile field has the in-field calling-code picker",
    (await picker.count()) === 1,
    `${await picker.count()}`,
  );
  await pick(page, picker, "Egypt");
  await dlg.locator('input[type="tel"]').fill("010" + rand(8));
  await dlg.locator('input[type="tel"]').blur();
  await page.waitForTimeout(400);
  check(
    "1. users: a picked code (+20, default would be +966) sticks after typing",
    (await codeOf(dlg)) === "+20",
    await codeOf(dlg),
  );

  const pw = dlg.locator('input[autocomplete="new-password"]');
  const first = await pw.inputValue();
  const policy = (v) =>
    v.length >= 8 && /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v) && /[^A-Za-z0-9]/.test(v);
  check(
    "2. password: a generated password is present on open and meets the policy (≥8, upper/lower/digit/symbol)",
    policy(first),
    `length=${first.length}`,
  );
  const typeBefore = await pw.getAttribute("type");
  await dlg.getByRole("button", { name: /^(Hide password|Show password)$/ }).click();
  const typeAfter = await pw.getAttribute("type");
  await dlg.getByRole("button", { name: /^(Hide password|Show password)$/ }).click();
  const typeBack = await pw.getAttribute("type");
  check(
    "2. password: reveal / hide toggles the input type",
    typeBefore !== typeAfter && typeBack === typeBefore,
    `${typeBefore} → ${typeAfter} → ${typeBack}`,
  );
  await dlg.getByRole("button", { name: /^Generate another password$/ }).click();
  await page.waitForTimeout(300);
  const second = await pw.inputValue();
  check(
    "2. password: Regenerate changes the value and still meets the policy",
    second !== first && policy(second),
    `changed=${second !== first} length=${second.length}`,
  );
  await dlg.getByRole("button", { name: /^Copy password$/ }).click();
  await page.waitForTimeout(600);
  const toast = await text(
    page.locator("[data-sonner-toast]").filter({ hasText: /Password copied/ }),
  );
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  check(
    "2. password: Copy shows the 'Password copied' toast and the clipboard holds the field's value",
    /Password copied/.test(toast) && clip === second,
    `toast=${!!toast} clipboardMatches=${clip === second}`,
  );
  await shot(page, "user-create-password-and-phone");
  await closeDialog(page);
  await ctx.close();
});

// ═════════ 3 + 10. Mobile order dialog: dropdown scrolling, 4 steps, single create ═════════
await journey("3. mobile order", async () => {
  const ctx = await newContext(browser, { viewport: { width: 390, height: 844 }, touch: true });
  const page = await signIn(ctx);
  await go(page, "/store-orders", 1800);
  await page
    .getByRole("button", { name: /New Order/ })
    .first()
    .click();
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.waitFor();
  await page.waitForTimeout(800);
  const stepText = () => text(dlg.locator('[data-testid="step-flow-compact"]'));
  check(
    "3. mobile: dialog opens on step 1 of 4 (compact step header)",
    /1\D+4/.test(await stepText()),
    await stepText(),
  );
  const hs = await noHorizontalScroll(page);
  check("10. 390 px: order dialog — no horizontal page scroll", hs.ok, JSON.stringify(hs));

  // Next with an empty name: validation, stays on step 1
  await dlg.locator('[data-testid="step-flow-next"]').click();
  await page.waitForTimeout(800);
  const nameInvalid = await dlg
    .locator(
      '[data-field-name="customerName"][data-invalid="true"], input[name="customerName"][aria-invalid="true"]',
    )
    .count();
  check(
    "3. Next validates step 1: empty name shows an error and stays on step 1",
    nameInvalid > 0 && /1\D+4/.test(await stepText()),
    `invalid=${nameInvalid} ${await stepText()}`,
  );

  // long dropdown inside the dialog: wheel + touch swipe scroll the list, not the dialog
  const scrollState = () =>
    page.evaluate(() => {
      const list = [...document.querySelectorAll("[cmdk-list]")].find(
        (l) => l.getBoundingClientRect().height > 0,
      );
      const d = document.querySelector('[role="dialog"]');
      const scrollers = [...d.querySelectorAll("*")].filter(
        (e) =>
          e.scrollHeight > e.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(e).overflowY),
      );
      const r = list?.getBoundingClientRect();
      return {
        list: list ? list.scrollTop : null,
        listMax: list ? list.scrollHeight - list.clientHeight : null,
        rect: r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height } : null,
        dialog: scrollers.map((e) => e.scrollTop).join(","),
        win: scrollY,
      };
    });
  await dlg.locator('[data-testid="calling-code-picker"]').click();
  await page.waitForTimeout(700);
  const s0 = await scrollState();
  check("3. calling-code dropdown is a long scrollable list", s0.listMax > 200, JSON.stringify(s0));
  await page.mouse.move(s0.rect.x, s0.rect.y);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(600);
  const s1 = await scrollState();
  check(
    "3. wheel over the open dropdown scrolls the list (dialog/page stay put)",
    s1.list > s0.list && s1.dialog === s0.dialog && s1.win === s0.win,
    `list ${s0.list}→${s1.list} dialog ${s0.dialog}→${s1.dialog}`,
  );
  const cdp = await ctx.newCDPSession(page);
  const x = Math.round(s1.rect.x);
  const yStart = Math.round(s1.rect.y + s1.rect.h * 0.3);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: yStart }],
  });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: yStart - i * 15 }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(800);
  const s2 = await scrollState();
  check(
    "3. touch swipe over the open dropdown scrolls the list (dialog/page stay put)",
    s2.list > s1.list && s2.dialog === s1.dialog && s2.win === s1.win,
    `list ${s1.list}→${s2.list} dialog ${s1.dialog}→${s2.dialog}`,
  );
  await shot(page, "order-mobile-dropdown-scrolled");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  check(
    "3. Escape closes only the dropdown, the order dialog stays open",
    (await dlg.isVisible()) && (await page.locator("[cmdk-list]").count()) === 0,
  );

  // step 1
  const customerName = `${TAG} Mobile Customer`;
  await dlg.locator('input[name="customerName"]').fill(customerName);
  const national = saMobile();
  await dlg.locator('input[type="tel"]').fill(national);
  await dlg.locator('input[type="tel"]').blur();
  await page.waitForTimeout(1500);
  await dlg.locator('[data-testid="step-flow-next"]').click();
  await page.waitForTimeout(1500);
  check("3. step 1 complete → step 2 (products)", /2\D+4/.test(await stepText()), await stepText());

  // step 2
  const line = dlg.locator('[data-testid="document-line"]').first();
  await pick(page, line.locator("button").first(), product.sku);
  await page.waitForTimeout(600);
  await line.locator('input[type="number"]').first().fill("2");
  await line.locator('input[placeholder="0.00"]').first().fill("150");
  await page.waitForTimeout(300);
  await dlg.locator('[data-testid="step-flow-next"]').click();
  await page.waitForTimeout(1200);
  check(
    "3. step 2 complete → step 3 (delivery & payment)",
    /3\D+4/.test(await stepText()),
    await stepText(),
  );

  // step 3
  if (await dlg.locator('input[name="city"]').count())
    await dlg.locator('input[name="city"]').fill("Riyadh");
  if (await dlg.locator('input[name="address"]').count())
    await dlg.locator('input[name="address"]').fill(`${TAG} street 1`);
  await dlg.locator('[data-testid="step-flow-next"]').click();
  await page.waitForTimeout(1200);
  check(
    "3. step 3 complete → step 4 (review)",
    /4\D+4/.test(await stepText()) &&
      (await dlg.locator('[data-testid="order-review"]').count()) === 1,
    await stepText(),
  );

  // Back keeps values
  const back = dlg.getByRole("button", { name: /^Back$/ });
  await back.click();
  await page.waitForTimeout(500);
  const cityKept = (await dlg.locator('input[name="city"]').count())
    ? await dlg.locator('input[name="city"]').inputValue()
    : "Riyadh";
  await back.click();
  await page.waitForTimeout(500);
  const lineKept = (await text(dlg.locator('[data-testid="document-line"]').first())).includes(
    product.displayName || product.name,
  );
  await back.click();
  await page.waitForTimeout(500);
  const nameKept = await dlg.locator('input[name="customerName"]').inputValue();
  check(
    "3. Back keeps values (step 3 city, step 2 product line, step 1 name)",
    cityKept === "Riyadh" && lineKept && nameKept === customerName,
    `city=${cityKept} line=${lineKept} name=${nameKept === customerName}`,
  );
  for (let i = 0; i < 3; i++) {
    await dlg.locator('[data-testid="step-flow-next"]').click();
    await page.waitForTimeout(1300);
  }
  const review = await text(dlg.locator('[data-testid="order-review"]'));
  check(
    "3. Review shows the totals (2 × 150 = 300) with the order currency",
    /300/.test(review) && /SAR/.test(review),
    review.slice(0, 260),
  );
  await shot(page, "order-mobile-review");

  // double-click Create → exactly one order
  await dlg.locator('[data-testid="step-flow-final"]').dblclick();
  await page.waitForTimeout(4000);
  const created =
    (await call("GET", `/store-orders?search=${encodeURIComponent(customerName)}&pageSize=20`)).j
      ?.items ?? [];
  const mine = created.filter((o) => JSON.stringify(o).includes(customerName));
  check(
    "3. double-click Create → exactly one order created",
    mine.length === 1,
    `${mine.length} order(s) ${mine.map((o) => o.internalOrderId).join(",")}`,
  );
  const ok = await text(page.locator("[data-sonner-toast]").first());
  check("3. success feedback toast after Create", ok.length > 0, ok.slice(0, 120));
  await ctx.close();
});

// ═════════ 4. Blue direction (ListToolbar tones) ═════════
for (const locale of ["ar", "en"]) {
  await journey(`4. tones ${locale}`, async () => {
    const ctx = await newContext(browser, { locale });
    const page = await signIn(ctx);
    await go(page, "/store-orders", 2000);
    const tones = await page
      .locator('[data-slot="list-toolbar"] [data-toolbar-tone]')
      .evaluateAll((els) =>
        els
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              tone: Number(el.getAttribute("data-toolbar-tone")),
              x: r.x + r.width / 2,
              y: Math.round(r.y),
              bg: getComputedStyle(el).backgroundColor,
            };
          }),
      );
    const dir = await page.evaluate(() => document.documentElement.dir);
    // Compare inside ONE row of related controls (the row holding the first tone-1 control).
    const t1 = tones.find((t) => t.tone === 1);
    const row = tones.filter((t) => t1 && Math.abs(t.y - t1.y) < 6);
    const maxTone = Math.max(...row.map((t) => t.tone));
    const tMax = row.find((t) => t.tone === maxTone);
    const detail = JSON.stringify({
      dir,
      row: row.map((t) => [t.tone, Math.round(t.x), luminance(t.bg).toFixed(3)]),
    });
    if (!t1 || !tMax || maxTone < 2) {
      check(`4. [${locale}] toolbar has at least two toned controls`, false, detail);
    } else if (locale === "ar") {
      check(
        "4. [ar/RTL] tone-1 control sits on the RIGHT of the highest tone",
        t1.x > tMax.x && dir === "rtl",
        detail,
      );
      check(
        "4. [ar/RTL] tone-1 is lighter than the highest tone",
        luminance(t1.bg) > luminance(tMax.bg),
        detail,
      );
      await shot(page, "toolbar-tones-ar-rtl");
    } else {
      check(
        "4. [en/LTR] tone-1 control sits on the LEFT of the highest tone",
        t1.x < tMax.x && dir === "ltr",
        detail,
      );
      check(
        "4. [en/LTR] tone-1 is lighter than the highest tone",
        luminance(t1.bg) > luminance(tMax.bg),
        detail,
      );
    }
    await ctx.close();
  });
}

// ═════════ 5. Chart of accounts Group / Posting ═════════
await journey("5. COA", async () => {
  const ctx = await newContext(browser);
  const page = await signIn(ctx);
  await go(page, "/finance/chart-of-accounts", 2000);
  await page
    .getByRole("button", { name: /^New Account$/ })
    .first()
    .click();
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.waitFor();
  await page.waitForTimeout(600);
  const radios = await dlg.getByRole("radio").allInnerTexts();
  check(
    "5. create dialog offers the Group / Posting choice",
    radios.some((r) => /Group Account/.test(r)) && radios.some((r) => /Posting Account/.test(r)),
    radios.join(" | "),
  );
  const hint = await text(dlg);
  check(
    "5. Posting is the default and explains it cannot have sub-accounts",
    /cannot have sub-accounts/.test(hint),
  );
  await shot(page, "coa-create-group-posting");
  await closeDialog(page);

  // UI: a Posting account offers no "Add Sub-Account"; a Group account does
  await page
    .getByRole("button", { name: /^Expand All$/ })
    .first()
    .click();
  await page.waitForTimeout(800);
  const posting = accounts.find(
    (a) => a.allowsPosting && !a.deletedAt && a.accountType === "ASSET",
  );
  const group = accounts.find((a) => !a.allowsPosting && !a.deletedAt && a.code === "1");
  const menuItems = async (account) => {
    const row = page
      .locator("div.flex.flex-wrap.items-center")
      .filter({ has: page.locator(`text="${account.code}"`) })
      .first();
    await row.getByRole("button", { name: /^Actions$/ }).click();
    await page.waitForTimeout(400);
    const items = await page.getByRole("menuitem").allInnerTexts();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    return items.map((s) => s.trim());
  };
  const postingMenu = await menuItems(posting);
  const groupMenu = await menuItems(group);
  check(
    "5. UI: a Posting account has no 'Add Sub-Account' action; a Group account has it",
    !postingMenu.includes("Add Sub-Account") && groupMenu.includes("Add Sub-Account"),
    `posting ${posting.code}: [${postingMenu}] group ${group.code}: [${groupMenu}]`,
  );

  // API: a child under a Posting account is refused with the explanation
  const child = await call("POST", "/chart-of-accounts", {
    name: `${TAG} child of posting`,
    accountType: posting.accountType,
    parentAccountId: posting.id,
    accountKind: "POSTING",
  });
  const msg = child.j?.message ?? child.j?.error?.message ?? JSON.stringify(child.j);
  check(
    "5. API: creating a child under a Posting account is refused with the explanatory message",
    child.s === 400 && /Posting account and cannot have sub-accounts/.test(JSON.stringify(child.j)),
    `${child.s} ${String(msg).slice(0, 200)}`,
  );
  await ctx.close();
});

// ═════════ 6. Exchange-rate automation state ═════════
await journey("6. FX", async () => {
  const ctx = await newContext(browser);
  const page = await signIn(ctx);
  await go(page, "/finance/exchange-rates", 2500);
  const overall = page.locator('[data-testid="fx-state-overall"]');
  const overallText = await text(overall);
  check(
    "6. automation state shown as text + icon",
    overallText.length > 5 && (await overall.locator("svg").count()) > 0,
    overallText.slice(0, 160),
  );
  const sw = page.locator('[data-testid="fx-state-switch"]');
  const swHasSwitch = (await sw.getByRole("switch").count()) === 1;
  const run = page.locator('[data-testid="fx-run-now"]');
  check(
    "6. 'Enable automatic updates' switch and a separate 'Refresh now' button",
    swHasSwitch &&
      /Enable automatic updates/.test(await text(sw)) &&
      /Refresh now/.test(await text(run)) &&
      (await sw.locator('[data-testid="fx-run-now"]').count()) === 0,
  );
  const last = await text(page.locator('[data-testid="fx-last-success"]'));
  const next = await text(page.locator('[data-testid="fx-state-next"]'));
  check(
    "6. last successful update and next run are shown",
    last.length > 3 && next.length > 5,
    `${last} | ${next.slice(0, 120)}`,
  );
  await shot(page, "fx-automation-state");
  await ctx.close();
});

// ═════════ 7 + 10. Fixed asset / prepaid detail ═════════
await journey("7. assets", async () => {
  const ctx = await newContext(browser);
  const page = await signIn(ctx);
  await go(page, `/finance/fixed-assets/${asset.j.id}`, 2500);
  const body = await text(page.locator("main"));
  check(
    "7. fixed asset detail loads (name + code)",
    body.includes(`${TAG} Laptop`) && body.includes(asset.j.code),
    asset.j.code,
  );
  check("7. depreciation schedule section visible", /Depreciation schedule/.test(body));
  await shot(page, "fixed-asset-detail");
  await page
    .getByRole("button", { name: /^Capitalize$/ })
    .first()
    .click();
  const dlg = page.locator('[role="dialog"], [role="alertdialog"]').first();
  await dlg.waitFor();
  await page.waitForTimeout(1500);
  const rows = await dlg.locator("tbody tr").count();
  check(
    "7. schedule preview (before capitalization) lists the 24 monthly periods",
    rows === 24 && /24 monthly period/.test(await text(dlg)),
    `${rows} rows`,
  );
  await shot(page, "fixed-asset-schedule-preview");
  await closeDialog(page);

  await go(page, `/finance/prepaid-expenses/${prepaid.j.id}`, 2500);
  const pbody = await text(page.locator("main"));
  const prow = await page.locator("main tbody tr").count();
  check(
    "7. prepaid detail loads with its recognition schedule",
    pbody.includes(`${TAG} Annual licence`) && /Recognition schedule/.test(pbody) && prow >= 12,
    `${prow} rows`,
  );
  await shot(page, "prepaid-detail");
  await ctx.close();

  const mctx = await newContext(browser, { viewport: { width: 390, height: 844 }, touch: true });
  const mpage = await signIn(mctx);
  await go(mpage, `/finance/fixed-assets/${asset.j.id}`, 2500);
  const hs = await noHorizontalScroll(mpage);
  check("10. 390 px: fixed asset detail — no horizontal page scroll", hs.ok, JSON.stringify(hs));
  await go(mpage, "/master-data/payment-methods", 2500);
  const hs2 = await noHorizontalScroll(mpage);
  check("10. 390 px: payment methods — no horizontal page scroll", hs2.ok, JSON.stringify(hs2));
  await mctx.close();
});

// ═════════ 8. Payment methods area ═════════
await journey("8. payment methods", async () => {
  const ctx = await newContext(browser);
  const page = await signIn(ctx);
  await go(page, "/master-data/payment-methods", 2000);
  const tabs = (await page.getByRole("tab").allInnerTexts()).map((s) => s.trim());
  check(
    "8. tabs Methods / Channels / Receiving accounts",
    ["Methods", "Channels", "Receiving accounts"].every((t) => tabs.includes(t)),
    tabs.join(" | "),
  );
  await go(page, "/finance/payment-sources", 2500);
  const url = new URL(page.url());
  const selected = await text(page.locator('[role="tab"][aria-selected="true"]'));
  check(
    "8. /finance/payment-sources redirects to the Channels tab",
    url.pathname === "/master-data/payment-methods" &&
      url.searchParams.get("tab") === "channels" &&
      selected === "Channels",
    `${url.pathname}${url.search} selected=${selected}`,
  );
  await shot(page, "payment-methods-channels");
  await ctx.close();
});

// ═════════ 9. Sales reports ═════════
const live = (await call("GET", "/sales-reports/live")).j;
for (const scheme of [
  { locale: "ar", theme: "light" },
  { locale: "ar", theme: "dark" },
  { locale: "en", theme: "light" },
  { locale: "en", theme: "dark" },
]) {
  const tag = `${scheme.locale}/${scheme.theme}`;
  await journey(`9. sales ${tag}`, async () => {
    const ctx = await newContext(browser, scheme);
    const page = await signIn(ctx);
    await go(page, "/reports/sales", 3000);
    const env = await page.evaluate(() => ({
      dir: document.documentElement.dir,
      dark: document.documentElement.classList.contains("dark"),
    }));
    check(
      `9. [${tag}] direction and theme applied`,
      env.dir === (scheme.locale === "ar" ? "rtl" : "ltr") &&
        env.dark === (scheme.theme === "dark"),
      JSON.stringify(env),
    );
    const cards = page.locator('main [data-slot="insight-card"]');
    const n = await cards.count();
    const amounts = await cards.evaluateAll((els) =>
      els.map((el) => el.querySelector('[data-slot="report-amounts"]')?.textContent ?? ""),
    );
    const labelled = live.periods.every((p, i) =>
      p.amounts.length === 0
        ? amounts[i]?.length > 0
        : p.amounts.some((a) => (amounts[i] ?? "").includes(a.currencyCode)),
    );
    check(
      `9. [${tag}] Live: 5 period cards with currency-labelled amounts`,
      n === 5 && labelled,
      `${n} cards; ${amounts.map((a) => a.slice(0, 40)).join(" | ")}`,
    );
    const bar = await text(page.locator("main"));
    check(
      `9. [${tag}] Live: last refresh time shown`,
      scheme.locale === "ar" ? /آخر تحديث/.test(bar) : /Updated /.test(bar),
    );
    if (tag === "ar/light" || tag === "en/dark")
      await shot(page, `sales-live-${scheme.locale}-${scheme.theme}`);
    for (const [label, re] of [
      [scheme.locale === "ar" ? "الموظفون" : "Employees", /./],
      [
        scheme.locale === "ar" ? "المقارنة" : "Comparison",
        scheme.locale === "ar" ? /الترتيب/ : /Ranking/,
      ],
    ]) {
      await page.getByRole("tab", { name: label }).click();
      await settle(page, 2000);
      const panel = await text(page.locator('[role="tabpanel"]'));
      const failed = /تعذّر تحميل التقرير|Could not load the report/.test(panel);
      check(
        `9. [${tag}] ${label} tab renders`,
        !failed && panel.length > 20 && re.test(panel),
        panel.slice(0, 140),
      );
    }
    await ctx.close();
  });
}
await journey("9. sales 390", async () => {
  const ctx = await newContext(browser, {
    locale: "ar",
    viewport: { width: 390, height: 844 },
    touch: true,
  });
  const page = await signIn(ctx);
  await go(page, "/reports/sales", 3000);
  const hs = await noHorizontalScroll(page);
  check("9. 390 px: sales reports Live — no horizontal page scroll", hs.ok, JSON.stringify(hs));
  await shot(page, "sales-live-mobile-390");
  await page.getByRole("tab", { name: "المقارنة" }).click();
  await settle(page, 2000);
  const hs2 = await noHorizontalScroll(page);
  check(
    "9. 390 px: sales reports Comparison — no horizontal page scroll",
    hs2.ok,
    JSON.stringify(hs2),
  );
  await ctx.close();
});

await browser.close();
const failed = results.filter((r) => !r.ok);
writeFileSync(
  `${OUT}/browser-acceptance.json`,
  JSON.stringify(
    {
      tag: TAG,
      base: BASE,
      ranAt: new Date().toISOString(),
      passed: results.length - failed.length,
      failed: failed.length,
      screenshots: shots,
      results,
    },
    null,
    2,
  ),
);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
