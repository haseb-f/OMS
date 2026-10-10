/* eslint-disable no-console */
/**
 * Captures every screenshot of the manual from the running demo system.
 *
 *   node docs/user-manual/build/shots.mjs            all shots
 *   ONLY=03-06,05-03 node docs/user-manual/build/shots.mjs   selected ids (prefix match)
 *
 * For each shot: screenshots/raw/<id>.png (clean) and screenshots/annotated/<id>.png (numbered
 * callouts + highlight boxes injected into the page). Both are optimised with sharp afterwards
 * (optimize-images.mjs). Password inputs are blanked before every capture.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ROOT, one } from "./lib/api.mjs";
import { launch, newPersonaPage, loginUi, goto, settle, maskSecrets, drawCallouts, clearCallouts, WEB } from "./lib/browser.mjs";
import { SHOTS } from "./shot-list.mjs";

const OUT = `${ROOT}/docs/user-manual/screenshots`;
mkdirSync(`${OUT}/raw`, { recursive: true });
mkdirSync(`${OUT}/annotated`, { recursive: true });
const ONLY = process.env.ONLY ? process.env.ONLY.split(",").map((s) => s.trim()) : null;
const list = SHOTS.filter((s) => !ONLY || ONLY.some((o) => s.id.startsWith(o)));

const browser = await launch();
const pages = {};
async function pageFor(shot) {
  const key = `${shot.persona ?? "anon"}|${shot.mobile ? "m" : "d"}`;
  if (!pages[key]) {
    const { context, page } = await newPersonaPage(browser, shot.mobile ? { width: 390, height: 844, mobile: true } : { width: 1440, height: 900 });
    if (shot.persona) await loginUi(page, `${shot.persona}@oms-demo.local`);
    pages[key] = { context, page };
  }
  return pages[key].page;
}

async function setSidebar(page, collapsed) {
  const state = await page.evaluate(() => document.querySelector("[data-slot=sidebar][data-state]")?.getAttribute("data-state") ?? null);
  if (!state) return;
  if ((collapsed && state === "expanded") || (!collapsed && state === "collapsed")) {
    await page.locator("[data-sidebar=trigger]").first().click();
    await page.waitForTimeout(450);
  }
}

/** Windows: the previous file can be briefly held by the antivirus scan — retry the write. */
async function screenshotWithRetry(page, path, clip, attempts = 8) {
  for (let i = 1; ; i += 1) {
    try {
      return await page.screenshot({ path, clip: clip ?? undefined });
    } catch (error) {
      if (i >= attempts || !/UNKNOWN|EBUSY|EPERM/.test(String(error?.message))) throw error;
      await page.waitForTimeout(400 * i);
    }
  }
}

const report = [];
for (const shot of list) {
  const page = await pageFor(shot);
  const width = shot.mobile ? 390 : shot.width ?? (shot.sidebar ? 1440 : 1200);
  const height = shot.mobile ? 844 : shot.height ?? 900;
  await page.setViewportSize({ width, height });
  const warnings = [];
  try {
    if (shot.path) await goto(page, shot.path);
    if (!shot.mobile) await setSidebar(page, shot.sidebar !== true);
    if (shot.before) await shot.before(page, { settle, one, WEB });
    await settle(page, 500);
    await maskSecrets(page);
    // Clip region.
    let clip = null;
    if (shot.clip) {
      const loc = typeof shot.clip === "function" ? shot.clip(page) : page.locator(shot.clip).first();
      const box = await loc.boundingBox();
      if (box) {
        const pad = shot.clipPad ?? 8;
        if (shot.trim !== false) {
          // Trim empty space below the content of a tall container (e.g. <main>).
          const bottom = await loc.evaluate((root) => {
            let max = 0;
            for (const el of root.querySelectorAll("*")) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.height > 0 && r.height < root.getBoundingClientRect().height * 0.85) max = Math.max(max, r.bottom);
            }
            return max;
          });
          if (bottom > box.y && bottom < box.y + box.height) box.height = bottom - box.y + 12;
        }
        clip = {
          x: Math.max(0, box.x - pad),
          y: Math.max(0, box.y - pad),
          width: Math.min(width - Math.max(0, box.x - pad), box.width + pad * 2),
          height: Math.min(height - Math.max(0, box.y - pad), box.height + pad * 2),
        };
      } else warnings.push("clip target not found");
    }
    if (shot.clipRect) clip = { ...shot.clipRect, width: Math.min(shot.clipRect.width, width - 50) };
    await screenshotWithRetry(page, `${OUT}/raw/${shot.id}.png`, clip);
    const boxes = [];
    for (const [n, fn, side] of shot.callouts ?? []) {
      try {
        const loc = fn(page).first();
        await loc.waitFor({ state: "visible", timeout: 2500 });
        const box = await loc.boundingBox();
        if (box) boxes.push({ n, box, side });
        else warnings.push(`callout ${n}: no box`);
      } catch {
        warnings.push(`callout ${n}: not found`);
      }
    }
    await drawCallouts(page, boxes);
    await screenshotWithRetry(page, `${OUT}/annotated/${shot.id}.png`, clip);
    await clearCallouts(page);
    if (shot.after) await shot.after(page);
  } catch (e) {
    warnings.push(`ERROR ${e.message.split("\n")[0]}`);
    try {
      await page.keyboard.press("Escape");
    } catch {}
  }
  report.push({ id: shot.id, warnings });
  console.log(`${warnings.length ? "WARN" : "ok  "} ${shot.id}${warnings.length ? "  " + warnings.join(" | ") : ""}`);
}
writeFileSync(`${ROOT}/tmp/r15-manual/shots-report.json`, JSON.stringify(report, null, 2));
await browser.close();
