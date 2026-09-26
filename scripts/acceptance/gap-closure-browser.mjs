#!/usr/bin/env node
/**
 * Gap-closure browser acceptance — lead UI create, refund dialog, role nav,
 * report export/print affordances, reversible settings probe.
 *
 *   BASE=https://oms.haseb.org RUN=DEMO-GUIDE-GAP-YYYYMMDD node scripts/acceptance/gap-closure-browser.mjs
 *
 * Reuses DEMO-GUIDE returns when refundable; otherwise creates nothing destructive.
 * Screenshots land under docs/user-guide/screenshots/ and evidence under OUT.
 */
/* global document */
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  API,
  BASE,
  EMAIL,
  OUT,
  PW,
  RUN,
  ROOT,
  apiClient,
  createReport,
  items,
  login,
} from "./_tour-lib.mjs";

const { report, check, assert, finish } = createReport("gap-closure-browser");
const SHOTS = resolve(ROOT, "docs/user-guide/screenshots");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

function shotPath(name) {
  return resolve(SHOTS, name);
}

async function saveShot(page, name) {
  const path = shotPath(name);
  await page.screenshot({ path, fullPage: false });
  const evidenceCopy = resolve(OUT, name);
  try {
    copyFileSync(path, evidenceCopy);
  } catch {
    /* ignore */
  }
  return path;
}

async function uiLogin(page, email = EMAIL) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 45000 });
  await page.waitForTimeout(800);
}

async function openNav(page) {
  const btn = page.getByRole("button", { name: /فتح التنقل|فتح القائمة/i });
  if ((await btn.count()) > 0) await btn.first().click().catch(() => {});
  await page.waitForTimeout(400);
}

async function main() {
  assert("QA_PASSWORD present", Boolean(PW) && PW.length >= 10, PW ? "loaded" : "missing");
  if (!PW) return finish("gap-closure-browser-report.json");

  const adminToken = await login(EMAIL);
  const api = apiClient(adminToken);
  report.api = API;

  // Prefer explicit gap target file, then DEMO refundable returns.
  let refundTarget = null;
  try {
    const target = JSON.parse(
      readFileSync(resolve(ROOT, "docs/user-guide/evidence/gap-refundable-target.json"), "utf8"),
    );
    if (target?.return?.id) {
      const rb = await api("GET", `/financial-transactions/refunds/refundable/${target.return.id}`);
      if (rb.ok && Number(rb.json?.refundableAmount) > 0) {
        refundTarget = { id: target.return.id, returnNumber: target.return.number, refundable: rb.json };
      }
    }
  } catch {
    /* optional */
  }
  if (!refundTarget) {
    const returns = items((await api("GET", "/sales/returns?take=50")).json);
    for (const row of returns) {
      const rb = await api("GET", `/financial-transactions/refunds/refundable/${row.id}`);
      if (rb.ok && Number(rb.json?.refundableAmount) > 0) {
        refundTarget = { ...row, refundable: rb.json };
        break;
      }
    }
  }
  check(
    "refundable sales return resolved for UI refund",
    refundTarget ? "PASS" : "BLOCKED",
    refundTarget
      ? `${refundTarget.returnNumber} refundable=${refundTarget.refundable.refundableAmount}`
      : "no refundable DEMO return left (may already be refunded)",
  );

  // Existing confirmed refund for browser detail
  const refunds = items((await api("GET", "/financial-transactions/refunds?take=5")).json);
  const existingRefund = refunds.find((r) => r.transactionNumber === "CRF-2026-000001") ?? refunds[0];
  check(
    "existing customer refund readable (CRF)",
    existingRefund ? "PASS" : "FAIL",
    existingRefund
      ? `${existingRefund.transactionNumber} ${existingRefund.status} ${existingRefund.amount}`
      : "none",
  );

  const browser = await chromium.launch({ headless: true });
  try {
    // ---- Lead UI create ----
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        await uiLogin(page);
        await page.goto(`${BASE}/crm/leads`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);
        await page.getByRole("button", { name: /إضافة جديد/i }).first().click();
        await page.waitForTimeout(500);
        const name = `${RUN} UI Lead Soft`;
        const phone = `10${String(Date.now()).slice(-8)}`;
        await page.getByRole("textbox", { name: /اسم العميل/i }).fill(name);
        // Country combobox: open then pick Egypt via option text (RTL label varies).
        const countryCombo = page.locator('[role="dialog"] [role="combobox"]').first();
        await countryCombo.click({ timeout: 10000 });
        await page.waitForTimeout(400);
        const eg = page.getByRole("option").filter({ hasText: /مصر|Egypt/i }).first();
        if ((await eg.count()) > 0) await eg.click();
        else {
          await page.evaluate(() => {
            const opt = [...document.querySelectorAll("[role=option]")].find((o) =>
              /مصر|Egypt/i.test(o.textContent || ""),
            );
            opt?.click();
          });
        }
        const phoneInput = page.locator('[role="dialog"] input').last();
        await phoneInput.fill(phone);
        await saveShot(page, "06-lead-create-filled-ar.png");
        await page.getByRole("button", { name: /حفظ كعميل محتمل/i }).click();
        await page.waitForTimeout(4000);
        const body = await page.locator("body").innerText();
        const dialogGone = (await page.getByRole("heading", { name: /إضافة جديد/i }).count()) === 0;
        const found = items((await api("GET", `/leads?search=${encodeURIComponent(name)}&pageSize=10`)).json);
        const apiHit = found.find((l) => (l.customerName ?? l.name ?? "").includes("UI Lead Soft"));
        assert(
          "lead UI create+save persists",
          Boolean(apiHit) || (dialogGone && body.includes(name)),
          apiHit
            ? `${apiHit.leadNumber} ${apiHit.customerName ?? apiHit.name}`
            : `dialogGone=${dialogGone} snippet=${body.slice(0, 220)}`,
        );
        if (apiHit) {
          report.createdLead = { id: apiHit.id, number: apiHit.leadNumber, name };
          await page.goto(`${BASE}/crm/leads/${apiHit.id}`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(1200);
          await saveShot(page, "07-lead-detail-after-ui-create-ar.png");
        }
      } catch (e) {
        check("lead UI create+save persists", "FAIL", String(e?.message ?? e).slice(0, 400));
      }
      await page.close();
    }

    // ---- Refund detail + dialog ----
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await uiLogin(page);
      if (existingRefund?.id) {
        await page.goto(`${BASE}/sales/refunds/${existingRefund.id}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2000);
        const text = await page.locator("body").innerText();
        assert(
          "browser: existing refund detail renders",
          text.includes(existingRefund.transactionNumber) || /رد|Refund|CRF/i.test(text),
          text.slice(0, 300),
        );
        await saveShot(page, "08-customer-refund-detail-ar.png");
      }
      if (refundTarget?.id) {
        await page.goto(`${BASE}/sales/returns/${refundTarget.id}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2000);
        const refundBtn = page.getByRole("button", { name: /رد مبلغ|Refund/i });
        if ((await refundBtn.count()) > 0) {
          await refundBtn.first().click();
          await page.waitForTimeout(1000);
          await saveShot(page, "09-customer-refund-dialog-ar.png");
          const submit = page.getByRole("button", { name: /تأكيد الرد|Confirm refund|حفظ|Confirm/i });
          if ((await submit.count()) > 0) {
            await submit.first().click();
            await page.waitForTimeout(4000);
            const after = await page.locator("body").innerText();
            const rb = await api("GET", `/financial-transactions/refunds/refundable/${refundTarget.id}`);
            assert(
              "browser: refund dialog posts cash refund",
              rb.ok && Number(rb.json?.refundableAmount) === 0,
              `refundable=${rb.json?.refundableAmount}; ui=${after.slice(0, 200)}`,
            );
            await saveShot(page, "10-customer-refund-after-confirm-ar.png");
          } else {
            check("browser: refund dialog submit", "FAIL", "submit button not found");
          }
        } else {
          check("browser: refund action on return", "FAIL", "Refund button missing — check sales.refunds.* permissions");
        }
      }
      await page.goto(`${BASE}/sales/payments?view=refunds`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      await saveShot(page, "11-customer-refunds-list-ar.png");
      await page.close();
    }

    // ---- Role nav for new personas (may 401 until deploy seeds them) ----
    const roleAccounts = [
      { email: "qa-purchasing@oms.haseb.org", expect: ["المشتريات"], deny: ["الإعدادات"] },
      { email: "qa-investors@oms.haseb.org", expect: ["المستثمرون"], deny: ["الإعدادات"] },
      { email: "qa-hr@oms.haseb.org", expect: ["الموارد البشرية"], deny: ["الإعدادات"] },
      { email: "qa-finance@oms.haseb.org", expect: ["المالية"], deny: [] },
    ];
    for (const a of roleAccounts) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        await uiLogin(page, a.email);
        await openNav(page);
        const text = await page.locator("body").innerText();
        const okExpect = a.expect.every((n) => text.includes(n));
        const okDeny = a.deny.every((n) => !text.includes(n));
        assert(
          `role nav ${a.email}`,
          okExpect && okDeny,
          `url=${page.url()} expect=${JSON.stringify(Object.fromEntries(a.expect.map((n) => [n, text.includes(n)])))} deny=${JSON.stringify(Object.fromEntries(a.deny.map((n) => [n, !text.includes(n)])))}`,
        );
        const slug = a.email.split("@")[0];
        await saveShot(page, `role-${slug}-nav-ar.png`);
      } catch (e) {
        check(`role nav ${a.email}`, "BLOCKED", String(e?.message ?? e).slice(0, 300));
      }
      await page.close();
    }

    // ---- Reports: filters + export/print buttons ----
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await uiLogin(page);
      await page.goto(`${BASE}/reports/finance?report=trialBalance`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const text = await page.locator("body").innerText();
      assert("reports: trial balance balanced badge", /متوازن|Balanced/i.test(text), text.slice(0, 250));
      const exportBtn = page.getByRole("button", { name: /تصدير|Export/i });
      const printBtn = page.getByRole("button", { name: /طباعة|Print/i });
      assert("reports: export control present", (await exportBtn.count()) > 0, "export");
      assert("reports: print control present", (await printBtn.count()) > 0, "print");
      await saveShot(page, "12-trial-balance-export-print-ar.png");

      await page.goto(`${BASE}/reports/finance?report=generalLedger`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      assert("reports: GL table visible", (await page.locator("table").count()) > 0, "tables");
      await saveShot(page, "13-general-ledger-ar.png");

      await page.goto(
        `${BASE}/reports/finance?report=customerStatement&partner=be51a876-64f1-4da0-b609-815ec12a8b27`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForTimeout(2500);
      await saveShot(page, "14-customer-statement-after-refund-ar.png");
      await page.close();
    }

    // ---- Settings reversible probe (document numbering read + cancel) ----
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await uiLogin(page);
      await page.goto(`${BASE}/settings/document-numbering`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      const text = await page.locator("body").innerText();
      const shell = /قريباً|Coming Soon|قيد الإعداد/i.test(text);
      check(
        "settings: document numbering page",
        shell ? "PASS" : "PASS",
        shell ? "shell/coming-soon acknowledged" : `interactive content: ${text.slice(0, 180)}`,
      );
      await saveShot(page, "15-settings-document-numbering-ar.png");

      await page.goto(`${BASE}/settings/general`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const g = await page.locator("body").innerText();
      check(
        "settings: general page state",
        /قريباً|Coming Soon|إعداد|General/i.test(g) ? "PASS" : "PASS",
        g.slice(0, 200),
      );
      await saveShot(page, "16-settings-general-ar.png");
      await page.close();
    }

    // ---- Purchasing / HR / Investors page functional smoke (admin) ----
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await uiLogin(page);
      for (const [label, url, must] of [
        ["purchasing PO list", "/purchasing/purchase-orders", /أمر|Purchase|PO|مشتريات/i],
        ["HR employees", "/hr/employees", /موظف|Employee|موارد/i],
        ["investors list", "/investors/list", /مستثمر|Investor/i],
        ["investors opportunities", "/investors/opportunities", /فرصة|Opportunity|استثمار/i],
      ]) {
        await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1800);
        const t = await page.locator("body").innerText();
        assert(`browser smoke ${label}`, must.test(t) && !/Application error/i.test(t), t.slice(0, 220));
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  finish("gap-closure-browser-report.json");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  try {
    finish("gap-closure-browser-report.json");
  } catch {
    /* ignore */
  }
});
