/**
 * READ-ONLY Production evidence for the automatic FX import (Round 7, workstream D).
 *
 * Only GET requests are issued after the QA-persona login (no sync/run, no
 * backfill, no settings or override writes). Credentials are loaded from
 * tmp/.qa.env and never printed. Output: JSON evidence file (redacted — only
 * FX facts, no tokens) under OUT (default specs/round7-grid-scope-fx/evidence/d).
 *
 *   node scripts/acceptance/fx-prod-readonly.mjs
 *   API=http://localhost:4005 EMAIL=admin@oms.local PW=... node scripts/acceptance/fx-prod-readonly.mjs   (local dry run)
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const MAIN_ROOT = process.env.MAIN_ROOT ?? "D:/Systems/OMS";

for (const file of [resolve(ROOT, "tmp/.qa.env"), resolve(MAIN_ROOT, "tmp/.qa.env")]) {
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

const BASE = (process.env.BASE ?? "https://oms.haseb.org").replace(/\/$/, "");
const API = (process.env.API ?? `${BASE}/api`).replace(/\/$/, "");
const EMAIL = process.env.EMAIL ?? "qa-admin@oms.haseb.org";
const PW = process.env.PW ?? process.env.QA_PASSWORD ?? "";
const OUT = resolve(ROOT, process.env.OUT ?? "specs/round7-grid-scope-fx/evidence/d");
const isoDay = (d) => d.toISOString().slice(0, 10);

const evidence = { capturedAt: new Date().toISOString(), api: API, user: EMAIL, readOnly: true };

async function main() {
  if (!PW) throw new Error("no password (tmp/.qa.env QA_PASSWORD)");
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PW, rememberMe: false }),
  });
  const body = await login.json().catch(() => ({}));
  if (!body.accessToken) throw new Error(`login failed: ${login.status}`);
  const token = body.accessToken;
  const get = async (path) => {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };

  const status = await get("/exchange-rates/sync/status");
  const runs = await get("/exchange-rates/sync/runs?limit=100");
  const currencies = await get("/currencies");
  const rates = await get("/exchange-rates");
  const overrides = await get("/exchange-rates/overrides");

  const s = status.json ?? {};
  const runList = Array.isArray(runs.json) ? runs.json : [];
  const byTrigger = {};
  for (const r of runList) {
    const k = `${r.trigger}/${r.status}`;
    byTrigger[k] = (byTrigger[k] ?? 0) + 1;
  }
  const slim = (r) =>
    r && {
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      effectiveDate: r.effectiveDate,
      sourceTimestamp: r.sourceTimestamp,
      fetchedCount: r.fetchedCount,
      insertedCount: r.insertedCount,
      skippedCount: r.skippedCount,
      error: r.error,
      reason: r.details?.reason ?? null,
      warnings: r.details?.warnings ?? [],
      inserted: r.details?.inserted ?? [],
      skippedManual: r.details?.skippedManual ?? [],
      skippedExisting: r.details?.skippedExisting ?? [],
    };

  evidence.status = {
    http: status.status,
    enabled: s.settings?.enabled,
    provider: s.provider,
    rateBasis: s.settings?.rateBasis,
    currencyCodes: s.settings?.currencyCodes,
    maxStaleDays: s.settings?.maxStaleDays,
    staleAlertDays: s.settings?.staleAlertDays,
    scheduleUtcHours: s.scheduleUtcHours,
    nextRuns: s.nextRuns,
    newestEffectiveDate: s.newestEffectiveDate,
    newestAgeDays: s.newestAgeDays,
    staleAlert: s.staleAlert,
    today: s.today,
    lastRun: slim(s.lastRun),
    lastSuccess: slim(s.lastSuccess),
  };
  evidence.runs = {
    http: runs.status,
    total: runList.length,
    countsByTriggerStatus: byTrigger,
    cronRows: runList.filter((r) => r.trigger === "CRON").length,
    newestCron: slim(runList.find((r) => r.trigger === "CRON") ?? null),
    oldestListed: slim(runList[runList.length - 1] ?? null),
    list: runList.slice(0, 25).map(slim),
  };

  const rateList = Array.isArray(rates.json) ? rates.json : [];
  const bySource = {};
  for (const r of rateList) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  evidence.rates = {
    http: rates.status,
    listed: rateList.length,
    bySource,
    cbeRowsLinkedToRun: rateList.filter((r) => r.source === "CBE" && r.syncRunId).length,
    examples: rateList
      .filter((r) => r.source === "CBE")
      .slice(0, 8)
      .map((r) => ({
        pair: `${r.fromCurrency?.code}->${r.toCurrency?.code}`,
        rate: r.rate,
        buy: r.buyRate,
        sell: r.sellRate,
        effectiveDate: r.effectiveDate?.slice(0, 10),
        sourceTimestamp: r.sourceTimestamp,
        syncRunId: r.syncRunId,
      })),
  };

  const ovList = Array.isArray(overrides.json) ? overrides.json : [];
  evidence.overrides = {
    http: overrides.status,
    active: ovList
      .filter((o) => !o.deletedAt)
      .map((o) => ({
        pair: `${o.fromCurrency?.code}->${o.toCurrency?.code}`,
        rate: o.rate,
        dateFrom: o.dateFrom?.slice(0, 10),
        dateTo: o.dateTo?.slice(0, 10),
        reason: o.reason,
      })),
  };

  const curList = Array.isArray(currencies.json)
    ? currencies.json
    : (currencies.json?.items ?? currencies.json?.data ?? []);
  const today = isoDay(new Date());
  evidence.resolved = [];
  for (const c of curList.filter((c) => !c.deletedAt && ["SAR", "USD", "EUR", "AED"].includes(c.code))) {
    const r = await get(`/exchange-rates/resolve?currencyId=${c.id}&asOf=${today}`);
    const j = r.json ?? {};
    evidence.resolved.push({
      code: c.code,
      asOf: today,
      http: r.status,
      available: j.available,
      rate: j.rate,
      effectiveDate: j.effectiveDate,
      source: j.source,
      provider: j.provider,
      overrideId: j.overrideId,
      errorCode: j.errorCode,
      convention: j.convention,
    });
  }

  // Verdict derived from data, not configuration.
  const cron = evidence.runs.cronRows;
  const lastSuccessAt = s.lastSuccess?.startedAt ? new Date(s.lastSuccess.startedAt) : null;
  evidence.verdict = {
    cronRunRowsFound: cron,
    cronSuccessRows: runList.filter((r) => r.trigger === "CRON" && ["SUCCESS", "PARTIAL"].includes(r.status)).length,
    lastSuccessAgeHours: lastSuccessAt ? Math.round((Date.now() - lastSuccessAt.getTime()) / 36e5) : null,
    classification:
      cron === 0
        ? "NOT_PROVEN_NO_CRON_ROWS"
        : runList.some((r) => r.trigger === "CRON" && ["SUCCESS", "PARTIAL"].includes(r.status))
          ? "RUNNING_CRON_ROWS_PRESENT"
          : "CRON_FIRING_BUT_NOT_SUCCEEDING",
  };

  mkdirSync(OUT, { recursive: true });
  const file = resolve(OUT, "prod-readonly-evidence.json");
  writeFileSync(file, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ file, status: evidence.status, runs: { ...evidence.runs, list: undefined }, verdict: evidence.verdict, resolved: evidence.resolved, rates: { ...evidence.rates }, overrides: evidence.overrides }, null, 2));
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
