# W4 progress — partners section, partner login, per-period statement

DB `oms_r15_w4`. Branch `integration/r15` (shared tree). Newest first.

## RESOLVED blocker — migration `20261009100310_r15_partner_user_check` (added by the lead)

`users_agent_affiliation_chk` only admitted INTERNAL / AGENT rows (Postgres 23514 on a PARTNER insert). The lead added
the migration with the SQL below and applied it to every R15 DB.

```sql
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_agent_affiliation_chk";
ALTER TABLE "users" ADD CONSTRAINT "users_agent_affiliation_chk" CHECK (
  ("user_type" = 'INTERNAL' AND "agent_id" IS NULL AND "agent_role" IS NULL AND "company_partner_id" IS NULL)
  OR ("user_type" = 'AGENT' AND "agent_id" IS NOT NULL AND "agent_role" IS NOT NULL AND "is_super_admin" = false
      AND "company_partner_id" IS NULL)
  OR ("user_type" = 'PARTNER' AND "agent_id" IS NULL AND "agent_role" IS NULL AND "is_super_admin" = false)
);
```

## 2026-10-07 — implementation complete (local, not committed)

### API

- **Audience** (`auth/**`): `@PartnerPortal()` / `@PartnerShared()` (`decorators/partner-access.decorator.ts`);
  `JwtAuthGuard` denies a `typ:'partner'` token on every handler without that metadata (403 `PARTNER_ACCESS_DENIED`),
  refuses internal / agent tokens on partner-only handlers, re-checks the link live (active, not locked, PARTNER,
  `companyPartnerId` = token claim, profile exists → else 401 `PARTNER_ACCOUNT_UNAVAILABLE`) and sets
  `request.partnerContext {userId, companyPartnerId, partnerId}`; temporary password → 403 `MUST_CHANGE_PASSWORD` except
  `/auth/me|logout|change-password` (now `@PartnerShared`). Login issues `typ:'partner', companyPartnerId`; an unlinked
  login is refused (`PARTNER_LOGIN_UNLINKED`). Sessions / idle / absolute lifetime unchanged (same `issueAccessToken`
  - `assertActive`). `/auth/me` adds `companyPartner {partnerId, name, partnerNumber}` for PARTNER users.
- **Users** (`users.service.ts`): `createPartnerUser` (only path to PARTNER; username = e-mail, generated temporary
  password, must change, exactly `partner.*`); `setPermissions` audience rule — `agent.*` only AGENT, `partner.*` only
  PARTNER, rest only INTERNAL (`PARTNER_USER_PERMISSION`, `INTERNAL_USER_PARTNER_PERMISSION`); `assertInternallyManaged`
  refuses PARTNER users (`PARTNER_USER_MANAGED_IN_PARTNERS`).
- **Logins** (`company-partners/partner-logins.service.ts`, `PartnerLoginsController`, matrix action `portal` =
  `company-partners.users.manage`): create (409 `PARTNER_LOGIN_NEEDS_AGREEMENT` before an ACTIVE/ENDED agreement,
  409 `PARTNER_LOGIN_EXISTS`), candidates, link (only unlinked PARTNER users), unlink, disable / enable (UsersService.update),
  reset (UsersService.resetPassword — sessions revoked). Activity log on the partner (`LOGIN_*`).
- **Per-period statement** (`partner-statement.service.ts` `periodStatement`, rules in `partner-statement-rules.ts`,
  `closingWindows` in the calculator): saved periods overlapping the range (partial overlap included — the R14 "fully
  inside" rule is gone) → CLOSED (original + adjustments = approved due, paid oldest-first across ALL closed periods,
  remaining) / UNDER_REVIEW (reviewed figure, no approved amount); gaps → OPEN rows estimated over the whole window by
  `PartnerProfitService.calculate(from, to, {partnerId})` (same math), only up to today and within the partner's
  agreements (no estimate after the partnership end). Totals, adjustment history, all-time position, partnership state.
  Default range: YTD, or the year the partnership ended. Internal `statement()` = that + login, range estimate,
  payments (with account / JE), agreements.
- **Portal** (`partner-portal/**`, `PartnerPortalModule` appended to `app.module.ts`): `PartnerPermissionGuard` (fail
  closed), `@CurrentPartner()`; `GET /partner-portal/me|summary` (`partner.dashboard.view`),
  `/periods`, `/periods/:periodId` (404 unless the partner has a share in it), `/statement?from&to`
  (`partner.statement.view`).

### Partner-visible fields (exact)

- `me`: `partner {name, partnerNumber}`, `partnership {status, startedOn, endsOn}`, `currentAgreement` and
  `agreements[]` as `{profitSharePercent, basis, frequency, status, effectiveFrom, effectiveTo}`, `login {email,
fullName, lastLoginAt}`.
- period row (statement / periods / summary.currentPeriod): `periodId, periodFrom, periodTo, frequency, status,
entitlement, adjustments, approvedDue, paid, remaining, segments[]` with segment `{from, to, days, percent, basis,
baseAmount, lossClamped, amount, profitBase {netRevenue, costOfSales, otherExpensesNet (net basis only, else null),
profit}}`; period detail adds `adjustmentHistory[] {adjustmentId, date, reason, amount}`.
- `statement`: `partner {name, partnerNumber}, range, currency {id, code}, partnership, terms[], periods[], totals
{estimated, approvedDue, paid, remaining}, adjustments[] {periodId, periodFrom, periodTo, date, reason, amount},
payments[] {paymentNumber, date, amount, method CASH|BANK|OTHER, reference, reversed, reversedOn}, position
{approved, paid, payable, advance}`.
- `summary`: `currency, partnership, range, currentPeriod, estimated, position, lastPayment {date, amount, method,
reversed}`.
- Never: journal entry ids, account ids / codes / names, payment notes or reversal reason, agreement ids / notes,
  other partners (names, ids, segments), customer or document records, company figures below the basis lines.

### Web

- Navigation: top-level `company-partners` (tone violet, icon `briefcase`, gate `company-partners.view`; children list +
  profit periods; Finance child removed; `home.destinations` en + ar); partner audience (`/partner` Home, Overview,
  Statement) — `types/navigation.ts` audience union, `audienceOf`, `routeAudienceMismatch` (`partner-outside-portal`),
  `homePathFor`, home tiles / actions / module overview; `proxy.ts` sends a partner token to `/partner` from any other
  page (except `/profile*`, `/print*`) and from the login page.
- Shared statement: `config/company-partners/{period-statement.ts, statement-columns.tsx, period-statement-view.tsx,
statement-print.ts, use-statement-print.ts}` — KPI cards (estimate «تقديري» vs approved «معتمد»), per-period table
  (Table/Grid, cards on phones), period detail dialog, payments / adjustments tabs, portrait print (report template).
- Staff partner page: terms card, profit used, login card (`_components/partner-login.tsx`: create / link / disable /
  enable / reset / unlink, temporary password shown once via `GeneratedPasswordDialog`), per-period statement, range
  estimate, agreements (Activate for drafts), payments. Agreement dialog: end date **or** duration (months → end date),
  status (Active now / Draft), basis explained. List: partnership + login columns.
- Portal: `/partner` (HomeLauncher), `/partner/overview`, `/partner/statement`.

### Verification (commands and results — see final report)

- API jest (`oms_r15_w4`): partner-portal HTTP integration 10/10; src/auth 73/73 (8 suites); users + auth + partner
  units 111/111 (15 suites); permissions 438/441 (3 failures = controller-coverage scan: W2 ×2, W4 portal controller →
  lead allowlist).
- Mutations: deny-by-default removed in `JwtAuthGuard` → 2 guard tests fail; R14 "fully inside the range" rule
  restored in `periodStatement` → the partial-overlap HTTP test fails (Feb shows OPEN instead of CLOSED). Both restored.
- Web: `vitest run src/navigation src/proxy.spec.ts src/config/company-partners src/components/home` → 11 files /
  107 tests pass; mutation — partner branch removed from `routeAudienceMismatch` → 3 failures (partner-audience,
  proxy, r6 post-login), restored → pass. Full web `vitest run`: the only W4-related failure is the
  `insight-card.spec.tsx` file-list pin (request 8); the other failures at that moment were in W1 / W6 files.
  `tsc --noEmit`: no error in W4 files (remaining errors in W6 / W1 files). ESLint + Prettier clean on W4 files.
- No browser pass done (API dev server not started; other streams mid-edit) — the lead's release review covers it.
- R14 `company-partners.integration.spec.ts` fails on this DB before reaching W4 code: pre-existing open-ended ACTIVE
  30 % + 20 % agreements (from 2026-09-01) push its Σ % over 100 at fixture creation (environmental; assertions of its
  statement test were updated to the new shape).

### Integration requests for the lead (files W4 does not own)

1. `apps/web/src/components/layout/route-access-guard.tsx`: handle `"partner-outside-portal"` like the agent case —
   `router.replace(PARTNER_PORTAL_HOME)` and render null (client-side twin of the proxy redirect).
2. `apps/web/src/app/(shell)/profile/password/page.tsx`: `homePathFor(user?.userType)` instead of the agent-only
   ternary.
3. `apps/web/src/services/auth-service.ts`: `userType?: AudienceUserType` (`"INTERNAL" | "AGENT" | "PARTNER"`) and
   `companyPartner?: { partnerId: string; name: string; partnerNumber: string } | null` on `CurrentUser`.
4. `apps/web/src/components/layout/app-sidebar.tsx`: for PARTNER show the partner's name instead of the company
   switcher (a partner login has no company membership).
5. API `permissions/effective-permissions.ts` + `permissions-resolver.service.ts`: PARTNER users → only `partner.*`,
   no job-title template, never super admin; drop `partner.*` for INTERNAL users (defence in depth — the guard already
   confines partner tokens and UsersService rejects mismatched grants).
6. API `permissions/permission-administration.service.ts` (≈ line 484): reject `partner.*` in job-title templates like
   `agent.*`.
7. API `permissions/controller-authorization.spec.ts`: `INTENTIONALLY_UNGATED['partner-portal/partner-portal.controller.ts']`
   = "Partner logins only (@PartnerPortal; JwtAuthGuard denies every other audience); PartnerPermissionGuard requires a
   partner.* key per handler (fail closed); every handler is self-scoped via @CurrentPartner()".
8. `apps/web/src/components/shared/insight-card.spec.tsx` ("company partner summaries use the fit layout"): the
   partner summary cards moved into the shared view — replace `src/app/(shell)/company-partners/[partnerId]/page.tsx`
   in its file list by `src/config/company-partners/period-statement-view.tsx` and add
   `src/app/(shell)/partner/overview/page.tsx` (both use `<InsightGroup fit>`). Until then that one test fails.
9. Files edited outside the literal W4 row (W4-exclusive, no other stream touches them): `apps/web/src/types/navigation.ts`
   (audience union), `apps/web/src/services/company-partners-service.ts`, new `apps/web/src/services/partner-portal-service.ts`.
