# R13 migration dry run — database "oms_r13_drop"

Generated 2026-10-06T13:06:06.310Z. Last migration: `20261006150000_r13_drop_legacy_product_components`. R13 applied: **yes** (supply method as stored).

## Owner review

| Item                                                                          | Count |
| ----------------------------------------------------------------------------- | ----: |
| Products without item type (UNCLASSIFIED)                                     |     7 |
| Stored legacy type ≠ type derived from attributes                             |    10 |
| Attribute rule violations (service stocked, stocked kit, unstocked assembled) |    10 |
| Assembled / kit / MANUFACTURED products                                       |     1 |
| DRAFT recipes needing review + activation                                     |     1 |
| Duplicate barcodes (non-deleted)                                              |     0 |
| Products with stock movements but no cost                                     |   164 |
| Investment-eligible products the new rule would block (grandfathered)         |     0 |
| Agent-owned stock referenced by company journals                              |     0 |

### Product classification

| Item type    | Supply    | Tracked | Sell | Buy | Agent | Legacy type       | Deleted | Count |
| ------------ | --------- | ------- | ---- | --- | ----- | ----------------- | ------- | ----: |
| PRODUCT      | PURCHASED | yes     | yes  | yes | yes   | PURCHASE_AND_SALE | no      |   249 |
| PRODUCT      | PURCHASED | yes     | yes  | yes | no    | PURCHASE_AND_SALE | no      |   182 |
| SERVICE      | PURCHASED | no      | yes  | no  | yes   | SERVICE           | no      |    54 |
| PRODUCT      | PURCHASED | yes     | yes  | yes | yes   | PURCHASE_AND_SALE | yes     |    48 |
| PRODUCT      | PURCHASED | yes     | yes  | yes | no    | PURCHASE_AND_SALE | yes     |    47 |
| SERVICE      | PURCHASED | no      | yes  | no  | no    | SERVICE           | no      |    44 |
| PRODUCT      | PURCHASED | no      | yes  | yes | yes   | PURCHASE_AND_SALE | no      |    29 |
| PRODUCT      | PURCHASED | yes     | yes  | no  | yes   | SALES_ONLY        | no      |    24 |
| SERVICE      | PURCHASED | yes     | yes  | no  | no    | SERVICE           | no      |    10 |
| SERVICE      | PURCHASED | no      | yes  | yes | yes   | PURCHASE_AND_SALE | no      |    10 |
| UNCLASSIFIED | PURCHASED | no      | yes  | no  | yes   | SALES_ONLY        | no      |     6 |
| PRODUCT      | PURCHASED | no      | yes  | no  | yes   | SALES_ONLY        | no      |     3 |
| SERVICE      | PURCHASED | no      | no   | yes | no    | SERVICE           | no      |     3 |
| PRODUCT      | PURCHASED | yes     | no   | yes | no    | PURCHASE_ONLY     | no      |     2 |
| PRODUCT      | PURCHASED | yes     | yes  | no  | no    | SALES_ONLY        | no      |     1 |
| PRODUCT      | ASSEMBLED | yes     | yes  | yes | no    | MANUFACTURED      | no      |     1 |
| PRODUCT      | PURCHASED | no      | yes  | yes | no    | PURCHASE_AND_SALE | no      |     1 |
| UNCLASSIFIED | PURCHASED | no      | yes  | no  | no    | SERVICE           | no      |     1 |

### Legacy type inconsistencies

- R6SHIP-043599-D DEMO-R6-20261001 Ship Product D 043599: stored PURCHASE_AND_SALE, derived SERVICE (SERVICE, PURCHASED, track no, sell yes, buy yes)
- R6SHIP-1BE62D-D DEMO-R6-20261001 Ship Product D 1BE62D: stored PURCHASE_AND_SALE, derived SERVICE (SERVICE, PURCHASED, track no, sell yes, buy yes)
- R6SHIP-3887DB-D DEMO-R6-20261001 Ship Product D 3887DB: stored PURCHASE_AND_SALE, derived SERVICE (SERVICE, PURCHASED, track no, sell yes, buy yes)
- R6SHIP-895131-D DEMO-R6-20261001 Ship Product D 895131: stored PURCHASE_AND_SALE, derived SERVICE (SERVICE, PURCHASED, track no, sell yes, buy yes)
- R6SHIP-8BDDD6-D DEMO-R6-20261001 Ship Product D 8BDDD6: stored PURCHASE_AND_SALE, derived SERVICE (SERVICE, PURCHASED, track no, sell yes, buy yes)
- R6SHIP-95AA6C-D DEMO-R6-20261001 Ship Product D 95AA6C: stored PURCHASE_AND_SALE, derived SERVICE (SERVICE, PURCHASED, track no, sell yes, buy yes)
- R6SHIP-A29894-D DEMO-R6-20261001 Ship Product D A29894: stored PURCHASE_AND_SALE, derived SERVICE (SERVICE, PURCHASED, track no, sell yes, buy yes)
- R6SHIP-D1104F-D DEMO-R6-20261001 Ship Product D D1104F: stored PURCHASE_AND_SALE, derived SERVICE (SERVICE, PURCHASED, track no, sell yes, buy yes)
- R6SHIP-EF8ECF-D DEMO-R6-20261001 Ship Product D EF8ECF: stored PURCHASE_AND_SALE, derived SERVICE (SERVICE, PURCHASED, track no, sell yes, buy yes)
- R6SHIP-FAA569-D DEMO-R6-20261001 Ship Product D FAA569: stored PURCHASE_AND_SALE, derived SERVICE (SERVICE, PURCHASED, track no, sell yes, buy yes)

### Attribute rule violations

- AGT-F7-0293F2 F7 0293F2: PRODUCT_SERVICE_RULE
- AGT-F7-0AD56B F7 0AD56B: PRODUCT_SERVICE_RULE
- AGT-F7-0B9F54 F7 0B9F54: PRODUCT_SERVICE_RULE
- AGT-F7-24FF7A F7 24FF7A: PRODUCT_SERVICE_RULE
- AGT-F7-9AF6D3 F7 9AF6D3: PRODUCT_SERVICE_RULE
- AGT-F7-A628F2 F7 A628F2: PRODUCT_SERVICE_RULE
- AGT-F7-B67015 F7 B67015: PRODUCT_SERVICE_RULE
- AGT-F7-BD9BC2 F7 BD9BC2: PRODUCT_SERVICE_RULE
- AGT-F7-C22EB4 F7 C22EB4: PRODUCT_SERVICE_RULE
- AGT-F7-F7AF52 F7 F7AF52: PRODUCT_SERVICE_RULE

### Assembled / kit products

- PRD-2026-000008 بوكس جديد اختبار: ASSEMBLED, legacy components 0, recipes {"DRAFT":1}

### DRAFT recipes

- PRD-2026-000008 بوكس جديد اختبار: v1, 1 line(s), migrated

### Stock without cost

- AGT-05C6E9-LOCK Agent Test LOCK 05C6E9: on-hand 5, 1 movement(s), agent-owned
- AGT-0C7622-LOCK Agent Test LOCK 0C7622: on-hand 5, 1 movement(s), agent-owned
- AGT-0CC4CC-LOCK Agent Test LOCK 0CC4CC: on-hand 5, 1 movement(s), agent-owned
- AGT-119C9A-LOCK Agent Test LOCK 119C9A: on-hand 5, 1 movement(s), agent-owned
- AGT-122270-LOCK Agent Test LOCK 122270: on-hand 5, 1 movement(s), agent-owned
- AGT-2C5D44-LOCK Agent Test LOCK 2C5D44: on-hand 5, 1 movement(s), agent-owned
- AGT-360083-LOCK Agent Test LOCK 360083: on-hand 5, 1 movement(s), agent-owned
- AGT-3938B2-LOCK Agent Test LOCK 3938B2: on-hand 5, 1 movement(s), agent-owned
- AGT-42F429-LOCK Agent Test LOCK 42F429: on-hand 5, 1 movement(s), agent-owned
- AGT-43A974-LOCK Agent Test LOCK 43A974: on-hand 5, 1 movement(s), agent-owned
- AGT-4FB212-LOCK Agent Test LOCK 4FB212: on-hand 5, 1 movement(s), agent-owned
- AGT-51D7AD-LOCK Agent Test LOCK 51D7AD: on-hand 5, 1 movement(s), agent-owned
- AGT-6755C4-LOCK Agent Test LOCK 6755C4: on-hand 5, 1 movement(s), agent-owned
- AGT-68FA89-LOCK Agent Test LOCK 68FA89: on-hand 5, 1 movement(s), agent-owned
- AGT-779352-LOCK Agent Test LOCK 779352: on-hand 5, 1 movement(s), agent-owned
- … 149 more in the JSON

## Reconciliation baseline

| Figure                                            |                     Value |
| ------------------------------------------------- | ------------------------: |
| Products (deleted)                                |                  715 (95) |
| Movements                                         |                       626 |
| Product × warehouse balances                      |                       180 |
| Σ on-hand units                                   |                     10725 |
| Company stock value (Σ round2(onHand × average))  |                 396820.56 |
| Products with a cost                              |                        14 |
| Cost snapshots / history rows                     |                   14 / 31 |
| Journal entries / lines                           |              5462 / 12131 |
| Σ debit = Σ credit                                | 22794576.99 / 22794576.99 |
| GL inventory accounts (posted balance)            |             INV 374909.36 |
| GL COGS accounts (posted balance)                 |                   9644.64 |
| SALES_DELIVERY value (Σ abs(qty) × movement cost) |                      0.00 |
| Invoice line COGS (Σ round2(unitCost × qty))      |                   9930.26 |
| Legacy product_components rows                    |                         0 |
| Recipes                                           |             1 {"DRAFT":1} |
