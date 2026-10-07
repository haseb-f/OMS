# W6 — Integrated verification and release

1. Merge order into `integration/r14`: W3 → W2 → W4 → W1 → W5 (lead resolves shared files).
2. On the merged tree: `prisma generate`, migrate a fresh clone `oms_r14` (from local `oms`), migration
   tests (permission parity, shipping grant), API typecheck + lint + full jest (serial suites included),
   web typecheck + lint + build.
3. Journey script `scripts/acceptance/r14/r14-journeys.mjs` (API level, local build): landing paths,
   session revoke/idle/logout, shipping 403 matrix, job-title inheritance/deny/escalation, stock/cost
   flows (company stocked, kit, service, assembled, agent, COD, return), lookup/history isolation, partner
   close/pay/adjust/duplicate.
4. One browser pass (Playwright) on the affected pages: login landing (company + agent), sidebar,
   menu tones, required asterisks, password reset, user dialog, store order recognition banner,
   customer history, partners statement; ar/en, desktop/mobile, light/dark screenshots →
   `evidence/browser/`.
5. Production simulation: restore a read-only Prod snapshot is NOT available; instead run the R14
   migrations against a clone of local data + the read-only Prod survey script (counts of users with
   shipping.edit, delivered-uninvoiced orders).
6. Release: fast-forward `main` to `integration/r14`, push (Vercel Production deploy). Confirm SHA via
   `gh api …/deployments`, migration outcome via read-only API probes, smoke checks (login, Home,
   store-order list, traceability of a delivered order, partners page, repair dry run).
7. Record in `release.md`: deployed SHA, what was verified live vs only locally, blocked checks.
