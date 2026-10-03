# R6 workstream A — navigation map

Source of truth: `apps/web/src/navigation/navigation.config.ts`. No route was removed or renamed;
only nav parents, headings, labels and gates changed. Verified by
`apps/web/src/navigation/r6-navigation.spec.ts` (20 tests) and
`apps/api/src/permissions/settings-domain-permissions.spec.ts` (15 tests) +
`agent-portal.integration.spec.ts` (R6 A.3 / A.5 cases).

## Finance (المالية)

| Before (heading › entry)                                                                                                           | After (heading › entry)                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Daily operations › المصروفات `/finance/expenses`                                                                                   | العمليات اليومية › المصروفات                                                  |
| › المقبوضات `/sales/payments`                                                                                                      | › المقبوضات                                                                   |
| › المدفوعات `/purchasing/payments` (outgoing)                                                                                      | › **مدفوعات الموردين / Supplier Payments** (moved last in the group)          |
| › مراجعة المدفوعات `/finance/payment-review` (incoming)                                                                            | › **تحصيلات المتجر / Store Collections**                                      |
| › مطابقة المدفوعات `/finance/payment-reconciliation`                                                                               | › **مراجعة التحصيلات / Collection Review**                                    |
| › العمليات المالية `/finance/bank-transactions`                                                                                    | › **مطابقة العمليات / Transaction Matching**                                  |
| › مطابقة تكلفة شركة الشحن                                                                                                          | › مطابقة تكلفة شركة الشحن                                                     |
| Ledger › قيود اليومية · دليل الحسابات · الأرصدة الافتتاحية                                                                         | الدفاتر والقيود › قيود اليومية · دليل الحسابات · الأرصدة الافتتاحية           |
| › General Ledger `/reports/finance?report=generalLedger`                                                                           | **removed** (lives in Reports › التقارير المالية; the URL still works)        |
| › دفاتر اليومية `/finance/journals`                                                                                                | → Settings › المالية                                                          |
| › أسعار الصرف والعملات `/finance/exchange-rates`                                                                                   | › **أسعار الصرف / Exchange Rates** (daily data, stays in Finance)             |
| Assets › cost centers · analytic accounts · analytic plans                                                                         | الأصول والتحليل › unchanged, then fixed assets · prepaid · accrued · projects |
| Setup › الحسابات `/finance/receiving-accounts` (ComingSoon)                                                                        | **hidden** (`visible: false`; route kept)                                     |
| Setup › payment methods/terms/sources, currencies, taxes, fiscal periods, year closing, accounting settings, cost-allocation rules | → Settings › المالية                                                          |
| Setup › fulfillment-cost rules                                                                                                     | → Settings › الشحن                                                            |

Page titles that used a renamed label now agree with the nav: payment review page reads
`nav.financePaymentReview`; reconciliation pages read `paymentReconciliation.title`;
bank-transactions page title/print title now read `nav.financeBankTransactions`. Breadcrumbs come
from the nav entry and follow automatically.

## Financial Reports (التقارير › التقارير المالية)

Unchanged: one entry `/reports/finance` (`reports.financial.view`). A
`?report=generalLedger` deep link resolves to it (no second Finance entry).

## Settings (الإعدادات) — by domain

| Heading                                | Entries (route unchanged)                                                                                                                                            | Gate (any-of)                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| عام / General                          | Company «بيانات الشركة» `/settings/general` (was «عام», same word as its heading), Numbering, Print, Notifications, Departments, Job titles, Users, Security, Backup | `settings.general.view`; numbering also `numbering.manage`; departments/job-titles their own view key; **Users: `settings.manage` only**                                                                                                                                                      |
| المالية / Finance                      | Accounting settings, Journals, Payment methods, Payment terms, Payment sources, Currencies, Taxes, Fiscal periods, Year closing, Cost-allocation rules               | own `masterdata.*.view`; fiscal periods / year closing / accounting settings: `accounting.fiscal-years.manage` **or** `settings.finance.view` **or** a ledger key (`accounting.journal-entries.view`, `.chart-of-accounts.view`, `.opening-balances.view`) — read-only without the fiscal key |
| الشحن / Shipping                       | Shipping companies, Shipping statuses (from Shipping), Fulfillment-cost rules (from Finance)                                                                         | own `masterdata.*.view`                                                                                                                                                                                                                                                                       |
| التكاليف / Costs                       | Cost categories `/expenses/cost-components` (from Expenses)                                                                                                          | `masterdata.cost-components.view`                                                                                                                                                                                                                                                             |
| المبيعات وعلاقات العملاء / Sales & CRM | Customer classifications, No-purchase reasons, Follow-up types, Workflow statuses (from Master Data), Workflow transitions (from Master Data)                        | own `masterdata.*.view` (workflow statuses was coarse `masterdata.view`)                                                                                                                                                                                                                      |
| التكاملات / Integrations               | Integrations `/settings/integrations`                                                                                                                                | `settings.integrations.view`                                                                                                                                                                                                                                                                  |

Master Data now holds only countries/cities/languages/transaction types, each gated on its own view
key (they were ungated children of a coarse parent).

### Permission model (spec A.3)

- New catalog keys `settings.{general,finance,shipping,costs,crm,integrations}.{view,manage}` in
  the matrix section «الإعدادات» (the old «الإعدادات» row is relabelled «المستخدمون وإدارة النظام»
  — it stays the user-administration key).
- Resolved at request time only (`withSettingsDomainGrants`, used by `PermissionsResolverService`,
  so guards and `/auth/me` agree): `.view` → the domain modules' `view` keys; `.manage` → their
  view/create/edit/delete/manage keys; any domain key → `settings.view`. Never persisted, so
  revoking the domain key revokes what it granted. Never applied to agent users.
- Never implied by any domain key ([O] owner decision, default): postings, reversals and period
  control — `accounting.fiscal-years.manage` (year closing, period close/reopen/lock, foundation
  activation, posting-settings writes) and cost-allocation `run`/`post`; also user administration
  (`settings.manage`) and other domains. Existing granular keys keep working unchanged. A test
  asserts no domain key expands to any post/reverse/run/confirm/settle/approve action.
- Pages whose API writes need a key the viewer lacks render read-only: numbering (no edit
  controls without `numbering.manage`), fiscal periods (period actions hidden), year closing, and
  accounting settings (save hidden, pickers disabled without `accounting.fiscal-years.manage`).
- Migration `20261001130000_r6_settings_domain_permissions` — preservation only, never a widening:
  `settings.manage` holders → all 12 domain keys; `settings.view` holders → `settings.general.view`
  - `settings.integrations.view` (the formerly ungated General/Integrations pages they opened through
    the Settings section). Granular setup keys are not a migration source — they keep opening their
    own pages through any-of gates. The formerly ungated Finance setup pages need no grant: their gate
    also accepts the accountants' ledger keys (finance users without a ledger key, e.g. receipts-only,
    lose these read-only setup pages — intended tightening). Internal users only; additive,
    idempotent (local result: the 2 full admins only).

## Agent portal (audience `agent`)

| Before                                                           | After                                          |
| ---------------------------------------------------------------- | ---------------------------------------------- |
| لوحة الوكيل / Agent dashboard `/agent`                           | **لوحة التحكم / Dashboard** (nav + page title) |
| leads · orders · stock · statement · commission · payouts · team | unchanged                                      |

## Landing (spec A.4)

- Login with no valid `next` → `/` (internal) or `/agent` (agent) directly — no bounce.
- An expired session (API 401) also returns to `/login?next=<path+query>` (`api-client.ts`).
- `proxy.ts` keeps the full deep link (`next=<path>?<query>`); an already signed-in visitor of
  `/login` goes to their audience home. `next` is validated (`navigation/post-login.ts`):
  relative same-origin path, not `//`/`\`/scheme/control chars (incl. tab/newline), no
  `.`/`..`/`%2e` segments, NORMALIZED path re-checked for a single leading `/`, not an auth page or `/investor`,
  agents only `/agent*` (+ `/profile`), internal users never `/agent*`.
- A fresh login clears the remembered accordion module; the active route's parent still opens.

## Role-access matrix (verified by `r6-navigation.spec.ts` › "role-access matrix")

OMS has no roles; rows are representative per-user grant sets after the migration.

| Role                                                          | Finance section                                  | Settings domains visible | Settings › Users | Agent portal                                 | Settings write API (agent token)                                         |
| ------------------------------------------------------------- | ------------------------------------------------ | ------------------------ | ---------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Internal Admin (super admin)                                  | yes                                              | all 6                    | yes              | no                                           | n/a                                                                      |
| Internal Sales                                                | no                                               | none                     | no               | no                                           | n/a                                                                      |
| Internal Shipping (holds shipping-companies view)             | no                                               | Shipping                 | no               | no                                           | n/a                                                                      |
| Internal Finance (ledger + fiscal key + payment-methods view) | yes (incl. Store Collections, Supplier Payments) | Finance                  | no               | no                                           | n/a                                                                      |
| Agent Admin                                                   | no                                               | none                     | no               | yes (Dashboard, statement, payouts, team, …) | 403 (integration test, even with a stored `settings.finance.manage` row) |
| Agent Sales                                                   | no                                               | none                     | no               | yes (Dashboard, leads, orders)               | 403                                                                      |

Agent dashboard money (spec A.5, integration test with agents A and B): Agent Sales in OWN scope —
even with `agent.statement.view` — gets own sales only; `returns`, `collections`, `position`,
`payouts` are `null`. Agent Admin (ALL scope) keeps the whole-agent figures; agent B's admin sees
only agent B.
