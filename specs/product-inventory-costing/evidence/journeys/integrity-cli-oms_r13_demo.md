# Inventory integrity — database "oms_r13_demo"

Generated 2026-10-06T06:58:25.054Z in 4740 ms — overall **WARN** (PASS 6 · WARN 1 · FAIL 0).

Filter: products all, warehouse all.

| Invariant                                         | Status | Checked | Findings |
| ------------------------------------------------- | ------ | ------: | -------: |
| I1 Movement chain per product and warehouse       | PASS   |     722 |        0 |
| I2 No negative stock; reserved within on-hand     | PASS   |     204 |        0 |
| I3 No duplicate document-line movements           | PASS   |     507 |        0 |
| I4 Assembly orders: cost, consumption and journal | PASS   |       6 |        0 |
| I5 Kit sales: component deliveries and COGS once  | PASS   |       3 |        0 |
| I6 Inventory valuation vs GL inventory accounts   | WARN   |      75 |        1 |
| I7 Agent-owned stock stays outside company books  | PASS   |     722 |        0 |

## I1 — Movement chain per product and warehouse: PASS

| Metric    | Value |
| --------- | ----: |
| movements |   722 |
| chains    |   204 |

## I2 — No negative stock; reserved within on-hand: PASS

| Metric   | Value |
| -------- | ----: |
| balances |   204 |

## I3 — No duplicate document-line movements: PASS

- Keyed (R13) movements are protected by a unique index; a duplicate key is a FAIL.

- Un-keyed legacy document movements repeated more often than the document has matching lines are listed as WARN for owner review — never auto-corrected.

| Metric                  | Value |
| ----------------------- | ----: |
| keyedMovements          |    75 |
| legacyDocumentMovements |   432 |

## I4 — Assembly orders: cost, consumption and journal: PASS

| Metric     | Value |
| ---------- | ----: |
| orders     |     6 |
| reversed   |     3 |
| agentOwned |     0 |

## I5 — Kit sales: component deliveries and COGS once: PASS

| Metric   | Value |
| -------- | ----: |
| kitLines |     3 |
| invoices |     3 |

## I6 — Inventory valuation vs GL inventory accounts: WARN

- GL side = posted balance of the inventory accounts read from journal lines (POSTED + REVERSED pairs net to zero) — never a recomputed balance.

- Sub-ledger = Σ on-hand × moving average of company-owned stock (agent-owned stock excluded), each product rounded to 2 dp.

- A difference is reported with its known causes for review — it is never forced to zero and never auto-corrected.

| Metric                               |     Value |
| ------------------------------------ | --------: |
| subledgerValue                       | 397523.85 |
| glBalance                            | 375612.65 |
| difference                           |  21911.20 |
| roundingBound                        |      0.64 |
| inventoryAccounts                    |         1 |
| openingBalanceMovements              |        54 |
| openingBalanceMovementValue          |  20231.00 |
| openingBalanceGlOnInventoryAccounts  |      0.00 |
| transferMovementsGlNeutral           |         0 |
| unpostedAdjustmentMovements          |         1 |
| unpostedAdjustmentValue              |   5177.48 |
| documentMovementsWithoutJournal      |       159 |
| documentMovementsWithoutJournalValue |   -225.87 |
| stockedProductsWithoutCost           |        43 |
| explainedByKnownCauses               |  25182.61 |
| remainderAfterKnownCauses            |  -3271.41 |

Findings (1; first 1):

- [WARN] VALUATION_GL_DIFFERENCE: INV مخزون البضاعة: stock value 397523.85 vs posted balance 375612.65 (difference 21911.20).

## I7 — Agent-owned stock stays outside company books: PASS

- Company valuation check is company-wide (the product / warehouse filter does not apply to it).

| Metric                    |  Value |
| ------------------------- | -----: |
| movements                 |    722 |
| agentOwnedMovements       |    253 |
| agentOwnedProductsInStock |    124 |
| agentOwnedUnitsExcluded   |   5610 |
| agentOwnedValueExcluded   | 600.00 |
