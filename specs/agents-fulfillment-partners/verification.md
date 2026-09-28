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

## Production acceptance

See the section appended below after the Production run.
