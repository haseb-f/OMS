#!/usr/bin/env node
/**
 * R18 §C — read-only login-field check (no sign-in, no writes): the sign-in fields and the submit
 * button are 44 px with 16 px text, the 40 px reveal/hide button fits inside the password field and
 * is vertically centred, and no copy action exists. Works against a local build or Production.
 *
 *   BASE=https://oms.haseb.org node scripts/acceptance/r18/r18-c-login-check.mjs
 *   BASE=http://localhost:3011 OUT=specs/round18-corrections/evidence/c/login-check.json node …
 *
 * Supersedes the R17 46 px assertion (scripts/acceptance/r17/r17-prod-check.mjs, kept as R17 evidence).
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BASE = (process.env.BASE ?? "https://oms.haseb.org").replace(/\/$/, "");
const OUT = process.env.OUT;
/** Optional screenshot directory (local review only). */
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const EXPECTED = 44;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};

const browser = await chromium.launch();
for (const [label, options] of [
  ["desktop 1440", { viewport: { width: 1440, height: 900 } }],
  ["mobile 375", { ...devices["iPhone 13 mini"], viewport: { width: 375, height: 812 } }],
]) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const m = await page.evaluate(() => {
    const box = (el) => el && el.getBoundingClientRect();
    const email = document.querySelector('input[name="email"]');
    const password = document.querySelector('input[name="password"]');
    const submit = document.querySelector('button[type="submit"]');
    const toggle = password?.closest('[data-slot="password-input"]')?.querySelector("button");
    const p = box(password);
    const t = box(toggle);
    return {
      email: box(email)?.height,
      password: p?.height,
      submit: box(submit)?.height,
      font: email && getComputedStyle(email).fontSize,
      toggle: t && { width: t.width, height: t.height },
      toggleInside: !!(p && t && t.top >= p.top - 0.5 && t.bottom <= p.bottom + 0.5),
      toggleCentreOffset: p && t ? Math.abs(t.top + t.height / 2 - (p.top + p.height / 2)) : null,
    };
  });
  check(
    `${label}: email + password fields ${EXPECTED} px`,
    Math.round(m.email) === EXPECTED && Math.round(m.password) === EXPECTED,
    `${m.email} / ${m.password}`,
  );
  check(`${label}: submit ${EXPECTED} px`, Math.round(m.submit) === EXPECTED, m.submit);
  check(`${label}: 16 px input text (no iOS zoom)`, m.font === "16px", m.font);
  check(
    `${label}: reveal/hide button fits and is centred`,
    m.toggleInside && m.toggleCentreOffset !== null && m.toggleCentreOffset <= 1,
    JSON.stringify({ toggle: m.toggle, offset: m.toggleCentreOffset }),
  );
  check(
    `${label}: no copy action on the password`,
    (await page.getByRole("button", { name: /نسخ|Copy/ }).count()) === 0,
  );
  if (SHOTS) {
    // Focused password field (focus ring + reveal/hide button) — PNG writes may hit EUNKNOWN; retry.
    await page.locator('input[name="password"]').focus();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await page.screenshot({ path: `${SHOTS}/login-${label.split(" ")[1]}.png` });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  }
  await context.close();
}
await browser.close();
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2),
  );
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
