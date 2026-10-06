# R13 independent reviews and their outcome

Three independent read-only reviews ran on the branch; every finding was verified in code before being fixed, and each fix
has a regression test that fails without it (mutation-checked).

## Inventory & accounting review

| ID  | Severity | Finding                                                                                                  | Outcome                                                                | Test                |
| --- | -------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------- |
| H1  | High     | Landed cost moved the moving average without the product row lock (lost update vs a concurrent purchase) | Fixed: products locked before the on-hand read                         | kit spec "H1"       |
| H2  | High     | Assembly valued a component with NULL cost at 0                                                          | Fixed: `ASSEMBLY_COMPONENT_COST_MISSING` blocker                       | assembly spec "H2"  |
| M3  | Medium   | Assembly reversal could leave GL ≠ sub-ledger once the FG average moved                                  | Fixed: removal at current average + `ASSEMBLY_REVERSAL_VARIANCE` entry | kit spec "M3"       |
| M4  | Medium   | Order-linked invoice gave the order-reservation credit to every line; edits dropped order links          | Fixed: credit per linked line, links kept, cap on edit                 | kit spec "M4"       |
| L5  | Low      | Sales-return blend ignored zero-cost quantity                                                            | Fixed                                                                  | kit spec "L5"       |
| L6  | Low      | Damage/expired/negative adjustment/purchase return (and transfer) ignored reservations                   | Fixed: available-based check (count exempt)                            | hardening spec "L6" |
| L7  | Low      | Kit decision by current supply method for historical lines                                               | Fixed for invoices; returns → owner decision O7                        | kit spec "L7"       |
| L8  | Low      | Purchase blend used a rounded float unit cost                                                            | Fixed: exact functional line value                                     | kit spec "L8"       |

## Security review

| ID  | Severity | Finding                                                                     | Outcome                                                                   |
| --- | -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| S1  | Medium   | Assembly cost in product activity metadata readable without permissions     | Fixed: no cost in metadata; activities controller guarded                 |
| S2  | Medium   | Recipe/assembly direct-cost estimate not redacted                           | Fixed: cost-visibility rule                                               |
| S3  | Medium   | `currentCost` returned by product/sales reads to any `products.view` holder | Fixed: redaction interceptor (`purchasePrice` = catalog price, unchanged) |
| S4  | Low      | Global assembly idempotency keys, unvalidated header                        | Fixed: per-user, validated                                                |
| S5  | Low      | Kit availability exposed stock with only `products.view`                    | Fixed: requires `inventory.view`                                          |
| S6  | Low      | Recipe/assembly activities lacked the actor                                 | Fixed: `createdBy` recorded                                               |
| S7  | Low      | Agent-owned kit on company documents                                        | Already enforced; test added                                              |

## Spec-conformance audit (before release)

| Finding                                                                                     | Classification      | Outcome                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| Stock tracking could be turned off (or item made a service) with stock/reservations on hand | Release blocker     | Fixed: `PRODUCT_TRACKING_LOCKED` (API + form message), test mutation-checked             |
| Purchase return credits Inventory at return price vs average removal (pre-existing)         | Accounting decision | Not decided — recorded as **O9** in spec §10                                             |
| Browser pass only viewed API-created records                                                | Verification gap    | UI-driven browser pass added (create/activate/assemble in the UI) — see verification.md  |
| Missing tasks/reviews docs, prod survey not linked, U+FFFD in two strings, implicit rules   | Doc gaps            | Fixed (this file, tasks.md, spec §10 recorded decisions, migration.md Production survey) |
