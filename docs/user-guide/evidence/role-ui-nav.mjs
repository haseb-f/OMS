/**
 * Role UI nav visibility probe against production.
 * Usage: BASE=https://oms.haseb.org PW=... node docs/user-guide/evidence/role-ui-nav.mjs
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "https://oms.haseb.org").replace(/\/$/, "");
const PW = process.env.PW ?? process.env.QA_PASSWORD ?? "";
if (!PW) throw new Error("PW / QA_PASSWORD required");

const accounts = [
  {
    email: "qa-shipping@oms.haseb.org",
    expectNav: ["الشحن"],
    denyNav: ["المالية", "الإعدادات"],
  },
  {
    email: "qa-finance@oms.haseb.org",
    expectNav: ["المالية"],
    denyNav: [],
  },
  {
    email: "qa-sales-agent@oms.haseb.org",
    expectNav: ["المبيعات", "إدارة علاقات العملاء"],
    denyNav: ["الإعدادات"],
  },
];

const browser = await chromium.launch({ headless: true });
const out = [];
try {
  for (const a of accounts) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"], input[name="email"]').first().fill(a.email);
    await page.locator('input[type="password"]').first().fill(PW);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const navBtn = page.getByRole("button", { name: /فتح التنقل|فتح القائمة/i });
    if ((await navBtn.count()) > 0) await navBtn.first().click().catch(() => {});
    await page.waitForTimeout(600);
    const text = await page.locator("body").innerText();
    const slug = a.email.split("@")[0];
    const shot = `docs/user-guide/screenshots/role-${slug}-nav-ar.png`;
    await page.screenshot({ path: shot, fullPage: false });
    const row = {
      email: a.email,
      url: page.url(),
      expect: Object.fromEntries(a.expectNav.map((n) => [n, text.includes(n)])),
      deny: Object.fromEntries(a.denyNav.map((n) => [n, !text.includes(n)])),
      screenshot: shot,
    };
    out.push(row);
    console.log(JSON.stringify(row));
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync("docs/user-guide/evidence/role-ui-nav.json", JSON.stringify(out, null, 2));
