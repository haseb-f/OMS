/**
 * SEC-01/SEC-03 regression — GET /partners/catalog is scoped by the caller's
 * grants (allowed Partner roles) and always returns an EXPLICIT projection:
 * picker fields, `roles` narrowed to the caller's scope, plus the CUSTOMER
 * detail block only on customer rows for detail-authorized callers — never
 * investor/employee/supplier profiles, tax data, notes or payable balance.
 * Also: GET /partners (the full directory) is 403 without partners.view.
 * Production-safe: login + read-only GETs only (restore / find-or-create are
 * covered by the API specs, never here).
 *
 * For each persona it reads the persona's real grants from /auth/me, derives
 * the expected scope from SCOPES below (a mirror of
 * apps/api/src/partners/partner-catalog-scope.ts — keep them in step), then
 * asserts allowed / denied (403) / projection / ids= scoping.
 *
 * Env (same conventions as _tour-lib.mjs):
 *   BASE (web, default https://oms.haseb.org), API (default BASE/api, or
 *   http://localhost:3005 for a local :3001 web), PW (all personas),
 *   PW_<PERSONA> per-persona override (e.g. PW_SALES_AGENT), PERSONAS
 *   (comma list, default admin,finance,purchasing,sales-agent,shipping,hr),
 *   DOMAIN (default oms.haseb.org). Passwords are never printed.
 *
 *   node scripts/acceptance/partner-catalog-access.mjs
 *   BASE=http://localhost:3001 PW=... node scripts/acceptance/partner-catalog-access.mjs
 */
import { apiClient, createReport, login, PW, errText } from "./_tour-lib.mjs";

const C = "CUSTOMER";
const S = "SUPPLIER";
const ANY = "ANY";

/** permission → { roles, detail } — mirror of PARTNER_CATALOG_SCOPES. */
const SCOPES = {
  "partners.view": { roles: ANY, detail: true },
  "crm.leads.convert": { roles: [C], detail: false },
  "store-orders.create": { roles: [C], detail: true },
  "store-orders.edit": { roles: [C], detail: false },
  "sales.quotations.create": { roles: [C], detail: true },
  "sales.orders.create": { roles: [C], detail: true },
  "sales.invoices.create": { roles: [C], detail: true },
  "sales.returns.create": { roles: [C], detail: true },
  "purchasing.quotations.create": { roles: [S], detail: false },
  "purchasing.orders.create": { roles: [S], detail: false },
  "purchasing.invoices.create": { roles: [S], detail: false },
  "purchasing.returns.create": { roles: [S], detail: false },
  "accounting.journal-entries.create": { roles: ANY, detail: false },
  "accounting.journal-entries.edit": { roles: ANY, detail: false },
  "sales.receipts.create": { roles: [C], detail: false },
  "sales.receipts.edit": { roles: [C], detail: false },
  "sales.refunds.create": { roles: [C], detail: false },
  "sales.refunds.edit": { roles: [C], detail: false },
  "purchasing.payments.create": { roles: [S], detail: false },
  "purchasing.payments.edit": { roles: [S], detail: false },
  "reports.financial.view": { roles: [C, S], detail: false },
  "accounting.bank-transactions.manage": { roles: [S], detail: false },
  "landed-cost.create": { roles: ANY, detail: false },
  "landed-cost.edit": { roles: ANY, detail: false },
  "masterdata.fixed-assets.create": { roles: [S], detail: false },
  "masterdata.fixed-assets.edit": { roles: [S], detail: false },
  "products.create": { roles: [S], detail: false },
  "products.edit": { roles: [S], detail: false },
};

const PICKER_KEYS = new Set([
  "id",
  "partnerNumber",
  "name",
  "commercialName",
  "status",
  "roles",
  "currencyId",
  "currency",
]);
/** The CUSTOMER detail block (SEC-03 H1) — exactly what the Store Order dialog / Sales editor read. */
const CUSTOMER_DETAIL_KEYS = new Set([
  "phone",
  "mobile",
  "email",
  "countryId",
  "city",
  "address",
  "customerProfile",
  "receivableBalance",
]);
/** Never in any catalog row, for any caller. */
const NEVER_KEYS = [
  "investorProfile",
  "employeeProfile",
  "supplierProfile",
  "taxNumber",
  "commercialRegistration",
  "notes",
  "payableBalance",
  "legalName",
  "website",
];

const DOMAIN = process.env.DOMAIN ?? "oms.haseb.org";
const PERSONAS = (process.env.PERSONAS ?? "admin,finance,purchasing,sales-agent,shipping,hr")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const passwordFor = (persona) =>
  process.env[`PW_${persona.toUpperCase().replace(/-/g, "_")}`] ?? PW;

function expectedScope(isSuperAdmin, grants) {
  if (isSuperAdmin) return { roles: ANY, detail: ANY };
  let roles = new Set();
  let detail = new Set();
  let unlocked = false;
  const add = (target, r) => (target === ANY || r === ANY ? ANY : new Set([...target, ...r]));
  for (const [permission, grant] of Object.entries(SCOPES)) {
    if (!grants.has(permission)) continue;
    unlocked = true;
    roles = add(roles, grant.roles);
    if (grant.detail) detail = add(detail, grant.roles);
  }
  return unlocked ? { roles, detail } : null;
}
const allows = (set, role) => set === ANY || set.has(role);
const describe = (set) => (set === ANY ? "ANY" : [...set].join("+") || "none");
const rolesOf = (row) => (row.roles ?? []).map((a) => a.role);

const { report, assert, check, finish } = createReport("partner-catalog-access", { personas: PERSONAS });

// Reference partners (single-role, so ids= scoping is unambiguous) — found via the admin persona.
const refs = { [C]: null, [S]: null };

for (const persona of PERSONAS.includes("admin") ? ["admin", ...PERSONAS.filter((p) => p !== "admin")] : PERSONAS) {
  const email = `qa-${persona}@${DOMAIN}`;
  let api;
  try {
    api = apiClient(await login(email, passwordFor(persona)));
  } catch (error) {
    check(`${persona}.login`, "BLOCKED", error.message);
    continue;
  }
  const me = await api("GET", "/auth/me");
  if (!me.ok) {
    check(`${persona}.me`, "BLOCKED", `${me.status} ${errText(me.json)}`);
    continue;
  }
  const grants = new Set((me.json.permissions ?? []).map((p) => (typeof p === "string" ? p : p?.name)));
  const scope = expectedScope(!!me.json.isSuperAdmin, grants);
  check(
    `${persona}.scope`,
    "INFO",
    scope ? `roles=${describe(scope.roles)} detail=${describe(scope.detail)}` : "no catalog access",
  );

  // SEC-03 — the full Partner directory needs partners.view explicitly (an
  // implied section key such as Customer Groups never unlocks it).
  const directory = await api("GET", "/partners?pageSize=1");
  if (me.json.isSuperAdmin || grants.has("partners.view")) {
    assert(`${persona}.directory.allowed`, directory.status === 200, `status ${directory.status}`);
  } else {
    assert(`${persona}.directory.denied`, directory.status === 403, `expected 403, got ${directory.status}`);
  }

  if (!scope) {
    for (const q of ["", "?role=CUSTOMER", "?role=SUPPLIER"]) {
      const r = await api("GET", `/partners/catalog${q}`);
      assert(`${persona}.denied${q || "(none)"}`, r.status === 403, `expected 403, got ${r.status}`);
    }
    continue;
  }

  for (const role of [C, S]) {
    const r = await api("GET", `/partners/catalog?role=${role}&pageSize=10`);
    if (!allows(scope.roles, role)) {
      assert(`${persona}.${role}.denied`, r.status === 403, `expected 403, got ${r.status}`);
      continue;
    }
    if (!assert(`${persona}.${role}.allowed`, r.status === 200, `status ${r.status} ${errText(r.json)}`)) continue;
    const rows = r.json.items ?? [];
    if (persona === "admin") {
      refs[role] = rows.find((row) => rolesOf(row).length === 1) ?? refs[role];
    }
    assert(
      `${persona}.${role}.roleFiltered`,
      rows.every((row) => rolesOf(row).includes(role)),
      `${rows.length} rows`,
    );
    if (!rows.length) {
      check(`${persona}.${role}.projection`, "SKIP", "no ACTIVE rows to inspect");
      continue;
    }
    // Detail is per row AND per role (SEC-03 H1): only a CUSTOMER row, and
    // only when CUSTOMER is detail-authorized for the caller, carries the
    // customer detail block — nothing else ever does.
    const isDetailRow = (row) => rolesOf(row).includes(C) && allows(scope.detail, C);
    const detailRows = rows.filter(isDetailRow);
    const pickerRows = rows.filter((row) => !isDetailRow(row));
    const never = NEVER_KEYS.filter((k) => rows.some((row) => k in row));
    assert(
      `${persona}.${role}.neverSensitive`,
      never.length === 0,
      never.length ? `leaked: ${never.join(",")}` : `${rows.length} rows free of investor/employee/tax/notes/payable`,
    );
    if (detailRows.length) {
      const extra = [
        ...new Set(
          detailRows.flatMap((row) =>
            Object.keys(row).filter((k) => !PICKER_KEYS.has(k) && !CUSTOMER_DETAIL_KEYS.has(k)),
          ),
        ),
      ];
      assert(
        `${persona}.${role}.detail`,
        extra.length === 0 && detailRows.every((row) => "receivableBalance" in row && "phone" in row),
        extra.length ? `unexpected keys: ${extra.join(",")}` : `${detailRows.length} rows carry the customer block only`,
      );
    }
    if (pickerRows.length) {
      const extra = [...new Set(pickerRows.flatMap((row) => Object.keys(row).filter((k) => !PICKER_KEYS.has(k))))];
      assert(
        `${persona}.${role}.pickerOnly`,
        extra.length === 0,
        extra.length ? `unexpected keys: ${extra.join(",")}` : `${pickerRows.length} rows, picker fields only`,
      );
    }
    // SEC-03 L4 — roles on each row are narrowed to the caller's scope.
    if (scope.roles !== ANY) {
      const wide = rows.filter((row) => rolesOf(row).some((r) => !scope.roles.has(r)));
      assert(`${persona}.${role}.rolesNarrowed`, wide.length === 0, `${wide.length} rows expose out-of-scope roles`);
    }
  }

  // No role requested → server restricts to the allowed set.
  const all = await api("GET", "/partners/catalog?pageSize=50");
  if (assert(`${persona}.noRole.allowed`, all.status === 200, `status ${all.status}`) && scope.roles !== ANY) {
    const outside = (all.json.items ?? []).filter((row) => !rolesOf(row).some((r) => scope.roles.has(r)));
    assert(`${persona}.noRole.scoped`, outside.length === 0, `${outside.length} out-of-scope rows`);
  }

  // ids= lookups obey the same scope.
  for (const role of [C, S]) {
    const ref = refs[role];
    if (!ref) {
      check(`${persona}.ids.${role}`, "SKIP", "no single-role reference partner");
      continue;
    }
    const r = await api("GET", `/partners/catalog?ids=${ref.id}&pageSize=1`);
    const found = r.status === 200 && (r.json.items ?? []).some((row) => row.id === ref.id);
    if (allows(scope.roles, role)) {
      assert(`${persona}.ids.${role}.visible`, found, `status ${r.status}`);
    } else {
      assert(`${persona}.ids.${role}.hidden`, r.status === 200 && !found, `status ${r.status} found=${found}`);
    }
  }
}

finish("partner-catalog-access.json");
if (report.checks.some((c) => c.status === "FAIL" || c.status === "BLOCKED")) process.exitCode = 1;
