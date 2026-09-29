# Verification — Agents / Fulfillment Partners

Release commit: `923b4b4` (Production deployment reported `success`). Print commits released
before it: `db36184`, `36d9e70`, `716e0af`, `977900d`, `3706911`.

## Quality gates (local, on the committed tree)

| Gate                                                | Result                                     |
| --------------------------------------------------- | ------------------------------------------ |
| `pnpm typecheck` (all 7 projects)                   | PASS                                       |
| `pnpm lint`                                         | PASS — 0 errors (45 pre-existing warnings) |
| API jest (`npx jest --maxWorkers=4`)                | PASS — 130 suites, 1,606 tests             |
| API serial (`pnpm --filter ./apps/api test:serial`) | PASS — 4 suites, 42 tests                  |
| Web vitest                                          | PASS — 56 files, 392 tests                 |
| `pnpm build` (api + web)                            | PASS                                       |

Note: the API suite needs `--maxWorkers=4` on the local Postgres (connection limit at default
parallelism). `agent-finance.integration.serial.spec.ts` runs serially because it switches the
shared PostingSettings row.

## Automated coverage (highlights)

- Identity separation: `jwt-auth.guard.agent.spec.ts` (deny-by-default, live affiliation,
  deactivated user/agent), `auth.service.spec.ts` (agent claim only for agent users),
  `agent-portal.integration.spec.ts` separation matrix — agent tokens → 403 on 24 internal routes
  (store orders, ids, shipping transitions, payments confirm, reconciliation, settlements, agent
  finance, payouts, import center, pickers, leads, users, agents); internal token → 403 on
  `/agent-portal/*`; forged agentId → 401.
- Isolation: agent A → 404 on agent B orders, leads, declarations, conversion, payouts,
  attachments; Sales without `agent.records.view_all` sees only own records.
- Pricing: `agent-order-pricing.spec.ts` (modes A/B, allocation, rounding, invalid input).
- Orders: `agent-orders.integration.spec.ts` (agreements, owner lock, mixed owner, missing rate vs
  audited override, pickup/digital, declaration = payable total, destinations, generate-invoice
  blocked, distribution exclusion, legacy totals unchanged, review fixes S1–S4, workspace orders).
- Finance: `agent-ledger.math.spec.ts`, `agent-finance.integration.serial.spec.ts` (both
  destinations, commission on merchandise only, fees, returns REVERSE/RETAIN, payouts partial and
  final, concurrent payouts, idempotent retries, ledger immutability, statement reconciliation,
  pending postings, shipping-updates import hooks).

## Independent reviews

| Review              | Result                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Security            | 1 HIGH, 3 MEDIUM, 5 LOW — all fixed with regression tests (customer PII via partner dedup, agent goods in company documents, import/sync hooks, order-owner affiliation, agent-received claims in generic actions, internal Users API on agent users, Sales takeover, leaks).                                            |
| Financial integrity | 1 HIGH, 5 MEDIUM, 8 LOW — all fixed (company lead conversion of agent goods, bank reconciliation adopting agent-received claims, import hooks, management P&L, account-change lock, rate city, dating, fee reversal, trigger coverage, return fee, pickup return, currency checks, snapshot flags, investor allocation). |

## Local acceptance (tagged `DEMO-AGT-20260928`)

| Suite                                              | Result                                                         |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `scripts/acceptance/agents-api-acceptance.mjs`     | 36/36 PASS (re-run after acceptance fixes: 36/36)              |
| `scripts/acceptance/agents-browser-acceptance.mjs` | 13/13 PASS (J1–J11, forced password change, 390 px phone pass) |

Sample local references: Agent A `AG-0071`, Agent B `AG-0072`; lead `LD-2026-016579`; orders
`STO-2026-022363` (shipping included 1,000 incl. 100 → agent balance +780) and `STO-2026-022362`
(shipping added 1,000 + 100 → +870, then +900 after a 1-unit return: +50 commission reversal,
−20 return fee); payouts `APO-2026-00054`…`00057` (00057 reversed); settlement `PST-2026-000133`;
agreements `AGR-2026-0084` (10 %, ended 29 Sep) → `AGR-2026-0086` (12 % from 30 Sep; today's orders
kept 10 %). Evidence: `tmp/agents-acceptance/latest.json`, `browser-latest.json`; screenshots
`docs/user-guide/evidence/agents-20260928/`.

Acceptance defects found and fixed before release: Finance could not list an agent's orders
(new `GET /agents/:id/orders`), English ledger descriptions in the Arabic UI (localized helper),
200-row cap in currency/payment-method pickers, digital-only orders counted as awaiting shipment,
password rule shown as an error before input.

## Production acceptance (https://oms.haseb.org, `923b4b4`, 2026-09-29)

Owner approval (chat, 2026-09-29) for scoped QA grants and tagged demo records. Additive grants via
`POST /users/:id/permissions`: qa-finance + `agents.view`, `agents.finance.view|verify|post|adjust`,
`agents.payouts.create|reverse`, `agents.statement.print`; qa-shipping + `agents.view`,
`shipping.manage`, `shipping.create`. No D1 accounts set; no GL accounts, payment methods or
receiving accounts created; no direct DB access.

Setup (tag `DEMO-AGT-20260928`, via the real endpoints as qa-admin): agents `AG-0001` (A) and
`AG-0002` (B); agreements `AGR-2026-0001` (A 10 %) / `AGR-2026-0002` (B 8 %), later
`AGR-2026-0003` (A 12 % from 2026-10-01); products `PRD-2026-000033`…`000036`; opening stock
`OPN-2026-000028`/`000029` on WH-000001 (journal-entry count 384 before and after — no posting);
five agent users created from the Agent team path, first login forced a password change.

| Journey                                                                                                                                                                                            | API                                                                                                | Browser                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------ |
| Separation: agent tokens on internal endpoints (46 probes → 403); agent redirected from 6 internal URLs; internal user «الوصول مرفوض» on `/agent`                                                  | PASS                                                                                               | PASS                     |
| Isolation: other agent's orders / proofs → 404; search scoped                                                                                                                                      | PASS                                                                                               | —                        |
| Forced password change (API refusal `MUST_CHANGE_PASSWORD`; UI → `/profile/password` → `/agent`)                                                                                                   | PASS                                                                                               | PASS                     |
| Lead → convert, shipping added: `LD-2026-000096` → `STO-2026-000136` (1,100); UI `LD-2026-000097` → `STO-2026-000143`                                                                              | PASS                                                                                               | PASS                     |
| Shipping included 1,000 = 900 + 100: `STO-2026-000137`, UI `STO-2026-000144` with live breakdown; concurrent double submit → one order                                                             | PASS                                                                                               | PASS                     |
| Declarations: partial 400 (shipping refused) → full 600 with proof (`PAY-2026-000087`/`000088`); retried request → one claim                                                                       | PASS                                                                                               | PASS                     |
| Internal shipping: Agent filter, ship, deliver, A5 COD slip «يُحصّل 1,100» (`STO-2026-000145`), return receipt `ART-2026-00001` (+50 commission reversal, −20 return fee, idempotent)              | PASS                                                                                               | PASS                     |
| COD `STO-2026-000138`: ships unpaid; agent declaration after dispatch refused; Finance records the courier claim `PAY-2026-000083`                                                                 | PASS                                                                                               | —                        |
| Pickup `STO-2026-000139`: handover dispatches and earns, no shipping fee                                                                                                                           | PASS                                                                                               | —                        |
| Digital course `STO-2026-000140` paid to the agent wallet: company confirm refused, Agent collections verification = memo 400, idempotent                                                          | PASS                                                                                               | PASS (`STO-2026-000146`) |
| Statement: opening + lines = closing; portal = internal; Agent A all-time 24 lines, closing −1,190.00 EGP (commission base 5,500, charged 550, reversed 100; collected by agent 800, by company 0) | PASS                                                                                               | PASS (+ print preview)   |
| Effective-dated agreement: today's `STO-2026-000142` keeps 10 % after `AGR-2026-0003` (12 %) was added                                                                                             | PASS                                                                                               | —                        |
| Phone width 390 px, 4 pages, no horizontal scroll                                                                                                                                                  | —                                                                                                  | PASS                     |
| **Company-destination payment matching / verification**                                                                                                                                            | BLOCKED — 422 `AGENT_ACCOUNTS_NOT_CONFIGURED`                                                      | BLOCKED (same)           |
| **Company-paid refund**                                                                                                                                                                            | BLOCKED — nothing company-collected while verification is blocked (409 `REFUND_EXCEEDS_COLLECTED`) | BLOCKED                  |
| **Payout**                                                                                                                                                                                         | BLOCKED — 422 `AGENT_ACCOUNTS_NOT_CONFIGURED`; UI confirm disabled with banner                     | BLOCKED                  |
| **Post pending entries**                                                                                                                                                                           | BLOCKED — 422 `AGENT_ACCOUNTS_NOT_CONFIGURED` (22 entries pending)                                 | BLOCKED                  |

Totals: API 15 PASS / 4 BLOCKED; browser 11 PASS / 4 BLOCKED; 0 FAIL. All BLOCKED items fail
closed with the D1 message and are **not** counted as passed. They pass locally, where the agent
accounts are configured (36/36 API, 13/13 browser).

Defect found in Production and fixed in the follow-up release: the fail-closed toasts showed the raw
key (`errors.AGENT_ACCOUNTS_NOT_CONFIGURED`) — untranslated codes now show the UI-language half of
the server's «عربي — English» message.

Evidence: `tmp/agents-acceptance/prod/*.json`; screenshots
`docs/user-guide/evidence/agents-20260928/prod/` (32 files). Scripts:
`scripts/acceptance/agents-prod-acceptance.mjs`, `agents-prod-browser.mjs`.
