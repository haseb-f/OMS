# W4 progress — customer discovery, repeat orders, customer history

Branch `feat/r14-customers` (worktree `D:/Systems/OMS-r14-w4`, DB `oms_r14_w4`).

## Checkpoint 1 — API (done)

- Shared definitions `apps/api/src/customer-history/customer-order-stats.ts` (placed / completed / repeat ≥ 2 / product summary).
- Advanced lookup returns `disclosure` (full name, E.164 phone, latest order + product summary + coarse status, placed /
  completed counts); audit `outcome_detail = FULL_DISCLOSURE`; limits, caps and agent exclusion unchanged.
- Duplicate check: `disclosure` only for COMPANY callers holding `customers.lookup_advanced`; a disclosure reaching beyond
  the caller's records is reserved from the shared lookup budget; when spent → masked result (entry never blocked).
- `GET /customers/:partnerId/history` (`partners.view` — the catalog has no separate `customers.view`; Customers pages
  are the `partners` module) and `GET /customers/:partnerId/order-stats` (badge numbers; partners.view or own scope).
- Permission `customers.view_financials` + migration `20261008130000_r14_customer_financials_permission` (also adds
  `global_lookup_audits.outcome_detail`), applied on `oms_r14_w4`.
- Tests: customer-history (8 integration + 5 unit), customer-lookup (31), duplicates (36) green; mutation: dropping
  `storeOrderAccessWhere` from the history query fails "only counted".

## Checkpoint 2 — Web (next)

Shared `CustomerMatchCard` + `RepeatCustomerBadge`, lookup dialog, duplicate panel buttons, customer page tabs.
