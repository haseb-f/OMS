# W4 — Company partners: own section, Home tile, partner login, per-period statement

Requirements: 4.1–4.12 · Decisions D15-14, D15-15. Database for tests: `oms_r15_w4`. Progress log: `progress-w4.md`.

## Current state (survey S4 — read it)

R14 module `apps/api/src/company-partners/**` (profiles / agreements / periods / payments / statement; internal only,
`company-partners.view|manage|close|pay`), web `app/(shell)/company-partners/**` (list, `[partnerId]` statement,
periods), nav entry `finance-company-partners` under Finance. Agent users are the model for an external audience:
`User.userType AGENT` + `agentId`, JWT `typ:'agent'`, `JwtAuthGuard` denies agent tokens unless `@AgentPortal` /
`@AgentShared`, live affiliation re-check, `agent.*`-only permissions, web audience `agent` (`route-access.ts`,
`post-login.ts`, `proxy.ts`, `home-tiles.ts`, `module-overview.ts`, `build-navigation-tree.ts`).

## Foundation already in place

`UserType.PARTNER`, `User.companyPartnerId @unique` ↔ `CompanyPartnerProfile.user`; permissions
`partner.dashboard.view`, `partner.statement.view` (catalog module `partner-portal`, `PARTNER_PORTAL_PERMISSIONS`,
`isPartnerPortalPermission`), `company-partners.users.manage`; `IMPLIED_SECTION_PERMISSION['company-partners']` now
`company-partners.view`; labels for the new keys and section exist.

## Required behaviour

1. **Navigation (4.1, 4.2)**: new top-level section `company-partners` («الشركاء» / Partners) in
   `navigation.config.ts` with its own `homeTone`, an icon from `icon-registry.ts` not used by another section
   (e.g. `briefcase` or `users-round`), gate `company-partners.view`; children: Partners list, Profit periods (and
   Partner logins if a page). Remove the Finance child. Home tile appears automatically for authorized users; add
   `home.destinations.<childId>` lines (en + ar). Update `r6-navigation.spec.ts` and any Finance-children assertions.
2. **Partner login (4.4, 4.6, D15-14)** — mirror the agent pattern, do not copy the investor portal:
   - Auth: login works for PARTNER users; JWT carries `typ:'partner'`, `companyPartnerId`; `JwtAuthGuard` denies a
     partner token on every handler not marked `@PartnerPortal()` (new decorator next to `@AgentPortal`), re-checks
     the link live (user active, `companyPartnerId` set, profile exists) and sets `request.partnerContext`; a partner
     user holds only `partner.*` permissions (users service + resolver reject anything else, and reject `partner.*` for
     other user types). Sessions / mustChangePassword / idle and absolute lifetime exactly as other users (R14).
   - Internal management (`company-partners.users.manage`): on the partner page, "Create login" (email, name,
     temporary password generated + must-change, `partner.dashboard.view` + `partner.statement.view`), "Link existing
     partner user", "Disable / enable login", "Reset password" (reuse the users service flows used for agent users —
     `UsersService.createAgentUser` is the model). Only after at least one agreement exists (4.4 "after configuring
     the agreement") — the button explains otherwise.
   - Partner portal API (`@PartnerPortal`, scope only from the token, never a URL id): `GET /partner-portal/me`
     (name, partnership start/end, current agreement % + basis + frequency + status, login status),
     `GET /partner-portal/summary`, `GET /partner-portal/periods`, `GET /partner-portal/periods/:periodId`,
     `GET /partner-portal/statement?from&to`. Responses are partner-safe: no other partner, no journal entry ids, no
     internal account codes/names (show "Bank transfer" / method label only), no customer-level records, company
     figures only the profit base lines the partner's agreement uses (revenue, cost of sales, expenses, profit used)
     — decide with the existing statement and document the exact field list in your log.
3. **Setup (4.5)**: the agreement dialog shows start date, end date **or duration** (months → end date computed),
   profit-share %, basis (gross/net, explained), closing frequency, status; the partner page shows these plus the
   linked login (email, status, last login).
4. **Expiry (4.7)**: after the last agreement's end date the partner is "Partnership ended" — the login keeps
   read-only access to historical statements and payments until an administrator disables it; no estimate for dates
   after the end; nothing is deleted; payments still recordable by the company for amounts owed. Document it in the
   portal ("Your partnership ended on …").
5. **Per-period statement (4.8, 4.9, D15-15)** — for internal staff and the partner portal (shared computation in the
   existing statement service): one row per closing period overlapping the range: period, status (open estimate /
   under review / closed), agreement(s) + % + basis, calculated entitlement (estimate for open, snapshot for
   reviewed/closed), approved amount due (closed only: original + adjustments), paid (payments applied to closed
   periods oldest-first — derived), remaining; plus payment history and adjustment history (date, reason, amount).
   Provisional figures are visibly labelled «تقديري / Estimate», approved ones «معتمد / Approved». Partly overlapping
   periods are included (fix the R14 "fully inside the range" rule).
6. **UI (4.10)**: partner portal `/partner` (Home = its own tiles from audience `partner` nav items: Overview,
   Statement) built from InsightCard / InsightGroup / SummaryCard / DashboardPanel with tones, hover/focus on drill-down
   tiles, concise labels, RTL, phones (cards stack, period rows become cards). Internal partner pages get the same
   per-period statement. Print layout for the statement (portrait, company logo/info, print date, page numbers) via
   the existing print system.
7. **Isolation (4.11)**: a partner can never open internal routes (web route guard + API deny-by-default), never
   another partner (no id in URLs), never company financial screens.

## Tests

Auth: partner login → token typ partner; partner token on an internal endpoint → 403; on another partner's data → not
reachable (no id param); disabled login → 401; partner user cannot be granted non-`partner.*` keys; internal user
cannot hold `partner.*`. Statement: open / reviewed / closed periods, payments applied oldest-first, remaining,
adjustment history, partial-overlap period included, expired partnership read-only, no JE ids / account names in
portal responses. Navigation: section root + Home tile for `company-partners.view`, none without; partner audience
sees only partner items. Create-login refused before any agreement.
