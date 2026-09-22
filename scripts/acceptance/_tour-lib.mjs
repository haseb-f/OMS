/**
 * Shared helpers for the acceptance tours (investor-tour.mjs, browser-tour.mjs).
 * Same env conventions as scripts/production-*.mjs:
 *   BASE (web), API (defaults to BASE/api, or :3005 for a local :3001 web),
 *   EMAIL (default qa-admin@oms.haseb.org), PW (fallback QA_PASSWORD from tmp/.qa.env),
 *   RUN (default DEMO-ACCEPTANCE-YYYYMMDD-HHMM).
 * Passwords are never printed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i);
    const value = line.slice(i + 1).replace(/^["']|["']$/g, "");
    if (value === "[SENSITIVE]") continue;
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(resolve(ROOT, "tmp/.qa.env"));

const pad = (n) => String(n).padStart(2, "0");
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export const BASE = (process.env.BASE ?? "https://oms.haseb.org").replace(/\/$/, "");
export const API = (
  process.env.API ?? (/localhost:3001|127\.0\.0\.1:3001/.test(BASE) ? "http://localhost:3005" : `${BASE}/api`)
).replace(/\/$/, "");
export const EMAIL = process.env.EMAIL ?? "qa-admin@oms.haseb.org";
export const PW = process.env.PW ?? process.env.PASSWORD ?? process.env.QA_PASSWORD ?? "";
export const RUN = process.env.RUN ?? `DEMO-ACCEPTANCE-${stamp()}`;
export const OUT = resolve(ROOT, "tmp/acceptance", RUN);
mkdirSync(OUT, { recursive: true });

export const today = () => new Date().toISOString().slice(0, 10);
export const round2 = (v) => Math.round(Number(v) * 100) / 100;
export const near = (a, b, eps = 0.011) => Math.abs(Number(a) - Number(b)) <= eps;

/** Result collector: PASS / FAIL / BLOCKED / SKIP with detail + evidence. */
export function createReport(name, extra = {}) {
  const report = {
    tour: name,
    run: RUN,
    base: BASE,
    api: API,
    user: EMAIL,
    startedAt: new Date().toISOString(),
    ...extra,
    checks: [],
  };
  const check = (id, status, detail = "", evidence) => {
    const entry = { id, status, detail: String(detail ?? "").slice(0, 1500) };
    if (evidence !== undefined) entry.evidence = evidence;
    report.checks.push(entry);
    console.log(`${status.padEnd(7)} ${id}${detail ? ` — ${String(detail).slice(0, 220)}` : ""}`);
    return status === "PASS";
  };
  const assert = (id, cond, detail, evidence) => check(id, cond ? "PASS" : "FAIL", detail, evidence);
  const finish = (file) => {
    report.finishedAt = new Date().toISOString();
    const counts = {};
    for (const c of report.checks) counts[c.status] = (counts[c.status] ?? 0) + 1;
    report.summary = counts;
    const path = resolve(OUT, file);
    writeFileSync(path, JSON.stringify(report, null, 2));
    console.log(`\nSummary ${JSON.stringify(counts)}\nReport: ${path}`);
    return path;
  };
  return { report, check, assert, finish };
}

export async function login(email = EMAIL, password = PW) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, rememberMe: true }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.accessToken) {
    throw new Error(`login ${email} → ${res.status} ${json.code || json.message || ""}`);
  }
  return json.accessToken;
}

/** Raw API call — never throws on HTTP status; returns { status, json }. */
export function apiClient(token) {
  const call = async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 400) };
    }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, json };
  };
  /** Throwing variant for steps that must succeed. */
  call.must = async (method, path, body) => {
    const r = await call(method, path, body);
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${errText(r.json)}`);
    return r.json;
  };
  return call;
}

export function errText(json) {
  if (!json) return "";
  const msg = Array.isArray(json.message) ? json.message.join("; ") : json.message;
  const fields = Array.isArray(json.fields)
    ? json.fields.map((f) => `${f.field}:${(f.constraints ?? f.messages ?? []).join?.(",") ?? ""}`).join(" ")
    : "";
  return [json.code, msg, fields, json.raw].filter(Boolean).join(" ").slice(0, 600);
}

export const items = (json) =>
  Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : Array.isArray(json?.data) ? json.data : [];

/**
 * Does a web path (e.g. /investors/opportunities/<uuid>) map to a real
 * `page.tsx` under apps/web/src/app? Route groups `(x)` are transparent,
 * `[param]` segments match any value. Returns the matched file or null.
 */
export function webRouteFile(urlPath) {
  const appDir = resolve(ROOT, "apps/web/src/app");
  const segments = urlPath.split("?")[0].split("/").filter(Boolean);
  const walk = (dir, rest) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    if (rest.length === 0 && entries.some((e) => e.isFile() && e.name === "page.tsx")) {
      return resolve(dir, "page.tsx");
    }
    for (const e of entries.filter((x) => x.isDirectory() && /^\(.*\)$/.test(x.name))) {
      const hit = walk(resolve(dir, e.name), rest);
      if (hit) return hit;
    }
    if (rest.length === 0) return null;
    const [head, ...tail] = rest;
    const exact = entries.find((e) => e.isDirectory() && e.name === head);
    if (exact) {
      const hit = walk(resolve(dir, exact.name), tail);
      if (hit) return hit;
    }
    for (const e of entries.filter((x) => x.isDirectory() && /^\[[^.].*\]$/.test(x.name))) {
      const hit = walk(resolve(dir, e.name), tail);
      if (hit) return hit;
    }
    return null;
  };
  return walk(appDir, segments);
}

/** Append records to a demo-record-index JSON array file (created if missing). */
export function appendIndex(file, records) {
  const path = resolve(OUT, file);
  let existing = [];
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      existing = [];
    }
  }
  existing.push(...records);
  writeFileSync(path, JSON.stringify(existing, null, 2));
  return path;
}
