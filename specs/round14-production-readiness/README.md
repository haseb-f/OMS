# Round 14 — Production readiness

Owner request: 2026-10-07. Integration branch: `integration/r14` (from `main` @ 60709e5a).
Implementation lead: Claude (this session). Checkpoint log: [checkpoint.md](checkpoint.md).
Decisions and open owner questions: [decisions.md](decisions.md).

## Workstreams, priority order

| #   | Spec                                                                                      | Branch                     | Priority |
| --- | ----------------------------------------------------------------------------------------- | -------------------------- | -------- |
| W3  | [spec-3-order-inventory-costing.md](spec-3-order-inventory-costing.md)                    | `feat/r14-inventory`       | 1        |
| W2b | [spec-2-permissions-shipping.md](spec-2-permissions-shipping.md) §B (shipping)            | `feat/r14-permissions`     | 2        |
| W2a | [spec-2-permissions-shipping.md](spec-2-permissions-shipping.md) §A (job-title templates) | `feat/r14-permissions`     | 3        |
| W4  | [spec-4-customer-discovery-history.md](spec-4-customer-discovery-history.md)              | `feat/r14-customers`       | 4        |
| W1  | [spec-1-entry-session-ui.md](spec-1-entry-session-ui.md)                                  | `feat/r14-ui-session`      | 5        |
| W5  | [spec-5-company-partners.md](spec-5-company-partners.md)                                  | `feat/r14-partners`        | 6        |
| W6  | [spec-6-verification-release.md](spec-6-verification-release.md)                          | `integration/r14` → `main` | —        |
| W7  | [spec-7-arabic-manual.md](spec-7-arabic-manual.md)                                        | after release              | —        |

## File ownership (agents never edit another stream's owned files)

| Stream | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1     | `apps/api/src/auth/**` (except permission decorators), `apps/web/src/lib/auth-token.ts`, `providers/auth-provider.tsx`, `app/(auth)/**`, `navigation/post-login.ts`, `components/ui/dropdown-menu.tsx`, `components/shared/data-table/row-actions-menu.tsx`, `components/shared/header-actions.tsx`, `components/ui/form.tsx`, `components/shared/form-fields/**`, `components/shared/password-input.tsx`, `components/settings/reset-password-field.tsx`, `components/settings/user-editor-modal.tsx`, `app/(shell)/hr/employees/[id]/page.tsx` (account tab only), employees reset endpoint |
| W2     | `apps/api/src/permissions/**` (resolver, new override service), `apps/api/src/job-titles/**`, `apps/api/src/users/**` (permission endpoints), shipping guards in `store-orders/shipments/**`, `sales-orders/sales-orders.controller.ts`, `import-center/handlers/shipping-updates-import.handler.ts` + `import-jobs` permission hook, `shipping-companies.controller.ts`, web `settings/users` permissions panel, job-title pages, `components/shipping/shipment-manage-dialog.tsx`, store-order detail page shipping gates only                                                              |
| W3     | `store-orders/store-orders.service.ts` (`generateInvoice` region), `store-orders/shipments/store-order-shipment-operations.service.ts`, new `store-orders/fulfillment-recognition/**`, `traceability/traceability.service.ts` (`storeOrder()`), `inventory/integrity/**`, repair script `apps/api/prisma/scripts/r14-*`, store-order detail page invoice/trace panel only                                                                                                                                                                                                                     |
| W4     | `apps/api/src/customer-lookup/**`, `store-orders/duplicates/**`, new `customer-history/**`, web `advanced-customer-lookup-dialog.tsx`, `duplicate-customer-panel.tsx`, `sales/customers/[id]/page.tsx`                                                                                                                                                                                                                                                                                                                                                                                        |
| W5     | new `apps/api/src/company-partners/**`, new posting provider `accounting/posting-providers/company-partner-posting.provider.ts`, new web `app/(shell)/company-partners/**`, `config/company-partners/**`                                                                                                                                                                                                                                                                                                                                                                                      |

Shared files, append-only in a stream's own section, merged by the lead:
`apps/api/prisma/schema.prisma`, `permissions/permission-catalog.ts`, `navigation/navigation.config.ts`,
`i18n` message files (`en.json` / `ar.json`), `app.module.ts`, posting-engine source-type registry,
`PostingSettings` (W5 adds two account columns).

Migration timestamps (no two streams share one): W1 `20261008100000…`, W2 `20261008110000…`,
W3 `20261008120000…`, W4 `20261008130000…`, W5 `20261008140000…`.

## Recovery

1. `git -C D:/Systems/OMS log --oneline main..integration/r14` and each `feat/r14-*` branch show what landed.
2. [checkpoint.md](checkpoint.md) records the last verified state of every stream and the next step.
3. Verification DB: `oms_r14` (clone of local `oms` migrated to the branch head) on `oms-postgres` :5434.
4. Never `git stash`, never `git add -A`; commit with explicit paths.
