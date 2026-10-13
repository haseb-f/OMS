#!/usr/bin/env node
/**
 * R19 §C — one local visual pass of the sales-report cards (local build only, read-only):
 * every sales-report tab for the company (admin = ALL, sales = OWN) and the agent portal
 * (agent), Arabic + English, desktop 1440 + mobile 375, light + one dark; hover / focus /
 * reduced motion / touch states; a long-amount probe (API answer rewritten in the browser only)
 * at 375 and 1440; and the card text of every tab for the value-unchanged comparison.
 *
 *   BASE=http://localhost:4721 OUT=specs/round19-improvements/evidence/c/after \
 *     PW_FILE=D:/Systems/OMS/tmp/r15-manual/.env node scripts/acceptance/r19/r19-c-sales-cards-shots.mjs
 *
 * Demo personas (*@oms-demo.local, demo DB oms_r19_c); the password is read at runtime
 * (MANUAL_PW) and never written out. Writes `<OUT>/figures.json` and `<OUT>/metrics.json`.
 * Compare two runs with scripts/acceptance/r19/r19-c-compare-figures.mjs.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:4721").replace(/\/$/, "");
const OUT = process.env.OUT ?? "specs/round19-improvements/evidence/c/after";
const STATES = process.env.STATES !== "0";
const PW = readFileSync(process.env.PW_FILE ?? "tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)[1]
  .trim();
mkdirSync(OUT, { recursive: true });
const figures = {};
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

const VARIANTS = [
  // [suffix, locale, scheme, mobile]
  ["ar-light-1440", "ar", "light", false],
  ["en-light-1440", "en", "light", false],
  ["ar-dark-1440", "ar", "dark", false],
  ["ar-light-375", "ar", "light", true],
  ["en-light-375", "en", "light", true],
];

async function context({
  locale = "ar",
  scheme = "light",
  mobile = false,
  reducedMotion = "no-preference",
} = {}) {
  const ctx = await browser.newContext({
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
  // ONLY=touch-375,states re-runs a subset (the JSON files then hold that subset only).
  if (process.env.ONLY && !process.env.ONLY.split(",").includes(name)) return;
  try {
    await fn();
    console.log("done", name);
  } catch (error) {
    console.log("FAILED", name, String(error?.message ?? error).slice(0, 240));
    metrics[name] = { error: String(error?.message ?? error).slice(0, 240) };
  }
};

/** The tab values the view offers (Radix trigger ids end in `-trigger-<value>`). */
const tabValues = (page) =>
  page
    .locator('[role="tab"]')
    .evaluateAll((els) => els.map((el) => el.id.replace(/^.*-trigger-/, "")));

async function openTab(page, value) {
  await page.locator(`[role="tab"][id$="-trigger-${value}"]`).click();
  await settle(page);
  // Wait until the skeletons are gone (no figure is ever faked while loading).
  await page
    .waitForFunction(
      () => !document.querySelector('[data-slot="insight-card"][aria-hidden="true"]'),
      null,
      {
        timeout: 15000,
      },
    )
    .catch(() => {});
}

/** Card text (whitespace collapsed) + overflow / truncation checks of the current tab. */
const readCards = (page) =>
  page.evaluate(() => {
    const cards = [
      ...document.querySelectorAll('[data-slot="insight-card"]:not([aria-hidden="true"])'),
    ];
    const clipped = [];
    for (const el of document.querySelectorAll(
      '[data-slot="insight-card"] :is([data-slot="insight-value"], [data-slot="report-amounts"] li, [data-slot="insight-label"])',
    )) {
      if (el.scrollWidth > el.clientWidth + 1) clipped.push(el.textContent.trim().slice(0, 60));
    }
    const first = cards[0];
    const s = first ? getComputedStyle(first) : null;
    return {
      cards: cards.map((el) => el.innerText.replace(/\s+/g, " ").trim()),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      clipped,
      sample: first
        ? {
            size: first.getAttribute("data-size"),
            width: first.offsetWidth,
            height: first.offsetHeight,
            padding: `${s.paddingBlockStart} ${s.paddingInlineStart}`,
            figure: getComputedStyle(first.querySelector('[data-slot="insight-value"]')).fontSize,
            title: getComputedStyle(first.querySelector('[data-slot="insight-label"]')).fontSize,
            backdrop: s.backdropFilter || s.webkitBackdropFilter,
            background: s.backgroundColor,
          }
        : null,
    };
  });

/** Card state + layout probe: the card's computed state and whether anything in the flow moved. */
const probe = (card) =>
  card.evaluate((el) => {
    const s = getComputedStyle(el);
    const next = el.nextElementSibling ?? el.parentElement;
    return {
      tag: el.tagName,
      interactive: el.hasAttribute("data-interactive"),
      tone: el.getAttribute("data-tone"),
      // R19 §C2: identity, the icon glyph's motion and the figure colour.
      identity: el.getAttribute("data-identity"),
      icon: (() => {
        const svg = el.querySelector('[data-slot="insight-icon"] svg');
        if (!svg) return null;
        const cs = getComputedStyle(svg);
        return { translate: cs.translate, rotate: cs.rotate, scale: cs.scale };
      })(),
      figureColor: (() => {
        const value = el.querySelector('[data-slot="insight-value"]');
        return value ? getComputedStyle(value).color : null;
      })(),
      translate: s.translate,
      backdrop: s.backdropFilter || s.webkitBackdropFilter,
      background: s.backgroundColor,
      border: s.borderTopColor,
      shadow: s.boxShadow.slice(0, 160),
      outline: `${s.outlineStyle} ${s.outlineWidth}`,
      duration: s.transitionDuration,
      cursor: s.cursor,
      text: el.innerText.replace(/\s+/g, " ").trim(),
      layout: {
        top: el.offsetTop,
        left: el.offsetLeft,
        width: el.offsetWidth,
        height: el.offsetHeight,
      },
      neighbour: next ? { top: next.offsetTop, left: next.offsetLeft } : null,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
const pad = (box, page) => {
  const { width, height } = page.viewportSize();
  const x = Math.max(0, box.x - 120);
  const y = Math.max(0, box.y - 50);
  return {
    x,
    y,
    width: Math.min(width - x, box.width + 240),
    height: Math.min(height - y, box.height + 100),
  };
};
async function hoverFocus(page, name, selector, { focus }) {
  const card = page.locator(selector).first();
  if (!(await card.count())) return;
  await card.scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  await page.waitForTimeout(350);
  const rest = await probe(card);
  await card.hover();
  await page.waitForTimeout(450);
  const hover = await probe(card);
  const box = await card.boundingBox();
  await shot(page, `${name}-hover`, box ? { clip: pad(box, page) } : {});
  const entry = {
    rest,
    hover,
    layoutShift:
      JSON.stringify(rest.layout) !== JSON.stringify(hover.layout) ||
      JSON.stringify(rest.neighbour) !== JSON.stringify(hover.neighbour) ||
      rest.scrollHeight !== hover.scrollHeight,
    textChanged: rest.text !== hover.text,
  };
  if (focus) {
    await page.mouse.move(2, 2);
    await card.focus();
    // Keyboard modality for :focus-visible.
    await page.keyboard.press("Shift");
    await page.waitForTimeout(450);
    entry.focus = await probe(card);
    await shot(page, `${name}-focus`, box ? { clip: pad(box, page) } : {});
  }
  metrics[name] = entry;
}

const SCREENS = [
  // [name, persona, path]
  ["company", "admin@oms-demo.local", "/reports/sales"],
  ["company-own", "sales@oms-demo.local", "/reports/sales"],
  ["agent", "agent@oms-demo.local", "/agent/reports"],
];

for (const [suffix, locale, scheme, mobile] of VARIANTS) {
  for (const [screen, persona, path] of SCREENS) {
    // The own scope is covered in ar + en desktop and ar mobile (its cards are the same family).
    if (screen === "company-own" && suffix === "ar-dark-1440") continue;
    await run(`${screen}-${suffix}`, async () => {
      const ctx = await context({ locale, scheme, mobile });
      const page = await ctx.newPage();
      await login(page, persona);
      await page.goto(`${BASE}${path}`);
      await settle(page);
      for (const tab of await tabValues(page)) {
        await openTab(page, tab);
        const name = `${screen}-${tab}-${suffix}`;
        await shot(page, name, { fullPage: true });
        const read = await readCards(page);
        figures[`${screen}-${tab}-${locale}`] ??= read.cards;
        metrics[name] = {
          cards: read.cards.length,
          overflowX: read.overflowX,
          clipped: read.clipped,
          sample: read.sample,
        };
      }
      await ctx.close();
    });
  }
}

if (STATES) {
  await run("states", async () => {
    for (const [suffix, locale, scheme] of [
      ["ar-light", "ar", "light"],
      ["en-dark", "en", "dark"],
    ]) {
      const ctx = await context({ locale, scheme });
      const page = await ctx.newPage();
      await login(page, "admin@oms-demo.local");
      await page.goto(`${BASE}/reports/sales`);
      await settle(page);
      await openTab(page, "live");
      await hoverFocus(
        page,
        `state-live-${suffix}`,
        '[data-slot="insight-card"][data-interactive]:not([aria-pressed="true"])',
        {
          focus: true,
        },
      );
      await openTab(page, "employees");
      await hoverFocus(
        page,
        `state-employee-${suffix}`,
        '[data-slot="insight-card"]:not([aria-hidden="true"])',
        {
          focus: false,
        },
      );
      await openTab(page, "paymentMix");
      await hoverFocus(
        page,
        `state-payment-${suffix}`,
        '[data-slot="insight-card"]:not([aria-hidden="true"])',
        {
          focus: false,
        },
      );
      await ctx.close();
    }
  });

  await run("reduced-motion", async () => {
    const ctx = await context({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await login(page, "admin@oms-demo.local");
    await page.goto(`${BASE}/reports/sales`);
    await settle(page);
    await hoverFocus(page, "state-reduced-motion", '[data-slot="insight-card"][data-interactive]', {
      focus: false,
    });
    await ctx.close();
  });

  await run("touch-375", async () => {
    // Headless Chromium keeps (hover: hover) even with touch emulation: a second browser whose
    // Blink settings report a touch-only device (hover: none, pointer: coarse).
    const touch = await chromium.launch({
      args: [
        "--blink-settings=primaryHoverType=1,availableHoverTypes=1,primaryPointerType=2,availablePointerTypes=2",
      ],
    });
    const ctx = await touch.newContext({
      ...devices["iPhone 13 mini"],
      viewport: { width: 375, height: 812 },
    });
    await ctx.addInitScript(() => localStorage.setItem("oms.locale", JSON.stringify("ar")));
    const page = await ctx.newPage();
    await login(page, "admin@oms-demo.local");
    await page.goto(`${BASE}/reports/sales`);
    await settle(page);
    const card = page.locator('[data-slot="insight-card"][data-interactive]').first();
    const informational = page
      .locator('[data-slot="insight-card"]:not([data-interactive])')
      .first();
    metrics["state-touch-375"] = {
      hoverNone: await page.evaluate(() => matchMedia("(hover: none)").matches),
      actionable: (await card.count()) ? await probe(card) : null,
    };
    await card.tap().catch(() => {});
    await page.waitForTimeout(400);
    metrics["state-touch-375"].afterTap = await probe(card);
    await shot(page, "state-touch-375", { fullPage: true });
    await openTab(page, "employees");
    metrics["state-touch-375"].informational = (await informational.count())
      ? await probe(informational)
      : null;
    await ctx.close();
    await touch.close();
  });

  await run("reduced-transparency", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
    });
    await login(page, "admin@oms-demo.local");
    await page.goto(`${BASE}/reports/sales`);
    await settle(page);
    const card = page.locator('[data-slot="insight-card"]').first();
    metrics["state-reduced-transparency"] = {
      matches: await page.evaluate(
        () => matchMedia("(prefers-reduced-transparency: reduce)").matches,
      ),
      card: await probe(card),
    };
    await ctx.close();
  });

  // Long amounts: the live answer is rewritten in the browser (1,234,567,890.00 in five
  // currencies) to prove no amount is truncated and nothing scrolls sideways.
  for (const [suffix, mobile] of [
    ["375", true],
    ["1440", false],
  ]) {
    await run(`long-amounts-${suffix}`, async () => {
      const ctx = await context({ mobile });
      const page = await ctx.newPage();
      await login(page, "admin@oms-demo.local");
      await page.route(/\/sales-reports\/live/, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        for (const entry of body.periods ?? []) {
          entry.valid = 1234567;
          entry.orders = 1234999;
          entry.amounts = ["EGP", "SAR", "USD", "AED", "KWD"].map((currencyCode) => ({
            currencyCode,
            amount: 1234567890,
          }));
        }
        await route.fulfill({ response, json: body });
      });
      await page.goto(`${BASE}/reports/sales`);
      await settle(page);
      await shot(page, `long-amounts-${suffix}`, { fullPage: true });
      const read = await readCards(page);
      metrics[`long-amounts-${suffix}`] = {
        overflowX: read.overflowX,
        clipped: read.clipped,
        sample: read.sample,
      };
      await ctx.close();
    });
  }
}

await browser.close();
writeFileSync(`${OUT}/figures.json`, JSON.stringify(figures, null, 2));
writeFileSync(
  `${OUT}/metrics.json`,
  JSON.stringify({ at: new Date().toISOString(), base: BASE, metrics }, null, 2),
);
const shifts = Object.entries(metrics).filter(([, m]) => m?.layoutShift || m?.textChanged);
const overflow = Object.entries(metrics).filter(
  ([, m]) => (m?.overflowX ?? 0) > 0 || m?.clipped?.length,
);
console.log("layout shifts / text changes:", shifts.length ? shifts.map(([n]) => n) : "none");
console.log("overflow / clipped:", overflow.length ? overflow.map(([n]) => n) : "none");
