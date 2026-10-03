/**
 * READ-ONLY audit (Round 7 D): which posted Journal Entries touch a
 * currency-bound (non-functional) account while the entry itself is in a
 * different currency — i.e. entries the account-currency policy would flag and
 * whose native amount a foreign-currency account statement cannot prove.
 *
 * Only GETs after the QA-persona login. Credentials come from tmp/.qa.env and
 * are never printed. Output: console summary + JSON under OUT.
 *
 *   node scripts/acceptance/fx-account-currency-audit.mjs                      # Production
 *   API=http://localhost:4005 EMAIL=admin@oms.local PW=… node …                 # local
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
for (const file of [resolve(ROOT, "tmp/.qa.env"), "D:/Systems/OMS/tmp/.qa.env"]) {
  if (!existsSync(file)) continue;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    const i = line.indexOf("=");
    if (!line || line.startsWith("#") || i < 1) continue;
    const value = line.slice(i + 1).replace(/^["']|["']$/g, "");
    if (!process.env[line.slice(0, i)] && value !== "[SENSITIVE]") process.env[line.slice(0, i)] = value;
  }
  break;
}
const API = (process.env.API ?? "https://oms.haseb.org/api").replace(/\/$/, "");
const EMAIL = process.env.EMAIL ?? "qa-admin@oms.haseb.org";
const PW = process.env.PW ?? process.env.QA_PASSWORD ?? "";
const OUT = resolve(ROOT, process.env.OUT ?? "specs/round7-grid-scope-fx/evidence/d");

async function main() {
  if (!PW) throw new Error("no password");
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PW, rememberMe: false }),
  });
  const token = (await login.json().catch(() => ({}))).accessToken;
  if (!token) throw new Error(`login failed: ${login.status}`);
  const get = async (path) => {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  };

  const settings = await get("/accounting/posting-settings");
  const functionalId = settings.functionalCurrencyId;
  const currencies = await get("/currencies");
  const curList = Array.isArray(currencies) ? currencies : (currencies.items ?? currencies.data ?? []);
  const code = (id) => curList.find((c) => c.id === id)?.code ?? id;

  // Every non-functional currency-bound account, with how many ledger movements it has.
  const coa = await get("/chart-of-accounts?pageSize=200");
  const coaItems = Array.isArray(coa) ? coa : (coa.items ?? []);
  const bound = [];
  for (const account of coaItems.filter((x) => x.currencyId && x.currencyId !== functionalId && !x.deletedAt)) {
    const st = await get(`/accounting/reports/account-statement?accountId=${account.id}`);
    bound.push({
      code: account.code,
      name: account.name,
      currency: code(account.currencyId),
      movements: st.movements?.length ?? 0,
      closingFunctional: st.closingBalance,
    });
  }
  const mismatches = [];
  const boundAccounts = new Map();
  let entries = 0;
  for (let page = 1; ; page += 1) {
    const result = await get(`/accounting/reports/journal-report?page=${page}&pageSize=200&sortOrder=asc`);
    for (const entry of result.items) {
      entries += 1;
      if (entry.status === "DRAFT" || entry.sourceType === "FX_REVALUATION") continue;
      const effective = entry.currencyId ?? functionalId;
      for (const line of entry.lines) {
        const accCurrency = line.account?.currencyId;
        if (!accCurrency || accCurrency === functionalId) continue;
        const b = boundAccounts.get(line.accountId) ?? { code: line.account.code, currency: code(accCurrency), lines: 0, mismatching: 0 };
        b.lines += 1;
        if (accCurrency !== effective) {
          b.mismatching += 1;
          mismatches.push({
            entry: entry.entryNumber,
            date: String(entry.entryDate).slice(0, 10),
            sourceType: entry.sourceType,
            account: line.account.code,
            accountCurrency: code(accCurrency),
            entryCurrency: entry.currencyId ? code(entry.currencyId) : `${code(functionalId)} (functional)`,
            net: Number(line.debit) - Number(line.credit),
          });
        }
        boundAccounts.set(line.accountId, b);
      }
    }
    if (page * 200 >= result.total) break;
  }
  const summary = {
    capturedAt: new Date().toISOString(),
    api: API,
    functional: code(functionalId),
    entriesScanned: entries,
    coaTotal: coa.total ?? coaItems.length,
    currencyBoundAccountsFromCoa: bound,
    currencyBoundAccounts: [...boundAccounts.values()],
    mismatchingLines: mismatches.length,
    mismatches: mismatches.slice(0, 200),
  };
  mkdirSync(OUT, { recursive: true });
  const name = /localhost/.test(API) ? "account-currency-audit-local.json" : "account-currency-audit-prod.json";
  writeFileSync(resolve(OUT, name), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, mismatches: mismatches.slice(0, 10) }, null, 2));
}
main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
