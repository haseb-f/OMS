# Inventory integrity — database "oms_reset_r13b_forced"

Generated 2026-10-06T15:21:24.791Z in 706 ms — overall **PASS** (PASS 7 · WARN 0 · FAIL 0).

Filter: products all, warehouse all.

| Invariant                                         | Status | Checked | Findings |
| ------------------------------------------------- | ------ | ------: | -------: |
| I1 Movement chain per product and warehouse       | PASS   |       0 |        0 |
| I2 No negative stock; reserved within on-hand     | PASS   |       0 |        0 |
| I3 No duplicate document-line movements           | PASS   |       0 |        0 |
| I4 Assembly orders: cost, consumption and journal | PASS   |       0 |        0 |
| I5 Kit sales: component deliveries and COGS once  | PASS   |       0 |        0 |
| I6 Inventory valuation vs GL inventory accounts   | PASS   |       0 |        0 |
| I7 Agent-owned stock stays outside company books  | PASS   |       0 |        0 |

## I1 — Movement chain per product and warehouse: PASS

| Metric    | Value |
| --------- | ----: |
| movements |     0 |
| chains    |     0 |

## I2 — No negative stock; reserved within on-hand: PASS

| Metric   | Value |
| -------- | ----: |
| balances |     0 |

## I3 — No duplicate document-line movements: PASS

- Keyed (R13) movements are protected by a unique index; a duplicate key is a FAIL.

- Un-keyed legacy document movements repeated more often than the document has matching lines are listed as WARN for owner review — never auto-corrected.

| Metric                  | Value |
| ----------------------- | ----: |
| keyedMovements          |     0 |
| legacyDocumentMovements |     0 |

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

## I6 — Inventory valuation vs GL inventory accounts: PASS

- GL side = posted balance of the inventory accounts read from journal lines (POSTED + REVERSED pairs net to zero) — never a recomputed balance.

- Sub-ledger = Σ on-hand × moving average of company-owned stock (agent-owned stock excluded), each product rounded to 2 dp.

- A difference is reported with its known causes for review — it is never forced to zero and never auto-corrected.

| Metric                               | Value |
| ------------------------------------ | ----: |
| subledgerValue                       |  0.00 |
| glBalance                            |  0.00 |
| difference                           |  0.00 |
| roundingBound                        |  0.00 |
| inventoryAccounts                    |     1 |
| openingBalanceMovements              |     0 |
| openingBalanceMovementValue          |  0.00 |
| openingBalanceGlOnInventoryAccounts  |  0.00 |
| transferMovementsGlNeutral           |     0 |
| unpostedAdjustmentMovements          |     0 |
| unpostedAdjustmentValue              |  0.00 |
| documentMovementsWithoutJournal      |     0 |
| documentMovementsWithoutJournalValue |  0.00 |
| stockedProductsWithoutCost           |     0 |
| explainedByKnownCauses               |  0.00 |
| remainderAfterKnownCauses            |  0.00 |

## I7 — Agent-owned stock stays outside company books: PASS

- Company valuation check is company-wide (the product / warehouse filter does not apply to it).

| Metric                    | Value |
| ------------------------- | ----: |
| movements                 |     0 |
| agentOwnedMovements       |     0 |
| agentOwnedProductsInStock |     0 |
| agentOwnedUnitsExcluded   |     0 |
| agentOwnedValueExcluded   |  0.00 |
