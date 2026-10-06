# Inventory integrity — database "oms_r13_mig"

Generated 2026-10-06T04:16:27.228Z in 1521 ms — overall **WARN** (PASS 6 · WARN 1 · FAIL 0).

Filter: products all, warehouse all.

| Invariant                                         | Status | Checked | Findings |
| ------------------------------------------------- | ------ | ------: | -------: |
| I1 Movement chain per product and warehouse       | PASS   |     626 |        0 |
| I2 No negative stock; reserved within on-hand     | PASS   |     180 |        0 |
| I3 No duplicate document-line movements           | PASS   |     432 |        0 |
| I4 Assembly orders: cost, consumption and journal | PASS   |       0 |        0 |
| I5 Kit sales: component deliveries and COGS once  | PASS   |       0 |        0 |
| I6 Inventory valuation vs GL inventory accounts   | WARN   |      57 |        1 |
| I7 Agent-owned stock stays outside company books  | PASS   |     626 |        0 |

## I1 — Movement chain per product and warehouse: PASS

| Metric    | Value |
| --------- | ----: |
| movements |   626 |
| chains    |   180 |

## I2 — No negative stock; reserved within on-hand: PASS

| Metric   | Value |
| -------- | ----: |
| balances |   180 |

## I3 — No duplicate document-line movements: PASS

- Keyed (R13) movements are protected by a unique index; a duplicate key is a FAIL.

- Un-keyed legacy document movements repeated more often than the document has matching lines are listed as WARN for owner review — never auto-corrected.

| Metric                  | Value |
| ----------------------- | ----: |
| keyedMovements          |     0 |
| legacyDocumentMovements |   432 |

## I4 — Assembly orders: cost, consumption and journal: PASS

| Metric     | Value |
| ---------- | ----: |
| orders     |     0 |
| reversed   |     0 |
| agentOwned |     0 |

## I5 — Kit sales: component deliveries and COGS once: PASS

| Metric   | Value |
| -------- | ----: |
| kitLines |     0 |
| invoices |     0 |

## I6 — Inventory valuation vs GL inventory accounts: WARN

- GL side = posted balance of the inventory accounts read from journal lines (POSTED + REVERSED pairs net to zero) — never a recomputed balance.

- Sub-ledger = Σ on-hand × moving average of company-owned stock (agent-owned stock excluded), each product rounded to 2 dp.

- A difference is reported with its known causes for review — it is never forced to zero and never auto-corrected.

| Metric                               |     Value |
| ------------------------------------ | --------: |
| subledgerValue                       | 396820.56 |
| glBalance                            | 374909.36 |
| difference                           |  21911.20 |
| roundingBound                        |      0.55 |
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

- [WARN] VALUATION_GL_DIFFERENCE: INV مخزون البضاعة: stock value 396820.56 vs posted balance 374909.36 (difference 21911.20).

## I7 — Agent-owned stock stays outside company books: PASS

- Company valuation check is company-wide (the product / warehouse filter does not apply to it).

| Metric                    | Value |
| ------------------------- | ----: |
| movements                 |   626 |
| agentOwnedMovements       |   247 |
| agentOwnedProductsInStock |   121 |
| agentOwnedUnitsExcluded   |  5598 |
| agentOwnedValueExcluded   |  0.00 |
