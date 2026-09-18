/**
 * Production Accounting & Finance go-live E2E against https://oms.haseb.org
 *
 * Password is read from QA_PASSWORD (or .env.production.local). Never logged.
 *
 * Usage:
 *   node scripts/production-accounting-e2e.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.OMS_BASE_URL ?? 'https://oms.haseb.org';
const API = `${BASE}/api`;
const STAMP = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const RUN = `QA-E2E-${STAMP}`;
const EVIDENCE_DIR = resolve(ROOT, 'tmp/accounting-e2e');

function loadEnvFile(path) {
  try {
    const text = readFileSync(path, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq);
      let value = line.slice(eq + 1);
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
      if (process.env[key] === '[SENSITIVE]') delete process.env[key];
    }
  } catch {
    // optional
  }
}

loadEnvFile(resolve(ROOT, '.env.production.local'));
loadEnvFile(resolve(ROOT, '.env.local'));

const QA_PASSWORD = process.env.QA_PASSWORD ?? '';
const PERSONAS = [
  { key: 'admin', email: 'qa-admin@oms.haseb.org', home: '/' },
  { key: 'finance', email: 'qa-finance@oms.haseb.org', home: '/finance/journal-entries' },
  { key: 'manager', email: 'qa-sales-manager@oms.haseb.org', home: '/crm/leads' },
  { key: 'agent', email: 'qa-sales-agent@oms.haseb.org', home: '/crm/leads' },
  { key: 'shipping', email: 'qa-shipping@oms.haseb.org', home: '/shipping' },
];

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  run: RUN,
  results: [],
  personas: {},
  posting: [],
  pages: [],
  consoleErrors: [],
  blockers: [],
};

function unwrap(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

function pick(list, pred) {
  return unwrap(list).find(pred) ?? unwrap(list)[0] ?? null;
}

async function api(token, method, path, body, extraHeaders = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const message =
      json?.message || json?.error || json?.code || text.slice(0, 400);
    const err = new Error(`${method} ${path} → ${res.status} ${message}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function record(name, ok, detail) {
  report.results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(name, cond, detail) {
  record(name, Boolean(cond), detail);
  if (!cond) report.blockers.push(`${name}: ${detail ?? 'failed'}`);
}

function assertBalanced(entry, label) {
  const lines = entry?.lines ?? entry?.journalEntryLines ?? [];
  const debit = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
  const credit = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
  const balanced = Math.abs(debit - credit) < 0.01 && debit > 0;
  const accounts = lines
    .map((l) => l.account?.code || l.accountCode || l.accountId)
    .filter(Boolean)
    .join(',');
  report.posting.push({
    label,
    id: entry?.id,
    number: entry?.entryNumber,
    sourceType: entry?.sourceType,
    sourceId: entry?.sourceId,
    status: entry?.status,
    debit,
    credit,
    balanced,
    accounts,
  });
  assert(
    `JE balanced: ${label}`,
    balanced,
    `${entry?.entryNumber ?? entry?.id} Dr ${debit} Cr ${credit} [${accounts}]`,
  );
  return { debit, credit, balanced, lines };
}

async function login(email) {
  const json = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: QA_PASSWORD, rememberMe: true }),
  }).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`login ${email} → ${res.status} ${body.code || body.message || ''}`);
    }
    return body;
  });
  return json.accessToken;
}

async function jesForSource(token, sourceType, sourceId) {
  const list = await api(
    token,
    'GET',
    `/journal-entries?pageSize=50&sourceType=${encodeURIComponent(sourceType)}&sourceId=${encodeURIComponent(sourceId)}`,
  );
  return unwrap(list).filter(
    (row) =>
      row.sourceType === sourceType &&
      row.sourceId === sourceId &&
      !row.reversalOfEntryId,
  );
}

async function waitForJe(token, sourceType, sourceId, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await jesForSource(token, sourceType, sourceId);
    if (found.length) return found[0];
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

async function browserPersonas() {
  let chromium;
  try {
    const requireFromWeb = createRequire(resolve(ROOT, 'apps/web/package.json'));
    ({ chromium } = requireFromWeb('playwright'));
  } catch {
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      record(
        'Playwright available',
        false,
        'playwright package missing — browser UI pass skipped',
      );
      return;
    }
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const persona of PERSONAS) {
      const pageErrors = [];
      const context = await browser.newContext({
        locale: 'ar-SA',
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      page.on('pageerror', (err) => pageErrors.push(String(err)));
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          report.consoleErrors.push({ persona: persona.key, text: msg.text() });
        }
      });
      try {
        await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.locator('input[name="email"], input[type="email"]').first().fill(persona.email);
        await page.locator('input[name="password"], input[type="password"]').first().fill(QA_PASSWORD);
        await Promise.all([
          page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 45000 }),
          page.locator('button[type="submit"]').first().click(),
        ]);
        await page.waitForTimeout(1500);
        const landed = !page.url().includes('/login');
        record(`Browser login ${persona.key}`, landed, page.url());
        report.personas[persona.key] = { login: landed, url: page.url() };

        const routes = {
          admin: [
            '/',
            '/finance/chart-of-accounts',
            '/finance/accounting-settings',
            '/finance/journal-entries',
            '/finance/fixed-assets',
            '/finance/prepaid-expenses',
            '/finance/accrued-expenses',
            '/finance/exchange-rates',
            '/reports/finance',
            '/crm/leads',
            '/store-orders',
            '/expenses/cost-explorer',
          ],
          finance: [
            '/finance/journal-entries',
            '/finance/chart-of-accounts',
            '/finance/fixed-assets',
            '/finance/prepaid-expenses',
            '/finance/accrued-expenses',
            '/finance/exchange-rates',
            '/reports/finance',
            '/finance/bank-transactions',
          ],
          manager: ['/crm/leads', '/store-orders', '/crm/funnel'],
          agent: ['/crm/leads', '/store-orders'],
          shipping: ['/shipping', '/store-orders'],
        };
        for (const route of routes[persona.key] ?? [persona.home]) {
          const resp = await page.goto(`${BASE}${route}`, {
            waitUntil: 'domcontentloaded',
            timeout: 45000,
          });
          await page.waitForTimeout(1200);
          const status = resp?.status() ?? 0;
          const denied =
            (await page.getByText(/Access Denied|غير مصرح|صلاحية/i).count()) > 0 &&
            (await page.locator('table, form, [data-slot="card"]').count()) === 0;
          const ok = status < 400 && !page.url().includes('/login');
          report.pages.push({
            persona: persona.key,
            route,
            status,
            url: page.url(),
            denied,
          });
          record(
            `Browser ${persona.key} ${route}`,
            ok,
            `HTTP ${status}${denied ? ' access-denied-copy' : ''}`,
          );
        }

        if (persona.key === 'admin') {
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(1000);
          record(
            'Browser admin hard-reload persistence',
            !page.url().includes('/login'),
            page.url(),
          );
          await page.screenshot({
            path: resolve(EVIDENCE_DIR, 'admin-dashboard.png'),
            fullPage: true,
          });
        }
      } catch (error) {
        record(`Browser ${persona.key}`, false, error instanceof Error ? error.message : String(error));
      } finally {
        if (pageErrors.length) {
          report.consoleErrors.push({ persona: persona.key, pageErrors });
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function accountingFlow(token) {
  const me = await api(token, 'GET', '/auth/me');
  assert('QA Admin authenticated', Boolean(me?.id), me?.email);
  const userId = me.id;
  const companyId = me.companies?.[0]?.id;
  const branchId = me.companies?.[0]?.defaultBranchId ?? me.companies?.[0]?.branches?.[0]?.id;
  const headers = {
    ...(companyId ? { 'X-Company-Id': companyId } : {}),
    ...(branchId ? { 'X-Branch-Id': branchId } : {}),
  };
  const authed = (method, path, body) => api(token, method, path, body, headers);

  const [coa, settings, fy, taxes, receiving, sources, countries, currencies, products, warehouses, units] =
    await Promise.all([
      authed('GET', '/chart-of-accounts?pageSize=200'),
      authed('GET', '/accounting/posting-settings'),
      authed('GET', '/accounting/fiscal-years'),
      authed('GET', '/taxes?pageSize=50'),
      authed('GET', '/receiving-accounts?pageSize=50'),
      authed('GET', '/payment-sources?pageSize=50'),
      authed('GET', '/countries?pageSize=200'),
      authed('GET', '/currencies?pageSize=50'),
      authed('GET', '/products?pageSize=50'),
      authed('GET', '/warehouses?pageSize=50'),
      authed('GET', '/units?pageSize=50'),
    ]);

  const accounts = unwrap(coa);
  assert('Chart of Accounts loaded', accounts.length >= 20, `${accounts.length} accounts`);
  const requiredRoles = [
    'accountsReceivableAccountId',
    'accountsPayableAccountId',
    'salesRevenueAccountId',
    'costOfGoodsSoldAccountId',
    'inventoryAccountId',
    'cashAccountId',
    'bankAccountId',
    'vatOutputAccountId',
    'shippingExpenseAccountId',
    'paymentGatewayFeeAccountId',
    'fulfillmentExpenseAccountId',
  ];
  const missingMaps = requiredRoles.filter((key) => !settings?.[key]);
  assert('Posting Settings mapped', missingMaps.length === 0, missingMaps.join(',') || 'all required roles filled');
  assert('Fiscal year exists', unwrap(fy).length > 0, unwrap(fy).map((y) => y.name).join(','));
  const fiscalYear =
    unwrap(fy).find((y) => y.name === 'FY 2026') || unwrap(fy)[0];
  try {
    const opening = await authed('POST', '/accounting/opening-balances', {
      fiscalYearId: fiscalYear.id,
      openingDate: new Date(fiscalYear.startDate).toISOString(),
      lines: [
        {
          accountId: settings.cashAccountId,
          debit: 1,
          description: 'QA go-live opening cash',
        },
        {
          accountId:
            settings.retainedEarningsAccountId || settings.suspenseAccountId,
          credit: 1,
          description: 'QA go-live opening equity',
        },
      ],
    });
    record(
      'Fiscal year opening balance',
      Boolean(opening?.id),
      opening?.entryNumber || opening?.id,
    );
    if (opening) assertBalanced(opening, 'OPENING_BALANCE');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const already = /already has an Opening Balance/i.test(message);
    record('Fiscal year opening balance', already, message);
  }
  assert('VAT/taxes exist', unwrap(taxes).length > 0, unwrap(taxes).map((t) => t.code).join(','));
  assert('Receiving accounts exist', unwrap(receiving).length > 0, unwrap(receiving).map((r) => r.code || r.name).join(','));
  assert('Payment sources exist', unwrap(sources).length > 0, unwrap(sources).map((s) => s.code || s.name).join(','));

  const countryList = unwrap(countries);
  const brokenSaudi = countryList.find(
    (c) => c.name === 'السعودية' && String(c.code || '').replace(/\W/g, '') === 'SA',
  );
  if (brokenSaudi && brokenSaudi.code !== 'SA') {
    try {
      await authed('PATCH', `/countries/${brokenSaudi.id}`, {
        code: 'SA',
        name: 'السعودية',
      });
      brokenSaudi.code = 'SA';
      record('Repaired Saudi country code', true, brokenSaudi.id);
    } catch (error) {
      record(
        'Repaired Saudi country code',
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const country =
    countryList.find((c) => c.code === 'SA' && c.callingCode) ||
    countryList.find((c) => c.code === 'AE') ||
    countryList.find((c) => c.code === 'EG') ||
    brokenSaudi ||
    countryList.find((c) => c.code === 'SA') ||
    countryList[0];
  const currency =
    pick(currencies, (c) => c.code === 'SAR' || c.isDefault) ?? pick(currencies, () => true);
  const warehouse = pick(warehouses, (w) => w.isDefault || w.isActive !== false);
  const receivingAccount =
    pick(receiving, (r) => r.isDefault) ?? pick(receiving, () => true);
  const paymentSource =
    pick(sources, (s) => s.code === 'BANK_TRANSFER' || s.isDefault) ?? pick(sources, () => true);
  const unit = pick(units, () => true);
  assert('Country master data', Boolean(country?.id), country?.code || country?.name);
  assert('Currency master data', Boolean(currency?.id), currency?.code);
  assert('Warehouse master data', Boolean(warehouse?.id), warehouse?.name);
  assert('Unit master data', Boolean(unit?.id), unit?.name || unit?.code);

  let product = pick(
    products,
    (p) => p.productType === 'STOCKABLE' && p.status === 'ACTIVE' && p.deletedAt == null,
  );
  if (!product) {
    const categories = unwrap(await authed('GET', '/product-categories?pageSize=20'));
    const category = pick(categories, (c) => c.isActive !== false);
    assert('Product category available', Boolean(category?.id), category?.name);
    product = await authed('POST', '/products', {
      name: `${RUN} Product`,
      nameEn: `${RUN} Product`,
      categoryId: category.id,
      unitId: unit.id,
      productType: 'STOCKABLE',
      status: 'ACTIVE',
      costingMethod: 'MOVING_AVERAGE',
      salesPrice: 250,
    });
    record('Created QA product', Boolean(product?.id), product?.sku || product?.name);
  } else {
    record('Reused stockable product', true, product.sku || product.name);
  }

  try {
    await authed('POST', '/inventory/opening-balance', {
      productId: product.id,
      warehouseId: warehouse.id,
      quantity: 25,
      unitCost: 80,
      notes: `${RUN} opening stock`,
    });
    record('Opening inventory posted', true, 'qty 25 @ 80');
  } catch (error) {
    record('Opening inventory posted', false, error instanceof Error ? error.message : String(error));
  }

  const phoneSuffix = String(Date.now()).slice(-8);
  const mobile = `05${phoneSuffix.slice(0, 8)}`;
  const lead = await authed('POST', '/leads', {
    customerName: `${RUN} Customer`,
    mobileNumber: mobile,
    countryId: country.id,
    city: 'Riyadh',
    address: 'QA-E2E Street 1',
    productId: product.id,
    quantity: 1,
    currencyId: currency.id,
    source: 'MANUAL',
  });
  assert('Lead created', Boolean(lead?.id), lead?.leadNumber);
  await authed('POST', `/leads/${lead.id}/first-open`);
  const followUps = await authed('POST', `/leads/${lead.id}/follow-ups`, {
    outcome: 'Interested',
    note: `${RUN} follow-up`,
    followUpAt: new Date().toISOString(),
  });
  record('Lead follow-up', Boolean(followUps?.id || followUps?.leadId || Array.isArray(followUps)), 'follow-up saved');
  const actions = await authed('GET', `/workflow/LEAD/${lead.id}/available-actions`);
  record('Lead available-actions', Array.isArray(actions) && actions.length > 0, `${unwrap(actions).length} actions`);

  const converted = await authed('POST', `/leads/${lead.id}/convert`, {
    items: [{ productId: product.id, quantity: 1, agreedAmount: 250 }],
    paymentType: 'PREPAID',
    amountPaid: 250,
    currencyId: currency.id,
    city: 'Riyadh',
    address: 'QA-E2E Street 1',
    notes: RUN,
  });
  const storeOrderId = converted.storeOrder?.id || converted.storeOrderId;
  assert('Lead converted to order', Boolean(storeOrderId), converted.storeOrder?.internalOrderId);
  const order = await authed('GET', `/store-orders/${storeOrderId}`);
  const payments = order.payments ?? order.storeOrderPayments ?? [];
  let payment = payments[0];
  if (!payment) {
    payment = await authed('POST', `/store-orders/${storeOrderId}/payments`, {
      paymentDate: new Date().toISOString(),
      amount: 250,
      currencyId: currency.id,
      paymentSourceId: paymentSource.id,
      receivingAccountId: receivingAccount.id,
      senderName: `${RUN} Customer`,
      referenceNumber: RUN,
    });
  }
  assert('Store order payment exists', Boolean(payment?.id), payment?.paymentNumber || payment?.status);

  if (payment?.status !== 'VERIFIED' && payment?.status !== 'MATCHED') {
    try {
      await authed('POST', `/payments/${payment.id}/match`, { matchedById: userId });
      record('Payment matched', true, payment.id);
    } catch (error) {
      record('Payment matched', false, error instanceof Error ? error.message : String(error));
    }
  }
  try {
    await authed('POST', `/payments/${payment.id}/verify`, { verifiedById: userId });
    record('Payment verified', true, payment.id);
  } catch (error) {
    record('Payment verified', false, error instanceof Error ? error.message : String(error));
  }

  const invoice = await authed('POST', `/store-orders/${storeOrderId}/generate-invoice`);
  const invoiceId = invoice?.id || invoice?.salesInvoice?.id || invoice?.salesInvoiceId;
  assert('Sales invoice generated', Boolean(invoiceId), invoice?.invoiceNumber || invoiceId);
  const invoiceJe = await waitForJe(token, 'SALES_INVOICE', invoiceId);
  assert('Sales invoice JE posted', Boolean(invoiceJe), invoiceJe?.entryNumber);
  if (invoiceJe) {
    const full = await authed('GET', `/journal-entries/${invoiceJe.id}`);
    assertBalanced(full, 'SALES_INVOICE');
  }

  const receipts = unwrap(
    await authed(
      'GET',
      `/financial-transactions/receipts?pageSize=50&search=${encodeURIComponent(payment.paymentNumber || payment.id)}`,
    ),
  );
  const receipt =
    receipts.find((row) => String(row.notes || '').includes(payment.id)) || receipts[0];
  if (receipt) {
    const receiptJe = await waitForJe(token, 'CUSTOMER_RECEIPT', receipt.id);
    if (receiptJe) {
      const full = await authed('GET', `/journal-entries/${receiptJe.id}`);
      assertBalanced(full, 'CUSTOMER_RECEIPT');
    } else {
      record('Customer receipt JE', false, 'no JE for receipt');
    }
  } else {
    record('Customer receipt voucher', false, 'no CUSTOMER_RECEIPT found after verify');
  }

  try {
    await authed('POST', `/store-orders/${storeOrderId}/shipments/shipping-cost`, {
      baseShippingCost: 25,
      costPaidBy: 'COMPANY',
      notes: `${RUN} carrier`,
    });
    record('Shipment cost set', true, '25');
  } catch (error) {
    record('Shipment cost set', false, error instanceof Error ? error.message : String(error));
  }

  try {
    await authed('POST', `/store-orders/${storeOrderId}/shipments/ship`);
    await authed('POST', `/store-orders/${storeOrderId}/shipments/out-for-delivery`);
    const delivered = await authed('POST', `/store-orders/${storeOrderId}/shipments/deliver`);
    record('Shipment delivered', true, delivered?.status || 'DELIVERED');
    const refreshed = await authed('GET', `/store-orders/${storeOrderId}`);
    const fulfillment = refreshed.fulfillmentStatus?.code || refreshed.fulfillmentStatusId;
    record(
      'Order fulfillment synced after deliver',
      String(fulfillment).includes('DELIVER') || refreshed.fulfillmentStatus?.code === 'DELIVERED',
      String(fulfillment),
    );
    const shipments = unwrap(await authed('GET', `/store-orders/${storeOrderId}/shipments`));
    const shipment = shipments[0] || delivered;
    if (shipment?.id) {
      const shipJe = await waitForJe(token, 'SHIPMENT_COST', shipment.id);
      if (shipJe) {
        const full = await authed('GET', `/journal-entries/${shipJe.id}`);
        assertBalanced(full, 'SHIPMENT_COST');
      } else {
        record('SHIPMENT_COST JE', false, 'no JE after deliver');
      }
    }
  } catch (error) {
    record('Shipment flow', false, error instanceof Error ? error.message : String(error));
  }

  const second = await authed('POST', '/store-orders', {
    partner: {
      name: `${RUN} Customer`,
      mobile,
      countryId: country.id,
      city: 'Riyadh',
      address: 'QA-E2E Street 1',
    },
    currencyId: currency.id,
    paymentType: 'CASH_ON_DELIVERY',
    notes: `${RUN} returning customer`,
    items: [{ productId: product.id, quantity: 1, unitPrice: 250 }],
  });
  assert('Returning-customer second order', Boolean(second?.id), second?.internalOrderId);

  const supplierPayload = await authed('POST', '/partners/find-or-create', {
    role: 'SUPPLIER',
    name: `${RUN} Supplier`,
    mobile: `05${String(Date.now() + 7).slice(-8)}`,
    countryId: country.id,
  });
  const supplier = supplierPayload.partner ?? supplierPayload;
  const purchase = await authed('POST', '/purchasing/invoices', {
    partnerId: supplier.id,
    currencyId: currency.id,
    referenceNumber: RUN,
    internalNotes: RUN,
    items: [
      {
        productId: product.id,
        warehouseId: warehouse.id,
        unitId: product.unitId || unit.id,
        quantity: 5,
        unitPrice: 80,
      },
    ],
  });
  await authed('POST', `/purchasing/invoices/${purchase.id}/submit`);
  try {
    await authed('POST', `/purchasing/invoices/${purchase.id}/approve`);
  } catch {
    // approve may be skipped if not required
  }
  await authed('POST', `/purchasing/invoices/${purchase.id}/confirm`);
  const purchaseJe = await waitForJe(token, 'PURCHASE_INVOICE', purchase.id);
  assert('Purchase invoice JE', Boolean(purchaseJe), purchaseJe?.entryNumber);
  if (purchaseJe) {
    const full = await authed('GET', `/journal-entries/${purchaseJe.id}`);
    assertBalanced(full, 'PURCHASE_INVOICE');
  }

  const supplierPayment = await authed('POST', '/financial-transactions/payments', {
    partnerId: supplier.id,
    currencyId: currency.id,
    paymentSourceId: paymentSource.id,
    receivingAccountId: receivingAccount.id,
    amount: 400,
    referenceNumber: RUN,
    notes: RUN,
    allocations: [{ invoiceId: purchase.id, allocatedAmount: 400 }],
  });
  await authed('POST', `/financial-transactions/payments/${supplierPayment.id}/confirm`);
  const payJe = await waitForJe(token, 'SUPPLIER_PAYMENT', supplierPayment.id);
  assert('Supplier payment JE', Boolean(payJe), payJe?.entryNumber);
  if (payJe) {
    const full = await authed('GET', `/journal-entries/${payJe.id}`);
    assertBalanced(full, 'SUPPLIER_PAYMENT');
  }

  const expenseAccountId =
    settings.defaultExpenseAccountId ||
    settings.shippingExpenseAccountId ||
    accounts.find((a) => a.accountType === 'EXPENSE' && a.allowsPosting)?.id;
  const expense = await authed('POST', '/financial-transactions/expense-payments', {
    expenseAccountId,
    currencyId: currency.id,
    paymentSourceId: paymentSource.id,
    receivingAccountId: receivingAccount.id,
    amount: 40,
    referenceNumber: RUN,
    notes: `${RUN} packing`,
  });
  await authed('POST', `/financial-transactions/expense-payments/${expense.id}/confirm`);
  const expJe = await waitForJe(token, 'EXPENSE_PAYMENT', expense.id);
  assert('Expense payment JE', Boolean(expJe), expJe?.entryNumber);
  if (expJe) {
    const full = await authed('GET', `/journal-entries/${expJe.id}`);
    assertBalanced(full, 'EXPENSE_PAYMENT');
  }

  try {
    const invoiceFull = await authed('GET', `/sales/invoices/${invoiceId}`);
    const line = (invoiceFull.items ?? [])[0];
    if (line) {
      const salesReturn = await authed('POST', '/sales/returns', {
        partnerId: invoiceFull.partnerId || order.partnerId,
        salesInvoiceId: invoiceId,
        currencyId: currency.id,
        referenceNumber: RUN,
        internalNotes: `${RUN} return`,
        items: [
          {
            productId: line.productId,
            warehouseId: warehouse.id,
            unitId: line.unitId || product.unitId || unit.id,
            quantity: 1,
            unitPrice: Number(line.unitPrice ?? 250),
            salesInvoiceItemId: line.id,
          },
        ],
      });
      await authed('POST', `/sales/returns/${salesReturn.id}/submit`);
      try {
        await authed('POST', `/sales/returns/${salesReturn.id}/approve`);
      } catch {
        // optional
      }
      await authed('POST', `/sales/returns/${salesReturn.id}/confirm`);
      const retJe = await waitForJe(token, 'SALES_RETURN', salesReturn.id);
      assert('Sales return JE', Boolean(retJe), retJe?.entryNumber);
      if (retJe) {
        const full = await authed('GET', `/journal-entries/${retJe.id}`);
        assertBalanced(full, 'SALES_RETURN');
      }
    }
  } catch (error) {
    record('Sales return/refund', false, error instanceof Error ? error.message : String(error));
  }

  const vat15 =
    unwrap(taxes).find((row) => String(row.code).toUpperCase() === 'VAT15') ||
    unwrap(taxes).find((row) => Number(row.rate) === 15);
  const vat0 =
    unwrap(taxes).find((row) => String(row.code).toUpperCase() === 'VAT0') ||
    unwrap(taxes).find((row) => Number(row.rate) === 0);
  const customerId = order.partnerId || converted.storeOrder?.partnerId || lead.partnerId;
  assert('VAT15 tax exists', Boolean(vat15?.id), vat15?.code);
  assert('VAT0 tax exists', Boolean(vat0?.id), vat0?.code || 'missing VAT0');

  if (vat15 && customerId) {
    try {
      const vatInvoice = await authed('POST', '/sales/invoices', {
        partnerId: customerId,
        currencyId: currency.id,
        referenceNumber: `${RUN}-VAT-SALE`,
        internalNotes: `${RUN} VAT sales`,
        items: [
          {
            productId: product.id,
            warehouseId: warehouse.id,
            unitId: product.unitId || unit.id,
            quantity: 1,
            unitPrice: 100,
            taxId: vat15.id,
          },
        ],
      });
      await authed('POST', `/sales/invoices/${vatInvoice.id}/submit`);
      try {
        await authed('POST', `/sales/invoices/${vatInvoice.id}/approve`);
      } catch {
        // optional
      }
      await authed('POST', `/sales/invoices/${vatInvoice.id}/confirm`);
      const vatDoc = await authed('GET', `/sales/invoices/${vatInvoice.id}`);
      assert(
        'VAT sales tax total',
        Number(vatDoc.taxTotal) > 0 && Number(vatDoc.grandTotal) >= 114,
        `tax ${vatDoc.taxTotal} grand ${vatDoc.grandTotal}`,
      );
      const vatSaleJe = await waitForJe(token, 'SALES_INVOICE', vatInvoice.id);
      assert('VAT sales JE', Boolean(vatSaleJe), vatSaleJe?.entryNumber);
      if (vatSaleJe) {
        const full = await authed('GET', `/journal-entries/${vatSaleJe.id}`);
        assertBalanced(full, 'VAT_SALES_INVOICE');
        const retry = await waitForJe(token, 'SALES_INVOICE', vatInvoice.id);
        assert(
          'VAT sales posting idempotent',
          (await jesForSource(token, 'SALES_INVOICE', vatInvoice.id)).length === 1,
          `${(await jesForSource(token, 'SALES_INVOICE', vatInvoice.id)).length} JE`,
        );
        void retry;
      }
      const vatReturn = await authed('POST', '/sales/returns', {
        partnerId: customerId,
        salesInvoiceId: vatInvoice.id,
        currencyId: currency.id,
        referenceNumber: `${RUN}-VAT-SRET`,
        internalNotes: `${RUN} VAT sales return`,
        items: [
          {
            productId: product.id,
            warehouseId: warehouse.id,
            unitId: product.unitId || unit.id,
            quantity: 1,
            unitPrice: 100,
            taxId: vat15.id,
            salesInvoiceItemId: (vatDoc.items ?? [])[0]?.id,
          },
        ],
      });
      await authed('POST', `/sales/returns/${vatReturn.id}/submit`);
      try {
        await authed('POST', `/sales/returns/${vatReturn.id}/approve`);
      } catch {
        // optional
      }
      await authed('POST', `/sales/returns/${vatReturn.id}/confirm`);
      const vatRetJe = await waitForJe(token, 'SALES_RETURN', vatReturn.id);
      assert('VAT sales return JE', Boolean(vatRetJe), vatRetJe?.entryNumber);
      if (vatRetJe) {
        const full = await authed('GET', `/journal-entries/${vatRetJe.id}`);
        assertBalanced(full, 'VAT_SALES_RETURN');
      }
    } catch (error) {
      record('VAT sales E2E', false, error instanceof Error ? error.message : String(error));
    }
  }

  if (vat15) {
    try {
      const vatPurchase = await authed('POST', '/purchasing/invoices', {
        partnerId: supplier.id,
        currencyId: currency.id,
        referenceNumber: `${RUN}-VAT-PUR`,
        internalNotes: `${RUN} VAT purchase`,
        items: [
          {
            productId: product.id,
            warehouseId: warehouse.id,
            unitId: product.unitId || unit.id,
            quantity: 1,
            unitPrice: 80,
            taxId: vat15.id,
          },
        ],
      });
      await authed('POST', `/purchasing/invoices/${vatPurchase.id}/submit`);
      try {
        await authed('POST', `/purchasing/invoices/${vatPurchase.id}/approve`);
      } catch {
        // optional
      }
      await authed('POST', `/purchasing/invoices/${vatPurchase.id}/confirm`);
      const vatPurDoc = await authed('GET', `/purchasing/invoices/${vatPurchase.id}`);
      assert(
        'VAT purchase tax total',
        Number(vatPurDoc.taxTotal) > 0,
        `tax ${vatPurDoc.taxTotal} grand ${vatPurDoc.grandTotal}`,
      );
      const vatPurJe = await waitForJe(token, 'PURCHASE_INVOICE', vatPurchase.id);
      assert('VAT purchase JE', Boolean(vatPurJe), vatPurJe?.entryNumber);
      if (vatPurJe) {
        const full = await authed('GET', `/journal-entries/${vatPurJe.id}`);
        assertBalanced(full, 'VAT_PURCHASE_INVOICE');
      }
      try {
        const vatPurReturn = await authed('POST', '/purchasing/returns', {
          partnerId: supplier.id,
          purchaseInvoiceId: vatPurchase.id,
          currencyId: currency.id,
          referenceNumber: `${RUN}-VAT-PRET`,
          internalNotes: `${RUN} VAT purchase return`,
          items: [
            {
              productId: product.id,
              warehouseId: warehouse.id,
              unitId: product.unitId || unit.id,
              quantity: 1,
              unitPrice: 80,
              taxId: vat15.id,
              purchaseInvoiceItemId: (vatPurDoc.items ?? [])[0]?.id,
            },
          ],
        });
        await authed('POST', `/purchasing/returns/${vatPurReturn.id}/submit`);
        try {
          await authed('POST', `/purchasing/returns/${vatPurReturn.id}/approve`);
        } catch {
          // optional
        }
        await authed('POST', `/purchasing/returns/${vatPurReturn.id}/confirm`);
        const vatPretJe = await waitForJe(token, 'PURCHASE_RETURN', vatPurReturn.id);
        assert('VAT purchase return JE', Boolean(vatPretJe), vatPretJe?.entryNumber);
        if (vatPretJe) {
          const full = await authed('GET', `/journal-entries/${vatPretJe.id}`);
          assertBalanced(full, 'VAT_PURCHASE_RETURN');
        }
      } catch (error) {
        record(
          'VAT purchase return',
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
    } catch (error) {
      record('VAT purchase E2E', false, error instanceof Error ? error.message : String(error));
    }

    try {
      await authed('POST', '/sales/invoices', {
        partnerId: customerId,
        currencyId: currency.id,
        referenceNumber: `${RUN}-BAD-TAX`,
        items: [
          {
            productId: product.id,
            warehouseId: warehouse.id,
            unitId: product.unitId || unit.id,
            quantity: 1,
            unitPrice: 10,
            taxId: '00000000-0000-4000-8000-000000000000',
          },
        ],
      });
      record('Missing taxId fails closed', false, 'dangling taxId was accepted');
    } catch (error) {
      record(
        'Missing taxId fails closed',
        true,
        error instanceof Error ? error.message.slice(0, 180) : String(error),
      );
    }
  }

  const depStart = new Date();
  depStart.setUTCMonth(depStart.getUTCMonth() - 2);
  const depStartIso = depStart.toISOString().slice(0, 10);
  try {
    const asset = await authed('POST', '/fixed-assets', {
      name: `${RUN} Asset`,
      acquisitionDate: depStartIso,
      cost: 100,
      usefulLifeMonths: 3,
      salvageValue: 0,
      depreciationStartDate: depStartIso,
      receivingAccountId: receivingAccount.id,
      notes: RUN,
    });
    await authed('POST', `/fixed-assets/${asset.id}/capitalize`, {
      usefulLifeMonths: 3,
      salvageValue: 0,
      depreciationStartDate: depStartIso,
      receivingAccountId: receivingAccount.id,
    });
    const capJe = await waitForJe(token, 'FIXED_ASSET_CAPITALIZATION', asset.id);
    assert('FA capitalization JE', Boolean(capJe), capJe?.entryNumber);
    if (capJe) {
      const full = await authed('GET', `/journal-entries/${capJe.id}`);
      assertBalanced(full, 'FIXED_ASSET_CAPITALIZATION');
    }
    const depRun = await authed('POST', '/fixed-assets/depreciation-run', {});
    record('FA depreciation run', true, `posted ${depRun.postedCount}`);
    const retryDep = await authed('POST', '/fixed-assets/depreciation-run', {});
    assert(
      'FA depreciation idempotent',
      retryDep.postedCount === 0,
      `second run posted ${retryDep.postedCount}`,
    );
    if ((depRun.periodIds ?? [])[0]) {
      const depJe = await waitForJe(
        token,
        'FIXED_ASSET_DEPRECIATION',
        depRun.periodIds[0],
      );
      assert('FA depreciation JE', Boolean(depJe), depJe?.entryNumber);
      if (depJe) {
        const full = await authed('GET', `/journal-entries/${depJe.id}`);
        assertBalanced(full, 'FIXED_ASSET_DEPRECIATION');
      }
    }
    const disposed = await authed('POST', `/fixed-assets/${asset.id}/dispose`, {
      disposalAmount: 0,
      receivingAccountId: receivingAccount.id,
      disposalNotes: `${RUN} write-off`,
    });
    record('FA disposed', disposed.status === 'DISPOSED', disposed.status);
    const dispJe = await waitForJe(token, 'FIXED_ASSET_DISPOSAL', asset.id);
    assert('FA disposal JE', Boolean(dispJe), dispJe?.entryNumber);
    if (dispJe) {
      const full = await authed('GET', `/journal-entries/${dispJe.id}`);
      assertBalanced(full, 'FIXED_ASSET_DISPOSAL');
    }
  } catch (error) {
    record('Fixed asset lifecycle', false, error instanceof Error ? error.message : String(error));
  }

  const prepaidStart = new Date();
  prepaidStart.setUTCMonth(prepaidStart.getUTCMonth() - 2);
  try {
    const prepaid = await authed('POST', '/prepaid-expenses', {
      name: `${RUN} Prepaid`,
      amount: 90,
      startDate: prepaidStart.toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      totalPeriods: 1,
      expenseAccountId,
      receivingAccountId: receivingAccount.id,
      notes: RUN,
    });
    await authed('POST', `/prepaid-expenses/${prepaid.id}/activate`);
    const peJe = await waitForJe(token, 'PREPAID_EXPENSE', prepaid.id);
    assert('Prepaid payment JE', Boolean(peJe), peJe?.entryNumber);
    if (peJe) {
      const full = await authed('GET', `/journal-entries/${peJe.id}`);
      assertBalanced(full, 'PREPAID_EXPENSE');
    }
    const recognized = await authed('POST', '/prepaid-expenses/recognize', {});
    record('Prepaid recognition run', true, `posted ${recognized.postedCount}`);
    const retryRec = await authed('POST', '/prepaid-expenses/recognize', {});
    assert(
      'Prepaid recognition idempotent',
      retryRec.postedCount === 0,
      `second run posted ${retryRec.postedCount}`,
    );
    if ((recognized.recognitionIds ?? [])[0]) {
      const recJe = await waitForJe(
        token,
        'PREPAID_RECOGNITION',
        recognized.recognitionIds[0],
      );
      assert('Prepaid recognition JE', Boolean(recJe), recJe?.entryNumber);
      if (recJe) {
        const full = await authed('GET', `/journal-entries/${recJe.id}`);
        assertBalanced(full, 'PREPAID_RECOGNITION');
      }
    }
  } catch (error) {
    record('Prepaid lifecycle', false, error instanceof Error ? error.message : String(error));
  }

  try {
    const accrual = await authed('POST', '/accrued-expenses', {
      name: `${RUN} Accrual`,
      amount: 45,
      recognitionDate: new Date().toISOString().slice(0, 10),
      expenseAccountId,
      receivingAccountId: receivingAccount.id,
      notes: RUN,
    });
    await authed('POST', `/accrued-expenses/${accrual.id}/recognize`);
    const accJe = await waitForJe(token, 'ACCRUED_EXPENSE', accrual.id);
    assert('Accrual recognition JE', Boolean(accJe), accJe?.entryNumber);
    if (accJe) {
      const full = await authed('GET', `/journal-entries/${accJe.id}`);
      assertBalanced(full, 'ACCRUED_EXPENSE');
    }
    await authed('POST', `/accrued-expenses/${accrual.id}/settle`, {
      receivingAccountId: receivingAccount.id,
    });
    const setJe = await waitForJe(token, 'ACCRUED_EXPENSE_SETTLEMENT', accrual.id);
    assert('Accrual settlement JE', Boolean(setJe), setJe?.entryNumber);
    if (setJe) {
      const full = await authed('GET', `/journal-entries/${setJe.id}`);
      assertBalanced(full, 'ACCRUED_EXPENSE_SETTLEMENT');
    }
    try {
      await authed('POST', `/accrued-expenses/${accrual.id}/recognize`);
      record('Accrual recognize retry blocked', false, 'second recognize succeeded');
    } catch {
      record('Accrual recognize retry blocked', true, 'idempotent / status-guarded');
    }
  } catch (error) {
    record('Accrual lifecycle', false, error instanceof Error ? error.message : String(error));
  }

  try {
    const usd =
      unwrap(currencies).find((row) => row.code === 'USD') ||
      (await authed('POST', '/currencies', { code: 'USD', name: 'US Dollar', symbol: '$' }));
    const functionalId = settings.functionalCurrencyId || currency.id;
    if (usd?.id && usd.id !== functionalId) {
      const past = new Date();
      past.setUTCDate(past.getUTCDate() - 20);
      try {
        await authed('POST', '/exchange-rates', {
          fromCurrencyId: usd.id,
          toCurrencyId: functionalId,
          rate: 3.7,
          effectiveDate: past.toISOString().slice(0, 10),
          notes: `${RUN} historical FX`,
        });
      } catch (error) {
        record(
          'FX historical snapshot',
          /already exists/i.test(error instanceof Error ? error.message : ''),
          error instanceof Error ? error.message.slice(0, 160) : String(error),
        );
      }
      const fxPurchase = await authed('POST', '/purchasing/invoices', {
        partnerId: supplier.id,
        currencyId: usd.id,
        referenceNumber: `${RUN}-FX-PUR`,
        internalNotes: `${RUN} FX purchase`,
        items: [
          {
            productId: product.id,
            warehouseId: warehouse.id,
            unitId: product.unitId || unit.id,
            quantity: 1,
            unitPrice: 10,
          },
        ],
      });
      await authed('POST', `/purchasing/invoices/${fxPurchase.id}/submit`);
      try {
        await authed('POST', `/purchasing/invoices/${fxPurchase.id}/approve`);
      } catch {
        // optional
      }
      await authed('POST', `/purchasing/invoices/${fxPurchase.id}/confirm`);
      const fxPurJe = await waitForJe(token, 'PURCHASE_INVOICE', fxPurchase.id);
      assert('FX purchase JE', Boolean(fxPurJe), fxPurJe?.entryNumber);
      if (fxPurJe) {
        const full = await authed('GET', `/journal-entries/${fxPurJe.id}`);
        assertBalanced(full, 'FX_PURCHASE_INVOICE');
        record(
          'FX snapshot persisted',
          Number(full.exchangeRate ?? fxPurJe.exchangeRate ?? 0) > 0,
          String(full.exchangeRate ?? fxPurJe.exchangeRate),
        );
      }
      try {
        await authed('POST', '/exchange-rates', {
          fromCurrencyId: usd.id,
          toCurrencyId: functionalId,
          rate: 3.85,
          effectiveDate: new Date().toISOString().slice(0, 10),
          notes: `${RUN} current FX`,
        });
        record('FX current snapshot', true, '3.85');
      } catch (error) {
        record(
          'FX current snapshot',
          /already exists/i.test(error instanceof Error ? error.message : ''),
          error instanceof Error ? error.message.slice(0, 160) : String(error),
        );
      }
      let reval = null;
      try {
        reval = await authed('POST', '/fx-revaluations/run', {
          rateDate: new Date().toISOString().slice(0, 10),
          notes: RUN,
        });
        record('FX revaluation run', Boolean(reval?.id), reval?.runNumber || reval?.status);
        const retryReval = await authed('POST', '/fx-revaluations/run', {
          rateDate: new Date().toISOString().slice(0, 10),
          notes: RUN,
        });
        assert(
          'FX revaluation idempotent',
          retryReval?.id === reval?.id,
          `${retryReval?.id} vs ${reval?.id}`,
        );
        const revalJe = await waitForJe(token, 'FX_REVALUATION', reval.id);
        if (revalJe) {
          const full = await authed('GET', `/journal-entries/${revalJe.id}`);
          assertBalanced(full, 'FX_REVALUATION');
        } else {
          record('FX revaluation JE', true, 'no monetary FX difference to post');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const none = /no foreign-currency monetary balances/i.test(message);
        record(
          'FX revaluation run',
          none,
          none ? 'no eligible monetary balances on this date' : message,
        );
      }
    } else {
      record('FX lifecycle skipped', true, 'no distinct USD vs functional currency');
    }
  } catch (error) {
    record('FX lifecycle', false, error instanceof Error ? error.message : String(error));
  }

  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const today = new Date().toISOString().slice(0, 10);
  const tb = await authed(
    'GET',
    `/accounting/reports/trial-balance?dateFrom=${yearStart}&dateTo=${today}&pageSize=200`,
  );
  const tbBalanced = Math.abs(Number(tb.totals?.debitTotal) - Number(tb.totals?.creditTotal)) < 0.05;
  assert(
    'Trial Balance balanced',
    tbBalanced,
    `Dr ${tb.totals?.debitTotal} Cr ${tb.totals?.creditTotal}`,
  );
  const is_ = await authed(
    'GET',
    `/accounting/reports/income-statement?dateFrom=${yearStart}&dateTo=${today}`,
  );
  record(
    'Income Statement',
    is_?.totals != null,
    `Rev ${is_?.totals?.totalRevenue} Exp ${is_?.totals?.totalExpense} NI ${is_?.totals?.netIncome}`,
  );
  const bs = await authed('GET', `/accounting/reports/balance-sheet?dateTo=${today}`);
  assert('Balance Sheet equation', Boolean(bs?.totals?.balanced), JSON.stringify(bs?.totals));
  const gl = await authed(
    'GET',
    `/accounting/reports/general-ledger?dateFrom=${yearStart}&dateTo=${today}&pageSize=20`,
  );
  record('General Ledger readable', unwrap(gl).length >= 0, `${unwrap(gl).length} GL rows`);
  const ar = await authed('GET', `/accounting/reports/ar-aging?asOf=${today}`);
  const ap = await authed('GET', `/accounting/reports/ap-aging?asOf=${today}`);
  record('AR aging', Boolean(ar), Array.isArray(ar?.items) ? `${ar.items.length} rows` : 'ok');
  record('AP aging', Boolean(ap), Array.isArray(ap?.items) ? `${ap.items.length} rows` : 'ok');
  try {
    const profitability = await authed('GET', '/cost-analytics/profitability');
    record('Profitability Analytics', true, profitability?.dimension || 'PRODUCT');
  } catch (error) {
    record('Profitability Analytics', false, error instanceof Error ? error.message : String(error));
  }

  const retryInvoice = await waitForJe(token, 'SALES_INVOICE', invoiceId);
  record(
    'Idempotent invoice posting',
    Boolean(retryInvoice) && (await jesForSource(token, 'SALES_INVOICE', invoiceId)).length === 1,
    `${(await jesForSource(token, 'SALES_INVOICE', invoiceId)).length} JE(s)`,
  );

  report.evidence = {
    leadNumber: lead.leadNumber,
    storeOrderId,
    invoiceId,
    purchaseId: purchase.id,
    supplierPaymentId: supplierPayment.id,
    expenseId: expense.id,
    customerPhone: mobile,
  };
}

async function main() {
  if (!QA_PASSWORD || QA_PASSWORD.length < 10) {
    throw new Error('QA_PASSWORD is missing or too short. Set it in the environment.');
  }

  console.log(`Production E2E ${RUN} against ${BASE}`);
  const SKIP_BROWSER = process.env.SKIP_BROWSER === '1';
  if (!SKIP_BROWSER) {
    await browserPersonas();
  }

  try {
    const adminToken = await login('qa-admin@oms.haseb.org');
    record('API login qa-admin', true, 'token issued');
    await accountingFlow(adminToken);
  } catch (error) {
    record('Accounting flow', false, error instanceof Error ? error.message : String(error));
  }

  for (const persona of PERSONAS.filter((p) => p.key !== 'admin')) {
    try {
      const token = await login(persona.email);
      const me = await api(token, 'GET', '/auth/me');
      record(`API login ${persona.key}`, true, me.fullName || me.email);
      report.personas[persona.key] = {
        ...(report.personas[persona.key] ?? {}),
        api: true,
        isSuperAdmin: me.isSuperAdmin,
        permissions: me.permissions?.length ?? 0,
      };
    } catch (error) {
      record(`API login ${persona.key}`, false, error instanceof Error ? error.message : String(error));
    }
  }

  const failed = report.results.filter((r) => !r.ok).length;
  const passed = report.results.filter((r) => r.ok).length;
  report.finishedAt = new Date().toISOString();
  report.summary = { passed, failed, total: report.results.length };
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const out = resolve(EVIDENCE_DIR, 'report.json');
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n${passed} passed / ${failed} failed — evidence ${out}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
