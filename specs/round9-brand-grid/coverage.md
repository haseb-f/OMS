# Round 9 — coverage record (Table / Grid, brand controls, authorization)

Generated from a live browser run of the integrated build (admin = demo company super admin; Agent Admin / Agent Sales / agent B for the portal) plus the per-area fragments in `coverage/`.

## Live route run (`evidence/coverage-run-*.json`, script `tmp` → `scripts/acceptance/r9/coverage-run.mjs`)

- Routes opened: 92 (company 86, agent portal 6 as Agent Admin), re-run on the corrected build. Switch present and the grid drew cards: **73**. No horizontal overflow, no page error and no missing switch on any (0 problems).
- Switch present but the demo database has **no records** (grid verified only as the empty state; each template is covered by its unit spec): `/agents/collections`, `/finance/accrued-expenses`, `/finance/cost-allocation-rules`, `/finance/expenses`, `/finance/fulfillment-cost-rules`, `/finance/projects`, `/hr/commission-plans`, `/hr/commissions`, `/hr/employees`, `/hr/kpi-evaluations`, `/hr/kpi-templates`, `/hr/payroll`, `/hr/payroll-components`, `/hr/ranking`, `/hr/sales-targets`, `/inventory/physical-count`, `/master-data/unit-conversions`, `/master-data/warehouse-locations`, `/store-orders/needs-review`.

## Per-area records

- Sales / customers / suppliers / products — `coverage/sales.md`
- Purchasing / inventory / shipping / store-order review — `coverage/purchasing-inventory-shipping.md`
- Agents, finance, HR, investors, settings, master data — `coverage/agents-finance-hr-settings.md`
- Orders and leads (company + agent) — R7 templates, unchanged slots (`store-order-grid-card.tsx`, `lead-grid-card.tsx`), now on the shared card look.

## Specialised (hierarchical / financial) presentations

| screen                                                                                                                                                | grid presentation                                                                                                                                                                                         | notes                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Financial reports (trial balance, income statement, balance sheet, cash flow, general ledger, journal report, aging, statements) and investor ledgers | `FinancialReportView` → `FinancialReportCards`: one card per top-level section with its descendants, every amount column named on each row, subtotal / grand-total rows keep weight and fill, totals card | per-user + per-report switch; print/export unchanged   |
| Chart of accounts                                                                                                                                     | `TreeGridCards`: one card per top-level account with its whole subtree                                                                                                                                    | expand/collapse, selection, actions are the tree's own |
| Warehouse locations                                                                                                                                   | same                                                                                                                                                                                                      |                                                        |
| Exchange rates, agent team (`CompactDetailTable` + `viewId`)                                                                                          | label/value cards, totals card                                                                                                                                                                            |                                                        |

## Documented gaps (not hidden)

- `gridView={false}`: payroll run lines, agent commission report, company-side agent statement (matrix / ledger shapes a card would mislead) — reasons in `coverage/agents-finance-hr-settings.md`.
- Sub-tables inside detail pages (order lines, payment allocations, investor sections, agreements, destinations, workflow transitions) and the investor portal (a separate audience) are sections of a record, not list screens, and keep tables.
- `expenses/cost-explorer` is a per-order cost DETAIL page (sections of one record's economics), not a list — it keeps its sub-tables (correction of an earlier note that listed it as an unconverted list).
- Invoice cards show the remaining balance, not a due date: the invoice row has no due date.
- Inventory movement cards show unit cost because the existing table shows it to everyone with page access (parity, not a new exposure).

## Independent review (fresh-context reviewer) and what was fixed

HIGH/MEDIUM findings fixed in this round: reference number clipped → it now wraps on its own row and the key figure has its own row; accessible names → card `aria-label` = "customer — number", checkbox/link described by the number; "—" noise → empty fields are dropped (card and automatic card); weak key figure → semibold own row; ragged heights → equal-height cards; info-tone card read as selected → quieter info wash + 2px selection ring on a neutral tint; hover lift only on cards that open something; marker moved to the badge row; lone field spans the row; skeleton mirrors the card and the page size; 40px touch hit area on the checkbox.

Not changed (reasoned): solid blue selectors inside dialogs/forms (owner-approved in R8), colour-by-position of the ramp (the approved stable-role rule), copying text from a card (the stretched link; the table remains the place to copy), the bare selection bar.

## Correction pass (blue-only controls, distribution states, flat cards) — verified

- `scripts/acceptance/r9/verify-correction.mjs`: 46 checks — every selector control on toolbars, report filters, forms and the dialog is in the blue family (hue 213–215, white labels, no teal), ramp tone 1 deepest → tone 5 lightest with tone 1 at the RIGHT in Arabic; all five solid distribution states have their own colour, a failure beats the mode, a 250-lead backlog is not blocked, unavailable/loading are their own treatments; leads (info / success / warning), orders (4 tones), invoices, shipping, customers have flat cards (no gradient), one radius, a readable badge; hover changes tint + hairline without movement or reflow; focus ring; selected is distinct from hovered and keeps its ring on hover; reduced motion turns transitions off.
- Palette per entity: `card-palettes.md`. Distribution mapping: design-system §12.20.
