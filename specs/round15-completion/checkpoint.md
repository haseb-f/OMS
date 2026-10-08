# R15 checkpoint log

Newest first. Each entry: date, who, verified state, next step. Recovery:

1. `git -C D:/Systems/OMS log --oneline main..integration/r15` and each `feat/r15-*` branch show what landed.
2. [requirements.md](requirements.md) is the status of every acceptance criterion (only the lead moves a row).
3. Never `git stash`, never `git add -A`; commit with explicit paths.

## 2026-10-07 — lead, start

- Branch `integration/r15` from `main` @ 8c074771 (Production code 0db15e41 = R14 + polish).
- Requirement checklist written (requirements.md). Six read-only code surveys launched (agent overview/entry,
  imports, agent shipping agreements, partners/portal auth, store-order lifecycle, sales-report scope).
- Next: write specs + decisions from the surveys, assign file ownership, launch workstreams.

## 2026-10-07 19:30 — lead, after the first usage-limit cut

- Foundation (schema + 7 migrations incl. lead fix `20261009100310_r15_partner_user_check`, catalog, labels, i18n
  namespaces) on disk, uncommitted (API compiles again thanks to W3 step 1).
- Streams: W4 done (report in progress-w4.md), W5b done, W6 done, W2 done per log, W3 done per log (agent cut before
  its report), W1 at step 8 (cut), W5a API done + tests, web part pending.
- Lead integration in progress: W6 contract types applied; next W4 requests 1–8, W5b requests, W6 migration parity.

## 2026-10-08 07:00 — lead, integration while W1 / W5a finish

- Done streams: W2 (669 API + 96 web tests), W3 (verified by lead: shipping-agreements + pricing 47/47, agent
  orders/portal/admin 67/67 after updating one assertion to D15-3), W4, W5b, W6.
- Lead integration applied: W6 contract types + parity migration fix (`reports.sales.view_all` to every
  crm.leads.manage holder without a team; local DB checksums updated); W4 requests 1–8 (route guard partner redirect,
  password page home, auth types, shared `PortalIdentity` replacing the agent-only chip, permission formula +
  resolver + template guard for `partner.*`, coverage allowlist, insight spec paths); W5b vocabulary REVERSED; W3
  i18n cleanup (dead rates/tariff keys, wording → shipping agreement); W2 requests (agent owner via
  `agent.records.assign` + test + mutation proof, lead duplicate names the matched lead + test, store-orders import
  menu, needs-review uses the shared reject picker + importer access, agent-imports destination line).
- API `tsc` clean on the whole tree; web `tsc` only W1 WIP spec.
- Running: W1 (step 8 + agent figures on report scope + rateScope ALL), W5a (web part + 2 broken suites +
  traceability advance refunds + W3 import/amendment calls).
- Next: integrate W1/W5a, panel insertions in store-orders/[id], full gates on a fresh integrated DB, independent
  accounting + permission reviews, journeys, browser pass, commit, release.

## 2026-10-08 08:00 — lead, all streams done

- W1 and W5a finished (reports in progress-w1.md / progress-w5a.md). Permission review → review-permissions.md
  (H1 posted COGS on stock responses, M1 agent back-dating, M2 backfill dry-run scope, L1–L8). API journeys
  `scripts/acceptance/r15/r15-journeys.mjs` on oms_r15_e2e: 246 PASS / 2 FAIL (one defect: receive-back / stock
  view 404 for an archived order) → evidence/journeys.json.
- Next: lead fixes (defect, H1, M1, M2, L1–L8 as decided), W1/W5a/W5b web integration (order detail panels, list
  chip/filter, D15-3 web gates), accounting review, full gates, rerun journeys, browser pass, commit, release.

## 2026-10-08 13:30 — lead, final tree verified, committing

- Lead fixes done: defect (archived order stock view / receive-back), H1 (postedCogs only with profitability /
  inventory-cost visibility), M1 (agent users never back-date), M2 (backfill super admin only), L-items per the
  review dispositions; accounting review dispositions applied; bilingual shipping-agreement activity details.
- Gates on the final tree: api tsc 0 / eslint 0 / jest 221 suites + 20 serial / nest build; web tsc 0 / eslint 0
  errors / vitest 166 files 1174 tests / next build. Journeys 248/248 (journeys-final.log). Browser 887/907 →
  fixes (bidi isolation, warning-text contrast, rank phrase direction, mobile phone list) → targeted rerun 806/808
  (2 = activity rows written before the bilingual change in the local DB).
- requirements.md: every local row `verified` with evidence; 7.1, 7.3, G3–G5 wait for the release.
- Next: commits (explicit paths), fast-forward main, push = Production deploy, confirm SHA + migrations, stock
  backfill dry run → apply, live browser pass with roles, handoff §5–7, user manual.
