# Round 13 (accounting & reporting + R13b owner decisions) — Production release record

- Released commit: `9e56a551` on `main` (fast-forward from `70f87ecd`; includes the inventory R13 already in Production).
- Vercel Production deployment `6887073454`: **success** at 2026-10-06T14:44:20Z ("Deployment has completed"), commit status `Vercel: success`.
- The Production build (`scripts/vercel-build.sh`, `set -euo pipefail`) runs `prisma migrate deploy` before the web build, so a successful deployment means all pending migrations applied:
  `20261006100000_r13_ft_idempotency`, `20261006110000_r13_schedule_cancelled`, `20261006120000_r13_payment_method_channel` (duplicate ACTIVE matches consolidated, unique index enforced), `20261006130000_r13_sales_reports_permission`, `20261007100000_r13b_asset_prepaid_corrections` (schedule test-data fix, `Tax.is_recoverable`, `tax_capitalized`), `20261007110000_r13b_expenses_consolidation` (legacy expenses → expense vouchers, table dropped, permissions mapped).
- Not verified from this session: HTTP/UI checks of the live site — the session's network policy blocks `oms.haseb.org` and `*.vercel.app` (CONNECT 403); Production row counts of the data fixes (migration NOTICE output is in the Vercel build log).
- Post-deploy owner checks: open Finance → Expenses, Reports → Sales reports (Live), Master data → Payment methods; Vercel build log for the NOTICE lines (`payment_matches consolidation`, legacy expense conversion counts).
