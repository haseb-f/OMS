/* eslint-disable no-console */
/**
 * Tiny HTTP + SQL helpers shared by the manual build scripts (demo data + screenshots).
 * Local only: refuses any API that is not localhost. Passwords are read from
 * tmp/r15-manual/.env (git-ignored) and never printed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const ROOT = "D:/Systems/OMS";
const env = Object.fromEntries(
  readFileSync(`${ROOT}/tmp/r15-manual/.env`, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
export const PW = env.MANUAL_PW;
export const API = (process.env.API ?? env.API ?? "http://localhost:4505").replace(/\/$/, "");
export const DB = process.env.DB ?? env.DB ?? "oms_r15_manual";
/** The API URL baked into the web build (requests to it are forwarded to API when they differ). */
export const BAKED_API = (process.env.BAKED_API ?? env.BAKED_API ?? "http://localhost:4505").replace(/\/$/, "");
export const WEB_URL = (process.env.WEB ?? env.WEB ?? "http://localhost:4501").replace(/\/$/, "");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) throw new Error("local API only");
if (!PW) throw new Error("MANUAL_PW missing in tmp/r15-manual/.env");

export const psql = (sql) =>
  execFileSync("docker", ["exec", "oms-postgres", "psql", "-U", "oms", "-d", DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  }).trim();
export const rows = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`) || "[]");
export const one = (sql) => rows(sql)[0] ?? null;
export const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

export async function call(token, method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json", "User-Agent": "oms-manual-build" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    j = text;
  }
  return { s: r.status, ok: r.status < 300, j };
}

/** Same as call() but throws with the server message on a non-2xx status. */
export async function must(token, method, path, body, label = `${method} ${path}`) {
  const r = await call(token, method, path, body);
  if (!r.ok) throw new Error(`${label} → ${r.s} ${JSON.stringify(r.j)?.slice(0, 600)}`);
  return r.j;
}

export async function login(email) {
  const r = await call(null, "POST", "/auth/login", { email, password: PW });
  if (!r.j?.accessToken) throw new Error(`login ${email} failed: ${r.s} ${JSON.stringify(r.j)?.slice(0, 200)}`);
  return r.j.accessToken;
}

export const items = (j) => (Array.isArray(j) ? j : j?.items ?? j?.data ?? []);
