# Handoff — system-audit-ui

**Status: COMPLETE.** Every acceptance criterion passes (see `verification.md`). The final release SHA is
recorded in the Release section of verification.md after the documentation commit deploys.

- Branch `main`. Code releases: 7e61bd5 (controls), 4504d61/e7283fe/64679e7 (migration, fixes,
  security), 91b5086 (landed-cost currency), 8679510 (popover gutter). A final documentation commit
  follows.
- Working tree after the final commit: only `.claude/launch.json` (local dev launcher, intentionally
  not committed).
- No jobs are running and no deployments are pending once the final documentation deploy succeeds.
- Evidence (committed): `docs/user-guide/evidence/SYSTEM-AUDIT-UI-20260926/{controls,controls-8679510,security,journeys}`
  and `docs/user-guide/screenshots/audit/`. Raw run output (not committed, `tmp/` is ignored):
  `tmp/acceptance/{DEMO-AUDIT-20260926,DEMO-AUDIT-20260926-R2,DEMO-AUDIT-20260927-FINAL,PROD-SEC-64679e7,PROD-CONTROLS-*}`.
- Re-run commands (Production; passwords come from `tmp/.qa.env`):
  - `node scripts/acceptance/journey-audit.mjs` (RUN=…; `MERGE=1 STEP=<regex>` re-runs single checks)
  - `MSYS_NO_PATHCONV=1 node scripts/acceptance/controls-visual.mjs`
  - `node scripts/acceptance/partner-catalog-access.mjs`
  - `node scripts/acceptance/session-isolation.mjs`

## Open items and owner decisions (not blocking)

1. Add a second active warehouse on Production so inventory transfers can be tested (J041 BLOCKED).
2. Decide whether shipping staff should start shipments, which means granting `shipping.manage` to the
   shipping role (J077/J081 BLOCKED).
3. Some users may still hold `partners.view`, `products.view` or `shipping.view` that was stored in the
   database only because a group or master-data grant implied it before H4. Cleaning these up is a
   permission-data change that needs owner approval. Locally: 0 / 2 / 1 such users; Production has
   not been inspected.
4. `investors.view` is still implied by the investment-opportunity grants, because the "Add investor"
   dialog lists investors. A picker endpoint for investors, like the partner one, would remove the
   remaining investor data exposure.
5. Low-priority console 403s that don't affect use (issues.md N1–N3): `/journal-entries` on the
   shipping page, `/import-center/jobs` on needs-review, and the stock card on product cost.
6. Short data-driven lists (follow-up types, workflow statuses, fiscal years, templates) stay a plain
   `Select` while they have 7 or fewer options (AC-UI-2 gap by policy).
7. The purchasing role still sees read-only finance pages whose GET endpoints are open (year closing,
   accounting settings); writes are permission-guarded.
8. Permission choices made during SEC-03, flagged for owner review: PO close requires `edit`, document
   submit requires `edit`, and the inventory valuation method requires `settings.manage`.

## Queued next milestone (dependency)

- `specs/payment-declaration-reconciliation/spec.md`: its dependency is now satisfied, and it activates
  in this session after the final documentation deploy is verified. On activation: inspect the final
  state → plan → implement → review → test → deploy → verify. Do not mix it with this milestone.
