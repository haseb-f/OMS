# Handoff — payment-declaration-reconciliation

- Activated 2026-09-27, after `system-audit-ui` completed. That milestone was verified at
  HEAD = origin/main = Production = `83cec96`.
- Phase: inspection. Two read-only investigators are running:
  - INSP-A: Sales payment, fulfillment and permissions.
  - INSP-B: Finance review, posting, import/sync infrastructure and normalization.
- Working tree: only `.claude/launch.json` (local, not committed).
- Next: write plan.md (architecture, state machines, migration compatibility, account mappings,
  owner decisions needed), tasks.md, then delegate implementation.
