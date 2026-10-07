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

## Checkpoint 2 — Web (done)

- Shared `components/business/customer-match-card.tsx` (full card) + `repeat-customer-badge.tsx`
  (`RepeatCustomerBadge`, `PartnerRepeatBadge`), `components/sales/customer-history.tsx` (summary bar, orders table,
  order collections, timeline), `services/customer-history-service.ts`, i18n module `customer-history.{ar,en}.ts`.
- Lookup dialog shows the card; duplicate panel shows the card + "إنشاء طلب جديد لنفس العميل" / "إلغاء وعدم التكرار"
  (`onCancel` passed by store-order create, lead convert, agent order form — one prop line each).
- Customer page: summary strip, repeat badge, orders tab = store + B2B history, leads tab, timeline tab, order
  collections in payments tab (financials only when the server sends them). Store-order detail: one import + one
  render line (`PartnerRepeatBadge`, company orders only).
- Shared-file touches (append-only): `permission-matrix.tsx` label for `view_financials`, `permissions.actions.viewFinancials`
  in ar/en, module registration in ar/en.
- Web: tsc clean, eslint clean (1 pre-existing warning in agent-order-form), vitest 142 files / 1010 tests green.
