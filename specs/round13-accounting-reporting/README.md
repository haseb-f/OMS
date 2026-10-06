# Round 13 — inputs, accounting integrity, assets, payments, sales reporting

Branch `claude/hopeful-feynman-2hzaxf` (base: R12 head `fda6725`). Local stack: API :3005, web :3001, DB `oms` (local PostgreSQL 16).

| File                                       | Purpose                                                      |
| ------------------------------------------ | ------------------------------------------------------------ |
| `audit/A…E-*.md`                           | Current-state findings (2026-10-06), file:line references    |
| `spec-A-inputs-order-entry.md`             | Phone, password, dropdowns, blue direction, sequential order |
| `spec-B-coa-posting-fx.md`                 | Group/Posting accounts, posting from operations, FX controls |
| `spec-C-assets-prepaid.md`                 | Invoice ↔ asset links, schedules, detail screens             |
| `spec-D-payment-methods-reconciliation.md` | One Payment Methods area, statement matching                 |
| `spec-E-sales-reporting.md`                | Live reports, employee / team performance                    |
| `plan.md`                                  | Dependencies, agent ownership, task checklist                |
| `decisions.md`                             | Decisions taken + open owner decisions (with recommendation) |
| `checkpoint.md`                            | Recovery handoff — read this first after an interruption     |
| `evidence.md`, `evidence/`                 | Verification results                                         |
