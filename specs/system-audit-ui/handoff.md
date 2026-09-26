# Handoff — system-audit-ui

- Branch `main`. HEAD = origin/main = Production = `7e61bd5` (controls refactor, deployed + verified 86/86).
- Uncommitted: `.claude/launch.json` (local launcher, intentionally not committed); `scripts/acceptance/journey-audit.mjs` (AUD-01 script, to commit with guide); in-progress fixes from FIX-D1 / FIX-FE / FIX-API; DOC-01 guide edits.
- Running agents: FIX-D1, FIX-FE, FIX-API, DOC-01 (see tasks.md).
- Evidence: `tmp/acceptance/DEMO-AUDIT-20260926/` (AUD-01), `tmp/acceptance/PROD-CONTROLS-7e61bd5/`, committed copy `docs/user-guide/evidence/SYSTEM-AUDIT-UI-20260926/controls/`.
- Next: review + gates for fixes → commit/push → verify SHA → AUD-02 (journey-audit.mjs rerun, RUN=DEMO-AUDIT-20260926) → copy non-zz shots to docs/user-guide/screenshots/audit/ → fill guide statuses/`{{PROD_SHA}}` → commit/push → verify SHA.
- D5 resolved: owner approved migration `20260926120000_standard_cost_components`, with customs and
  inbound shipping capitalizable, order fulfillment as FULFILLMENT, and the generic codes left
  unclassified.

## Queued next milestone (dependency)

- `specs/payment-declaration-reconciliation/spec.md` is **QUEUED**. It depends on this milestone
  passing its acceptance criteria (AC-UI, AC-AUD, AC-REL), including security fixes SEC-01/02/03 and
  the TEST-01 fixes for the failing tests that predate this milestone.
- When this milestone completes, activate the queued one automatically in the same session: inspect
  the final state → plan → implement → review → test → deploy → verify. Do not mix the two milestones.
  If a genuine blocker stops this milestone, report it and keep the next one queued.
