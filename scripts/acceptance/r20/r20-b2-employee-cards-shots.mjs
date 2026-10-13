#!/usr/bin/env node
/**
 * R20 §B2 — one local visual pass of the employee cards (local build only, read-only) for the
 * before (main) and after builds: the Employees tab side by side (admin, ALL) at 1440 (ar + en,
 * light + dark), 1280 and 768 (ar + en light), 375 (ar + en, light + one dark); My performance
 * (sales, OWN) and the agent team (agent, AGENT_ALL); the other report cards that carry currency
 * colours (Live, Teams, Payment mix) at 1440; hover / keyboard focus / reduced motion; and a
 * long-name / large-amount / zero probe (API answer rewritten in the browser only).
 *
 *   BASE=http://localhost:4811 OUT=specs/round20-corrections/evidence/b2/after \
 *     PW_FILE=D:/Systems/OMS/tmp/r15-manual/.env node scripts/acceptance/r20/r20-b2-employee-cards-shots.mjs
 *
 * Writes `<OUT>/metrics.json`: per view the employee cards per row, the card size, whether the
 * period rows of the first pair line up (same top + height per period), horizontal overflow and
 * clipped text. The password is read at runtime and never written out.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:4811").replace(/\/$/, "");
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("local build only");
const OUT = process.env.OUT ?? "specs/round20-corrections/evidence/b2/after";
const PW = readFileSync(process.env.PW_FILE ?? "D:/Systems/OMS/tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)[1]
  .trim();
mkdirSync(OUT, { recursive: true });
const metrics = {};
const browser = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PNG writes on this machine can fail with EUNKNOWN (AV locks) — retry with backoff. */
async function shot(page, name, options = {}) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await page.screenshot({ path: `${OUT}/${name}.png`, ...options });
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      await sleep(400 * 2 ** attempt);
    }
  }
}

const WIDTHS = { 1440: 900, 1280: 800, 768: 1024, 375: 812 };
async function context({ locale = "ar", scheme = "light", width = 1440, reducedMotion = "no-preference" } = {}) {
  const mobile = width < 768;
  const ctx = await browser.newContext({
    ...(mobile ? devices["iPhone 13 mini"] : {}),
    viewport: { width, height: WIDTHS[width] },
    colorScheme: scheme,
    reducedMotion,
  });
  await ctx.addInitScript(
    ([value, theme]) => {
      try {
        localStorage.setItem("oms.locale", JSON.stringify(value));
        localStorage.setItem("theme", theme);
      } catch {
        // private mode — defaults
      }
    },
    [locale, scheme],
  );
  return ctx;
}
const settle = async (page) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(900);
};
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await settle(page);
}
const run = async (name, fn) => {
  const keys = process.env.ONLY?.split(",") ?? [];
  const hit = (key) => (key.startsWith("-") ? name.endsWith(key) : name.startsWith(key));
  if (keys.length && !keys.some(hit)) return;
  try {
    await fn();
    console.log("done", name);
  } catch (error) {
    console.log("FAILED", name, String(error?.message ?? error).slice(0, 240));
    metrics[name] = { error: String(error?.message ?? error).slice(0, 240) };
  }
};
async function openTab(page, value) {
  const trigger = page.locator(`[role="tab"][id$="-trigger-${value}"]`);
  await trigger.waitFor({ timeout: 20000 });
  await trigger.click();
  await settle(page);
  await page
    .waitForFunction(
      () => !document.querySelector('[aria-hidden="true"][data-slot="insight-card"]'),
      null,
      { timeout: 15000 },
    )
    .catch(() => {});
}

/** Layout of the employee cards: per row, size, period-row alignment across the first pair. */
const readCards = (page) =>
  page.evaluate(() => {
    const frames = [...document.querySelectorAll('[data-slot="insight-frame"]')].filter(
      (el) => !el.hasAttribute("aria-hidden"),
    );
    const clipped = [];
    for (const el of document.querySelectorAll(
      ':is([data-slot="insight-card"], [data-slot="insight-frame"]) :is([data-slot="insight-value"], [data-slot="report-amounts"] li, [data-slot="insight-label"], [data-slot="insight-frame-title"])',
    )) {
      if (el.scrollWidth > el.clientWidth + 1) clipped.push(el.textContent.trim().slice(0, 60));
    }
    const rect = (el) => el.getBoundingClientRect();
    const firstTop = frames[0] ? Math.round(rect(frames[0]).top) : null;
    const perRow = frames.filter((el) => Math.round(rect(el).top) === firstTop).length;
    const boxes = (frame) => [...frame.querySelectorAll('[data-slot="insight-card"]')];
    let pairAligned = null;
    if (perRow >= 2) {
      const [a, b] = [boxes(frames[0]), boxes(frames[1])];
      pairAligned = a.every((box, i) => {
        const other = b[i];
        if (!other) return false;
        const [ra, rb] = [rect(box), rect(other)];
        return Math.abs(ra.top - rb.top) < 1 && Math.abs(ra.height - rb.height) < 1;
      });
    }
    const first = frames[0];
    return {
      frames: frames.length,
      cardsPerRow: perRow,
      card: first
        ? { width: Math.round(rect(first).width), height: Math.round(rect(first).height) }
        : null,
      boxesPerCard: first ? boxes(first).length : 0,
      boxLayout: first ? first.querySelector('[data-slot="insight-card"]')?.getAttribute("data-layout") ?? "card" : null,
      pairAligned,
      currencyHues: [...new Set([...document.querySelectorAll('[data-slot="money-currency"]')].map(
        (el) => `${el.textContent.trim()}:${el.getAttribute("data-currency") ?? "-"}:${getComputedStyle(el).color}`,
      ))].slice(0, 12),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      clipped,
      pageHeight: document.documentElement.scrollHeight,
    };
  });

const probe = (el) =>
  el.evaluate((node) => {
    const s = getComputedStyle(node);
    const icon = node.querySelector('[data-slot="insight-icon"] svg');
    return {
      border: s.borderTopColor,
      shadow: s.boxShadow.slice(0, 120),
      outline: `${s.outlineStyle} ${s.outlineWidth}`,
      translate: s.translate,
      icon: icon ? getComputedStyle(icon).scale + " " + getComputedStyle(icon).translate : null,
      layout: [node.offsetTop, node.offsetLeft, node.offsetWidth, node.offsetHeight].join(","),
      text: node.innerText.replace(/\s+/g, " ").trim(),
    };
  });

const LAYOUT = [
  // [suffix, locale, scheme, width]
  ["ar-light-1440", "ar", "light", 1440],
  ["en-light-1440", "en", "light", 1440],
  ["ar-dark-1440", "ar", "dark", 1440],
  ["en-dark-1440", "en", "dark", 1440],
  ["ar-light-1280", "ar", "light", 1280],
  ["en-light-1280", "en", "light", 1280],
  ["ar-light-768", "ar", "light", 768],
  ["en-light-768", "en", "light", 768],
  ["ar-light-375", "ar", "light", 375],
  ["en-light-375", "en", "light", 375],
  ["ar-dark-375", "ar", "dark", 375],
];
for (const [suffix, locale, scheme, width] of LAYOUT) {
  await run(`admin-employees-${suffix}`, async () => {
    const ctx = await context({ locale, scheme, width });
    const page = await ctx.newPage();
    await login(page, "admin@oms-demo.local");
    await page.goto(`${BASE}/reports/sales`);
    await settle(page);
    await openTab(page, "employees");
    const name = `admin-employees-${suffix}`;
    await shot(page, name, { fullPage: true });
    // The first pair alone (the comparison view).
    const first = page.locator('[data-slot="insight-frame"]').first();
    const box = await first.boundingBox();
    if (box) {
      await page.evaluate((y) => window.scrollTo(0, y - 16), box.y + (await page.evaluate(() => window.scrollY)));
      await page.waitForTimeout(300);
      await shot(page, `${name}-pair`);
    }
    metrics[name] = await readCards(page);
    await ctx.close();
  });
}

for (const [persona, path, tab, who] of [
  ["sales@oms-demo.local", "/reports/sales", "own", "sales"],
  ["agent@oms-demo.local", "/agent/reports", "employees", "agent"],
]) {
  for (const [suffix, locale, scheme, width] of [
    ["ar-light-1440", "ar", "light", 1440],
    ["en-dark-1440", "en", "dark", 1440],
    ["ar-light-375", "ar", "light", 375],
    ["en-light-375", "en", "light", 375],
  ]) {
    await run(`${who}-${tab}-${suffix}`, async () => {
      const ctx = await context({ locale, scheme, width });
      const page = await ctx.newPage();
      await login(page, persona);
      await page.goto(`${BASE}${path}`);
      await settle(page);
      await openTab(page, tab);
      await shot(page, `${who}-${tab}-${suffix}`, { fullPage: true });
      metrics[`${who}-${tab}-${suffix}`] = await readCards(page);
      await ctx.close();
    });
  }
}

// The other report cards that carry the currency colours.
for (const [suffix, locale, scheme] of [
  ["ar-light-1440", "ar", "light"],
  ["en-dark-1440", "en", "dark"],
]) {
  await run(`admin-other-${suffix}`, async () => {
    const ctx = await context({ locale, scheme });
    const page = await ctx.newPage();
    await login(page, "admin@oms-demo.local");
    await page.goto(`${BASE}/reports/sales`);
    await settle(page);
    for (const tab of ["live", "teams", "paymentMix"]) {
      await openTab(page, tab);
      await shot(page, `admin-${tab}-${suffix}`, { fullPage: true });
      metrics[`admin-${tab}-${suffix}`] = await readCards(page);
    }
    await ctx.close();
  });
}

// Hover / focus / reduced motion on the first employee card and one of its period rows.
for (const [name, options] of [
  ["state-ar-light", { locale: "ar", scheme: "light" }],
  ["state-en-dark", { locale: "en", scheme: "dark" }],
  ["state-reduced-motion", { locale: "ar", scheme: "light", reducedMotion: "reduce" }],
]) {
  await run(name, async () => {
    const ctx = await context(options);
    const page = await ctx.newPage();
    await login(page, "admin@oms-demo.local");
    await page.goto(`${BASE}/reports/sales`);
    await settle(page);
    await openTab(page, "employees");
    const frame = page.locator('[data-slot="insight-frame"]').first();
    const header = page.locator('[data-slot="insight-frame-header"]').first();
    const row = frame.locator('[data-slot="insight-card"]').nth(2);
    await frame.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    const rest = await probe(frame);
    const box = await frame.boundingBox();
    const clip = box
      ? { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: Math.min(1440 - Math.max(0, box.x - 16), box.width + 32), height: Math.min(900, box.height + 32) }
      : undefined;
    await ((await header.count()) ? header : frame).hover();
    await page.waitForTimeout(450);
    const hover = await probe(frame);
    await shot(page, `${name}-hover`, { clip });
    await row.hover();
    await page.waitForTimeout(450);
    const rowHover = await probe(row);
    await shot(page, `${name}-row-hover`, { clip });
    await page.mouse.move(2, 2);
    await frame.focus().catch(() => {});
    await page.keyboard.press("Shift");
    await page.waitForTimeout(450);
    const focus = await probe(frame);
    await shot(page, `${name}-focus`, { clip });
    metrics[name] = {
      rest,
      hover,
      rowHover,
      focus,
      focused: await frame.evaluate((node) => node === document.activeElement),
      layoutShift: rest.layout !== hover.layout || rest.layout !== focus.layout,
      textChanged: rest.text !== hover.text,
    };
    await ctx.close();
  });
}

// Long names, large amounts (several currencies), zero values: the answer is rewritten in the
// browser only.
for (const [suffix, locale, width] of [
  ["ar-1440", "ar", 1440],
  ["en-1440", "en", 1440],
  ["ar-375", "ar", 375],
  ["en-375", "en", 375],
]) {
  await run(`long-${suffix}`, async () => {
    const ctx = await context({ locale, width });
    const page = await ctx.newPage();
    await login(page, "admin@oms-demo.local");
    await page.route(/\/sales-reports\/(employee-periods|performance)/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const rows = body.employees ?? [];
      const names = [
        "عبد الرحمن بن محمد بن عبد العزيز آل الشيخ الطويل",
        "Maximilian Alexander Konstantin von Hohenzollern-Sigmaringen",
      ];
      rows.slice(0, 2).forEach((row, i) => {
        row.name = names[i];
        const periods = Array.isArray(row.periods) ? row.periods : [row];
        periods.forEach((p, k) => {
          if (k === 1) {
            Object.assign(p, { orders: 0, valid: 0, cancelled: 0, returned: 0, amounts: [] });
            return;
          }
          Object.assign(p, {
            valid: 12345,
            orders: 12399,
            cancelled: 54,
            returned: 7,
            amounts: ["EGP", "SAR", "USD", "AED"].slice(0, 1 + ((k + i) % 4)).map((currencyCode) => ({
              currencyCode,
              amount: 1234567890.55,
            })),
          });
        });
      });
      await route.fulfill({ response, json: body });
    });
    await page.goto(`${BASE}/reports/sales`);
    await settle(page);
    await openTab(page, "employees");
    await shot(page, `long-${suffix}`, { fullPage: true });
    metrics[`long-${suffix}`] = await readCards(page);
    await ctx.close();
  });
}

await browser.close();
const TAG = process.env.TAG ? `-${process.env.TAG}` : "";
writeFileSync(
  `${OUT}/metrics${TAG}.json`,
  JSON.stringify({ at: new Date().toISOString(), base: BASE, metrics }, null, 2),
);
const bad = Object.entries(metrics).filter(
  ([, m]) => m?.error || (m?.overflowX ?? 0) > 0 || m?.clipped?.length || m?.layoutShift || m?.textChanged,
);
console.log("errors / overflow / clipped / shifts:", bad.length ? bad.map(([n]) => n) : "none");
