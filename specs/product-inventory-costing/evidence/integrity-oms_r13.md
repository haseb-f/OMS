# Inventory integrity — database "oms_r13"

Generated 2026-10-06T04:15:38.198Z in 3977 ms — overall **FAIL** (PASS 5 · WARN 1 · FAIL 1).

Filter: products all, warehouse all.

| Invariant                                         | Status | Checked | Findings |
| ------------------------------------------------- | ------ | ------: | -------: |
| I1 Movement chain per product and warehouse       | PASS   |     778 |        0 |
| I2 No negative stock; reserved within on-hand     | PASS   |     232 |        0 |
| I3 No duplicate document-line movements           | PASS   |     532 |        0 |
| I4 Assembly orders: cost, consumption and journal | PASS   |       0 |        0 |
| I5 Kit sales: component deliveries and COGS once  | FAIL   |      12 |       36 |
| I6 Inventory valuation vs GL inventory accounts   | WARN   |      65 |        1 |
| I7 Agent-owned stock stays outside company books  | PASS   |     778 |        0 |

## I1 — Movement chain per product and warehouse: PASS

| Metric    | Value |
| --------- | ----: |
| movements |   778 |
| chains    |   232 |

## I2 — No negative stock; reserved within on-hand: PASS

| Metric   | Value |
| -------- | ----: |
| balances |   232 |

## I3 — No duplicate document-line movements: PASS

- Keyed (R13) movements are protected by a unique index; a duplicate key is a FAIL.

- Un-keyed legacy document movements repeated more often than the document has matching lines are listed as WARN for owner review — never auto-corrected.

| Metric                  | Value |
| ----------------------- | ----: |
| keyedMovements          |    50 |
| legacyDocumentMovements |   482 |

## I4 — Assembly orders: cost, consumption and journal: PASS

| Metric     | Value |
| ---------- | ----: |
| orders     |     0 |
| reversed   |     0 |
| agentOwned |     0 |

## I5 — Kit sales: component deliveries and COGS once: FAIL

| Metric   | Value |
| -------- | ----: |
| kitLines |    12 |
| invoices |    12 |

Findings (36; first 10):

- [FAIL] KIT_DELIVERY_QUANTITY_MISMATCH: Invoice INV-2026-000323: kit R13C-D2F94509-16 component R13C-D2F94509-14 delivered 0, snapshot implies -2
- [FAIL] KIT_DELIVERY_QUANTITY_MISMATCH: Invoice INV-2026-000310: kit R13C-00DE7E0A-20 component R13C-00DE7E0A-19 delivered 0, snapshot implies -2
- [FAIL] KIT_DELIVERY_QUANTITY_MISMATCH: Invoice INV-2026-000319: kit R13C-66F93712-16 component R13C-66F93712-14 delivered 0, snapshot implies -2
- [FAIL] KIT_DELIVERY_QUANTITY_MISMATCH: Invoice INV-2026-000323: kit R13C-D2F94509-16 component R13C-D2F94509-15 delivered 0, snapshot implies -1
- [FAIL] KIT_DELIVERY_QUANTITY_MISMATCH: Invoice INV-2026-000308: kit R13C-00DE7E0A-4 component R13C-00DE7E0A-2 delivered 0, snapshot implies -4
- [FAIL] KIT_DELIVERY_QUANTITY_MISMATCH: Invoice INV-2026-000302: kit R13C-6218A33E-16 component R13C-6218A33E-14 delivered 0, snapshot implies -2
- [FAIL] KIT_DELIVERY_QUANTITY_MISMATCH: Invoice INV-2026-000316: kit R13C-28C3057F-16 component R13C-28C3057F-15 delivered 0, snapshot implies -1
- [FAIL] KIT_DELIVERY_QUANTITY_MISMATCH: Invoice INV-2026-000301: kit R13C-6218A33E-4 component R13C-6218A33E-2 delivered 0, snapshot implies -4
- [FAIL] KIT_DELIVERY_QUANTITY_MISMATCH: Invoice INV-2026-000318: kit R13C-66F93712-4 component R13C-66F93712-2 delivered 0, snapshot implies -4
- [FAIL] KIT_DELIVERY_QUANTITY_MISMATCH: Invoice INV-2026-000309: kit R13C-00DE7E0A-16 component R13C-00DE7E0A-15 delivered 0, snapshot implies -1

## I6 — Inventory valuation vs GL inventory accounts: WARN

- GL side = posted balance of the inventory accounts read from journal lines (POSTED + REVERSED pairs net to zero) — never a recomputed balance.

- Sub-ledger = Σ on-hand × moving average of company-owned stock (agent-owned stock excluded), each product rounded to 2 dp.

- A difference is reported with its known causes for review — it is never forced to zero and never auto-corrected.

| Metric                               |     Value |
| ------------------------------------ | --------: |
| subledgerValue                       | 396820.56 |
| glBalance                            | 374909.36 |
| difference                           |  21911.20 |
| roundingBound                        |      0.62 |
| inventoryAccounts                    |       115 |
| openingBalanceMovements              |        62 |
| openingBalanceMovementValue          |  20231.00 |
| openingBalanceGlOnInventoryAccounts  |      0.00 |
| transferMovementsGlNeutral           |         0 |
| unpostedAdjustmentMovements          |         1 |
| unpostedAdjustmentValue              |   5177.48 |
| documentMovementsWithoutJournal      |       195 |
| documentMovementsWithoutJournalValue |   -225.87 |
| stockedProductsWithoutCost           |        51 |
| explainedByKnownCauses               |  25182.61 |
| remainderAfterKnownCauses            |  -3271.41 |

Findings (1; first 1):

- [WARN] VALUATION_GL_DIFFERENCE: INV مخزون البضاعة: stock value 396820.56 vs posted balance 374909.36 (difference 21911.20).

## I7 — Agent-owned stock stays outside company books: PASS

- Company valuation check is company-wide (the product / warehouse filter does not apply to it).

| Metric                    | Value |
| ------------------------- | ----: |
| movements                 |   778 |
| agentOwnedMovements       |   331 |
| agentOwnedProductsInStock |   165 |
| agentOwnedUnitsExcluded   |  9182 |
| agentOwnedValueExcluded   |  0.00 |
