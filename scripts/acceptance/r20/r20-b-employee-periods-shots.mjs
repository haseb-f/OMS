#!/usr/bin/env node
/**
 * R20 §B — one local visual pass of the employee-performance tab (local build only, read-only):
 * company admin (ALL → "Employees"), company sales (OWN → "My performance") and the agent
 * manager (AGENT_ALL → "Employees"), Arabic + English, light + dark, desktop 1440 + phone 375;
 * hover / keyboard focus / reduced motion / touch on the employee card; a long-amount probe
 * (API answer rewritten in the browser only). Runs against the unmodified build (before) and
 * the R20 build (after) — the selectors cover both.
 *
 *   BASE=http://localhost:4811 OUT=specs/round20-corrections/evidence/b/after \
 *     PW_FILE=D:/Systems/OMS/tmp/r15-manual/.env node scripts/acceptance/r20/r20-b-employee-periods-shots.mjs
 *
 * Demo personas (*@oms-demo.local, demo DB oms_r20_b); the password is read at runtime
 * (MANUAL_PW) and never written out. Writes `<OUT>/metrics.json` and `<OUT>/figures.json`.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:4811").replace(/\/$/, "");
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("local build only");
const OUT = process.env.OUT ?? "specs/round20-corrections/evidence/b/after";
const STATES = process.env.STATES !== "0";
const PW = readFileSync(process.env.PW_FILE ?? "D:/Systems/OMS/tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)[1]
  .trim();
mkdirSync(OUT, { recursive: true });
const metrics = {};
const figures = {};
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

const VARIANTS = [
  // [suffix, locale, scheme, mobile]
  ["ar-light-1440", "ar", "light", false],
  ["en-light-1440", "en", "light", false],
  ["ar-dark-1440", "ar", "dark", false],
  ["en-dark-1440", "en", "dark", false],
  ["ar-light-375", "ar", "light", true],
  ["en-light-375", "en", "light", true],
  ["ar-dark-375", "ar", "dark", true],
  ["en-dark-375", "en", "dark", true],
];
const SCREENS = [
  // [name, persona, path, tab]
  ["admin", "admin@oms-demo.local", "/reports/sales", "employees"],
  ["sales", "sales@oms-demo.local", "/reports/sales", "own"],
  ["agent", "agent@oms-demo.local", "/agent/reports", "employees"],
];

async function context({
  locale = "ar",
  scheme = "light",
  mobile = false,
  reducedMotion = "no-preference",
  launcher = browser,
} = {}) {
  const ctx = await launcher.newContext({
    ...(mobile
      ? { ...devices["iPhone 13 mini"], viewport: { width: 375, height: 812 } }
      : { viewport: { width: 1440, height: 900 } }),
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
  // ONLY=admin,state-touch re-runs names starting with a key; a key starting with "-" matches the
  // end (ONLY=-375 = every phone shot).
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
  // The tabs appear once Live has answered with the scope.
  const trigger = page.locator(`[role="tab"][id$="-trigger-${value}"]`);
  await trigger.waitFor({ timeout: 20000 });
  await trigger.click();
  await settle(page);
  await page
    .waitForFunction(
      () => !document.querySelector('[aria-hidden="true"][data-slot="insight-card"]'),
      null,
      {
        timeout: 15000,
      },
    )
    .catch(() => {});
}

/** Employee cards (R20 frames, or the R19 per-employee cards before) + layout checks. */
const readTab = (page) =>
  page.evaluate(() => {
    const frames = [...document.querySelectorAll('[data-slot="insight-frame"]')];
    const cards = [
      ...document.querySelectorAll('[data-slot="insight-card"]:not([aria-hidden="true"])'),
    ];
    const clipped = [];
    for (const el of document.querySelectorAll(
      ':is([data-slot="insight-card"], [data-slot="insight-frame"]) :is([data-slot="insight-value"], [data-slot="report-amounts"] li, [data-slot="insight-label"], [data-slot="insight-frame-title"])',
    )) {
      if (el.scrollWidth > el.clientWidth + 1) clipped.push(el.textContent.trim().slice(0, 60));
    }
    const first = frames[0];
    const boxes = first ? [...first.querySelectorAll('[data-slot="insight-card"]')] : [];
    const rows = new Set(boxes.map((box) => box.offsetTop)).size;
    return {
      frames: frames.length,
      cards: cards.length,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      clipped,
      firstFrame: first
        ? {
            width: first.offsetWidth,
            boxes: boxes.length,
            rows,
            columns: boxes.length ? Math.ceil(boxes.length / rows) : 0,
            identities: boxes.map((box) => box.getAttribute("data-identity")),
            backdrop: boxes[0] ? getComputedStyle(boxes[0]).backdropFilter : null,
          }
        : null,
      text: (frames.length ? frames : cards).map((el) => el.innerText.replace(/\s+/g, " ").trim()),
    };
  });

const probe = (el) =>
  el.evaluate((node) => {
    const s = getComputedStyle(node);
    const icon = node.querySelector('[data-slot="insight-icon"] svg');
    const next = node.nextElementSibling ?? node.parentElement;
    return {
      slot: node.getAttribute("data-slot"),
      translate: s.translate,
      border: s.borderTopColor,
      shadow: s.boxShadow.slice(0, 160),
      outline: `${s.outlineStyle} ${s.outlineWidth}`,
      background: s.backgroundColor,
      icon: icon
        ? (() => {
            const cs = getComputedStyle(icon);
            return { translate: cs.translate, rotate: cs.rotate, scale: cs.scale };
          })()
        : null,
      text: node.innerText.replace(/\s+/g, " ").trim(),
      layout: {
        top: node.offsetTop,
        left: node.offsetLeft,
        width: node.offsetWidth,
        height: node.offsetHeight,
      },
      neighbour: next ? { top: next.offsetTop, left: next.offsetLeft } : null,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
const clip = (box, page) => {
  const { width, height } = page.viewportSize();
  const x = Math.max(0, box.x - 24);
  const y = Math.max(0, box.y - 24);
  return {
    x,
    y,
    width: Math.min(width - x, box.width + 48),
    height: Math.min(height - y, box.height + 48),
  };
};
const TARGET = '[data-slot="insight-frame"], [data-slot="insight-card"]:not([aria-hidden="true"])';

async function states(page, name, { focus }) {
  const target = page.locator(TARGET).first();
  if (!(await target.count())) return;
  await target.scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(350);
  const rest = await probe(target);
  // Hover the outer card's header (the identity row), then one inner period box.
  const header = page.locator('[data-slot="insight-frame-header"]').first();
  await ((await header.count()) ? header : target).hover();
  await page.waitForTimeout(450);
  const hover = await probe(target);
  const box = await target.boundingBox();
  await shot(page, `${name}-hover`, box ? { clip: clip(box, page) } : {});
  const inner = page.locator('[data-slot="insight-frame"] [data-slot="insight-card"]').first();
  let innerHover = null;
  if (await inner.count()) {
    await inner.hover();
    await page.waitForTimeout(450);
    innerHover = await probe(inner);
    await shot(page, `${name}-box-hover`, box ? { clip: clip(box, page) } : {});
  }
  const entry = {
    rest,
    hover,
    innerHover,
    layoutShift:
      JSON.stringify(rest.layout) !== JSON.stringify(hover.layout) ||
      JSON.stringify(rest.neighbour) !== JSON.stringify(hover.neighbour) ||
      rest.scrollHeight !== hover.scrollHeight,
    textChanged: rest.text !== hover.text,
  };
  if (focus) {
    await page.mouse.move(2, 2);
    await target.focus().catch(() => {});
    await page.keyboard.press("Shift");
    await page.waitForTimeout(450);
    entry.focus = await probe(target);
    entry.focused = await target.evaluate((node) => node === document.activeElement);
    await shot(page, `${name}-focus`, box ? { clip: clip(box, page) } : {});
  }
  metrics[name] = entry;
}

for (const [suffix, locale, scheme, mobile] of VARIANTS) {
  for (const [screen, persona, path, tab] of SCREENS) {
    await run(`${screen}-${suffix}`, async () => {
      const ctx = await context({ locale, scheme, mobile });
      const page = await ctx.newPage();
      await login(page, persona);
      await page.goto(`${BASE}${path}`);
      await settle(page);
      await openTab(page, tab);
      const name = `${screen}-${tab}-${suffix}`;
      await shot(page, name, { fullPage: true });
      const read = await readTab(page);
      figures[`${screen}-${locale}`] ??= read.text;
      metrics[name] = { ...read, text: undefined };
      await ctx.close();
    });
  }
}

if (STATES) {
  for (const [suffix, locale, scheme] of [
    ["ar-light", "ar", "light"],
    ["en-dark", "en", "dark"],
  ]) {
    await run(`state-${suffix}`, async () => {
      const ctx = await context({ locale, scheme });
      const page = await ctx.newPage();
      await login(page, "admin@oms-demo.local");
      await page.goto(`${BASE}/reports/sales`);
      await settle(page);
      await openTab(page, "employees");
      await states(page, `state-employee-${suffix}`, { focus: true });
      await ctx.close();
    });
  }

  await run("state-reduced-motion", async () => {
    const ctx = await context({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await login(page, "admin@oms-demo.local");
    await page.goto(`${BASE}/reports/sales`);
    await settle(page);
    await openTab(page, "employees");
    await states(page, "state-reduced-motion", { focus: true });
    await ctx.close();
  });

  await run("state-touch-375", async () => {
    // Headless Chromium keeps (hover: hover) under touch emulation: a browser whose Blink
    // settings report a touch-only device (hover: none, pointer: coarse).
    const touch = await chromium.launch({
      args: [
        "--blink-settings=primaryHoverType=1,availableHoverTypes=1,primaryPointerType=2,availablePointerTypes=2",
      ],
    });
    const ctx = await context({ mobile: true, launcher: touch });
    const page = await ctx.newPage();
    await login(page, "admin@oms-demo.local");
    await page.goto(`${BASE}/reports/sales`);
    await settle(page);
    await openTab(page, "employees");
    const target = page.locator(TARGET).first();
    const entry = { hoverNone: await page.evaluate(() => matchMedia("(hover: none)").matches) };
    entry.rest = (await target.count()) ? await probe(target) : null;
    await target.tap().catch(() => {});
    await page.waitForTimeout(400);
    entry.afterTap = (await target.count()) ? await probe(target) : null;
    metrics["state-touch-375"] = entry;
    await shot(page, "state-touch-375", { fullPage: true });
    await ctx.close();
    await touch.close();
  });

  // Long amounts: the answer is rewritten in the browser (1,234,567,890.00 in five currencies)
  // to prove no amount is truncated and nothing scrolls sideways.
  for (const [suffix, mobile] of [
    ["375", true],
    ["1440", false],
  ]) {
    await run(`long-amounts-${suffix}`, async () => {
      const ctx = await context({ mobile });
      const page = await ctx.newPage();
      await login(page, "admin@oms-demo.local");
      const long = (stats) => {
        stats.valid = 1234567;
        stats.orders = 1234999;
        stats.amounts = ["EGP", "SAR", "USD", "AED", "KWD"].map((currencyCode) => ({
          currencyCode,
          amount: 1234567890,
        }));
      };
      await page.route(/\/sales-reports\/(employee-periods|performance)/, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        for (const row of body.employees ?? []) {
          if (Array.isArray(row.periods)) row.periods.forEach(long);
          else long(row);
        }
        await route.fulfill({ response, json: body });
      });
      await page.goto(`${BASE}/reports/sales`);
      await settle(page);
      await openTab(page, "employees");
      await shot(page, `long-amounts-${suffix}`, { fullPage: true });
      const read = await readTab(page);
      metrics[`long-amounts-${suffix}`] = { ...read, text: undefined };
      await ctx.close();
    });
  }
}

await browser.close();
// TAG=phone writes metrics-phone.json / figures-phone.json (a partial re-run keeps the full files).
const TAG = process.env.TAG ? `-${process.env.TAG}` : "";
writeFileSync(`${OUT}/figures${TAG}.json`, JSON.stringify(figures, null, 2));
writeFileSync(
  `${OUT}/metrics${TAG}.json`,
  JSON.stringify({ at: new Date().toISOString(), base: BASE, metrics }, null, 2),
);
const shifts = Object.entries(metrics).filter(([, m]) => m?.layoutShift || m?.textChanged);
const overflow = Object.entries(metrics).filter(
  ([, m]) => (m?.overflowX ?? 0) > 0 || m?.clipped?.length,
);
console.log("layout shifts / text changes:", shifts.length ? shifts.map(([n]) => n) : "none");
console.log("overflow / clipped:", overflow.length ? overflow.map(([n]) => n) : "none");
