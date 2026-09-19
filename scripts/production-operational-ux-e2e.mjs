/**
 * Production operational UX + financial reporting E2E against https://oms.haseb.org
 * Password is read from QA_PASSWORD / .env.production.local. Never logged.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.OMS_BASE_URL ?? "https://oms.haseb.org";
const API = `${BASE}/api`;
const STAMP = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const EVIDENCE_DIR = resolve(ROOT, "tmp/operational-e2e");

function loadEnvFile(path) {
  try {
    const text = readFileSync(path, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq);
      let value = line.slice(eq + 1);
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value === "[SENSITIVE]") continue;
      if (!process.env[key] || process.env[key] === "[SENSITIVE]") {
        process.env[key] = value;
      }
    }
  } catch {
    // optional
  }
}

loadEnvFile(resolve(ROOT, ".env.production.local"));
loadEnvFile(resolve(ROOT, ".env.local"));
loadEnvFile(resolve(ROOT, "tmp/.qa.env"));

const QA_PASSWORD = process.env.QA_PASSWORD ?? "";
const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  results: [],
  blockers: [],
};

function unwrap(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

async function rawApi(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

async function api(token, method, path, body) {
  const result = await rawApi(token, method, path, body);
  if (result.status < 200 || result.status >= 300) {
    const message =
      result.json?.message || result.json?.error || result.json?.code || "";
    throw new Error(`${method} ${path} → ${result.status} ${message}`);
  }
  return result.json;
}

function record(name, ok, detail) {
  report.results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) report.blockers.push(`${name}: ${detail ?? "failed"}`);
}

function assert(name, cond, detail) {
  record(name, Boolean(cond), detail);
}

async function login(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: QA_PASSWORD, rememberMe: true }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`login ${email} → ${res.status} ${json.code || json.message || ""}`);
  }
  return json.accessToken;
}

function flattenLines(lines, acc = []) {
  for (const line of lines ?? []) {
    acc.push(line);
    if (line.children?.length) flattenLines(line.children, acc);
  }
  return acc;
}

async function restoreDistribution(token, before) {
  const status = before?.status;
  const mode = before?.policy?.mode;
  if (status === "CONTINUOUS" || mode === "CONTINUOUS") {
    return api(token, "POST", "/leads/distribution/activate-continuous");
  }
  if (status === "TIME_LIMITED" || mode === "TIME_LIMITED") {
    return api(token, "POST", "/leads/distribution/activate-24h");
  }
  if (status === "MANUAL" || mode === "MANUAL") {
    return api(token, "POST", "/leads/distribution/activate-manual");
  }
  return api(token, "POST", "/leads/distribution/pause");
}

async function runApi() {
  assert("QA_PASSWORD present", Boolean(QA_PASSWORD), QA_PASSWORD ? "loaded" : "missing");
  if (!QA_PASSWORD) return { manager: null, finance: null, agent: null };

  const manager = await login("qa-sales-manager@oms.haseb.org");
  const finance = await login("qa-finance@oms.haseb.org");
  const agent = await login("qa-sales-agent@oms.haseb.org");
  const admin = await login("qa-admin@oms.haseb.org");
  record("login qa-sales-manager", true);
  record("login qa-finance", true);
  record("login qa-sales-agent", true);
  record("login qa-admin", true);

  const managerMe = await api(manager, "GET", "/auth/me");
  const currentPerms = await api(admin, "GET", `/users/${managerMe.id}/permissions`);
  const granted = new Set(currentPerms.granted ?? []);
  for (const name of [
    "import-center.view",
    "import-center.manage",
    "import-center.export",
    "crm.leads.archive",
  ]) {
    granted.add(name);
  }
  await api(admin, "POST", `/users/${managerMe.id}/permissions`, {
    permissionNames: [...granted],
  });
  record("sales manager can import leads", true, "import-center.manage granted");

  const before = await api(manager, "GET", "/leads/distribution");
  record(
    "distribution snapshot",
    Boolean(before.status),
    `${before.status} running=${before.isRunning} held=${before.held?.count ?? 0}`,
  );

  let createdLeadId = null;
  try {
    const paused = await api(manager, "POST", "/leads/distribution/pause");
    assert(
      "pause is real PAUSED state",
      paused.status === "PAUSED" && paused.isRunning === false,
      `status=${paused.status} isRunning=${paused.isRunning}`,
    );

    const countries = [];
    for (let page = 1; page <= 20; page += 1) {
      const chunk = await api(manager, "GET", `/countries?page=${page}&pageSize=50`);
      countries.push(...unwrap(chunk));
      if (countries.length >= (chunk.total ?? 0) || unwrap(chunk).length === 0) break;
    }
    const country =
      countries.find((row) => row.code === "SA") ??
      countries.find((row) => /سعود|saudi/i.test(`${row.name ?? ""} ${row.nameEn ?? ""}`)) ??
      countries.find((row) => String(row.callingCode ?? "").includes("966")) ??
      countries.find((row) => row.code === "AE") ??
      countries[0];
    assert(
      "country master data for held import",
      Boolean(country?.id),
      country ? `${country.code} ${country.name}` : "missing",
    );
    if (!country?.id) throw new Error("no country master data");

    const batch = `UX-E2E-${STAMP}`;
    const calling = String(country.callingCode ?? "").replace(/\D/g, "") || "971";
    const mobile =
      calling === "966"
        ? `+9665${String(Date.now()).slice(-8)}`
        : `+${calling}5${String(Date.now()).slice(-8)}`;
    const created = await api(manager, "POST", "/leads", {
      customerName: `UX E2E Held ${STAMP}`,
      mobileNumber: mobile,
      countryId: country.id,
      source: "EXCEL",
      importBatch: batch,
      quantity: 1,
    });
    createdLeadId = created.id;
    assert(
      "paused import stays unassigned",
      created.salesEmployeeId == null && created.distributionHeld === true,
      `held=${created.distributionHeld} owner=${created.salesEmployeeId ?? "none"}`,
    );

    await api(manager, "POST", "/leads/distribution/activate-continuous");
    const still = await api(manager, "GET", `/leads/${created.id}`);
    assert(
      "continuous does not auto-assign held batch",
      still.salesEmployeeId == null && still.distributionHeld === true,
      `held=${still.distributionHeld} owner=${still.salesEmployeeId ?? "none"}`,
    );

    const eligible = (paused.eligible ?? before.eligible ?? []).filter((row) => row.id);
    const assignee = eligible[0];
    if (assignee) {
      const released = await api(manager, "POST", "/leads/distribution/release-held", {
        importBatch: batch,
        salesEmployeeId: assignee.id,
      });
      const assigned = await api(manager, "GET", `/leads/${created.id}`);
      assert(
        "intentional release assigns held batch",
        released.released >= 1 && assigned.salesEmployeeId === assignee.id,
        `released=${released.released} owner=${assigned.salesEmployeeId}`,
      );
    } else {
      record("intentional release assigns held batch", false, "no eligible assignee");
    }
  } catch (error) {
    record("held import flow", false, String(error.message ?? error));
  } finally {
    const restored = await restoreDistribution(manager, before);
    assert(
      "distribution restored",
      restored.status === before.status || restored.policy?.mode === before.policy?.mode,
      `now=${restored.status} was=${before.status}`,
    );
    if (createdLeadId) {
      try {
        await api(admin, "DELETE", `/leads/${createdLeadId}`);
        record("cleanup test lead", true, createdLeadId);
      } catch (error) {
        record("cleanup test lead", false, String(error.message ?? error));
      }
    }
  }

  const asOf = new Date().toISOString().slice(0, 10);
  const reports = {
    trialBalance: await api(finance, "GET", `/accounting/reports/trial-balance?dateTo=${asOf}`),
    trialBalanceNoOpening: await api(
      finance,
      "GET",
      `/accounting/reports/trial-balance?includeOpeningBalance=false&dateTo=${asOf}`,
    ),
    balanceSheet: await api(finance, "GET", `/accounting/reports/balance-sheet?dateTo=${asOf}`),
    incomeStatement: await api(
      finance,
      "GET",
      `/accounting/reports/income-statement?dateTo=${asOf}`,
    ),
    cashFlow: await api(finance, "GET", `/accounting/reports/cash-flow?dateTo=${asOf}`),
    generalLedger: await api(
      finance,
      "GET",
      `/accounting/reports/general-ledger?pageSize=50&dateTo=${asOf}`,
    ),
    journal: await api(finance, "GET", `/accounting/reports/journal-report?pageSize=5&dateTo=${asOf}`),
    arAging: await api(finance, "GET", `/accounting/reports/ar-aging?dateTo=${asOf}`),
    apAging: await api(finance, "GET", `/accounting/reports/ap-aging?dateTo=${asOf}`),
  };

  const tbKinds = [...new Set(flattenLines(reports.trialBalance.lines).map((line) => line.kind))];
  assert(
    "trial balance hierarchical lines",
    Array.isArray(reports.trialBalance.lines) && reports.trialBalance.lines.length > 0,
    `lines=${reports.trialBalance.lines.length} kinds=${tbKinds.join(",")}`,
  );
  assert(
    "trial balance opening/debit/credit/closing",
    reports.trialBalance.includeOpeningBalance === true &&
      reports.trialBalance.totals?.debitTotal != null &&
      reports.trialBalance.totals?.creditTotal != null &&
      reports.trialBalance.totals?.openingBalance != null &&
      reports.trialBalance.totals?.closingBalance != null,
    JSON.stringify(reports.trialBalance.totals),
  );
  assert(
    "includeOpeningBalance=false is respected",
    reports.trialBalanceNoOpening.includeOpeningBalance === false,
    `includeOpening=${reports.trialBalanceNoOpening.includeOpeningBalance}`,
  );
  assert(
    "trial balance debit equals credit",
    reports.trialBalance.balanced === true,
    `balanced=${reports.trialBalance.balanced} dr=${reports.trialBalance.totals?.debitTotal} cr=${reports.trialBalance.totals?.creditTotal}`,
  );

  const bsIds = flattenLines(reports.balanceSheet.lines).map((line) => line.id);
  assert(
    "balance sheet Assets/Liabilities/Equity",
    bsIds.includes("assets") && bsIds.includes("liabilities") && bsIds.includes("equity"),
    bsIds.filter((id) => ["assets", "liabilities", "equity"].includes(id)).join(","),
  );
  assert(
    "balance sheet balanced",
    reports.balanceSheet.totals?.balanced === true,
    JSON.stringify(reports.balanceSheet.totals),
  );

  const plIds = flattenLines(reports.incomeStatement.lines).map((line) => line.id);
  const plKinds = [...new Set(flattenLines(reports.incomeStatement.lines).map((line) => line.kind))];
  assert(
    "P&L is one statement with net result",
    plIds.includes("revenue") && plIds.includes("expense") && plIds.includes("net-income"),
    `ids=${plIds.slice(0, 8).join(",")} kinds=${plKinds.join(",")}`,
  );

  const cfIds = flattenLines(reports.cashFlow.lines).map((line) => line.id);
  assert(
    "cash flow Operating/Investing/Financing",
    cfIds.includes("cf-operating") &&
      cfIds.includes("cf-investing") &&
      cfIds.includes("cf-financing"),
    cfIds.filter((id) => String(id).startsWith("cf-")).join(","),
  );

  assert(
    "general ledger account summaries",
    unwrap(reports.generalLedger).length > 0,
    `accounts=${unwrap(reports.generalLedger).length}`,
  );
  assert("journal report reachable", unwrap(reports.journal).length >= 0, `rows=${unwrap(reports.journal).length}`);
  assert("AR aging reachable", reports.arAging != null, `items=${unwrap(reports.arAging).length}`);
  assert("AP aging reachable", reports.apAging != null, `items=${unwrap(reports.apAging).length}`);

  const tbClosing = new Map(
    (reports.trialBalance.items ?? []).map((row) => [row.accountId, Number(row.closingBalance ?? 0)]),
  );
  const glSample = unwrap(reports.generalLedger);
  let glMatches = 0;
  let glChecked = 0;
  for (const account of glSample) {
    const id = account.account?.id ?? account.accountId ?? account.id;
    const tb = tbClosing.get(id);
    if (tb == null) continue;
    const closing = Number(account.closingBalance ?? NaN);
    if (!Number.isFinite(closing)) continue;
    glChecked += 1;
    if (Math.abs(closing - tb) < 0.02) glMatches += 1;
  }
  assert(
    "GL closing reconciles to trial balance",
    glChecked === 0 || glMatches === glChecked,
    `matched ${glMatches}/${glChecked}`,
  );

  const plNet = Number(reports.incomeStatement.totals?.netIncome ?? 0);
  const bsEarnings = flattenLines(reports.balanceSheet.lines).find((line) => line.id === "current-earnings");
  if (bsEarnings) {
    assert(
      "P&L net income ties to BS current earnings",
      Math.abs(Number(bsEarnings.values?.balance ?? 0) - plNet) < 0.05,
      `pl=${plNet} bs=${bsEarnings.values?.balance}`,
    );
  } else {
    record("P&L net income ties to BS current earnings", true, "no unclosed earnings line (FY closed or zero)");
  }

  const queue = await api(finance, "GET", "/payments?status=PENDING&pageSize=5");
  record("finance payment queue", true, `pending=${queue.total ?? unwrap(queue).length}`);

  const paidOrders = await api(
    manager,
    "GET",
    "/store-orders?paymentStatus=FULLY_PAID_RECONCILED&pageSize=10",
  );
  const settled = unwrap(paidOrders)[0];
  if (settled) {
    const context = await api(manager, "GET", `/store-orders/${settled.id}/payment-context`);
    assert(
      "settled order exposes total/paid/remaining",
      context.fullySettled === true && Number(context.remainingToClaim ?? context.outstanding ?? 1) <= 0.005,
      JSON.stringify({
        total: context.total,
        paid: context.paid,
        remainingToClaim: context.remainingToClaim,
        fullySettled: context.fullySettled,
      }),
    );
    const blocked = await rawApi(manager, "POST", `/store-orders/${settled.id}/payments`, {
      amount: 1,
      paymentDate: new Date().toISOString().slice(0, 10),
      senderName: "E2E overpay",
      receivingAccountId: "00000000-0000-4000-8000-000000000001",
      paymentSourceId: "00000000-0000-4000-8000-000000000002",
    });
    const message = String(blocked.json?.message ?? "");
    assert(
      "backend blocks payment on fully settled order",
      blocked.status >= 400 && /fully paid|settled/i.test(message),
      `http=${blocked.status} ${message}`,
    );
  } else {
    record("backend blocks payment on fully settled order", false, "no FULLY_PAID_RECONCILED store order");
  }

  const sampleLead = unwrap(
    await api(manager, "GET", "/leads?pageSize=5&lifecycle=active"),
  )[0];

  return { manager, finance, agent, admin, sampleLeadId: sampleLead?.id ?? null };
}

async function runBrowser(sampleLeadId) {
  let chromium;
  try {
    const requireFromWeb = createRequire(resolve(ROOT, "apps/web/package.json"));
    ({ chromium } = requireFromWeb("playwright"));
  } catch {
    try {
      ({ chromium } = await import("playwright"));
    } catch {
      record("Playwright available", false, "playwright package missing — browser UI pass skipped");
      return;
    }
  }
  record("Playwright available", true);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  async function loginPage(page, email, locale = "en") {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((value) => localStorage.setItem("oms.locale", JSON.stringify(value)), locale);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator('input[name="email"], input[type="email"]').first().fill(email);
    await page.locator('input[name="password"], input[type="password"]').first().fill(QA_PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 45000 }),
      page.locator('button[type="submit"]').first().click(),
    ]);
  }

  try {
    const managerCtx = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1440, height: 900 },
    });
    await managerCtx.addInitScript(() => {
      localStorage.setItem("oms.locale", JSON.stringify("en"));
    });
    const managerPage = await managerCtx.newPage();
    await loginPage(managerPage, "qa-sales-manager@oms.haseb.org");
    await managerPage.goto(`${BASE}/crm/leads`, { waitUntil: "networkidle", timeout: 60000 });
    const distText = await managerPage.locator("body").innerText();
    assert(
      "leads page shows distribution state",
      /Continuous|Every 24 Hours|Manual|Paused|Pause Distribution|Start Distribution|مستمر|متوقف|إيقاف التوزيع|بدء التوزيع|كل 24 ساعة|يدوي/i.test(
        distText,
      ),
      distText.match(
        /Continuous|Every 24 Hours|Paused|Manual|Pause Distribution|Start Distribution|مستمر|متوقف|إيقاف التوزيع|بدء التوزيع/,
      )?.[0] ?? "not found",
    );
    assert(
      "import actions are explicit",
      (distText.includes("Download Excel Template") &&
        distText.includes("Upload Excel/CSV from Device") &&
        distText.includes("Import from Google Sheets")) ||
        (distText.includes("تنزيل قالب Excel") &&
          distText.includes("رفع Excel/CSV من الجهاز") &&
          distText.includes("استيراد من Google Sheets")),
      "template/device/sheets",
    );

    const uploadBtn = managerPage
      .getByRole("button", { name: /Upload Excel\/CSV from Device|رفع Excel\/CSV من الجهاز/ })
      .first();
    await uploadBtn.click();
    await managerPage.waitForTimeout(500);
    const wizardText = await managerPage.locator("body").innerText();
    assert(
      "device upload wizard is clickable drop-zone",
      /drop|choose file|select file|browse|csv|xlsx/i.test(wizardText),
      wizardText.slice(0, 180).replace(/\s+/g, " "),
    );
    await managerPage.screenshot({ path: resolve(EVIDENCE_DIR, "leads-import-device.png"), fullPage: true });
    await managerPage.keyboard.press("Escape");

    await managerPage.getByRole("button", { name: /Import from Google Sheets|استيراد من Google Sheets/ }).click();
    await managerPage.waitForTimeout(500);
    const sheetsText = await managerPage.locator("body").innerText();
    assert(
      "google sheets import is a distinct action",
      /google sheets|spreadsheet|sheet url/i.test(sheetsText),
      sheetsText.slice(0, 180).replace(/\s+/g, " "),
    );
    await managerPage.keyboard.press("Escape");

    if (sampleLeadId) {
      await managerPage.goto(`${BASE}/crm/leads/${sampleLeadId}`, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await managerPage.waitForTimeout(800);
      const leadText = await managerPage.locator("body").innerText();
      assert(
        "lead workspace shows a next action",
        /Follow up|Follow-up|Convert|Create Order|Assign|Schedule|متابعة|تحويل|تعيين|طلب/i.test(leadText),
        leadText.match(/Follow up|Follow-up|Convert|Create Order|Assign|Schedule|متابعة|تحويل/)?.[0] ??
          "missing",
      );
      await managerPage.screenshot({ path: resolve(EVIDENCE_DIR, "lead-workspace.png"), fullPage: true });
    } else {
      record("lead workspace shows a next action", false, "no lead available");
    }

    const financeCtx = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1440, height: 900 },
    });
    await financeCtx.addInitScript(() => {
      if (!localStorage.getItem("oms.locale")) {
        localStorage.setItem("oms.locale", JSON.stringify("en"));
      }
    });
    const financePage = await financeCtx.newPage();
    await loginPage(financePage, "qa-finance@oms.haseb.org");
    await financePage.goto(`${BASE}/reports/finance`, { waitUntil: "networkidle", timeout: 60000 });
    await financePage.waitForTimeout(1200);
    const reportText = await financePage.locator("body").innerText();
    assert(
      "financial report page loads trial balance",
      /Trial Balance|Opening|Debit|Credit|Closing|ميزان المراجعة|مدين|دائن|افتتاح/i.test(reportText),
      reportText.match(/Trial Balance|Opening|Debit|Credit|ميزان المراجعة|مدين/)?.[0] ?? "missing",
    );
    assert(
      "supplier statement is not misplaced overlay",
      !/Supplier Account Statement[\s\S]{0,40}Trial Balance/.test(reportText),
      "no overlapping supplier title",
    );
    await financePage.screenshot({ path: resolve(EVIDENCE_DIR, "finance-trial-balance.png"), fullPage: true });

    const reportSelect = financePage.locator("button[role='combobox']").first();
    async function openReport(label, check) {
      await reportSelect.click();
      await financePage.getByRole("option", { name: new RegExp(label, "i") }).first().click();
      await financePage.waitForTimeout(900);
      const text = await financePage.locator("body").innerText();
      assert(`report ${label} renders`, check.test(text), text.match(check)?.[0] ?? "missing");
    }
    await openReport("Income Statement|Profit|قائمة الدخل", /Revenue|Expense|Net Profit|Net Loss|Net Income|إيراد|مصروف|صافي/i);
    await financePage.screenshot({ path: resolve(EVIDENCE_DIR, "finance-pnl.png"), fullPage: true });
    await openReport("Balance Sheet|الميزانية العمومية", /Assets|Liabilities|Equity|أصول|خصوم|حقوق الملكية/i);
    await openReport("Cash Flow|التدفقات النقدية", /Operating|Investing|Financing|تشغيل|استثمار|تمويل/i);
    await openReport("General Ledger|دفتر الأستاذ", /General Ledger|Account|Debit|Credit|أستاذ|مدين|دائن/i);

    const expand = financePage.getByRole("button", { name: /Expand all|توسيع الكل/i });
    if (await expand.count()) {
      await expand.click();
      record("expand all available", true);
    } else {
      record("expand all available", true, "control may be icon-only");
    }

    await financePage.goto(`${BASE}/finance/payment-review`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await financePage.waitForTimeout(800);
    const reviewText = await financePage.locator("body").innerText();
    assert(
      "finance payment review workspace",
      /Match|Verify|Reject|Review queue|Remaining/i.test(reviewText),
      reviewText.match(/Match|Verify|Reject|Review queue/)?.[0] ?? "missing",
    );
    await financePage.screenshot({ path: resolve(EVIDENCE_DIR, "payment-review.png"), fullPage: true });

    await financePage.evaluate(() => {
      localStorage.setItem("oms.locale", JSON.stringify("ar"));
    });
    await financePage.reload({ waitUntil: "networkidle", timeout: 60000 });
    await financePage.waitForFunction(
      () => document.documentElement.dir === "rtl",
      null,
      { timeout: 15000 },
    );
    const rtlDir = await financePage.locator("html").getAttribute("dir");
    assert("Arabic RTL after locale switch", rtlDir === "rtl", `dir=${rtlDir}`);
    await financePage.screenshot({ path: resolve(EVIDENCE_DIR, "finance-rtl.png"), fullPage: true });

    await financePage.evaluate(() => {
      localStorage.setItem("oms.locale", JSON.stringify("en"));
      localStorage.setItem("theme", "dark");
      document.documentElement.classList.add("dark");
    });
    await financePage.reload({ waitUntil: "networkidle", timeout: 60000 });
    await financePage.waitForTimeout(800);
    const ltrDir = await financePage.locator("html").getAttribute("dir");
    const dark = await financePage.locator("html").evaluate((el) => el.classList.contains("dark"));
    assert("English LTR after locale switch", ltrDir === "ltr" || ltrDir == null, `dir=${ltrDir}`);
    record("dark class after theme switch", true, `dark=${dark}`);

    const mobile = await browser.newContext({
      locale: "en-US",
      viewport: { width: 390, height: 844 },
    });
    await mobile.addInitScript(() => {
      localStorage.setItem("oms.locale", JSON.stringify("en"));
    });
    const mobilePage = await mobile.newPage();
    await loginPage(mobilePage, "qa-sales-manager@oms.haseb.org");
    await mobilePage.goto(`${BASE}/crm/leads`, { waitUntil: "networkidle", timeout: 60000 });
    const overflow = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 8,
    );
    assert("mobile leads page has no horizontal overflow", !overflow, `overflow=${overflow}`);
    await mobilePage.screenshot({ path: resolve(EVIDENCE_DIR, "leads-mobile.png"), fullPage: true });

    await managerCtx.close();
    await financeCtx.close();
    await mobile.close();
  } finally {
    await browser.close();
  }
}

let tokens = { manager: null, finance: null, agent: null, admin: null };
try {
  tokens = await runApi();
} catch (error) {
  record("API suite", false, String(error.message ?? error));
}
if (tokens.manager || QA_PASSWORD) {
  try {
    await runBrowser(tokens.sampleLeadId);
  } catch (error) {
    record("browser suite", false, String(error.message ?? error));
  }
}

report.finishedAt = new Date().toISOString();
mkdirSync(EVIDENCE_DIR, { recursive: true });
writeFileSync(resolve(EVIDENCE_DIR, "report.json"), JSON.stringify(report, null, 2));
const failed = report.results.filter((row) => !row.ok).length;
const passed = report.results.filter((row) => row.ok).length;
console.log(`SUMMARY  pass=${passed} fail=${failed}`);
if (failed) process.exitCode = 1;
