#!/usr/bin/env node
/**
 * R18 §C — one local visual pass of the shared report cards (local build only, read-only):
 * representative screens in ar (RTL) and en (LTR), light and dark, desktop and 375 px, the hover
 * rise / focus ring / reduced motion / touch resting state, and layout-shift measurements.
 *
 *   BASE=http://localhost:3011 PW_FILE=D:/Systems/OMS/tmp/r15-manual/.env \
 *     node scripts/acceptance/r18/r18-c-card-shots.mjs
 *
 * Demo personas (*@oms-demo.local, R15 manual clone → oms_r18_c); the password is read at runtime
 * (MANUAL_PW) and never written out. Output: specs/round18-corrections/evidence/c/after/.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:3011").replace(/\/$/, "");
const OUT = process.env.OUT ?? "specs/round18-corrections/evidence/c/after";
const PW = readFileSync(process.env.PW_FILE ?? "tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)[1]
  .trim();
const AGENT_ID = process.env.AGENT_ID ?? "b104b04d-e11c-41cd-b732-5e746025956a";
mkdirSync(OUT, { recursive: true });
const metrics = {};
const browser = await chromium.launch();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** PNG writes on this machine can fail with EUNKNOWN (AV locks) — retry with backoff. */
async function shot(page, name, options = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.screenshot({ path: `${OUT}/${name}.png`, ...options });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await sleep(400 * 2 ** attempt);
    }
  }
}
async function context({
  locale = "ar",
  scheme = "light",
  device = null,
  reducedMotion = "no-preference",
} = {}) {
  const ctx = await browser.newContext({
    ...(device ?? { viewport: { width: 1440, height: 900 } }),
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
  try {
    await fn();
    console.log("done", name);
  } catch (error) {
    console.log("FAILED", name, String(error?.message ?? error).slice(0, 240));
    metrics[name] = { error: String(error?.message ?? error).slice(0, 240) };
  }
};

/** Card state + layout probe: the card's computed state and whether anything in the flow moved. */
const probe = (card) =>
  card.evaluate((el) => {
    const s = getComputedStyle(el);
    const next = el.nextElementSibling ?? el.parentElement;
    return {
      tag: el.tagName,
      interactive: el.hasAttribute("data-interactive"),
      tone: el.getAttribute("data-tone"),
      translate: s.translate,
      transform: s.transform,
      backdrop: s.backdropFilter || s.webkitBackdropFilter,
      background: s.backgroundColor,
      border: s.borderTopColor,
      shadow: s.boxShadow.slice(0, 120),
      outline: `${s.outlineStyle} ${s.outlineWidth}`,
      duration: s.transitionDuration,
      cursor: s.cursor,
      // offset* ignore transforms/translate: equal before and after hover → no layout shift.
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

async function cardStates(page, name, { focus = true } = {}) {
  const cards = page.locator('[data-slot="insight-card"]:not([aria-hidden="true"])');
  const count = await cards.count();
  metrics[name] = { cards: count };
  if (!count) return;
  const actionable = page.locator('[data-slot="insight-card"][data-interactive]').first();
  const informational = page
    .locator('[data-slot="insight-card"]:not([data-interactive]):not([aria-hidden="true"])')
    .first();
  for (const [kind, card] of [
    ["actionable", actionable],
    ["informational", informational],
  ]) {
    if (!(await card.count())) continue;
    await card.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    const rest = await probe(card);
    await card.hover();
    await page.waitForTimeout(400);
    const hover = await probe(card);
    metrics[name][kind] = {
      rest,
      hover,
      layoutShift:
        JSON.stringify(rest.layout) !== JSON.stringify(hover.layout) ||
        JSON.stringify(rest.neighbour) !== JSON.stringify(hover.neighbour) ||
        rest.scrollHeight !== hover.scrollHeight,
    };
    if (kind === "actionable") {
      const box = await card.boundingBox();
      await shot(page, `${name}-hover`, box ? { clip: pad(box, page) } : {});
      if (focus) {
        await page.mouse.move(2, 2);
        await page.keyboard.press("Shift+Tab");
        await card.focus();
        await page.waitForTimeout(400);
        metrics[name].focus = await probe(card);
        await shot(page, `${name}-focus`, box ? { clip: pad(box, page) } : {});
      }
    }
  }
}
const pad = (box, page) => {
  const { width, height } = page.viewportSize();
  const x = Math.max(0, box.x - 160);
  const y = Math.max(0, box.y - 60);
  return {
    x,
    y,
    width: Math.min(width - x, box.width + 320),
    height: Math.min(height - y, box.height + 120),
  };
};

const SCREENS = [
  // [file name, persona, path]
  ["agents-overview", "admin@oms-demo.local", "/agents/overview"],
  ["agent-statement-admin", "admin@oms-demo.local", `/agents/${AGENT_ID}?tab=statement`],
  ["investors", "admin@oms-demo.local", "/investors"],
  ["partners", "admin@oms-demo.local", "/company-partners"],
  ["dashboard", "admin@oms-demo.local", "/dashboard"],
  ["sales-reports", "admin@oms-demo.local", "/reports/sales"],
  ["inventory-integrity", "admin@oms-demo.local", "/inventory/integrity"],
];

await run("company-ar-light", async () => {
  const ctx = await context();
  const page = await ctx.newPage();
  await login(page, "admin@oms-demo.local");
  for (const [name, , path] of SCREENS) {
    await page.goto(`${BASE}${path}`);
    await settle(page);
    await shot(page, name);
    await cardStates(page, name);
  }
  await ctx.close();
});

await run("agent-portal", async () => {
  for (const [suffix, locale, scheme] of [
    ["ar-light", "ar", "light"],
    ["en-dark", "en", "dark"],
  ]) {
    const ctx = await context({ locale, scheme });
    const page = await ctx.newPage();
    await login(page, "agent@oms-demo.local");
    for (const path of ["/agent/dashboard", "/agent/statement", "/agent/commission"]) {
      const name = `agent${path.replace(/\//g, "-").replace("-agent", "")}-${suffix}`;
      await page.goto(`${BASE}${path}`);
      await settle(page);
      await shot(page, name);
      await cardStates(page, name, { focus: suffix === "ar-light" });
    }
    await ctx.close();
  }
});

await run("partner-portal", async () => {
  const ctx = await context();
  const page = await ctx.newPage();
  await login(page, "partner@oms-demo.local");
  await page.goto(`${BASE}/partner/overview`);
  await settle(page);
  await shot(page, "partner-overview");
  await cardStates(page, "partner-overview");
  await ctx.close();
});

await run("company-en-dark", async () => {
  const ctx = await context({ locale: "en", scheme: "dark" });
  const page = await ctx.newPage();
  await login(page, "admin@oms-demo.local");
  for (const [name, path] of [
    ["agents-overview-en-dark", "/agents/overview"],
    ["dashboard-en-dark", "/dashboard"],
  ]) {
    await page.goto(`${BASE}${path}`);
    await settle(page);
    await shot(page, name);
    await cardStates(page, name, { focus: false });
  }
  await ctx.close();
});

await run("reduced-motion", async () => {
  const ctx = await context({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await login(page, "admin@oms-demo.local");
  await page.goto(`${BASE}/agents/overview`);
  await settle(page);
  await cardStates(page, "reduced-motion", { focus: false });
  await ctx.close();
});

await run("touch-375", async () => {
  const ctx = await context({
    device: { ...devices["iPhone 13 mini"], viewport: { width: 375, height: 812 } },
  });
  const page = await ctx.newPage();
  await login(page, "admin@oms-demo.local");
  for (const [name, path] of [
    ["agents-overview-375", "/agents/overview"],
    ["dashboard-375", "/dashboard"],
  ]) {
    await page.goto(`${BASE}${path}`);
    await settle(page);
    await shot(page, name, { fullPage: true });
    const card = page.locator('[data-slot="insight-card"]').first();
    metrics[name] = {
      overflowX: await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
      actionable:
        (await page.locator('[data-slot="insight-card"][data-interactive]').count()) > 0
          ? await probe(page.locator('[data-slot="insight-card"][data-interactive]').first())
          : null,
      first: (await card.count()) ? await probe(card) : null,
    };
  }
  await ctx.close();
});

await browser.close();
writeFileSync(
  `${OUT}/metrics.json`,
  JSON.stringify({ at: new Date().toISOString(), base: BASE, metrics }, null, 2),
);
const shifts = Object.entries(metrics).flatMap(([name, m]) =>
  ["actionable", "informational"].filter((k) => m?.[k]?.layoutShift).map((k) => `${name}:${k}`),
);
console.log("layout shifts:", shifts.length ? shifts : "none");
