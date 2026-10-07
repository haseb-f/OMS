/* eslint-disable no-console */
/**
 * Playwright helpers for the manual screenshots.
 *  - The web build has its API URL baked as http://localhost:3005; every request to it is forwarded
 *    to the manual's own API (default http://localhost:3205) so the lead's servers are never touched.
 *  - Annotations: numbered badges + highlight boxes injected into the page right before the shot.
 *  - Password inputs are always blanked/masked before a screenshot.
 */
import { chromium } from "playwright";
import { PW, API } from "./api.mjs";

export const WEB = process.env.WEB ?? "http://localhost:3201";
const BAKED_API = "http://localhost:3005";

export async function launch() {
  return chromium.launch({ headless: true });
}

export async function newPersonaPage(browser, { width = 1440, height = 900, mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: "ar-EG",
    colorScheme: "light",
    timezoneId: "Africa/Cairo",
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  await context.route(`${BAKED_API}/**`, async (route) => {
    const req = route.request();
    const url = req.url().replace(BAKED_API, API);
    try {
      const resp = await route.fetch({ url });
      await route.fulfill({ response: resp });
    } catch (e) {
      await route.abort();
    }
  });
  const page = await context.newPage();
  return { context, page };
}

export async function loginUi(page, email) {
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await settle(page);
}

export async function settle(page, ms = 600) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch {
    /* long-polling pages */
  }
  await page.waitForTimeout(ms);
}

export async function goto(page, path) {
  await page.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded" });
  await settle(page, 900);
}

/** Blank every password field and hide toasts' timers from the shot. */
export async function maskSecrets(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('input[type="password"]')) {
      el.value = "";
      el.setAttribute("placeholder", "••••••••");
    }
  });
}

/**
 * callouts: [{ n, box: {x,y,width,height} , side?: "start"|"end"|"top"|"bottom" }]
 * Boxes are viewport coordinates (Playwright boundingBox()).
 */
export async function drawCallouts(page, callouts) {
  await page.evaluate((list) => {
    document.querySelectorAll("[data-manual-callout]").forEach((n) => n.remove());
    const sx = window.scrollX;
    const sy = window.scrollY;
    for (const c of list) {
      const pad = 4;
      const b = document.createElement("div");
      b.setAttribute("data-manual-callout", "");
      Object.assign(b.style, {
        position: "absolute",
        left: `${c.box.x + sx - pad}px`,
        top: `${c.box.y + sy - pad}px`,
        width: `${c.box.width + pad * 2}px`,
        height: `${c.box.height + pad * 2}px`,
        border: "2.5px solid #E8590C",
        borderRadius: "6px",
        boxShadow: "0 0 0 3px rgba(232,89,12,0.18)",
        zIndex: 2147483646,
        pointerEvents: "none",
      });
      document.body.appendChild(b);
      const badge = document.createElement("div");
      badge.setAttribute("data-manual-callout", "");
      badge.textContent = String(c.n);
      const size = 24;
      // Default: top-left corner (RTL end side) so the badge never sits on an Arabic label's first words.
      let left = c.box.x + sx - size / 2 - pad;
      let top = c.box.y + sy - size / 2 - pad;
      if (c.side === "right") left = c.box.x + sx + c.box.width - size / 2;
      if (c.side === "below") {
        left = c.box.x + sx + c.box.width / 2 - size / 2;
        top = c.box.y + sy + c.box.height + pad + 2;
      }
      if (c.side === "inside") {
        left = c.box.x + sx + c.box.width - size - 2;
        top = c.box.y + sy + 2;
      }
      left = Math.max(2, Math.min(left, document.documentElement.scrollWidth - size - 2));
      top = Math.max(2, top);
      Object.assign(badge.style, {
        position: "absolute",
        left: `${left}px`,
        top: `${top}px`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "50%",
        background: "#E8590C",
        color: "#fff",
        font: "700 13px/20px Arial, sans-serif",
        textAlign: "center",
        boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
        border: "2px solid #fff",
        zIndex: 2147483647,
        pointerEvents: "none",
        direction: "ltr",
      });
      document.body.appendChild(badge);
    }
  }, callouts);
}

export async function clearCallouts(page) {
  await page.evaluate(() => document.querySelectorAll("[data-manual-callout]").forEach((n) => n.remove()));
}
